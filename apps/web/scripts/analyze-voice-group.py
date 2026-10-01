"""CPU-only, offline verification and quiet-boundary extraction of a voice group.

The JSON-file interface deliberately has no estimated/per-character cut fallback.
Uncertain speech alignment produces a diagnostic; the caller retains source audio.
Worker mode reuses one CPU model across a candidate's serial analysis requests.
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
CONTENT_THRESHOLD = 0.90
MAX_SUBSTITUTIONS = 2
EDIT_THRESHOLD = 0.85
_CONVERTER = OpenCC("t2s")


class UnsafeGroup(Exception):
    def __init__(self, code: str, *, alignment: dict | None = None, recognition: dict | None = None):
        super().__init__(code)
        self.alignment = alignment
        self.recognition = recognition


def bounded_text(value, limit: int) -> str:
    """Use the same UTF-16 size bound as the TypeScript JSON contract."""
    if not isinstance(value, str):
        return ""
    return value.encode("utf-16-le", errors="replace")[:limit * 2].decode("utf-16-le", errors="ignore")


def recognition_snapshot(recognition: dict) -> dict:
    stages = {"input_validation", "source_transcription", "source_alignment", "continuation_alignment",
              "boundary_check", "target_transcription", "target_validation", "complete", "unavailable"}
    result = {"stage": recognition.get("stage") if recognition.get("stage") in stages else "unavailable",
              "sourceTranscript": bounded_text(recognition.get("sourceTranscript"), 8000),
              "expectedText": bounded_text(recognition.get("expectedText"), 500)}
    for key, limit in (("followingText", 1500), ("targetTranscript", 8000)):
        if key in recognition:
            result[key] = bounded_text(recognition[key], limit)
    if isinstance(recognition.get("sourceWords"), list):
        words = []
        for word in recognition["sourceWords"][:2000]:
            if not isinstance(word, dict):
                continue
            start, end = word.get("start"), word.get("end")
            if (isinstance(start, (int, float)) and not isinstance(start, bool)
                    and isinstance(end, (int, float)) and not isinstance(end, bool)
                    and math.isfinite(start) and math.isfinite(end) and 0 <= start <= end <= 120.1):
                words.append({"text": bounded_text(word.get("text"), 200), "start": start, "end": end})
        result["sourceWords"] = words
    alignment = recognition.get("alignment")
    if isinstance(alignment, dict) and re.fullmatch(r"[a-z_]{1,80}", str(alignment.get("reason", ""))):
        result["alignment"] = {"expected": bounded_text(alignment.get("expected"), 1500),
                               "recognizedPrefix": bounded_text(alignment.get("recognizedPrefix"), 2000),
                               "reason": alignment["reason"]}
    comparison = recognition.get("contentComparison")
    if isinstance(comparison, dict):
        # Recompute the bounded public result instead of copying arbitrary fields.
        expected = bounded_text(comparison.get("expected"), 500)
        recognized = bounded_text(comparison.get("recognized"), 500)
        try:
            result["contentComparison"] = content_comparison(
                expected, recognized, allow_edits=comparison.get("mode") == "bounded_edits")
        except UnsafeGroup:
            pass
    candidates = recognition.get("endpointCandidates")
    if isinstance(candidates, list):
        result["endpointCandidates"] = [
            {"terminalWordIndex": item["terminalWordIndex"],
             "recognizedPrefix": bounded_text(item["recognizedPrefix"], 500),
             "similarity": item["similarity"]}
            for item in candidates[:8] if isinstance(item, dict)
            and isinstance(item.get("terminalWordIndex"), int)
            and not isinstance(item["terminalWordIndex"], bool) and 0 <= item["terminalWordIndex"] < 2000
            and isinstance(item.get("recognizedPrefix"), str)
            and isinstance(item.get("similarity"), (int, float)) and .85 <= item["similarity"] <= 1]
    boundary = recognition.get("boundaryMatch")
    if (isinstance(boundary, dict) and boundary.get("method") in ("ending_anchor", "api")
            and isinstance(boundary.get("terminalWordIndex"), int)
            and not isinstance(boundary["terminalWordIndex"], bool) and 0 <= boundary["terminalWordIndex"] < 2000
            and isinstance(boundary.get("anchorText"), str) and boundary["anchorText"]
            and isinstance(boundary.get("recognizedPrefix"), str)):
        result["boundaryMatch"] = {"method": boundary["method"], "terminalWordIndex": boundary["terminalWordIndex"],
                                   "anchorText": bounded_text(boundary["anchorText"], 40),
                                   "recognizedPrefix": bounded_text(boundary["recognizedPrefix"], 500)}
    return result


def update_recognition(recognition: dict, checkpoint=None, **changes) -> None:
    recognition.update(changes)
    snapshot = recognition_snapshot(recognition)
    recognition.clear()
    recognition.update(snapshot)
    if checkpoint is not None:
        checkpoint(snapshot)


def write_result(output: Path, result: dict) -> None:
    # A parent may read this checkpoint when a child times out. Publish a whole
    # JSON document atomically so interrupted writes do not destroy prior ASR.
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


def normalize(text: str) -> str:
    simplified = _CONVERTER.convert(text)
    return re.sub(r"[\W_]+", "", simplified, flags=re.UNICODE).lower().translate(
        str.maketrans({"地": "的", "得": "的"})
    )


def content_score(expected: str, actual: str, allow_substitutions: bool = False) -> float:
    """Check ordered content; bounded target substitutions require separate cut proof."""
    target, transcript = normalize(expected), normalize(actual)
    if not target or not transcript:
        raise UnsafeGroup("missing_speech")
    matcher = difflib.SequenceMatcher(None, target, transcript, autojunk=False)
    coverage = sum(block.size for block in matcher.get_matching_blocks()) / len(target)
    anchor = min(3, len(target))
    if (not allow_substitutions and (matcher.ratio() < 0.90 or coverage < 0.90
            or not 0.90 <= len(transcript) / len(target) <= 1.08
            or transcript[:anchor] != target[:anchor]
            or transcript[-anchor:] != target[-anchor:])):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    if allow_substitutions:
        if len(target) != len(transcript):
            raise UnsafeGroup("missing_or_extra_speech")
        substitutions = sum(left != right for left, right in zip(target, transcript))
        # Integer arithmetic makes the exact 90% boundary independent of rounding.
        if substitutions > MAX_SUBSTITUTIONS or substitutions * 10 > len(target):
            raise UnsafeGroup("incomplete_or_unrelated_speech")
        coverage = (len(target) - substitutions) / len(target)
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


def edit_alignment(target: str, transcript: str) -> tuple[list[list[int]], list[tuple]]:
    """Unit-cost ordered edit alignment; indexes are characters, never audio times."""
    rows, cols = len(target), len(transcript)
    distance = [[0] * (cols + 1) for _ in range(rows + 1)]
    for i in range(rows, -1, -1):
        distance[i][cols] = rows - i
    for j in range(cols, -1, -1):
        distance[rows][j] = cols - j
    for i in range(rows - 1, -1, -1):
        for j in range(cols - 1, -1, -1):
            distance[i][j] = min(distance[i + 1][j + 1] + (target[i] != transcript[j]),
                                 distance[i + 1][j] + 1, distance[i][j + 1] + 1)
    operations, i, j = [], 0, 0
    while i < rows or j < cols:
        if i < rows and j < cols and target[i] == transcript[j] and distance[i][j] == distance[i + 1][j + 1]:
            operations.append(("equal", i, j)); i += 1; j += 1
        elif i < rows and j < cols and distance[i][j] == distance[i + 1][j + 1] + 1:
            operations.append(("replace", i, j)); i += 1; j += 1
        elif i < rows and distance[i][j] == distance[i + 1][j] + 1:
            operations.append(("delete", i, j)); i += 1
        else:
            operations.append(("insert", i, j)); j += 1
    return distance, operations


def bounded_edit_comparison(target: str, transcript: str) -> dict:
    if not target or not transcript:
        raise UnsafeGroup("missing_speech")
    if len(target) < 10 or abs(len(target) - len(transcript)) > 2:
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    distance, operations = edit_alignment(target, transcript)
    edits, denominator = distance[0][0], max(len(target), len(transcript))
    if edits > 2 or edits * 100 > denominator * 15:
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    counts = Counter(op[0] for op in operations)
    removed = {target[i] for tag, i, _ in operations if tag == "delete"}
    added = {transcript[j] for tag, _, j in operations if tag == "insert"}
    changes = [op for op in operations if op[0] != "equal"]
    if removed & added or any(
            left[0] == right[0] == "replace"
            and target[left[1]] == transcript[right[2]] and target[right[1]] == transcript[left[2]]
            for left, right in zip(changes, changes[1:])):
        raise UnsafeGroup("reordered_speech")
    width = min(6, len(target))
    expected_counts = Counter(target[i:i + width] for i in range(len(target) - width + 1))
    actual_counts = Counter(transcript[i:i + width] for i in range(len(transcript) - width + 1))
    if any(count > max(1, expected_counts.get(gram, 0)) for gram, count in actual_counts.items()):
        raise UnsafeGroup("repeated_speech")
    return {"mode": "bounded_edits", "status": "different" if edits else "matched",
            "similarity": round(1 - edits / denominator, 6), "threshold": EDIT_THRESHOLD,
            "substitutionCount": counts["replace"], "insertionCount": counts["insert"],
            "deletionCount": counts["delete"], "editCount": edits, "expected": target, "recognized": transcript}


def content_comparison(expected: str, actual: str, allow_edits: bool = False) -> dict:
    try:
        similarity = content_score(expected, actual, allow_substitutions=True)
    except UnsafeGroup:
        if not allow_edits:
            raise
        return bounded_edit_comparison(normalize(expected), normalize(actual))
    target, transcript = normalize(expected), normalize(actual)
    substitutions = sum(left != right for left, right in zip(target, transcript))
    return {"status": "different" if substitutions else "matched", "similarity": round(similarity, 6),
            "threshold": CONTENT_THRESHOLD, "substitutionCount": substitutions,
            "expected": target, "recognized": transcript}


def align_prefix(expected: str, words: list[dict], allow_substitutions: bool = False) -> int:
    """Align only whole ASR words; never divide a timestamp by character count."""
    target = normalize(expected)
    accumulated = ""
    candidates = []
    for index, word in enumerate(words):
        accumulated += normalize(word["text"])
        try:
            coverage = content_score(target, accumulated, allow_substitutions=allow_substitutions)
            candidates.append((coverage, -abs(len(accumulated) - len(target)), index))
        except UnsafeGroup:
            pass
        if len(accumulated) > len(target) * 1.15 + 3:
            break
    if not candidates:
        raise UnsafeGroup("uncertain_word_alignment", alignment={
            "expected": bounded_text(target, 1500), "recognizedPrefix": bounded_text(accumulated, 2000),
            "reason": "uncertain_word_alignment",
        })
    return max(candidates)[2]


def bounded_endpoint_candidates(expected: str, words: list[dict]) -> list[dict]:
    target, accumulated, candidates = normalize(expected), "", []
    if len(target) < 10:
        return []
    for index, word in enumerate(words[:2000]):
        accumulated += normalize(word["text"])
        if len(accumulated) > len(target) + 2:
            break
        if not normalize(word["text"]) or accumulated[:2] != target[:2]:
            continue
        try:
            comparison = content_comparison(target, accumulated, allow_edits=True)
            candidates.append({"terminalWordIndex": index, "recognizedPrefix": accumulated,
                               "similarity": comparison["similarity"]})
        except UnsafeGroup:
            pass
    return candidates[:8]


def continuation_matches(following: str, words: list[dict], terminal: int) -> bool:
    anchor = normalize(following)[:6]
    return bool(anchor and "".join(normalize(word["text"]) for word in words[terminal + 1:]).startswith(anchor))


def align_target(expected: str, words: list[dict], following: str,
                 alignment_hint: dict | None = None) -> tuple[int, dict | None]:
    """Locate an opening by content and existing whole-word endpoints, then prove its cut."""
    strict_terminal = None
    if alignment_hint is None:
        try:
            terminal = align_prefix(expected, words, allow_substitutions=True)
            strict_terminal = terminal
            if continuation_matches(following, words, terminal):
                return terminal, None
        except UnsafeGroup:
            pass
    target = normalize(expected)
    candidates = bounded_endpoint_candidates(expected, words)
    candidates = [item for item in candidates if continuation_matches(following, words, item["terminalWordIndex"])]
    if alignment_hint is not None:
        selected = [item for item in candidates
                    if item["terminalWordIndex"] == alignment_hint.get("terminalWordIndex")
                    and item["recognizedPrefix"] == alignment_hint.get("recognizedPrefix")]
        method = "api"
    else:
        selected = [item for item in candidates if item["recognizedPrefix"].endswith(target[-2:])]
        # The immediate continuation also has to agree. Distant repeats cannot
        # move the opening endpoint, and two plausible endpoints remain ambiguous.
        method = "ending_anchor"
    if len(selected) != 1:
        if not selected and strict_terminal is not None:
            return strict_terminal, None
        reason = "ambiguous_ending_anchor" if len(selected) > 1 else "uncertain_word_alignment"
        raise UnsafeGroup(reason, alignment={"expected": target,
                          "recognizedPrefix": "".join(normalize(word["text"]) for word in words)[:len(target) + 5],
                          "reason": reason})
    chosen = selected[0]
    anchor = chosen["recognizedPrefix"][-2:]
    if method == "ending_anchor":
        for width in range(3, min(6, len(target)) + 1):
            if chosen["recognizedPrefix"].endswith(target[-width:]):
                anchor = target[-width:]
            else:
                break
    return chosen["terminalWordIndex"], {"method": method, **{key: chosen[key] for key in ("terminalWordIndex", "recognizedPrefix")},
                                        "anchorText": anchor}


def check_target_text(expected: str, actual: str, allow_edits: bool = False, ending_anchor: str = "") -> dict:
    comparison = content_comparison(expected, actual, allow_edits=allow_edits)
    if ending_anchor and not normalize(actual).endswith((ending_anchor, normalize(expected)[-2:])):
        raise UnsafeGroup("cut_text_mismatch")
    return comparison


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
                         words: list[dict], terminal: int, recognition: dict | None = None,
                         checkpoint=None, require_two_sided: bool = False,
                         allow_edits: bool = False, ending_anchor: str = "") -> tuple[float, dict, dict | None]:
    if not require_two_sided:
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
        if recognition is not None:
            # Each cut has its own independent recognition. A previous cut's
            # failure must not be paired with this cut's transcript/checkpoint.
            recognition.pop("alignment", None)
            recognition.pop("targetTranscript", None)
            recognition.pop("contentComparison", None)
            update_recognition(recognition, checkpoint)
        cut = candidate["cut"]
        cut_sample = round(cut * RATE)
        right_end = min(audio.size, math.ceil((float(words[following_end]["end"]) + .65) * RATE))
        if cut_sample <= 0 or right_end <= cut_sample:
            continue
        try:
            left_transcript, left_words = transcribe(model, audio[:cut_sample])
            if recognition is not None:
                update_recognition(recognition, checkpoint, targetTranscript=left_transcript)
            validate_words(left_words, cut_sample / RATE)
            check_target_text(expected, left_transcript, allow_edits, ending_anchor)
            left_word_text = "".join(word["text"] for word in left_words)
            check_target_text(expected, left_word_text, allow_edits, ending_anchor)
            if normalize(left_transcript) != normalize(left_word_text):
                raise UnsafeGroup("inconsistent_recognition")
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
            if recognition is not None:
                recognition.pop("alignment", None)
                update_recognition(recognition, checkpoint)
            return cut, left_words[-1], validation
        except UnsafeGroup as error:
            if recognition is not None and error.alignment:
                update_recognition(recognition, checkpoint, alignment=error.alignment)
            # A real quiet interval can still fail independent recognition.
            # Preserve that distinction instead of reporting every rejection
            # as though no usable pause existed.
            text_mismatch |= str(error) in {
                "missing_speech", "incomplete_or_unrelated_speech",
                "missing_or_extra_speech", "repeated_speech",
                "uncertain_word_alignment",
                "inconsistent_recognition",
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


def resolve_clause_boundaries(expected: str, clauses: list[str], words: list[dict],
                              allow_edits: bool = False) -> list[int]:
    """Map approved text through unique edit positions to actual whole-word ends."""
    if normalize("".join(clauses)) != normalize(expected):
        raise UnsafeGroup("clauses_do_not_cover_target")
    target, actual = normalize(expected), "".join(normalize(word["text"]) for word in words)
    comparison = content_comparison(target, actual, allow_edits=allow_edits)
    boundaries, length = {}, 0
    for index, word in enumerate(words):
        length += len(normalize(word["text"]))
        boundaries[length] = index
    # Equal-length substitutions keep the historical exact character mapping.
    # For insertions/deletions, inspect ALL optimal edit paths at each clause
    # boundary; a guessed path must not turn an ambiguous text boundary into time.
    suffix = prefix = None
    deleted = set()
    if comparison.get("mode") == "bounded_edits" and (comparison["insertionCount"] or comparison["deletionCount"]):
        suffix, operations = edit_alignment(target, actual)
        reverse, _ = edit_alignment(target[::-1], actual[::-1])
        prefix = [[reverse[len(target) - i][len(actual) - j] for j in range(len(actual) + 1)]
                  for i in range(len(target) + 1)]
        deleted = {i + 1 for tag, i, _ in operations if tag == "delete"}
    positions, length = [], 0
    for clause in clauses:
        length += len(normalize(clause))
        mapped = length
        if suffix is not None:
            possible = [j for j in range(len(actual) + 1) if prefix[length][j] + suffix[length][j] == suffix[0][0]]
            if len(possible) != 1 or length in deleted:
                raise UnsafeGroup("missing_internal_boundary")
            mapped = possible[0]
        if mapped not in boundaries or (positions and boundaries[mapped] <= positions[-1]):
            raise UnsafeGroup("missing_internal_boundary")
        positions.append(boundaries[mapped])
    return positions


def internal_pauses(_audio: np.ndarray, clauses: list[str], words: list[dict],
                    boundaries: list[int] | None = None) -> list[float]:
    pauses, accumulated = [], ""
    for index, clause in enumerate(clauses[:-1]):
        accumulated += clause
        terminal = boundaries[index] if boundaries is not None else align_prefix(accumulated, words)
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


def _analyze(model, audio: np.ndarray, expected: str, following: str, clauses: list[str],
             recognition: dict, checkpoint, alignment_hint: dict | None = None) -> tuple[np.ndarray, dict]:
    update_recognition(recognition, checkpoint, stage="source_transcription")
    transcript, words = transcribe(model, audio)
    update_recognition(recognition, checkpoint, stage="source_alignment", sourceTranscript=transcript, sourceWords=words)
    require_two_sided = False
    boundary_match = None
    if following:
        try:
            terminal, boundary_match = align_target(expected, words, following, alignment_hint)
        except UnsafeGroup:
            update_recognition(recognition, checkpoint, endpointCandidates=bounded_endpoint_candidates(expected, words))
            raise
        if boundary_match:
            update_recognition(recognition, checkpoint, boundaryMatch=boundary_match)
        source_comparison = content_comparison(expected, "".join(word["text"] for word in words[:terminal + 1]),
                                               allow_edits=boundary_match is not None)
        require_two_sided = boundary_match is not None or source_comparison["status"] == "different"
        # This strategy intentionally discards the distant suffix. Whisper may
        # hallucinate timestamps there; only the retained prefix and immediate
        # following word establish this crop. Never excuse bad retained timing.
        validate_words(words[:terminal + 2], audio.size / RATE)
        # Establish that the next speech really belongs to the supplied context.
        update_recognition(recognition, checkpoint, stage="continuation_alignment")
        following_words = words[terminal + 1:]
        anchor = normalize(following)[:min(6, len(normalize(following)))]
        following_actual = "".join(normalize(word["text"]) for word in following_words)
        if not anchor or not following_actual.startswith(anchor):
            raise UnsafeGroup("unrecognized_continuation", alignment={
                "expected": anchor, "recognizedPrefix": bounded_text(following_actual, 2000),
                "reason": "unrecognized_continuation",
            })
    else:
        validate_words(words, audio.size / RATE)
        content_score(expected, transcript, allow_substitutions=True)
    # Preserve the exact-content fast path. If only the independent crop ASR
    # reveals a substitution, establish two-sided evidence before accepting it.
    # This is a bounded extra analysis pass, never a second native generation.
    for _ in range(2):
        cut_validation = None
        if following:
            recognition.pop("alignment", None)
            recognition.pop("targetTranscript", None)
            recognition.pop("contentComparison", None)
            update_recognition(recognition, checkpoint, stage="boundary_check")
            cut, last_word, cut_validation = verified_opening_cut(
                model, audio, expected, following, words, terminal,
                recognition, checkpoint, require_two_sided=require_two_sided,
                allow_edits=boundary_match is not None, ending_anchor=boundary_match["anchorText"] if boundary_match else "")
            excerpt = audio[:round(cut * RATE)].copy()
        else:
            excerpt, last_word = audio.copy(), words[-1]
        processed, start, end = trim_quiet_edges(excerpt, words[0]["start"], last_word["end"])
        # A verified noise-floor interval remains retained quiet even when above
        # the generic edge detector. Count only its surviving tail.
        known_tail = retained_verified_tail_ms(start, end, cut_validation)
        _, strict_tail = measure_quiet(processed)
        if known_tail >= 10 and strict_tail < 10:
            processed[-FRAME:] *= np.linspace(1, 0, FRAME)
        recognition.pop("alignment", None)
        recognition.pop("targetTranscript", None)
        recognition.pop("contentComparison", None)
        update_recognition(recognition, checkpoint, stage="target_transcription")
        verified_transcript, verified_words = transcribe(model, processed)
        update_recognition(recognition, checkpoint, stage="target_validation", targetTranscript=verified_transcript)
        validate_words(verified_words, processed.size / RATE)
        comparison = check_target_text(expected, verified_transcript, boundary_match is not None,
                                       boundary_match["anchorText"] if boundary_match else "")
        word_text = "".join(word["text"] for word in verified_words)
        check_target_text(expected, word_text, boundary_match is not None,
                          boundary_match["anchorText"] if boundary_match else "")
        if normalize(verified_transcript) != normalize(word_text):
            raise UnsafeGroup("inconsistent_recognition")
        if following and comparison["status"] == "different" and cut_validation is None:
            require_two_sided = True
            continue
        break
    else:
        raise UnsafeGroup("no_verified_quiet_cut")
    boundaries = resolve_clause_boundaries(expected, clauses, verified_words, allow_edits=boundary_match is not None)
    pauses = internal_pauses(processed, clauses, verified_words, boundaries=boundaries)
    update_recognition(recognition, checkpoint, contentComparison=comparison)
    leading, trailing = measure_quiet(processed)
    trailing = max(trailing, known_tail)
    result = {
        "version": 1, "success": True, "internalPausesMs": pauses,
        "leadingQuietMs": round(leading, 1), "trailingQuietMs": round(trailing, 1),
        "transcript": verified_transcript, "coverage": comparison["similarity"],
        "cutStartSeconds": round(start / RATE, 6), "cutEndSeconds": round(end / RATE, 6),
        "asrModel": "faster-whisper-large-v3/cpu/int8",
    }
    if cut_validation:
        result["cutValidation"] = cut_validation
    return processed, result


def analyze(model, audio: np.ndarray, expected: str, following: str, clauses: list[str],
            recognition: dict | None = None, checkpoint=None, alignment_hint: dict | None = None) -> tuple[np.ndarray, dict]:
    if recognition is None:
        recognition = {"stage": "source_transcription", "sourceTranscript": "",
                       "expectedText": expected, "followingText": following}
    try:
        processed, result = _analyze(model, audio, expected, following, clauses, recognition, checkpoint, alignment_hint)
    except UnsafeGroup as error:
        if error.alignment:
            update_recognition(recognition, checkpoint, alignment=error.alignment)
        error.recognition = recognition_snapshot(recognition)
        raise
    except Exception:
        # Keep accumulated ASR while keeping native exception text/paths private.
        raise UnsafeGroup("analysis_failed", recognition=recognition_snapshot(recognition)) from None
    recognition.pop("alignment", None)
    update_recognition(recognition, checkpoint, stage="complete")
    result["recognition"] = recognition_snapshot(recognition)
    return processed, result


def load_model(model_path: str):
    from faster_whisper import WhisperModel
    return WhisperModel(str(Path(model_path).resolve(strict=True)), device="cpu", compute_type="int8",
                        cpu_threads=min(4, max(1, (os.cpu_count() or 2) // 2)), num_workers=1,
                        local_files_only=True)


def process_request(request_file: str, model_provider=load_model) -> int:
    request_path = Path(request_file).resolve(strict=True)
    if request_path.stat().st_size > 65536:
        return 2
    request = json.loads(request_path.read_text(encoding="utf-8-sig"))
    allowed = {"version", "inputWav", "outputWav", "outputJson", "modelPath", "expectedText", "followingText", "clauses"}
    if set(request) not in (allowed, allowed | {"alignmentHint"}) or request["version"] != 1:
        return 2
    alignment_hint = request.get("alignmentHint")
    if alignment_hint is not None and (not isinstance(alignment_hint, dict)
            or set(alignment_hint) != {"terminalWordIndex", "recognizedPrefix"}
            or not isinstance(alignment_hint["terminalWordIndex"], int) or isinstance(alignment_hint["terminalWordIndex"], bool)
            or not 0 <= alignment_hint["terminalWordIndex"] < 2000
            or not isinstance(alignment_hint["recognizedPrefix"], str) or not 1 <= len(alignment_hint["recognizedPrefix"]) <= 500):
        return 2
    root = request_path.parent
    # Caller owns one fresh directory; output cannot escape it, even through a link.
    paths = {key: Path(request[key]).resolve() for key in ("inputWav", "outputWav", "outputJson")}
    if any(value.parent != root for value in paths.values()) or len(set(paths.values())) != 3:
        return 2
    output = paths["outputJson"]
    recognition = recognition_snapshot({"stage": "input_validation", "sourceTranscript": "",
                                        "expectedText": request["expectedText"],
                                        "followingText": request["followingText"]})

    def checkpoint(snapshot: dict) -> None:
        try:
            write_result(output, {"version": 1, "success": False, "code": "analysis_incomplete",
                                  "recognition": snapshot})
        except OSError:
            # Best effort while analyzing; final publication still reports any
            # filesystem failure to the parent through the process exit status.
            pass

    checkpoint(recognition)
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
        update_recognition(recognition, checkpoint, stage="source_transcription")
        model = model_provider(request["modelPath"])
        processed, result = analyze(model, audio, request["expectedText"], request["followingText"], request["clauses"],
                                    recognition, checkpoint, alignment_hint=alignment_hint)
        sf.write(paths["outputWav"], processed, RATE, subtype="PCM_16", format="WAV")
    except UnsafeGroup as error:
        code = str(error) if re.fullmatch(r"[a-z_]{1,80}", str(error)) else "analysis_failed"
        result = {"version": 1, "success": False, "code": code,
                  "recognition": error.recognition or recognition_snapshot(recognition)}
    except Exception:
        # Native/Python exception strings may include local paths or input text.
        result = {"version": 1, "success": False, "code": "analysis_failed",
                  "recognition": recognition_snapshot(recognition)}
    write_result(output, result)
    return 0


def worker(model_path: str, incoming=None, outgoing=None) -> int:
    incoming = sys.stdin if incoming is None else incoming
    outgoing = sys.stdout if outgoing is None else outgoing
    model = None
    configured_path = Path(model_path).resolve()

    def get_model(requested_path: str):
        nonlocal model
        if Path(requested_path).resolve() != configured_path:
            raise ValueError("worker_model_mismatch")
        if model is None:
            model = load_model(str(configured_path))
        return model

    while True:
        line = incoming.readline(8193)
        if not line:
            return 0
        if len(line) > 8192:
            return 2
        try:
            command = json.loads(line)
            if set(command) != {"requestPath"} or not isinstance(command["requestPath"], str):
                return 2
            request_path = command["requestPath"]
            try:
                code = process_request(request_path, get_model)
            except Exception:
                code = 2
            # Completion is sent only after all file handles for this request
            # have closed, so the caller may safely delete its scratch folder.
            outgoing.write(json.dumps({"requestPath": request_path, "code": code}) + "\n")
            outgoing.flush()
        except (ValueError, TypeError):
            return 2


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--request")
    mode.add_argument("--worker", action="store_true")
    parser.add_argument("--model")
    arguments = parser.parse_args()
    if arguments.worker:
        if not arguments.model:
            parser.error("--worker requires --model")
        return worker(arguments.model)
    return process_request(arguments.request)


if __name__ == "__main__":
    sys.exit(main())
