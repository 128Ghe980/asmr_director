"""Analyze independent generated SFX and build an isolated listening page.

Requires numpy and scipy. Raw inputs are never edited. This tool reports exact
decoded-audio duplicates and conservative repetition clues; it does not certify
ASMR quality, naturalness, binaural provenance, or absence of audible repetition.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from html import escape
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
from urllib.parse import urlsplit

import numpy as np
from scipy.io import wavfile
from scipy.signal import correlate, find_peaks, resample_poly


CATEGORIES = {
    "ear_cleaning": "棉签清洁 / 掏耳",
    "ear_brushing": "刷耳",
    "massage": "按摩",
    "spray": "喷雾",
}
ALIASES = {"brushing": "ear_brushing", "skin": "massage", "ear_massage": "massage"}
SEEDS = [104729, 130363, 155921]
FORMAT = "asmr-sfx-model-listening/v1"
SAFE_ID = re.compile(r"[A-Za-z0-9_-]{1,160}\Z")
WINDOW_SECONDS = 2.0
WINDOW_HOP_SECONDS = 0.25
MAX_WINDOWS = 96
ANALYSIS_RATE = 8000
CORRELATION_THRESHOLD = 0.995
ACTIVE_RMS_DBFS = -75.0
PERIODICITY_MAX_RATE = 48000
PERIODICITY_MAX_FRAMES = 1000000
PERIODICITY_THRESHOLD = 0.995
PERIODICITY_MAX_PEAKS = 3


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".sfx-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def atomic_copy(source: Path, target: Path) -> None:
    if source == target.resolve():
        raise ValueError(f"Output would overwrite the raw input: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".sfx-", dir=target.parent)
    os.close(descriptor)
    try:
        shutil.copyfile(source, temporary)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def dbfs(value: float) -> float | None:
    return round(20.0 * math.log10(value), 4) if value > 0 else None


def decoded_audio(path: Path) -> tuple[int, np.ndarray, str]:
    sample_rate, data = wavfile.read(path)
    if data.dtype == np.uint8:
        audio = (data.astype(np.float64) - 128.0) / 128.0
    elif np.issubdtype(data.dtype, np.signedinteger):
        audio = data.astype(np.float64) / float(1 << (data.dtype.itemsize * 8 - 1))
    elif np.issubdtype(data.dtype, np.floating):
        audio = data.astype(np.float64)
    else:
        raise ValueError(f"Unsupported WAV sample type: {path}: {data.dtype}")
    if audio.ndim == 1:
        audio = audio[:, None]
    if audio.ndim != 2 or not len(audio) or not 1 <= audio.shape[1] <= 8:
        raise ValueError(f"Empty or unsupported channel layout: {path}")
    if not 1000 <= sample_rate <= 384000 or not np.isfinite(audio).all():
        raise ValueError(f"Invalid sample rate or non-finite samples: {path}")
    digest = hashlib.sha256()
    digest.update(json_bytes({"sampleRate": int(sample_rate), "shape": list(audio.shape)}))
    digest.update(np.ascontiguousarray(audio, dtype="<f8").tobytes())
    return int(sample_rate), audio, digest.hexdigest()


def waveform_windows(audio: np.ndarray, sample_rate: int) -> dict:
    """Conservative fixed-window scan; no time stretch or pitch matching."""
    analysis_rate = min(ANALYSIS_RATE, sample_rate)
    if sample_rate != analysis_rate:
        divisor = math.gcd(sample_rate, analysis_rate)
        reduced = resample_poly(audio, analysis_rate // divisor, sample_rate // divisor, axis=0)
    else:
        reduced = audio
    count = int(round(WINDOW_SECONDS * analysis_rate))
    last_start = len(reduced) - count
    if last_start < 0:
        return {"vectors": np.empty((0, 0), dtype=np.float32), "starts": [],
                "sampleRate": analysis_rate, "activeWindows": 0, "examinedWindows": 0,
                "examinedStartSeconds": [], "actualHopSecondsRange": [], "examinedCoverageSeconds": 0.0}
    stride = max(1, int(round(WINDOW_HOP_SECONDS * analysis_rate)))
    starts = np.arange(0, last_start + 1, stride, dtype=np.int64)
    if len(starts) > MAX_WINDOWS:
        starts = np.unique(np.rint(np.linspace(0, last_start, MAX_WINDOWS)).astype(np.int64))
    times_examined = starts.astype(np.float64) / analysis_rate
    hops = np.diff(times_examined)
    coverage = WINDOW_SECONDS + float(np.sum(np.minimum(hops, WINDOW_SECONDS)))
    vectors, times = [], []
    for start in starts:
        block = reduced[start:start + count].astype(np.float64, copy=False)
        if math.sqrt(float(np.mean(block * block))) < 10 ** (ACTIVE_RMS_DBFS / 20):
            continue
        # Center each channel before flattening; mono cancellation is avoided.
        centered = block - np.mean(block, axis=0, keepdims=True)
        vector = centered.reshape(-1)
        norm = float(np.linalg.norm(vector))
        if norm <= 1e-12:
            continue
        vectors.append((vector / norm).astype(np.float32))
        times.append(float(start) / analysis_rate)
    return {
        "vectors": np.stack(vectors) if vectors else np.empty((0, count * audio.shape[1]), dtype=np.float32),
        "starts": times, "sampleRate": analysis_rate,
        "activeWindows": len(vectors), "examinedWindows": len(starts),
        "examinedStartSeconds": [round(float(start), 5) for start in times_examined],
        "actualHopSecondsRange": [round(float(np.min(hops)), 5), round(float(np.max(hops)), 5)] if len(hops) else [],
        "examinedCoverageSeconds": round(coverage, 5),
    }


def window_matches(first: dict, second: dict, same_clip: bool, maximum: int = 6) -> list[dict]:
    a, b = first["vectors"], second["vectors"]
    if not len(a) or not len(b) or a.shape[1] != b.shape[1] or first["sampleRate"] != second["sampleRate"]:
        return []
    similarities = a @ b.T
    indices = np.argwhere(np.abs(similarities) >= CORRELATION_THRESHOLD)
    candidates = []
    for i, j in indices:
        start_a, start_b = first["starts"][int(i)], second["starts"][int(j)]
        if same_clip and (j <= i or start_b - start_a < WINDOW_SECONDS - 1e-6):
            continue
        candidates.append({
            "firstStartSeconds": round(start_a, 4), "secondStartSeconds": round(start_b, 4),
            "durationSeconds": WINDOW_SECONDS,
            "absoluteCorrelation": round(min(1.0, abs(float(similarities[i, j]))), 6),
            "polarityInverted": bool(similarities[i, j] < 0),
        })
    candidates.sort(key=lambda item: (-item["absoluteCorrelation"], item["firstStartSeconds"], item["secondStartSeconds"]))
    selected = []
    for candidate in candidates:
        if any(abs(candidate["firstStartSeconds"] - old["firstStartSeconds"]) < WINDOW_SECONDS / 2
               and abs(candidate["secondStartSeconds"] - old["secondStartSeconds"]) < WINDOW_SECONDS / 2
               for old in selected):
            continue
        selected.append(candidate)
        if len(selected) >= maximum:
            break
    return selected


def envelope_periodicity(audio: np.ndarray, sample_rate: int) -> dict:
    frame_size = max(1, int(round(sample_rate * 0.01)))
    frames = len(audio) // frame_size
    if frames < 150:
        return {"envelopeFrameSeconds": frame_size / sample_rate, "peaks": [], "reason": "too_short"}
    blocks = audio[:frames * frame_size].reshape(frames, frame_size, audio.shape[1])
    envelope = np.sqrt(np.mean(blocks * blocks, axis=(1, 2)))
    centered = envelope - np.mean(envelope)
    if float(np.std(centered)) <= max(1e-10, float(np.mean(envelope)) * 0.001):
        return {"envelopeFrameSeconds": frame_size / sample_rate, "peaks": [], "reason": "near_constant_envelope"}
    raw = correlate(centered, centered, mode="full", method="fft")[frames - 1:]
    cumulative = np.concatenate(([0.0], np.cumsum(centered * centered)))
    lags = np.arange(frames)
    normalization = np.sqrt(np.maximum(0.0, cumulative[frames - lags] * (cumulative[frames] - cumulative[lags])))
    normalized = np.divide(raw, normalization, out=np.zeros_like(raw), where=normalization > 1e-20)
    low = max(1, int(math.ceil(0.5 * sample_rate / frame_size)))
    high = min(frames // 2, int(math.floor(10.0 * sample_rate / frame_size)))
    if high <= low:
        return {"envelopeFrameSeconds": frame_size / sample_rate, "peaks": [], "reason": "too_short"}
    peaks, _ = find_peaks(normalized[low:high + 1], height=0.5,
                          distance=max(1, int(round(0.25 * sample_rate / frame_size))))
    candidates = [{"lagSeconds": round(float(p + low) * frame_size / sample_rate, 4),
                   "correlation": round(min(1.0, float(normalized[p + low])), 6)} for p in peaks]
    candidates.sort(key=lambda item: -item["correlation"])
    return {"envelopeFrameSeconds": frame_size / sample_rate, "minimumCorrelation": 0.5,
            "examinedLagSeconds": [0.5, round(high * frame_size / sample_rate, 4)],
            "peaks": candidates[:3], "reason": "diagnostic_only"}


def waveform_periodicity(audio: np.ndarray, sample_rate: int) -> dict:
    """Full-clip, per-lag overlap-centered Pearson autocorrelation via FFT.

    Keeps every input sample at 16 kHz for the 8/24 s experiment. This detects
    strong whole-waveform periodicity, not whether an audio editor used loops.
    """
    input_frames, channels = audio.shape
    duration = input_frames / sample_rate
    factor = max(1, math.ceil(sample_rate / PERIODICITY_MAX_RATE),
                 math.ceil(input_frames / PERIODICITY_MAX_FRAMES))
    centered = audio - np.mean(audio, axis=0, keepdims=True)
    centered_rms = math.sqrt(float(np.mean(centered * centered)))
    analysis_rate = sample_rate / factor
    result = {
        "method": "FFT autocorrelation; per-channel DC removal and per-lag overlapping-region Pearson normalization",
        "inputSampleRate": sample_rate, "inputFrames": input_frames, "inputDurationSeconds": round(duration, 8),
        "analysisSampleRate": analysis_rate, "downsampleFactor": factor,
        "lagSampleStepSeconds": factor / sample_rate, "channelsComparedSeparately": channels,
        "minimumCorrelation": PERIODICITY_THRESHOLD, "minimumCenteredRmsDbfs": ACTIVE_RMS_DBFS,
        "centeredRmsDbfs": dbfs(centered_rms), "maximumReportedPeaks": PERIODICITY_MAX_PEAKS,
        "minimumReportedPeakSeparationSeconds": 0.25,
        "peaks": [], "thresholdPeakCount": 0, "reason": "diagnostic_only",
    }
    if factor > 1:
        # Integer-ratio resampling keeps the cost bounded without truncating
        # the clip or creating an enormous relatively-prime FIR kernel.
        centered = resample_poly(centered, 1, factor, axis=0)
    frames = len(centered)
    result["analysisFrames"] = frames
    result["analysisDurationSeconds"] = round(frames / analysis_rate, 8)
    low = max(1, math.ceil(0.5 * analysis_rate))
    high = min(frames // 2, math.floor(10.0 * analysis_rate))
    result["examinedLagSeconds"] = [round(low / analysis_rate, 8), round(high / analysis_rate, 8)] if low <= high else []
    result["examinedLagCount"] = max(0, high - low + 1)
    result["examinedOverlapSecondsRange"] = [round((frames - high) / analysis_rate, 8), round((frames - low) / analysis_rate, 8)] if low <= high else []
    if high < low:
        result["reason"] = "too_short"
        return result
    if centered_rms < 10 ** (ACTIVE_RMS_DBFS / 20):
        result["reason"] = "silence_or_weak_ac_signal"
        return result
    scale = float(np.max(np.abs(centered)))
    if scale == 0:
        result["reason"] = "constant_signal"
        return result
    centered = centered / scale
    lags = np.arange(low, high + 1, dtype=np.int64)
    overlap = (frames - lags).astype(np.float64)
    numerator = np.zeros(len(lags), dtype=np.float64)
    first_energy = np.zeros(len(lags), dtype=np.float64)
    second_energy = np.zeros(len(lags), dtype=np.float64)
    for channel in range(channels):
        values = centered[:, channel]
        products = correlate(values, values, mode="full", method="fft")[frames - 1:]
        sums = np.concatenate(([0.0], np.cumsum(values, dtype=np.float64)))
        squares = np.concatenate(([0.0], np.cumsum(values * values, dtype=np.float64)))
        first_sum = sums[frames - lags]
        second_sum = sums[frames] - sums[lags]
        numerator += products[lags] - first_sum * second_sum / overlap
        first_energy += squares[frames - lags] - first_sum * first_sum / overlap
        second_energy += squares[frames] - squares[lags] - second_sum * second_sum / overlap
    denominator = np.sqrt(np.maximum(first_energy, 0.0) * np.maximum(second_energy, 0.0))
    normalized = np.divide(numerator, denominator, out=np.zeros_like(numerator), where=denominator > 1e-12)
    normalized = np.clip(normalized, -1.0, 1.0)
    # Padding retains a threshold peak at either scan boundary. Peaks are
    # positive correlations; an inverted waveform alone is not reported here.
    peaks, _ = find_peaks(np.concatenate(([-np.inf], normalized, [-np.inf])),
                          height=PERIODICITY_THRESHOLD)
    indices = peaks - 1
    result["thresholdPeakCount"] = len(indices)
    candidates = []
    for index in indices:
        lag = int(lags[index])
        candidates.append({
            "lagSamplesAtAnalysisRate": lag, "lagSamplesAtInputRate": lag * factor,
            "lagSeconds": round(lag / analysis_rate, 8),
            "correlation": round(float(normalized[index]), 6),
            "overlapFrames": frames - lag,
            "overlapDurationSeconds": round((frames - lag) / analysis_rate, 8),
            "overlapFraction": round((frames - lag) / frames, 6),
            "firstOverlapSeconds": [0.0, round((frames - lag) / analysis_rate, 8)],
            "secondOverlapSeconds": [round(lag / analysis_rate, 8), round(frames / analysis_rate, 8)],
        })
    candidates.sort(key=lambda item: (-item["correlation"], item["lagSeconds"]))
    selected = []
    for candidate in candidates:
        if any(abs(candidate["lagSeconds"] - existing["lagSeconds"]) < 0.25 for existing in selected):
            continue
        selected.append(candidate)
        if len(selected) >= PERIODICITY_MAX_PEAKS:
            break
    result["peaks"] = selected
    return result


def write_audition(audio: np.ndarray, sample_rate: int, target: Path) -> tuple[float, dict]:
    rms = math.sqrt(float(np.mean(audio * audio)))
    peak = float(np.max(np.abs(audio)))
    # Reserve the fractional PCM16 step so rounding cannot exceed -6 dBFS.
    ceiling = math.floor(10 ** (-6.0 / 20.0) * 32768.0) / 32768.0
    gain_db = min(-30.0 - 20 * math.log10(rms), 20 * math.log10(ceiling / peak)) if rms > 0 and peak > 0 else 0.0
    gain = 10 ** (gain_db / 20.0)
    adjusted = audio * gain
    # Peak ceiling ensures this conversion needs no limiter or clipping.
    pcm = np.rint(adjusted * 32768.0).astype(np.int16)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".sfx-", suffix=".wav", dir=target.parent)
    os.close(descriptor)
    try:
        wavfile.write(temporary, sample_rate, pcm[:, 0] if pcm.shape[1] == 1 else pcm)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return round(gain_db, 4), {
        "peakDbfs": dbfs(float(np.max(np.abs(pcm.astype(np.float64) / 32768.0)))),
        "sampleFrames": len(pcm), "sampleRate": sample_rate, "channels": int(pcm.shape[1]),
        "sha256": sha256_file(target), "encoding": "PCM16",
    }


def analyze_manifest(manifest_path: Path, artifact_root: Path) -> dict:
    manifest_bytes = manifest_path.read_bytes()
    document = json.loads(manifest_bytes.decode("utf-8-sig"))
    if document.get("schemaVersion") != 1 or not isinstance(document.get("runs"), list) or not isinstance(document.get("model"), dict):
        raise ValueError("Expected schemaVersion: 1, model object, and runs array")
    listening = artifact_root / "listening"
    environment = document.get("environment") or {}
    if not isinstance(environment, dict):
        raise ValueError("environment must be an object when provided")
    execution = environment.get("execution", "unknown")
    entries, windows, identifiers = [], {}, set()
    original_hashes = []
    for run in document["runs"]:
        if not isinstance(run, dict):
            raise ValueError("Each run must be an object")
        if run.get("status") != "generated":
            continue
        identifier = run.get("id")
        if not isinstance(identifier, str) or not SAFE_ID.fullmatch(identifier) or identifier in identifiers:
            raise ValueError("Every generated run must have a distinct safe id")
        identifiers.add(identifier)
        for field in ("category", "label", "prompt", "rawPath"):
            if not isinstance(run.get(field), str) or not run[field].strip():
                raise ValueError(f"{identifier}: missing {field}")
        if not isinstance(run.get("seed"), int) or isinstance(run["seed"], bool):
            raise ValueError(f"{identifier}: seed must be an integer")
        requested = run.get("requestedDurationSeconds")
        if not isinstance(requested, (int, float)) or isinstance(requested, bool) or not math.isfinite(requested) or requested <= 0:
            raise ValueError(f"{identifier}: invalid requestedDurationSeconds")
        source = Path(run["rawPath"])
        if not source.is_absolute():
            source = manifest_path.parent / source
        source = source.resolve(strict=True)
        if listening.resolve() in source.parents:
            raise ValueError(f"Raw input must be outside the generated listening directory: {source}")
        source_hash = sha256_file(source)
        if run.get("rawSha256") and run["rawSha256"] != source_hash:
            raise ValueError(f"Generation-manifest raw checksum mismatch: {identifier}")
        sample_rate, audio, pcm_hash = decoded_audio(source)
        expected_rate, expected_channels = document["model"].get("sampleRate"), document["model"].get("channels")
        if expected_rate is not None and expected_rate != sample_rate:
            raise ValueError(f"{identifier}: sample rate differs from model manifest")
        if expected_channels is not None and expected_channels != audio.shape[1]:
            raise ValueError(f"{identifier}: channel count differs from model manifest")
        destination = listening / "assets" / identifier
        raw_target, audition_target = destination / "raw.wav", destination / "audition.wav"
        if source == audition_target.resolve():
            raise ValueError(f"Output would overwrite raw input: {source}")
        atomic_copy(source, raw_target)
        if sha256_file(raw_target) != source_hash:
            raise ValueError(f"Raw-copy checksum mismatch: {identifier}")
        gain_db, audition = write_audition(audio, sample_rate, audition_target)
        duration = len(audio) / sample_rate
        rms = math.sqrt(float(np.mean(audio * audio)))
        peak = float(np.max(np.abs(audio)))
        category = ALIASES.get(run["category"], run["category"])
        clip_windows = waveform_windows(audio, sample_rate)
        windows[identifier] = clip_windows
        generated_seconds = run.get("generationSeconds")
        entry = {
            "id": identifier, "category": category, "categoryLabel": CATEGORIES.get(category, category),
            "label": run["label"], "prompt": run["prompt"], "negativePrompt": run.get("negativePrompt"),
            "seed": run["seed"], "requestedDurationSeconds": requested, "steps": run.get("steps"),
            "generationSeconds": generated_seconds,
            "execution": execution,
            "generationTiming": environment.get("timing") or ("request total includes queue" if execution == "remote" else "local pipeline inference" if execution == "local" else "unspecified"),
            "realTimeFactor": round(generated_seconds / duration, 4) if isinstance(generated_seconds, (int, float)) and math.isfinite(generated_seconds) else None,
            "peakVramAllocatedBytes": run.get("peakVramAllocatedBytes"),
            "peakVramReservedBytes": run.get("peakVramReservedBytes"),
            "status": "generated", "auditionStatus": "pending", "sourceRawPath": str(source),
            "rawPath": raw_target.relative_to(listening).as_posix(),
            "auditionPath": audition_target.relative_to(listening).as_posix(),
            "fileSha256": source_hash, "decodedPcmSha256": pcm_hash,
            "metrics": {
                "sampleRate": sample_rate, "channels": int(audio.shape[1]), "sampleFrames": len(audio),
                "durationSeconds": round(duration, 6), "requestedDurationErrorSeconds": round(duration - requested, 6),
                "rmsDbfs": dbfs(rms), "peakDbfs": dbfs(peak),
                "dcMeanPerChannel": [round(float(value), 9) for value in np.mean(audio, axis=0)],
                "samplesAtOrAboveFullScale": int(np.count_nonzero(np.abs(audio) >= 1.0)),
                "clippingFraction": round(float(np.mean(np.abs(audio) >= 1.0)), 9),
                "samplesBelowMinus80DbfsFraction": round(float(np.mean(np.abs(audio) < 0.0001)), 6),
                "finiteSamples": True,
            },
            "auditionGainDb": gain_db, "auditionMetrics": audition,
            "processing": "复制原始 WAV；试听副本仅调增益并量化为 PCM16；未截取、拼接、循环、淡入淡出、降噪或空间处理",
            "sameClipWindowClues": window_matches(clip_windows, clip_windows, same_clip=True),
            "envelopePeriodicity": envelope_periodicity(audio, sample_rate),
            "waveformPeriodicity": waveform_periodicity(audio, sample_rate),
            "windowScan": {**{key: value for key, value in clip_windows.items() if key != "vectors" and key != "starts"},
                           "activeStartSeconds": [round(value, 5) for value in clip_windows["starts"]]},
        }
        entries.append(entry)
        original_hashes.append((source, source_hash))
        print(f"Analyzed {identifier}: {duration:.2f}s, audition gain {gain_db:+.2f} dB", flush=True)
    hash_groups = {}
    for entry in entries:
        hash_groups.setdefault(entry["decodedPcmSha256"], []).append(entry["id"])
    duplicates = [{"runIds": value, "decodedPcmSha256": key} for key, value in hash_groups.items() if len(value) > 1]
    cross_clues = []
    for i, first in enumerate(entries):
        for second in entries[i + 1:]:
            # Compare all generated pairs; unrelated categories can also accidentally share audio.
            matches = window_matches(windows[first["id"]], windows[second["id"]], same_clip=False)
            if matches:
                cross_clues.append({"firstRunId": first["id"], "secondRunId": second["id"], "windows": matches})
    for entry in entries:
        entry["exactDuplicateRunIds"] = [other for group in duplicates if entry["id"] in group["runIds"] for other in group["runIds"] if other != entry["id"]]
        entry["crossClipWindowClueRunIds"] = sorted({pair["secondRunId"] if pair["firstRunId"] == entry["id"] else pair["firstRunId"] for pair in cross_clues if entry["id"] in (pair["firstRunId"], pair["secondRunId"])})
    for source, old_hash in original_hashes:
        if sha256_file(source) != old_hash:
            raise ValueError(f"Raw input changed during analysis: {source}")
    report = {
        "format": FORMAT, "createdAt": datetime.now(timezone.utc).isoformat(),
        "manifestPath": str(manifest_path), "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "environment": environment,
        "model": document["model"], "generatedCount": len(entries),
        "unprocessedRunCount": len(document["runs"]) - len(entries), "allOriginalHashesUnchanged": True,
        "auditionStatus": "pending", "runs": entries,
        "exactDecodedAudioDuplicates": duplicates, "crossClipWindowClues": cross_clues,
        "diagnosticMethod": {
            "decodedAudioHash": "SHA256 of sample-rate/shape descriptor plus normalized little-endian float64 samples; metadata ignored",
            "windowSeconds": WINDOW_SECONDS, "nominalHopSeconds": WINDOW_HOP_SECONDS,
            "maximumWindowsPerClip": MAX_WINDOWS, "maximumAnalysisSampleRate": ANALYSIS_RATE,
            "absoluteWaveformCorrelationThreshold": CORRELATION_THRESHOLD, "minimumActiveWindowRmsDbfs": ACTIVE_RMS_DBFS,
            "fullWaveformPeriodicity": {
                "method": "FFT autocorrelation, per-lag overlapping-region DC removal and Pearson normalization; channels compared without mono summing",
                "positiveCorrelationThreshold": PERIODICITY_THRESHOLD,
                "lagRangeSeconds": "0.5 to min(10, analyzed duration / 2)",
                "maximumAnalysisSampleRate": PERIODICITY_MAX_RATE,
                "maximumAnalysisFrames": PERIODICITY_MAX_FRAMES,
                "downsampling": "Integer factor only when sample rate or total frame count exceeds bounds; analyze the full clip",
                "minimumCenteredRmsDbfs": ACTIVE_RMS_DBFS,
            },
            "limitations": [
                "窗口检测只抽样固定对齐的非静音片段，最长96个窗口；不匹配时间偏移、速度或音高变化，可能漏检重复。",
                "全波形周期检测保留16kHz的8/24秒候选的每个采样点；高采样率或超过100万帧时整条降采样，记录实际采样率、lag步长与重叠覆盖。",
                "全波形高自相关是周期线索；正弦、规律动作或其他周期信号也会触发，不能判定制作时使用循环。弱信号、局部短重复、变速/变调、超出lag范围的重复可能漏检。",
                "高相关窗口是波形近重复线索，包络周期是节奏线索；规律喷雾或手部动作也可能出现周期峰。",
                "不同种子、不同哈希或未检出线索均不证明自然度、无重复、贴耳感、双耳录音或 ASMR 质量。",
                "所有候选仍待听审；试听副本的增益不能修复噪声或生成瑕疵。",
            ],
        },
    }
    atomic_bytes(artifact_root / "analysis.json", json_bytes(report))
    atomic_bytes(listening / "analysis.json", json_bytes(report))
    atomic_bytes(listening / "catalog.json", json_bytes(report))
    atomic_bytes(listening / "index.html", listening_html(report).encode("utf-8"))
    return report


def text(value) -> str:
    return escape(str(value), quote=True)


def number(value, suffix="", places=2) -> str:
    return "未记录" if value is None else f"{value:.{places}f}{suffix}"


def card_html(run: dict) -> str:
    metrics = run["metrics"]
    flags = []
    if run["exactDuplicateRunIds"]:
        flags.append("PCM精确重复：" + "、".join(run["exactDuplicateRunIds"]))
    if run["sameClipWindowClues"]:
        flags.append(f"音内近重复窗口线索：{len(run['sameClipWindowClues'])} 对")
    if run["crossClipWindowClueRunIds"]:
        flags.append("跨音近重复窗口线索：" + "、".join(run["crossClipWindowClueRunIds"]))
    peaks = run["envelopePeriodicity"]["peaks"]
    if peaks:
        flags.append("包络周期线索：" + "、".join(number(p["lagSeconds"], "s") for p in peaks))
    waveform_peaks = run.get("waveformPeriodicity", {}).get("peaks", [])
    if waveform_peaks:
        flags.append("全波形周期线索：" + "、".join(number(p["lagSeconds"], "s", places=5) for p in waveform_peaks))
    diagnostics = "<br>".join(text(flag) for flag in flags) if flags else "当前抽样检测未发现线索；仍需听完整条音频"
    seed_index = SEEDS.index(run["seed"]) if run["seed"] in SEEDS else None
    take = chr(ord("A") + seed_index) if seed_index is not None else str(run["seed"])
    timing_label = "远端请求总耗时" if run.get("execution") == "remote" else "本机推理耗时" if run.get("execution") == "local" else "记录耗时"
    return f'''<article class="card" data-run="{text(run['id'])}">
<div class="tags"><span>独立生成 {text(take)}</span><span>待听审</span><span>{metrics['channels']} 声道</span></div>
<h3>{text(run['label'])}</h3>
<p class="meta">{number(metrics['durationSeconds'], ' 秒')} · 种子 {run['seed']} · {metrics['sampleRate']} Hz</p>
<audio controls preload="none" src="{text(run['auditionPath'])}" aria-label="{text(run['label'])} 种子 {run['seed']}试听"></audio>
<p class="diagnostic {'warning' if flags else ''}">{diagnostics}</p>
<details><summary>原声、生成参数与检测细节</summary>
<p>试听增益 {run['auditionGainDb']:+.2f} dB；只调音量。<a href="{text(run['rawPath'])}" target="_blank" rel="noopener">播放原始音频</a> · <a href="{text(run['auditionPath'])}" download>下载试听音频</a></p>
<p>{text(run['processing'])}</p>
<p>原声 RMS {number(metrics['rmsDbfs'], ' dBFS')}；峰值 {number(metrics['peakDbfs'], ' dBFS')}；满幅样本 {metrics['samplesAtOrAboveFullScale']}；{timing_label} {number(run['generationSeconds'], ' 秒')}。</p>
<p>计时范围：{text(run.get('generationTiming', '未记录'))}。显存峰值：{number(run['peakVramAllocatedBytes'] / 2**30, ' GiB') if run['peakVramAllocatedBytes'] is not None else '未测量'}。</p>
<p>步骤 {text(run['steps'])}；请求时长 {text(run['requestedDurationSeconds'])} 秒。</p>
<p class="prompt" lang="en">{text(run['prompt'])}</p>
<p class="prompt" lang="en">负面提示：{text(run['negativePrompt'] or '无')}</p>
<pre>{text(json.dumps({'sameClipWindowClues': run['sameClipWindowClues'], 'envelopePeriodicity': run['envelopePeriodicity'], 'waveformPeriodicity': run.get('waveformPeriodicity')}, ensure_ascii=False, indent=2))}</pre>
<p class="checksum">原始 WAV SHA256 {text(run['fileSha256'])}<br>解码音频 SHA256 {text(run['decodedPcmSha256'])}</p>
</details></article>'''


def listening_html(report: dict) -> str:
    sections = []
    categories = list(CATEGORIES) + sorted({run["category"] for run in report["runs"]} - set(CATEGORIES))
    for category in categories:
        generated = [run for run in report["runs"] if run["category"] == category]
        duration_groups = sorted({float(run["requestedDurationSeconds"]) for run in generated} | {8.0})
        for duration in duration_groups:
            selected = [run for run in generated if float(run["requestedDurationSeconds"]) == duration]
            cards = []
            for seed_index, seed in enumerate(SEEDS):
                takes = [run for run in selected if run["seed"] == seed]
                if takes:
                    cards.extend(card_html(run) for run in takes)
                else:
                    cards.append(f'<article class="card empty-card"><div class="tags"><span>种子 {seed}</span></div><h3>独立生成 {chr(65 + seed_index)}</h3><p>待生成，本格没有音频。</p></article>')
            cards.extend(card_html(run) for run in selected if run["seed"] not in SEEDS)
            kind = "long" if duration > 12 else "short"
            kind_label = "连续长音" if kind == "long" else "短音比较"
            sections.append(f'<section class="comparison" data-category="{text(category)}" data-duration="{kind}"><h2>{text(CATEGORIES.get(category, category))} <small>{kind_label} · 请求 {duration:g} 秒</small></h2><div class="grid">{"".join(cards)}</div></section>')
    options = ''.join(f'<option value="{text(key)}">{text(CATEGORIES.get(key, key))}</option>' for key in categories)
    model = report["model"]
    content = TEMPLATE.replace("{{SECTIONS}}", "\n".join(sections)).replace("{{OPTIONS}}", options)
    content = content.replace("{{COUNT}}", str(report["generatedCount"]))
    content = content.replace("{{MODEL}}", text(model.get("id", "未记录")))
    content = content.replace("{{REVISION}}", text(model.get("revision", "未记录")))
    content = content.replace("{{LICENSE}}", text(model.get("license", "未记录")))
    sample_rate = model.get("sampleRate", "未记录")
    channels = model.get("channels")
    channel_label = "单声道" if channels == 1 else f"{channels} 声道" if channels else "声道未记录"
    license_label = "非商用实验" if "NC" in str(model.get("license", "")).upper() else "模型实验"
    content = content.replace("{{FORMAT_LABEL}}", text(f"{sample_rate} Hz · {channel_label} · {license_label} · 听感待确认"))
    environment = report.get("environment") or {}
    execution = environment.get("execution")
    execution_label = "远端公开模型演示 · 本页不计作本机CUDA验收" if execution == "remote" else "本机CUDA实测" if execution == "local" and report["generatedCount"] else "本机CUDA实验 · 尚无成功音频" if execution == "local" else "执行位置未记录 · 未据此确认本机CUDA可用"
    execution_note = "请求总耗时包含网络、排队和服务处理，不等于模型纯推理耗时。" if execution == "remote" else "耗时及显存为本轮记录；听感仍需确认。"
    source_url = environment.get("sourceUrl") or model.get("sourceUrl") or model.get("source")
    source_link = ""
    if isinstance(source_url, str) and not any(character.isspace() or ord(character) < 32 for character in source_url):
        try:
            parsed = urlsplit(source_url)
            if parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password:
                source_link = f'<a href="{text(source_url)}" target="_blank" rel="noopener noreferrer">{text(source_url)}</a>'
        except ValueError:
            pass  # Malformed source metadata is never converted into a link.
    content = content.replace("{{EXECUTION}}", text(execution_label))
    content = content.replace("{{EXECUTION_NOTE}}", text(execution_note))
    content = content.replace("{{SOURCE_LINK}}", source_link)
    return content


TEMPLATE = '''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<title>ASMR 模型生成试听</title><style>
:root{color-scheme:dark;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#101817;color:#edf5f1}
*{box-sizing:border-box}body{margin:0}main{max-width:1260px;margin:auto;padding:38px 28px 64px}
h1{font-size:clamp(26px,4vw,40px);margin:10px 0 14px}h2{font-size:23px;margin:30px 0 14px}h3{font-size:18px;line-height:1.5;margin:12px 0 7px}
p{line-height:1.7}.eyebrow{font-size:13px;letter-spacing:.12em;color:#83d4b5}.intro{max-width:960px;color:#bdcfc6}.note{border-left:3px solid #b7ca75;padding:10px 15px;background:#1b2420;border-radius:0 8px 8px 0;font-size:14px;overflow-wrap:anywhere}
.filters{display:flex;gap:16px;flex-wrap:wrap;margin-top:24px}label{display:flex;align-items:center;gap:9px;font-size:14px}select,button{background:#1d2c26;border:1px solid #51645a;color:#f3f7f4;padding:9px 12px;border-radius:7px;font:inherit}
button{cursor:pointer}select:focus,button:focus,a:focus,audio:focus,summary:focus{outline:2px solid #8ce8c1;outline-offset:3px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.card{background:#1a2521;border:1px solid #354c40;border-radius:12px;padding:18px;min-width:0}.empty-card{opacity:.55;min-height:220px;border-style:dashed}.tags{display:flex;gap:6px;flex-wrap:wrap}.tags span{background:#293b32;border-radius:5px;padding:4px 7px;font-size:11px;color:#bfd6c8}
audio{width:100%;display:block;margin:17px 0}.meta,small{color:#a8c0b2;font-size:12px}.diagnostic{font-size:12px;color:#a8c0b2;min-height:3.2em;overflow-wrap:anywhere}.warning{color:#e7c47b}details{font-size:12px;border-top:1px solid #354c40;padding-top:10px}summary{cursor:pointer;color:#c0d4c8}details p{overflow-wrap:anywhere}a{color:#82d9b4}.prompt{color:#b6c9bf}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;color:#b6c9bf}.checksum{font-size:10px;overflow-wrap:anywhere}.comparison[hidden]{display:none}#empty{color:#b6c9bf}footer{color:#a9beb2;font-size:12px;margin-top:32px;border-top:1px solid #354c40;padding-top:18px}.model{overflow-wrap:anywhere}
@media(max-width:850px){.grid{grid-template-columns:1fr 1fr}}@media(max-width:570px){main{padding:24px 14px 48px}.grid{grid-template-columns:1fr}h2 small{display:block;margin-top:6px}.filters{gap:12px}.filters label{width:100%;justify-content:space-between}.filters select{flex:1;min-width:0}.card{padding:16px}}
</style></head><body><main>
<div class="eyebrow">ASMR · 模型生成实验</div><h1>贴耳护理声音 · 独立生成比较</h1>
<p class="meta">{{FORMAT_LABEL}}</p>
<p class="note"><strong>{{EXECUTION}}</strong><br>{{EXECUTION_NOTE}}<br>{{SOURCE_LINK}}</p>
<p class="intro">已生成 {{COUNT}} 条独立声音。横向比较同一动作的三个种子，再听完整条长音，检查是否有同一段摩擦反复出现。所有候选都待听审。</p>
<p class="note">独立生成、不同哈希或检测未发现重复，都不能保证声音自然或没有重复。波形近重复、全波形周期与包络周期是检查线索；正弦、喷雾和手部动作本身也可能有节奏，不能据此判定使用了循环。单声道或双声道数量不能证明双耳录音。</p>
<div class="filters"><label>声音类别<select id="category"><option value="">全部类别</option>{{OPTIONS}}</select></label><label>片段长度<select id="duration"><option value="">短音与长音</option><option value="short">短音比较</option><option value="long">连续长音</option></select></label><button id="stop" type="button">停止播放</button></div>
<p id="visible" class="meta" aria-live="polite"></p><p id="empty" hidden>当前选择还没有对应音频。</p>
{{SECTIONS}}
<footer><p>试听副本仅调整音量：目标 -30 dBFS RMS，峰值不超过 -6 dBFS，再量化为 PCM16。未循环、拼接、截取、降噪、淡入淡出或增加空间效果。放大也会放大噪声；详情可听原始声音。</p>
<p class="model">模型：{{MODEL}}<br>版本：{{REVISION}}<br>模型授权记录：{{LICENSE}}</p>
<p>全波形周期检查用 FFT，对每个延迟的重叠区去除 DC 并归一化，扫描 0.5–min(10，音频时长/2) 秒，报告相关 ≥0.995 的少量周期线索。16 kHz 的 8/24 秒音频保留每个采样点的延迟；高于 48 kHz 或超过 100 万帧时整条降采样。详情显示实际延迟步长、相关与重叠覆盖；未发现线索仍可能有局部或变形后的重复。</p>
<p>检测使用至多 8 kHz 的 2 秒窗口，通常每 0.25 秒抽样，最多 96 个窗口；跳过低于 -75 dBFS RMS 的窗口。只检查固定对齐波形，可能漏检时间偏移或变速后的重复。<a href="analysis.json" target="_blank" rel="noopener">查看完整检测报告</a> · <a href="catalog.json" download>下载候选目录</a> · <a href="http://127.0.0.1:8768/" target="_blank" rel="noopener">旧真实录音试听参考</a></p></footer>
</main><script>
const audios=Array.from(document.querySelectorAll('audio'));
const sections=Array.from(document.querySelectorAll('.comparison'));
const category=document.getElementById('category'),duration=document.getElementById('duration');
function stop(){for(const audio of audios){audio.pause();audio.currentTime=0;}}
for(const audio of audios){audio.volume=.35;audio.loop=false;audio.addEventListener('play',()=>{for(const other of audios){if(other!==audio){other.pause();other.currentTime=0;}}});}
function filter(){let visible=0,groups=0;for(const section of sections){const show=(!category.value||section.dataset.category===category.value)&&(!duration.value||section.dataset.duration===duration.value);section.hidden=!show;if(show){groups++;visible+=section.querySelectorAll('audio').length;}else{for(const audio of section.querySelectorAll('audio')){audio.pause();}}}document.getElementById('visible').textContent=`当前展示 ${visible} 条可试听音频`;document.getElementById('empty').hidden=visible>0;}
category.addEventListener('change',filter);duration.addEventListener('change',filter);document.getElementById('stop').addEventListener('click',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)for(const audio of audios)audio.pause();});filter();
</script></body></html>'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True, help="Candidate schemaVersion:1 JSON")
    parser.add_argument("--artifact-root", type=Path, required=True, help="Task-owned output directory; listening is served separately")
    args = parser.parse_args()
    manifest = args.manifest.resolve(strict=True)
    artifact_root = args.artifact_root.resolve()
    artifact_root.mkdir(parents=True, exist_ok=True)
    if manifest == artifact_root / "analysis.json" or (artifact_root / "listening").resolve() in manifest.parents:
        parser.error("Manifest must not be an output report or inside listening")
    report = analyze_manifest(manifest, artifact_root)
    print(f"Prepared {report['generatedCount']} pending generated clips; {len(report['exactDecodedAudioDuplicates'])} exact duplicate groups", flush=True)
    print(f"Listening page: {artifact_root / 'listening' / 'index.html'}", flush=True)


if __name__ == "__main__":
    main()
