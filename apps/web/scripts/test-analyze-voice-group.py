"""Deterministic safety tests; no model download or synthesis."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
import sys
import tempfile
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


def greeting_words(*, recognized=True, cropped=False):
    offset = .12 if cropped else 0
    return [{"text": "回来了" if recognized else "回来啦", "start": .2 - offset, "end": .5 - offset},
            {"text": "外面是不是很冷", "start": .6 - offset, "end": 1.1 - offset}]


def greeting_audio():
    return np.concatenate([np.zeros(9600), tone(.3), np.zeros(4800), tone(.5),
                           np.zeros(24000), tone(.3), np.zeros(9600)])


class BoundedContentMatchingTests(unittest.TestCase):
    def test_ten_characters_with_one_substitution_accept_exact_ninety_percent(self):
        expected, actual = "回来啦？外面是不是很冷？", "回来了，外面是不是很冷。"
        with self.assertRaises(helper.UnsafeGroup):
            helper.content_score(expected, actual)
        self.assertEqual(helper.content_score(expected, actual, allow_substitutions=True), .9)
        self.assertEqual(helper.content_comparison(expected, actual), {
            "status": "different", "similarity": .9, "threshold": .9, "substitutionCount": 1,
            "expected": "回来啦外面是不是很冷", "recognized": "回来了外面是不是很冷",
        })

    def test_exact_match_records_no_substitution_after_existing_normalization(self):
        self.assertEqual(helper.content_comparison("安静地休息。", "安靜的休息"), {
            "status": "matched", "similarity": 1, "threshold": .9, "substitutionCount": 0,
            "expected": "安静的休息", "recognized": "安静的休息",
        })

    def test_short_independent_target_does_not_borrow_longer_context_budget(self):
        for expected, actual in (("回来啦", "回来了"), ("abcdefghi", "xbcdefghi")):
            with self.subTest(expected=expected):
                with self.assertRaises(helper.UnsafeGroup):
                    helper.content_comparison(expected, actual)

    def test_two_substitutions_need_twenty_characters_and_three_always_fail(self):
        target = "abcdefghijklmnopqrst"
        self.assertEqual(helper.content_score(target, "xbcyefghijklmnopqrst", allow_substitutions=True), .9)
        for expected, actual in ((target[:-1], "xbcyefghijklmnopqrs"),
                                 (target + "uvwxyz0123", "xbcyefghijklmnopqrst" + "uvwxyz9123")):
            with self.subTest(expected=expected):
                with self.assertRaises(helper.UnsafeGroup):
                    helper.content_comparison(expected, actual)

    def test_substitutions_at_either_edge_still_need_the_same_global_budget(self):
        target = "abcdefghijklmnopqrst"
        result = helper.content_comparison(target, "xbcdefghijklmnopqrsz")
        self.assertEqual(result["substitutionCount"], 2)
        self.assertEqual(result["similarity"], .9)

    def test_bounded_matching_does_not_accept_deleted_added_reordered_or_repeated_text(self):
        target = "abcdefghijklmnopqrst"
        for actual in (target[:-1], target + "u", target[:10] + target[11:],
                       "bacdefghijklmnopqrst", "abcdefghijklmnopqrs" + "abc", "abcdefghijklmn" + "abcdef"):
            with self.subTest(actual=actual):
                with self.assertRaises(helper.UnsafeGroup):
                    helper.content_comparison(target, actual)

    def test_new_repetition_is_rejected_even_with_only_one_substitution(self):
        with self.assertRaises(helper.UnsafeGroup):
            helper.content_comparison("abcdefabcdxfuvwxyz0123456789", "abcdefabcdefuvwxyz0123456789")

    def test_full_target_mapping_locates_a_changed_short_clause_without_relaxing_it(self):
        clauses = ["回来啦？", "外面是不是很冷？"]
        words = greeting_words(cropped=True)
        with self.assertRaises(helper.UnsafeGroup):
            helper.align_prefix(clauses[0], words)
        boundaries = helper.resolve_clause_boundaries("".join(clauses), clauses, words)
        self.assertEqual(boundaries, [0, 1])
        self.assertEqual(helper.internal_pauses(tone(2), clauses, words, boundaries=boundaries), [100])
        words[1]["start"] = words[0]["end"]
        self.assertEqual(helper.internal_pauses(tone(2), clauses, words, boundaries=boundaries), [0])

    def test_mapping_rejects_clause_boundary_inside_one_asr_word(self):
        words = [{"text": "回来了外面", "start": .1, "end": .8},
                 {"text": "是不是很冷", "start": .9, "end": 1.3}]
        with self.assertRaisesRegex(helper.UnsafeGroup, "^missing_internal_boundary$"):
            helper.resolve_clause_boundaries("回来啦？外面是不是很冷？", ["回来啦？", "外面是不是很冷？"], words)

    def test_mapping_requires_full_content_and_exact_clause_coverage(self):
        for expected, clauses, words in (
                ("回来啦？外面是不是很冷？", ["回来啦？", "外面是不是很热？"], greeting_words()),
                ("回来啦？外面是不是很冷？", ["回来啦？", "外面是不是很冷？"],
                 [{"text": "回来了", "start": .1, "end": .5}, {"text": "外面是不是冷", "start": .6, "end": 1.1}])):
            with self.subTest(clauses=clauses):
                with self.assertRaises(helper.UnsafeGroup):
                    helper.resolve_clause_boundaries(expected, clauses, words)


class EndingAnchorContentTests(unittest.TestCase):
    expected = "来~~，面来啦！慢点儿吃，小心烫。汤也喝一点，暖胃。"
    actual = "来,面来了,慢点吃,小心烫,汤也喝一点,暖胃。"
    clauses = ["来~~，", "面来啦！", "慢点儿吃，", "小心烫。", "汤也喝一点，", "暖胃。"]

    def test_unusual_punctuation_is_ignored_without_discarding_annotation_letters(self):
        self.assertEqual(helper.normalize("「来~~」～…——，面来啦！（慢点儿吃）☆"), "来面来啦慢点儿吃")
        self.assertEqual(helper.normalize("[轻声]来~~"), "轻声来")

    def test_edit_fallback_accepts_example_but_preserves_default_comparison(self):
        with self.assertRaises(helper.UnsafeGroup):
            helper.content_comparison(self.expected, self.actual)
        comparison = helper.content_comparison(self.expected, self.actual, allow_edits=True)
        self.assertEqual(comparison, {
            "mode": "bounded_edits", "status": "different", "similarity": .888889,
            "threshold": .85, "substitutionCount": 1, "insertionCount": 0,
            "deletionCount": 1, "editCount": 2,
            "expected": "来面来啦慢点儿吃小心烫汤也喝一点暖胃",
            "recognized": "来面来了慢点吃小心烫汤也喝一点暖胃",
        })

    def test_existing_exact_and_substitution_results_keep_their_original_shape(self):
        for expected, actual in (("安静地休息。", "安靜的休息"),
                                 ("回来啦？外面是不是很冷？", "回来了外面是不是很冷")):
            with self.subTest(expected=expected):
                self.assertEqual(helper.content_comparison(expected, actual, allow_edits=True),
                                 helper.content_comparison(expected, actual))

    def test_edit_fallback_has_minimum_length_and_two_edit_limit(self):
        for expected, actual in (("abcdefghi", "abcefghi"),
                                 ("abcdefghijklmnopqrstuvwxyz", "abcghijklmnopqrstuvwxyz")):
            with self.subTest(expected=expected):
                with self.assertRaises(helper.UnsafeGroup):
                    helper.content_comparison(expected, actual, allow_edits=True)
        accepted = helper.content_comparison("abcdefghij", "abcefghij", allow_edits=True)
        self.assertEqual(accepted["deletionCount"], 1)
        self.assertEqual(accepted["editCount"], 1)

    def test_threshold_uses_edit_distance_and_longer_text_length(self):
        with self.assertRaises(helper.UnsafeGroup):
            helper.content_comparison("abcdefghijklm", "abcfghijklm", allow_edits=True)
        deleted = helper.content_comparison("abcdefghijklmn", "abcfghijklmn", allow_edits=True)
        self.assertEqual(deleted["similarity"], .857143)
        self.assertEqual(deleted["deletionCount"], 2)
        inserted = helper.content_comparison("abcdefghijkl", "abcXYdefghijkl", allow_edits=True)
        self.assertEqual(inserted["similarity"], .857143)
        self.assertEqual(inserted["insertionCount"], 2)

    def test_fallback_rejects_reordered_and_newly_repeated_content(self):
        for expected, actual in (("abcdefghijklmn", "abcedfghijklmn"),
                                 ("abcdefghijklmn", "abedcfghijklmn"),
                                 ("abcdefghijklmn", "abjdefghicklmn"),
                                 ("abcdefghijklmn", "abdefgchijklmn"),
                                 ("abcdefabcdxfuvwxyz0123456789", "abcdefabcdefuvwxyz0123456789")):
            with self.subTest(expected=expected):
                with self.assertRaises(helper.UnsafeGroup):
                    helper.content_comparison(expected, actual, allow_edits=True)

    def words(self):
        return [{"text": text, "start": start, "end": end} for text, start, end in (
            ("来,", .2, .4), ("面来了,", .55, .95), ("慢点吃,", 1.1, 1.4),
            ("小心烫,", 1.55, 1.9), ("汤也喝一点,", 2.05, 2.6), ("暖胃。", 2.75, 3.05))]

    def test_deletion_alignment_maps_later_clauses_to_actual_word_ends(self):
        words = self.words()
        with self.assertRaises(helper.UnsafeGroup):
            helper.resolve_clause_boundaries(self.expected, self.clauses, words)
        boundaries = helper.resolve_clause_boundaries(self.expected, self.clauses, words, allow_edits=True)
        self.assertEqual(boundaries, [0, 1, 2, 3, 4, 5])
        self.assertEqual(helper.internal_pauses(tone(3.2), self.clauses, words, boundaries=boundaries),
                         [150, 150, 150, 150, 150])

    def test_edit_alignment_does_not_create_a_boundary_inside_one_asr_word(self):
        words = self.words()
        words[2:4] = [{"text": "慢点吃小心烫", "start": 1.1, "end": 1.9}]
        with self.assertRaises(helper.UnsafeGroup):
            helper.resolve_clause_boundaries(self.expected, self.clauses, words, allow_edits=True)

    def test_deleted_clause_ending_cannot_supply_an_internal_boundary(self):
        expected = "abcdefghijklmno"
        words = [{"text": "abcd", "start": .1, "end": .5},
                 {"text": "fghijklmno", "start": .7, "end": 1.2}]
        with self.assertRaises(helper.UnsafeGroup):
            helper.resolve_clause_boundaries(expected, ["abcde", "fghijklmno"], words, allow_edits=True)

    def test_ambiguous_deletion_near_clause_boundary_is_rejected(self):
        expected = "abcdefghhiJKLMNO"
        words = [{"text": "abcdefgh", "start": .1, "end": .5},
                 {"text": "iJKLMNO", "start": .7, "end": 1.2}]
        with self.assertRaises(helper.UnsafeGroup):
            helper.resolve_clause_boundaries(expected, ["abcdefgh", "hiJKLMNO"], words, allow_edits=True)

    def test_target_endpoint_uses_tail_anchor_and_the_immediate_following_text(self):
        words = self.words() + [{"text": "今天外面风大", "start": 3.6, "end": 4.0}]
        terminal, boundary_match = helper.align_target(self.expected, words, "今天外面风大，")
        self.assertEqual(terminal, 5)
        self.assertIsNotNone(boundary_match)
        with self.assertRaises(helper.UnsafeGroup):
            helper.align_target(self.expected, words, "完全不同的后文")

    def test_fallback_requires_the_initial_two_characters_and_more_than_shared_tail(self):
        words = self.words() + [{"text": "今天外面风大", "start": 3.6, "end": 4.0}]
        for expected in ("去面来啦慢点吃小心烫汤也喝一点暖胃", "你今天中午准备吃什么东西暖胃"):
            with self.subTest(expected=expected):
                with self.assertRaises(helper.UnsafeGroup):
                    helper.align_target(expected, words, "今天外面风大")

    def test_repeated_tail_in_plausible_prefix_does_not_choose_an_arbitrary_occurrence(self):
        expected, actual = "abcdefgh暖胃ij暖胃", "abcdfgh暖胃ij暖胃"
        words = [{"text": actual, "start": .2, "end": 2.0},
                 {"text": "后面的内容", "start": 2.5, "end": 3.0}]
        # The full four-character suffix is unique here, so an earlier short
        # occurrence must not defeat a longer unambiguous ending anchor.
        terminal, boundary_match = helper.align_target(expected, words, "后面的内容")
        self.assertEqual(terminal, 0)
        self.assertIsNotNone(boundary_match)

    def test_repeated_ending_still_needs_the_whole_target_and_immediate_continuation(self):
        expected, actual = "abcdefgh今天暖胃今天暖胃", "abcdfgh今天暖胃今天暖胃"
        words = [{"text": actual, "start": .2, "end": 2.0},
                 {"text": "后面的内容", "start": 2.5, "end": 3.0}]
        terminal, _ = helper.align_target(expected, words, "后面的内容")
        self.assertEqual(terminal, 0)
        words.insert(1, {"text": "今天暖胃", "start": 2.1, "end": 2.4})
        with self.assertRaises(helper.UnsafeGroup):
            helper.align_target(expected, words, "后面的内容")

    def test_one_shared_final_character_does_not_establish_a_local_anchor(self):
        words = [{"text": "abxdefghijklyn", "start": .2, "end": 2.0},
                 {"text": "后面的内容", "start": 2.5, "end": 3.0}]
        with self.assertRaises(helper.UnsafeGroup):
            helper.align_target("abcdefghijklmn", words, "后面的内容")
        candidates = helper.bounded_endpoint_candidates("abcdefghijklmn", words)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["terminalWordIndex"], 0)

    def test_two_bounded_endpoints_with_the_same_immediate_context_are_ambiguous(self):
        words = [{"text": "abcdfghijklmnopqraa", "start": .1, "end": 1.0},
                 {"text": "a", "start": 1.2, "end": 1.3},
                 {"text": "aaaa", "start": 1.5, "end": 1.9}]
        with self.assertRaisesRegex(helper.UnsafeGroup, "^ambiguous_ending_anchor$"):
            helper.align_target("abcdefghijklmnopqraa", words, "aaaa")

    def test_api_hint_can_select_only_an_existing_bounded_endpoint(self):
        expected, actual = "abcdefghijklmn", "abxdefghijklyn"
        words = [{"text": actual, "start": .2, "end": 2.0},
                 {"text": "后面的内容", "start": 2.5, "end": 3.0}]
        hint = {"terminalWordIndex": 0, "recognizedPrefix": actual}
        terminal, boundary_match = helper.align_target(expected, words, "后面的内容", alignment_hint=hint)
        self.assertEqual(terminal, 0)
        self.assertEqual(boundary_match["method"], "api")
        self.assertEqual(boundary_match["recognizedPrefix"], actual)
        for bad_hint in ({"terminalWordIndex": 9, "recognizedPrefix": actual},
                         {"terminalWordIndex": 0, "recognizedPrefix": expected},
                         {"terminalWordIndex": 0, "recognizedPrefix": actual + "后面"}):
            with self.subTest(hint=bad_hint):
                with self.assertRaises(helper.UnsafeGroup):
                    helper.align_target(expected, words, "后面的内容", alignment_hint=bad_hint)

    def test_api_hint_cannot_bypass_content_budget_or_following_speech(self):
        expected = "abcdefghijklmn"
        for actual, following in (("ab完全无关的内容", "后面的内容"),
                                  ("abxdefghijklyn", "另一个不同的后文")):
            words = [{"text": actual, "start": .2, "end": 2.0},
                     {"text": "后面的内容", "start": 2.5, "end": 3.0}]
            with self.subTest(actual=actual):
                with self.assertRaises(helper.UnsafeGroup):
                    helper.align_target(expected, words, following,
                                        alignment_hint={"terminalWordIndex": 0, "recognizedPrefix": actual})

    def test_complete_fallback_requires_two_sided_and_final_recognition(self):
        words = self.words()
        following = {"text": "今天外面风大", "start": 3.6, "end": 4.0}
        audio = np.zeros(round(4.2 * helper.RATE))
        for word in words + [following]:
            start, end = round(word["start"] * helper.RATE), round(word["end"] * helper.RATE)
            audio[start:end] = tone((end - start) / helper.RATE)
        source = (self.actual + following["text"], words + [following])
        left = (self.actual, words)
        right = (following["text"], [{"text": following["text"], "start": .275, "end": .675}])
        final = (self.actual, [{**word, "start": word["start"] - .12, "end": word["end"] - .12}
                               for word in words])
        with patch.object(helper, "transcribe", side_effect=[source, left, right, final]) as recognize:
            processed, result = helper.analyze(None, audio, self.expected, following["text"], self.clauses)
        self.assertEqual(recognize.call_count, 4)
        self.assertLess(processed.size, audio.size)
        self.assertEqual(result["recognition"]["contentComparison"]["mode"], "bounded_edits")
        self.assertEqual(result["recognition"]["contentComparison"]["editCount"], 2)
        self.assertIn("cutValidation", result)
        self.assertEqual(result["internalPausesMs"], [150, 150, 150, 150, 150])

    def test_endpoint_matching_does_not_replace_actual_quiet_proof(self):
        words = self.words() + [{"text": "今天外面风大", "start": 3.6, "end": 4.0}]
        with patch.object(helper, "transcribe", return_value=(self.actual + "今天外面风大", words)) as recognize:
            with self.assertRaisesRegex(helper.UnsafeGroup, "^no_verified_quiet_cut$"):
                helper.analyze(None, tone(4.2), self.expected, "今天外面风大", self.clauses)
        self.assertEqual(recognize.call_count, 1)


class ApproximateCutVerificationTests(unittest.TestCase):
    expected = "回来啦？外面是不是很冷？"
    clauses = ["回来啦？", "外面是不是很冷？"]

    def source(self, recognized=True):
        words = greeting_words(recognized=recognized)
        words.append({"text": "快进来", "start": 1.6, "end": 1.9})
        return "".join(word["text"] for word in words), words

    def left(self):
        words = greeting_words()
        return "".join(word["text"] for word in words), words

    def right(self, text="快进来"):
        return text, [{"text": text, "start": .25, "end": .55}]

    def final(self):
        words = greeting_words(cropped=True)
        return "".join(word["text"] for word in words), words

    def test_source_difference_requires_both_sides_and_final_independent_recognition(self):
        with patch.object(helper, "transcribe", side_effect=[self.source(), self.left(), self.right(), self.final()]) as recognize:
            audio, result = helper.analyze(None, greeting_audio(), self.expected, "快进来", self.clauses)
        self.assertEqual(recognize.call_count, 4)
        self.assertLess(audio.size, greeting_audio().size)
        self.assertEqual(result["recognition"]["contentComparison"]["status"], "different")
        self.assertEqual(result["recognition"]["contentComparison"]["similarity"], .9)
        self.assertEqual(result["internalPausesMs"], [100])
        self.assertGreaterEqual(result["cutValidation"]["quietEndSeconds"]
                                - result["cutValidation"]["quietStartSeconds"], .16)

    def test_difference_first_seen_after_fast_crop_triggers_one_two_sided_recheck(self):
        with patch.object(helper, "transcribe", side_effect=[self.source(False), self.final(), self.left(),
                                                            self.right(), self.final()]) as recognize:
            _, result = helper.analyze(None, greeting_audio(), self.expected, "快进来", self.clauses)
        self.assertEqual(recognize.call_count, 5)
        self.assertIn("cutValidation", result)
        self.assertEqual(result["recognition"]["contentComparison"]["substitutionCount"], 1)

    def test_two_sided_requirement_cannot_be_satisfied_by_word_timestamps_without_quiet(self):
        with patch.object(helper, "transcribe", side_effect=[self.source()]) as recognize:
            with self.assertRaisesRegex(helper.UnsafeGroup, "^no_verified_quiet_cut$"):
                helper.analyze(None, tone(2.1), self.expected, "快进来", self.clauses)
        self.assertEqual(recognize.call_count, 1)

    def test_approximate_target_does_not_relax_the_following_first_syllable(self):
        replies = [self.source()] + [self.left(), self.right("慢进来")] * 3
        with patch.object(helper, "transcribe", side_effect=replies) as recognize:
            with self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
                helper.analyze(None, greeting_audio(), self.expected, "快进来", self.clauses)
        self.assertLessEqual(recognize.call_count, 7)

    def test_final_segment_and_word_transcripts_must_agree_even_if_both_are_ninety_percent(self):
        words = greeting_words(recognized=False, cropped=True)
        words[1]["text"] = "外面是不是很热"
        mismatched = ("回来了外面是不是很冷", words)
        with patch.object(helper, "transcribe", side_effect=[self.source(), self.left(), self.right(), mismatched]):
            with self.assertRaisesRegex(helper.UnsafeGroup, "^inconsistent_recognition$"):
                helper.analyze(None, greeting_audio(), self.expected, "快进来", self.clauses)

    def test_short_independent_unit_still_fails_before_boundary_search(self):
        with patch.object(helper, "transcribe", return_value=self.source()) as recognize:
            with self.assertRaisesRegex(helper.UnsafeGroup, "^uncertain_word_alignment$") as caught:
                helper.analyze(None, greeting_audio(), "回来啦？", "外面是不是很冷？", ["回来啦？"])
        self.assertEqual(recognize.call_count, 1)
        self.assertEqual(caught.exception.recognition["stage"], "source_alignment")
        self.assertEqual(caught.exception.recognition["alignment"]["expected"], "回来啦")


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


class InternalPauseObservationTests(unittest.TestCase):
    def test_validated_word_gaps_are_recorded_without_the_join_sample_limit(self):
        for milliseconds in (0, 1200, 1201, 1480, 10_000):
            words = [{"text": "慢慢放松", "start": .1, "end": .25},
                     {"text": "安静休息", "start": .25 + milliseconds / 1000,
                      "end": .65 + milliseconds / 1000}]
            with self.subTest(milliseconds=milliseconds):
                self.assertEqual(helper.internal_pauses(tone(11), ["慢慢放松", "安静休息"], words), [milliseconds])

    def test_zero_gap_floating_point_noise_keeps_the_original_tolerance(self):
        for milliseconds in (-1e-9, 0, 1e-9):
            words = [{"text": "慢慢放松", "start": .1, "end": .25},
                     {"text": "安静休息", "start": .25 + milliseconds / 1000,
                      "end": .65 + milliseconds / 1000}]
            with self.subTest(milliseconds=milliseconds):
                self.assertEqual(helper.internal_pauses(tone(1), ["慢慢放松", "安静休息"], words), [0])

    def test_invalid_negative_nonfinite_and_above_service_cap_gaps_still_fail(self):
        for milliseconds in (-1, -1e-4, float("nan"), float("inf"), -float("inf"), 10_000.1):
            words = [{"text": "慢慢放松", "start": .1, "end": .25},
                     {"text": "安静休息", "start": .25 + milliseconds / 1000,
                      "end": .65 + milliseconds / 1000}]
            with self.subTest(milliseconds=milliseconds):
                with self.assertRaisesRegex(helper.UnsafeGroup, "^uncertain_internal_pause$"):
                    helper.internal_pauses(tone(11), ["慢慢放松", "安静休息"], words)

    def test_exact_target_with_real_mode_long_sentence_gap_survives_the_full_analysis(self):
        clauses = ["今天是不是又加班了？", "眼睛都红红的。"]
        target_words = [{"text": clauses[0], "start": .6, "end": 2.38},
                        {"text": clauses[1], "start": 3.86, "end": 5.38}]
        source_words = target_words + [{"text": "来~~，", "start": 6.02, "end": 6.46}]
        audio = np.concatenate([np.zeros(round(.6 * helper.RATE)), tone(1.78),
                                np.zeros(round(1.48 * helper.RATE)), tone(1.52),
                                np.zeros(round(.64 * helper.RATE)), tone(.44),
                                np.zeros(round(.24 * helper.RATE))])
        final_words = [{**word, "start": word["start"] - .52, "end": word["end"] - .52}
                       for word in target_words]
        replies = [("".join(word["text"] for word in source_words), source_words),
                   ("".join(clauses), final_words)]
        with patch.object(helper, "transcribe", side_effect=replies) as recognize:
            processed, result = helper.analyze(None, audio, "".join(clauses), "来~~，", clauses)
        self.assertEqual(recognize.call_count, 2)
        self.assertLess(processed.size, audio.size)
        self.assertEqual(result["internalPausesMs"], [1480])
        self.assertEqual(result["recognition"]["stage"], "complete")
        self.assertEqual(result["recognition"]["contentComparison"]["status"], "matched")


class LeadingHmmContinuationTests(unittest.TestCase):
    expected = "今天是不是又加班了？眼睛都红红的。"
    following = "面快好了，"
    clauses = ["今天是不是又加班了？", "眼睛都红红的。"]

    def target_words(self):
        texts = ["今天", "是不是", "又", "加", "班", "了", "眼", "睛", "都", "红", "红", "的"]
        ends = [.88, 1.3, 1.7, 1.88, 2.12, 2.3, 3.1, 3.4, 3.54, 3.74, 3.94, 4.14]
        return [{"text": text, "start": 0 if index == 0 else ends[index - 1], "end": ends[index]}
                for index, text in enumerate(texts)]

    def source(self, bridge="嗯", hmm_start=4.7):
        words = self.target_words() + [{"text": bridge, "start": hmm_start, "end": hmm_start + .5},
                                       {"text": "面", "start": 6.0, "end": 6.5},
                                       {"text": "快", "start": 6.5, "end": 6.7},
                                       {"text": "好了", "start": 6.7, "end": 7.04}]
        return "".join(word["text"] for word in words), words

    def audio(self, hmm_start=4.7):
        return np.concatenate([tone(4.14), np.zeros(round((hmm_start - 4.14) * helper.RATE)),
                               tone(.5), np.zeros(round((6 - hmm_start - .5) * helper.RATE)),
                               tone(1.04), np.zeros(round(.26 * helper.RATE))])

    def target(self, text=None):
        words = self.target_words()
        if text is not None:
            words[0]["text"] = text
        return "".join(word["text"] for word in words), words

    def right(self):
        _, words = self.source()
        words = [{**word, "start": word["start"] - 4.42, "end": word["end"] - 4.42}
                 for word in words[12:]]
        return "".join(word["text"] for word in words), words

    def test_single_whole_hmm_requires_two_sided_proof_and_is_discarded(self):
        source = self.source()
        checkpoints = []
        with patch.object(helper, "transcribe", side_effect=[source, self.target(), self.right(), self.target()]) as recognize:
            processed, result = helper.analyze(None, self.audio(), self.expected, self.following, self.clauses,
                                               checkpoint=lambda value: checkpoints.append(value.copy()))
        self.assertEqual(recognize.call_count, 4)
        self.assertLess(processed.size, self.audio().size)
        self.assertLessEqual(result["cutEndSeconds"], 4.7 - helper.WORD_GUARD)
        validation = result["cutValidation"]
        self.assertGreaterEqual(validation["quietEndSeconds"] - validation["quietStartSeconds"] + 1e-9, .16)
        self.assertGreaterEqual(4.42 - validation["quietStartSeconds"] + 1e-9, .08)
        self.assertGreaterEqual(validation["quietEndSeconds"] - 4.42 + 1e-9, .08)
        recognition = result["recognition"]
        self.assertEqual(recognition["contentComparison"]["status"], "matched")
        self.assertNotIn("boundaryMatch", recognition)
        self.assertEqual(recognition["sourceWords"], source[1])
        self.assertEqual(recognition["continuationBridge"], {
            "kind": "leading_hmm", "text": "嗯", "sourceWordIndex": 12,
            "sourceStartSeconds": 4.7, "sourceEndSeconds": 5.2, "rightTranscript": "嗯面快好了",
        })
        self.assertTrue(all("continuationBridge" not in value for value in checkpoints if value["stage"] != "complete"))

    def test_bridge_uses_complete_right_context_before_accepting_the_strict_anchor(self):
        audio = np.concatenate([self.audio(), tone(.5)])
        full_right_frames = audio.size - round(4.42 * helper.RATE)
        right_windows = []
        calls = 0

        def recognize(_model, window):
            nonlocal calls
            call = calls
            calls += 1
            if call == 0:
                return self.source()
            if call == 2:
                right_windows.append(window.size)
                if window.size < full_right_frames:
                    return "嗯面块好", [{"text": "嗯", "start": .3, "end": .8},
                                     {"text": "面", "start": 1.6, "end": 2.1},
                                     {"text": "块", "start": 2.1, "end": 2.3},
                                     {"text": "好", "start": 2.3, "end": 2.44}]
                text, words = self.right()
                return text + "我", words + [{"text": "我", "start": 2.62, "end": 3.1}]
            return self.target()

        with patch.object(helper, "transcribe", side_effect=recognize):
            _, result = helper.analyze(None, audio, self.expected, self.following, self.clauses)
        self.assertEqual(calls, 4)
        self.assertEqual(right_windows, [full_right_frames])
        self.assertEqual(result["recognition"]["contentComparison"]["status"], "matched")
        self.assertEqual(result["recognition"]["continuationBridge"]["rightTranscript"], "嗯面快好了我")
        self.assertLess(result["cutEndSeconds"], 4.7 - helper.WORD_GUARD)

    def test_full_right_context_may_omit_hmm_only_when_following_is_exact_at_the_start(self):
        right = ("面快好了", [{"text": "面", "start": 1.5, "end": 2.02},
                          {"text": "快", "start": 2.02, "end": 2.26},
                          {"text": "好了", "start": 2.26, "end": 2.64}])
        with patch.object(helper, "transcribe", side_effect=[self.source(), self.target(), right, self.target()]):
            _, result = helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)
        recognition = result["recognition"]
        self.assertEqual(recognition["contentComparison"]["status"], "matched")
        self.assertEqual(recognition["continuationBridge"]["rightTranscript"], right[0])
        self.assertEqual(recognition["continuationBridge"]["sourceWordIndex"], 12)
        self.assertEqual(recognition["continuationBridge"]["sourceStartSeconds"], 4.7)
        self.assertLess(result["cutEndSeconds"], 4.7 - helper.WORD_GUARD)

    def test_right_segment_and_whole_word_prefix_must_agree_about_the_optional_hmm(self):
        text, words = self.right()
        for right in ((text, words[1:]), ("面快好了", words)):
            with self.subTest(text=right[0]), patch.object(helper, "transcribe", side_effect=[self.source(), self.target(), right]):
                with self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
                    helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)

    def test_short_or_missing_quiet_cannot_use_the_bridge(self):
        for audio, source in ((tone(7.3), self.source()), (self.audio(4.28), self.source(hmm_start=4.28))):
            with self.subTest(duration=audio.size):
                with patch.object(helper, "transcribe", return_value=source) as recognize:
                    with self.assertRaisesRegex(helper.UnsafeGroup, "^no_verified_quiet_cut$"):
                        helper.analyze(None, audio, self.expected, self.following, self.clauses)
                self.assertEqual(recognize.call_count, 1)

    def test_other_fillers_and_multiple_hmm_are_not_a_general_skip_rule(self):
        for bridge in ("啊", "唔", "恩", "嗯嗯", "嗯啊"):
            with self.subTest(bridge=bridge), patch.object(helper, "transcribe", return_value=self.source(bridge)) as recognize:
                with self.assertRaises(helper.UnsafeGroup):
                    helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)
                self.assertEqual(recognize.call_count, 1)

    def test_source_hmm_merged_with_next_word_has_no_character_time_split(self):
        text, words = self.source()
        words[12] = {"text": "嗯面", "start": 4.7, "end": 6.5}
        del words[13]
        with patch.object(helper, "transcribe", return_value=(text, words)) as recognize:
            with self.assertRaisesRegex(helper.UnsafeGroup, "^unrecognized_continuation$"):
                helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)
        self.assertEqual(recognize.call_count, 1)

    def test_source_target_difference_cannot_borrow_the_bridge(self):
        _, words = self.source()
        words[0]["text"] = "今夜"
        with patch.object(helper, "transcribe", return_value=("".join(word["text"] for word in words), words)):
            with self.assertRaises(helper.UnsafeGroup):
                helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)

    def test_left_target_must_remain_exact_even_within_old_substitution_budget(self):
        with patch.object(helper, "transcribe", side_effect=[self.source(), self.target("今夜")]):
            with self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$") as caught:
                helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)
        self.assertNotIn("continuationBridge", caught.exception.recognition)

    def test_right_hmm_must_also_be_one_independent_word(self):
        text, words = self.right()
        words[0] = {"text": "嗯面", "start": .28, "end": 2.08}
        del words[1]
        with patch.object(helper, "transcribe", side_effect=[self.source(), self.target(), (text, words)]):
            with self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
                helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)

    def test_right_mismatch_repeat_reordering_leak_and_missing_first_character_fail(self):
        for text in ("嗯快好了", "嗯快面好了", "嗯的面快好了", "嗯嗯面快好了", "嗯面快坏了",
                     "快好了", "快面好了", "的面快好了", "啊面快好了", "面块好了"):
            _, words = self.right()
            words = [words[0], {"text": text[1:], "start": 1.58, "end": 2.62}] if text.startswith("嗯") else words[1:]
            with self.subTest(text=text), patch.object(helper, "transcribe", side_effect=[self.source(), self.target(), (text, words)]):
                with self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$") as caught:
                    helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)
                self.assertNotIn("continuationBridge", caught.exception.recognition)

    def test_left_bridge_leak_and_missing_target_end_are_rejected(self):
        for text in (helper.normalize(self.expected) + "嗯", helper.normalize(self.expected)[:-1]):
            with self.subTest(text=text), patch.object(helper, "transcribe", side_effect=[self.source(), (text, self.target_words())]):
                with self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
                    helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)

    def test_final_target_difference_does_not_publish_the_trial_bridge(self):
        with patch.object(helper, "transcribe", side_effect=[self.source(), self.target(), self.right(), self.target("今夜")]):
            with self.assertRaises(helper.UnsafeGroup) as caught:
                helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)
        self.assertEqual(caught.exception.recognition["stage"], "target_validation")
        self.assertNotIn("continuationBridge", caught.exception.recognition)

    def test_zero_duration_hmm_cannot_establish_its_discarded_side(self):
        text, words = self.source()
        words[12]["end"] = words[12]["start"]
        with patch.object(helper, "transcribe", return_value=(text, words)):
            with self.assertRaises(helper.UnsafeGroup):
                helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)


class PersistentWorkerTests(unittest.TestCase):
    def test_three_requests_load_one_model_and_preserve_request_identity(self):
        incoming = io.StringIO("".join(json.dumps({"requestPath": name}) + "\n"
                                    for name in ("first.json", "second.json", "third.json")))
        outgoing = io.StringIO()
        model = object()
        seen = []

        def process_request(request_path, model_provider):
            seen.append((request_path, model_provider("model")))
            return 0

        with patch.object(helper, "load_model", return_value=model) as load, \
                patch.object(helper, "process_request", side_effect=process_request):
            self.assertEqual(helper.worker("model", incoming, outgoing), 0)
        load.assert_called_once()
        self.assertEqual(seen, [(name, model) for name in ("first.json", "second.json", "third.json")])
        self.assertEqual([json.loads(line) for line in outgoing.getvalue().splitlines()],
                         [{"requestPath": name, "code": 0} for name in ("first.json", "second.json", "third.json")])

    def test_model_mismatch_does_not_load_a_second_model(self):
        incoming = io.StringIO(json.dumps({"requestPath": "first.json"}) + "\n")
        outgoing = io.StringIO()

        def process_request(_request_path, model_provider):
            model_provider("different-model")

        with patch.object(helper, "load_model") as load, \
                patch.object(helper, "process_request", side_effect=process_request):
            self.assertEqual(helper.worker("model", incoming, outgoing), 0)
        load.assert_not_called()
        self.assertEqual(json.loads(outgoing.getvalue()), {"requestPath": "first.json", "code": 2})


class RecognitionDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        root = Path(self.scratch.name)
        self.request = root / "request.json"
        self.output = root / "result.json"
        self.source = root / "source.wav"
        self.audio = np.concatenate([np.zeros(9600), tone(.4), np.zeros(24000), tone(.4), np.zeros(9600)])
        helper.sf.write(self.source, self.audio, helper.RATE, subtype="PCM_16")
        self.request.write_text(json.dumps({
            "version": 1, "inputWav": str(self.source), "outputWav": str(root / "processed.wav"),
            "outputJson": str(self.output), "modelPath": "model", "expectedText": "慢慢放松",
            "followingText": "安静休息", "clauses": ["慢慢放松"],
        }), encoding="utf-8")

    def read_result(self):
        return json.loads(self.output.read_text(encoding="utf-8"))

    def test_success_retains_distinct_full_source_and_extracted_transcripts(self):
        source = ("慢慢放松，安静休息。", segment_words())
        target = ("慢慢放松", segment_words()[:1])
        with patch.object(helper, "transcribe", side_effect=[source, target]):
            processed, result = helper.analyze(None, self.audio, "慢慢放松", "安静休息", ["慢慢放松"])
        self.assertLess(processed.size, self.audio.size)
        self.assertEqual(result["recognition"], {
            "stage": "complete", "sourceTranscript": source[0], "sourceWords": source[1],
            "targetTranscript": target[0], "expectedText": "慢慢放松", "followingText": "安静休息",
            "contentComparison": {"status": "matched", "similarity": 1, "threshold": .9,
                                  "substitutionCount": 0, "expected": "慢慢放松", "recognized": "慢慢放松"},
        })

    def test_changed_opening_is_accepted_only_with_verified_cut_and_visible_content_difference(self):
        words = greeting_words() + [{"text": "快进来", "start": 1.6, "end": 1.9}]
        source = ("回来了，外面是不是很冷，快进来", words)
        left = ("回来了外面是不是很冷", greeting_words())
        right = ("快进来", [{"text": "快进来", "start": .25, "end": .55}])
        final = ("回来了外面是不是很冷", greeting_words(cropped=True))
        with patch.object(helper, "transcribe", side_effect=[source, left, right, final]) as recognize:
            _, result = helper.analyze(None, greeting_audio(), "回来啦？外面是不是很冷？", "快进来",
                                       ["回来啦？", "外面是不是很冷？"])
        self.assertEqual(recognize.call_count, 4)
        recognition = result["recognition"]
        self.assertEqual(recognition["stage"], "complete")
        self.assertEqual(recognition["sourceTranscript"], source[0])
        self.assertEqual(recognition["sourceWords"], words)
        self.assertEqual(recognition["contentComparison"], {
            "status": "different", "similarity": .9, "threshold": .9, "substitutionCount": 1,
            "expected": "回来啦外面是不是很冷", "recognized": "回来了外面是不是很冷",
        })
        self.assertIn("cutValidation", result)
        self.assertNotIn("alignment", recognition)

    def test_target_validation_failure_keeps_both_transcripts(self):
        with patch.object(helper, "transcribe", side_effect=[
                ("慢慢放松安静休息", segment_words()), ("慢慢放", segment_words()[:1])]):
            self.assertEqual(helper.process_request(str(self.request), lambda _: None), 0)
        result = self.read_result()
        self.assertFalse(result["success"])
        self.assertEqual(result["recognition"]["stage"], "target_validation")
        self.assertEqual(result["recognition"]["targetTranscript"], "慢慢放")
        self.assertEqual(result["recognition"]["sourceTranscript"], "慢慢放松安静休息")

    def test_failed_cut_alignment_does_not_leak_into_later_cut_or_final_validation(self):
        coarse = segment_words()
        coarse[1]["start"] = .61
        source = ("慢慢放松安静休息", coarse)
        left = ("慢慢放松", [{"text": "慢慢放松", "start": .2, "end": .6}])
        wrong_right = ("别的内容", [{"text": "别的内容", "start": .25, "end": .65}])
        right = ("安静休息", [{"text": "安静休息", "start": .25, "end": .65}])
        wrong_final = ("慢慢放", [{"text": "慢慢放", "start": .08, "end": .48}])
        replies = [source, left, wrong_right, left, right, wrong_final]
        calls = 0

        def recognize(_model, _audio):
            nonlocal calls
            if calls in (3, 5):
                checkpoint = self.read_result()["recognition"]
                self.assertNotIn("alignment", checkpoint)
                self.assertNotIn("targetTranscript", checkpoint)
                self.assertEqual(checkpoint["stage"], "boundary_check" if calls == 3 else "target_transcription")
            result = replies[calls]
            calls += 1
            return result

        candidates = [{"method": "two_sided", "thresholdDbfs": -68,
                       "quietStartSeconds": .6, "quietEndSeconds": 1.1, "cut": cut}
                      for cut in (.8, .85)]
        with patch.object(helper, "transcribe", side_effect=recognize), \
                patch.object(helper, "quiet_cut_candidates", return_value=candidates):
            self.assertEqual(helper.process_request(str(self.request), lambda _: None), 0)
        self.assertEqual(calls, 6)
        result = self.read_result()
        self.assertEqual(result["code"], "missing_or_extra_speech")
        self.assertEqual(result["recognition"]["stage"], "target_validation")
        self.assertEqual(result["recognition"]["targetTranscript"], "慢慢放")
        self.assertEqual(result["recognition"]["sourceTranscript"], source[0])
        self.assertNotIn("alignment", result["recognition"])

    def test_failed_cut_diagnostics_are_cleared_before_a_later_cut_asr_crashes(self):
        coarse = segment_words()
        coarse[1]["start"] = .61
        left = ("慢慢放松", [{"text": "慢慢放松", "start": .2, "end": .6}])
        wrong_right = ("别的内容", [{"text": "别的内容", "start": .25, "end": .65}])
        candidates = [{"method": "two_sided", "thresholdDbfs": -68,
                       "quietStartSeconds": .6, "quietEndSeconds": 1.1, "cut": cut}
                      for cut in (.8, .85)]
        with patch.object(helper, "transcribe", side_effect=[("慢慢放松安静休息", coarse), left,
                                                             wrong_right, RuntimeError("private runtime error")]), \
                patch.object(helper, "quiet_cut_candidates", return_value=candidates):
            self.assertEqual(helper.process_request(str(self.request), lambda _: None), 0)
        result = self.read_result()
        self.assertEqual(result["code"], "analysis_failed")
        self.assertEqual(result["recognition"]["stage"], "boundary_check")
        self.assertNotIn("alignment", result["recognition"])
        self.assertNotIn("targetTranscript", result["recognition"])
        self.assertEqual(result["recognition"]["sourceWords"], coarse)
        self.assertNotIn("private", self.output.read_text(encoding="utf-8"))

    def test_generic_analyze_failure_keeps_source_without_exception_message(self):
        with patch.object(helper, "transcribe", return_value=("慢慢放松安静休息", segment_words())), \
                patch.object(helper, "trim_quiet_edges", side_effect=RuntimeError("I:/private/model secret failure")):
            self.assertEqual(helper.process_request(str(self.request), lambda _: None), 0)
        result = self.read_result()
        self.assertEqual(result["code"], "analysis_failed")
        self.assertEqual(result["recognition"]["sourceWords"], segment_words())
        self.assertEqual(result["recognition"]["stage"], "boundary_check")
        self.assertNotIn("private", self.output.read_text(encoding="utf-8"))

    def test_process_failure_after_analysis_preserves_completed_asr(self):
        with patch.object(helper, "transcribe", side_effect=[
                ("慢慢放松安静休息", segment_words()), ("慢慢放松", segment_words()[:1])]), \
                patch.object(helper.sf, "write", side_effect=OSError("private path denied")):
            self.assertEqual(helper.process_request(str(self.request), lambda _: None), 0)
        result = self.read_result()
        self.assertEqual(result["code"], "analysis_failed")
        self.assertEqual(result["recognition"]["stage"], "complete")
        self.assertEqual(result["recognition"]["targetTranscript"], "慢慢放松")
        self.assertNotIn("private", self.output.read_text(encoding="utf-8"))

    def test_checkpoint_survives_interruption_immediately_after_source_asr(self):
        def interrupt(_expected, _words, **_options):
            checkpoint = self.read_result()
            self.assertEqual(checkpoint["code"], "analysis_incomplete")
            self.assertEqual(checkpoint["recognition"]["sourceTranscript"], "慢慢放松安静休息")
            self.assertEqual(checkpoint["recognition"]["sourceWords"], segment_words())
            raise KeyboardInterrupt()

        with patch.object(helper, "transcribe", return_value=("慢慢放松安静休息", segment_words())), \
                patch.object(helper, "align_prefix", side_effect=interrupt):
            with self.assertRaises(KeyboardInterrupt):
                helper.process_request(str(self.request), lambda _: None)
        self.assertEqual(self.read_result()["recognition"]["stage"], "source_alignment")
        self.assertEqual(list(self.output.parent.glob("*.tmp")), [])

    def test_model_load_failure_has_empty_safe_recognition(self):
        def fail(_path):
            raise RuntimeError("I:/private/model unavailable")
        self.assertEqual(helper.process_request(str(self.request), fail), 0)
        result = self.read_result()
        self.assertEqual(result["code"], "analysis_failed")
        self.assertEqual(result["recognition"]["sourceTranscript"], "")
        self.assertEqual(result["recognition"]["stage"], "source_transcription")
        self.assertNotIn("private", self.output.read_text(encoding="utf-8"))

    def test_worker_keeps_failed_recognition_in_same_result_file(self):
        incoming = io.StringIO(json.dumps({"requestPath": str(self.request)}) + "\n")
        outgoing = io.StringIO()
        wrong = [{"text": "完全不同", "start": .1, "end": .5}]
        with patch.object(helper, "load_model", return_value=object()), \
                patch.object(helper, "transcribe", return_value=("完全不同", wrong)):
            self.assertEqual(helper.worker("model", incoming, outgoing), 0)
        self.assertEqual(json.loads(outgoing.getvalue()), {"requestPath": str(self.request), "code": 0})
        result = self.read_result()
        self.assertEqual(result["code"], "uncertain_word_alignment")
        self.assertEqual(result["recognition"]["sourceTranscript"], "完全不同")
        self.assertEqual(result["recognition"]["alignment"]["recognizedPrefix"], "完全不同")

    def test_diagnostic_bounds_do_not_admit_invalid_timestamps_or_unbounded_strings(self):
        words = [{"text": "字" * 201, "start": 0, "end": 120.1}] * 2001
        words[0] = {"text": "invalid", "start": 0, "end": float("nan")}
        result = helper.recognition_snapshot({"stage": "source_alignment", "sourceTranscript": "a" * 9000,
                                               "expectedText": "😀" * 501, "sourceWords": words,
                                               "followingText": "b" * 2000, "targetTranscript": "c" * 9000})
        self.assertEqual(len(result["sourceTranscript"]), 8000)
        self.assertEqual(len(result["expectedText"].encode("utf-16-le")), 1000)
        self.assertEqual(len(result["targetTranscript"]), 8000)
        self.assertEqual(len(result["followingText"]), 1500)
        self.assertLessEqual(len(result["sourceWords"]), 2000)
        self.assertEqual(len(result["sourceWords"][0]["text"]), 200)
        json.dumps(result, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
