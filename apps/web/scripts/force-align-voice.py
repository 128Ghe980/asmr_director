"""Local CTC forced segmentation, separate from automatic quiet-based cutting.

Given text supplies positions, never a content-certification target. Prefix CTC
scores every input frame on ordered known-text or blank states, ending on any
completed allowed prefix. Unknown characters keep their own wildcard identity.
No quiet or confidence threshold is used.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import sys
import unicodedata
import wave

import numpy as np

RATE = 48_000
MODEL_RATE = 16_000
MAX_SECONDS = 120
MODEL_ID = "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn"
MODEL_REVISION = "99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd"
MODEL_WEIGHT_SHA256 = "de031fd4b29e0c0667e5346450fadfe1326c89936b888b59c4ede608db763ee4"
MODEL_WEIGHT_BYTES = 1_276_296_151
MODEL_METADATA_BLOBS = {
    "config.json": "4f7143f7712623888c22adffeca380cef645124c",
    "vocab.json": "da3e3b635068f5a44c273636b36f0153f964d8bb",
    "preprocessor_config.json": "0886a48276922a77013d8aa4681192138ae90d90",
    "special_tokens_map.json": "25bc39604f72700b3b8e10bd69bb2f227157edd1",
}


class AlignmentError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def ctc_align(emission, token_ids, *, blank_id=0, prefix=False, required_tokens=None):
    """Viterbi CTC on all T frames, optionally ending at an ordered text prefix.

    String tokens are source-character wildcard identities. Their per-frame
    score is max(nonblank emission), without changing the fixed model vocabulary.
    There is no unlabelled acoustic sink: read context must explain tail frames
    through ordered text/wildcard/blank states just like the target prefix.
    """
    values = np.asarray(emission, dtype=np.float32)
    if values.ndim != 2 or not values.shape[0] or not values.shape[1] or not np.isfinite(values).all():
        raise AlignmentError("invalid_emission")
    frames, width = values.shape
    def valid_token(token):
        return ((type(token) is int and 0 <= token < width and token != blank_id)
                or (isinstance(token, str) and len(token) == 1))
    if (not isinstance(token_ids, (list, tuple)) or not token_ids
            or type(blank_id) is not int or not 0 <= blank_id < width
            or any(not valid_token(token) for token in token_ids)):
        raise AlignmentError("invalid_token_ids")
    if width < 2 and any(isinstance(token, str) for token in token_ids):
        raise AlignmentError("invalid_emission")
    if prefix:
        if type(required_tokens) is not int or not 1 <= required_tokens <= len(token_ids):
            raise AlignmentError("invalid_required_tokens")
    else:
        required_tokens = len(token_ids)
    required = token_ids[:required_tokens]
    repeats = sum(left == right for left, right in zip(required, required[1:]))
    if frames < len(required) + repeats:
        raise AlignmentError("insufficient_ctc_frames")

    states = np.full(2 * len(token_ids) + 1, blank_id, dtype=np.int32)
    wildcard_states = np.zeros(len(states), dtype=bool)
    for index, token in enumerate(token_ids):
        if isinstance(token, str):
            wildcard_states[2 * index + 1] = True
        else:
            states[2 * index + 1] = token
    count = len(states)
    can_skip = np.zeros(count, dtype=bool)
    for index in range(1, len(token_ids)):
        can_skip[2 * index + 1] = token_ids[index] != token_ids[index - 1]
    nonblank = np.arange(width) != blank_id
    wildcard_scores = values[:, nonblank].max(axis=1) if wildcard_states.any() else None

    def frame_scores(frame):
        result = values[frame, states].astype(np.float64)
        if wildcard_scores is not None:
            result[wildcard_states] = wildcard_scores[frame]
        return result

    previous = np.full(count, -np.inf, dtype=np.float64)
    initial_scores = frame_scores(0)
    previous[0], previous[1] = initial_scores[0], initial_scores[1]
    # uint8 stores stay / advance / CTC skip, not a full state index per cell.
    back = np.zeros((frames, count), dtype=np.uint8)
    eligible = np.arange(2 * required_tokens - 1, count, dtype=np.int32)
    for frame in range(1, frames):
        advance = np.full(count, -np.inf, dtype=np.float64)
        advance[1:] = previous[:-1]
        skip = np.full(count, -np.inf, dtype=np.float64)
        skip[2:] = previous[:-2]
        skip[~can_skip] = -np.inf
        alternatives = np.stack((previous, advance, skip))
        move = alternatives.argmax(axis=0).astype(np.uint8)
        best = np.take_along_axis(alternatives, move[None, :], axis=0)[0]
        current = best + frame_scores(frame)
        back[frame] = move
        previous = current

    if prefix:
        state = int(eligible[int(previous[eligible].argmax())])
        total = float(previous[state])
    else:
        endings = np.array([count - 2, count - 1])
        state = int(endings[int(previous[endings].argmax())])
        total = float(previous[state])
    if not math.isfinite(total):
        raise AlignmentError("ctc_alignment_failed")

    path = np.empty(frames, dtype=np.int32)
    for frame in range(frames - 1, -1, -1):
        path[frame] = state
        if not frame:
            break
        state -= int(back[frame, state])
    if path[0] not in (0, 1):
        raise AlignmentError("invalid_ctc_path")
    spans = []
    for token_index, token in enumerate(token_ids):
        positions = np.flatnonzero(path == 2 * token_index + 1)
        if not positions.size:
            break
        assigned_scores = wildcard_scores[positions] if isinstance(token, str) else values[positions, token]
        score = float(np.exp(assigned_scores.astype(np.float64)).mean())
        if not math.isfinite(score):
            raise AlignmentError("invalid_ctc_span")
        spans.append({"tokenIndex": token_index, "startFrame": int(positions[0]),
                      "endFrame": int(positions[-1]) + 1, "score": score,
                      **({"wildcard": True} if isinstance(token, str) else {})})
    if len(spans) < required_tokens or (not prefix and len(spans) != len(token_ids)):
        raise AlignmentError("incomplete_ctc_path")
    return {"spans": spans, "emissionFrames": frames, "totalLogScore": total}


def encode_alignment_text(text, vocabulary, *, blank_id=0, unk_id=3, required_chars=None):
    if not isinstance(text, str) or not text:
        raise AlignmentError("empty_text")
    if required_chars is not None and (type(required_chars) is not int or not 1 <= required_chars <= len(text)):
        raise AlignmentError("invalid_required_tokens")
    tokens = []
    for index, character in enumerate(text):
        token = vocabulary.get(character)
        if type(token) is not int or token < 0 or token == blank_id or token == unk_id:
            # Keep the original character as a separate unknown-pronunciation
            # state. No vocabulary edit, substitute spelling or invented time.
            tokens.append(character)
        else:
            tokens.append(token)
    return tokens


def characters_from_alignment(text, alignment, duration):
    if not math.isfinite(duration) or duration <= 0:
        raise AlignmentError("invalid_duration")
    spans, frames = alignment["spans"], alignment["emissionFrames"]
    if not spans or len(spans) > len(text) or type(frames) is not int or frames <= 0:
        raise AlignmentError("invalid_ctc_span")
    characters, previous = [], 0
    for index, span in enumerate(spans):
        start, end, score = span["startFrame"], span["endFrame"], span["score"]
        if (span["tokenIndex"] != index or not 0 <= previous <= start < end <= frames
                or not math.isfinite(score)):
            raise AlignmentError("invalid_ctc_span")
        characters.append({"char": text[index], "startSeconds": start * duration / frames,
                           "endSeconds": end * duration / frames, "score": score,
                           **({"wildcard": True} if span.get("wildcard") is True else {})})
        previous = end
    return characters


def cut_frames(characters, clause_lengths, source_frames, *, mode):
    if (mode not in ("paragraph", "prefix") or type(source_frames) is not int or source_frames <= 0
            or not clause_lengths or any(type(length) is not int or length <= 0 for length in clause_lengths)):
        raise AlignmentError("invalid_clause_lengths")
    total = sum(clause_lengths)
    if ((mode == "paragraph" and total != len(characters))
            or (mode == "prefix" and total >= len(characters))):
        raise AlignmentError("incomplete_ctc_path")
    duration, previous = source_frames / RATE, 0.0
    for character in characters:
        start, end, score = character["startSeconds"], character["endSeconds"], character["score"]
        if (not all(math.isfinite(value) for value in (start, end, score))
                or not 0 <= previous <= start < end <= duration + 1 / RATE):
            raise AlignmentError("invalid_character_timestamps")
        previous = end
    offsets = [total] if mode == "prefix" else list(np.cumsum(clause_lengths[:-1]))
    cuts, previous_cut = [], 0
    for offset in offsets:
        left, right = characters[offset - 1], characters[offset]
        frame = round((left["endSeconds"] + right["startSeconds"]) / 2 * RATE)
        if not previous_cut < frame < source_frames:
            raise AlignmentError("invalid_pcm_cut")
        cuts.append(frame)
        previous_cut = frame
    return cuts


def normalize_with_mapping(text, converter=None):
    kept, mapping = [], []
    for index, character in enumerate(text):
        if character.isspace() or unicodedata.category(character).startswith("P") or character in "~～":
            continue
        kept.append(character)
        mapping.append(index)
    original = "".join(kept)
    normalized = converter.convert(original) if converter is not None else original
    if not isinstance(normalized, str) or len(normalized) != len(original):
        raise AlignmentError("normalization_length_changed")
    return {"text": normalized, "mapping": mapping}


def read_source(path):
    try:
        source = Path(path)
        if source.stat().st_size > 24 * 1024 * 1024:
            raise AlignmentError("audio_too_large")
        data = source.read_bytes()
        with wave.open(io.BytesIO(data), "rb") as audio:
            rate, channels, width, frames = audio.getframerate(), audio.getnchannels(), audio.getsampwidth(), audio.getnframes()
            if (audio.getcomptype() != "NONE" or rate != RATE or channels != 1 or width != 2
                    or not 0 < frames <= RATE * MAX_SECONDS):
                raise AlignmentError("invalid_audio")
            pcm = audio.readframes(frames)
        if len(pcm) != frames * 2:
            raise AlignmentError("incomplete_pcm_frame")
        return {"pcm": pcm, "sourceFrames": frames, "sourceSha256": hashlib.sha256(data).hexdigest()}
    except (OSError, EOFError, wave.Error) as error:
        raise AlignmentError("source_unavailable") from error


def _model_assets(model_path):
    directory = Path(model_path)
    try:
        for name, expected in MODEL_METADATA_BLOBS.items():
            data = (directory / name).read_bytes()
            actual = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()
            if actual != expected:
                raise AlignmentError("model_identity_mismatch")
        weight = directory / "pytorch_model.bin"
        if weight.stat().st_size != MODEL_WEIGHT_BYTES:
            raise AlignmentError("model_identity_mismatch")
        digest = hashlib.sha256()
        with weight.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != MODEL_WEIGHT_SHA256:
            raise AlignmentError("model_identity_mismatch")
        return json.loads((directory / "vocab.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise AlignmentError("model_unavailable") from error


def infer_emission(model_path, pcm):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    try:
        import torch
        from scipy.signal import resample_poly
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
    except ImportError as error:
        raise AlignmentError("alignment_runtime_unavailable") from error
    if not torch.cuda.is_available():
        raise AlignmentError("cuda_unavailable")
    model = processor = input_values = attention_mask = logits = None
    try:
        processor = Wav2Vec2Processor.from_pretrained(str(model_path), local_files_only=True)
        processor.feature_extractor.do_normalize = True
        model = Wav2Vec2ForCTC.from_pretrained(str(model_path), local_files_only=True,
            torch_dtype=torch.float16, low_cpu_mem_usage=True).eval().to("cuda")
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        analysis = resample_poly(audio, 1, 3).astype(np.float32)
        inputs = processor(analysis, sampling_rate=MODEL_RATE, return_tensors="pt", return_attention_mask=True, padding=False)
        input_values = inputs["input_values"].to(device="cuda", dtype=torch.float16)
        attention_mask = inputs["attention_mask"].to(device="cuda", dtype=torch.long)
        with torch.inference_mode():
            logits = model(input_values=input_values, attention_mask=attention_mask).logits
            return logits[0].float().log_softmax(-1).cpu().numpy()
    except Exception as error:
        raise AlignmentError("model_inference_failed") from error
    finally:
        del model, processor, input_values, attention_mask, logits
        torch.cuda.empty_cache()


def force_align(request, *, emission_provider=None, vocabulary=None, converter=None):
    source = read_source(request["inputWav"])
    if converter is None:
        try:
            from opencc import OpenCC
            converter = OpenCC("t2s")
        except ImportError as error:
            raise AlignmentError("alignment_runtime_unavailable") from error
    normalized_clauses = [normalize_with_mapping(clause, converter)["text"] for clause in request["clauses"]]
    if any(not clause for clause in normalized_clauses):
        raise AlignmentError("empty_clause")
    target = "".join(normalized_clauses)
    text = normalize_with_mapping(request["inputText"], converter)["text"]
    prefix = request["mode"] == "prefix"
    if ((not prefix and request["inputText"] != "".join(request["clauses"]))
            or not text.startswith(target)):
        raise AlignmentError("input_text_mismatch")
    required = len(target) + 1 if prefix else len(text)
    if prefix and required > len(text):
        raise AlignmentError("missing_following_text")
    if vocabulary is None:
        vocabulary = _model_assets(request["modelPath"])
    token_ids = encode_alignment_text(text, vocabulary, required_chars=required if prefix else None)
    emission = (emission_provider or infer_emission)(request["modelPath"], source["pcm"])
    alignment = ctc_align(emission, token_ids, prefix=prefix, required_tokens=required if prefix else None)
    characters = characters_from_alignment(text, alignment, source["sourceFrames"] / RATE)
    cuts = cut_frames(characters, [len(clause) for clause in normalized_clauses], source["sourceFrames"], mode=request["mode"])
    return {"version": 1, "success": True, "method": "ctc_forced", "mode": request["mode"],
            "sourceSha256": source["sourceSha256"],
            "inputTextSha256": hashlib.sha256(request["inputText"].encode("utf-8")).hexdigest(),
            "modelId": MODEL_ID, "modelRevision": MODEL_REVISION, "sampleRate": RATE,
            "sourceFrames": source["sourceFrames"], "cutFrames": cuts, "characters": characters,
            "contentVerified": False}


def _parse_request(path):
    path = Path(path).resolve(strict=True)
    if path.stat().st_size > 65536:
        raise AlignmentError("invalid_request")
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise AlignmentError("invalid_request")
            result[key] = value
        return result
    request = json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique_object)
    expected = {"version", "inputWav", "outputJson", "modelPath", "mode", "clauses", "inputText"}
    if (not isinstance(request, dict) or set(request) != expected or type(request["version"]) is not int or request["version"] != 1
            or request["mode"] not in ("paragraph", "prefix")
            or not isinstance(request["inputText"], str) or not request["inputText"]
            or not isinstance(request["clauses"], list) or not 1 <= len(request["clauses"]) <= 32
            or any(not isinstance(clause, str) or not clause for clause in request["clauses"])
            or any(not isinstance(request[key], str) or not request[key] for key in ("inputWav", "outputJson", "modelPath"))):
        raise AlignmentError("invalid_request")
    source = Path(request["inputWav"]).resolve()
    output = Path(request["outputJson"]).resolve()
    temporary = output.with_name(output.name + ".tmp")
    if (output.parent != path.parent or output in (source, path)
            or temporary.resolve().parent != path.parent or temporary.resolve() in (source, path, output)
            or temporary.exists() or temporary.is_symlink()):
        raise AlignmentError("invalid_output_path")
    request["inputWav"], request["outputJson"], request["modelPath"] = str(source), str(output), str(Path(request["modelPath"]).resolve())
    return request


def process_request(path, **dependencies):
    try:
        request = _parse_request(path)
    except (AlignmentError, OSError, ValueError, TypeError):
        return 2
    try:
        result = force_align(request, **dependencies)
    except AlignmentError as error:
        result = {"version": 1, "success": False, "code": error.code}
    except Exception:
        result = {"version": 1, "success": False, "code": "alignment_failed"}
    output = Path(request["outputJson"])
    temporary = output.with_name(output.name + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            json.dump(result, handle, ensure_ascii=False, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
    except (OSError, ValueError):
        return 2
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    arguments = parser.parse_args()
    return process_request(arguments.request)


if __name__ == "__main__":
    sys.exit(main())
