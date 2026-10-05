"""Generate isolated AudioLDM2 candidates through a public remote demonstration.

This never adopts audio into the product. Remote timing includes queue and download;
it is not a measurement of local GPU inference. The demo does not pin its weights.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import io
import json
from pathlib import Path
import time
import traceback


SPACE = "fffiloni/audioldm2-text2audio-text2music-API"
HOST = "https://fffiloni-audioldm2-text2audio-text2music-api.hf.space"
SOURCE_URL = f"https://huggingface.co/spaces/{SPACE}"
REVISION = "Space does not disclose or pin the loaded model weight revision"
TIMING = "request total includes API submission, remote queue/inference and file download; not GPU inference time"
STEPS = 200


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def inspect_waveform(content: bytes, duration: float) -> dict:
    import numpy as np
    import soundfile as sf

    if content[:4] != b"RIFF" or content[8:12] != b"WAVE":
        raise ValueError("Returned generated artifact is not a WAV file")
    audio, sample_rate = sf.read(io.BytesIO(content), dtype="float32", always_2d=True)
    info = sf.info(io.BytesIO(content))
    if sample_rate != 16000 or audio.shape != (round(duration * 16000), 1):
        raise ValueError(f"Unexpected generated shape/rate: {audio.shape} / {sample_rate}")
    if not np.all(np.isfinite(audio)) or not np.any(audio):
        raise ValueError("Generated waveform must be finite nonzero audio")
    return {"sampleRate": sample_rate, "channels": 1, "frames": len(audio),
            "actualDurationSeconds": len(audio) / sample_rate, "subtype": info.subtype,
            "rawBytes": len(content), "rawSha256": hashlib.sha256(content).hexdigest(),
            "peakAmplitude": float(np.max(np.abs(audio))),
            "rmsDbfs": float(20 * np.log10(np.sqrt(np.mean(audio.astype(np.float64) ** 2)) + 1e-20)),
            "clippedSamples": int(np.count_nonzero(np.abs(audio) >= 0.9999))}


def validate_previous(previous: dict, category: dict, negative: str, raw_path: Path) -> None:
    if previous["prompt"] != category["prompt"] or previous["negativePrompt"] != negative:
        raise ValueError("Prompt changed: use a new artifact root to preserve this experiment")
    if previous.get("steps") != STEPS or previous.get("guidanceScale", 3.5) != 3.5:
        raise ValueError("Generation settings changed: use a new artifact root")
    if previous["status"] == "generated":
        if Path(previous["rawPath"]).resolve() != raw_path.resolve():
            raise ValueError("Recorded raw path differs from this artifact root")
        if hashlib.sha256(raw_path.read_bytes()).hexdigest() != previous["rawSha256"]:
            raise ValueError(f"Recorded raw audio changed: {raw_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--prompts", type=Path, default=Path(__file__).with_name("prompts.json"))
    parser.add_argument("--categories", nargs="+")
    parser.add_argument("--seeds", nargs="+", type=int)
    parser.add_argument("--duration", type=float, default=8)
    parser.add_argument("--full-matrix", action="store_true",
                        help="Four categories x three seeds x 8s, then brush x three seeds x 15s and massage x first seed x 15s")
    parser.add_argument("--reuse-smoke-receipt", type=Path,
                        help="Import one verified prior generation without repeating the remote request")
    parser.add_argument("--request-timeout", type=float, default=240)
    args = parser.parse_args()
    if not 5 <= args.duration <= 15 or args.request_timeout <= 0:
        raise ValueError("Public demo supports 5–15 seconds; request timeout must be positive")
    definitions = json.loads(args.prompts.read_text(encoding="utf-8"))
    categories = definitions["categories"]
    category_by_id = {item["id"]: item for item in categories}
    if args.categories:
        unknown = set(args.categories) - set(category_by_id)
        if unknown:
            raise ValueError(f"Unknown categories: {sorted(unknown)}")
        categories = [category_by_id[key] for key in args.categories]
    seeds = args.seeds or definitions["seeds"]
    if len(seeds) != len(set(seeds)):
        raise ValueError("Seeds must be unique")
    if args.full_matrix and (args.categories or args.seeds or args.duration != 8):
        raise ValueError("Full matrix uses the four current categories, defined seeds and 8/15 seconds")
    planned = [(category, seed, args.duration) for category in categories for seed in seeds]
    if args.full_matrix:
        planned.extend((category_by_id["ear_brushing"], seed, 15.0) for seed in seeds)
        planned.append((category_by_id["massage"], seeds[0], 15.0))
    negative = definitions["negativePrompt"]
    root = args.artifact_root.resolve()
    raw_root, receipts_root = root / "raw", root / "receipts"
    raw_root.mkdir(parents=True, exist_ok=True)
    receipts_root.mkdir(parents=True, exist_ok=True)
    manifest_path = root / "generation-manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if (manifest["model"]["id"] != "cvssp/audioldm2" or
                manifest["model"]["revision"] != REVISION or
                manifest["environment"]["execution"] != "remote" or
                manifest["environment"]["sourceUrl"] != SOURCE_URL):
            raise ValueError("Use a new artifact root for a different model or execution source")
    else:
        manifest = {
            "schemaVersion": 1,
            "model": {"id": "cvssp/audioldm2", "revision": REVISION,
                      "license": "CC-BY-NC-SA-4.0", "sampleRate": 16000, "channels": 1,
                      "source": "https://huggingface.co/cvssp/audioldm2", "weightsPath": None},
            "environment": {"execution": "remote", "sourceUrl": SOURCE_URL, "host": HOST,
                            "timing": TIMING, "gpu": None, "torch": None, "cuda": None,
                            "dependencies": {name: importlib.metadata.version(name)
                                             for name in ("requests", "numpy", "soundfile")},
                            "precision": "float16 according to public demo source",
                            "offload": None, "attention": None, "scheduler": "DDIMScheduler",
                            "steps": STEPS, "guidanceScale": 3.5, "waveformsPerPrompt": 1},
            "notes": ["Experimental noncommercial candidates; listening acceptance pending.",
                      "Remote public demo; no local GPU runtime or VRAM claim.",
                      "Each raw file comes from actual model generation. No looping, stitching, denoising or spatial processing.",
                      "Remote model weights are not pinned; identical API inputs do not promise byte-identical future outputs."],
            "runs": [], "attemptHistory": [],
        }

    import requests

    session = requests.Session()
    session.trust_env = False
    metadata_response = session.get(f"https://huggingface.co/api/spaces/{SPACE}", timeout=25)
    metadata_response.raise_for_status()
    metadata = metadata_response.json()
    if metadata.get("private") or metadata.get("runtime", {}).get("stage") != "RUNNING":
        raise RuntimeError("Public demonstration must be RUNNING and public")
    config_response = session.get(HOST + "/config", timeout=25)
    config_response.raise_for_status()
    config = config_response.json()
    if config.get("auth_required") or not any(
            item.get("api_name") == "text2audio" and item.get("api_visibility") == "public"
            for item in config.get("dependencies", [])):
        raise RuntimeError("The generation endpoint is not a public unauthenticated API")
    if config.get("version") != "6.14.0":
        raise RuntimeError("Demo version changed: review its API and source before a new experiment")
    previous_revision = manifest["environment"].get("spaceRevision")
    if previous_revision and previous_revision != metadata["sha"]:
        raise ValueError("Demo source revision changed: use a new artifact root after reviewing it")
    source_response = session.get(f"https://huggingface.co/spaces/{SPACE}/raw/{metadata['sha']}/app.py", timeout=25)
    source_response.raise_for_status()
    if 'repo_id = "cvssp/audioldm2"' not in source_response.text or "num_inference_steps=200" not in source_response.text:
        raise RuntimeError("Demo source model/settings changed: review before generating")
    source_snapshot = receipts_root / f"space-source-{metadata['sha']}.py.txt"
    if source_snapshot.exists():
        if source_snapshot.read_bytes() != source_response.content:
            raise ValueError("Recorded demo source snapshot changed")
    else:
        source_snapshot.write_bytes(source_response.content)
    manifest["environment"].update(spaceRevision=metadata["sha"],
                                   appSourceSha256=hashlib.sha256(source_response.content).hexdigest(),
                                   runtime=metadata.get("runtime"), gradio=config.get("version"))
    write_json(manifest_path, manifest)
    smoke = json.loads(args.reuse_smoke_receipt.read_text(encoding="utf-8")) if args.reuse_smoke_receipt else None

    for index, (category, seed, duration) in enumerate(planned):
        run_id = f"{category['id']}-s{seed}-{duration:g}s-{STEPS}steps"
        raw_path = raw_root / f"{run_id}.wav"
        previous = next((item for item in manifest["runs"] if item["id"] == run_id), None)
        if previous:
            validate_previous(previous, category, negative, raw_path)
            if previous["status"] == "generated":
                print(f"PRESERVED {run_id}", flush=True)
                continue
        if raw_path.exists():
            raise FileExistsError(f"Refusing to overwrite existing raw audio: {raw_path}")
        attempt = 1 + sum(item["id"] == run_id for item in manifest["attemptHistory"])
        if previous:
            manifest["attemptHistory"].append({**previous, "supersededAt": now()})
            attempt += 1
        receipt_path = receipts_root / f"{run_id}-attempt-{attempt:02d}.json"
        if receipt_path.exists():
            raise FileExistsError(f"Refusing to overwrite an existing job receipt: {receipt_path}")
        run = {"id": run_id, "category": category["id"], "label": category["label"],
               "prompt": category["prompt"], "negativePrompt": negative, "seed": seed,
               "requestedDurationSeconds": duration, "steps": STEPS, "guidanceScale": 3.5,
               "status": "running", "startedAt": now(), "rawPath": str(raw_path),
               "listeningAcceptance": "pending", "execution": "remote", "timing": TIMING,
               "peakVramAllocatedBytes": None, "peakVramReservedBytes": None,
               "receiptPath": str(receipt_path), "attempt": attempt}
        manifest["runs"] = [item for item in manifest["runs"] if item["id"] != run_id] + [run]
        receipt = {**run, "space": SPACE, "sourceUrl": SOURCE_URL, "spaceRevision": metadata["sha"],
                   "modelId": "cvssp/audioldm2", "modelRevision": REVISION, "apiName": "text2audio",
                   "apiData": [category["prompt"], negative, duration, 3.5, seed, 1], "events": []}
        write_json(receipt_path, receipt)
        write_json(manifest_path, manifest)
        started = time.perf_counter()
        print(f"GENERATE_REMOTE {run_id}", flush=True)
        try:
            reuse = (smoke and smoke.get("status") == "generated" and
                     smoke.get("category") == category["id"] and smoke.get("seed") == seed and
                     smoke.get("requestedDurationSeconds") == duration and
                     smoke.get("prompt") == category["prompt"] and smoke.get("negativePrompt") == negative and
                     smoke.get("steps") == STEPS and smoke.get("spaceRevision") == metadata["sha"])
            if reuse:
                content = Path(smoke["rawPath"]).read_bytes()
                if hashlib.sha256(content).hexdigest() != smoke["rawSha256"]:
                    raise ValueError("Prior smoke audio does not match its receipt SHA256")
                elapsed = smoke["wallSeconds"]
                receipt.update(importedFromReceipt=str(args.reuse_smoke_receipt.resolve()),
                               originalStartedAt=smoke["startedAt"], eventId=smoke["eventId"],
                               output=smoke["output"], events=smoke["events"],
                               timing="original smoke wall time includes metadata/source fetch, submission, remote queue/inference and download; not GPU time")
            else:
                response = session.post(HOST + "/gradio_api/call/text2audio",
                                        json={"data": receipt["apiData"]}, timeout=30)
                receipt["submitHttpStatus"] = response.status_code
                receipt["submitResponse"] = response.json()
                write_json(receipt_path, receipt)
                response.raise_for_status()
                event_id = response.json()["event_id"]
                receipt.update(eventId=event_id, submittedAfterSeconds=round(time.perf_counter() - started, 3))
                write_json(receipt_path, receipt)
                print(f"REMOTE_JOB {run_id} {event_id}", flush=True)
                completed = None
                with session.get(HOST + "/gradio_api/call/text2audio/" + event_id,
                                 stream=True, timeout=(15, 45)) as events_response:
                    receipt["eventsHttpStatus"] = events_response.status_code
                    write_json(receipt_path, receipt)
                    events_response.raise_for_status()
                    event_type = ""
                    for line in events_response.iter_lines(decode_unicode=True):
                        if time.perf_counter() - started > args.request_timeout:
                            raise TimeoutError("Remote request deadline exceeded; no further requests will be submitted")
                        if line.startswith("event:"):
                            event_type = line[6:].strip()
                        elif line.startswith("data:"):
                            data = json.loads(line[5:].strip())
                            receipt["events"].append({"event": event_type, "data": data,
                                                      "elapsedSeconds": round(time.perf_counter() - started, 3)})
                            write_json(receipt_path, receipt)
                            if event_type == "error":
                                raise RuntimeError("Remote generation error; stopping without bypass/retry: " + json.dumps(data))
                            if event_type == "complete":
                                completed = data
                                break
                if not completed:
                    raise RuntimeError("No complete result from actual model generation")
                output = completed[0]
                receipt["output"] = output
                write_json(receipt_path, receipt)
                url = output.get("url") if isinstance(output, dict) else None
                if not url or not url.startswith(HOST + "/"):
                    raise RuntimeError("Generated-file URL must be on the public demo host")
                response = session.get(url, timeout=45)
                response.raise_for_status()
                content = response.content
                elapsed = time.perf_counter() - started
            metrics = inspect_waveform(content, duration)
            with raw_path.open("xb") as handle:
                handle.write(content)
            run.update(status="generated", generationSeconds=round(elapsed, 3),
                       realTimeFactor=round(elapsed / duration, 3), completedAt=now(),
                       eventId=receipt["eventId"], timing=receipt.get("timing", TIMING), **metrics)
            if reuse:
                run["importedFromReceipt"] = receipt["importedFromReceipt"]
            receipt.update(run)
            write_json(receipt_path, receipt)
            write_json(manifest_path, manifest)
            print(f"GENERATED_REMOTE {run_id} {elapsed:.2f}s", flush=True)
        except Exception as error:
            run.update(status="failed", errorType=type(error).__name__, error=str(error),
                       generationSeconds=round(time.perf_counter() - started, 3), failedAt=now())
            receipt.update(run)
            write_json(receipt_path, receipt)
            write_json(manifest_path, manifest)
            traceback.print_exc()
            raise
        next_group = planned[index + 1][0]["id"] if index + 1 < len(planned) else None
        next_duration = planned[index + 1][2] if index + 1 < len(planned) else None
        if next_group != category["id"] or next_duration != duration:
            print(f"GROUP_COMPLETE {category['id']} {duration:g}s", flush=True)
    print(f"MANIFEST {manifest_path}", flush=True)


if __name__ == "__main__":
    main()
