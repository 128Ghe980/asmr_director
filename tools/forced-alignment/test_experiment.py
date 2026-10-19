"""Synthetic alignment and native-PCM safety tests; never load a model."""
import hashlib
import importlib.util
import itertools
from pathlib import Path
import struct
import sys
import unittest

import numpy as np
import torch


SOURCE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("forced_alignment_experiment", SOURCE / "experiment.py")
experiment = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = experiment
SPEC.loader.exec_module(experiment)

HELPER_SPEC = importlib.util.spec_from_file_location(
    "existing_quiet_boundary_helper", SOURCE.parents[1] / "apps/web/scripts/analyze-voice-group.py")
helper = importlib.util.module_from_spec(HELPER_SPEC)
sys.modules[HELPER_SPEC.name] = helper
HELPER_SPEC.loader.exec_module(helper)


def emissions(labels, vocabulary_size=4):
    logits = torch.full((len(labels), vocabulary_size), -12.0, dtype=torch.float32)
    for index, token in enumerate(labels):
        logits[index, token] = 12.0
    return logits.log_softmax(-1)


def assert_no_content_verdict(test, characters):
    for character in characters:
        for field in ("correct", "verified", "content_correct", "content_verified", "accepted"):
            test.assertNotIn(field, character)


class TextSafetyTests(unittest.TestCase):
    def test_normalization_preserves_digits_negation_latin_and_nonpunctuation_symbols(self):
        self.assertEqual(experiment.normalize(" 不，没；1/2-3，A+B=￥5。\n"), "不没123A+B=￥5")

    def test_normalization_maps_converted_characters_to_original_indices(self):
        class Converter:
            def convert(self, value):
                return value.replace("來", "来")

        result = experiment.normalize_with_mapping(" 來，啦。 ", converter=Converter())
        self.assertEqual(result["text"], "来啦")
        self.assertEqual([item["char"] for item in result["mapping"]], ["来", "啦"])
        self.assertEqual([item["source_char"] for item in result["mapping"]], ["來", "啦"])
        self.assertEqual([item["source_index"] for item in result["mapping"]], [1, 3])
        self.assertEqual(len(result["removed"]), 4)
        self.assertEqual(experiment.normalize("來，啦。", converter=lambda value: value.replace("來", "来")), "来啦")

    def test_length_changing_conversion_is_not_silently_assigned_old_indices(self):
        with self.assertRaises(experiment.AlignmentError):
            experiment.normalize_with_mapping("甲", converter=lambda value: "甲乙")

    def test_delivery_tildes_are_removed_with_provenance_but_other_symbols_remain(self):
        result = experiment.normalize_with_mapping("来~~，人～。A+B")
        self.assertEqual(result["text"], "来人A+B")
        formats = [item for item in result["removed"] if item.get("reason") == "format"]
        self.assertEqual([item["source_char"] for item in formats], ["~", "~", "～"])
        self.assertEqual([item["source_index"] for item in formats], [1, 2, 5])
        self.assertEqual([item["source_index"] for item in result["mapping"]], [0, 4, 7, 8, 9])
        with self.assertRaises(experiment.AlignmentError):
            experiment.encode_text(result["text"], {"<pad>": 0, "来": 1, "人": 2, "A": 3, "B": 4})

    def test_oov_blank_and_unk_targets_are_rejected_instead_of_wildcards(self):
        vocabulary = {"<pad>": 0, "人": 1, "<unk>": 2, "来": 3, "空": 0, "未": 2}
        self.assertEqual(experiment.encode_text("人来", vocabulary, blank_id=0, unk_id=2), [1, 3])
        for text in ("龘", "人龘来", "空", "未", "*"):
            with self.subTest(text=text), self.assertRaises(experiment.AlignmentError) as caught:
                experiment.encode_text(text, vocabulary, blank_id=0, unk_id=2)
            self.assertTrue(caught.exception.code)
            self.assertIsInstance(caught.exception.details, dict)


class CtcAlignmentTests(unittest.TestCase):
    def test_adjacent_repeated_characters_require_an_intervening_blank(self):
        result = experiment.align_emission(emissions([1, 1, 0, 1, 1]), "人人", [1, 1], 1.0)
        self.assertEqual([item["char"] for item in result], ["人", "人"])
        self.assertEqual([item["token_id"] for item in result], [1, 1])
        self.assertEqual([(item["start_frame"], item["end_frame"]) for item in result], [(0, 2), (3, 5)])
        self.assertAlmostEqual(result[0]["start"], 0.0)
        self.assertAlmostEqual(result[0]["end"], .4)
        self.assertAlmostEqual(result[1]["start"], .6)
        self.assertAlmostEqual(result[1]["end"], 1.0)
        self.assertLess(result[0]["end_frame"], result[1]["start_frame"])
        self.assertTrue(all(.99 < item["score"] <= 1 for item in result))
        assert_no_content_verdict(self, result)

    def test_repeated_characters_cannot_fit_without_a_blank_frame(self):
        with self.assertRaises(experiment.AlignmentError):
            experiment.align_emission(emissions([1, 1]), "人人", [1, 1], .4)

    def test_distinct_characters_keep_target_order_and_support_a_single_batch_axis(self):
        result = experiment.align_emission(emissions([1, 2, 3]).unsqueeze(0), "人来了", [1, 2, 3], .9)
        self.assertEqual([item["char"] for item in result], list("人来了"))
        self.assertEqual([item["token_id"] for item in result], [1, 2, 3])
        for index, item in enumerate(result):
            self.assertGreater(item["end"], item["start"])
            self.assertGreaterEqual(item["start"], 0)
            self.assertLessEqual(item["end"], .9)
            if index:
                self.assertGreaterEqual(item["start"], result[index - 1]["end"])

    def test_invalid_target_shape_or_ids_are_not_sent_to_forced_alignment(self):
        for text, tokens in (("人来", [1]), ("人", [0]), ("人", [-1]), ("人", [4]), ("", [])):
            with self.subTest(text=text, tokens=tokens), self.assertRaises(experiment.AlignmentError):
                experiment.align_emission(emissions([1, 0, 2]), text, tokens, 1.0)

    def test_invalid_duration_or_emission_is_rejected(self):
        for duration in (0, -1, float("nan"), float("inf")):
            with self.subTest(duration=duration), self.assertRaises(experiment.AlignmentError):
                experiment.align_emission(emissions([1]), "人", [1], duration)
        invalid = [torch.empty((0, 4)), torch.zeros((2, 3, 4)), torch.zeros((4,)),
                   torch.full((2, 4), float("nan")), torch.full((2, 4), float("inf"))]
        for value in invalid:
            with self.subTest(shape=tuple(value.shape)), self.assertRaises(experiment.AlignmentError):
                experiment.align_emission(value, "人", [1], 1.0)

    def test_a_missing_character_can_be_forced_at_low_score_but_is_not_content_verified(self):
        result = experiment.align_emission(emissions([1, 1, 0, 0]), "人来", [1, 2], 1.0)
        self.assertEqual([item["char"] for item in result], ["人", "来"])
        self.assertLess(result[-1]["score"], .01)
        assert_no_content_verdict(self, result)

    def test_an_extra_emitted_character_is_not_proved_absent_by_forced_target_timestamps(self):
        emission = emissions([1, 3, 2])
        greedy = [token for token, unused in itertools.groupby(emission.argmax(-1).tolist()) if token != 0]
        self.assertEqual(greedy, [1, 3, 2])  # Actual synthetic sequence contains an extra token.
        result = experiment.align_emission(emission, "人来", [1, 2], 1.0)
        self.assertEqual([item["char"] for item in result], ["人", "来"])
        assert_no_content_verdict(self, result)


class QuietBoundaryTests(unittest.TestCase):
    def audio(self, quiet_start=.6, quiet_end=1.0):
        audio = np.full(2 * 48000, .2, dtype=np.float32)
        audio[round(quiet_start * 48000):round(quiet_end * 48000)] = 0
        return audio

    def characters(self, left_end=.55, right_start=1.05):
        return [{"char": "甲", "token_id": 1, "start": .1, "end": left_end, "score": .99},
                {"char": "乙", "token_id": 2, "start": right_start, "end": 1.5, "score": .99}]

    def boundary(self, audio=None, characters=None, **kwargs):
        result = experiment.boundary_candidates(self.audio() if audio is None else audio,
            self.characters() if characters is None else characters, [1, 1], helper=helper, **kwargs)
        self.assertEqual(len(result), 1)
        return result[0]

    def assert_safe_actual_quiet(self, audio, boundary):
        self.assertTrue(boundary["safe"])
        cut = boundary["cut_seconds"]
        self.assertIsInstance(cut, (int, float))
        self.assertGreater(cut, boundary["lower_seconds"])
        self.assertLess(cut, boundary["upper_seconds"])
        # Prove actual quiet in the native signal, independently of the helper's
        # candidate metadata. Active synthetic samples have amplitude 0.2.
        start, end = round((cut - .08) * 48000), round((cut + .08) * 48000)
        self.assertGreater(end, start)
        self.assertTrue(np.all(audio[start:end] == 0))
        self.assertTrue(any(item["quietStartSeconds"] < cut < item["quietEndSeconds"]
                            and cut - item["quietStartSeconds"] >= .08 - 1e-8
                            and item["quietEndSeconds"] - cut >= .08 - 1e-8
                            for item in boundary["candidates"]))

    def test_cut_is_inside_measured_quiet_with_word_and_quiet_guards(self):
        audio = self.audio()
        boundary = self.boundary(audio=audio)
        self.assert_safe_actual_quiet(audio, boundary)
        self.assertGreaterEqual(boundary["cut_seconds"], .55 + .08)
        self.assertLessEqual(boundary["cut_seconds"], 1.05 - .08)

    def test_no_quiet_does_not_fall_back_to_a_character_ratio_or_midpoint(self):
        boundary = self.boundary(audio=np.full(2 * 48000, .2, dtype=np.float32))
        self.assertFalse(boundary["safe"])
        self.assertIsNone(boundary["cut_seconds"])

    def test_less_than_eighty_milliseconds_quiet_on_each_side_is_not_safe(self):
        boundary = self.boundary(audio=self.audio(.74, .86), characters=self.characters(.66, .94))
        self.assertFalse(boundary["safe"])
        self.assertIsNone(boundary["cut_seconds"])

    def test_a_loud_impulse_at_the_estimated_boundary_is_never_a_safe_cut(self):
        audio = self.audio(.4, 1.2)
        audio[round(.79 * 48000):round(.81 * 48000)] = .2
        boundary = self.boundary(audio=audio, characters=self.characters(.35, 1.25))
        self.assert_safe_actual_quiet(audio, boundary)
        self.assertFalse(.71 <= boundary["cut_seconds"] <= .89)

    def test_baseline_delta_is_reported_against_the_same_boundary(self):
        boundary = self.boundary(baseline_cuts=[.78])
        self.assertEqual(boundary["baseline_cut_seconds"], .78)
        self.assertAlmostEqual(boundary["baseline_delta_seconds"], boundary["cut_seconds"] - .78)

    def test_invalid_character_order_times_and_clause_lengths_are_rejected(self):
        invalid = []
        for key, value in (("start", -.1), ("start", float("nan")), ("end", .1), ("end", 2.1)):
            characters = self.characters()
            characters[0][key] = value
            invalid.append(characters)
        reversed_order = self.characters()
        reversed_order.reverse()
        invalid.append(reversed_order)
        overlap = self.characters()
        overlap[1]["start"] = .4
        invalid.append(overlap)
        for characters in invalid:
            with self.subTest(characters=characters), self.assertRaises(experiment.AlignmentError):
                self.boundary(characters=characters)
        for lengths in ([1], [1, 2], [0, 2], [-1, 3]):
            with self.subTest(lengths=lengths), self.assertRaises(experiment.AlignmentError):
                experiment.boundary_candidates(self.audio(), self.characters(), lengths, helper=helper)


class NativePcmTests(unittest.TestCase):
    def test_native_mono_and_stereo_frames_split_contiguously_and_rejoin_exactly(self):
        for channels in (1, 2):
            samples = [0, 0, 1300, -4200, 0, 0, 2500, 0] * channels
            pcm = struct.pack("<" + "h" * len(samples), *samples)
            with self.subTest(channels=channels):
                pieces = experiment.split_pcm(pcm, [2 / 8000, 5 / 8000], sample_rate=8000,
                                                channels=channels, sample_width=2)
                frame_width = channels * 2
                self.assertEqual(pieces, [pcm[:2 * frame_width], pcm[2 * frame_width:5 * frame_width], pcm[5 * frame_width:]])
                self.assertEqual(hashlib.sha256(b"".join(pieces)).hexdigest(), hashlib.sha256(pcm).hexdigest())

    def test_long_pauses_and_leading_trailing_silence_are_not_removed(self):
        frames = [0] * 4800 + [1234] * 4800 + [0] * 19200 + [-987] * 4800 + [0] * 4800
        pcm = struct.pack("<" + "h" * len(frames), *frames)
        pieces = experiment.split_pcm(pcm, [.35, .5])
        self.assertEqual([len(piece) // 2 for piece in pieces], [16800, 7200, 14400])
        self.assertEqual(sum(map(len, pieces)), len(pcm))
        self.assertEqual(b"".join(pieces), pcm)
        self.assertEqual(pieces[0][:9600], bytes(9600))
        self.assertEqual(pieces[-1][-9600:], bytes(9600))

    def test_invalid_or_same_frame_cuts_never_create_gaps_empty_or_repeated_pieces(self):
        pcm = struct.pack("<8h", *range(8))
        invalid = ([0], [8 / 48000], [-1 / 48000], [9 / 48000],
                   [4 / 48000, 3 / 48000], [3 / 48000, 3 / 48000],
                   [1.1 / 48000, 1.4 / 48000], [float("nan")], [float("inf")])
        for cuts in invalid:
            with self.subTest(cuts=cuts), self.assertRaises(experiment.AlignmentError):
                experiment.split_pcm(pcm, list(cuts))

    def test_incomplete_pcm_frames_and_invalid_format_are_rejected(self):
        for pcm, kwargs in ((b"\x01", {}), (bytes(6), {"channels": 2}),
                            (bytes(8), {"sample_rate": 0}), (bytes(8), {"channels": 0}),
                            (bytes(8), {"sample_width": 0})):
            with self.subTest(kwargs=kwargs), self.assertRaises(experiment.AlignmentError):
                experiment.split_pcm(pcm, [], **kwargs)

    def test_no_cut_returns_the_full_unmodified_native_pcm(self):
        pcm = struct.pack("<5h", 0, -32768, 32767, 0, 123)
        self.assertEqual(experiment.split_pcm(pcm, []), [pcm])


if __name__ == "__main__":
    unittest.main()
