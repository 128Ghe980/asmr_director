"""Read-only low-band and processing-chain audit; no WAV/model/ASR output."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import wave

import numpy as np

from prepare_reference_refinements import wav_format
from prepare_yukino_length_references import FF, identity


FOLLOWUP = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27")
ROOT = FOLLOWUP / "yui-low-register"
REPORT = ROOT / "low-band-analysis.json"
RATE, SIZE, HOP = 16000, 1024, 512
BANDS = [(80, 150), (150, 300), (300, 600), (600, 1200), (80, 300), (80, 600), (80, 1000)]
RESAMPLE = "aresample=16000:filter_size=64:phase_shift=10:cutoff=0.97"
COMMANDS = []


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def db(value):
    return 10 * math.log10(float(value)) if value > 0 else None


def verify(item):
    current = identity(Path(item["path"]))
    if any(current[k] != item[k] for k in ("bytes", "sha256")):
        raise ValueError("Audio/evidence identity changed: " + item["path"])
    return current


def decode16(path):
    fmt = wav_format(path)
    if fmt["channels"] not in (1, 2):
        raise ValueError("Unsupported audio channel count")
    filters = ["pan=mono|c0=0.5*c0+0.5*c1"] if fmt["channels"] == 2 else []
    if fmt["sample_rate"] != RATE:
        filters.append(RESAMPLE)
    cmd = [str(FF), "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1", "-filter_threads", "1", "-i", str(path), "-map", "0:a:0"]
    if filters:
        cmd += ["-af", ",".join(filters)]
    cmd += ["-ar", str(RATE), "-ac", "1", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"]
    result = subprocess.run(cmd, capture_output=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
    COMMANDS.append({"command": cmd, "exit_code": result.returncode, "stdout_bytes": len(result.stdout),
                     "stdout_sha256": hashlib.sha256(result.stdout).hexdigest(), "stderr": result.stderr.decode("utf-8", "replace")})
    if result.returncode:
        raise RuntimeError(COMMANDS[-1]["stderr"])
    values = np.frombuffer(result.stdout, dtype="<f4").astype(np.float64)
    if not len(values) or not np.isfinite(values).all():
        raise ValueError("Invalid decoded audio")
    return values, fmt


def spectrum(values):
    frames = np.lib.stride_tricks.sliding_window_view(values, SIZE)[::HOP]
    window = np.hanning(SIZE)
    freq = np.fft.rfftfreq(SIZE, 1 / RATE)
    weights = np.full(len(freq), 2.0)
    weights[[0, -1]] = 1
    power = abs(np.fft.rfft(frames * window, axis=1)) ** 2 * weights / (SIZE * np.sum(window ** 2))
    rms_power = np.mean(frames ** 2, axis=1)
    level = 10 * np.log10(np.maximum(rms_power, 1e-300))
    p95 = float(np.percentile(level, 95))
    masks = {
        "all_frames": np.ones(len(frames), dtype=bool),
        "energy_active": level >= max(-60.0, p95 - 30.0),
        "strong_energy": level >= max(-50.0, p95 - 20.0),
    }
    thresholds = {"all_frames": None, "energy_active": max(-60.0, p95 - 30.0), "strong_energy": max(-50.0, p95 - 20.0)}
    denominator = (freq >= 80) & (freq < 7500)
    band_masks = {f"{a}-{b}": (freq >= a) & (freq < b) for a, b in BANDS}
    groups = {}
    for name, mask in masks.items():
        if not np.any(mask):
            raise ValueError("No active frames remain under energy gate")
        total = float(power[mask][:, denominator].sum())
        bands = {}
        for band, band_mask in band_masks.items():
            summed = float(power[mask][:, band_mask].sum())
            per_frame_denominator = power[mask][:, denominator].sum(axis=1)
            shares = power[mask][:, band_mask].sum(axis=1) / np.maximum(per_frame_denominator, 1e-300)
            bands[band] = {"energy_fraction_of_80_7500": summed / total,
                           "mean_windowed_power": summed / int(mask.sum()),
                           "mean_windowed_power_dbfs": db(summed / int(mask.sum())),
                           "frame_share_p10_p50_p90": [float(x) for x in np.percentile(shares, [10, 50, 90])]}
        groups[name] = {"selected_frames": int(mask.sum()), "total_frames": len(mask), "selected_fraction": float(mask.mean()),
                        "gate_threshold_dbfs": thresholds[name], "frame_p95_dbfs": p95,
                        "selected_frame_rms_dbfs": db(np.mean(rms_power[mask])),
                        "total_80_7500_mean_windowed_power": total / int(mask.sum()),
                        "total_80_7500_mean_windowed_power_dbfs": db(total / int(mask.sum())), "bands": bands}
    return groups, power, masks, freq, band_masks


def pcm16(path):
    with wave.open(str(path), "rb") as f:
        if f.getsampwidth() != 2 or f.getnchannels() != 1:
            raise ValueError("Expected mono PCM16 native/listen output")
        return np.frombuffer(f.readframes(f.getnframes()), dtype="<i2").astype(np.float64), f.getframerate()


def source_transfer_only():
    """Compare native44.1k spectrum with actual16k using identical40ms windows."""
    output = ROOT / "low-band-source-transfer.json"
    if output.exists():
        raise FileExistsError("Source transfer evidence exists; refusing overwrite")
    main_report = read(REPORT)
    prep_path = FOLLOWUP / "yui-reference-02/preparation.json"
    prep = read(prep_path)
    before = {"source_preview": verify(prep["source_preview"]), "model_input": verify(prep["model"]),
              "main_analysis": identity(REPORT), "preparation": identity(prep_path)}
    cmd = [str(FF), "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1", "-filter_threads", "1",
           "-i", prep["source_preview"]["path"], "-map", "0:a:0", "-af", "pan=mono|c0=0.5*c0+0.5*c1",
           "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"]
    result = subprocess.run(cmd, capture_output=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError(result.stderr.decode("utf-8", "replace"))
    source = np.frombuffer(result.stdout, dtype="<f4").astype(np.float64)
    model, _ = decode16(Path(prep["model"]["path"]))
    if len(source) != 891648 or len(model) != 323501:
        raise ValueError("Unexpected full reference frame counts")

    def window_power(values, rate):
        size, hop = round(rate * .040), round(rate * .020)
        if size / rate != .04 or hop / rate != .02:
            raise ValueError("Windows must match exact times at both rates")
        frames = np.lib.stride_tricks.sliding_window_view(values, size)[::hop]
        # Periodic Hann samples the same continuous40ms window at either rate.
        win = np.hanning(size + 1)[:-1]
        weights = np.full(size // 2 + 1, 2.0)
        weights[0] = 1
        if size % 2 == 0:
            weights[-1] = 1
        power = abs(np.fft.rfft(frames * win, axis=1)) ** 2 * weights / (size * np.sum(win ** 2))
        return power, np.fft.rfftfreq(size, 1 / rate), 10 * np.log10(np.maximum(np.mean(frames ** 2, axis=1), 1e-300))

    src_power, src_freq, src_level = window_power(source, 44100)
    mod_power, mod_freq, _ = window_power(model, 16000)
    if len(src_power) != len(mod_power):
        raise ValueError("Exact-time frame alignment changed")
    p95 = float(np.percentile(src_level, 95))
    groups = {}
    for name, threshold in (("energy_active", max(-60, p95 - 30)), ("strong_energy", max(-50, p95 - 20))):
        active = src_level >= threshold
        bands = {}
        for lo, hi in BANDS:
            sm = (src_freq >= lo) & (src_freq < hi)
            mm = (mod_freq >= lo) & (mod_freq < hi)
            if not np.array_equal(src_freq[sm], mod_freq[mm]):
                raise ValueError("Source and model frequency grids do not align")
            a = float(src_power[active][:, sm].sum())
            b = float(mod_power[active][:, mm].sum())
            bands[f"{lo}-{hi}"] = {"actual16k_vs_original44100_mono_db": db(b / a),
                                     "source_mean_windowed_power": a / int(active.sum()),
                                     "model_mean_windowed_power": b / int(active.sum())}
        groups[name] = {"selected_frames": int(active.sum()), "total_frames": len(active),
                        "source_gate_threshold_dbfs": threshold, "same_source_frame_mask": True, "bands": bands}
    after = {k: identity(Path(v["path"])) for k, v in before.items()}
    if before != after:
        raise ValueError("Source identity changed")
    report = {"version": 1, "status": "analysis_complete", "analyzed_at": datetime.now(timezone.utc).isoformat(),
              "purpose": "Check original44100mono low-frequency energy against actual16k without resampling the source for the spectrum comparison.",
              "native_source_rate": 44100, "model_rate": 16000, "window_ms": 40, "hop_ms": 20,
              "window": "periodic Hann, same continuous window sampled at the two rates", "bin_spacing_hz": 25,
              "source_window_frames": 1764, "model_window_frames": 640, "groups": groups,
              "source_original_bandwidth_retained_for_analysis": True,
              "mono_downmix_only_on_source": True, "source_gain_db": 0, "model_gain_db": 0,
              "main_report": before["main_analysis"], "source_hashes_unchanged": True,
              "sources_before": before, "sources_after": after, "script": identity(Path(__file__)),
              "source_decode_command": cmd, "model_decode_commands": COMMANDS,
              "reference_filters": main_report["reference_chain"]["recorded_filters"],
              "limitations": ["Band-power comparison of aligned same-content windows is a passband check, not a complete system impulse response.",
                              "This checks reference preparation only; generated sentences have different phonetic and pitch content.",
                              "No WAV/model/ASR output is produced."], "audio_files_written": 0, "model_calls": 0, "asr_calls": 0}
    with output.open("x", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write("\n")
    print(json.dumps({"report": str(output), "source_to_actual16k": groups}, ensure_ascii=False))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-transfer-only", action="store_true")
    args = parser.parse_args()
    if args.source_transfer_only:
        source_transfer_only()
        return
    if REPORT.exists():
        raise FileExistsError("Low-band report exists; refusing overwrite")
    prep_path = FOLLOWUP / "yui-reference-02/preparation.json"
    package_path = FOLLOWUP / "yui-reference-02-sentences/package-receipt.json"
    prep, package = read(prep_path), read(package_path)
    fixed_filter = "pan=mono|c0=0.5*c0+0.5*c1," + RESAMPLE
    if prep["conversion"]["resampling_filter"] != fixed_filter or prep["model_static_gain"] != 1 or prep["preview_static_gain"] != 1:
        raise ValueError("Reference processing/gain differs from the established conversion")
    af_filters = [cmd["command"][cmd["command"].index("-af") + 1] for cmd in prep["commands"] if "-af" in cmd["command"]]
    if sorted(af_filters) != sorted([fixed_filter, "volume=1:precision=double", "volume=1:precision=double"]):
        raise ValueError("Unexpected filter present in the reference preparation command record")
    outputs = [{**package["familiar_paragraph"], "analysis_id": "paragraph"}]
    outputs += [{**row, "analysis_id": row["id"]} for row in package["generated"]]
    if [row["analysis_id"] for row in outputs] != ["paragraph", "greeting", "invitation", "concern", "shy", "comfort"]:
        raise ValueError("Unexpected generated corpus")
    watched = {"preparation": identity(prep_path), "package": identity(package_path),
               "source_preview": verify(prep["source_preview"]), "model_input": verify(prep["model"])}
    analyses, internals = [], {}
    for key, item in [("source_preview", prep["source_preview"]), ("model_input", prep["model"])] + [(row["analysis_id"], row["source"]) for row in outputs]:
        checked = verify(item)
        watched[key] = checked
        values, fmt = decode16(Path(item["path"]))
        groups, power, masks, freq, band_masks = spectrum(values)
        analyses.append({"id": key, "file": checked, "original_format": fmt, "analysis_frames": len(values),
                         "duration_seconds": len(values) / RATE, "groups": groups})
        if key in ("source_preview", "model_input"):
            internals[key] = (values, power, masks, freq, band_masks)
    source, model = internals["source_preview"], internals["model_input"]
    if source[0].shape != model[0].shape or source[1].shape != model[1].shape:
        raise ValueError("Source/model aligned comparison shape differs")
    active = source[2]["energy_active"]
    matched = {}
    for key, band_mask in source[4].items():
        source_power = float(source[1][active][:, band_mask].sum())
        model_power = float(model[1][active][:, band_mask].sum())
        matched[key] = {"model_vs_source_db": db(model_power / source_power),
                        "source_power": source_power, "model_power": model_power}
    match = {"same_source_active_frames_used": int(active.sum()), "model_gain_db": 0,
             "max_abs_pcm_residual": float(np.max(np.abs(source[0] - model[0]))),
             "rms_pcm_residual_dbfs": db(np.mean((source[0] - model[0]) ** 2)),
             "matched_band_power_ratios": matched}
    listening = []
    for row in outputs:
        key = row["analysis_id"]
        for role in ("raw", "listen", "generation_receipt"):
            watched[key + "/" + role] = verify(row[role])
        if row["source"]["sha256"] != row["raw"]["sha256"]:
            raise ValueError("Delivered raw differs from native output")
        request = read(row["generation_receipt"]["path"])["request"]
        if request["reference"]["file"]["sha256"] != prep["model"]["sha256"]:
            raise ValueError("Generated audio used a different reference")
        raw, raw_rate = pcm16(row["source"]["path"])
        listen, listen_rate = pcm16(row["listen"]["path"])
        gain = 10 ** (row["gain_db"] / 20)
        if raw.shape != listen.shape or raw_rate != listen_rate:
            raise ValueError("Listening output frame/rate changed")
        error = float(np.max(np.abs(listen - raw * gain)))
        if error > 0.502 or np.any(abs(listen) >= 32768):
            raise ValueError("Listening audio differs from constant gain plus PCM quantization")
        listening.append({"id": key, "gain_db": row["gain_db"], "max_abs_static_gain_error_pcm16_units": error,
                          "native_equals_delivered_raw": True, "static_gain_only_verified": True,
                          "listen_clipped_samples": int(np.count_nonzero(abs(listen) >= 32768))})
    after = {key: identity(Path(value["path"])) for key, value in watched.items()}
    if after != watched:
        raise ValueError("An audio/evidence file changed during analysis")
    ROOT.mkdir(parents=True, exist_ok=True)
    report = {"version": 1, "status": "analysis_complete", "analyzed_at": datetime.now(timezone.utc).isoformat(),
              "method": {"analysis_rate": RATE, "channels": 1, "conversion_storage": "RAM-only float64 after FFmpeg float32 decode",
                         "window_ms": SIZE / RATE * 1000, "hop_ms": HOP / RATE * 1000, "window": "Hann",
                         "fft_bin_spacing_hz": RATE / SIZE, "denominator_hz": [80, 7500], "bands_hz": BANDS,
                         "band_bins": "FFT bin centers >= lower and < upper; no interpolation at band edges",
                         "energy_active_gate": "frame RMS >= max(-60 dBFS, per-file95th-percentile RMS -30 dB)",
                         "strong_energy_gate": "frame RMS >= max(-50 dBFS, per-file95th-percentile RMS -20 dB)",
                         "gates_are_not_speech_or_voicing_classification": True,
                         "ratios_remove_uniform_level_scale": True, "source_and_model_comparison_uses_identical_aligned_active_frames": True},
              "files": analyses, "source_to_actual_model_input": match,
              "reference_chain": {"preparation": identity(prep_path), "recorded_filters": af_filters,
                                  "gain_db": 0, "no_explicit_highpass_or_lowcut": True,
                                  "measured_filter_effect_scope": "Source preview resampled in RAM with the exact established conversion versus actual prepared16k input; includes quantization.",
                                  "low_frequency_difference_is_not_the16k_bandwidth_limit": True},
              "native_to_listen": listening, "all_source_hashes_unchanged": True,
              "sources_before": watched, "sources_after": after, "script": identity(Path(__file__)),
              "ffmpeg": identity(FF), "numpy_version": np.__version__, "commands": COMMANDS,
              "limitations": ["Different target texts, vowels, consonants, stress and pitch occupy different spectral bands; these aggregate ratios are not an EQ transfer function.",
                              "A higher fundamental can naturally move energy out of80-300Hz without proving a low-cut filter.",
                              "Energy gates retain loud unvoiced consonants and do not classify speech, voiced sound or F0.",
                              "Source-to-model same-content comparison isolates the preparation chain; generated-to-reference comparisons do not isolate timbre from phonetics.",
                              "16kHz sampling does not remove these low-frequency bands; its Nyquist limit concerns high frequencies.",
                              "No listening judgment, model causality, or improvement is established by this analysis."],
              "audio_files_written": 0, "model_calls": 0, "asr_calls": 0}
    with REPORT.open("x", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write("\n")
    compact = []
    for row in analyses:
        compact.append({"id": row["id"], "active_fraction": row["groups"]["energy_active"]["selected_fraction"],
                        "active_band_percent": {key: round(value["energy_fraction_of_80_7500"] * 100, 3) for key, value in row["groups"]["energy_active"]["bands"].items()}})
    print(json.dumps({"report": str(REPORT), "bands": compact, "source_model_band_delta_db": {k: v["model_vs_source_db"] for k, v in matched.items()},
                      "static_gain_only_all_six": True, "all_source_hashes_unchanged": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
