"""Independent AudioLDM2 experiment. Never adopts audio into the product library."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import time
import traceback


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--prompts", type=Path, default=Path(__file__).with_name("prompts.json"))
    parser.add_argument("--categories", nargs="+")
    parser.add_argument("--seeds", nargs="+", type=int)
    parser.add_argument("--duration", type=float, default=8)
    parser.add_argument("--steps", type=int, default=50)
    parser.add_argument("--cpu-threads", type=int, default=1)
    args = parser.parse_args()
    root = args.artifact_root.resolve()
    temporary_root = root / "tmp"
    temporary_root.mkdir(parents=True, exist_ok=True)
    os.environ["TMP"] = os.environ["TEMP"] = str(temporary_root)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import numpy as np
    import scipy.io.wavfile as wavfile
    import torch
    from diffusers import AudioLDM2Pipeline, DPMSolverMultistepScheduler

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for this measured local experiment")
    if args.cpu_threads < 1:
        raise ValueError("CPU thread count must be positive")
    torch.set_num_threads(args.cpu_threads)
    torch.set_num_interop_threads(1)
    definitions = json.loads(args.prompts.read_text(encoding="utf-8"))
    categories = definitions["categories"]
    if args.categories:
        unknown = set(args.categories) - {item["id"] for item in categories}
        if unknown:
            raise ValueError(f"Unknown categories: {sorted(unknown)}")
        categories = [item for item in categories if item["id"] in args.categories]
    seeds = args.seeds or definitions["seeds"]
    manifest_path = root / "generation-manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest["model"]["revision"] != args.revision:
            raise ValueError("Use a new artifact root for a different model revision")
    else:
        manifest = {
            "schemaVersion": 1,
            "model": {"id": "cvssp/audioldm2", "revision": args.revision,
                      "license": "CC-BY-NC-SA-4.0", "sampleRate": 16000, "channels": 1,
                      "source": "https://huggingface.co/cvssp/audioldm2",
                      "weightsPath": str(args.model_path.resolve())},
            "environment": {"execution": "local", "sourceUrl": "https://huggingface.co/cvssp/audioldm2",
                            "timing": "local inference including prompt encoding and waveform decoding; excludes model load",
                            "gpu": torch.cuda.get_device_name(0),
                            "torch": torch.__version__, "cuda": torch.version.cuda,
                            "dependencies": {name: importlib.metadata.version(name) for name in
                                             ("diffusers", "transformers", "accelerate", "numpy", "scipy")},
                            "precision": "float16", "offload": "enable_model_cpu_offload",
                            "attention": "default torch SDPA",
                            "scheduler": "DPMSolverMultistepScheduler",
                            "guidanceScale": 3.5, "waveformsPerPrompt": 1},
            "notes": ["Experimental noncommercial candidates; listening acceptance pending.",
                      "Raw audio generated independently. No looping, stitching, denoising or spatial processing.",
                      "GPU peaks cover this torch process, not total system VRAM."],
            "runs": [],
        }
    pending = []
    for category in categories:
        for seed in seeds:
            run_id = f"{category['id']}-s{seed}-{args.duration:g}s-{args.steps}steps"
            previous = next((run for run in manifest["runs"] if run["id"] == run_id), None)
            if previous and (previous["prompt"] != category["prompt"] or
                             previous["negativePrompt"] != definitions["negativePrompt"]):
                raise ValueError("Prompt changed: use a new artifact root to preserve this experiment")
            if previous and previous["status"] == "generated":
                if not Path(previous["rawPath"]).is_file():
                    raise FileNotFoundError(previous["rawPath"])
                actual_hash = hashlib.sha256(Path(previous["rawPath"]).read_bytes()).hexdigest()
                if actual_hash != previous["rawSha256"]:
                    raise ValueError(f"Recorded raw audio changed: {previous['rawPath']}")
                print(f"PRESERVED {run_id}", flush=True)
            else:
                pending.append((run_id, category, seed))
    if not pending:
        return
    manifest["environment"]["cpuThreads"] = torch.get_num_threads()
    manifest["environment"]["interopThreads"] = torch.get_num_interop_threads()
    manifest["environment"]["cudaModuleLoading"] = os.environ.get("CUDA_MODULE_LOADING", "default")
    write_json(manifest_path, manifest)
    load_started = time.perf_counter()
    print(f"LOAD {args.model_path}", flush=True)
    pipe = AudioLDM2Pipeline.from_pretrained(str(args.model_path.resolve()),
                                           torch_dtype=torch.float16,
                                           local_files_only=True, use_safetensors=True,
                                           low_cpu_mem_usage=True)
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)
    pipe.enable_model_cpu_offload()
    manifest["lastModelLoadSeconds"] = round(time.perf_counter() - load_started, 3)
    write_json(manifest_path, manifest)
    print(f"LOADED {manifest['lastModelLoadSeconds']} seconds", flush=True)
    raw_root = root / "raw"
    raw_root.mkdir(parents=True, exist_ok=True)
    for run_id, category, seed in pending:
        raw_path = raw_root / f"{run_id}.wav"
        if raw_path.exists():
            raise FileExistsError(f"Refusing to overwrite existing raw audio: {raw_path}")
        run = {"id": run_id, "category": category["id"], "label": category["label"],
               "prompt": category["prompt"], "negativePrompt": definitions["negativePrompt"],
               "seed": seed, "requestedDurationSeconds": args.duration, "steps": args.steps,
               "status": "running", "startedAt": datetime.now(timezone.utc).isoformat(),
               "rawPath": str(raw_path), "listeningAcceptance": "pending"}
        previous_attempt = next((item for item in manifest["runs"] if item["id"] == run_id), None)
        if previous_attempt:
            manifest.setdefault("attemptHistory", []).append({
                **previous_attempt, "supersededAt": datetime.now(timezone.utc).isoformat()})
        manifest["runs"] = [item for item in manifest["runs"] if item["id"] != run_id]
        manifest["runs"].append(run)
        write_json(manifest_path, manifest)
        torch.cuda.reset_peak_memory_stats()
        torch.cuda.synchronize()
        started = time.perf_counter()
        print(f"GENERATE {run_id}", flush=True)
        try:
            generator = torch.Generator(device="cuda").manual_seed(seed)
            with torch.inference_mode():
                audio = pipe(category["prompt"], negative_prompt=definitions["negativePrompt"],
                             generator=generator, audio_length_in_s=args.duration,
                             num_inference_steps=args.steps, guidance_scale=3.5,
                             num_waveforms_per_prompt=1).audios[0]
            torch.cuda.synchronize()
            elapsed = time.perf_counter() - started
            audio = np.asarray(audio, dtype=np.float32)
            if audio.ndim != 1 or not np.all(np.isfinite(audio)) or not np.any(audio):
                raise ValueError("Generated waveform must be finite nonzero mono audio")
            if len(audio) != round(args.duration * 16000):
                raise ValueError(f"Unexpected generated length: {len(audio)} samples")
            temporary = raw_path.with_suffix(".wav.tmp")
            wavfile.write(str(temporary), 16000, audio)
            temporary.replace(raw_path)
            run.update(status="generated", generationSeconds=round(elapsed, 3),
                       realTimeFactor=round(elapsed / args.duration, 3),
                       peakVramAllocatedBytes=torch.cuda.max_memory_allocated(),
                       peakVramReservedBytes=torch.cuda.max_memory_reserved(),
                       rawSha256=hashlib.sha256(raw_path.read_bytes()).hexdigest(),
                       actualDurationSeconds=len(audio) / 16000,
                       completedAt=datetime.now(timezone.utc).isoformat())
            print(f"GENERATED {run_id} {elapsed:.2f}s peak allocated "
                  f"{run['peakVramAllocatedBytes'] / 2**30:.2f}GiB", flush=True)
        except Exception as error:
            run.update(status="failed", errorType=type(error).__name__, error=str(error),
                       generationSeconds=round(time.perf_counter() - started, 3),
                       peakVramAllocatedBytes=torch.cuda.max_memory_allocated(),
                       peakVramReservedBytes=torch.cuda.max_memory_reserved())
            write_json(manifest_path, manifest)
            traceback.print_exc()
            raise
        write_json(manifest_path, manifest)
    print(f"MANIFEST {manifest_path}", flush=True)


if __name__ == "__main__":
    main()
