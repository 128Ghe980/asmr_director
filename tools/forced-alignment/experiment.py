"""Offline Chinese CTC timing experiment; not the complete WhisperX pipeline.

The model is WhisperX's default Chinese alignment checkpoint. Supplied text is
a hypothesis: forced alignment never proves it was spoken or recognized correctly.
No product state, ASR scores, or production candidates are written by this module.
Heavy dependencies are imported only after the CLI's independent RAM preflight.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import sys
import time
import unicodedata
import wave


MODEL_ID = "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn"
MODEL_REVISION = "99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd"
MIN_PHYSICAL_RAM_BYTES = 3 * 1024 ** 3
MIN_COMMIT_AVAILABLE_BYTES = 4_820_000_000  # Decimal GB; independent experiment budget.
MAX_CASES = 10
MAX_SECONDS = 45
ANALYSIS_RATE = 48_000
MODEL_RATE = 16_000
WORD_GUARD = .080
DEFAULT_HELPER = Path(__file__).resolve().parents[2] / "apps/web/scripts/analyze-voice-group.py"


class AlignmentError(Exception):
    def __init__(self, code, **details):
        super().__init__(code)
        self.code, self.details = code, details


def normalize_with_mapping(text, converter=None):
    if not isinstance(text, str):
        raise AlignmentError("invalid_text")
    kept, mapping, removed = [], [], []
    for index, character in enumerate(text):
        if character.isspace() or unicodedata.category(character).startswith("P") or character in "~～":
            reason = "format" if character in "~～" else "whitespace" if character.isspace() else "punctuation"
            removed.append({"source_char": character, "source_index": index, "reason": reason})
        else:
            kept.append(character)
            mapping.append({"source_char": character, "source_index": index})
    original = "".join(kept)
    convert = converter.convert if hasattr(converter, "convert") else converter
    normalized = convert(original) if convert is not None else original
    if not isinstance(normalized, str) or len(normalized) != len(original):
        # Do not invent a one-to-one character provenance for an expansion.
        raise AlignmentError("normalization_length_changed", source=original, normalized=normalized)
    for item, character in zip(mapping, normalized):
        item["char"] = character
    return {"text": normalized, "mapping": mapping, "removed": removed}


def normalize(text, converter=None):
    return normalize_with_mapping(text, converter)["text"]


def encode_text(text, vocabulary, blank_id=0, unk_id=None):
    if not isinstance(text, str) or not text:
        raise AlignmentError("empty_text")
    tokens, unavailable = [], []
    for index, character in enumerate(text):
        token = vocabulary.get(character)
        if (type(token) is not int or token < 0 or token == blank_id
                or (unk_id is not None and token == unk_id)):
            unavailable.append({"index": index, "char": character})
        else:
            tokens.append(token)
    if unavailable:
        raise AlignmentError("oov_characters", characters=unavailable)
    return tokens


def align_emission(emission, text, token_ids, duration_seconds, blank_id=0):
    """Align real CTC frames; never fill an unsupported character's time.

    Scores are mean posterior probabilities over each merged token span. Frame
    positions use duration / emission frame count, as a time-grid conversion;
    this does not interpolate missing words or assign proportional text times.
    """
    import torch
    import torchaudio.functional as functional

    if not isinstance(text, str) or not text or len(text) != len(token_ids):
        raise AlignmentError("invalid_token_sequence")
    if not math.isfinite(duration_seconds) or duration_seconds <= 0:
        raise AlignmentError("invalid_duration")
    values = torch.as_tensor(emission).detach().to(dtype=torch.float32)
    if values.ndim == 2:
        values = values.unsqueeze(0)
    if values.ndim != 3 or values.shape[0] != 1 or not values.shape[1] or not values.shape[2]:
        raise AlignmentError("invalid_emission_shape")
    if not bool(torch.isfinite(values).all()):
        raise AlignmentError("nonfinite_emission")
    if (type(blank_id) is not int or not 0 <= blank_id < values.shape[2]
            or any(type(token) is not int or token == blank_id or not 0 <= token < values.shape[2]
                   for token in token_ids)):
        raise AlignmentError("invalid_token_ids")
    repeats = sum(left == right for left, right in zip(token_ids, token_ids[1:]))
    if values.shape[1] < len(token_ids) + repeats:
        raise AlignmentError("insufficient_ctc_frames", frames=values.shape[1],
                             characters=len(token_ids), adjacent_repeats=repeats)
    targets = torch.tensor([token_ids], dtype=torch.int64, device=values.device)
    try:
        path, log_scores = functional.forced_align(values.contiguous(), targets, blank=blank_id)
        spans = functional.merge_tokens(path[0], log_scores[0].exp(), blank=blank_id)
    except (RuntimeError, ValueError) as error:
        raise AlignmentError("ctc_alignment_failed", reason=str(error)) from error
    if [span.token for span in spans] != list(token_ids):
        raise AlignmentError("incomplete_ctc_path")
    step = duration_seconds / values.shape[1]
    characters = []
    previous = 0
    for character, span in zip(text, spans):
        score = float(span.score)
        if span.start < previous or span.end <= span.start or not math.isfinite(score):
            raise AlignmentError("invalid_ctc_span")
        characters.append({"char": character, "token_id": span.token,
                           "start": span.start * step, "end": span.end * step,
                           "start_frame": span.start, "end_frame": span.end, "score": score})
        previous = span.end
    return characters


def boundary_candidates(audio, characters, clause_lengths, *, helper, baseline_cuts=None,
                        sample_rate=ANALYSIS_RATE):
    """Find quiet cuts strictly between the adjacent aligned character guards."""
    import numpy as np

    samples = np.asarray(audio)
    if (sample_rate != ANALYSIS_RATE or samples.ndim != 1 or not samples.size
            or not np.isfinite(samples).all()):
        raise AlignmentError("invalid_analysis_audio")
    if (not clause_lengths or any(type(length) is not int or length <= 0 for length in clause_lengths)
            or sum(clause_lengths) != len(characters)):
        raise AlignmentError("invalid_clause_lengths")
    duration, previous = samples.size / sample_rate, 0.0
    for character in characters:
        try:
            start, end = float(character["start"]), float(character["end"])
        except (KeyError, ValueError, TypeError) as error:
            raise AlignmentError("invalid_character_timestamps") from error
        if (not math.isfinite(start) or not math.isfinite(end) or start < previous - 1e-8
                or start < 0 or end <= start or end > duration + 1 / sample_rate):
            raise AlignmentError("invalid_character_timestamps")
        previous = end
    if baseline_cuts is None:
        baseline_cuts = [None] * (len(clause_lengths) - 1)
    if len(baseline_cuts) != len(clause_lengths) - 1 or any(
            value is not None and (type(value) not in (int, float) or not math.isfinite(value))
            for value in baseline_cuts):
        raise AlignmentError("invalid_baseline_cuts")
    if len(clause_lengths) == 1:
        return []
    try:
        levels, threshold = helper.frame_levels(samples)
    except Exception as error:
        raise AlignmentError("quiet_analysis_failed", reason=str(error)) from error
    results, offset = [], 0
    for index, length in enumerate(clause_lengths[:-1]):
        offset += length
        left, right = characters[offset - 1], characters[offset]
        lower, upper = float(left["end"]) + WORD_GUARD, float(right["start"]) - WORD_GUARD
        midpoint = (float(left["end"]) + float(right["start"])) / 2
        candidates = []
        if upper > lower:
            for candidate in helper.quiet_cut_candidates(levels, threshold, lower, upper, midpoint):
                start, end, cut = (float(candidate[key]) for key in
                                   ("quietStartSeconds", "quietEndSeconds", "cut"))
                if (start < lower - 1e-8 or end > upper + 1e-8 or end - start < .16 - 1e-8
                        or cut - start < WORD_GUARD - 1e-8 or end - cut < WORD_GUARD - 1e-8):
                    continue
                # Keep a native 10ms energy check in addition to helper metadata.
                first, last = round(start * 100), round(end * 100)
                if first >= last or not bool(np.all(levels[first:last] < candidate["thresholdDbfs"])):
                    continue
                candidates.append(dict(candidate))
        selected = candidates[0]["cut"] if candidates else None
        baseline = baseline_cuts[index]
        results.append({"boundary_index": index, "left_character_index": offset - 1,
                        "right_character_index": offset, "lower_seconds": lower, "upper_seconds": upper,
                        "safe": selected is not None, "cut_seconds": selected, "candidates": candidates,
                        "baseline_cut_seconds": baseline,
                        "baseline_delta_seconds": selected - baseline if selected is not None and baseline is not None else None})
    return results


def split_pcm(pcm, cuts_seconds, sample_rate=ANALYSIS_RATE, channels=1, sample_width=2):
    if (not isinstance(pcm, (bytes, bytearray)) or not pcm
            or any(type(value) is not int or value <= 0 for value in (sample_rate, channels, sample_width))):
        raise AlignmentError("invalid_pcm")
    frame_bytes = channels * sample_width
    if len(pcm) % frame_bytes:
        raise AlignmentError("incomplete_pcm_frame")
    frame_count = len(pcm) // frame_bytes
    boundaries, previous = [0], 0
    for cut in cuts_seconds:
        if type(cut) not in (int, float) or not math.isfinite(cut):
            raise AlignmentError("invalid_pcm_cut")
        frame = round(cut * sample_rate)
        if not previous < frame < frame_count:
            raise AlignmentError("invalid_pcm_cut")
        boundaries.append(frame)
        previous = frame
    boundaries.append(frame_count)
    pieces = [bytes(pcm[start * frame_bytes:end * frame_bytes])
              for start, end in zip(boundaries, boundaries[1:])]
    if b"".join(pieces) != pcm:
        raise AlignmentError("pcm_reassembly_mismatch")
    return pieces


def _atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def _hash(value):
    return hashlib.sha256(value).hexdigest()


def _file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _memory(torch_module=None):
    result = {}
    if os.name == "nt":
        class Status(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
                (name, ctypes.c_ulonglong) for name in
                ("total_phys", "avail_phys", "total_page", "avail_page", "total_virtual", "avail_virtual", "avail_extended")]
        status = Status()
        status.length = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            result.update(system_available_bytes=status.avail_phys, system_total_bytes=status.total_phys,
                          system_commit_available_bytes=status.avail_page, system_commit_limit_bytes=status.total_page)
        class Counters(ctypes.Structure):
            _fields_ = [("cb", ctypes.c_ulong), ("faults", ctypes.c_ulong)] + [
                (name, ctypes.c_size_t) for name in
                ("peak_working_set", "working_set", "peak_pool_paged", "pool_paged", "peak_pool_nonpaged",
                 "pool_nonpaged", "pagefile", "peak_pagefile", "private_usage")]
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        kernel = ctypes.windll.kernel32
        kernel.GetCurrentProcess.restype = ctypes.c_void_p
        psapi = ctypes.windll.psapi
        psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
        if psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            result.update(process_rss_bytes=counters.working_set, process_peak_rss_bytes=counters.peak_working_set)
    elif Path("/proc/meminfo").exists():
        rows = {line.split(":", 1)[0]: int(line.split()[1]) * 1024
                for line in Path("/proc/meminfo").read_text().splitlines()}
        result.update(system_available_bytes=rows.get("MemAvailable", 0), system_total_bytes=rows.get("MemTotal", 0))
        import resource
        result["process_peak_rss_bytes"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    if torch_module is not None and torch_module.cuda.is_available():
        free, total = torch_module.cuda.mem_get_info()
        result["gpu"] = {"free_bytes": free, "total_bytes": total,
                         "allocated_bytes": torch_module.cuda.memory_allocated(),
                         "reserved_bytes": torch_module.cuda.memory_reserved(),
                         "peak_allocated_bytes": torch_module.cuda.max_memory_allocated(),
                         "peak_reserved_bytes": torch_module.cuda.max_memory_reserved()}
    return result


def _read_source(path):
    try:
        with wave.open(str(path), "rb") as audio:
            rate, channels, width, frames = (audio.getframerate(), audio.getnchannels(), audio.getsampwidth(), audio.getnframes())
            if audio.getcomptype() != "NONE" or width != 2 or channels not in (1, 2) or not 8_000 <= rate <= 192_000:
                raise AlignmentError("source_requires_pcm16_wav")
            if not frames or frames / rate > MAX_SECONDS:
                raise AlignmentError("source_duration_limit", maximum_seconds=MAX_SECONDS)
            pcm = audio.readframes(frames)
    except (OSError, EOFError, wave.Error) as error:
        raise AlignmentError("source_wav_unreadable", reason=str(error)) from error
    if len(pcm) != frames * channels * width:
        raise AlignmentError("incomplete_pcm_frame")
    return {"pcm": pcm, "sample_rate": rate, "channels": channels, "sample_width": width,
            "frames": frames, "duration_seconds": frames / rate}


def _load_helper(path):
    specification = importlib.util.spec_from_file_location("forced_alignment_quiet_helper", path)
    if specification is None or specification.loader is None:
        raise AlignmentError("analysis_helper_unavailable")
    helper = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(helper)
    return helper


def _load_cases(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        cases = data["cases"]
    except (OSError, ValueError, TypeError, KeyError) as error:
        raise AlignmentError("invalid_cases_json", reason=str(error)) from error
    if not isinstance(cases, list) or not 1 <= len(cases) <= MAX_CASES:
        raise AlignmentError("case_count_limit", maximum=MAX_CASES)
    seen = set()
    for case in cases:
        if not isinstance(case, dict) or not isinstance(case.get("id"), str) or not case["id"] or case["id"] in seen:
            raise AlignmentError("invalid_case_id")
        seen.add(case["id"])
        if not isinstance(case.get("source"), str):
            raise AlignmentError("invalid_source_path", case_id=case["id"])
        variants = case.get("variants", [])
        if not isinstance(variants, list):
            raise AlignmentError("invalid_variants", case_id=case["id"])
        variant_ids = set()
        for index, variant in enumerate([{"id": "reference", "clauses": case.get("clauses")}, *variants]):
            if (not isinstance(variant, dict) or not isinstance(variant.get("id"), str) or not variant["id"]
                    or variant["id"] in variant_ids):
                raise AlignmentError("invalid_variant_id", case_id=case["id"])
            if index and variant["id"] == "reference":
                raise AlignmentError("reserved_variant_id", case_id=case["id"])
            variant_ids.add(variant["id"])
            if not isinstance(variant.get("clauses"), list) or not variant["clauses"] or any(
                    not isinstance(text, str) or not text for text in variant["clauses"]):
                raise AlignmentError("invalid_clauses", case_id=case["id"])
        source = Path(case["source"]).expanduser()
        case["source"] = str((source if source.is_absolute() else path.parent / source).resolve())
        # Validate every source limit before importing/loading any large model.
        _read_source(case["source"])
        expected_sha = case.get("sourceSha256")
        actual_sha = _file_hash(case["source"])
        if expected_sha is not None and (not isinstance(expected_sha, str)
                or not re.fullmatch(r"[0-9a-fA-F]{64}", expected_sha) or actual_sha != expected_sha.lower()):
            raise AlignmentError("source_sha256_mismatch", case_id=case["id"], actual_sha256=actual_sha)
        case["validated_source_sha256"] = actual_sha
    return cases


def _prepared_variant(variant, converter, vocabulary, blank_id, unk_id):
    result = {"id": variant["id"], "clauses": variant["clauses"],
              "text_correctness": "not_verified_by_forced_alignment", "timing_only": True}
    try:
        normalized = [normalize_with_mapping(clause, converter) for clause in variant["clauses"]]
        result["normalized_clauses"] = [item["text"] for item in normalized]
        if any(not text for text in result["normalized_clauses"]):
            raise AlignmentError("empty_clause")
        result["normalized_text"] = "".join(result["normalized_clauses"])
        result["normalization"] = normalized
        result["token_ids"] = encode_text(result["normalized_text"], vocabulary, blank_id, unk_id)
        result["status"] = "prepared"
    except AlignmentError as error:
        result.update(status="unaligned", error={"code": error.code, **error.details})
    return result


def _write_split(directory, source, boundaries):
    cuts = [boundary["cut_seconds"] for boundary in boundaries]
    pieces = split_pcm(source["pcm"], cuts, source["sample_rate"], source["channels"], source["sample_width"])
    directory.mkdir(parents=True, exist_ok=True)
    clips, start = [], 0
    for index, piece in enumerate(pieces, 1):
        path = directory / f"{index:03d}.wav"
        if path.exists():
            raise AlignmentError("split_output_exists", path=str(path))
        with wave.open(str(path), "wb") as audio:
            audio.setnchannels(source["channels"])
            audio.setsampwidth(source["sample_width"])
            audio.setframerate(source["sample_rate"])
            audio.writeframes(piece)
        end = start + len(piece) // (source["channels"] * source["sample_width"])
        clips.append({"index": index, "path": str(path), "start_frame": start, "end_frame": end,
                      "start_seconds": start / source["sample_rate"], "end_seconds": end / source["sample_rate"],
                      "pcm_sha256": _hash(piece), "wav_sha256": _hash(path.read_bytes())})
        start = end
    assembled = b"".join(_read_source(clip["path"])["pcm"] for clip in clips)
    if assembled != source["pcm"]:
        raise AlignmentError("pcm_reassembly_mismatch")
    return {"clips": clips, "exact_pcm_match": True, "rejoined_pcm_sha256": _hash(assembled)}


def run_experiment(model_path, cases_path, output, analysis_helper=DEFAULT_HELPER):
    model_path, cases_path, output = (Path(value).expanduser().resolve() for value in (model_path, cases_path, output))
    cases = _load_cases(cases_path)
    if not Path(analysis_helper).is_file():
        raise AlignmentError("analysis_helper_unavailable", path=str(analysis_helper))
    if output == model_path or model_path in output.parents:
        raise AlignmentError("output_overlaps_model")
    for case in cases:
        if Path(case["source"]).parent == output or Path(case["source"]).parent in output.parents:
            raise AlignmentError("output_overlaps_source_tree", case_id=case["id"])
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise AlignmentError("output_directory_not_empty", path=str(output))
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / "report.json"
    if report_path.exists():
        raise AlignmentError("report_output_exists", path=str(report_path))
    started = time.perf_counter()
    report = {"version": 1, "method": "Wav2Vec2 CTC + torchaudio.functional.forced_align/merge_tokens",
              "not_full_whisperx": True, "text_correctness": "not_verified_by_forced_alignment",
              "model": {"path": str(model_path), "upstream_id": MODEL_ID, "upstream_revision": MODEL_REVISION},
              "limits": {"max_cases": MAX_CASES, "max_source_seconds": MAX_SECONDS,
                         "independent_experiment_startup_physical_ram_bytes": MIN_PHYSICAL_RAM_BYTES,
                         "independent_experiment_startup_commit_available_bytes": MIN_COMMIT_AVAILABLE_BYTES,
                         "product_memory_guard_changed": False},
              "analysis_helper": str(Path(analysis_helper).resolve()), "cases": [], "status": "preparing"}
    report["input_protection"] = {"cases_path": str(cases_path), "cases_sha256": _file_hash(cases_path),
                                  "analysis_helper_sha256": _file_hash(analysis_helper),
                                  "sources": [{"path": item["source"], "sha256": item["validated_source_sha256"]} for item in cases],
                                  "output_was_empty": True, "model_tree_excluded_from_output": True}
    report["cases_sha256"] = report["input_protection"]["cases_sha256"]
    report["analysis_helper_sha256"] = report["input_protection"]["analysis_helper_sha256"]
    receipt_path = model_path.parent / "model-download.json"
    if receipt_path.is_file():
        receipt = json.loads(receipt_path.read_text(encoding="utf-8-sig"))
        report["model"]["download_receipt"] = {"path": str(receipt_path), "sha256": _file_hash(receipt_path),
                                                 "files": receipt.get("files", []),
                                                 "verification_note": "Copied prior download verification; weights are not rehashed by this run."}
    _atomic_json(report_path, report)
    try:
        if not model_path.is_dir():
            raise AlignmentError("local_model_directory_missing")
        report["startup_memory"] = _memory()
        physical = report["startup_memory"].get("system_available_bytes", 0)
        commit = report["startup_memory"].get("system_commit_available_bytes", physical)
        if physical < MIN_PHYSICAL_RAM_BYTES or commit < MIN_COMMIT_AVAILABLE_BYTES:
            raise AlignmentError("insufficient_startup_memory", required_physical_bytes=MIN_PHYSICAL_RAM_BYTES,
                                 available_physical_bytes=physical, required_commit_bytes=MIN_COMMIT_AVAILABLE_BYTES,
                                 available_commit_bytes=commit)
        report["status"] = "loading"
        _atomic_json(report_path, report)
        # Process-local offline flags; no package installation or persisted config.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        import numpy as np
        import torch
        import torchaudio
        import transformers
        from transformers import Wav2Vec2Processor, Wav2Vec2ForCTC
        from scipy.signal import resample_poly
        from opencc import OpenCC

        if not torch.cuda.is_available():
            raise AlignmentError("cuda_required")
        load_started = time.perf_counter()
        report["environment"] = {"python": sys.version, "executable": sys.executable, "torch": torch.__version__,
                                 "torchaudio": torchaudio.__version__, "transformers": transformers.__version__,
                                 "cuda_device": torch.cuda.get_device_name(0), "inference_dtype": "float16",
                                 "ctc_alignment_device": "cpu", "local_files_only": True}
        report["before_model_memory"] = _memory(torch)
        torch.cuda.reset_peak_memory_stats()
        processor = Wav2Vec2Processor.from_pretrained(str(model_path), local_files_only=True)
        original_normalize = processor.feature_extractor.do_normalize
        processor.feature_extractor.do_normalize = True
        model = Wav2Vec2ForCTC.from_pretrained(str(model_path), local_files_only=True,
                                            torch_dtype=torch.float16, low_cpu_mem_usage=True).eval().to("cuda")
        torch.cuda.synchronize()
        report["model"].update(load_seconds=time.perf_counter() - load_started,
                               processor_original_do_normalize=original_normalize,
                               processor_effective_do_normalize=True, attention_mask=True)
        report["after_model_memory"] = _memory(torch)
        vocabulary = processor.tokenizer.get_vocab()
        blank_id, unk_id = model.config.pad_token_id, processor.tokenizer.unk_token_id
        if type(blank_id) is not int:
            raise AlignmentError("ctc_blank_id_missing")
        report["model"].update(vocabulary_size=len(vocabulary), blank_id=blank_id, unk_id=unk_id)
        converter, helper = OpenCC("t2s"), _load_helper(analysis_helper)
        report["status"] = "running"
        _atomic_json(report_path, report)
        for case_index, case in enumerate(cases, 1):
            case_started = time.perf_counter()
            emission = logits = input_values = attention_mask = inputs = model_audio = analysis_audio = audio = None
            result = {"id": case["id"], "source": case["source"], "status": "preparing", "variants": []}
            report["cases"].append(result)
            _atomic_json(report_path, report)
            try:
                source = _read_source(case["source"])
                result.update({key: value for key, value in source.items() if key != "pcm"})
                result.update(pcm_sha256=_hash(source["pcm"]), source_sha256=_hash(Path(case["source"]).read_bytes()))
                if result["source_sha256"] != case["validated_source_sha256"]:
                    raise AlignmentError("source_changed_after_preflight")
                definitions = [{"id": "reference", "clauses": case["clauses"]}, *case.get("variants", [])]
                result["variants"] = [_prepared_variant(item, converter, vocabulary, blank_id, unk_id) for item in definitions]
                _atomic_json(report_path, report)
                if not any(item["status"] == "prepared" for item in result["variants"]):
                    result.update(status="unaligned", inference={"emission_count": 0})
                    continue
                audio = np.frombuffer(source["pcm"], dtype="<i2").reshape(-1, source["channels"]).astype(np.float32).mean(axis=1) / 32768
                def resample(rate):
                    divisor = math.gcd(source["sample_rate"], rate)
                    return resample_poly(audio, rate // divisor, source["sample_rate"] // divisor).astype(np.float32)
                model_audio, analysis_audio = resample(MODEL_RATE), resample(ANALYSIS_RATE)
                torch.cuda.reset_peak_memory_stats()
                result["before_inference_memory"] = _memory(torch)
                inference_started = time.perf_counter()
                inputs = processor(model_audio, sampling_rate=MODEL_RATE, return_tensors="pt",
                                   return_attention_mask=True, padding=False)
                input_values = inputs["input_values"].to(device="cuda", dtype=torch.float16)
                attention_mask = inputs["attention_mask"].to(device="cuda", dtype=torch.long)
                with torch.inference_mode():
                    logits = model(input_values=input_values, attention_mask=attention_mask).logits
                    emission = logits[0].float().log_softmax(-1).cpu()
                torch.cuda.synchronize()
                greedy = processor.tokenizer.decode(emission.argmax(-1).tolist(), group_tokens=True, skip_special_tokens=True)
                result["inference"] = {"emission_count": 1, "seconds": time.perf_counter() - inference_started,
                                       "emission_frames": emission.shape[0], "greedy_text": greedy,
                                       "normalized_greedy_text": normalize(greedy, converter),
                                       "memory": _memory(torch),
                                       "timestamp_grid": "duration_seconds / emission_frames; no missing-token interpolation"}
                del logits, input_values, attention_mask, inputs
                torch.cuda.empty_cache()
                _atomic_json(report_path, report)
                for variant in result["variants"]:
                    if variant["status"] != "prepared":
                        continue
                    alignment_started = time.perf_counter()
                    try:
                        variant["chars"] = align_emission(emission, variant["normalized_text"], variant["token_ids"], source["duration_seconds"], blank_id)
                        lengths = [len(text) for text in variant["normalized_clauses"]]
                        baseline = case.get("baselineCuts") if len(lengths) == len(case["clauses"]) else None
                        variant["boundaries"] = boundary_candidates(analysis_audio, variant["chars"], lengths,
                                                                     helper=helper, baseline_cuts=baseline)
                        scores = [character["score"] for character in variant["chars"]]
                        variant.update(status="aligned", mean_score=sum(scores) / len(scores), min_score=min(scores),
                                       all_boundaries_safe=all(boundary["safe"] for boundary in variant["boundaries"]))
                        if variant["id"] == "reference" and variant["all_boundaries_safe"]:
                            label = re.sub(r"[^A-Za-z0-9_-]", "_", case["id"])[:70] or "case"
                            variant["split"] = _write_split(output / f"{case_index:03d}_{label}" / "reference", source, variant["boundaries"])
                    except AlignmentError as error:
                        variant.update(status="unaligned", error={"code": error.code, **error.details})
                    finally:
                        variant["alignment_seconds"] = time.perf_counter() - alignment_started
                        _atomic_json(report_path, report)
                del emission, model_audio, analysis_audio, audio
                torch.cuda.empty_cache()
                result["status"] = "complete"
            except Exception as error:
                result.update(status="error", error={"code": error.code if isinstance(error, AlignmentError) else type(error).__name__,
                                                     "details": error.details if isinstance(error, AlignmentError) else str(error)})
            finally:
                emission = logits = input_values = attention_mask = inputs = model_audio = analysis_audio = audio = None
                torch.cuda.empty_cache()
                result["seconds"] = time.perf_counter() - case_started
                result["after_case_memory"] = _memory(torch)
                _atomic_json(report_path, report)
        report["input_protection"]["after_sources"] = [{"path": item["source"],
            "sha256": _file_hash(item["source"]),
            "unchanged": _file_hash(item["source"]) == item["validated_source_sha256"]} for item in cases]
        report["input_protection"]["all_sources_unchanged"] = all(item["unchanged"] for item in report["input_protection"]["after_sources"])
        report["status"] = "complete" if not any(case["status"] == "error" for case in report["cases"]) and report["input_protection"]["all_sources_unchanged"] else "completed_with_errors"
    except Exception as error:
        report.update(status="error", error={"code": error.code if isinstance(error, AlignmentError) else type(error).__name__,
                                             "details": error.details if isinstance(error, AlignmentError) else str(error)})
    finally:
        report["total_seconds"] = time.perf_counter() - started
        _atomic_json(report_path, report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="独立中文CTC强制对齐实验；仅本地模型/CUDA fp16，不是完整WhisperX。")
    parser.add_argument("--model", required=True, type=Path, help="已下载的本地 Wav2Vec2 模型目录")
    parser.add_argument("--cases", required=True, type=Path, help="包含cases数组的JSON；最多10例，每例≤45秒")
    parser.add_argument("--output", required=True, type=Path, help="新的独立实验输出目录；写report.json")
    parser.add_argument("--analysis-helper", type=Path, default=DEFAULT_HELPER)
    args = parser.parse_args(argv)
    try:
        result = run_experiment(args.model, args.cases, args.output, args.analysis_helper)
    except AlignmentError as error:
        print(json.dumps({"error": error.code, **error.details}, ensure_ascii=False), file=sys.stderr)
        return 2
    print(json.dumps({"status": result["status"], "report": str(args.output.resolve() / "report.json")}, ensure_ascii=False))
    return 0 if result["status"] == "complete" else 2


if __name__ == "__main__":
    raise SystemExit(main())
