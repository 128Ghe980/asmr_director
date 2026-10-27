"""Prepare two continuous source prefixes; CPU FFmpeg only, no TTS/ASR.

Reuses the float-first, explicit L/R average and 64-tap resampling procedure
from the existing yukinoshita-diagnosis/finalize_comparison.py experiment.
"""
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

import numpy as np


QA = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26")
ROOT = QA / "followup-2026-10-27/yukino-length"
FF = Path("D:/CodexWorkplace/asmr_director_runtime/engines/gpt-sovits/env-comfyui-clone/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe")
SOURCE = Path("H:/comfyui/output/sd2素材/干音/1163516765-1-160.mp4")
PREVIOUS = QA / "followup-2026-10-27/yukinoshita-diagnosis/quality-preserving/01_source_original_44100_stereo_float.wav"
RATE = 44100
COMMANDS = []


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def identity(path):
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": digest(path)}


def run(args, data=None):
    cmd = [str(FF), "-nostdin", "-hide_banner", "-loglevel", "error", *args]
    result = subprocess.run(cmd, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
    COMMANDS.append({"command": cmd, "exit_code": result.returncode,
                     "stdin_bytes": len(data) if data is not None else None,
                     "stdin_sha256": hashlib.sha256(data).hexdigest() if data is not None else None,
                     "stderr": result.stderr.decode("utf-8", "replace")})
    if result.returncode:
        raise RuntimeError(COMMANDS[-1]["stderr"])
    return result.stdout


def db(value):
    return 20 * math.log10(value) if value else None


def metrics(values, rate):
    a = values.astype(np.float64)
    peak = float(np.max(np.abs(a)))
    rms = float(np.sqrt(np.mean(a * a)))
    return {"frames": len(a), "sample_rate": rate, "channels": a.shape[1],
            "duration_seconds": len(a) / rate, "peak": peak, "peak_dbfs": db(peak),
            "rms": rms, "rms_dbfs": db(rms),
            "samples_at_or_above_full_scale": int(np.count_nonzero(np.abs(a) >= 1)),
            "all_samples_zero": bool(not np.any(a))}


def read_float(path, rate, channels):
    raw = run(["-i", str(path), "-map", "0:a:0", "-ar", str(rate), "-ac", str(channels),
               "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"])
    return np.frombuffer(raw, dtype="<f4").reshape(-1, channels)


def write_float_input(path, values, rate, codec, gain=1.0):
    raw = values.astype("<f4").tobytes()
    run(["-f", "f32le", "-ar", str(rate), "-ac", str(values.shape[1]), "-i", "pipe:0",
         "-af", f"volume={gain:.15g}:precision=double", "-c:a", codec, "-n", str(path)], raw)


def safe_gain(values, width):
    # One quantization step below -1 dBFS prevents PCM rounding above it.
    scale = 2 ** (8 * width - 1)
    target = (math.floor(10 ** (-1 / 20) * scale) - 1) / scale
    return min(1.0, target / float(np.max(np.abs(values))))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ROOT.mkdir(parents=True, exist_ok=True)
    for name in ("references", "source-previews", "analysis"):
        (ROOT / name).mkdir(exist_ok=True)
    if (ROOT / "preparation.json").exists():
        raise FileExistsError("Preparation evidence already exists; refusing overwrite")
    source_before = identity(SOURCE)
    previous_before = identity(PREVIOUS)
    raw = run(["-i", str(SOURCE), "-map", "0:a:0", "-vn", "-ss", "0", "-t", "26.2",
               "-ar", str(RATE), "-ac", "2", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"])
    decoded = np.frombuffer(raw, dtype="<f4").reshape(-1, 2)
    # FFmpeg's final resampling flush can add a few frames; use exact sample ranges.
    original = decoded[:round(26.2 * RATE)]
    old = read_float(PREVIOUS, RATE, 2)
    prefix_equal = len(old) == round(6.85 * RATE) and np.array_equal(original[:len(old)], old)
    if not prefix_equal:
        raise ValueError("Decoded opening does not exactly match the prior 0-6.85s float source")
    float_path = ROOT / "analysis/source-prefix-26p2s-float.wav"
    write_float_input(float_path, original, RATE, "pcm_f32le")
    source_asr_path = QA / "source-asr.json"
    asr = json.loads(source_asr_path.read_text(encoding="utf-8"))["files"][0]["segments"]
    nonzero = np.flatnonzero(np.any(original != 0, axis=1))
    rows = []
    for end, label, sentence_count in ((17.3, "17p30s", 3), (25.1, "25p10s", 4)):
        count = round(end * RATE)
        source = original[:count]
        around = original[count-round(.1*RATE):count+round(.1*RATE)]
        if np.any(around):
            raise ValueError(f"Boundary {end} is not the verified silent interval")
        before = nonzero[nonzero < count]
        after = nonzero[nonzero >= count]
        quiet_begin = (int(before[-1])+1)/RATE if len(before) else 0
        quiet_end = int(after[0])/RATE if len(after) else len(original)/RATE
        name = "yukinoshita-160-" + label + ".wav"
        preview_path, model_path = ROOT / "source-previews" / name, ROOT / "references" / name
        preview_gain = safe_gain(source, 3)
        write_float_input(preview_path, source, RATE, "pcm_s24le", preview_gain)
        model_raw = run(["-f", "f32le", "-ar", str(RATE), "-ac", "2", "-i", "pipe:0", "-af",
                         "pan=mono|c0=0.5*c0+0.5*c1,aresample=16000:filter_size=64:phase_shift=10:cutoff=0.97",
                         "-ar", "16000", "-ac", "1", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"],
                        source.astype("<f4").tobytes())
        model = np.frombuffer(model_raw, dtype="<f4").reshape(-1, 1)[:round(end * 16000)]
        if len(model) != round(end * 16000):
            raise ValueError("Resampling returned insufficient frames")
        model_gain = safe_gain(model, 2)
        write_float_input(model_path, model, 16000, "pcm_s16le", model_gain)
        preview_metrics = metrics(read_float(preview_path, RATE, 2), RATE)
        model_metrics = metrics(read_float(model_path, 16000, 1), 16000)
        for value in (preview_metrics, model_metrics):
            if value["duration_seconds"] != end or value["peak"] > 10**(-1/20) or value["samples_at_or_above_full_scale"]:
                raise ValueError("Output duration or safety gain verification failed")
        row = {"id": "yukinoshita-160-" + label,
               "range": {"start_seconds": 0, "end_seconds": end, "source_start_frame_44100": 0,
                         "source_end_frame_exclusive_44100": count, "continuous": True},
               "boundary": {"window_start_seconds": end-.1, "window_end_seconds": end+.1,
                            "window_metrics": metrics(around, RATE),
                            "exact_zero_run_start_seconds": quiet_begin, "exact_zero_run_end_seconds": quiet_end,
                            "boundary_adjusted": False},
               "model": {**identity(model_path), "codec": "pcm_s16le", "metrics": model_metrics},
               "source_preview": {**identity(preview_path), "codec": "pcm_s24le", "metrics": preview_metrics},
               "model_before_gain_metrics": metrics(model, 16000), "source_before_gain_metrics": metrics(source, RATE),
               "model_static_gain": model_gain, "model_static_gain_db": db(model_gain),
               "preview_static_gain": preview_gain, "preview_static_gain_db": db(preview_gain),
               "original_first_6p85s_float_exact_match": prefix_equal,
               "draft_prompt_text_from_prior_asr": "".join(segment["text"] for segment in asr[:sentence_count]),
               "draft_prompt_needs_new_asr": True, "prior_asr_segments": asr[:sentence_count]}
        rows.append(row)
        print(json.dumps({"event": "reference_ready", "id": row["id"], "model": str(model_path),
                          "duration_seconds": end, "preview": str(preview_path)}, ensure_ascii=False), flush=True)
    report = {"status": "prepared", "prepared_at": datetime.now(timezone.utc).isoformat(),
              "source": source_before, "source_unchanged": digest(SOURCE)==source_before["sha256"],
              "previous_float_source": previous_before, "previous_float_source_unchanged": digest(PREVIOUS)==previous_before["sha256"],
              "prior_asr": identity(source_asr_path), "script": identity(Path(__file__)), "ffmpeg": identity(FF),
              "numpy_version": np.__version__, "source_prefix_float": {**identity(float_path), "metrics": metrics(original,RATE)},
              "decoder_returned_frames": len(decoded), "retained_source_prefix_frames": len(original),
              "references": rows, "commands": COMMANDS, "tts_runs": 0, "asr_runs": 0, "gpu_runs": 0,
              "notes": ["Continuous source prefixes; no concatenation or speech-speed/pitch change.",
                        "Float AAC overshoots retained before static gain; no denoise, EQ, limiter or dynamic normalization.",
                        "Separate fixed attenuation for stereo preview and resampled mono model input; no amplification.",
                        "Only one shared float prefix retained as auxiliary evidence; no temporary duplicates.",
                        "RMS/peak null for an all-zero window means negative infinity dBFS, not unavailable.",
                        "ASR transcript is a draft only; root will re-transcribe these prepared files."]}
    with (ROOT / "preparation.json").open("x", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write("\n")
    print(json.dumps({"event": "prepared", "receipt": str(ROOT/"preparation.json"),
                      "source_unchanged": report["source_unchanged"]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
