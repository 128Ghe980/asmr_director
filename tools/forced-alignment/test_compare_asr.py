"""Frozen-input provenance tests using tiny synthetic PCM, without models."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest import mock
import unicodedata
import wave


SOURCE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("forced_alignment_compare_asr", SOURCE / "compare_asr.py")
comparison = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = comparison
SPEC.loader.exec_module(comparison)

DEFAULT_ROOT = Path("I:/AI/asmr_director/qa/forced-alignment/2026-10-16/qa") if Path("I:/").is_dir() else Path(__file__).resolve().parents[2] / ".local/tmp/forced-alignment"
TEST_ROOT = Path(os.environ.get("ASMR_ALIGNMENT_TEST_ROOT", DEFAULT_ROOT))


def normalize_literal(value):
    return "".join(character for character in value
                   if not character.isspace() and not unicodedata.category(character).startswith("P"))


class LiteralComparisonTests(unittest.TestCase):
    def test_missing_or_changed_short_final_particle_is_measured_without_rejection(self):
        for transcript in ("回来", "回来了"):
            with self.subTest(transcript=transcript):
                result = comparison.literal_comparison("回来啦。", transcript, normalize_literal)
                self.assertAlmostEqual(result["literal_score"], 2 / 3)
                self.assertEqual(result["edit_distance"], 1)
                self.assertAlmostEqual(result["edit_similarity"], 2 / 3)
                self.assertFalse(result["literal_exact_match"])
                self.assertEqual(result["normalized_recognized"], transcript)
                self.assertEqual(result["text_acceptance"], "not_inferred_from_coverage_or_edit_similarity")

    def test_extra_or_empty_recognition_never_turns_coverage_into_acceptance(self):
        cases = (("不回来啦", 1.0, 1, .75), ("", 0.0, 3, 0.0))
        for transcript, coverage, distance, similarity in cases:
            with self.subTest(transcript=transcript):
                result = comparison.literal_comparison("回来啦。", transcript, normalize_literal)
                self.assertEqual(result["literal_score"], coverage)
                self.assertEqual(result["edit_distance"], distance)
                self.assertEqual(result["edit_similarity"], similarity)
                self.assertFalse(result["literal_exact_match"])
                self.assertEqual(result["normalized_recognized"], transcript)
                self.assertEqual(result["text_acceptance"], "not_inferred_from_coverage_or_edit_similarity")
                self.assertNotIn("accepted", result)


class FrozenComparisonInputTests(unittest.TestCase):
    def setUp(self):
        TEST_ROOT.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="comparison-input-test-", dir=TEST_ROOT)
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def wav(self, name="original.wav", channels=1, width=2, rate=48000, pcm=None):
        path = self.root / name
        if pcm is None:
            pcm = struct.pack("<8h", 0, -32768, 32767, -123, 456, 0, 0, 789)
        with wave.open(str(path), "wb") as output:
            output.setnchannels(channels)
            output.setsampwidth(width)
            output.setframerate(rate)
            output.writeframes(pcm)
        return path, pcm

    def job(self, path):
        return {"id": "synthetic", "source": str(path),
                "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(), "expected": "回来啦。"}

    def test_mismatched_frozen_source_sha_is_rejected_before_audio_is_parsed(self):
        path, _ = self.wav()
        job = self.job(path)
        changed = bytearray(path.read_bytes())
        changed[-1] ^= 1
        path.write_bytes(changed)
        before = path.read_bytes(), path.stat().st_mtime_ns
        with mock.patch.object(comparison.wave, "open", side_effect=AssertionError("do not parse a different source")):
            with self.assertRaisesRegex(ValueError, "hash"):
                comparison.read_window(job)
        self.assertEqual((path.read_bytes(), path.stat().st_mtime_ns), before)

    def test_original_native_pcm_and_atomic_report_preserve_exact_source_bytes(self):
        path, expected_pcm = self.wav()
        before = path.read_bytes(), path.stat().st_mtime_ns
        pcm, facts = comparison.read_window(self.job(path))
        self.assertEqual(pcm, expected_pcm)
        self.assertEqual(facts["frames"], 8)
        self.assertEqual(facts["duration_seconds"], 8 / 48000)
        self.assertEqual(facts["pcm_sha256"], hashlib.sha256(expected_pcm).hexdigest())
        self.assertEqual(facts["source_sha256"], hashlib.sha256(before[0]).hexdigest())
        self.assertEqual(facts["expected"], "回来啦。")
        report = self.root / "new-evidence" / "report.json"
        comparison.atomic_json(report, {"facts": facts, "status": "待核对"})
        saved = report.read_bytes()
        self.assertEqual(json.loads(saved.decode("utf-8")), {"facts": facts, "status": "待核对"})
        self.assertFalse(report.with_suffix(".json.tmp").exists())
        with self.assertRaises(TypeError):
            comparison.atomic_json(report, {"unsupported": object()})
        self.assertEqual(report.read_bytes(), saved)
        comparison.atomic_json(report, {"status": "实验结果，不自动确认"})
        self.assertEqual(json.loads(report.read_text(encoding="utf-8")), {"status": "实验结果，不自动确认"})
        self.assertFalse(report.with_suffix(".json.tmp").exists())
        self.assertEqual((path.read_bytes(), path.stat().st_mtime_ns), before)

    def test_non_native_wav_formats_are_rejected_with_originals_unchanged(self):
        for name, options in (("stereo.wav", {"channels": 2}), ("pcm24.wav", {"width": 3, "pcm": bytes(24)}),
                              ("low-rate.wav", {"rate": 16000})):
            with self.subTest(name=name):
                path, _ = self.wav(name, **options)
                before = path.read_bytes(), path.stat().st_mtime_ns
                with self.assertRaisesRegex(ValueError, "mono PCM16 / 48 kHz"):
                    comparison.read_window(self.job(path))
                self.assertEqual((path.read_bytes(), path.stat().st_mtime_ns), before)


if __name__ == "__main__":
    unittest.main()
