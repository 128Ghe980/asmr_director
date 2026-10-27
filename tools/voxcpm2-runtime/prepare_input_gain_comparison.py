"""Prepare full-length Yui +3/+6 dB references; no TTS, ASR or GPU calls."""
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

import numpy as np

import prepare_reference_refinements as audio
from prepare_yukino_length_references import FF, identity, metrics


FOLLOWUP = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27")
ROOT = FOLLOWUP / "input-clarity"
BASE = FOLLOWUP / "reference-refinement"
PREPARATION = BASE / "new-yui-preparation.json"
TEMPLATE = FOLLOWUP / "parameter-sweep/guarded-yui-cfg2p5-step10.json"
RECEIPT = ROOT / "yui-gain-preparation.json"
DESIGN = ROOT / "yui-gain-design.json"
VARIANTS = [("yui-gain-plus3", 3), ("yui-gain-plus6", 6)]


def save_json(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as f:
        json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write("\n")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    products = [RECEIPT, DESIGN]
    for key, _ in VARIANTS:
        products += [ROOT / folder / (key + ".wav") for folder in ("references", "source-previews")]
        products.append(ROOT / ("guarded-" + key + ".json"))
    if any(p.exists() for p in products):
        raise FileExistsError("Current comparison products exist; refusing overwrite")

    previous = json.loads(PREPARATION.read_text(encoding="utf-8"))
    template = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    if (template["seed"], template["cfg"], template["timesteps"]) != (42, 2.5, 10):
        raise ValueError("Unexpected baseline seed/cfg/timesteps")
    if len(template["references"]) != 1 or len(template["texts"]) != 1:
        raise ValueError("Expected single-reference single-text baseline")
    if template["references"][0]["mode"] != "combined":
        raise ValueError("Expected combined baseline")

    sources = {key: Path(previous[key]["path"]) for key in ("model", "source_preview")}
    original_mp3 = Path(previous["source"]["path"])
    source_ids = {key: identity(path) for key, path in sources.items()}
    mp3_before = identity(original_mp3)
    for key in sources:
        if source_ids[key]["sha256"] != previous[key]["sha256"]:
            raise ValueError("Prepared baseline has changed")
    if mp3_before["sha256"] != previous["source"]["sha256"]:
        raise ValueError("User source has changed since original preparation")
    if Path(template["references"][0]["path"]) != sources["model"]:
        raise ValueError("Baseline manifest does not use the full prepared Yui source")

    formats = {key: audio.wav_format(path) for key, path in sources.items()}
    expected = {"model": (16000, 1, 16, 381179), "source_preview": (44100, 2, 24, 1050624)}
    originals = {}
    for key, path in sources.items():
        fmt = formats[key]
        if tuple(fmt[k] for k in ("sample_rate", "channels", "bits_per_sample", "frames")) != expected[key]:
            raise ValueError("Unexpected source sample format or full frame count")
        originals[key] = audio.read_float(path, fmt["channels"])
        if len(originals[key]) != fmt["frames"]:
            raise ValueError("Source decoding changed frame count")
        if float(np.max(np.abs(originals[key]))) * 10 ** (6 / 20) >= 1:
            raise ValueError("+6 dB would clip; do not silently compensate")

    for folder in ("references", "source-previews"):
        (ROOT / folder).mkdir(parents=True, exist_ok=True)
    rows = []
    for key, gain_db in VARIANTS:
        gain = 10 ** (gain_db / 20)
        row = {"id": key, "gain_db": gain_db, "filter": f"volume={gain_db}dB:precision=double",
               "independent_from_original": True, "gain_compensation": False,
               "trim": False, "denoise": False, "eq": False, "limiter": False,
               "speed_or_pitch_change": False, "sources": source_ids}
        for role, source in sources.items():
            fmt = formats[role]
            filtered = audio.read_float(source, fmt["channels"], row["filter"])
            if filtered.shape != originals[role].shape or not np.isfinite(filtered).all():
                raise ValueError("Gain filter changed shape or produced invalid values")
            if np.max(np.abs(filtered)) >= 1:
                raise ValueError("Filtered reference would clip")
            folder, codec = ("references", "pcm_s16le") if role == "model" else ("source-previews", "pcm_s24le")
            output = ROOT / folder / (key + ".wav")
            audio.write_pcm(output, filtered, fmt["sample_rate"], codec)
            actual_fmt = audio.wav_format(output)
            actual = audio.read_float(output, fmt["channels"])
            if actual_fmt != fmt or actual.shape != originals[role].shape:
                raise ValueError("Output format/frame count changed")
            actual_metrics = metrics(actual, fmt["sample_rate"])
            if actual_metrics["samples_at_or_above_full_scale"]:
                raise ValueError("Output PCM clips")
            scale = 2 ** (fmt["bits_per_sample"] - 1)
            quantization_error = float(np.max(np.abs(actual.astype(np.float64) - filtered.astype(np.float64))))
            gain_error = float(np.max(np.abs(actual.astype(np.float64) - originals[role].astype(np.float64) * gain)))
            if quantization_error > 1.1 / scale or gain_error > 1.1 / scale:
                raise ValueError("Output differs from the requested static gain")
            row[role] = {**identity(output), "codec": codec, "format": actual_fmt,
                         "metrics": actual_metrics, "static_gain_linear": gain,
                         "filtered_before_pcm_metrics": metrics(filtered, fmt["sample_rate"]),
                         "max_abs_pcm_quantization_error": quantization_error,
                         "max_abs_error_against_static_gain": gain_error, "frames_preserved": True}
        manifest = deepcopy(template)
        manifest["references"][0].update(id=key, name=f"由比滨 · 参考 +{gain_db} dB", path=row["model"]["path"])
        restored = deepcopy(manifest)
        restored["references"][0].update({k: template["references"][0][k] for k in ("id", "name", "path")})
        if restored != template:
            raise ValueError("Manifest changed more than reference identity/path")
        manifest_path = ROOT / ("guarded-" + key + ".json")
        save_json(manifest_path, manifest)
        row["manifest"] = identity(manifest_path)
        rows.append(row)

    after = {key: identity(path) for key, path in sources.items()}
    mp3_after = identity(original_mp3)
    if after != source_ids or mp3_before != mp3_after:
        raise ValueError("Source identity changed")
    baseline_dir = FOLLOWUP / "parameter-sweep/generation/audio/yui-cfg2p5-step10/japanese-paragraph/take-001"
    baseline = {"id": "yui-cfg2p5-step10", "gain_db": 0, "reuse_existing": True,
                "files": {name: identity(baseline_dir / name) for name in ("generated.wav", "request.json", "receipt.json")}}
    design = {"version": 1, "baseline": baseline, "variants": rows,
              "fixed": {"seed": 42, "cfg": 2.5, "timesteps": 10, "mode": "combined",
                        "prompt_text": template["references"][0]["promptText"], "texts": template["texts"]},
              "purpose": "Compare higher Yui reference input level at the preferred CFG/steps; outputs should be compared at equal playback loudness.",
              "similarity_assessment": "awaiting generation and user listening"}
    save_json(DESIGN, design)
    report = {"version": 1, "status": "prepared", "prepared_at": datetime.now(timezone.utc).isoformat(),
              "sources": source_ids, "sources_after": after, "sources_unchanged": True,
              "original_mp3": mp3_before, "original_mp3_after": mp3_after, "original_mp3_unchanged": True,
              "source_formats": formats, "source_metrics": {key: metrics(value, formats[key]["sample_rate"]) for key, value in originals.items()},
              "references": rows, "baseline": baseline, "all_frames_preserved": True,
              "all_outputs_unclipped": True, "variants_independent_not_stacked": True,
              "trim": False, "gain_compensation": False, "eq": False, "limiter": False, "denoise": False,
              "script": identity(Path(__file__)), "helper": identity(Path(audio.__file__)),
              "ffmpeg": identity(FF), "numpy_version": np.__version__, "commands": audio.COMMANDS,
              "baseline_manifest": identity(TEMPLATE), "design": identity(DESIGN),
              "tts_runs": 0, "asr_runs": 0, "gpu_runs": 0,
              "notes": ["Both gains start from the original full references, never from one another.",
                        "The original user MP3 and previous references are unchanged.",
                        "Static gain changes input level; it does not improve source signal-to-noise ratio.",
                        "No subjective similarity improvement is asserted."]}
    save_json(RECEIPT, report)
    print(json.dumps({"status": "prepared", "receipt": str(RECEIPT),
                      "references": [{"id": r["id"], "model_peak_dbfs": r["model"]["metrics"]["peak_dbfs"],
                                      "model_rms_dbfs": r["model"]["metrics"]["rms_dbfs"],
                                      "frames": r["model"]["format"]["frames"], "manifest": r["manifest"]["path"]} for r in rows],
                      "sources_unchanged": True, "all_outputs_unclipped": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
