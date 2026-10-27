"""Prepare a 44.1 kHz reference A/B, preserving the baseline's two gain stages.

Only CPU audio conversion is performed. The engine will still encode at its
configured rate; this file changes which resampler handles the input.
"""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import wave

import numpy as np

from prepare_reference_refinements import wav_format
from prepare_yukino_length_references import FF, identity, metrics


FOLLOWUP = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27")
ROOT = FOLLOWUP / "yukino-direct-44100"
PREVIOUS = FOLLOWUP / "yukino-length/preparation.json"
TEMPLATE = FOLLOWUP / "parameter-sweep/guarded-yukino-cfg2p5-step10.json"
KEY = "yukino-direct-44100"
OUTPUT = ROOT / "references" / (KEY + ".wav")
MANIFEST = ROOT / ("guarded-" + KEY + ".json")
RECEIPT = ROOT / "preparation.json"
DESIGN = ROOT / "design.json"
RATE = 44100
FRAMES = 1106910
BASELINE_FILTER = "pan=mono|c0=0.5*c0+0.5*c1,aresample=16000:filter_size=64:phase_shift=10:cutoff=0.97"
COMMANDS = []


def run(args, data=None):
    command = [str(FF), "-nostdin", "-hide_banner", "-threads", "1", "-filter_threads", "1", "-loglevel", "error", *args]
    result = subprocess.run(command, input=data, capture_output=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
    COMMANDS.append({"command": command, "exit_code": result.returncode,
                     "stdin_bytes": None if data is None else len(data),
                     "stdin_sha256": None if data is None else hashlib.sha256(data).hexdigest(),
                     "stdout_bytes": len(result.stdout), "stdout_sha256": hashlib.sha256(result.stdout).hexdigest(),
                     "stderr": result.stderr.decode("utf-8", "replace")})
    if result.returncode:
        raise RuntimeError(COMMANDS[-1]["stderr"])
    return result.stdout


def process(values, rate, filt=None, pcm16=False):
    command = ["-f", "f32le", "-ar", str(rate), "-ac", str(values.shape[1]), "-i", "pipe:0"]
    if filt:
        command += ["-af", filt]
    command += ["-c:a", "pcm_s16le" if pcm16 else "pcm_f32le", "-f", "s16le" if pcm16 else "f32le", "pipe:1"]
    return run(command, values.astype("<f4").tobytes())


def as_float(raw, pcm16=False, channels=1):
    values = np.frombuffer(raw, dtype="<i2" if pcm16 else "<f4").reshape(-1, channels)
    return values.astype(np.float32) / 32768 if pcm16 else values


def pcm_bytes(path):
    with wave.open(str(path), "rb") as f:
        return f.readframes(f.getnframes())


def gain_stages(mono, rate, gain):
    # Match the original first-stage .15g gain literal and PCM16 quantization.
    literal = f"{gain:.15g}"
    initial_pcm = process(mono, rate, f"volume={literal}:precision=double", pcm16=True)
    initial = as_float(initial_pcm, pcm16=True)
    # The previous -6 dB variant emitted float32 before its final PCM16 write.
    minus6_float = as_float(process(initial, rate, "volume=-6dB:precision=double"))
    final_pcm = process(minus6_float, rate, pcm16=True)
    final = as_float(final_pcm, pcm16=True)
    stages = {
        "initial_gain_linear": gain, "initial_gain_literal": literal,
        "initial_gain_db": 20 * float(np.log10(gain)),
        "second_gain_db": -6.0, "second_gain_linear": 10 ** (-6 / 20),
        "initial_pcm16_sha256": hashlib.sha256(initial_pcm).hexdigest(),
        "final_pcm16_sha256": hashlib.sha256(final_pcm).hexdigest(),
        "initial_metrics": metrics(initial, rate), "final_metrics": metrics(final, rate),
        "initial_max_abs_gain_quantization_error": float(np.max(np.abs(initial.astype(np.float64) - mono.astype(np.float64) * float(literal)))),
        "second_max_abs_gain_quantization_error": float(np.max(np.abs(final.astype(np.float64) - initial.astype(np.float64) * 10 ** (-6 / 20)))),
        "two_stage_max_abs_error_against_combined_gain": float(np.max(np.abs(final.astype(np.float64) - mono.astype(np.float64) * float(literal) * 10 ** (-6 / 20)))),
    }
    for field in ("initial_max_abs_gain_quantization_error", "second_max_abs_gain_quantization_error"):
        if stages[field] > 0.502 / 32768:
            raise ValueError("Gain stage differs by more than its PCM16 quantization allowance")
    if stages["initial_metrics"]["samples_at_or_above_full_scale"] or stages["final_metrics"]["samples_at_or_above_full_scale"]:
        raise ValueError("A gain stage clips")
    return initial_pcm, final_pcm, stages


def save_json(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as f:
        json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write("\n")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if any(p.exists() for p in (OUTPUT, MANIFEST, RECEIPT, DESIGN)):
        raise FileExistsError("Comparison products exist; refusing overwrite")
    prep = json.loads(PREVIOUS.read_text(encoding="utf-8"))
    base = next(r for r in prep["references"] if r["id"] == "yukinoshita-160-25p10s")
    template = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    if (template["seed"], template["cfg"], template["timesteps"]) != (43, 2.5, 10):
        raise ValueError("Unexpected baseline parameters")
    if len(template["references"]) != 1 or len(template["texts"]) != 1 or template["references"][0]["mode"] != "combined":
        raise ValueError("Unexpected baseline mode or shape")
    if base["range"] != {"start_seconds": 0, "end_seconds": 25.1, "source_start_frame_44100": 0,
                         "source_end_frame_exclusive_44100": FRAMES, "continuous": True}:
        raise ValueError("Baseline source interval changed")
    source = Path(prep["source_prefix_float"]["path"])
    original_model = Path(base["model"]["path"])
    baseline_reference = Path(template["references"][0]["path"])
    observed_sources = {"float_prefix": identity(source), "original_model": identity(original_model),
                        "baseline_reference": identity(baseline_reference), "original_video": identity(Path(prep["source"]["path"]))}
    if observed_sources["float_prefix"]["sha256"] != prep["source_prefix_float"]["sha256"]:
        raise ValueError("Shared float source identity changed")
    if observed_sources["original_model"]["sha256"] != base["model"]["sha256"] or observed_sources["original_video"]["sha256"] != prep["source"]["sha256"]:
        raise ValueError("Original source/model identity changed")
    source_fmt = wav_format(source)
    if (source_fmt["sample_rate"], source_fmt["channels"], source_fmt["bits_per_sample"], source_fmt["frames"]) != (RATE, 2, 32, 1155420):
        raise ValueError("Unexpected shared float prefix format")
    decoded = as_float(run(["-i", str(source), "-map", "0:a:0", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"]), channels=2)
    selected = decoded[:FRAMES]
    if len(decoded) != 1155420 or selected.shape != (FRAMES, 2):
        raise ValueError("Unexpected full prefix/selection length")
    mono = as_float(process(selected, RATE, "pan=mono|c0=0.5*c0+0.5*c1"))
    if mono.shape != (FRAMES, 1):
        raise ValueError("Mono conversion changed frames")
    mean_error = float(np.max(np.abs(mono.astype(np.float64) - selected.astype(np.float64).mean(axis=1, keepdims=True))))
    if mean_error > 1e-7:
        raise ValueError("Downmix differs from arithmetic L/R average")
    gain = base["model_static_gain"]
    _, direct_pcm, direct_stages = gain_stages(mono, RATE, gain)

    # Reproduce both existing 16 kHz PCM stages from exactly this source prefix.
    resampled = as_float(process(selected, RATE, BASELINE_FILTER))[:401600]
    if resampled.shape != (401600, 1):
        raise ValueError("Baseline reproduction frame count changed")
    original_pcm, baseline_pcm, baseline_stages = gain_stages(resampled, 16000, gain)
    if original_pcm != pcm_bytes(original_model) or baseline_pcm != pcm_bytes(baseline_reference):
        raise ValueError("Two-stage preparation did not exactly reproduce the existing baseline")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUTPUT), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(direct_pcm)
    output_fmt = wav_format(OUTPUT)
    expected_fmt = {"format_tag": 1, "channels": 1, "sample_rate": RATE, "block_align": 2, "bits_per_sample": 16, "frames": FRAMES}
    if output_fmt != expected_fmt or pcm_bytes(OUTPUT) != direct_pcm:
        raise ValueError("Written WAV is not exact standard PCM16 mono44100")
    manifest = deepcopy(template)
    manifest["references"][0].update(id=KEY, name="雪之下 · 44.1 kHz 直接输入", path=str(OUTPUT))
    restored = deepcopy(manifest)
    restored["references"][0].update({k: template["references"][0][k] for k in ("id", "name", "path")})
    if restored != template:
        raise ValueError("Manifest changed more than reference identity/path")
    save_json(MANIFEST, manifest)
    baseline_dir = FOLLOWUP / "parameter-sweep/generation/audio/yukino-cfg2p5-step10/japanese-paragraph/take-001"
    baseline = {"id": "yukino-cfg2p5-step10", "reuse_existing": True, "input": observed_sources["baseline_reference"],
                "files": {name: identity(baseline_dir / name) for name in ("generated.wav", "request.json", "receipt.json")}}
    after = {key: identity(Path(value["path"])) for key, value in observed_sources.items()}
    if after != observed_sources:
        raise ValueError("A source identity changed")
    output = {**identity(OUTPUT), "format": output_fmt, "metrics": metrics(as_float(direct_pcm, pcm16=True), RATE)}
    design = {"version": 1, "experiment_date_local": "2026-10-28", "baseline": baseline,
              "variant": {"id": KEY, "input": output, "manifest": identity(MANIFEST)},
              "fixed": {"seed": 43, "cfg": 2.5, "timesteps": 10, "mode": "combined", "duration_seconds": 25.1,
                        "initial_gain_linear": gain, "initial_gain_db": base["model_static_gain_db"], "second_gain_db": -6,
                        "prompt_text": template["references"][0]["promptText"], "texts": template["texts"]},
              "changed": "No offline 16 kHz resample: 44.1 kHz mono PCM16 is passed directly to native, which resamples internally.",
              "quantization_note": "The same two PCM16 quantization stages occur at 44.1 kHz rather than 16 kHz. Internal resampling order and method also change.",
              "similarity_assessment": "awaiting generation and user listening"}
    save_json(DESIGN, design)
    report = {"version": 1, "status": "prepared", "experiment_date_local": "2026-10-28", "prepared_at": datetime.now(timezone.utc).isoformat(),
              "sources": observed_sources, "sources_after": after, "sources_unchanged": True,
              "source_preparation": identity(PREVIOUS), "baseline_manifest": identity(TEMPLATE),
              "range": base["range"], "selected_stereo_float_sha256": hashlib.sha256(selected.astype("<f4").tobytes()).hexdigest(),
              "mean_downmix_max_abs_error": mean_error, "source_frames": len(selected),
              "baseline_initial_pcm16_reproduced_exactly": True, "baseline_minus6_pcm16_reproduced_exactly": True,
              "direct_gain_stages": direct_stages, "baseline_gain_stages": baseline_stages,
              "unused_stereo_preview_initial_gain_db": base["preview_static_gain_db"],
              "input": output, "manifest": identity(MANIFEST), "design": identity(DESIGN), "baseline": baseline,
              "same_continuous_segment": True, "all_frames_preserved": True, "all_outputs_unclipped": True,
              "eq": False, "denoise": False, "limiter": False, "gain_compensation": False, "rms_matching": False,
              "processing_order": ["First 1106910 stereo float frames of the established source prefix", "Arithmetic average of left/right at 44100 Hz",
                                   "Same baseline initial static gain -> PCM16", "Same -6 dB static gain -> float32 -> PCM16", "Standard fmt1 mono WAV at 44100 Hz"],
              "script": identity(Path(__file__)), "ffmpeg": identity(FF), "numpy_version": np.__version__, "commands": COMMANDS,
              "tts_runs": 0, "asr_runs": 0, "gpu_runs": 0,
              "notes": ["No new source material, no preview attenuation substituted, no normalization.",
                        "No permanent intermediate audio copies; both PCM stages are held in memory.",
                        "44.1 kHz file input does not change the model encoder's 16 kHz rate.",
                        "This A/B tests different reference conversion order/method, not full-band model encoding."]}
    save_json(RECEIPT, report)
    print(json.dumps({"status": "prepared", "receipt": str(RECEIPT), "input": output, "manifest": str(MANIFEST),
                      "baseline_exactly_reproduced": True, "sources_unchanged": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
