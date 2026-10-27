"""Serial VoxCPM2 listening runs with immutable take receipts.

Inputs and the production profile are read-only. A failed/interrupted take is
retained; another invocation creates a new take. Successful identical requests
resume only after the output and log SHA256 hashes have been verified.
Reference-only is the default; combined requires an explicit exact transcript.
"""
from __future__ import annotations

import argparse
from array import array
from contextlib import contextmanager
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid
import wave


DEFAULT_PROFILE = Path("D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/voxcpm2/profile.json")
RUNTIME_LOCK = Path("D:/CodexWorkplace/asmr_director_runtime/locks/voxcpm2-generation.lock")
TIMEOUT_SECONDS = 900
ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")
OOM_PATTERN = re.compile(
    r"out[ -]of[ -]memory|cudaErrorMemoryAllocation|CUDA_ERROR_OUT_OF_MEMORY|"
    r"CUBLAS_STATUS_ALLOC_FAILED|failed to allocate|cannot allocate memory|"
    r"memory allocation failure|"
    r"std::bad_alloc|not enough (?:memory|storage)|paging file is too small",
    re.IGNORECASE,
)
FATAL_CUDA_PATTERN = re.compile(r"CUBLAS_STATUS_NOT_INITIALIZED", re.IGNORECASE)
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def now():
    return datetime.now(timezone.utc).isoformat()


def emit(**value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_new_json(path, value):
    with Path(path).open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def identity(path):
    path = Path(path).resolve(strict=True)
    if not path.is_file():
        raise ValueError(f"Expected a file: {path}")
    stat = path.stat()
    return {"path": str(path), "bytes": stat.st_size, "sha256": sha256(path)}


def resolve_input(value, parent):
    path = Path(value)
    return (path if path.is_absolute() else parent / path).resolve(strict=True)


def check_no_native_process():
    if os.name != "nt":
        raise RuntimeError("This runtime harness requires Windows tasklist for its process preflight")
    result = subprocess.run(
        ["tasklist.exe", "/FO", "CSV", "/NH"], stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=True, timeout=30, creationflags=CREATE_NO_WINDOW,
    )
    # Image names and PIDs are ASCII; unrelated localized columns are ignored.
    rows = csv.reader(io.StringIO(result.stdout.decode("utf-8", errors="replace")))
    active = [{"image": row[0], "pid": row[1]} for row in rows
              if len(row) > 1 and row[0].lower().startswith("voxcpm2-cli")]
    if active:
        raise RuntimeError("Another VoxCPM2 CLI is running: " + json.dumps(active))


@contextmanager
def batch_lock(output):
    path = output / ".reference-listening.lock"
    # Never guess that an existing lock is stale or remove another run's lock.
    with path.open("x", encoding="utf-8") as stream:
        json.dump({"pid": os.getpid(), "created_at": now()}, stream)
    try:
        yield
    finally:
        path.unlink()


@contextmanager
def runtime_lock():
    RUNTIME_LOCK.parent.mkdir(parents=True, exist_ok=True)
    stream = RUNTIME_LOCK.open("x+", encoding="utf-8")
    inode = os.fstat(stream.fileno())
    owner = {"ownerPid": os.getpid(), "ownerToken": str(uuid.uuid4()),
             "childPid": None, "childPids": [], "createdAt": now()}
    child_alive = False

    def record(pid):
        nonlocal child_alive
        # Set before I/O: an owner-record failure must not release a live child.
        child_alive = pid is not None
        owner.update(childPid=pid, childPids=[pid] if pid is not None else [])
        stream.seek(0)
        stream.write(json.dumps(owner).ljust(1024))
        stream.truncate()
        stream.flush()
        os.fsync(stream.fileno())

    try:
        record(None)
        yield record
    finally:
        stream.close()
        if not child_alive and RUNTIME_LOCK.exists():
            current = RUNTIME_LOCK.stat()
            if (current.st_dev, current.st_ino) == (inode.st_dev, inode.st_ino):
                if read_json(RUNTIME_LOCK).get("ownerToken") == owner["ownerToken"]:
                    RUNTIME_LOCK.unlink()


def wav_metrics(path):
    """Measure PCM WAV across all channels; no normalization or audio edits."""
    with wave.open(str(path), "rb") as audio:
        channels, width, rate, frames = (
            audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()
        )
        if audio.getcomptype() != "NONE" or width not in (1, 2, 3, 4):
            raise ValueError("Only uncompressed 8/16/24/32-bit integer PCM WAV is supported")
        if frames == 0 or rate <= 0 or channels <= 0:
            raise ValueError("WAV contains no usable audio")
        scale = 1 << (width * 8 - 1)
        total = clipped = 0
        peak = squares = 0.0
        while True:
            block = audio.readframes(65536)
            if not block:
                break
            if len(block) % (width * channels):
                raise ValueError("WAV contains a partial PCM frame")
            if width == 1:
                values = (sample - 128 for sample in block)
            elif width == 3:
                values = (int.from_bytes(block[index:index + 3], "little", signed=True)
                          for index in range(0, len(block), 3))
            else:
                values = array("h" if width == 2 else "i")
                values.frombytes(block)
                if sys.byteorder != "little":
                    values.byteswap()
            for sample in values:
                normalized = sample / scale
                peak = max(peak, abs(normalized))
                squares += normalized * normalized
                clipped += sample <= -scale or sample >= scale - 1
                total += 1
        if total != frames * channels:
            raise ValueError(f"Truncated WAV: expected {frames * channels} samples, read {total}")
        rms = math.sqrt(squares / total)
        return {
            "sample_rate": rate, "channels": channels, "sample_width_bytes": width,
            "frames": frames, "duration_seconds": round(frames / rate, 6),
            "peak": peak, "peak_dbfs": 20 * math.log10(peak) if peak else None,
            "rms": rms, "rms_dbfs": 20 * math.log10(rms) if rms else None,
            "clipped_samples": clipped, "clipping_fraction": clipped / total,
            "generated_steps_at_48khz": frames / 7680 if rate == 48000 else None,
            "max_steps_reached": rate == 48000 and frames >= 600 * 7680,
        }


def manifest_cfg(manifest):
    value = manifest.get("cfg", 2)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 1 <= value <= 3:
        raise ValueError("cfg must be a number between 1 and 3")
    # Preserve the original integer 2 in request JSON and CLI arguments, even
    # when a manifest spells it 2.0, so default request hashes stay compatible.
    return int(value) if value == int(value) else value


def manifest_timesteps(manifest):
    value = manifest.get("timesteps", 10)
    if isinstance(value, bool) or not isinstance(value, int) or not 4 <= value <= 30:
        raise ValueError("timesteps must be an integer between 4 and 30")
    return value


def reference_options(reference):
    mode = reference.get("mode", "reference_only")
    if mode not in ("reference_only", "combined"):
        raise ValueError("reference mode must be reference_only or combined")
    if mode == "combined":
        prompt = reference.get("promptText")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("combined reference requires a nonempty exact promptText")
        return {"mode": mode, "promptText": prompt}
    # Do not add keys to legacy reference-only requests: their hashes are used
    # to resume existing completed takes.
    return {}


def load_inputs(manifest_path, profile_path):
    manifest, profile = read_json(manifest_path), read_json(profile_path)
    manifest_cfg(manifest)
    manifest_timesteps(manifest)
    seed = manifest.get("seed", 42)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 2147483647:
        raise ValueError("seed must be an integer between 0 and 2147483647")
    for key in ("references", "texts"):
        rows = manifest.get(key)
        if not isinstance(rows, list) or not rows:
            raise ValueError(f"manifest.{key} must be a nonempty list")
        seen = set()
        for row in rows:
            identifier = row.get("id")
            if not isinstance(identifier, str) or not ID_PATTERN.fullmatch(identifier):
                raise ValueError(f"{key} IDs must contain 1-64 ASCII letters, digits, underscores or hyphens")
            if identifier.casefold() in seen:
                raise ValueError(f"Duplicate {key} ID: {identifier}")
            seen.add(identifier.casefold())
            if key == "texts" and (not isinstance(row.get("text"), str) or not row["text"].strip()):
                raise ValueError(f"Text {identifier} is empty")
            if key == "references":
                reference_options(row)
    files = {}
    for key in ("cliPath", "baseModelPath", "acousticModelPath"):
        path = resolve_input(profile[key], profile_path.parent)
        emit(event="hashing", role=key, path=str(path))
        files[key] = identity(path)
    references = []
    for row in manifest["references"]:
        path = resolve_input(row["path"], manifest_path.parent)
        references.append({"id": row["id"], "name": row.get("name", row["id"]),
                           "file": identity(path), "metrics": wav_metrics(path), **reference_options(row)})
    return manifest, seed, files, references


def verified_previous(pair_dir, request_sha):
    for receipt_path in sorted(pair_dir.glob("take-*/receipt.json"), reverse=True):
        receipt = read_json(receipt_path)
        if receipt.get("status") != "complete" or receipt.get("request_sha256") != request_sha:
            continue
        for key in ("output", "stdout", "stderr"):
            file_info = receipt.get(key, {})
            path = Path(file_info.get("path", ""))
            if not path.is_file() or sha256(path) != file_info.get("sha256"):
                raise RuntimeError(f"Completed take failed {key} hash verification: {receipt_path}")
        wav_metrics(receipt["output"]["path"])
        return receipt_path
    return None


def next_take(pair_dir):
    pair_dir.mkdir(parents=True, exist_ok=True)
    index = 1
    while True:
        path = pair_dir / f"take-{index:03d}"
        try:
            path.mkdir()
            return path
        except FileExistsError:
            index += 1


def build_command(files, reference, text, seed, wav_path, cfg=2, timesteps=10):
    cfg = manifest_cfg({"cfg": cfg})
    timesteps = manifest_timesteps({"timesteps": timesteps})
    options = reference_options(reference)
    command = [files["cliPath"]["path"], "-t", text["text"], "-o", str(wav_path),
               "--steps", "600", "--timesteps", str(timesteps), "--cfg", str(cfg), "--temperature", "1",
               "--seed", str(seed), "--n-gpu-layers", "0", "--low-vram", "-r",
               reference["file"]["path"]]
    if options.get("mode") == "combined":
        command += ["--prompt-wav", reference["file"]["path"], "--prompt-text", options["promptText"]]
    return command + [files["baseModelPath"]["path"], files["acousticModelPath"]["path"]]


def classify_native_failure(log_text):
    oom = OOM_PATTERN.search(log_text)
    fatal_cuda = FATAL_CUDA_PATTERN.search(log_text)
    result = {"oom_detected": bool(oom), "fatal_cuda_detected": bool(fatal_cuda)}
    if oom:
        result["oom_marker"] = oom.group(0)
    if fatal_cuda:
        result["fatal_cuda_marker"] = fatal_cuda.group(0)
    return result


def batch_stop_reason(receipt):
    if receipt.get("oom_detected"):
        return "oom"
    if receipt.get("fatal_cuda_detected"):
        return "fatal_cuda"
    return None


def run_take(output, pair_dir, request, request_sha, files, reference, text, seed, lock_record):
    check_no_native_process()
    take = next_take(pair_dir)
    wav_path = take / "generated.wav"
    log_dir = output / "logs" / reference["id"] / text["id"] / take.name
    log_dir.mkdir(parents=True, exist_ok=False)
    stdout_path = log_dir / "stdout.log"
    stderr_path = log_dir / "stderr.log"
    command = build_command(files, reference, text, seed, wav_path,
                            request["parameters"]["cfg"], request["parameters"]["timesteps"])
    receipt = {"version": 1, "request": request, "request_sha256": request_sha,
               "command": command, "command_sha256": hashlib.sha256(canonical(command)).hexdigest(),
               "cwd": str(Path(command[0]).parent), "started_at": now(),
               "timeout_seconds": TIMEOUT_SECONDS, "exit_code": None, "status": "failed"}
    write_new_json(take / "request.json", receipt)
    env = dict(os.environ, TEMP=str(output / "tmp"), TMP=str(output / "tmp"),
               CUDA_CACHE_PATH=str(output / "cuda-cache"), PYTHONDONTWRITEBYTECODE="1",
               HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    start = time.perf_counter()
    interrupted = False
    emit(event="started", reference=reference["id"], text=text["id"], take=str(take))
    try:
        with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
            child = subprocess.Popen(command, cwd=receipt["cwd"], env=env,
                                     stdout=stdout, stderr=stderr, creationflags=CREATE_NO_WINDOW)
            receipt["pid"] = child.pid
            try:
                lock_record(child.pid)
                receipt["exit_code"] = child.wait(timeout=TIMEOUT_SECONDS)
            except BaseException:
                child.kill()
                receipt["exit_code"] = child.wait(timeout=30)
                raise
            finally:
                if child.poll() is not None:
                    lock_record(None)
    except subprocess.TimeoutExpired:
        receipt["error"] = "generation_timeout"
    except KeyboardInterrupt:
        receipt["error"] = "interrupted"
        interrupted = True
    except Exception as error:
        receipt["error"] = f"{type(error).__name__}: {error}"
    receipt.update(finished_at=now(), wall_seconds=round(time.perf_counter() - start, 3))
    log_text = ""
    for key, path in (("stdout", stdout_path), ("stderr", stderr_path)):
        if path.exists():
            receipt[key] = identity(path)
            log_text += path.read_text(encoding="utf-8", errors="replace") + "\n"
    receipt.update(classify_native_failure(log_text))
    if wav_path.exists():
        receipt["output"] = identity(wav_path)
        try:
            receipt["wav_metrics"] = wav_metrics(wav_path)
        except Exception as error:
            receipt["wav_error"] = f"{type(error).__name__}: {error}"
    stop_reason = batch_stop_reason(receipt)
    if receipt["exit_code"] == 0 and "error" not in receipt and "wav_metrics" in receipt and not stop_reason:
        receipt["status"] = "complete"
    elif "error" not in receipt:
        receipt["error"] = stop_reason or "native_generation_failed_or_invalid_wav"
    write_new_json(take / "receipt.json", receipt)
    emit(event="finished", reference=reference["id"], text=text["id"], status=receipt["status"],
         wall_seconds=receipt["wall_seconds"], oom_detected=receipt["oom_detected"],
         fatal_cuda_detected=receipt["fatal_cuda_detected"], receipt=str(take / "receipt.json"))
    if interrupted:
        raise KeyboardInterrupt
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True,
                        help="JSON: references [{id,name,path,mode?,promptText?}], texts [{id,text}], "
                             "seed (default 42), cfg (1-3, default 2), timesteps (4-30, default 10); "
                             "combined requires promptText")
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--profile", type=Path, default=DEFAULT_PROFILE)
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    manifest_path = args.manifest.resolve(strict=True)
    profile_path = args.profile.resolve(strict=True)
    check_no_native_process()
    output = args.output_root.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with batch_lock(output), runtime_lock() as lock_record:
        manifest, seed, files, references = load_inputs(manifest_path, profile_path)
        for name in ("logs", "tmp", "cuda-cache", "audio"):
            (output / name).mkdir(exist_ok=True)
        base = {"mode": "reference_only", "seed": seed, "files": files,
                "profile": identity(profile_path),
                "parameters": {"steps": 600, "timesteps": manifest_timesteps(manifest), "cfg": manifest_cfg(manifest),
                               "temperature": 1, "n_gpu_layers": 0, "low_vram": True}}
        counts = {"complete": 0, "skipped": 0, "failed": 0}
        for reference in references:
            for text in manifest["texts"]:
                request = dict(base, mode=reference.get("mode", "reference_only"),
                               reference=reference, text={"id": text["id"], "text": text["text"]})
                request_sha = hashlib.sha256(canonical(request)).hexdigest()
                pair_dir = output / "audio" / reference["id"] / text["id"]
                previous = verified_previous(pair_dir, request_sha)
                if previous:
                    counts["skipped"] += 1
                    emit(event="skipped", reference=reference["id"], text=text["id"], receipt=str(previous))
                    continue
                receipt = run_take(output, pair_dir, request, request_sha, files, reference, text, seed, lock_record)
                counts[receipt["status"]] += 1
                stop_reason = batch_stop_reason(receipt)
                if stop_reason:
                    emit(event="batch_stopped", reason=stop_reason, **counts)
                    return 2
        emit(event="batch_finished", output_root=str(output), **counts)
        return 1 if counts["failed"] else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        emit(event="batch_stopped", reason="interrupted")
        sys.exit(130)
    except Exception as error:
        emit(event="batch_stopped", reason=f"{type(error).__name__}: {error}")
        sys.exit(1)
