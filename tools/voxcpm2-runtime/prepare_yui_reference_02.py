"""Prepare the entire new Yui02 MP3 at its own level; no TTS or ASR.

--inspect-only reports the exact prospective peak-safe gains without writing
audio or receipts. The normal run retains the entire decode/resampler flush.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys

import numpy as np

import prepare_yui25_reference as audio
from prepare_reference_refinements import wav_format
from prepare_yukino_length_references import FF, db, identity, metrics, safe_gain


FOLLOWUP = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27")
ROOT = FOLLOWUP / "yui-reference-02"
SOURCE = Path("H:/comfyui/output/sd2素材/干音/由比滨25s-02.MP3")
MODEL = ROOT / "references/yui-reference-02.wav"
PREVIEW = ROOT / "source-previews/yui-reference-02.wav"
RECEIPT = ROOT / "preparation.json"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--inspect-only", action="store_true")
    args = parser.parse_args()
    if not args.inspect_only and any(p.exists() for p in (MODEL, PREVIEW, RECEIPT)):
        raise FileExistsError("Preparation products exist; refusing overwrite")
    before = identity(SOURCE)
    if before["bytes"] != 323550:
        raise ValueError("New source size changed since task assignment")
    probe = audio.run(["-i", str(SOURCE)], probe=True)
    match = re.search(r"Audio: ([^,]+), (\d+) Hz, (stereo|mono), ([^,\r\n]+)", probe)
    if not match:
        raise ValueError("Source codec/rate/channel layout could not be verified")
    codec, rate, layout, sample_format = match.groups()
    rate, channels = int(rate), 2 if layout == "stereo" else 1
    duration_match = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", probe)
    estimate = None
    if duration_match:
        h, m, s = duration_match.groups()
        estimate = int(h) * 3600 + int(m) * 60 + float(s)
    original = audio.decoded_float(SOURCE, channels)
    if not np.any(original):
        raise ValueError("New source contains no nonzero audio")
    mono_mix = "pan=mono|c0=0.5*c0+0.5*c1" if channels == 2 else None
    resampler = "aresample=16000:filter_size=64:phase_shift=10:cutoff=0.97"
    filtering = ",".join(v for v in (mono_mix, resampler) if v)
    model_bytes = audio.run(["-f", "f32le", "-ar", str(rate), "-ac", str(channels), "-i", "pipe:0",
                             "-af", filtering, "-ar", "16000", "-ac", "1", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"], original.astype("<f4").tobytes())
    model_float = np.frombuffer(model_bytes, dtype="<f4").reshape(-1, 1)
    if not len(model_float) or not np.isfinite(model_float).all() or not np.any(model_float):
        raise ValueError("Model resample produced empty or invalid audio")
    expected = len(original) * 16000 / rate
    if abs(len(model_float) - expected) > 1:
        raise ValueError("Full resampler stream differs by more than one expected sample")
    preview_gain, model_gain = safe_gain(original, 3), safe_gain(model_float, 2)
    source_metrics, before_model_metrics = metrics(original, rate), metrics(model_float, 16000)
    summary = {"status": "inspected" if args.inspect_only else "prepared", "source": before,
               "sample_rate": rate, "channels": channels, "source_frames": len(original),
               "duration_seconds": len(original) / rate, "model_frames": len(model_float),
               "source_peak_dbfs": source_metrics["peak_dbfs"], "source_rms_dbfs": source_metrics["rms_dbfs"],
               "model_before_gain_peak_dbfs": before_model_metrics["peak_dbfs"],
               "model_before_gain_rms_dbfs": before_model_metrics["rms_dbfs"],
               "model_static_gain": model_gain, "model_static_gain_db": db(model_gain),
               "preview_static_gain": preview_gain, "preview_static_gain_db": db(preview_gain),
               "requires_peak_safe_attenuation": model_gain < 1 or preview_gain < 1}
    if args.inspect_only:
        if identity(SOURCE) != before:
            raise ValueError("Source identity changed during inspection")
        print(json.dumps(summary, ensure_ascii=False))
        return

    for folder in (MODEL.parent, PREVIEW.parent):
        folder.mkdir(parents=True, exist_ok=True)
    audio.write_pcm(PREVIEW, original, rate, "pcm_s24le", preview_gain)
    audio.write_pcm(MODEL, model_float, 16000, "pcm_s16le", model_gain)
    preview_read = audio.decoded_float(PREVIEW, channels)
    model_read = audio.decoded_float(MODEL, 1)
    if preview_read.shape != original.shape or model_read.shape != model_float.shape:
        raise ValueError("Output encoding changed full stream shape")
    preview_fmt, model_fmt = wav_format(PREVIEW), wav_format(MODEL)
    if (model_fmt["format_tag"], model_fmt["sample_rate"], model_fmt["channels"], model_fmt["bits_per_sample"], model_fmt["frames"]) != (1, 16000, 1, 16, len(model_float)):
        raise ValueError("Expected standard fmt1 mono16k PCM16 model reference")
    if (preview_fmt["sample_rate"], preview_fmt["channels"], preview_fmt["bits_per_sample"], preview_fmt["frames"]) != (rate, channels, 24, len(original)):
        raise ValueError("Original-rate/channel PCM24 preview format changed")
    preview_metrics, model_metrics = metrics(preview_read, rate), metrics(model_read, 16000)
    for metric in (preview_metrics, model_metrics):
        if metric["samples_at_or_above_full_scale"] or metric["peak"] > 10 ** (-1 / 20):
            raise ValueError("Output does not meet peak-safe no-clipping policy")
    preview_error = float(np.max(np.abs(preview_read.astype(np.float64) - original.astype(np.float64) * preview_gain)))
    model_error = float(np.max(np.abs(model_read.astype(np.float64) - model_float.astype(np.float64) * model_gain)))
    if preview_error > 1.1 / 2 ** 23 or model_error > 1.1 / 2 ** 15:
        raise ValueError("Output differs beyond fixed-gain quantization allowance")
    after = identity(SOURCE)
    if after != before:
        raise ValueError("User input identity changed")
    old = json.loads((FOLLOWUP / "reference-refinement/new-yui-preparation.json").read_text(encoding="utf-8"))
    boosted = json.loads((FOLLOWUP / "input-clarity/yui-gain-preparation.json").read_text(encoding="utf-8"))
    comparisons = [{"id": "old-original", "gain_db": 0, "input": old["model"], "metrics": old["model"]["metrics"]}]
    comparisons += [{"id": row["id"], "gain_db": row["gain_db"], "input": row["model"], "metrics": row["model"]["metrics"]} for row in boosted["references"]]
    for row in comparisons:
        if identity(Path(row["input"]["path"]))["sha256"] != row["input"]["sha256"]:
            raise ValueError("An old comparison reference identity changed")
        row["new_minus_old_rms_db"] = model_metrics["rms_dbfs"] - row["metrics"]["rms_dbfs"]
        row["new_minus_old_peak_db"] = model_metrics["peak_dbfs"] - row["metrics"]["peak_dbfs"]
    report = {"version": 1, "status": "prepared", "experiment_date_local": "2026-10-28", "prepared_at": datetime.now(timezone.utc).isoformat(),
              "source": {**before, "codec_probe": codec, "sample_rate": rate, "channels": channels, "channel_layout": layout,
                         "decoded_sample_format_probe": sample_format, "estimated_container_duration_seconds": estimate,
                         "duration_estimate_warning": "Estimating duration from bitrate" in probe,
                         "actual_full_decoded_frames": len(original), "actual_full_decoded_duration_seconds": len(original) / rate},
              "source_after": after, "source_unchanged": True, "full_input_used": True,
              "range": {"start_frame": 0, "end_frame_exclusive": len(original), "sample_rate": rate, "selection": "entire decoded input"},
              "model": {**identity(MODEL), "codec": "pcm_s16le", "format": model_fmt, "metrics": model_metrics},
              "source_preview": {**identity(PREVIEW), "codec": "pcm_s24le", "format": preview_fmt, "metrics": preview_metrics},
              "source_before_gain_metrics": source_metrics, "model_before_gain_metrics": before_model_metrics,
              "model_static_gain": model_gain, "model_static_gain_db": db(model_gain),
              "preview_static_gain": preview_gain, "preview_static_gain_db": db(preview_gain),
              "old_gain_db_applied": 0, "old_reference_comparison": comparisons,
              "conversion": {"float_first": True, "mono_mix": "0.5*L + 0.5*R" if channels == 2 else "input already mono; preserved",
                             "resampling_filter": filtering, "expected_model_frames_before_integer_rounding": expected,
                             "retained_resampler_frames": len(model_float), "post_resampler_frames_removed": 0,
                             "duration_difference_seconds": len(model_float) / 16000 - len(original) / rate,
                             "fixed_gain_policy": "Only necessary fixed peak-safe attenuation, as previous preparation; no amplification or old+3/+6 gain.",
                             "preview_max_abs_error_against_static_gain": preview_error, "model_max_abs_error_against_static_gain": model_error,
                             "seek_or_duration_options_used": False, "padding": False, "denoise": False, "equalization": False,
                             "dynamic_normalization": False, "speed_or_pitch_change": False},
              "all_outputs_unclipped": True, "script": identity(Path(__file__)), "preparation_helper": identity(Path(audio.__file__)),
              "ffmpeg": identity(FF), "numpy_version": np.__version__, "commands": audio.COMMANDS,
              "tts_runs": 0, "asr_runs": 0, "gpu_runs": 0, "manifest_created": False,
              "prompt_text_state": "New source must be transcribed before a TTS manifest is created.",
              "notes": ["Complete new source used; filename25s is not a crop or padding instruction.",
                        "Old reference levels are measured comparisons only and are not applied to this new input.",
                        "Different reference content means RMS differences are descriptive, not proof of a deliberate source gain.",
                        "No subjective improvement is asserted."]}
    with RECEIPT.open("x", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write("\n")
    summary.update(receipt=str(RECEIPT), model=str(MODEL), preview=str(PREVIEW), source_unchanged=True,
                   model_output_metrics=model_metrics,
                   comparisons=[{"id": r["id"], "new_minus_old_rms_db": r["new_minus_old_rms_db"]} for r in comparisons])
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
