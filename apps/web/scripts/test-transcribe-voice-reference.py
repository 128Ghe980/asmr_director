"""Standard-library-only tests: no installed Whisper module or model is loaded."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
import wave

SPEC = importlib.util.spec_from_file_location("reference_transcriber", Path(__file__).with_name("transcribe-voice-reference.py"))
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)


class ReferenceTranscriptionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "segment.wav"
        self.output = self.root / "result.json"
        self.request = self.root / "request.json"
        self.model_path = self.root / "model"
        self.model_path.mkdir()
        for filename in ("model.bin", "config.json", "tokenizer.json"):
            (self.model_path / filename).write_bytes(b"fixture")
        self.write_audio()
        self.data = {"version": 1, "inputWav": str(self.source), "outputJson": str(self.output),
                     "modelPath": str(self.model_path), "language": "zh"}
        self.model = Mock()
        self.model.transcribe.return_value = (iter([SimpleNamespace(text="你好，"), SimpleNamespace(text="今天辛苦了。")]), object())
        self.provider = Mock(return_value=self.model)

    def write_audio(self, rate=16000, channels=1, width=2, seconds=2):
        with wave.open(str(self.source), "wb") as audio:
            audio.setnchannels(channels)
            audio.setsampwidth(width)
            audio.setframerate(rate)
            audio.writeframes(b"\x01" * int(rate * channels * width * seconds))

    def run_request(self):
        self.request.write_text(json.dumps(self.data), encoding="utf-8")
        return helper.process_request(str(self.request), self.provider)

    def result(self):
        return json.loads(self.output.read_text(encoding="utf-8"))

    def test_selected_wav_only_and_explicit_languages(self):
        for language in ("zh", "en", "ja", "ko"):
            with self.subTest(language=language):
                self.data["language"] = language
                self.model.transcribe.return_value = (iter([SimpleNamespace(text="你好。")]), object())
                original = self.source.read_bytes()
                self.assertEqual(self.run_request(), 0)
                self.assertEqual(self.result(), {"version": 1, "success": True, "transcript": "你好。", "language": language})
                self.model.transcribe.assert_called_with(str(self.source), language=language, task="transcribe", beam_size=5,
                                                        temperature=0, condition_on_previous_text=False, vad_filter=True)
                self.assertEqual(self.source.read_bytes(), original)
                self.assertFalse((self.root / "result.tmp").exists())

    def test_preserves_transcript_punctuation(self):
        self.assertEqual(self.run_request(), 0)
        self.assertEqual(self.result()["transcript"], "你好，今天辛苦了。")

    def test_unknown_and_non_string_language_rejected_before_model(self):
        for language in ("auto", "fr", ["zh"], None):
            with self.subTest(language=language):
                self.data["language"] = language
                self.assertEqual(self.run_request(), 2)
                self.provider.assert_not_called()

    def test_paths_cannot_escape_owned_directory(self):
        self.data["outputJson"] = str(self.root.parent / "outside.json")
        self.assertEqual(self.run_request(), 2)
        self.provider.assert_not_called()

    def test_output_cannot_replace_source_or_request(self):
        for output in (self.source, self.request):
            with self.subTest(output=output):
                self.data["outputJson"] = str(output)
                self.assertEqual(self.run_request(), 2)
                self.provider.assert_not_called()

    def test_strict_fields(self):
        self.data["promptText"] = "injected"
        self.assertEqual(self.run_request(), 2)
        self.provider.assert_not_called()

    def test_invalid_pcm_and_duration_before_model(self):
        for change in ({"rate": 48000}, {"channels": 2}, {"width": 1}, {"seconds": .5}, {"seconds": 31}):
            with self.subTest(change=change):
                self.write_audio(**change)
                self.assertEqual(self.run_request(), 0)
                self.assertEqual(self.result()["code"], "invalid_audio")
                self.provider.assert_not_called()

    def test_no_speech_does_not_invent_text(self):
        self.model.transcribe.return_value = (iter([SimpleNamespace(text="……")]), object())
        self.assertEqual(self.run_request(), 0)
        self.assertEqual(self.result(), {"version": 1, "success": False, "code": "no_speech"})

    def test_oversized_transcript_rejected(self):
        self.model.transcribe.return_value = (iter([SimpleNamespace(text="字" * 2001)]), object())
        self.assertEqual(self.run_request(), 0)
        self.assertEqual(self.result()["code"], "transcription_failed")

    def test_runtime_failures_do_not_leak_paths(self):
        self.provider.side_effect = Exception("private-model-path")
        self.assertEqual(self.run_request(), 0)
        self.assertEqual(self.result()["code"], "runtime_unavailable")
        self.assertNotIn("private", self.output.read_text(encoding="utf-8"))

    def test_generator_error_does_not_leak_details(self):
        def failed_segments():
            yield SimpleNamespace(text="unfinished")
            raise RuntimeError("private-source-path")
        self.model.transcribe.return_value = (failed_segments(), object())
        self.assertEqual(self.run_request(), 0)
        self.assertEqual(self.result()["code"], "transcription_failed")
        self.assertNotIn("unfinished", self.output.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
