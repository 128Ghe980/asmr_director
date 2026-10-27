"""Prepare the entire user-supplied Yui MP3; CPU decode/resample only.

The filename is not a duration instruction. No seeking, duration limit,
sample slicing, padding, denoise, EQ, or speed/pitch processing is used.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

import numpy as np

from prepare_yukino_length_references import FF, db, digest, identity, metrics, safe_gain


ROOT = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27/reference-refinement")
SOURCE = Path("H:/comfyui/output/sd2素材/干音/由比滨25s.MP3")
MODEL = ROOT / "references/yuigahama-25s-full.wav"
PREVIEW = ROOT / "source-previews/yuigahama-25s-full.wav"
RECEIPT = ROOT / "new-yui-preparation.json"
COMMANDS = []


def run(args, data=None, probe=False):
    command = [str(FF), "-nostdin", "-hide_banner", "-loglevel", "info" if probe else "error",
               "-threads", "1", "-filter_threads", "1", *args]
    if "-ss" in command or "-t" in command or "-to" in command:
        raise ValueError("This preparation must process the full input")
    result = subprocess.run(command, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
    stderr = result.stderr.decode("utf-8", "replace")
    COMMANDS.append({"command": command, "exit_code": result.returncode,
                     "purpose": "metadata_probe_without_output" if probe else "audio_conversion_or_verification",
                     "stdin_bytes": len(data) if data is not None else None,
                     "stdin_sha256": hashlib.sha256(data).hexdigest() if data is not None else None,
                     "stdout_bytes": len(result.stdout),
                     "stdout_sha256": hashlib.sha256(result.stdout).hexdigest(), "stderr": stderr})
    if probe:
        if result.returncode != 1 or "At least one output file must be specified" not in stderr:
            raise RuntimeError("Unexpected FFmpeg metadata probe result: " + stderr)
        return stderr
    if result.returncode:
        raise RuntimeError(stderr)
    return result.stdout


def decoded_float(path, channels):
    raw = run(["-i", str(path), "-map", "0:a:0", "-vn", "-sn", "-dn",
               "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"])
    if len(raw) % (4 * channels):
        raise ValueError("Incomplete decoded audio frame")
    values = np.frombuffer(raw, dtype="<f4").reshape(-1, channels)
    if not len(values) or not np.isfinite(values).all():
        raise ValueError("Empty or nonfinite input audio")
    return values


def write_pcm(path, values, rate, codec, gain):
    raw = values.astype("<f4").tobytes()
    run(["-f", "f32le", "-ar", str(rate), "-ac", str(values.shape[1]), "-i", "pipe:0",
         "-af", f"volume={gain:.15g}:precision=double", "-c:a", codec, "-n", str(path)], raw)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if any(path.exists() for path in (RECEIPT, MODEL, PREVIEW)):
        raise FileExistsError("Preparation evidence/output exists; refusing overwrite")
    before = identity(SOURCE)
    probe = run(["-i", str(SOURCE)], probe=True)
    match = re.search(r"Audio: ([^,]+), (\d+) Hz, (stereo|mono), ([^,\r\n]+)", probe)
    if not match:
        raise ValueError("Cannot verify source codec/rate/channel layout from FFmpeg probe")
    codec, rate, layout, sample_format = match.groups()
    rate = int(rate)
    channels = 2 if layout == "stereo" else 1
    if channels != 2:
        raise ValueError("Expected stereo source; do not silently invent a channel conversion")
    duration_match = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", probe)
    estimated_seconds = None
    if duration_match:
        h, m, s = duration_match.groups()
        estimated_seconds = int(h)*3600 + int(m)*60 + float(s)
    original = decoded_float(SOURCE, channels)
    if not np.any(original):
        raise ValueError("Source contains no nonzero audio")
    source_metrics = metrics(original, rate)
    for folder in (MODEL.parent, PREVIEW.parent):
        folder.mkdir(parents=True, exist_ok=True)

    preview_gain = safe_gain(original, 3)
    write_pcm(PREVIEW, original, rate, "pcm_s24le", preview_gain)
    resample_filter = "pan=mono|c0=0.5*c0+0.5*c1,aresample=16000:filter_size=64:phase_shift=10:cutoff=0.97"
    model_bytes = run(["-f", "f32le", "-ar", str(rate), "-ac", "2", "-i", "pipe:0",
                       "-af", resample_filter, "-ar", "16000", "-ac", "1",
                       "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"], original.astype("<f4").tobytes())
    model_float = np.frombuffer(model_bytes, dtype="<f4").reshape(-1, 1)
    if not len(model_float) or not np.isfinite(model_float).all() or not np.any(model_float):
        raise ValueError("Invalid resampled model input")
    # Keep the complete resampler output including its final flush. Never slice frames.
    expected_model_frames = len(original) * 16000 / rate
    if abs(len(model_float) - expected_model_frames) > 1:
        raise ValueError("Full-stream resampled duration differs by more than one model sample")
    model_gain = safe_gain(model_float, 2)
    write_pcm(MODEL, model_float, 16000, "pcm_s16le", model_gain)
    preview_read = decoded_float(PREVIEW, 2)
    model_read = decoded_float(MODEL, 1)
    if preview_read.shape != original.shape or model_read.shape != model_float.shape:
        raise ValueError("Output frame count changed during PCM encoding")
    preview_metrics = metrics(preview_read, rate)
    model_metrics = metrics(model_read, 16000)
    for value in (preview_metrics, model_metrics):
        if value["peak"] > 10**(-1/20) or value["samples_at_or_above_full_scale"]:
            raise ValueError("Peak-safe gain verification failed")
    # Float readback precision and PCM quantization are the only allowed differences.
    preview_error = float(np.max(np.abs(preview_read.astype(np.float64)-original.astype(np.float64)*preview_gain)))
    model_error = float(np.max(np.abs(model_read.astype(np.float64)-model_float.astype(np.float64)*model_gain)))
    if preview_error > 1.1 / (2**23) or model_error > 1.1 / (2**15):
        raise ValueError("PCM readback is inconsistent with a static scalar gain")
    after = identity(SOURCE)
    if before != after:
        raise ValueError("Source identity changed during preparation")
    report = {
        "version": 1, "status": "prepared", "prepared_at": datetime.now(timezone.utc).isoformat(),
        "source": {**before, "codec_probe": codec, "sample_rate": rate, "channels": channels,
                   "channel_layout": layout, "decoded_sample_format_probe": sample_format,
                   "estimated_container_duration_seconds": estimated_seconds,
                   "duration_estimate_warning": "Estimating duration from bitrate" in probe,
                   "actual_full_decoded_frames": len(original),
                   "actual_full_decoded_duration_seconds": len(original)/rate},
        "source_after": after, "source_unchanged": True,
        "full_input_used": True, "range": {"start_frame": 0, "end_frame_exclusive": len(original),
                                           "sample_rate": rate, "selection": "entire decoded input"},
        "model": {**identity(MODEL), "codec": "pcm_s16le", "metrics": model_metrics},
        "source_preview": {**identity(PREVIEW), "codec": "pcm_s24le", "metrics": preview_metrics},
        "source_before_gain_metrics": source_metrics, "model_before_gain_metrics": metrics(model_float, 16000),
        "model_static_gain": model_gain, "model_static_gain_db": db(model_gain),
        "preview_static_gain": preview_gain, "preview_static_gain_db": db(preview_gain),
        "conversion": {"float_first": True, "mono_mix": "0.5*L + 0.5*R", "resampling_filter": resample_filter,
                       "expected_model_frames_before_integer_rounding": expected_model_frames,
                       "retained_resampler_frames": len(model_float), "post_resampler_frames_removed": 0,
                       "duration_difference_seconds": len(model_float)/16000-len(original)/rate,
                       "fixed_gain_policy": "attenuate only if necessary; peak at most -1 dBFS, one PCM quantization step margin",
                       "preview_max_abs_error_against_static_gain": preview_error,
                       "model_max_abs_error_against_static_gain": model_error,
                       "seek_or_duration_options_used": False, "denoise": False, "equalization": False,
                       "speed_or_pitch_change": False, "padding_to_filename_duration": False},
        "script": identity(Path(__file__)),
        "shared_preparation_helpers": identity(Path(__file__).with_name("prepare_yukino_length_references.py")),
        "ffmpeg": identity(FF), "numpy_version": np.__version__, "commands": COMMANDS,
        "tts_runs": 0, "asr_runs": 0, "gpu_runs": 0,
        "notes": ["Filename 25s is only an input identifier, never an instruction to crop or pad.",
                  "Actual duration is measured from the full decoded sample count, not the MP3 bitrate estimate.",
                  "Original-rate stereo preview and mono model input have independent fixed peak-safe gains.",
                  "The parent agent performs any ASR/TTS separately; no transcript or subjective quality is asserted here."]
    }
    with RECEIPT.open("x", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write("\n")
    print(json.dumps({"status": "prepared", "receipt": str(RECEIPT), "model": str(MODEL),
                      "source_preview": str(PREVIEW), "actual_source_duration_seconds": len(original)/rate,
                      "source_frames": len(original), "model_frames": len(model_float),
                      "source_unchanged": True, "model_gain_db": db(model_gain),
                      "preview_gain_db": db(preview_gain)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
