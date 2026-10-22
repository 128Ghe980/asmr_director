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

try:
    from pypinyin import Style as _PinyinStyle, lazy_pinyin as _lazy_pinyin
except ImportError:
    # Optional local text rule only. Missing it must not disable the ASR worker.
    _PinyinStyle = _lazy_pinyin = None

RATE = 48000
FRAME = RATE // 100  # 10 ms; never infer a speech boundary from text length.
WORD_GUARD = 0.080
CONTENT_THRESHOLD = 0.90
MAX_SUBSTITUTIONS = 2
EDIT_THRESHOLD = 0.85
INTERNAL_PAUSE_OBSERVATION_MAX_MS = 10_000
PHONETIC_THRESHOLD = .95
PHONETIC_PROTECTED = frozenset("不没无非别未莫勿否甭零〇一二三四五六七八九十百千万亿两")
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
    if recognition.get("analysisMode") == "cutting_only":
        result["analysisMode"] = "cutting_only"
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
            if comparison.get("mode") == "phonetic_substitutions":
                result["contentComparison"] = phonetic_snapshot(comparison, result)
            elif comparison.get("mode") == "sentence_particle":
                result["contentComparison"] = sentence_particle_snapshot(comparison, result)
            else:
                result["contentComparison"] = content_comparison(
                    expected, recognized, allow_edits=comparison.get("mode") == "bounded_edits")
        except UnsafeGroup:
            pass
    boundary_evidence = recognition.get("followingPhoneticBoundary")
    if isinstance(boundary_evidence, dict) and result["stage"] == "complete":
        try:
            result["followingPhoneticBoundary"] = following_boundary_snapshot(boundary_evidence, result)
        except UnsafeGroup:
            pass
    review = recognition.get("shortSentenceReview")
    if isinstance(review, dict) and result["stage"] == "complete":
        try:
            result["shortSentenceReview"] = short_sentence_review_snapshot(review, result)
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
    bridge = recognition.get("continuationBridge")
    if isinstance(bridge, dict) and result["stage"] == "complete":
        index, start, end = bridge.get("sourceWordIndex"), bridge.get("sourceStartSeconds"), bridge.get("sourceEndSeconds")
        if (bridge.get("kind") == "leading_hmm" and bridge.get("text") == "嗯"
                and isinstance(index, int) and not isinstance(index, bool) and 0 <= index < 2000
                and isinstance(start, (int, float)) and not isinstance(start, bool)
                and isinstance(end, (int, float)) and not isinstance(end, bool)
                and math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= 120.1
                and isinstance(bridge.get("rightTranscript"), str)
                and result.get("contentComparison", {}).get("status") == "matched"
                and "boundaryMatch" not in result):
            result["continuationBridge"] = {"kind": "leading_hmm", "text": "嗯", "sourceWordIndex": index,
                                            "sourceStartSeconds": start, "sourceEndSeconds": end,
                                            "rightTranscript": bounded_text(bridge["rightTranscript"], 1500)}
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


def phonetic_comparison(expected: str, actual: str, source_prefix: str, clauses: list[str] | None) -> dict:
    """Bounded pronunciation evidence, never a semantic or acoustic correctness claim."""
    target, transcript, source = normalize(expected), normalize(actual), normalize(source_prefix)
    if _lazy_pinyin is None or len(target) < 10 or len(target) != len(transcript) or len(source) != len(target):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    # This slice only refines a target already located through the old 90% path.
    content_score(target, source, allow_substitutions=True)
    differences = [(index, left, right) for index, (left, right) in enumerate(zip(target, transcript)) if left != right]
    if not 1 <= len(differences) <= 2:
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    matcher = difflib.SequenceMatcher(None, target, transcript, autojunk=False)
    if any(tag in ("insert", "delete") or (tag == "replace" and end - start != actual_end - actual_start)
           for tag, start, end, actual_start, actual_end in matcher.get_opcodes()):
        raise UnsafeGroup("missing_or_extra_speech")
    if any(left[1] == right[2] and right[1] == left[2] for left, right in zip(differences, differences[1:])):
        raise UnsafeGroup("reordered_speech")
    width = min(6, len(target))
    expected_counts = Counter(target[index:index + width] for index in range(len(target) - width + 1))
    actual_counts = Counter(transcript[index:index + width] for index in range(len(transcript) - width + 1))
    if any(count > max(1, expected_counts.get(gram, 0)) for gram, count in actual_counts.items()):
        raise UnsafeGroup("repeated_speech")
    clause_ends, length = set(), 0
    if clauses and normalize("".join(clauses)) == target:
        for clause in clauses:
            length += len(normalize(clause))
            clause_ends.add(length)
    try:
        expected_pinyin = _lazy_pinyin(target, style=_PinyinStyle.TONE3, neutral_tone_with_five=True)
        actual_pinyin = _lazy_pinyin(transcript, style=_PinyinStyle.TONE3, neutral_tone_with_five=True)
    except Exception:
        raise UnsafeGroup("incomplete_or_unrelated_speech") from None
    if len(expected_pinyin) != len(target) or len(actual_pinyin) != len(target):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    evidence, cost_quarters, tone_changes = [], 0, 0
    for index, left, right in differences:
        if (not re.fullmatch(r"[\u3400-\u9fff]", left) or not re.fullmatch(r"[\u3400-\u9fff]", right)
                or left in PHONETIC_PROTECTED or right in PHONETIC_PROTECTED or left.isnumeric() or right.isnumeric()):
            raise UnsafeGroup("incomplete_or_unrelated_speech")
        left_pinyin, right_pinyin = expected_pinyin[index], actual_pinyin[index]
        if not all(re.fullmatch(r"[a-zv]{1,12}[1-5]", item) for item in (left_pinyin, right_pinyin)):
            raise UnsafeGroup("incomplete_or_unrelated_speech")
        item = {"index": index, "expected": left, "recognized": right,
                "expectedPinyin": left_pinyin, "recognizedPinyin": right_pinyin}
        if ({left, right} == {"啦", "了"} and {left_pinyin, right_pinyin} == {"la5", "le5"}
                and index + 1 in clause_ends):
            item.update(rule="sentence_particle", clauseEnd=True)
            cost_quarters += 1
        elif left_pinyin == right_pinyin:
            item["rule"] = "same_tone"
        elif left_pinyin[:-1] == right_pinyin[:-1] and source[index] == left:
            tone_changes += 1
            item.update(rule="source_supported_tone", sourceCharacter=source[index])
            cost_quarters += 1
        else:
            raise UnsafeGroup("incomplete_or_unrelated_speech")
        evidence.append(item)
    if tone_changes > 1 or cost_quarters * 5 > len(target):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    return {"mode": "phonetic_substitutions", "status": "different",
            "similarity": round((len(target) - len(differences)) / len(target), 6), "threshold": CONTENT_THRESHOLD,
            "phoneticSimilarity": round(1 - cost_quarters / (4 * len(target)), 6), "phoneticThreshold": PHONETIC_THRESHOLD,
            "substitutionCount": len(differences), "expected": target, "recognized": transcript,
            "sourcePrefix": source, "differences": evidence}


def phonetic_snapshot(comparison: dict, recognition: dict) -> dict:
    """Recompute public scores/pinyin and require the original ASR prefix provenance."""
    expected, actual = bounded_text(comparison.get("expected"), 500), bounded_text(comparison.get("recognized"), 500)
    source = bounded_text(comparison.get("sourcePrefix"), 500)
    if (expected != normalize(recognition.get("expectedText", ""))
            or not isinstance(comparison.get("differences"), list)
            or not 1 <= len(comparison["differences"]) <= 2):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    accumulated, endpoint = "", False
    for word in recognition.get("sourceWords", []):
        accumulated += normalize(word["text"])
        if len(accumulated) >= len(expected):
            endpoint = accumulated == source
            break
    if not endpoint or not normalize(recognition.get("sourceTranscript", "")).startswith(source):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    # Creation validates these flags against the original request clauses. Only
    # retain already-present bounded flags; never infer a clause end from pinyin.
    endings = sorted({item["index"] + 1 for item in comparison.get("differences", [])
                      if isinstance(item, dict) and item.get("rule") == "sentence_particle"
                      and item.get("clauseEnd") is True and isinstance(item.get("index"), int)
                      and not isinstance(item["index"], bool) and 0 <= item["index"] < len(expected)})
    offsets = [0] + endings + ([len(expected)] if not endings or endings[-1] != len(expected) else [])
    clauses = [expected[left:right] for left, right in zip(offsets, offsets[1:])]
    result = phonetic_comparison(expected, actual, source, clauses)
    if comparison.get("differences") != result["differences"]:
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    return result


def sentence_particle_text(text: str) -> str:
    # The short-sentence exception requires a literal prefix, including 的/地/得.
    return re.sub(r"[\W_]+", "", _CONVERTER.convert(text), flags=re.UNICODE).lower()


def sentence_particle_comparison(expected: str, actual: str, source_prefix: str,
                                 clauses: list[str] | None) -> dict:
    """An opt-in final neutral particle, never a relaxed percentage/pinyin budget."""
    target, transcript, source = map(sentence_particle_text, (expected, actual, source_prefix))
    if (_lazy_pinyin is None or not re.fullmatch(r"[\u3400-\u9fff]{3,9}", target)
            or len(target) != len(transcript) or len(source) != len(target)
            or target[:-1] != transcript[:-1] or target[:-1] != source[:-1]
            or {target[-1], transcript[-1]} != {"啦", "了"}
            or source[-1] not in {target[-1], transcript[-1]}
            or not re.search(r"[。！？.!?][\s\u201d\u2019\"'）)\u300d\u300f]*$", expected)
            or not clauses or sentence_particle_text("".join(clauses)) != target):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    try:
        expected_pinyin = _lazy_pinyin(target, style=_PinyinStyle.TONE3, neutral_tone_with_five=True)
        actual_pinyin = _lazy_pinyin(transcript, style=_PinyinStyle.TONE3, neutral_tone_with_five=True)
    except Exception:
        raise UnsafeGroup("incomplete_or_unrelated_speech") from None
    if (len(expected_pinyin) != len(target) or len(actual_pinyin) != len(target)
            or expected_pinyin[:-1] != actual_pinyin[:-1]
            or (expected_pinyin[-1], actual_pinyin[-1]) != (("la5", "le5") if target[-1] == "啦" else ("le5", "la5"))):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    return {"mode": "sentence_particle", "status": "different",
            "similarity": round((len(target) - 1) / len(target), 6), "threshold": CONTENT_THRESHOLD,
            "substitutionCount": 1, "expected": target, "recognized": transcript, "sourcePrefix": source,
            "acceptanceRule": "exact_prefix_final_particle", "differences": [{
                "index": len(target) - 1, "expected": target[-1], "recognized": transcript[-1],
                "expectedPinyin": expected_pinyin[-1], "recognizedPinyin": actual_pinyin[-1],
                "rule": "sentence_particle", "clauseEnd": True}]}


def sentence_particle_snapshot(comparison: dict, recognition: dict) -> dict:
    expected = recognition.get("expectedText", "")
    source = bounded_text(comparison.get("sourcePrefix"), 500)
    accumulated, endpoint, previous = "", False, 0.0
    for word in recognition.get("sourceWords", []):
        if word["end"] <= word["start"] or word["start"] < previous - .02:
            raise UnsafeGroup("invalid_word_timestamps")
        previous = word["end"]
        accumulated += sentence_particle_text(word["text"])
        if len(accumulated) >= len(source):
            endpoint = accumulated == source
            break
    if (not endpoint or not sentence_particle_text(recognition.get("sourceTranscript", "")).startswith(source)
            or sentence_particle_text(recognition.get("targetTranscript", "")) != comparison.get("recognized")):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    if not recognition.get("followingText", "").strip() and (
            sentence_particle_text(recognition.get("sourceTranscript", "")) != source
            or sentence_particle_text("".join(word["text"] for word in recognition.get("sourceWords", []))) != source):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    result = sentence_particle_comparison(expected, recognition["targetTranscript"], source, [expected])
    # Reject forged rule, score and pinyin fields rather than laundering a partial record.
    if comparison != result:
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    return result


def missing_short_particle(expected: str, transcript: str, words: list[dict], clauses: list[str] | None) -> bool:
    """Only one omitted final neutral particle can request a quiet-edge recheck."""
    target = sentence_particle_text(expected)
    if (_lazy_pinyin is None or not re.fullmatch(r"[\u3400-\u9fff]{3,9}", target) or target[-1:] not in {"啦", "了"}
            or not re.search(r"[。！？.!?][\s\u201d\u2019\"'）)\u300d\u300f]*$", expected)
            or not clauses or sentence_particle_text("".join(clauses)) != target
            or sentence_particle_text(transcript) != target[:-1]
            or sentence_particle_text("".join(word["text"] for word in words)) != target[:-1]
            or not words or any(word["end"] <= word["start"] for word in words)):
        return False
    try:
        pinyin = _lazy_pinyin(target, style=_PinyinStyle.TONE3, neutral_tone_with_five=True)
        return len(pinyin) == len(target) and pinyin[-1] == ("la5" if target[-1] == "啦" else "le5")
    except Exception:
        return False


def short_review_source(expected: str, source_prefix: str, clauses: list[str]) -> dict:
    target, source = sentence_particle_text(expected), sentence_particle_text(source_prefix)
    if (_lazy_pinyin is None or not re.fullmatch(r"[\u3400-\u9fff]{3,9}", target)
            or len(clauses) != 1 or sentence_particle_text(clauses[0]) != target
            or len(source) != len(target) or source[:-1] != target[:-1]
            or target[-1:] not in {"啦", "了"} or source[-1:] not in {"啦", "了"}
            or not re.search(r"[。！？.!?][\s\u201d\u2019\"'）)\u300d\u300f]*$", expected)):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    try:
        expected_pinyin = _lazy_pinyin(target, style=_PinyinStyle.TONE3, neutral_tone_with_five=True)
        source_pinyin = _lazy_pinyin(source, style=_PinyinStyle.TONE3, neutral_tone_with_five=True)
    except Exception:
        raise UnsafeGroup("incomplete_or_unrelated_speech") from None
    if (len(expected_pinyin) != len(target) or len(source_pinyin) != len(target)
            or expected_pinyin[-1] != ("la5" if target[-1] == "啦" else "le5")
            or source_pinyin[-1] != ("la5" if source[-1] == "啦" else "le5")):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    return {"expected": target, "sourcePrefix": source, "expectedPinyin": expected_pinyin[-1], "sourcePinyin": source_pinyin[-1]}


def short_review_scope(expected: str, clauses: list[str]) -> bool:
    target = sentence_particle_text(expected)
    return bool(re.fullmatch(r"[\u3400-\u9fff]{3,9}", target) and len(clauses) == 1
        and sentence_particle_text(clauses[0]) == target
        and re.search(r"[。！？.!?][\s\u201d\u2019\"'）)\u300d\u300f]*$", expected))


def short_same_tone_difference(expected: str, actual: str) -> dict:
    target, recognized = sentence_particle_text(expected), sentence_particle_text(actual)
    if _lazy_pinyin is None or not re.fullmatch(r"[\u3400-\u9fff]{3,9}", target) or len(target) != len(recognized):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    changes = [(index, left, right) for index, (left, right) in enumerate(zip(target, recognized)) if left != right]
    if len(changes) != 1:
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    index, left, right = changes[0]
    if (not re.fullmatch(r"[\u3400-\u9fff]", right) or left in PHONETIC_PROTECTED or right in PHONETIC_PROTECTED
            or left.isnumeric() or right.isnumeric()):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    try:
        original_pinyin = _lazy_pinyin(target, style=_PinyinStyle.TONE3, neutral_tone_with_five=True)
        recognized_pinyin = _lazy_pinyin(recognized, style=_PinyinStyle.TONE3, neutral_tone_with_five=True)
    except Exception:
        raise UnsafeGroup("incomplete_or_unrelated_speech") from None
    if (len(original_pinyin) != len(target) or len(recognized_pinyin) != len(target)
            or original_pinyin[index] != recognized_pinyin[index]
            or not re.fullmatch(r"[a-zv]{1,12}[1-5]", original_pinyin[index])):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    return {"index": index, "expected": left, "recognized": right,
            "expectedPinyin": original_pinyin[index], "recognizedPinyin": recognized_pinyin[index], "rule": "same_tone"}


def short_same_tone_family(expected: str, texts: list[str], clauses: list[str]) -> dict | None:
    if not short_review_scope(expected, clauses):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    target = sentence_particle_text(expected)
    variants = {sentence_particle_text(text) for text in texts if sentence_particle_text(text) != target}
    if not variants:
        return None
    if len(variants) != 1:
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    return short_same_tone_difference(expected, next(iter(variants)))


def review_window(transcript: str, words: list[dict], duration: float) -> dict:
    validate_words(words, duration)
    if (any(word["end"] <= word["start"] for word in words)
            or sentence_particle_text(transcript) != sentence_particle_text("".join(word["text"] for word in words))):
        raise UnsafeGroup("inconsistent_recognition")
    return {"transcript": bounded_text(transcript, 8000), "words": [
        {"text": bounded_text(word["text"], 200), "start": word["start"], "end": word["end"]} for word in words],
        "durationSeconds": duration}


def short_sentence_review_snapshot(review: dict, recognition: dict) -> dict:
    if review.get("reason") == "same_tone_substitution":
        return same_tone_review_snapshot(review, recognition)
    source = short_review_source(recognition["expectedText"], review.get("sourcePrefix", ""), [recognition["expectedText"]])
    target, prefix = source["expected"], source["expected"][:-1]
    result = {"status": "needs_confirmation", "reason": "missing_final_particle", **source}
    missing = False
    for name in ("left", "right", "final"):
        window = review.get(name)
        if window is None and name != "final":
            continue
        if not isinstance(window, dict):
            raise UnsafeGroup("inconsistent_recognition")
        actual = review_window(window.get("transcript", ""), window.get("words", []), window.get("durationSeconds", 0))
        result[name] = actual
        if name != "right":
            text = sentence_particle_text(actual["transcript"])
            if text == prefix:
                missing = True
            else:
                short_review_source(recognition["expectedText"], text, [recognition["expectedText"]])
    if not missing or result["final"]["transcript"] != recognition.get("targetTranscript"):
        raise UnsafeGroup("inconsistent_recognition")
    result["similarity"] = round(1.0 if sentence_particle_text(result["final"]["transcript"]) == target else (len(target) - 1) / len(target), 6)
    accumulated, endpoint = "", -1
    for index, word in enumerate(recognition.get("sourceWords", [])):
        accumulated += sentence_particle_text(word["text"])
        if len(accumulated) >= len(target):
            if accumulated == source["sourcePrefix"]:
                endpoint = index
            break
    if endpoint < 0 or not sentence_particle_text(recognition.get("sourceTranscript", "")).startswith(source["sourcePrefix"]):
        raise UnsafeGroup("inconsistent_recognition")
    validate_words(recognition["sourceWords"][:endpoint + 1], 120)
    if any(word["end"] <= word["start"] for word in recognition["sourceWords"][:endpoint + 1]):
        raise UnsafeGroup("invalid_word_timestamps")
    following = recognition.get("followingText", "")
    if following:
        if "left" not in result or "right" not in result or not continuation_matches(following, recognition["sourceWords"], endpoint):
            raise UnsafeGroup("unrecognized_continuation")
        right = result["right"]
        try:
            align_prefix(following, right["words"])
            content_score(normalize(following), normalize(right["transcript"])[:len(normalize(following))])
        except UnsafeGroup:
            boundary = recognition.get("followingPhoneticBoundary")
            if not isinstance(boundary, dict) or boundary.get("right") != right:
                raise
    elif ("left" in result or "right" in result or sentence_particle_text(recognition["sourceTranscript"]) != source["sourcePrefix"]
            or sentence_particle_text("".join(word["text"] for word in recognition["sourceWords"])) != source["sourcePrefix"]):
        raise UnsafeGroup("inconsistent_recognition")
    if review != result:
        raise UnsafeGroup("inconsistent_recognition")
    return result


def same_tone_review_snapshot(review: dict, recognition: dict) -> dict:
    expected, source = recognition["expectedText"], review.get("sourcePrefix", "")
    result = {"status": "needs_confirmation", "reason": "same_tone_substitution",
              "expected": sentence_particle_text(expected), "sourcePrefix": sentence_particle_text(source)}
    for name in ("left", "right", "final"):
        window = review.get(name)
        if window is None and name != "final":
            continue
        if not isinstance(window, dict):
            raise UnsafeGroup("inconsistent_recognition")
        result[name] = review_window(window.get("transcript", ""), window.get("words", []), window.get("durationSeconds", 0))
    difference = short_same_tone_family(expected, [source] + [result[name]["transcript"] for name in ("left", "final") if name in result], [expected])
    if difference is None or result["final"]["transcript"] != recognition.get("targetTranscript"):
        raise UnsafeGroup("inconsistent_recognition")
    result["differences"] = [difference]
    target = result["expected"]
    result["similarity"] = round(1.0 if sentence_particle_text(result["final"]["transcript"]) == target else (len(target) - 1) / len(target), 6)
    accumulated, endpoint = "", -1
    for index, word in enumerate(recognition.get("sourceWords", [])):
        accumulated += sentence_particle_text(word["text"])
        if len(accumulated) >= len(target):
            if accumulated == result["sourcePrefix"]:
                endpoint = index
            break
    if endpoint < 0 or not sentence_particle_text(recognition.get("sourceTranscript", "")).startswith(result["sourcePrefix"]):
        raise UnsafeGroup("inconsistent_recognition")
    validate_words(recognition["sourceWords"][:endpoint + 1], 120)
    if any(word["end"] <= word["start"] for word in recognition["sourceWords"][:endpoint + 1]):
        raise UnsafeGroup("invalid_word_timestamps")
    following = recognition.get("followingText", "")
    if following:
        if "left" not in result or "right" not in result or not continuation_matches(following, recognition["sourceWords"], endpoint):
            raise UnsafeGroup("unrecognized_continuation")
        try:
            align_prefix(following, result["right"]["words"])
            content_score(normalize(following), normalize(result["right"]["transcript"])[:len(normalize(following))])
        except UnsafeGroup:
            boundary = recognition.get("followingPhoneticBoundary")
            if not isinstance(boundary, dict) or boundary.get("right") != result["right"]:
                raise
    elif ("left" in result or "right" in result or sentence_particle_text(recognition["sourceTranscript"]) != result["sourcePrefix"]
            or sentence_particle_text("".join(word["text"] for word in recognition["sourceWords"])) != result["sourcePrefix"]):
        raise UnsafeGroup("inconsistent_recognition")
    if result != review:
        raise UnsafeGroup("inconsistent_recognition")
    return result


def following_phonetic_boundary(expected: str, following: str, source_words: list[dict], source_index: int,
                                transcript: str, words: list[dict], duration: float) -> dict:
    if not short_review_scope(following, [following]) or source_index < 1 or source_index >= len(source_words):
        raise UnsafeGroup("unrecognized_continuation")
    current = "".join(word["text"] for word in source_words[:source_index])
    try:
        content_comparison(expected, current)
    except UnsafeGroup:
        try:
            short_review_source(expected, current, [expected])
        except UnsafeGroup:
            short_same_tone_family(expected, [current], [expected])
    target, accumulated, terminal = sentence_particle_text(following), "", -1
    for index, word in enumerate(source_words[source_index:], source_index):
        accumulated += sentence_particle_text(word["text"])
        if len(accumulated) >= len(target):
            terminal = index
            break
    if accumulated != target or terminal < source_index:
        raise UnsafeGroup("unrecognized_continuation")
    validate_words(source_words[:terminal + 1], 120)
    if any(word["end"] <= word["start"] for word in source_words[:terminal + 1]):
        raise UnsafeGroup("invalid_word_timestamps")
    right = review_window(transcript, words, duration)
    difference = short_same_tone_difference(following, transcript)
    return {"expected": target, "recognized": sentence_particle_text(transcript), "sourceWordIndex": source_index,
            "difference": difference, "right": right}


def following_boundary_snapshot(boundary: dict, recognition: dict) -> dict:
    window = boundary.get("right")
    index = boundary.get("sourceWordIndex")
    if not isinstance(window, dict) or not isinstance(index, int) or isinstance(index, bool):
        raise UnsafeGroup("inconsistent_recognition")
    result = following_phonetic_boundary(recognition["expectedText"], recognition.get("followingText", ""),
        recognition.get("sourceWords", []), index, window.get("transcript", ""), window.get("words", []), window.get("durationSeconds", 0))
    actual_source = "".join(word["text"] for word in recognition.get("sourceWords", []))
    if not sentence_particle_text(recognition.get("sourceTranscript", "")).startswith(sentence_particle_text(actual_source)) or result != boundary:
        raise UnsafeGroup("inconsistent_recognition")
    return result


def content_comparison(expected: str, actual: str, allow_edits: bool = False, *, allow_phonetic: bool = False,
                       source_prefix: str = "", clauses: list[str] | None = None,
                       allow_short_sentence_particle: bool = False) -> dict:
    try:
        similarity = content_score(expected, actual, allow_substitutions=True)
    except UnsafeGroup as error:
        if allow_edits:
            try:
                return bounded_edit_comparison(normalize(expected), normalize(actual))
            except UnsafeGroup as edit_error:
                error = edit_error
        if allow_phonetic:
            try:
                return phonetic_comparison(expected, actual, source_prefix, clauses)
            except UnsafeGroup:
                pass
        if allow_short_sentence_particle:
            try:
                return sentence_particle_comparison(expected, actual, source_prefix, clauses)
            except UnsafeGroup:
                pass
        raise error
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


def leading_hmm_continuation(following: str, words: list[dict], terminal: int) -> dict | None:
    """One independently timestamped 嗯 may precede strict whole-word context."""
    index = terminal + 1
    if index >= min(len(words) - 1, 2000) or normalize(words[index]["text"]) != "嗯":
        return None
    start, end = float(words[index]["start"]), float(words[index]["end"])
    if not math.isfinite(start) or not math.isfinite(end) or not 0 <= start < end <= 120.1:
        return None
    try:
        following_terminal = index + 1 + align_prefix(following, words[index + 1:])
    except UnsafeGroup:
        return None
    actual = "".join(normalize(word["text"]) for word in words[index + 1:following_terminal + 1])
    if actual != normalize(following):
        return None
    return {"kind": "leading_hmm", "text": "嗯", "sourceWordIndex": index,
            "sourceStartSeconds": start, "sourceEndSeconds": end}


def align_target(expected: str, words: list[dict], following: str,
                 alignment_hint: dict | None = None, *, allow_short_sentence_particle: bool = False,
                 clauses: list[str] | None = None, allow_short_sentence_text_review: bool = False) -> tuple[int, dict | None]:
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
        if allow_short_sentence_particle:
            accumulated, particle_candidates = "", []
            target_length = len(sentence_particle_text(expected))
            for index, word in enumerate(words[:2000]):
                accumulated += sentence_particle_text(word["text"])
                if len(accumulated) > target_length:
                    break
                if len(accumulated) != target_length or not sentence_particle_text(word["text"]):
                    continue
                try:
                    sentence_particle_comparison(expected, accumulated, accumulated, clauses)
                    # A particle never excuses the next sentence's first syllable.
                    if continuation_matches(following, words, index):
                        particle_candidates.append(index)
                except UnsafeGroup:
                    pass
            if len(particle_candidates) == 1:
                return particle_candidates[0], None
        if allow_short_sentence_text_review and clauses and short_review_scope(expected, clauses):
            accumulated, tone_candidates = "", []
            for index, word in enumerate(words[:2000]):
                accumulated += sentence_particle_text(word["text"])
                if len(accumulated) > len(sentence_particle_text(expected)):
                    break
                try:
                    short_same_tone_difference(expected, accumulated)
                    if continuation_matches(following, words, index):
                        tone_candidates.append(index)
                except UnsafeGroup:
                    pass
            if len(tone_candidates) == 1:
                return tone_candidates[0], None
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


def check_target_text(expected: str, actual: str, allow_edits: bool = False, ending_anchor: str = "", *,
                      allow_phonetic: bool = False, source_prefix: str = "", clauses: list[str] | None = None,
                      allow_short_sentence_particle: bool = False) -> dict:
    comparison = content_comparison(expected, actual, allow_edits=allow_edits, allow_phonetic=allow_phonetic,
                                   source_prefix=source_prefix, clauses=clauses,
                                   allow_short_sentence_particle=allow_short_sentence_particle)
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
                         start: float, end: float, boundary: float, *, max_candidates: int | None = 3) -> list[dict]:
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
            if max_candidates is not None and len(candidates) == max_candidates:
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
                         allow_edits: bool = False, ending_anchor: str = "",
                         continuation_bridge: dict | None = None, *, source_prefix: str = "",
                         clauses: list[str] | None = None,
                         allow_short_sentence_particle: bool = False,
                         allow_short_sentence_text_review: bool = False,
                         text_review_evidence: dict | None = None,
                         allow_following_phonetic_boundary: bool = False,
                         following_phonetic_evidence: dict | None = None) -> tuple[float, dict, dict | None]:
    if not require_two_sided and continuation_bridge is None:
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
    following_start = terminal + (2 if continuation_bridge is not None else 1)
    following_end = following_start + align_prefix(following, words[following_start:])
    duration = audio.size / RATE
    boundary = (float(words[terminal]["end"]) + float(words[terminal + 1]["start"])) / 2
    start = max(0.0, min(float(words[terminal]["end"]), float(words[terminal + 1]["start"])) - .5)
    end = min(duration, max(float(words[terminal]["end"]), float(words[terminal + 1]["start"])) + .65)
    if continuation_bridge is not None:
        # Unlike timestamp refinement, this bridge cannot search after 嗯 or
        # borrow a target substitution. Keep every candidate wholly inside the
        # measured gap, with word guards before the independent 嗯 starts.
        if (normalize("".join(word["text"] for word in words[:terminal + 1])) != normalize(expected)
                or leading_hmm_continuation(following, words, terminal) is None):
            raise UnsafeGroup("unrecognized_continuation")
        start = float(words[terminal]["end"]) + WORD_GUARD
        end = float(words[terminal + 1]["start"]) - WORD_GUARD
    levels, threshold = frame_levels(audio)
    # At least 80 ms of measured deep quiet on EACH side of the cut, not merely
    # an 80 ms interval whose midpoint has only 40 ms protection.
    candidates = quiet_cut_candidates(levels, threshold, start, end, boundary)
    text_mismatch = False
    short_particle_retry_used = False
    for candidate in candidates:
        if text_review_evidence is not None:
            text_review_evidence.clear()
        if following_phonetic_evidence is not None:
            following_phonetic_evidence.clear()
        if recognition is not None:
            # Each cut has its own independent recognition. A previous cut's
            # failure must not be paired with this cut's transcript/checkpoint.
            recognition.pop("alignment", None)
            recognition.pop("targetTranscript", None)
            recognition.pop("contentComparison", None)
            update_recognition(recognition, checkpoint)
        cut = candidate["cut"]
        if continuation_bridge is not None and (candidate["quietStartSeconds"] < start - 1e-8
                or candidate["quietEndSeconds"] > end + 1e-8
                or cut - candidate["quietStartSeconds"] < WORD_GUARD - 1e-8
                or candidate["quietEndSeconds"] - cut < WORD_GUARD - 1e-8):
            continue
        cut_sample = round(cut * RATE)
        # Short independent windows can omit 嗯 and misrecognize the context.
        # The bridge uses the complete existing remainder (input <=120s), not
        # another generation or a text-length estimate. The crop itself is fixed.
        right_end = audio.size if continuation_bridge is not None else min(
            audio.size, math.ceil((float(words[following_end]["end"]) + .65) * RATE))
        if cut_sample <= 0 or right_end <= cut_sample:
            continue
        try:
            left_audio = audio[:cut_sample]
            left_duration, left_offset = cut_sample / RATE, 0.0
            left_transcript, left_words = transcribe(model, left_audio)
            if recognition is not None:
                update_recognition(recognition, checkpoint, targetTranscript=left_transcript)
            validate_words(left_words, left_duration)
            # Tiny untrimmed windows can omit a quiet final particle. Retry only
            # that exact missing suffix, on this SAME verified cut, once total.
            # Actual activity and timestamp guards preserve all speech; this
            # analysis-only input never replaces the original published PCM.
            if (allow_short_sentence_particle and not short_particle_retry_used and continuation_bridge is None
                    and missing_short_particle(expected, left_transcript, left_words, clauses)):
                refined, refined_start, refined_end = trim_quiet_edges(
                    left_audio, words[0]["start"], words[terminal]["end"])
                if refined_start > 0 or refined_end < cut_sample:
                    short_particle_retry_used = True
                    left_transcript, left_words = transcribe(model, refined)
                    left_duration, left_offset = refined.size / RATE, refined_start / RATE
                    if recognition is not None:
                        update_recognition(recognition, checkpoint, targetTranscript=left_transcript)
                    validate_words(left_words, left_duration)
            if continuation_bridge is not None and normalize(left_transcript) != normalize(expected):
                raise UnsafeGroup("incomplete_or_unrelated_speech")
            allow_phonetic = bool(source_prefix) and continuation_bridge is None
            left_word_text = "".join(word["text"] for word in left_words)
            if continuation_bridge is not None and normalize(left_word_text) != normalize(expected):
                raise UnsafeGroup("incomplete_or_unrelated_speech")
            left_missing = bool(allow_short_sentence_text_review and continuation_bridge is None
                                and missing_short_particle(expected, left_transcript, left_words, clauses))
            if left_missing:
                short_review_source(expected, source_prefix, clauses)
            else:
                try:
                    check_target_text(expected, left_transcript, allow_edits, ending_anchor,
                                      allow_phonetic=allow_phonetic, source_prefix=source_prefix, clauses=clauses,
                                      allow_short_sentence_particle=allow_short_sentence_particle)
                    check_target_text(expected, left_word_text, allow_edits, ending_anchor,
                                      allow_phonetic=allow_phonetic, source_prefix=source_prefix, clauses=clauses,
                                      allow_short_sentence_particle=allow_short_sentence_particle)
                except UnsafeGroup:
                    if not allow_short_sentence_text_review or continuation_bridge is not None:
                        raise
                    tone_difference = short_same_tone_family(expected, [source_prefix, left_transcript, left_word_text], clauses)
                    if tone_difference is None:
                        raise
                    if text_review_evidence is not None:
                        text_review_evidence["toneDifference"] = tone_difference
            if allow_short_sentence_particle:
                if any(word["end"] <= word["start"] for word in left_words):
                    raise UnsafeGroup("invalid_word_timestamps")
            if normalize(left_transcript) != normalize(left_word_text):
                raise UnsafeGroup("inconsistent_recognition")
            right_transcript, right_words = transcribe(model, audio[cut_sample:right_end])
            right_start = 0
            if continuation_bridge is not None:
                if not right_words:
                    raise UnsafeGroup("uncertain_word_alignment")
                if normalize(right_words[0]["text"]) == "嗯":
                    if float(right_words[0]["end"]) <= float(right_words[0]["start"]):
                        raise UnsafeGroup("uncertain_word_alignment")
                    right_start = 1
            right_phonetic = None
            try:
                right_terminal = right_start + align_prefix(following, right_words[right_start:])
            except UnsafeGroup:
                if not allow_following_phonetic_boundary or continuation_bridge is not None:
                    raise
                right_phonetic = following_phonetic_boundary(expected, following, words, terminal + 1,
                    right_transcript, right_words, (right_end - cut_sample) / RATE)
                right_terminal = len(right_words) - 1
            validate_words(right_words[:right_terminal + 1], (right_end - cut_sample) / RATE)
            # Whole-word prefix alignment rejects a missing first syllable or
            # target-tail speech before the continuation. Check the segment text
            # as well, so disagreeing ASR words cannot conceal a leak.
            anchor = normalize(following)
            right_actual = normalize(right_transcript)
            if continuation_bridge is not None:
                # Full-context ASR may omit the source's independent 嗯. Source
                # timing and quiet/left proof still place it outside the crop.
                # Accept only exact context from word zero, optionally preceded
                # by one complete 嗯 word; never scan or split a merged word.
                right_expected = ("嗯" if right_start else "") + anchor
                right_prefix = "".join(normalize(word["text"]) for word in right_words[:right_terminal + 1])
                if right_prefix != right_expected or right_actual[:len(right_expected)] != right_expected:
                    raise UnsafeGroup("incomplete_or_unrelated_speech")
            else:
                if right_phonetic is None:
                    content_score(anchor, right_actual[:len(anchor)])
            if right_phonetic is not None and following_phonetic_evidence is not None:
                following_phonetic_evidence.update(right_phonetic)
            if allow_short_sentence_text_review and text_review_evidence is not None:
                text_review_evidence.update(left=review_window(left_transcript, left_words, left_duration),
                    right=review_window(right_transcript, right_words, (right_end - cut_sample) / RATE))
            validation = {key: candidate[key] for key in ("method", "thresholdDbfs", "quietStartSeconds", "quietEndSeconds")}
            if recognition is not None:
                recognition.pop("alignment", None)
                update_recognition(recognition, checkpoint)
            if continuation_bridge is not None:
                continuation_bridge["rightTranscript"] = bounded_text(right_transcript, 1500)
            # A shortened ASR transcript cannot shorten the acoustic target.
            # Its complete source endpoint still protects the final particle.
            last_word = words[terminal] if left_missing else left_words[-1]
            if left_offset and not left_missing:
                last_word = {**last_word, "start": last_word["start"] + left_offset,
                             "end": last_word["end"] + left_offset}
            return cut, last_word, validation
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
                              allow_edits: bool = False, *, allow_phonetic: bool = False,
                              source_prefix: str = "", allow_short_sentence_particle: bool = False) -> list[int]:
    """Map approved text through unique edit positions to actual whole-word ends."""
    if normalize("".join(clauses)) != normalize(expected):
        raise UnsafeGroup("clauses_do_not_cover_target")
    target, actual = normalize(expected), "".join(word["text"] for word in words)
    comparison = content_comparison(expected, actual, allow_edits=allow_edits, allow_phonetic=allow_phonetic,
                                   source_prefix=source_prefix, clauses=clauses,
                                   allow_short_sentence_particle=allow_short_sentence_particle)
    actual = normalize(actual)
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
        # Record validated long pauses up to the service's metadata bound. The
        # separate <=1200ms join-sample filter must not reject intact target audio.
        milliseconds = (float(words[terminal + 1]["start"]) - float(words[terminal]["end"])) * 1000
        if (not math.isfinite(milliseconds) or milliseconds < -1e-6
                or milliseconds > INTERNAL_PAUSE_OBSERVATION_MAX_MS):
            raise UnsafeGroup("uncertain_internal_pause")
        pauses.append(math.floor(max(0.0, milliseconds) + 0.5))
    return pauses


def _analyze(model, audio: np.ndarray, expected: str, following: str, clauses: list[str],
             recognition: dict, checkpoint, alignment_hint: dict | None = None,
             require_two_sided: bool = False, allow_short_sentence_particle: bool = False,
             allow_short_sentence_text_review: bool = False) -> tuple[np.ndarray, dict, dict | None]:
    short_target = sentence_particle_text(expected)
    review_opt_in = bool(allow_short_sentence_text_review)
    allow_short_sentence_text_review = bool(review_opt_in and short_review_scope(expected, clauses))
    allow_short_sentence_particle = bool(allow_short_sentence_particle and 3 <= len(short_target) <= 9
                                         and short_target[-1:] in {"啦", "了"})
    recognition.pop("continuationBridge", None)
    recognition.pop("shortSentenceReview", None)
    recognition.pop("followingPhoneticBoundary", None)
    update_recognition(recognition, checkpoint, stage="source_transcription")
    transcript, words = transcribe(model, audio)
    update_recognition(recognition, checkpoint, stage="source_alignment", sourceTranscript=transcript, sourceWords=words)
    boundary_match = None
    continuation_bridge = None
    phonetic_source = ""
    review_source = None
    particle_review_source = None
    source_tone_difference = None
    if following:
        try:
            terminal, boundary_match = align_target(expected, words, following, alignment_hint,
                allow_short_sentence_particle=allow_short_sentence_particle, clauses=clauses,
                allow_short_sentence_text_review=allow_short_sentence_text_review)
        except UnsafeGroup:
            update_recognition(recognition, checkpoint, endpointCandidates=bounded_endpoint_candidates(expected, words))
            raise
        if boundary_match:
            update_recognition(recognition, checkpoint, boundaryMatch=boundary_match)
        raw_source_prefix = "".join(word["text"] for word in words[:terminal + 1])
        try:
            source_comparison = content_comparison(expected, raw_source_prefix, allow_edits=boundary_match is not None,
                allow_short_sentence_particle=allow_short_sentence_particle, source_prefix=raw_source_prefix, clauses=clauses)
        except UnsafeGroup:
            if not allow_short_sentence_text_review or boundary_match is not None:
                raise
            source_tone_difference = short_same_tone_difference(expected, raw_source_prefix)
            source_comparison = {"status": "different"}
        source_prefix = "".join(normalize(word["text"]) for word in words[:terminal + 1])
        # The old weighted rule refines an endpoint located through 90% matching.
        # The opt-in short rule instead proves one exact prefix/final particle.
        # Neither permits a character-proportional timestamp or a divided word.
        if len(source_prefix) == len(normalize(expected)) and normalize(transcript).startswith(source_prefix):
            try:
                content_score(expected, source_prefix, allow_substitutions=True)
                phonetic_source = source_prefix
            except UnsafeGroup:
                pass
        if allow_short_sentence_particle or allow_short_sentence_text_review:
            short_prefix = sentence_particle_text(raw_source_prefix)
            if (len(short_prefix) == len(sentence_particle_text(expected))
                    and sentence_particle_text(transcript).startswith(short_prefix)):
                phonetic_source = raw_source_prefix
            else:
                raise UnsafeGroup("inconsistent_recognition")
        require_two_sided = require_two_sided or boundary_match is not None or source_comparison["status"] == "different"
        # This strategy intentionally discards the distant suffix. Whisper may
        # hallucinate timestamps there; only the retained prefix and immediate
        # following word establish this crop. Never excuse bad retained timing.
        validate_words(words[:terminal + 2], audio.size / RATE)
        if (allow_short_sentence_particle or allow_short_sentence_text_review) and any(word["end"] <= word["start"] for word in words[:terminal + 2]):
            raise UnsafeGroup("invalid_word_timestamps")
        # Establish that the next speech really belongs to the supplied context.
        update_recognition(recognition, checkpoint, stage="continuation_alignment")
        following_words = words[terminal + 1:]
        anchor = normalize(following)[:min(6, len(normalize(following)))]
        following_actual = "".join(normalize(word["text"]) for word in following_words)
        if not anchor or not following_actual.startswith(anchor):
            if boundary_match is None and source_comparison["status"] == "matched":
                continuation_bridge = leading_hmm_continuation(following, words, terminal)
            if continuation_bridge is None:
                raise UnsafeGroup("unrecognized_continuation", alignment={
                    "expected": anchor, "recognizedPrefix": bounded_text(following_actual, 2000),
                    "reason": "unrecognized_continuation",
                })
            validate_words(words[:terminal + 3], audio.size / RATE)
            require_two_sided = True
    else:
        validate_words(words, audio.size / RATE)
        if allow_short_sentence_particle or allow_short_sentence_text_review:
            raw_source_prefix = "".join(word["text"] for word in words)
            if (sentence_particle_text(transcript) != sentence_particle_text(raw_source_prefix)
                    or any(word["end"] <= word["start"] for word in words)):
                raise UnsafeGroup("inconsistent_recognition")
            try:
                content_comparison(expected, transcript, allow_short_sentence_particle=allow_short_sentence_particle,
                                   source_prefix=raw_source_prefix, clauses=clauses)
            except UnsafeGroup:
                if not allow_short_sentence_text_review:
                    raise
                source_tone_difference = short_same_tone_difference(expected, transcript)
            phonetic_source = raw_source_prefix
        else:
            content_score(expected, transcript, allow_substitutions=True)
    if allow_short_sentence_text_review and continuation_bridge is None:
        review_source = {"expected": short_target, "sourcePrefix": sentence_particle_text(phonetic_source)}
        try:
            particle_review_source = short_review_source(expected, phonetic_source, clauses)
        except UnsafeGroup:
            if source_tone_difference is None:
                short_same_tone_family(expected, [phonetic_source], clauses)
    text_review_evidence = {}
    following_phonetic_evidence = {}
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
                allow_edits=boundary_match is not None, ending_anchor=boundary_match["anchorText"] if boundary_match else "",
                continuation_bridge=continuation_bridge, source_prefix=phonetic_source,
                clauses=clauses, allow_short_sentence_particle=allow_short_sentence_particle,
                allow_short_sentence_text_review=review_source is not None, text_review_evidence=text_review_evidence,
                allow_following_phonetic_boundary=review_opt_in, following_phonetic_evidence=following_phonetic_evidence)
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
        if (allow_short_sentence_particle or allow_short_sentence_text_review) and any(word["end"] <= word["start"] for word in verified_words):
            raise UnsafeGroup("invalid_word_timestamps")
        if continuation_bridge is not None and normalize(verified_transcript) != normalize(expected):
            raise UnsafeGroup("incomplete_or_unrelated_speech")
        allow_phonetic = bool(following and phonetic_source) and continuation_bridge is None
        word_text = "".join(word["text"] for word in verified_words)
        if continuation_bridge is not None and normalize(word_text) != normalize(expected):
            raise UnsafeGroup("incomplete_or_unrelated_speech")
        final_missing = bool(particle_review_source is not None and source_tone_difference is None
            and not text_review_evidence.get("toneDifference") and missing_short_particle(expected, verified_transcript, verified_words, clauses))
        final_tone_difference = None
        comparison = None
        if not final_missing:
            try:
                comparison = check_target_text(expected, verified_transcript, boundary_match is not None,
                                               boundary_match["anchorText"] if boundary_match else "",
                                               allow_phonetic=allow_phonetic, source_prefix=phonetic_source, clauses=clauses,
                                               allow_short_sentence_particle=allow_short_sentence_particle)
                check_target_text(expected, word_text, boundary_match is not None,
                                  boundary_match["anchorText"] if boundary_match else "",
                                  allow_phonetic=allow_phonetic, source_prefix=phonetic_source, clauses=clauses,
                                  allow_short_sentence_particle=allow_short_sentence_particle)
            except UnsafeGroup:
                if review_source is None:
                    raise
                final_tone_difference = short_same_tone_family(expected, [phonetic_source, verified_transcript, word_text], clauses)
                if final_tone_difference is None:
                    raise
                comparison = None
        if normalize(verified_transcript) != normalize(word_text):
            raise UnsafeGroup("inconsistent_recognition")
        if following and (final_missing or final_tone_difference or comparison["status"] == "different") and cut_validation is None:
            require_two_sided = True
            continue
        break
    else:
        raise UnsafeGroup("no_verified_quiet_cut")
    if comparison and comparison.get("mode") == "phonetic_substitutions" and cut_validation is None:
        raise UnsafeGroup("no_verified_quiet_cut")
    if following and comparison and comparison.get("mode") == "sentence_particle" and cut_validation is None:
        raise UnsafeGroup("no_verified_quiet_cut")
    left_missing = bool(particle_review_source and text_review_evidence.get("left")
        and missing_short_particle(expected, text_review_evidence["left"]["transcript"], text_review_evidence["left"]["words"], clauses))
    needs_tone_review = bool(review_source and (source_tone_difference or text_review_evidence.get("toneDifference") or final_tone_difference))
    needs_review = bool(review_source and (left_missing or final_missing or needs_tone_review))
    if needs_tone_review and (left_missing or final_missing):
        raise UnsafeGroup("incomplete_or_unrelated_speech")
    if needs_review:
        if len(clauses) != 1 or (following and (cut_validation is None or not text_review_evidence.get("right"))):
            raise UnsafeGroup("no_verified_quiet_cut")
        pauses = []
    else:
        boundaries = resolve_clause_boundaries(expected, clauses, verified_words, allow_edits=boundary_match is not None,
                                              allow_phonetic=allow_phonetic, source_prefix=phonetic_source,
                                              allow_short_sentence_particle=allow_short_sentence_particle)
        pauses = internal_pauses(processed, clauses, verified_words, boundaries=boundaries)
    if comparison is not None:
        update_recognition(recognition, checkpoint, contentComparison=comparison)
    leading, trailing = measure_quiet(processed)
    trailing = max(trailing, known_tail)
    result = {
        "version": 1, "success": True, "internalPausesMs": pauses,
        "leadingQuietMs": round(leading, 1), "trailingQuietMs": round(trailing, 1),
        "transcript": verified_transcript, "coverage": round((len(short_target) - 1) / len(short_target), 6) if final_missing or final_tone_difference else comparison["similarity"],
        "cutStartSeconds": round(start / RATE, 6), "cutEndSeconds": round(end / RATE, 6),
        "asrModel": "faster-whisper-large-v3/cpu/int8",
    }
    if cut_validation:
        result["cutValidation"] = cut_validation
    if following_phonetic_evidence:
        recognition["followingPhoneticBoundary"] = dict(following_phonetic_evidence)
    if needs_review:
        review_windows = {name: text_review_evidence[name] for name in ("left", "right") if name in text_review_evidence}
        if needs_tone_review:
            tone_difference = short_same_tone_family(expected, [phonetic_source]
                + [window["transcript"] for window in review_windows.values() if window is review_windows.get("left")]
                + [verified_transcript], clauses)
            recognition["shortSentenceReview"] = {"status": "needs_confirmation", "reason": "same_tone_substitution", **review_source,
                "similarity": result["coverage"], "differences": [tone_difference], **review_windows,
                "final": review_window(verified_transcript, verified_words, processed.size / RATE)}
        else:
            recognition["shortSentenceReview"] = {"status": "needs_confirmation", "reason": "missing_final_particle", **particle_review_source,
                "similarity": result["coverage"], **review_windows,
                "final": review_window(verified_transcript, verified_words, processed.size / RATE)}
    return processed, result, continuation_bridge


def cutting_positions(reference: str, observed: str, boundary: int, *, free_end: bool = False) -> tuple[set[int], list[int]]:
    """Find all optimal ordered edit mappings, without inventing sub-word time.

    Edit cost ranks locator hypotheses, not spoken-content correctness. An
    ambiguous boundary is retained as ambiguous rather than choosing a path.
    """
    if reference == observed:
        return {boundary}, [len(observed)]
    rows = [list(range(len(observed) + 1))]
    for i, character in enumerate(reference, 1):
        previous, current = rows[-1], [i]
        for j, actual in enumerate(observed, 1):
            current.append(min(previous[j] + 1, current[-1] + 1, previous[j - 1] + (character != actual)))
        rows.append(current)
    if free_end:
        minimum = min(rows[-1])
        endings = [index for index, score in enumerate(rows[-1]) if score == minimum]
    else:
        endings = [len(observed)]
    pending = [(len(reference), end) for end in endings]
    visited, positions = set(), set()
    while pending:
        i, j = pending.pop()
        if (i, j) in visited or i < boundary:
            continue
        visited.add((i, j))
        if i == boundary:
            positions.add(j)
            if len(positions) > 1:
                return positions, endings
        score = rows[i][j]
        if i and j and score == rows[i - 1][j - 1] + (reference[i - 1] != observed[j - 1]):
            pending.append((i - 1, j - 1))
        if i and score == rows[i - 1][j] + 1:
            pending.append((i - 1, j))
        if j and score == rows[i][j - 1] + 1:
            pending.append((i, j - 1))
    return positions, endings


def cutting_word_boundary(expected: str, following: str, words: list[dict]) -> tuple[int, float]:
    target, context = normalize(expected), normalize(following)[:16]
    if not context:
        actual = "".join(normalize(word["text"]) for word in words)
        return len(words) - 1, difflib.SequenceMatcher(None, target, actual, autojunk=False).ratio() if target or actual else 0.0
    if not target or not words:
        raise UnsafeGroup("boundary_unlocatable")
    # Bound the locator's memory independently of distant generated context.
    limit, observed, endpoints = max(32, 2 * (len(target) + len(context)) + 16), "", {}
    for index, word in enumerate(words[:2000]):
        observed += normalize(word["text"])
        endpoints[len(observed)] = index
        if len(observed) >= limit:
            break
    anchors = sum(block.size for block in difflib.SequenceMatcher(None, target + context, observed, autojunk=False).get_matching_blocks())
    if anchors < min(2, len(target + context)):
        raise UnsafeGroup("boundary_unlocatable")
    positions, endings = cutting_positions(target + context, observed, len(target), free_end=True)
    if len(positions) != 1:
        raise UnsafeGroup("ambiguous_boundary" if positions else "boundary_unlocatable")
    position = next(iter(positions))
    if position not in endpoints or position <= 0 or endpoints[position] + 1 >= len(words):
        raise UnsafeGroup("boundary_unlocatable")
    left = observed[:position]
    # The joint sequence's anchors and unique mapping locate the boundary.
    # In particular a one-character target 坐 must not require literal 坐 when
    # 做 plus the following context still has one ordered whole-word endpoint.
    return endpoints[position], difflib.SequenceMatcher(None, target, left, autojunk=False).ratio()


def cutting_quiet_boundary(audio: np.ndarray, words: list[dict], terminal: int) -> tuple[float, dict]:
    left, right = words[terminal], words[terminal + 1]
    levels, threshold = frame_levels(audio)
    boundary = (float(left["end"]) + float(right["start"])) / 2
    lower, upper = float(left["end"]) + WORD_GUARD, float(right["start"]) - WORD_GUARD
    candidates = quiet_cut_candidates(levels, threshold, lower, upper, boundary, max_candidates=None)
    if not candidates:
        # ASR can assign real quiet to an adjacent syllable. Refine only inside
        # a single-character side's span; a multi-character side keeps its full
        # timestamp protection. Their nominal join can precede real quiet.
        # Never search an earlier phrase pause or split a multi-character word.
        refine_left = len(normalize(left["text"])) == 1
        refine_right = len(normalize(right["text"])) == 1
        if not refine_left and not refine_right:
            raise UnsafeGroup("no_verified_quiet_cut")
        lower = float(left["start"] if refine_left else left["end"]) + WORD_GUARD
        upper = float(right["end"] if refine_right else right["start"]) - WORD_GUARD
        candidates = quiet_cut_candidates(levels, threshold, lower, upper, boundary, max_candidates=None)
        verified = []
        for candidate in candidates:
            quiet_start, quiet_end = candidate["quietStartSeconds"], candidate["quietEndSeconds"]
            left_start = max(0, math.ceil(float(left["start"]) * 100))
            left_end = min(len(levels), math.floor(quiet_start * 100))
            right_start = max(0, math.ceil(quiet_end * 100))
            right_end = min(len(levels), math.floor(float(right["end"]) * 100))
            if (np.any(levels[left_start:left_end] >= candidate["thresholdDbfs"])
                    and np.any(levels[right_start:right_end] >= candidate["thresholdDbfs"])):
                verified.append(candidate)
        strict = [candidate for candidate in verified if candidate["method"] == "two_sided"]
        # Prefer measured deep quiet; a wider noise-floor interval around that
        # same pause must not count as a second independent candidate.
        candidates = strict or verified
        if len(candidates) > 1:
            raise UnsafeGroup("ambiguous_boundary")
    if not candidates:
        raise UnsafeGroup("no_verified_quiet_cut")
    selected = candidates[0]
    cut = selected["cut"]
    if (cut - selected["quietStartSeconds"] < WORD_GUARD - 1e-8
            or selected["quietEndSeconds"] - cut < WORD_GUARD - 1e-8):
        raise UnsafeGroup("no_verified_quiet_cut")
    return cut, {key: selected[key] for key in ("method", "thresholdDbfs", "quietStartSeconds", "quietEndSeconds")}


def cutting_internal_pauses(expected: str, clauses: list[str], words: list[dict]) -> tuple[list[float], list[int]]:
    reference = normalize(expected)
    if normalize("".join(clauses)) != reference:
        raise UnsafeGroup("invalid_target")
    observed, endpoints = "", {}
    for index, word in enumerate(words):
        observed += normalize(word["text"])
        endpoints[len(observed)] = index
    pauses, positions, length = [], [], 0
    for index, clause in enumerate(clauses[:-1]):
        length += len(normalize(clause))
        mapped, _ = cutting_positions(reference, observed, length)
        if len(mapped) != 1:
            continue
        terminal = endpoints.get(next(iter(mapped)), -1)
        if terminal < 0 or terminal + 1 >= len(words):
            continue
        milliseconds = (float(words[terminal + 1]["start"]) - float(words[terminal]["end"])) * 1000
        if math.isfinite(milliseconds) and 0 <= milliseconds <= INTERNAL_PAUSE_OBSERVATION_MAX_MS:
            pauses.append(math.floor(milliseconds + .5))
            positions.append(index)
    return pauses, positions


def _analyze_cutting_only(model, audio: np.ndarray, expected: str, following: str, clauses: list[str],
                          recognition: dict, checkpoint) -> tuple[np.ndarray, dict]:
    for key in ("contentComparison", "shortSentenceReview", "followingPhoneticBoundary", "continuationBridge", "boundaryMatch"):
        recognition.pop(key, None)
    update_recognition(recognition, checkpoint, analysisMode="cutting_only", stage="source_transcription")
    transcript, words = transcribe(model, audio)
    update_recognition(recognition, checkpoint, stage="source_alignment", sourceTranscript=transcript, sourceWords=words)
    if not following:
        # There is no cut to locate. Even absent/unrelated ASR or unusable word
        # timing cannot justify throwing away an unchanged complete recording.
        words = recognition.get("sourceWords", [])
    terminal, similarity = cutting_word_boundary(expected, following, words)
    if following:
        retained = words[:terminal + 2]
        validate_words(retained, audio.size / RATE)
        if any(word["end"] <= word["start"] for word in retained):
            raise UnsafeGroup("invalid_word_timestamps")
        # Distant discarded context is not timing evidence for this boundary.
        update_recognition(recognition, checkpoint, sourceWords=retained)
    prefix = "".join(word["text"] for word in words[:terminal + 1])
    update_recognition(recognition, checkpoint, stage="boundary_check", targetTranscript=prefix)
    cut_validation = None
    if following:
        cut, cut_validation = cutting_quiet_boundary(audio, words, terminal)
        end_sample = round(cut * RATE)
    else:
        end_sample = audio.size
    processed = audio[:end_sample].copy()
    try:
        leading, trailing = measure_quiet(processed)
    except UnsafeGroup as error:
        if following or str(error) != "silent_audio":
            raise
        leading, trailing = processed.size / RATE * 1000, 0.0
    pauses, positions = cutting_internal_pauses(expected, clauses, words[:terminal + 1])
    evidence = {"method": "ordered_word_boundary" if following else "whole_recording", "alignmentSimilarity": round(similarity, 6),
                "targetEndWordIndex": terminal, "contentVerified": False, "internalPausePositions": positions}
    if following:
        evidence["followingStartWordIndex"] = terminal + 1
    result = {"version": 1, "success": True, "internalPausesMs": pauses,
              "leadingQuietMs": round(leading, 1), "trailingQuietMs": round(trailing, 1),
              "transcript": prefix, "coverage": round(similarity, 6),
              "cutStartSeconds": 0, "cutEndSeconds": round(end_sample / RATE, 6),
              "asrModel": "faster-whisper-large-v3/cpu/int8", "boundaryOnly": evidence}
    if cut_validation:
        result["cutValidation"] = cut_validation
    return processed, result


def analyze(model, audio: np.ndarray, expected: str, following: str, clauses: list[str],
            recognition: dict | None = None, checkpoint=None, alignment_hint: dict | None = None,
            require_two_sided: bool = False, allow_short_sentence_particle: bool = False,
            allow_short_sentence_text_review: bool = False, cutting_only: bool = False) -> tuple[np.ndarray, dict]:
    if recognition is None:
        recognition = {"stage": "source_transcription", "sourceTranscript": "",
                       "expectedText": expected, "followingText": following}
    try:
        if cutting_only:
            recognition["analysisMode"] = "cutting_only"
            if alignment_hint is not None:
                raise UnsafeGroup("invalid_target")
            processed, result = _analyze_cutting_only(model, audio, expected, following, clauses, recognition, checkpoint)
            continuation_bridge = None
        elif allow_short_sentence_particle and (not require_two_sided or alignment_hint is not None):
            raise UnsafeGroup("invalid_target")
        elif allow_short_sentence_text_review and (not require_two_sided or not allow_short_sentence_particle or alignment_hint is not None):
            raise UnsafeGroup("invalid_target")
        if not cutting_only:
            processed, result, continuation_bridge = _analyze(model, audio, expected, following, clauses, recognition, checkpoint,
                                                        alignment_hint, require_two_sided, allow_short_sentence_particle, allow_short_sentence_text_review)
    except UnsafeGroup as error:
        if error.alignment:
            update_recognition(recognition, checkpoint, alignment=error.alignment)
        error.recognition = recognition_snapshot(recognition)
        raise
    except Exception:
        # Keep accumulated ASR while keeping native exception text/paths private.
        raise UnsafeGroup("analysis_failed", recognition=recognition_snapshot(recognition)) from None
    recognition.pop("alignment", None)
    completed = {"stage": "complete"}
    if continuation_bridge is not None:
        completed["continuationBridge"] = continuation_bridge
    update_recognition(recognition, checkpoint, **completed)
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
    if not allowed.issubset(request) or set(request) - allowed - {"alignmentHint", "requireTwoSided", "allowShortSentenceParticle", "allowShortSentenceTextReview", "cuttingOnly"} or request["version"] != 1:
        return 2
    if "cuttingOnly" in request and not isinstance(request["cuttingOnly"], bool):
        return 2
    if request.get("cuttingOnly") and request.get("alignmentHint") is not None:
        return 2
    if "requireTwoSided" in request and not isinstance(request["requireTwoSided"], bool):
        return 2
    if "allowShortSentenceParticle" in request and (not isinstance(request["allowShortSentenceParticle"], bool)
            or (request["allowShortSentenceParticle"] and (request.get("requireTwoSided") is not True or request.get("alignmentHint") is not None))):
        return 2
    if "allowShortSentenceTextReview" in request and (not isinstance(request["allowShortSentenceTextReview"], bool)
            or (request["allowShortSentenceTextReview"] and (request.get("requireTwoSided") is not True
                or request.get("allowShortSentenceParticle") is not True or request.get("alignmentHint") is not None))):
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
    if request.get("cuttingOnly"):
        recognition["analysisMode"] = "cutting_only"

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
                                    recognition, checkpoint, alignment_hint=alignment_hint,
                                    require_two_sided=request.get("requireTwoSided", False),
                                    allow_short_sentence_particle=request.get("allowShortSentenceParticle", False),
                                    allow_short_sentence_text_review=request.get("allowShortSentenceTextReview", False),
                                    cutting_only=request.get("cuttingOnly", False))
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
