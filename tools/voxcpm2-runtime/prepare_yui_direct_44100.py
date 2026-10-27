"""Prepare three full-length Yui 44.1 kHz input candidates; no model calls.

The user selected all three gain comparisons. Preparation does not claim
that generation has run or that any gain is subjectively approved.
"""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import wave

import numpy as np

import prepare_yukino_direct_44100 as conversion
from prepare_reference_refinements import wav_format
from prepare_yukino_length_references import FF, identity, metrics


FOLLOWUP = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27")
ROOT = FOLLOWUP / "yui-direct-44100"
PRIOR = FOLLOWUP / "reference-refinement/new-yui-preparation.json"
GAIN_PRIOR = FOLLOWUP / "input-clarity/yui-gain-preparation.json"
RECEIPT = ROOT / "preparation.json"
DESIGN = ROOT / "design.json"
RATE, FRAMES = 44100, 1050624
EXPECTED_SOURCE_SHA = "477e110243d0e4b7a7c9096c48f6bd2b74781adc64091371749cc5178c86d99f"
CASES = [
    ("yui-direct-44100-original", "原参考音量", 0, "parameter-sweep", "yui-cfg2p5-step10"),
    ("yui-direct-44100-plus3", "参考 +3 dB", 3, "input-clarity", "yui-gain-plus3"),
    ("yui-direct-44100-plus6", "参考 +6 dB", 6, "input-clarity", "yui-gain-plus6"),
]


def scalar_error(actual, source, gain):
    return float(np.max(np.abs(actual.astype(np.float64) - source.astype(np.float64) * gain)))


def shifted_pcm(original_float, rate, gain_db):
    filtered = conversion.as_float(conversion.process(original_float, rate, f"volume={gain_db}dB:precision=double"))
    raw = conversion.process(filtered, rate, pcm16=True)
    actual = conversion.as_float(raw, pcm16=True)
    error = scalar_error(actual, original_float, 10 ** (gain_db / 20))
    if error > 0.502 / 32768 or np.max(np.abs(filtered)) >= 1 or np.max(np.abs(actual)) >= 1:
        raise ValueError("Gain output clips or differs beyond PCM16 quantization allowance")
    return raw, error


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    products = [RECEIPT, DESIGN]
    for key, *_ in CASES:
        products.extend([ROOT / "references" / (key + ".wav"), ROOT / ("guarded-" + key + ".json")])
    if any(p.exists() for p in products):
        raise FileExistsError("Candidate products exist; refusing overwrite")
    previous = json.loads(PRIOR.read_text(encoding="utf-8"))
    gain_previous = json.loads(GAIN_PRIOR.read_text(encoding="utf-8"))
    if (previous["model_static_gain"], previous["preview_static_gain"]) != (1.0, 1.0):
        raise ValueError("Unexpected initial gain: do not silently change baseline level")
    source = Path(previous["source"]["path"])
    source_before = identity(source)
    if source_before["sha256"] != EXPECTED_SOURCE_SHA or source_before["sha256"] != previous["source"]["sha256"]:
        raise ValueError("User MP3 changed")
    original_model = Path(previous["model"]["path"])
    observed = {"original_mp3": source_before, "original_16k_reference": identity(original_model)}
    if observed["original_16k_reference"]["sha256"] != previous["model"]["sha256"]:
        raise ValueError("Original 16k reference identity changed")
    decoded = conversion.as_float(conversion.run(["-i", str(source), "-map", "0:a:0", "-vn", "-sn", "-dn", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"]), channels=2)
    if decoded.shape != (FRAMES, 2) or not np.isfinite(decoded).all():
        raise ValueError("Full decoded MP3 frame count changed")
    if previous["source"]["sample_rate"] != RATE or previous["source"]["actual_full_decoded_frames"] != FRAMES:
        raise ValueError("Previous decoded source metadata changed")
    mono = conversion.as_float(conversion.process(decoded, RATE, "pan=mono|c0=0.5*c0+0.5*c1"))
    if mono.shape != (FRAMES, 1):
        raise ValueError("Downmix changed full-stream frame count")
    mean_error = float(np.max(np.abs(mono.astype(np.float64) - decoded.astype(np.float64).mean(axis=1, keepdims=True))))
    if mean_error > 1e-7:
        raise ValueError("Downmix differs from arithmetic L/R average")
    initial_gain = previous["model_static_gain"]
    original_direct_pcm = conversion.process(mono, RATE, f"volume={initial_gain:.15g}:precision=double", pcm16=True)
    original_direct_float = conversion.as_float(original_direct_pcm, pcm16=True)
    direct_initial_error = scalar_error(original_direct_float, mono, initial_gain)
    if direct_initial_error > 0.502 / 32768 or np.max(np.abs(original_direct_float)) >= 1:
        raise ValueError("Original direct PCM is inconsistent with gain1 or clips")

    # Reproduce the complete old resampler stream including its final flush.
    old_float = conversion.as_float(conversion.process(decoded, RATE, previous["conversion"]["resampling_filter"]))
    if old_float.shape != (381179, 1):
        raise ValueError("Old full-stream resample frame count changed")
    old_initial_pcm = conversion.process(old_float, 16000, f"volume={initial_gain:.15g}:precision=double", pcm16=True)
    if old_initial_pcm != conversion.pcm_bytes(original_model):
        raise ValueError("Old initial 16k baseline is not reproduced exactly")
    old_initial_float = conversion.as_float(old_initial_pcm, pcm16=True)
    old_by_gain = {0: old_initial_pcm}
    old_refs = {0: observed["original_16k_reference"]}
    for gain_db in (3, 6):
        row = next(v for v in gain_previous["references"] if v["gain_db"] == gain_db)
        reference = Path(row["model"]["path"])
        ref_id = identity(reference)
        if ref_id["sha256"] != row["model"]["sha256"]:
            raise ValueError("Prior gain reference identity changed")
        raw, _ = shifted_pcm(old_initial_float, 16000, gain_db)
        if raw != conversion.pcm_bytes(reference):
            raise ValueError("Old gain PCM is not reproduced exactly")
        observed[f"old_gain_plus{gain_db}_reference"] = ref_id
        old_by_gain[gain_db], old_refs[gain_db] = raw, ref_id

    (ROOT / "references").mkdir(parents=True, exist_ok=True)
    rows = []
    common_template = None
    for key, label, gain_db, scope, baseline_id in CASES:
        template_path = FOLLOWUP / scope / ("guarded-" + baseline_id + ".json")
        template = json.loads(template_path.read_text(encoding="utf-8"))
        if (template["seed"], template["cfg"], template["timesteps"]) != (42, 2.5, 10):
            raise ValueError("Unexpected baseline parameters")
        if len(template["references"]) != 1 or len(template["texts"]) != 1 or template["references"][0]["mode"] != "combined":
            raise ValueError("Unexpected baseline mode/shape")
        if Path(template["references"][0]["path"]) != Path(old_refs[gain_db]["path"]):
            raise ValueError("Baseline manifest does not point to its corresponding gain reference")
        normalized = deepcopy(template)
        for field in ("id", "name", "path"):
            normalized["references"][0].pop(field)
        if common_template is None:
            common_template = normalized
        elif normalized != common_template:
            raise ValueError("Baselines differ beyond reference identity/path")
        if gain_db == 0:
            direct_pcm, gain_error = original_direct_pcm, 0.0
        else:
            direct_pcm, gain_error = shifted_pcm(original_direct_float, RATE, gain_db)
        values = conversion.as_float(direct_pcm, pcm16=True)
        if values.shape != (FRAMES, 1):
            raise ValueError("A candidate changed full-source frame count")
        output = ROOT / "references" / (key + ".wav")
        with wave.open(str(output), "wb") as f:
            f.setnchannels(1)
            f.setsampwidth(2)
            f.setframerate(RATE)
            f.writeframes(direct_pcm)
        fmt = wav_format(output)
        expected = {"format_tag": 1, "channels": 1, "sample_rate": RATE, "block_align": 2, "bits_per_sample": 16, "frames": FRAMES}
        if fmt != expected or conversion.pcm_bytes(output) != direct_pcm:
            raise ValueError("Written candidate format/PCM differs")
        manifest = deepcopy(template)
        manifest["references"][0].update(id=key, name=f"由比滨 · 44.1 kHz 直接输入 · {label}", path=str(output))
        restored = deepcopy(manifest)
        restored["references"][0].update({k: template["references"][0][k] for k in ("id", "name", "path")})
        if restored != template:
            raise ValueError("Manifest changed more than reference identity/path")
        manifest_path = ROOT / ("guarded-" + key + ".json")
        conversion.save_json(manifest_path, manifest)
        baseline_dir = FOLLOWUP / scope / "generation/audio" / baseline_id / "japanese-paragraph/take-001"
        baseline = {"id": baseline_id, "reuse_existing": True, "gain_db": gain_db, "input": old_refs[gain_db],
                    "files": {name: identity(baseline_dir / name) for name in ("generated.wav", "request.json", "receipt.json")},
                    "manifest": identity(template_path)}
        for name, val in baseline["files"].items():
            observed[f"{baseline_id}/{name}"] = val
        with wave.open(str(baseline_dir / "generated.wav"), "rb") as f:
            baseline["output_duration_seconds"] = f.getnframes() / f.getframerate()
        row = {"id": key, "label": label, "status": "prepared_candidate", "selected_for_generation": True,
               "gain_db": gain_db, "initial_gain_linear": initial_gain, "initial_gain_db": 0.0,
               "input": {**identity(output), "format": fmt, "metrics": metrics(values, RATE)},
               "manifest": identity(manifest_path), "baseline": baseline,
               "gain_max_abs_pcm_quantization_error": gain_error,
               "old_16k_pcm_reproduced_exactly": True,
               "independent_from_original_gain1_pcm": True,
               "processing_order": ["Full MP3 float decode at 44100 Hz", "Arithmetic L/R average, no resampling", "Fixed initial gain 1.0 -> PCM16"] + ([] if gain_db == 0 else [f"Independent +{gain_db} dB -> float32 -> PCM16"])}
        rows.append(row)
    after = {key: identity(Path(val["path"])) for key, val in observed.items()}
    if after != observed:
        raise ValueError("Source/baseline identity changed")
    design = {"version": 1, "experiment_date_local": "2026-10-28", "status": "candidates_prepared",
              "selection": "User explicitly selected all three comparisons on2026-10-28; the parent runs generation separately.",
              "variants": rows, "fixed": {"seed": 42, "cfg": 2.5, "timesteps": 10, "mode": "combined",
                  "duration_seconds": FRAMES / RATE, "initial_gain_linear": 1.0,
                  "prompt_text": common_template["references"][0]["promptText"], "texts": common_template["texts"]},
              "changed": "No offline16k resample. Complete44100mono PCM16 is passed directly to native, which performs its own input resample.",
              "quantization_note": "Corresponding gain/PCM stages are preserved but occur at44100 before internal resampling, rather than at16000 after offline resampling.",
              "subjective_assessment": "not evaluated"}
    conversion.save_json(DESIGN, design)
    report = {"version": 1, "status": "candidates_prepared", "experiment_date_local": "2026-10-28", "prepared_at": datetime.now(timezone.utc).isoformat(),
              "source": source_before, "sources": observed, "sources_after": after, "sources_unchanged": True,
              "source_preparation": identity(PRIOR), "gain_preparation": identity(GAIN_PRIOR),
              "decoded_stereo_float_sha256": hashlib.sha256(decoded.astype("<f4").tobytes()).hexdigest(),
              "source_frames": FRAMES, "source_rate": RATE, "full_input_used": True,
              "source_duration_seconds": FRAMES / RATE, "model_baseline_frames": len(old_float),
              "mean_downmix_max_abs_error": mean_error, "initial_gain_linear": initial_gain,
              "direct_initial_max_abs_gain_quantization_error": direct_initial_error,
              "direct_initial_pcm16_sha256": hashlib.sha256(original_direct_pcm).hexdigest(),
              "old_initial_pcm16_sha256": hashlib.sha256(old_initial_pcm).hexdigest(),
              "all_old_16k_candidates_pcm_reproduced_exactly": True,
              "variants": rows, "design": identity(DESIGN), "all_frames_preserved": True, "all_outputs_unclipped": True,
              "trim": False, "padding": False, "eq": False, "denoise": False, "limiter": False, "gain_compensation": False,
              "rms_matching": False, "upsampling_from_16k": False,
              "script": identity(Path(__file__)), "conversion_helper": identity(Path(conversion.__file__)),
              "ffmpeg": identity(FF), "numpy_version": np.__version__, "commands": conversion.COMMANDS,
              "tts_runs": 0, "asr_runs": 0, "gpu_runs": 0,
              "notes": ["Original user MP3 is decoded in full with no selection or artificial padding.",
                        "All three comparisons were selected by the user; no model execution or gain acceptance is asserted.",
                        "Each +3/+6 candidate starts from the same gain1 PCM rather than the other boosted candidate.",
                        "No intermediate audio files are written; all proof reconstructions are in memory.",
                        "The model encoder remains16k. This comparison changes the resampling path and quantization order."]}
    conversion.save_json(RECEIPT, report)
    print(json.dumps({"status": "candidates_prepared", "receipt": str(RECEIPT), "old_16k_exactly_reproduced": True,
                      "candidates": [{"id": r["id"], "input": r["input"], "manifest": r["manifest"]["path"]} for r in rows]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
