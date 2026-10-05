"""Offline Stable Audio Open 1.0 experiment; launch through run_bounded.py.

This adapter neither downloads weights nor adopts audio into the product library.
It generates serial, independent seeded takes and stops on the first failure.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import re
import socket
import sys
import tempfile
import time
import traceback


MODEL_ID = "stabilityai/stable-audio-open-1.0"
MODEL_SOURCE = f"https://huggingface.co/{MODEL_ID}"
SAMPLE_RATE = 44100
CHANNELS = 2
GUIDANCE_SCALE = 7.0
SAFE_CATEGORY = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
COMMIT_SHA = re.compile(r"[0-9a-fA-F]{40}\Z")


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, data: dict) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".manifest-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", type=Path, required=True,
                        help="Existing local Diffusers snapshot; no remote repository IDs")
    parser.add_argument("--revision", required=True, help="Pinned 40-character upstream commit SHA")
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--prompts", type=Path, default=Path(__file__).with_name("prompts.json"))
    parser.add_argument("--categories", nargs="+")
    parser.add_argument("--seeds", nargs="+", type=int)
    parser.add_argument("--duration", type=float, default=24, help="Seconds, greater than 0 and at most 47")
    parser.add_argument("--steps", type=int, default=50)
    parser.add_argument("--cpu-threads", type=int, default=1)
    parser.add_argument("--cpu-offload", "--enable-model-cpu-offload", action="store_true",
                        help="Explicitly enable model CPU offload instead of the default direct CUDA placement")
    return parser.parse_args(argv)


def validate_request(args: argparse.Namespace) -> tuple[dict, list[dict], list[int], dict]:
    """Validate paths and the complete request using only the standard library."""
    if not COMMIT_SHA.fullmatch(args.revision):
        raise ValueError("--revision must be a pinned 40-character commit SHA, not a branch or tag")
    args.revision = args.revision.lower()
    if not math.isfinite(args.duration) or not 0 < args.duration <= 47:
        raise ValueError("--duration must be finite, greater than 0 and at most 47 seconds")
    if int(args.duration * SAMPLE_RATE) < 1:
        raise ValueError("--duration must contain at least one sample frame")
    if args.steps < 1 or args.cpu_threads < 1:
        raise ValueError("--steps and --cpu-threads must be positive integers")
    args.model_path = args.model_path.resolve(strict=True)
    if not args.model_path.is_dir():
        raise ValueError("--model-path must be an existing local directory")
    if args.model_path.parent.name == "snapshots" and args.model_path.name.lower() != args.revision:
        raise ValueError("Local Hugging Face snapshot directory differs from --revision")
    model_index = args.model_path / "model_index.json"
    model_definition = json.loads(model_index.read_text(encoding="utf-8-sig"))
    if not isinstance(model_definition, dict) or model_definition.get("_class_name") != "StableAudioPipeline":
        raise ValueError("Expected an official Diffusers StableAudioPipeline model_index.json")
    for component in ("scheduler", "tokenizer", "text_encoder", "projection_model", "transformer", "vae"):
        if not (args.model_path / component).is_dir() or not isinstance(model_definition.get(component), list):
            raise ValueError(f"Missing local pipeline component: {component}")
    if not any(args.model_path.rglob("*.safetensors")):
        raise ValueError("The local model snapshot must contain safetensors weights")
    args.artifact_root = args.artifact_root.resolve()
    if args.artifact_root.exists() and not args.artifact_root.is_dir():
        raise ValueError("--artifact-root must be a directory")
    if args.model_path == args.artifact_root or args.model_path in args.artifact_root.parents:
        raise ValueError("Artifacts must be outside the model snapshot")
    for child in ("raw", "tmp", "generation-manifest.json"):
        candidate = args.artifact_root / child
        if candidate.is_symlink() or (candidate.exists() and args.artifact_root not in candidate.resolve().parents):
            raise ValueError(f"Artifact child must remain inside its root: {candidate}")
    args.prompts = args.prompts.resolve(strict=True)
    definitions = json.loads(args.prompts.read_text(encoding="utf-8-sig"))
    if not isinstance(definitions, dict) or definitions.get("schemaVersion") != 1:
        raise ValueError("Expected prompts schemaVersion: 1")
    categories = definitions.get("categories")
    if not isinstance(categories, list) or not categories:
        raise ValueError("Prompts must contain a nonempty categories array")
    identifiers = set()
    for category in categories:
        if not isinstance(category, dict):
            raise ValueError("Every category must be an object")
        identifier = category.get("id")
        if not isinstance(identifier, str) or not SAFE_CATEGORY.fullmatch(identifier) or identifier in identifiers:
            raise ValueError("Category IDs must be unique, safe file-name fragments")
        identifiers.add(identifier)
        for key in ("label", "prompt"):
            if not isinstance(category.get(key), str) or not category[key].strip():
                raise ValueError(f"Category {identifier} requires a nonempty {key}")
    if not isinstance(definitions.get("negativePrompt"), str):
        raise ValueError("Prompts require a negativePrompt string")
    if args.categories:
        if len(set(args.categories)) != len(args.categories) or set(args.categories) - identifiers:
            raise ValueError("--categories must contain distinct IDs present in the prompts file")
        categories = [item for item in categories if item["id"] in args.categories]
    seeds = args.seeds if args.seeds is not None else definitions.get("seeds")
    if (not isinstance(seeds, list) or not seeds or
            any(not isinstance(seed, int) or isinstance(seed, bool) or not 0 <= seed < 2**63 for seed in seeds) or
            len(set(seeds)) != len(seeds)):
        raise ValueError("Seeds must be distinct integers in the range 0 through 2**63 - 1")
    contract = {
        "modelId": MODEL_ID, "revision": args.revision, "weightsPath": str(args.model_path),
        "modelIndexSha256": sha256_file(model_index), "promptsSha256": sha256_file(args.prompts),
        "durationSeconds": args.duration, "steps": args.steps, "cpuThreads": args.cpu_threads,
        "placement": "enable_model_cpu_offload" if args.cpu_offload else "cuda",
        "precision": "float16", "guidanceScale": GUIDANCE_SCALE, "waveformsPerPrompt": 1,
    }
    return definitions, categories, seeds, contract


def prepare_manifest(args, definitions, categories, seeds, contract) -> tuple[dict, list[tuple]]:
    manifest_path = args.artifact_root / "generation-manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        if (not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1 or
                manifest.get("request") != contract or not isinstance(manifest.get("runs"), list)):
            raise ValueError("Experiment parameters changed or manifest is incompatible: use a new artifact root")
    else:
        if (args.artifact_root / "raw").exists() and any((args.artifact_root / "raw").iterdir()):
            raise ValueError("Raw outputs exist without a manifest: use a new artifact root")
        manifest = {
            "schemaVersion": 1, "createdAt": timestamp(), "status": "prepared", "request": contract,
            "model": {"id": MODEL_ID, "revision": args.revision, "source": MODEL_SOURCE,
                      "license": "Stability AI Community License (stable-audio-community)",
                      "licenseSource": MODEL_SOURCE + "/blob/" + args.revision + "/LICENSE.md",
                      "licenseReview": "Use the locally obtained license and model card; product adoption pending",
                      "sampleRate": SAMPLE_RATE, "channels": CHANNELS, "weightsPath": str(args.model_path),
                      "revisionProvenance": "Supplied pinned commit; local snapshot identity is not remotely verified",
                      "modelIndexSha256": contract["modelIndexSha256"]},
            "environment": {"execution": "local", "sourceUrl": MODEL_SOURCE,
                            "host": socket.gethostname(), "platform": platform.platform(),
                            "python": sys.version, "pythonExecutable": sys.executable,
                            "precision": "float16", "offload": contract["placement"],
                            "guidanceScale": GUIDANCE_SCALE, "waveformsPerPrompt": 1,
                            "attention": "default Diffusers attention processor",
                            "timing": "local inference including prompt encoding and waveform decoding; excludes model load and file writes"},
            "notes": ["Independent experimental candidates; listening acceptance pending.",
                      "No looping, stitching, normalization, clipping, denoising, fades or spatial processing.",
                      "Raw float32 stereo preserves both model output channels; stereo is not proof of binaural recording.",
                      "GPU peaks cover this torch process, not total system VRAM.",
                      "External supervisor required: at most 300 seconds, explicit cancellation, no automatic retries."],
            "runs": [],
        }
    recorded = {}
    for run in manifest["runs"]:
        if not isinstance(run, dict) or not isinstance(run.get("id"), str) or run["id"] in recorded:
            raise ValueError("Manifest contains invalid or duplicate run IDs")
        recorded[run["id"]] = run
    pending = []
    for category in categories:
        for seed in seeds:
            run_id = f"{category['id']}-s{seed}-{args.duration:g}s-{args.steps}steps"
            raw_path = args.artifact_root / "raw" / f"{run_id}.wav"
            previous = recorded.get(run_id)
            if previous:
                for field, value in (("prompt", category["prompt"]), ("negativePrompt", definitions["negativePrompt"]),
                                     ("seed", seed), ("requestedDurationSeconds", args.duration), ("steps", args.steps)):
                    if previous.get(field) != value:
                        raise ValueError(f"Recorded {field} changed for {run_id}: use a new artifact root")
                if previous.get("status") != "generated":
                    raise ValueError(f"Prior incomplete or failed run {run_id}: use a new artifact root; no retry")
                if Path(previous.get("rawPath", "")).resolve() != raw_path:
                    raise ValueError(f"Recorded raw path differs for {run_id}")
                if raw_path.is_symlink() or not raw_path.is_file() or sha256_file(raw_path) != previous.get("rawSha256"):
                    raise ValueError(f"Recorded raw audio is missing or changed: {raw_path}")
                print(f"PRESERVED {run_id}", flush=True)
            else:
                if raw_path.exists() or raw_path.with_suffix(".pipeline.npy").exists():
                    raise FileExistsError(f"Refusing to overwrite existing raw output: {raw_path}")
                pending.append((run_id, category, seed, raw_path))
    if pending and manifest.get("status") in ("failed", "running", "loading"):
        raise ValueError("Prior failed or interrupted experiment: use a new artifact root; no automatic continuation")
    return manifest, pending


def bounded_launch() -> dict:
    try:
        supervisor_pid = int(os.environ.get("SFX_BOUNDED_SUPERVISOR_PID", "0"))
        timeout = float(os.environ.get("SFX_BOUNDED_TIMEOUT_SECONDS", "nan"))
    except ValueError as error:
        raise ValueError("Invalid bounded supervisor launch environment") from error
    if (os.environ.get("SFX_BOUNDED_RUN") != "1" or supervisor_pid <= 0 or
            not math.isfinite(timeout) or not 0 < timeout <= 300):
        raise ValueError("Generation must run through run_bounded.py with a timeout of at most 300 seconds")
    return {"supervisorPid": supervisor_pid, "timeoutSeconds": timeout,
            "contract": "run_bounded.py environment; launch contract, not authentication"}


def gpu_peaks(torch) -> dict:
    try:
        return {"peakVramAllocatedBytes": torch.cuda.max_memory_allocated(),
                "peakVramReservedBytes": torch.cuda.max_memory_reserved()}
    except Exception:
        return {}


def generate(args, definitions, manifest, pending, supervisor) -> None:
    root = args.artifact_root
    root.mkdir(parents=True, exist_ok=True)
    temporary_root = root / "tmp"
    temporary_root.mkdir(exist_ok=True)
    (root / "raw").mkdir(exist_ok=True)
    manifest_path = root / "generation-manifest.json"
    manifest.update(status="loading", stage="dependencies", lastStartedAt=timestamp())
    manifest["environment"]["supervisor"] = supervisor
    write_json(manifest_path, manifest)
    os.environ["TMP"] = os.environ["TEMP"] = str(temporary_root)
    os.environ["HF_HUB_OFFLINE"] = os.environ["TRANSFORMERS_OFFLINE"] = os.environ["HF_DATASETS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    torch = None
    active_run = None
    started = None
    try:
        manifest["environment"]["dependencies"] = {}
        for name in ("torch", "diffusers", "transformers", "accelerate", "numpy", "scipy", "safetensors", "huggingface-hub", "sentencepiece"):
            try:
                version = importlib.metadata.version(name)
            except importlib.metadata.PackageNotFoundError:
                version = None
            manifest["environment"]["dependencies"][name] = version
        write_json(manifest_path, manifest)
        import numpy as np
        from scipy.io import wavfile
        import torch
        from diffusers import StableAudioPipeline

        manifest["stage"] = "cuda-preflight"
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is required; no CPU fallback or automatic offload fallback")
        torch.set_num_threads(args.cpu_threads)
        torch.set_num_interop_threads(1)
        properties = torch.cuda.get_device_properties(0)
        free_vram, total_vram = torch.cuda.mem_get_info(0)
        manifest["environment"].update(
            gpu=properties.name, gpuTotalVramBytes=properties.total_memory,
            gpuFreeVramBeforeLoadBytes=free_vram, cudaReportedTotalVramBytes=total_vram,
            computeCapability=list(torch.cuda.get_device_capability(0)),
            torch= torch.__version__, cuda=torch.version.cuda,
            torchCudaArchitectures=torch.cuda.get_arch_list(),
            cpuThreads=torch.get_num_threads(), interopThreads=torch.get_num_interop_threads(),
            cudaModuleLoading=os.environ.get("CUDA_MODULE_LOADING", "default"),
            cudaVisibleDevices=os.environ.get("CUDA_VISIBLE_DEVICES", "default"))
        manifest["stage"] = "model-load"
        write_json(manifest_path, manifest)
        load_started = time.perf_counter()
        print(f"LOAD {args.model_path} placement={manifest['request']['placement']}", flush=True)
        pipe = StableAudioPipeline.from_pretrained(
            str(args.model_path), torch_dtype=torch.float16, local_files_only=True,
            use_safetensors=True, low_cpu_mem_usage=True)
        if args.cpu_offload:
            pipe.enable_model_cpu_offload()
        else:
            pipe.to("cuda")
        torch.cuda.synchronize()
        if pipe.vae.config.sampling_rate != SAMPLE_RATE or pipe.vae.config.audio_channels != CHANNELS:
            raise ValueError("Loaded VAE does not match expected 44.1 kHz stereo Stable Audio Open 1.0")
        manifest["lastModelLoadSeconds"] = round(time.perf_counter() - load_started, 3)
        manifest["environment"]["scheduler"] = type(pipe.scheduler).__name__
        manifest["environment"]["attentionProcessors"] = sorted({type(value).__name__ for value in pipe.transformer.attn_processors.values()})
        manifest.update(status="running", stage="generation")
        write_json(manifest_path, manifest)
        print(f"LOADED {manifest['lastModelLoadSeconds']} seconds", flush=True)
        for run_id, category, seed, raw_path in pending:
            active_run = {"id": run_id, "category": category["id"], "label": category["label"],
                          "prompt": category["prompt"], "negativePrompt": definitions["negativePrompt"],
                          "seed": seed, "requestedDurationSeconds": args.duration, "steps": args.steps,
                          "status": "running", "startedAt": timestamp(), "rawPath": str(raw_path),
                          "listeningAcceptance": "pending"}
            manifest["runs"].append(active_run)
            write_json(manifest_path, manifest)
            started = time.perf_counter()
            torch.cuda.reset_peak_memory_stats()
            torch.cuda.synchronize()
            started = time.perf_counter()
            print(f"GENERATE {run_id}", flush=True)
            generator = torch.Generator(device="cuda").manual_seed(seed)
            with torch.inference_mode():
                batch = pipe(
                    prompt=category["prompt"], negative_prompt=definitions["negativePrompt"],
                    audio_start_in_s=0.0, audio_end_in_s=args.duration,
                    num_inference_steps=args.steps, guidance_scale=GUIDANCE_SCALE,
                    num_waveforms_per_prompt=1, generator=generator, output_type="np").audios
            torch.cuda.synchronize()
            elapsed = time.perf_counter() - started
            active_run.update(generationSeconds=round(elapsed, 3),
                              realTimeFactor=round(elapsed / args.duration, 3), **gpu_peaks(torch))
            batch = np.asarray(batch, dtype=np.float32)
            if batch.ndim != 3 or batch.shape[0] != 1 or batch.shape[1] != CHANNELS:
                dump_path = raw_path.with_suffix(".pipeline.npy")
                with dump_path.open("xb") as stream:
                    np.save(stream, batch, allow_pickle=False)
                active_run.update(outputDumpPath=str(dump_path), outputDumpSha256=sha256_file(dump_path))
                raise ValueError(f"Unexpected pipeline output shape {batch.shape}; preserved diagnostic NPY")
            # Reorder axes only. Save even invalid/nonfinite audio before validation.
            audio = np.ascontiguousarray(batch[0].T)
            with raw_path.open("xb") as stream:
                wavfile.write(stream, SAMPLE_RATE, audio)
            active_run.update(rawSha256=sha256_file(raw_path), encoding="IEEE_FLOAT32",
                              sampleFrames=len(audio), actualDurationSeconds=len(audio) / SAMPLE_RATE,
                              sampleRate=SAMPLE_RATE, channels=CHANNELS)
            if len(audio) != int(args.duration * SAMPLE_RATE):
                raise ValueError(f"Unexpected sample frames: {len(audio)}; expected {int(args.duration * SAMPLE_RATE)}")
            if not np.isfinite(audio).all() or not np.any(audio):
                raise ValueError("Generated waveform must be finite and nonzero; invalid raw WAV preserved")
            active_run.update(status="generated", completedAt=timestamp())
            write_json(manifest_path, manifest)
            print(f"GENERATED {run_id} {elapsed:.2f}s peak allocated {active_run.get('peakVramAllocatedBytes', 0) / 2**30:.2f}GiB", flush=True)
            active_run = None
            started = None
        manifest.update(status="completed", stage="completed", completedAt=timestamp())
        write_json(manifest_path, manifest)
        print(f"MANIFEST {manifest_path}", flush=True)
    except BaseException as error:
        failure = {"stage": manifest["stage"], "errorType": type(error).__name__,
                   "error": str(error), "failedAt": timestamp()}
        if active_run is not None:
            active_run.update(status="failed", **failure)
            if started is not None:
                active_run.setdefault("generationSeconds", round(time.perf_counter() - started, 3))
            if torch is not None:
                active_run.update(gpu_peaks(torch))
        manifest.update(status="failed", lastFailure=failure)
        write_json(manifest_path, manifest)
        raise


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        definitions, categories, seeds, contract = validate_request(args)
        manifest, pending = prepare_manifest(args, definitions, categories, seeds, contract)
        if not pending:
            print(f"PRESERVED MANIFEST {args.artifact_root / 'generation-manifest.json'}", flush=True)
            return 0
        supervisor = bounded_launch()
        generate(args, definitions, manifest, pending, supervisor)
        return 0
    except (Exception, KeyboardInterrupt):
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
