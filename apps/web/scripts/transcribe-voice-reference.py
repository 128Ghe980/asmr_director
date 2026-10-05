"""One local CPU/int8 Whisper job for an already normalized reference segment."""
import argparse
import json
import math
import os
from pathlib import Path
import re
import sys
import wave

LANGUAGES = {"zh", "en", "ja", "ko"}


def load_model(model_path: str):
    from faster_whisper import WhisperModel
    return WhisperModel(str(Path(model_path).resolve(strict=True)), device="cpu", compute_type="int8",
                        cpu_threads=min(4, max(1, (os.cpu_count() or 2) // 2)), num_workers=1,
                        local_files_only=True)


def write_result(output: Path, value: dict) -> None:
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(output)


def process_request(request_file: str, model_provider=load_model) -> int:
    request_path = Path(request_file).resolve(strict=True)
    if request_path.stat().st_size > 65536:
        return 2
    request = json.loads(request_path.read_text(encoding="utf-8-sig"))
    if not isinstance(request, dict) or set(request) != {"version", "inputWav", "outputJson", "modelPath", "language"} or request["version"] != 1:
        return 2
    if not isinstance(request["language"], str) or request["language"] not in LANGUAGES or any(not isinstance(request[key], str) for key in ("inputWav", "outputJson", "modelPath")):
        return 2
    root = request_path.parent
    source, output = (Path(request[key]).resolve() for key in ("inputWav", "outputJson"))
    if source.parent != root or output.parent != root or len({request_path, source, output}) != 3:
        return 2
    result = {"version": 1, "success": False, "code": "transcription_failed"}
    try:
        if source.stat().st_size > 30 * 16000 * 2 + 65536:
            raise ValueError("invalid_audio")
        with wave.open(str(source), "rb") as audio:
            duration = audio.getnframes() / audio.getframerate()
            if audio.getframerate() != 16000 or audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getcomptype() != "NONE" or not math.isfinite(duration) or not 1 <= duration <= 30:
                raise ValueError("invalid_audio")
            expected = audio.getnframes() * 2
            if len(audio.readframes(audio.getnframes())) != expected:
                raise ValueError("invalid_audio")
        model_path = Path(request["modelPath"]).resolve(strict=True)
        if any(not (model_path / filename).is_file() for filename in ("model.bin", "config.json", "tokenizer.json")):
            raise ImportError("runtime_unavailable")
        try:
            model = model_provider(str(model_path))
        except Exception:
            raise ImportError("runtime_unavailable") from None
        segments, _ = model.transcribe(str(source), language=request["language"], task="transcribe", beam_size=5,
                                       temperature=0, condition_on_previous_text=False, vad_filter=True)
        transcript = "".join(segment.text for segment in segments).strip()
        if not transcript or not re.search(r"[^\W_]", transcript, re.UNICODE):
            result["code"] = "no_speech"
        elif len(transcript) > 2000 or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", transcript):
            result["code"] = "transcription_failed"
        else:
            result = {"version": 1, "success": True, "transcript": transcript, "language": request["language"]}
    except (ValueError, wave.Error, EOFError):
        result["code"] = "invalid_audio"
    except ImportError:
        result["code"] = "runtime_unavailable"
    except Exception:
        # No local paths, exception strings, source text, or credentials leave Python.
        result["code"] = "transcription_failed"
    write_result(output, result)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    arguments = parser.parse_args()
    return process_request(arguments.request)


if __name__ == "__main__":
    sys.exit(main())
