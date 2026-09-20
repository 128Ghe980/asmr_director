"""CPU-only, offline verification and quiet-boundary extraction of a voice group.

The JSON-file interface deliberately has no estimated/per-character cut fallback.
Uncertain speech alignment fails the job so it can be regenerated safely.
"""
from __future__ import annotations

import argparse
from collections import Counter
import difflib
import json
import math
import os
from pathlib import Path
import re
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from opencc import OpenCC

RATE = 48000
FRAME = RATE // 100  # 10 ms; never infer a speech boundary from text length.
WORD_GUARD = 0.080
_CONVERTER = OpenCC("t2s")


class UnsafeGroup(Exception):
    pass


def normalize(text: str) -> str:
    simplified = _CONVERTER.convert(text)
    return re.sub(r"[\W_]+", "", simplified, flags=re.UNICODE).lower().translate(
        str.maketrans({"地": "的", "得": "的"})
    )


def content_score(expected: str, actual: str) -> float:
    """Require both ends, ordered content, and no newly duplicated phrase."""
    target, transcript = normalize(expected), normalize(actual)
    if not target or not transcript:
        raise UnsafeGroup("missing_speech")
    matcher = difflib.SequenceMatcher(None, target, transcript, autojunk=False)
    coverage = sum(block.size for block in matcher.get_matching_blocks()) / len(target)
    anchor = min(3, len(target))
    if (matcher.ratio() < 0.90 or coverage < 0.90
            or not 0.90 <= len(transcript) / len(target) <= 1.08
            or transcript[:anchor] != target[:anchor]
            or transcript[-anchor:] != target[-anchor:]):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    # ASR substitutions are tolerated away from anchors; omitted words and added
    # speech are not. A replacement of unequal length is similarly ambiguous.
    for tag, start, end, actual_start, actual_end in matcher.get_opcodes():
        if tag in ("delete", "insert") or (tag == "replace" and end - start != actual_end - actual_start):
            raise UnsafeGroup("missing_or_extra_speech")
    width = min(6, len(target))
    expected_counts = Counter(target[i:i + width] for i in range(len(target) - width + 1))
    actual_counts = Counter(transcript[i:i + width] for i in range(len(transcript) - width + 1))
    if any(count > max(1, expected_counts.get(gram, 0)) for gram, count in actual_counts.items()):
        raise UnsafeGroup("repeated_speech")
    return coverage


def align_prefix(expected: str, words: list[dict]) -> int:
    """Align only whole ASR words; never divide a timestamp by character count."""
    target = normalize(expected)
    accumulated = ""
    candidates = []
    for index, word in enumerate(words):
        accumulated += normalize(word["text"])
        try:
            coverage = content_score(target, accumulated)
            candidates.append((coverage, -abs(len(accumulated) - len(target)), index))
        except UnsafeGroup:
            pass
        if len(accumulated) > len(target) * 1.15 + 3:
            break
    if not candidates:
        raise UnsafeGroup("uncertain_word_alignment")
    return max(candidates)[2]


def frame_levels(audio: np.ndarray) -> tuple[np.ndarray, float]:
    count = math.ceil(audio.size / FRAME)
    frames = np.pad(audio, (0, count * FRAME - audio.size)).reshape(-1, FRAME)
    levels = 20 * np.log10(np.maximum(np.sqrt(np.mean(frames * frames, axis=1)), 1e-12))
    peak = float(levels.max())
    if peak < -62:
        raise UnsafeGroup("silent_audio")
    # Quiet detection is deliberately below the -38 dB experiment threshold:
    # soft consonants must not be treated as safe-to-remove silence.
    return levels, max(-68.0, peak - 40.0)


def quiet_regions(levels: np.ndarray, threshold: float, start: float, end: float,
                  min_ms: float = 40) -> list[tuple[float, float]]:
    first = max(0, math.ceil(start * 100 - 1e-8))
    last = min(len(levels), math.floor(end * 100 + 1e-8))
    regions, beginning = [], None
    for index in range(first, last + 1):
        quiet = index < last and levels[index] < threshold
        if quiet and beginning is None:
            beginning = index
        elif not quiet and beginning is not None:
            if (index - beginning) * 10 >= min_ms:
                regions.append((beginning / 100, index / 100))
            beginning = None
    return regions


def choose_opening_cut(audio: np.ndarray, words: list[dict], terminal: int) -> float:
    if terminal + 1 >= len(words):
        raise UnsafeGroup("missing_continuation_boundary")
    if any(float(word["end"]) <= float(word["start"]) for word in words[terminal:terminal + 2]):
        raise UnsafeGroup("uncertain_boundary_timestamps")
    lower = float(words[terminal]["end"]) + WORD_GUARD
    upper = float(words[terminal + 1]["start"]) - WORD_GUARD
    levels, threshold = frame_levels(audio)
    regions = quiet_regions(levels, threshold, lower, upper, min_ms=80)
    if not regions:
        raise UnsafeGroup("no_safe_quiet_cut")
    midpoint = (lower + upper) / 2
    region = min(regions, key=lambda row: abs(sum(row) / 2 - midpoint))
    return sum(region) / 2


def quiet_cut_candidates(levels: np.ndarray, strict_threshold: float,
                         start: float, end: float, boundary: float) -> list[dict]:
    first = max(0, math.ceil(start * 100))
    last = min(len(levels), math.floor(end * 100))
    if last <= first:
        return []
    local_floor = float(np.percentile(levels[first:last], 20))
    peak = float(levels.max())
    adapted = min(-60.0, peak - 30.0, local_floor + 6.0)
    thresholds = [("two_sided", strict_threshold)]
    if adapted > strict_threshold + .01:
        thresholds.append(("noise_adapted", adapted))
    candidates = []
    for method, threshold in thresholds:
        regions = quiet_regions(levels, threshold, start, end, min_ms=160)
        for quiet_start, quiet_end in sorted(regions, key=lambda region: abs(sum(region) / 2 - boundary)):
            cut = (quiet_start + quiet_end) / 2
            if any(abs(cut - candidate["cut"]) < .02 for candidate in candidates):
                continue
            candidates.append({"method": method, "thresholdDbfs": threshold,
                               "quietStartSeconds": quiet_start, "quietEndSeconds": quiet_end,
                               "cut": cut, "localNoiseDbfs": local_floor, "peakFrameDbfs": peak})
            if len(candidates) == 3:
                return candidates
    return candidates


def retained_verified_tail_ms(start_sample: int, end_sample: int, validation: dict | None) -> float:
    if not validation:
        return 0.0
    start, end = start_sample / RATE, end_sample / RATE
    quiet_start, quiet_end = validation["quietStartSeconds"], validation["quietEndSeconds"]
    # Count only an interval that actually reaches the final file edge. A nearby
    # quiet region is not evidence for quiet after later active material.
    if end <= quiet_start or end > quiet_end + .5 / RATE:
        return 0.0
    return max(0.0, end - max(start, quiet_start)) * 1000


def verified_opening_cut(model, audio: np.ndarray, expected: str, following: str,
                         words: list[dict], terminal: int) -> tuple[float, dict, dict | None]:
    try:
        return choose_opening_cut(audio, words, terminal), words[terminal], None
    except UnsafeGroup as error:
        if str(error) not in ("no_safe_quiet_cut", "uncertain_boundary_timestamps"):
            raise
    # Whisper can assign a long pause to the first following word. Refine only
    # near that already-aligned boundary, using actual silence AND independent
    # recognition on both sides. A one-sided good transcript is insufficient.
    if terminal + 1 >= len(words):
        raise UnsafeGroup("missing_continuation_boundary")
    following_end = terminal + 1 + align_prefix(following, words[terminal + 1:])
    duration = audio.size / RATE
    boundary = (float(words[terminal]["end"]) + float(words[terminal + 1]["start"])) / 2
    start = max(0.0, min(float(words[terminal]["end"]), float(words[terminal + 1]["start"])) - .5)
    end = min(duration, max(float(words[terminal]["end"]), float(words[terminal + 1]["start"])) + .65)
    levels, threshold = frame_levels(audio)
    # At least 80 ms of measured deep quiet on EACH side of the cut, not merely
    # an 80 ms interval whose midpoint has only 40 ms protection.
    candidates = quiet_cut_candidates(levels, threshold, start, end, boundary)
    text_mismatch = False
    for candidate in candidates:
        cut = candidate["cut"]
        cut_sample = round(cut * RATE)
        right_end = min(audio.size, math.ceil((float(words[following_end]["end"]) + .65) * RATE))
        if cut_sample <= 0 or right_end <= cut_sample:
            continue
        try:
            left_transcript, left_words = transcribe(model, audio[:cut_sample])
            validate_words(left_words, cut_sample / RATE)
            content_score(expected, left_transcript)
            content_score(expected, "".join(word["text"] for word in left_words))
            right_transcript, right_words = transcribe(model, audio[cut_sample:right_end])
            right_terminal = align_prefix(following, right_words)
            validate_words(right_words[:right_terminal + 1], (right_end - cut_sample) / RATE)
            # Whole-word prefix alignment rejects a missing first syllable or
            # target-tail speech before the continuation. Check the segment text
            # as well, so disagreeing ASR words cannot conceal a leak.
            anchor = normalize(following)
            right_actual = normalize(right_transcript)
            content_score(anchor, right_actual[:len(anchor)])
            validation = {key: candidate[key] for key in ("method", "thresholdDbfs", "quietStartSeconds", "quietEndSeconds")}
            return cut, left_words[-1], validation
        except UnsafeGroup as error:
            # A real quiet interval can still fail independent recognition.
            # Preserve that distinction instead of reporting every rejection
            # as though no usable pause existed.
            text_mismatch |= str(error) in {
                "missing_speech", "incomplete_or_unrelated_speech",
                "missing_or_extra_speech", "repeated_speech",
                "uncertain_word_alignment",
            }
            continue
    if text_mismatch:
        raise UnsafeGroup("cut_text_mismatch")
    raise UnsafeGroup("no_verified_quiet_cut")


def validate_words(words: list[dict], duration: float) -> None:
    previous = 0.0
    if not words:
        raise UnsafeGroup("missing_speech")
    for word in words:
        start, end = float(word["start"]), float(word["end"])
        if (not math.isfinite(start) or not math.isfinite(end) or start < previous - 0.02
                or start < -1e-6 or end < start or end > duration + 0.04):
            raise UnsafeGroup("invalid_word_timestamps")
        previous = end


def transcribe(model, audio: np.ndarray) -> tuple[str, list[dict]]:
    samples = resample_poly(audio, 1, 3).astype(np.float32)
    segments, _ = model.transcribe(samples, language="zh", beam_size=5,
                                   vad_filter=False, condition_on_previous_text=False,
                                   word_timestamps=True)
    transcript, words = [], []
    for segment in segments:
        transcript.append(str(segment.text))
        for word in segment.words or []:
            if normalize(str(word.word)):
                words.append({"text": str(word.word), "start": float(word.start), "end": float(word.end)})
    return "".join(transcript).strip(), words


def trim_quiet_edges(audio: np.ndarray, first_start: float, last_end: float) -> tuple[np.ndarray, int, int]:
    levels, threshold = frame_levels(audio)
    active = np.flatnonzero(levels >= threshold)
    # Preserve at least 80 ms around acoustic activity AND timestamped words.
    first_active = int(active[0]) * FRAME
    last_active = min(audio.size, (int(active[-1]) + 1) * FRAME)
    start = max(0, min(first_active - int(WORD_GUARD * RATE),
                       math.floor((first_start - WORD_GUARD) * RATE)))
    end = min(audio.size, max(last_active + int(WORD_GUARD * RATE),
                             math.ceil((last_end + WORD_GUARD) * RATE)))
    if end <= start:
        raise UnsafeGroup("invalid_quiet_crop")
    result = audio[start:end].copy()
    # Fade only a complete quiet frame; never fade an active consonant.
    for trailing in (False, True):
        part = result[-FRAME:] if trailing else result[:FRAME]
        if part.size == FRAME and 20 * math.log10(max(float(np.sqrt(np.mean(part * part))), 1e-12)) < threshold:
            envelope = np.linspace(0, 1, FRAME)
            part *= envelope[::-1] if trailing else envelope
    return result, start, end


def measure_quiet(audio: np.ndarray) -> tuple[float, float]:
    levels, threshold = frame_levels(audio)
    active = np.flatnonzero(levels >= threshold)
    leading = int(active[0]) * 10.0
    trailing = max(0.0, (audio.size - min(audio.size, (int(active[-1]) + 1) * FRAME)) / RATE * 1000)
    return leading, trailing


def internal_pauses(_audio: np.ndarray, clauses: list[str], words: list[dict]) -> list[float]:
    pauses, accumulated = [], ""
    for clause in clauses[:-1]:
        accumulated += clause
        terminal = align_prefix(accumulated, words)
        if terminal + 1 >= len(words):
            raise UnsafeGroup("missing_internal_boundary")
        # The user-selected class-local recipe measures the adjacent ASR word
        # gap, including a legitimate zero, rounded to 1 ms. Energy thresholds
        # are for safe cuts/retained edge quiet, not a replacement pause recipe.
        milliseconds = (float(words[terminal + 1]["start"]) - float(words[terminal]["end"])) * 1000
        if milliseconds < -1e-6 or milliseconds > 1200:
            raise UnsafeGroup("uncertain_internal_pause")
        pauses.append(math.floor(max(0.0, milliseconds) + 0.5))
    return pauses


def analyze(model, audio: np.ndarray, expected: str, following: str, clauses: list[str]) -> tuple[np.ndarray, dict]:
    transcript, words = transcribe(model, audio)
    cut_validation = None
    if following:
        terminal = align_prefix(expected, words)
        # This strategy intentionally discards the distant suffix. Whisper may
        # hallucinate timestamps there; only the retained prefix and immediate
        # following word establish this crop. Never excuse bad retained timing.
        validate_words(words[:terminal + 2], audio.size / RATE)
        # Establish that the next speech really belongs to the supplied context.
        following_words = words[terminal + 1:]
        anchor = normalize(following)[:min(6, len(normalize(following)))]
        following_actual = "".join(normalize(word["text"]) for word in following_words)
        if not anchor or not following_actual.startswith(anchor):
            raise UnsafeGroup("unrecognized_continuation")
        cut, last_word, cut_validation = verified_opening_cut(model, audio, expected, following, words, terminal)
        end_sample = round(cut * RATE)
        excerpt = audio[:end_sample].copy()
    else:
        validate_words(words, audio.size / RATE)
        content_score(expected, transcript)
        end_sample = audio.size
        excerpt, last_word = audio.copy(), words[-1]
    processed, start, end = trim_quiet_edges(excerpt, words[0]["start"], last_word["end"])
    # A verified noise-floor interval remains real retained quiet even if it is
    # above the stricter generic edge detector. Count only its surviving tail.
    known_tail = retained_verified_tail_ms(start, end, cut_validation)
    _, strict_tail = measure_quiet(processed)
    if known_tail >= 10 and strict_tail < 10:
        processed[-FRAME:] *= np.linspace(1, 0, FRAME)
    # Independent ASR after the actual crop catches truncated endings, continuation
    # leakage and repetitions; timestamps from the uncropped source are insufficient.
    verified_transcript, verified_words = transcribe(model, processed)
    validate_words(verified_words, processed.size / RATE)
    coverage = content_score(expected, verified_transcript)
    content_score(expected, "".join(word["text"] for word in verified_words))
    if normalize("".join(clauses)) != normalize(expected):
        raise UnsafeGroup("clauses_do_not_cover_target")
    for index in range(1, len(clauses) + 1):
        align_prefix("".join(clauses[:index]), verified_words)
    pauses = internal_pauses(processed, clauses, verified_words)
    leading, trailing = measure_quiet(processed)
    trailing = max(trailing, known_tail)
    result = {
        "version": 1, "success": True, "internalPausesMs": pauses,
        "leadingQuietMs": round(leading, 1), "trailingQuietMs": round(trailing, 1),
        "transcript": verified_transcript, "coverage": round(coverage, 6),
        "cutStartSeconds": round(start / RATE, 6), "cutEndSeconds": round(end / RATE, 6),
        "asrModel": "faster-whisper-large-v3/cpu/int8",
    }
    if cut_validation:
        result["cutValidation"] = cut_validation
    return processed, result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    arguments = parser.parse_args()
    request_path = Path(arguments.request).resolve(strict=True)
    if request_path.stat().st_size > 65536:
        return 2
    request = json.loads(request_path.read_text(encoding="utf-8-sig"))
    allowed = {"version", "inputWav", "outputWav", "outputJson", "modelPath", "expectedText", "followingText", "clauses"}
    if set(request) != allowed or request["version"] != 1:
        return 2
    root = request_path.parent
    # Caller owns one fresh directory; output cannot escape it, even through a link.
    paths = {key: Path(request[key]).resolve() for key in ("inputWav", "outputWav", "outputJson")}
    if any(value.parent != root for value in paths.values()) or len(set(paths.values())) != 3:
        return 2
    output = paths["outputJson"]
    try:
        if (not isinstance(request["expectedText"], str) or not 1 <= len(request["expectedText"]) <= 500
                or not isinstance(request["followingText"], str) or len(request["followingText"]) > 1500
                or not isinstance(request["clauses"], list) or not 1 <= len(request["clauses"]) <= 32
                or any(not isinstance(item, str) or not item for item in request["clauses"])):
            raise UnsafeGroup("invalid_target")
        source = paths["inputWav"]
        if source.stat().st_size > 24 * 1024 * 1024:
            raise UnsafeGroup("audio_too_large")
        info = sf.info(source)
        if info.samplerate != RATE or info.channels != 1 or info.subtype != "PCM_16" or not 0 < info.duration <= 120:
            raise UnsafeGroup("invalid_audio")
        audio, _ = sf.read(source, dtype="float64")
        if not np.all(np.isfinite(audio)):
            raise UnsafeGroup("invalid_audio")
        from faster_whisper import WhisperModel
        model = WhisperModel(str(Path(request["modelPath"]).resolve(strict=True)), device="cpu", compute_type="int8",
                             cpu_threads=min(4, max(1, (os.cpu_count() or 2) // 2)), num_workers=1,
                             local_files_only=True)
        processed, result = analyze(model, audio, request["expectedText"], request["followingText"], request["clauses"])
        sf.write(paths["outputWav"], processed, RATE, subtype="PCM_16", format="WAV")
    except UnsafeGroup as error:
        result = {"version": 1, "success": False, "code": str(error)}
    except Exception:
        # Native/Python exception strings may include local paths or input text.
        result = {"version": 1, "success": False, "code": "analysis_failed"}
    output.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
