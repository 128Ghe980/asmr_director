"""Deterministic safety tests; no model download or synthesis."""
import importlib.util
from pathlib import Path
import unittest
import sys
from unittest.mock import patch

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("voice_group", Path(__file__).with_name("analyze-voice-group.py"))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
np = helper.np


def tone(seconds):
    frames = round(seconds * helper.RATE)
    return np.sin(np.arange(frames) * 2 * np.pi * 200 / helper.RATE) * 0.1


def segment_words():
    return [
        {"text": "慢慢放松", "start": 0.2, "end": 0.6},
        {"text": "安静休息", "start": 1.1, "end": 1.5},
    ]


class VoiceGroupSafetyTests(unittest.TestCase):
    def test_normalizes_traditional_chinese_and_punctuation(self):
        self.assertEqual(helper.content_score("安静地休息。", "安靜的休息"), 1)

    def test_missing_last_character_is_not_a_complete_group(self):
        with self.assertRaises(helper.UnsafeGroup):
            helper.content_score("让肩膀安稳地靠在柔软的枕头上", "让肩膀安稳地靠在柔软的枕头")

    def test_omitted_interior_words_fail_even_with_matching_ends(self):
        with self.assertRaises(helper.UnsafeGroup):
            helper.content_score("让肩膀安稳地靠在柔软的枕头上", "让肩膀安稳地靠柔软的枕头上")

    def test_unrelated_and_repeated_speech_are_rejected(self):
        for actual in ("慢慢放松安静休息谢谢观看", "慢慢放松慢慢放松安静休息", "今天的天气很好"):
            with self.assertRaises(helper.UnsafeGroup):
                helper.content_score("慢慢放松安静休息", actual)

    def test_ambiguous_word_boundary_has_no_duration_based_fallback(self):
        words = segment_words()
        words[0]["end"] = 0.99
        words[1]["start"] = 1.0
        with self.assertRaises(helper.UnsafeGroup):
            helper.choose_opening_cut(tone(2), words, 0)

    def test_cut_has_quiet_audio_and_at_least_eighty_ms_word_guards(self):
        audio = np.concatenate([np.zeros(9600), tone(0.4), np.zeros(24000), tone(0.4), np.zeros(9600)])
        cut = helper.choose_opening_cut(audio, segment_words(), 0)
        self.assertGreaterEqual(cut, 0.68)
        self.assertLessEqual(cut, 1.02)
        self.assertEqual(float(np.max(np.abs(audio[round((cut - .01) * helper.RATE):round((cut + .01) * helper.RATE)]))), 0)

    def test_internal_pauses_use_measured_asr_word_gaps_not_text_length(self):
        audio = np.concatenate([np.zeros(9600), tone(0.4), np.zeros(24000), tone(0.4), np.zeros(9600)])
        self.assertEqual(helper.internal_pauses(audio, ["慢慢放松", "安静休息"], segment_words()), [500])
        words = segment_words()
        words[1]["start"] = .6
        self.assertEqual(helper.internal_pauses(audio, ["慢慢放松", "安静休息"], words), [0])
        words[1]["start"] = .5
        with self.assertRaises(helper.UnsafeGroup):
            helper.internal_pauses(audio, ["慢慢放松", "安静休息"], words)

    def test_edge_crop_preserves_word_guards_and_active_samples(self):
        audio = np.concatenate([np.zeros(24000), tone(.5), np.zeros(24000)])
        result, start, end = helper.trim_quiet_edges(audio, .5, 1)
        self.assertLessEqual(start / helper.RATE, .42)
        self.assertGreaterEqual(end / helper.RATE, 1.08)
        np.testing.assert_array_equal(result[round(.5 * helper.RATE) - start:round(1 * helper.RATE) - start], audio[24000:48000])
        leading, trailing = helper.measure_quiet(result)
        self.assertGreaterEqual(leading, 80)
        self.assertGreaterEqual(trailing, 80)

    def test_second_asr_catches_a_truncated_extracted_ending(self):
        words = segment_words()
        audio = np.concatenate([np.zeros(9600), tone(.4), np.zeros(24000), tone(.4), np.zeros(9600)])
        with patch.object(helper, "transcribe", side_effect=[("慢慢放松安静休息", words), ("慢慢放", words[:1])]):
            with self.assertRaises(helper.UnsafeGroup):
                helper.analyze(None, audio, "慢慢放松", "安静休息", ["慢慢放松"])

    def test_final_group_rejects_extra_speech_before_any_crop(self):
        with patch.object(helper, "transcribe", return_value=("慢慢放松安静休息谢谢观看", segment_words())):
            with self.assertRaises(helper.UnsafeGroup):
                helper.analyze(None, tone(2), "慢慢放松安静休息", "", ["慢慢放松", "安静休息"])

    def test_zero_duration_boundary_words_cannot_supply_a_cut(self):
        words = segment_words()
        words[0]["start"] = words[0]["end"]
        with self.assertRaises(helper.UnsafeGroup):
            helper.choose_opening_cut(tone(2), words, 0)

    def test_malformed_retained_word_timestamps_are_rejected(self):
        words = segment_words()
        words[1]["start"] = .1
        with self.assertRaises(helper.UnsafeGroup):
            helper.validate_words(words, 2)

    def test_coarse_boundary_can_be_refined_only_with_two_sided_asr_and_quiet_guards(self):
        audio = np.concatenate([np.zeros(9600), tone(.4), np.zeros(24000), tone(.4), np.zeros(9600)])
        coarse = segment_words()
        coarse[1]["start"] = .61
        left = ("慢慢放松", [{"text": "慢慢放松", "start": .2, "end": .6}])
        right = ("安静休息", [{"text": "安静休息", "start": .25, "end": .65}])
        with patch.object(helper, "transcribe", side_effect=[left, right]) as recognize:
            cut, _, _ = helper.verified_opening_cut(None, audio, "慢慢放松", "安静休息", coarse, 0)
            self.assertEqual(recognize.call_count, 2)
        self.assertGreaterEqual(cut - .6, .08)
        self.assertGreaterEqual(1.1 - cut, .08)

    def test_refined_cut_rejects_missing_next_word_start_even_when_left_is_complete(self):
        audio = np.concatenate([np.zeros(9600), tone(.4), np.zeros(24000), tone(.4), np.zeros(9600)])
        coarse = segment_words()
        coarse[1]["start"] = .61
        left = ("慢慢放松", [{"text": "慢慢放松", "start": .2, "end": .6}])
        for text in ("静休息", "松安静休息"):
            right = (text, [{"text": text, "start": .25, "end": .65}])
            with patch.object(helper, "transcribe", side_effect=[left, right]):
                with self.assertRaises(helper.UnsafeGroup):
                    helper.verified_opening_cut(None, audio, "慢慢放松", "安静休息", coarse, 0)

    def test_refinement_does_not_reduce_eighty_ms_protection_on_either_side(self):
        audio = np.concatenate([np.zeros(9600), tone(.4), np.zeros(7200), tone(.4), np.zeros(9600)])
        coarse = segment_words()
        coarse[1]["start"] = .61
        with patch.object(helper, "transcribe") as recognize:
            with self.assertRaises(helper.UnsafeGroup):
                helper.verified_opening_cut(None, audio, "慢慢放松", "安静休息", coarse, 0)
            recognize.assert_not_called()

    def test_refinement_checks_at_most_three_nearby_quiet_candidates(self):
        coarse = segment_words()
        coarse[1]["start"] = .61
        regions = [(.1 + index * .1, .3 + index * .1) for index in range(5)]
        with patch.object(helper, "quiet_regions", return_value=regions), \
             patch.object(helper, "choose_opening_cut", side_effect=helper.UnsafeGroup("no_safe_quiet_cut")), \
             patch.object(helper, "transcribe", return_value=("错误台词", [{"text": "错误台词", "start": 0, "end": .1}])) as recognize:
            with self.assertRaises(helper.UnsafeGroup):
                helper.verified_opening_cut(None, tone(2), "慢慢放松", "安静休息", coarse, 0)
            self.assertEqual(recognize.call_count, 3)

    def test_existing_quiet_with_disagreeing_asr_reports_text_mismatch(self):
        audio = np.concatenate([np.zeros(9600), tone(.4), np.zeros(24000), tone(.4), np.zeros(9600)])
        coarse = segment_words()
        coarse[1]["start"] = .61
        # A changed final character still fails the exact content guard. The
        # failure must not imply that the verified half-second pause is absent.
        wrong = ("慢慢放下", [{"text": "慢慢放下", "start": .2, "end": .6}])
        with patch.object(helper, "transcribe", return_value=wrong):
            with self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
                helper.verified_opening_cut(None, audio, "慢慢放松", "安静休息", coarse, 0)

    def test_no_quiet_interval_is_not_reported_as_text_mismatch(self):
        coarse = segment_words()
        coarse[1]["start"] = .61
        with patch.object(helper, "transcribe") as recognize:
            with self.assertRaisesRegex(helper.UnsafeGroup, "^no_verified_quiet_cut$"):
                helper.verified_opening_cut(None, tone(2), "慢慢放松", "安静休息", coarse, 0)
            recognize.assert_not_called()

    def test_adapts_to_local_low_level_noise_with_absolute_and_relative_caps(self):
        levels = np.full(200, -29.0)
        levels[60:110] = -64
        candidates = helper.quiet_cut_candidates(levels, -68, .1, 1.3, .7)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["method"], "noise_adapted")
        self.assertLessEqual(candidates[0]["thresholdDbfs"], -60)
        self.assertLessEqual(candidates[0]["thresholdDbfs"], levels.max() - 30)
        self.assertGreaterEqual(candidates[0]["cut"] - candidates[0]["quietStartSeconds"], .08)
        self.assertGreaterEqual(candidates[0]["quietEndSeconds"] - candidates[0]["cut"], .08)

    def test_adaptation_does_not_relabel_weak_voice_as_quiet(self):
        levels = np.full(200, -45.0)
        levels[60:110] = -66
        self.assertEqual(helper.quiet_cut_candidates(levels, -68, .1, 1.3, .7), [])

    def test_adaptation_does_not_invent_silence_in_a_fully_active_window(self):
        self.assertEqual(helper.quiet_cut_candidates(np.full(200, -29.0), -68, .1, 1.3, .7), [])

    def test_strict_candidates_remain_first_and_share_the_three_candidate_budget(self):
        levels = np.full(200, -29.0)
        levels[20:40] = -80
        levels[50:70] = -64
        levels[80:100] = -64
        levels[110:130] = -64
        candidates = helper.quiet_cut_candidates(levels, -68, 0, 1.5, 1.2)
        self.assertEqual(candidates[0]["method"], "two_sided")
        self.assertLessEqual(len(candidates), 3)

    def test_adapted_quiet_shorter_than_160_ms_cannot_supply_a_cut(self):
        levels = np.full(200, -29.0)
        levels[60:75] = -64
        self.assertEqual(helper.quiet_cut_candidates(levels, -68, .4, .9, .7), [])

    def test_retained_quiet_metadata_counts_only_the_intersection_touching_the_final_edge(self):
        validation = {"method": "noise_adapted", "thresholdDbfs": -60,
                      "quietStartSeconds": .6, "quietEndSeconds": 1.1}
        self.assertAlmostEqual(helper.retained_verified_tail_ms(0, round(.85 * helper.RATE), validation), 250)
        self.assertAlmostEqual(helper.retained_verified_tail_ms(round(.7 * helper.RATE), round(.85 * helper.RATE), validation), 150)
        self.assertEqual(helper.retained_verified_tail_ms(0, round(1.2 * helper.RATE), validation), 0)
        self.assertEqual(helper.retained_verified_tail_ms(0, round(.5 * helper.RATE), validation), 0)

    def test_assembly_facing_tail_quiet_matches_the_verified_noise_interval(self):
        audio = np.concatenate([np.zeros(9600), tone(.4) * .4, np.full(24000, 10 ** (-64 / 20)), tone(.4) * .4, np.zeros(9600)])
        coarse = segment_words()
        coarse[1]["start"] = .61
        source = ("慢慢放松安静休息", coarse)
        left = ("慢慢放松", [{"text": "慢慢放松", "start": .2, "end": .6}])
        right = ("安静休息", [{"text": "安静休息", "start": .25, "end": .65}])
        with patch.object(helper, "transcribe", side_effect=[source, left, right, left]):
            audio_out, result = helper.analyze(None, audio, "慢慢放松", "安静休息", ["慢慢放松"])
        self.assertEqual(result["cutValidation"]["method"], "noise_adapted")
        self.assertAlmostEqual(result["trailingQuietMs"], 250)
        self.assertEqual(result["internalPausesMs"], [])
        self.assertLess(abs(audio_out[-1]), 1e-12)
        # Join calculation can now subtract this retained quiet instead of adding
        # the entire requested 350 ms on top of an unreported 250 ms tail.
        self.assertAlmostEqual(max(0, 350 - result["trailingQuietMs"]), 100)


if __name__ == "__main__":
    unittest.main()
