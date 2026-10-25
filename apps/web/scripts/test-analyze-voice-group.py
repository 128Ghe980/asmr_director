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


class PhoneticContentMatchingTests(unittest.TestCase):
    expected = "来~~，面来啦！汤也喝一点，暖胃。"
    source = "来,面来了,汤也喝一点,暖胃。"
    actual = "来,面来了,糖也喝一点,暖胃。"
    clauses = ["来~~，", "面来啦！", "汤也喝一点，", "暖胃。"]

    def compare(self, expected=None, actual=None, source=None, clauses=None):
        return helper.content_comparison(expected or self.expected, actual or self.actual,
            allow_phonetic=True, source_prefix=self.source if source is None else source,
            clauses=self.clauses if clauses is None else clauses)

    def test_current_eleven_character_example_retains_literal_score_and_traceable_evidence(self):
        with self.assertRaises(helper.UnsafeGroup):
            helper.content_comparison(self.expected, self.actual)
        self.assertEqual(self.compare(), {
            "mode": "phonetic_substitutions", "status": "different", "similarity": .818182,
            "threshold": .9, "phoneticSimilarity": .954545, "phoneticThreshold": .95,
            "substitutionCount": 2, "expected": "来面来啦汤也喝一点暖胃",
            "recognized": "来面来了糖也喝一点暖胃", "sourcePrefix": "来面来了汤也喝一点暖胃",
            "differences": [
                {"index": 3, "expected": "啦", "recognized": "了", "expectedPinyin": "la5",
                 "recognizedPinyin": "le5", "rule": "sentence_particle", "clauseEnd": True},
                {"index": 4, "expected": "汤", "recognized": "糖", "expectedPinyin": "tang1",
                 "recognizedPinyin": "tang2", "rule": "source_supported_tone", "sourceCharacter": "汤"},
            ],
        })

    def test_primary_exact_substitution_and_bounded_edit_paths_keep_original_metadata(self):
        for expected, actual, edits in (("安静地休息。", "安靜的休息", False),
                ("回来啦？外面是不是很冷？", "回来了外面是不是很冷", False),
                ("abcdefghijklmn", "abcfghijklmn", True)):
            with self.subTest(expected=expected):
                self.assertEqual(helper.content_comparison(expected, actual, allow_edits=edits,
                    allow_phonetic=True, source_prefix=actual, clauses=[expected]),
                    helper.content_comparison(expected, actual, allow_edits=edits))

    def test_exact_tone_homophones_can_pass_without_faking_literal_correctness(self):
        expected, actual = "带好手表再慢慢坐下来", "戴好首表再慢慢坐下来"
        comparison = self.compare(expected, actual, expected, [expected])
        self.assertEqual(comparison["similarity"], .8)
        self.assertEqual(comparison["phoneticSimilarity"], 1)
        self.assertEqual([difference["rule"] for difference in comparison["differences"]], ["same_tone", "same_tone"])
        self.assertEqual(comparison["status"], "different")

    def test_weighted_threshold_accepts_exact_point_ninety_five_at_ten_characters(self):
        expected, actual, source = "来面来啦汤也喝点暖胃", "来面来了糖也喝点暖胃", "来面来了汤也喝点暖胃"
        comparison = self.compare(expected, actual, source, ["来", "面来啦", "汤也喝点", "暖胃"])
        self.assertEqual(comparison["phoneticSimilarity"], .95)
        self.assertEqual(comparison["similarity"], .8)

    def test_missing_pypinyin_fails_closed_without_affecting_primary_matching(self):
        with patch.object(helper, "_lazy_pinyin", None):
            with self.assertRaises(helper.UnsafeGroup):
                self.compare()
            self.assertEqual(helper.content_comparison("今天慢慢休息", "今天慢慢休息")["status"], "matched")

    def test_tone_difference_requires_exact_source_character_at_the_same_position(self):
        for source in ("", self.actual, "来面来了糖也喝一点暖胃", "来面来了汤也喝一点暖胃多字"):
            with self.subTest(source=source):
                with self.assertRaises(helper.UnsafeGroup):
                    self.compare(source=source)

    def test_two_tone_changes_do_not_borrow_two_source_supported_positions(self):
        expected, actual = "汤也喝一点再看看眼睛", "糖也喝一点再看看烟睛"
        with self.assertRaises(helper.UnsafeGroup):
            self.compare(expected, actual, expected, [expected])

    def test_particle_pair_requires_the_actual_original_clause_ending(self):
        expected, actual, source = "来面啦了汤也喝一点暖胃", "来面了了糖也喝一点暖胃", "来面啦了汤也喝一点暖胃"
        with self.assertRaises(helper.UnsafeGroup):
            self.compare(expected, actual, source, ["来面啦了", "汤也喝一点", "暖胃"])
        with self.assertRaises(helper.UnsafeGroup):
            self.compare(clauses=["来", "面来啦汤也喝一点", "暖胃"])
        # A clause-final 了 pronounced liao3 is not the neutral sentence particle.
        expected, actual = "这件事情没完没了汤也暖胃", "这件事情没完没啦糖也暖胃"
        with self.assertRaises(helper.UnsafeGroup):
            self.compare(expected, actual, expected, ["这件事情没完没了", "汤也暖胃"])

    def test_fallback_rejects_digits_negations_near_initials_finals_and_non_chinese(self):
        for expected, actual in (("不要再慢慢说今天很难", "布要再慢慢说今天很南"),
                ("一起来看看今天很难啊", "衣起来看看今天很南啊"),
                ("来面来啦汤也喝一点暖胃", "来面来了汤也喝一点软胃"),
                ("来面来啦汤也喝一点暖胃", "来面来了滩也喝一点暖胃"),
                ("abcdefghij", "xbcdefghiy")):
            with self.subTest(expected=expected, actual=actual):
                with self.assertRaises(helper.UnsafeGroup):
                    self.compare(expected, actual, expected, [expected])

    def test_fallback_rejects_short_targets_insertions_deletions_moves_repeats_and_three_changes(self):
        for expected, actual in (("回来啦喝汤", "回来了喝糖"),
                ("来面来啦汤也喝一点暖胃", "来面来了也喝一点暖胃"),
                ("来面来啦汤也喝一点暖胃", "来面来了糖也喝一点点暖胃"),
                ("手首再慢慢看看今天外面", "首手再慢慢看看今天外面"),
                ("abcdefabcdxfuvwxyz0123456789", "abcdefabcdefuvwxyz0123456789"),
                ("带好手表再慢慢坐下来喝汤", "戴好首表再慢慢坐下来喝糖")):
            with self.subTest(expected=expected, actual=actual):
                with self.assertRaises(helper.UnsafeGroup):
                    self.compare(expected, actual, expected, [expected])

    def test_optional_dictionary_failures_and_unknown_syllables_fail_closed(self):
        with patch.object(helper, "_lazy_pinyin", side_effect=RuntimeError("dictionary unavailable")):
            with self.assertRaises(helper.UnsafeGroup):
                self.compare()
        with patch.object(helper, "_lazy_pinyin", return_value=["unknown"] * 11):
            with self.assertRaises(helper.UnsafeGroup):
                self.compare()


class PhoneticCutVerificationTests(unittest.TestCase):
    expected = PhoneticContentMatchingTests.expected
    actual = PhoneticContentMatchingTests.actual
    source_text = PhoneticContentMatchingTests.source
    clauses = PhoneticContentMatchingTests.clauses
    following = "一会儿再洗个澡，"

    def words(self, *, source=False, cropped=False):
        offset = .12 if cropped else 0
        return [{"text": text, "start": start - offset, "end": end - offset}
                for text, start, end in (("来,", .2, .4), ("面来了,", .55, .95),
                    ("汤也喝一点," if source else "糖也喝一点,", 1.1, 1.8), ("暖胃。", 1.95, 2.3))]

    def source(self, *, literal_exact=False):
        words = self.words(source=True)
        if literal_exact:
            words[1]["text"] = "面来啦,"
        following = {"text": self.following, "start": 2.9, "end": 3.3}
        return (self.expected if literal_exact else self.source_text) + self.following, words + [following]

    def right(self, text=None):
        return text or self.following, [{"text": text or self.following, "start": .3, "end": .7}]

    def audio(self):
        audio = np.zeros(round(3.5 * helper.RATE))
        for word in self.source()[1]:
            start, end = round(word["start"] * helper.RATE), round(word["end"] * helper.RATE)
            audio[start:end] = tone((end - start) / helper.RATE)
        return audio

    def test_current_example_requires_two_sided_and_final_recognition_and_publishes_literal_score(self):
        replies = [self.source(), (self.actual, self.words()), self.right(),
                   (self.actual, self.words(cropped=True))]
        before = self.audio().copy()
        with patch.object(helper, "transcribe", side_effect=replies) as recognize:
            processed, result = helper.analyze(None, before, self.expected, self.following, self.clauses)
        self.assertEqual(recognize.call_count, 4)
        self.assertLess(processed.size, before.size)
        self.assertTrue(np.array_equal(before, self.audio()))
        self.assertEqual(result["coverage"], .818182)
        comparison = result["recognition"]["contentComparison"]
        self.assertEqual(comparison["mode"], "phonetic_substitutions")
        self.assertEqual(comparison["sourcePrefix"], "来面来了汤也喝一点暖胃")
        self.assertEqual(comparison["phoneticSimilarity"], .954545)
        self.assertEqual(result["recognition"]["stage"], "complete")
        self.assertIn("cutValidation", result)
        self.assertEqual(result["internalPausesMs"], [150, 150, 150])

    def test_exact_source_fast_cut_cannot_publish_phonetic_crop_without_second_two_sided_pass(self):
        replies = [self.source(literal_exact=True), (self.actual, self.words(cropped=True)),
                   (self.actual, self.words()), self.right(), (self.actual, self.words(cropped=True))]
        with patch.object(helper, "transcribe", side_effect=replies) as recognize:
            _, result = helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)
        self.assertEqual(recognize.call_count, 5)
        self.assertIn("cutValidation", result)
        self.assertEqual(result["recognition"]["contentComparison"]["mode"], "phonetic_substitutions")

    def test_word_text_disagreement_missing_boundary_or_bad_following_still_rejects(self):
        for failure in ("word_disagreement", "missing_boundary", "bad_following"):
            final_words = self.words(cropped=True)
            left_words = self.words()
            if failure == "word_disagreement":
                left_words[2]["text"] = "汤也喝一点,"
            if failure == "missing_boundary":
                final_words[:2] = [{"text": "来面来了", "start": .08, "end": .83}]
            right = self.right("快进来休息" if failure == "bad_following" else None)
            replies = [self.source()] + [(self.actual, left_words), right] * 3 + [(self.actual, final_words)]
            if failure == "missing_boundary":
                replies = [self.source(), (self.actual, left_words), right, (self.actual, final_words)]
            with self.subTest(failure=failure), patch.object(helper, "transcribe", side_effect=replies):
                code = "missing_internal_boundary" if failure == "missing_boundary" else "cut_text_mismatch"
                with self.assertRaisesRegex(helper.UnsafeGroup, f"^{code}$"):
                    helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)

    def test_source_text_word_disagreement_cannot_claim_tone_support(self):
        source = self.source()
        bad_source = (source[0].replace("汤", "糖"), source[1])
        replies = [bad_source] + [(self.actual, self.words()), self.right()] * 3
        with patch.object(helper, "transcribe", side_effect=replies):
            with self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
                helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)

    def test_no_continuation_or_no_real_quiet_does_not_publish_phonetic_crop(self):
        with patch.object(helper, "transcribe", return_value=self.source()) as recognize:
            with self.assertRaisesRegex(helper.UnsafeGroup, "^no_verified_quiet_cut$"):
                helper.analyze(None, tone(3.5), self.expected, self.following, self.clauses)
            self.assertEqual(recognize.call_count, 1)
        with patch.object(helper, "transcribe", return_value=(self.actual, self.words())):
            with self.assertRaisesRegex(helper.UnsafeGroup, "^incomplete_or_unrelated_speech$"):
                helper.analyze(None, self.audio(), self.expected, "", self.clauses)

    def test_public_snapshot_rechecks_source_words_and_syllable_rule_evidence(self):
        comparison = helper.content_comparison(self.expected, self.actual, allow_phonetic=True,
            source_prefix=self.source_text, clauses=self.clauses)
        source_transcript, source_words = self.source()
        recognition = {"stage": "complete", "expectedText": self.expected, "sourceTranscript": source_transcript,
                       "sourceWords": source_words, "contentComparison": comparison}
        self.assertEqual(helper.recognition_snapshot(recognition)["contentComparison"], comparison)
        for mutation in ("source_transcript", "source_words", "source_prefix", "pinyin", "particle_end", "non_list"):
            value = json.loads(json.dumps(recognition))
            if mutation == "source_transcript":
                value["sourceTranscript"] = value["sourceTranscript"].replace("汤", "糖")
            elif mutation == "source_words":
                value["sourceWords"][2]["text"] = "糖也喝一点"
            elif mutation == "source_prefix":
                value["contentComparison"]["sourcePrefix"] = "来面来了糖也喝一点暖胃"
            elif mutation == "pinyin":
                value["contentComparison"]["differences"][1]["recognizedPinyin"] = "tang1"
            elif mutation == "particle_end":
                value["contentComparison"]["differences"][0]["clauseEnd"] = False
            else:
                value["contentComparison"]["differences"] = True
            with self.subTest(mutation=mutation):
                self.assertNotIn("contentComparison", helper.recognition_snapshot(value))

    def test_phonetic_tolerance_never_relaxes_exact_leading_hmm_bridge(self):
        source_transcript, source_words = self.source(literal_exact=True)
        source_words.insert(4, {"text": "嗯", "start": 2.7, "end": 2.8})
        source_transcript = self.expected + "嗯" + self.following
        replies = [(source_transcript, source_words)] + [(self.actual, self.words()), self.right()] * 3
        with patch.object(helper, "transcribe", side_effect=replies):
            with self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
                helper.analyze(None, self.audio(), self.expected, self.following, self.clauses)


class ShortSentenceParticleTests(unittest.TestCase):
    expected = "回来啦。"
    actual = "回来了。"
    following = "安静休息。"

    def source(self, actual=None, *, source_exact=False):
        text = self.expected if source_exact else (actual or self.actual)
        return text + self.following, [{"text": text, "start": .2, "end": .6},
                                      {"text": self.following, "start": 1.1, "end": 1.5}]

    def left(self, actual=None, *, cropped=False):
        text = actual or self.actual
        offset = .12 if cropped else 0
        return text, [{"text": text, "start": .2 - offset, "end": .6 - offset}]

    def right(self, text=None):
        text = text or self.following
        return text, [{"text": text, "start": .25, "end": .65}]

    def audio(self):
        return np.concatenate([np.zeros(9600), tone(.4), np.zeros(24000), tone(.4), np.zeros(9600)])

    def one_cut(self):
        return [{"method": "two_sided", "thresholdDbfs": -68, "quietStartSeconds": .6,
                 "quietEndSeconds": 1.1, "cut": .85}]

    def compare(self, expected=None, actual=None, source=None):
        expected, actual = expected or self.expected, actual or self.actual
        return helper.content_comparison(expected, actual, source_prefix=actual if source is None else source,
            clauses=[expected], allow_short_sentence_particle=True)

    def analyze(self, *, expected=None, following=None):
        expected = expected or self.expected
        return helper.analyze(None, self.audio(), expected, self.following if following is None else following,
            [expected], require_two_sided=True, allow_short_sentence_particle=True)

    def test_both_directions_keep_real_literal_score_without_fabricating_phonetic_threshold(self):
        for expected, actual, syllables in ((self.expected, self.actual, ("la5", "le5")),
                (self.actual, self.expected, ("le5", "la5"))):
            with self.subTest(expected=expected):
                result = self.compare(expected, actual)
                self.assertEqual(result["mode"], "sentence_particle")
                self.assertEqual(result["similarity"], .666667)
                self.assertEqual(result["threshold"], .9)
                self.assertEqual(result["acceptanceRule"], "exact_prefix_final_particle")
                self.assertEqual(result["differences"], [{"index": 2, "expected": expected[2], "recognized": actual[2],
                    "expectedPinyin": syllables[0], "recognizedPinyin": syllables[1], "rule": "sentence_particle", "clauseEnd": True}])
                self.assertNotIn("phoneticSimilarity", result)
                self.assertNotIn("phoneticThreshold", result)

    def test_short_exception_does_not_change_normal_matching_or_ten_character_phonetic_floor(self):
        with self.assertRaises(helper.UnsafeGroup):
            helper.content_comparison(self.expected, self.actual)
        with self.assertRaises(helper.UnsafeGroup):
            helper.content_comparison(self.expected, self.actual, allow_phonetic=True,
                                      source_prefix=self.actual, clauses=[self.expected])
        expected, actual = "回来啦？外面是不是很冷？", "回来了外面是不是很冷"
        self.assertEqual(helper.content_comparison(expected, actual, allow_short_sentence_particle=True),
                         helper.content_comparison(expected, actual))
        expected = "今天终于慢慢回来啦。"
        self.assertEqual(self.compare(expected, expected.replace("啦", "了"))["similarity"], .888889)
        expected = "今天终于能慢慢回来啦。"
        result = helper.content_comparison(expected, expected.replace("啦", "了"),
            source_prefix=expected.replace("啦", "了"), clauses=[expected], allow_short_sentence_particle=True)
        self.assertNotIn("mode", result)
        self.assertEqual(result["similarity"], .9)

    def test_prefixes_endings_lengths_and_unchanged_numbers_negations_are_not_a_new_edit_budget(self):
        for expected, actual in (("回来啦。", "会来了"), ("回来啦。", "来了"), ("回来啦。", "快回来了"),
                ("回来啦。", "回来了了"), ("啦回来。", "了回来"), ("回来啦坐好。", "回来了坐好"),
                ("好啦。", "好了"), ("回来啦", "回来了"), ("回来啦，", "回来了"),
                ("不来啦。", "布来了"), ("一碗啦。", "衣碗了"), ("安静地啦。", "安静得了"),
                ("没完没了。", "没完没啦")):
            with self.subTest(expected=expected, actual=actual), self.assertRaises(helper.UnsafeGroup):
                self.compare(expected, actual)
        self.assertEqual(self.compare("别走啦！", "别走了")["similarity"], .666667)
        self.assertEqual(self.compare("一碗啦？", "一碗了")["similarity"], .666667)
        self.assertEqual(self.compare("「回来啦。」", "回来了")["similarity"], .666667)

    def test_source_prefix_and_pinyin_must_establish_the_same_one_particle_rule(self):
        for source in ("", "回来", "快回来了", "会来了", "回来的"):
            with self.subTest(source=source), self.assertRaises(helper.UnsafeGroup):
                self.compare(source=source)
        for pinyin in (None, ["hui2", "lai2", "liao3"], ["unknown"]):
            with self.subTest(pinyin=pinyin):
                context = patch.object(helper, "_lazy_pinyin", None) if pinyin is None else patch.object(helper, "_lazy_pinyin", return_value=pinyin)
                with context, self.assertRaises(helper.UnsafeGroup):
                    self.compare()
        with patch.object(helper, "_lazy_pinyin", side_effect=RuntimeError("private dictionary path")), self.assertRaises(helper.UnsafeGroup):
            self.compare()

    def test_opening_requires_complete_source_word_exact_next_start_left_right_and_final_asr(self):
        replies = [self.source(), self.left(), self.right(), self.left(cropped=True)]
        source_audio = self.audio()
        with patch.object(helper, "transcribe", side_effect=replies) as transcribe, \
                patch.object(helper, "choose_opening_cut", side_effect=AssertionError("one-sided crop forbidden")):
            processed, result = self.analyze()
        self.assertEqual(transcribe.call_count, 4)
        self.assertEqual(result["coverage"], .666667)
        self.assertEqual(result["recognition"]["contentComparison"]["mode"], "sentence_particle")
        self.assertEqual(result["recognition"]["sourceTranscript"], self.source()[0])
        self.assertGreaterEqual(result["cutValidation"]["quietEndSeconds"] - result["cutValidation"]["quietStartSeconds"], .16)
        self.assertEqual(result["recognition"]["stage"], "complete")
        self.assertLess(processed.size, source_audio.size)
        self.assertTrue(np.array_equal(source_audio, self.audio()))

    def test_reverse_and_exact_source_crop_difference_use_identical_independent_proofs(self):
        for reverse, exact_source in ((True, False), (False, True)):
            expected, actual = (self.actual, self.expected) if reverse else (self.expected, self.actual)
            source = self.source(actual if reverse else None, source_exact=exact_source)
            replies = [source, self.left(actual), self.right(), self.left(actual, cropped=True)]
            with self.subTest(reverse=reverse, exact_source=exact_source), patch.object(helper, "transcribe", side_effect=replies) as transcribe:
                _, result = self.analyze(expected=expected)
            self.assertEqual(transcribe.call_count, 4)
            self.assertEqual(result["recognition"]["contentComparison"]["expected"], helper.sentence_particle_text(expected))

    def test_particle_cannot_align_inside_merged_word_or_borrow_a_missing_next_syllable(self):
        for source in ((self.source()[0], [{"text": self.source()[0], "start": .2, "end": 1.5}]),
                ("回来了静休息", [self.source()[1][0], {"text": "静休息", "start": 1.1, "end": 1.5}])):
            with self.subTest(source=source), patch.object(helper, "transcribe", return_value=source), \
                    self.assertRaisesRegex(helper.UnsafeGroup, "^uncertain_word_alignment$"):
                self.analyze()

    def test_direct_opt_in_cannot_use_the_ordinary_one_sided_or_api_alignment_path(self):
        for arguments in ({"require_two_sided": False}, {"require_two_sided": True,
                "alignment_hint": {"terminalWordIndex": 0, "recognizedPrefix": "回来了"}}):
            with self.subTest(arguments=arguments), patch.object(helper, "transcribe", side_effect=AssertionError("invalid scope must not transcribe")), \
                    self.assertRaisesRegex(helper.UnsafeGroup, "^invalid_target$"):
                helper.analyze(None, self.audio(), self.expected, self.following, [self.expected],
                               allow_short_sentence_particle=True, **arguments)

    def test_source_transcript_word_disagreement_and_invalid_retained_timing_fail_closed(self):
        sources = [("回来啦。" + self.following, self.source()[1])]
        for start, end in ((.6, .2), (.2, .2), (-.1, .6)):
            words = self.source()[1]
            words[0] = {**words[0], "start": start, "end": end}
            sources.append((self.source()[0], words))
        for source in sources:
            with self.subTest(source=source), patch.object(helper, "transcribe", return_value=source), self.assertRaises(helper.UnsafeGroup):
                self.analyze()

    def test_right_recognition_and_real_quiet_still_guard_the_cut(self):
        for right in (self.right("静休息。"), self.right("啦安静休息。")):
            replies = [self.source()] + [self.left(), right] * 3
            with self.subTest(right=right), patch.object(helper, "transcribe", side_effect=replies), \
                    self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
                self.analyze()
        with patch.object(helper, "transcribe", return_value=self.source()) as transcribe, \
                self.assertRaisesRegex(helper.UnsafeGroup, "^no_verified_quiet_cut$"):
            helper.analyze(None, tone(1.7), self.expected, self.following, [self.expected],
                           require_two_sided=True, allow_short_sentence_particle=True)
        self.assertEqual(transcribe.call_count, 1)
        right = ("安静休息。接着聊。", [{"text": self.following, "start": .25, "end": .65},
                                   {"text": "接着聊。", "start": .7, "end": .82}])
        with patch.object(helper, "transcribe", side_effect=[self.source(), self.left(), right, self.left(cropped=True)]):
            _, result = self.analyze()
        self.assertTrue(result["success"])

    def test_left_and_final_text_words_must_agree_and_may_not_add_delete_or_replace_the_prefix(self):
        for failure in ("left_missing", "left_disagrees", "final_prefix", "final_missing", "final_zero_timing"):
            left, final = self.left(), self.left(cropped=True)
            if failure == "left_missing":
                left = self.left("来了")
            elif failure == "left_disagrees":
                left = (self.actual, self.left(self.expected)[1])
            elif failure == "final_prefix":
                final = self.left("会来了", cropped=True)
            elif failure == "final_missing":
                final = self.left("回来", cropped=True)
            else:
                final[1][0]["end"] = final[1][0]["start"]
            replies = [self.source()] + ([left, self.right()] * 3 if failure.startswith("left") else [left, self.right(), final])
            with self.subTest(failure=failure), patch.object(helper, "transcribe", side_effect=replies), self.assertRaises(helper.UnsafeGroup):
                self.analyze()

    def test_last_sentence_uses_full_remaining_source_and_independent_final_recognition(self):
        audio = np.concatenate([np.zeros(9600), tone(.4), np.zeros(9600)])
        with patch.object(helper, "transcribe", side_effect=[self.left(), self.left(cropped=True)]) as transcribe:
            _, result = helper.analyze(None, audio, self.expected, "", [self.expected],
                                      require_two_sided=True, allow_short_sentence_particle=True)
        self.assertEqual(transcribe.call_count, 2)
        self.assertEqual(result["coverage"], .666667)
        self.assertEqual(result["recognition"]["contentComparison"]["mode"], "sentence_particle")
        self.assertNotIn("cutValidation", result)
        with patch.object(helper, "transcribe", return_value=self.source()), self.assertRaises(helper.UnsafeGroup):
            helper.analyze(None, self.audio(), self.expected, "", [self.expected],
                           require_two_sided=True, allow_short_sentence_particle=True)

    def test_missing_final_particle_rechecks_only_quiet_trimmed_same_cut_and_then_all_independent_proofs(self):
        missing = ("回来", [{"text": "回来", "start": .2, "end": .5}])
        replies = [self.source(), missing, self.left(cropped=True), self.right(), self.left(cropped=True)]
        inputs = []
        def transcribe(_model, audio):
            inputs.append(audio.copy())
            return replies[len(inputs) - 1]
        source_audio = self.audio()
        with patch.object(helper, "transcribe", side_effect=transcribe):
            processed, result = self.analyze()
        self.assertEqual(len(inputs), 5)
        self.assertEqual(result["coverage"], .666667)
        self.assertEqual(result["recognition"]["targetTranscript"], self.actual)
        self.assertIn("cutValidation", result)
        self.assertLess(inputs[2].size, inputs[1].size)
        self.assertTrue(np.array_equal(inputs[2], inputs[1][round(.12 * helper.RATE):round(.68 * helper.RATE)]))
        self.assertTrue(np.array_equal(processed, inputs[2]))
        self.assertTrue(np.array_equal(source_audio, self.audio()))
        self.assertAlmostEqual(result["cutEndSeconds"], .68)

    def test_missing_final_particle_after_refinement_is_never_accepted_as_complete_speech(self):
        missing = self.left("回来")
        with patch.object(helper, "quiet_cut_candidates", return_value=self.one_cut()), \
                patch.object(helper, "transcribe", side_effect=[self.source(), missing, self.left("回来", cropped=True)]) as transcribe, \
                self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
            self.analyze()
        self.assertEqual(transcribe.call_count, 3)

    def test_refinement_cannot_hide_a_missing_prefix_changed_character_disagreeing_words_or_invalid_timestamps(self):
        for refined in (self.left("会来了", cropped=True), self.left("来了", cropped=True),
                (self.actual, self.left(self.expected, cropped=True)[1]),
                (self.actual, [{"text": self.actual, "start": .08, "end": .08}]),
                (self.actual, [{"text": self.actual, "start": .08, "end": 1.5}])):
            with self.subTest(refined=refined), patch.object(helper, "quiet_cut_candidates", return_value=self.one_cut()), patch.object(helper, "transcribe",
                    side_effect=[self.source(), self.left("回来"), refined]) as transcribe, self.assertRaises(helper.UnsafeGroup):
                self.analyze()
            self.assertEqual(transcribe.call_count, 3)

    def test_missing_interior_or_multiple_characters_never_requests_the_refinement(self):
        for transcript in ("回啦", "回", "回来了啦", "会来"):
            with self.subTest(transcript=transcript), patch.object(helper, "quiet_cut_candidates", return_value=self.one_cut()), patch.object(helper, "transcribe",
                    side_effect=[self.source(), self.left(transcript)]) as transcribe, \
                    self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
                self.analyze()
            self.assertEqual(transcribe.call_count, 2)
        self.assertFalse(helper.missing_short_particle("没完没了。", "没完没", [{"text": "没完没", "start": .2, "end": .6}], ["没完没了。"]))

    def test_no_changed_quiet_edges_means_no_duplicate_recognition(self):
        audio = self.audio()
        audio[:round(.6 * helper.RATE)] = tone(.6)
        source = (self.source()[0], [{"text": self.actual, "start": 0, "end": .81}, self.source()[1][1]])
        missing = ("回来", [{"text": "回来", "start": 0, "end": .81}])
        with patch.object(helper, "quiet_cut_candidates", return_value=self.one_cut()), \
                patch.object(helper, "transcribe", side_effect=[source, missing]) as transcribe, \
                self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
            helper.analyze(None, audio, self.expected, self.following, [self.expected],
                           require_two_sided=True, allow_short_sentence_particle=True)
        self.assertEqual(transcribe.call_count, 2)

    def test_quiet_refinement_preserves_activity_at_the_original_edge(self):
        audio = self.audio()
        audio[:round(.2 * helper.RATE)] = tone(.2)
        refined = (self.actual, [{"text": self.actual, "start": 0, "end": .6}])
        replies = [self.source(), self.left("回来"), refined, self.right(), refined]
        inputs = []
        def transcribe(_model, samples):
            inputs.append(samples.copy())
            return replies[len(inputs) - 1]
        with patch.object(helper, "transcribe", side_effect=transcribe):
            _, result = helper.analyze(None, audio, self.expected, self.following, [self.expected],
                                      require_two_sided=True, allow_short_sentence_particle=True)
        self.assertEqual(len(inputs), 5)
        self.assertTrue(result["success"])
        self.assertTrue(np.array_equal(inputs[2][:round(.2 * helper.RATE)], audio[:round(.2 * helper.RATE)]))

    def test_only_one_refinement_is_allowed_across_multiple_candidate_cuts(self):
        candidates = [{"method": "two_sided", "thresholdDbfs": -68,
                       "quietStartSeconds": .6, "quietEndSeconds": 1.1, "cut": cut} for cut in (.8, .85)]
        replies = [self.source(), self.left("回来"), self.left("回来", cropped=True), self.left("回来")]
        with patch.object(helper, "quiet_cut_candidates", return_value=candidates), \
                patch.object(helper, "transcribe", side_effect=replies) as transcribe, \
                self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
            self.analyze()
        self.assertEqual(transcribe.call_count, 4)

    def test_refined_left_cannot_replace_the_independent_right_or_final_checks(self):
        for failure in ("right", "final"):
            replies = [self.source(), self.left("回来"), self.left(cropped=True)]
            replies += [self.right("静休息")] if failure == "right" else [self.right(), self.left("回来", cropped=True)]
            with self.subTest(failure=failure), patch.object(helper, "quiet_cut_candidates", return_value=self.one_cut()), \
                    patch.object(helper, "transcribe", side_effect=replies), self.assertRaises(helper.UnsafeGroup):
                self.analyze()

    def review_analyze(self, *, expected=None, following=None, audio=None):
        expected = expected or self.expected
        return helper.analyze(None, self.audio() if audio is None else audio, expected,
            self.following if following is None else following, [expected], require_two_sided=True,
            allow_short_sentence_particle=True, allow_short_sentence_text_review=True)

    def test_safe_boundary_with_only_missing_final_particle_remains_explicit_text_review(self):
        replies = [self.source(), self.left("回来"), self.left("回来", cropped=True), self.right(), self.left("回来", cropped=True)]
        with patch.object(helper, "transcribe", side_effect=replies) as transcribe:
            processed, result = self.review_analyze()
        self.assertEqual(transcribe.call_count, 5)
        self.assertEqual(result["coverage"], .666667)
        self.assertEqual(result["recognition"]["stage"], "complete")
        self.assertNotIn("contentComparison", result["recognition"])
        review = result["recognition"]["shortSentenceReview"]
        self.assertEqual(review["status"], "needs_confirmation")
        self.assertEqual(review["reason"], "missing_final_particle")
        self.assertEqual(review["sourcePrefix"], "回来了")
        self.assertEqual(review["expectedPinyin"], "la5")
        self.assertEqual(review["sourcePinyin"], "le5")
        self.assertEqual(review["left"]["transcript"], "回来")
        self.assertEqual(review["right"]["transcript"], self.following)
        self.assertEqual(review["final"]["transcript"], "回来")
        self.assertEqual(result["recognition"]["targetTranscript"], "回来")
        self.assertAlmostEqual(result["cutEndSeconds"], .68)
        self.assertTrue(np.array_equal(processed, self.audio()[round(.12 * helper.RATE):round(.68 * helper.RATE)]))

    def test_missing_left_still_requires_manual_review_even_if_final_recognition_becomes_exact(self):
        replies = [self.source(), self.left("回来"), self.left("回来", cropped=True), self.right(), self.left(self.expected, cropped=True)]
        with patch.object(helper, "transcribe", side_effect=replies):
            _, result = self.review_analyze()
        self.assertEqual(result["coverage"], 1)
        self.assertEqual(result["recognition"]["contentComparison"]["status"], "matched")
        self.assertEqual(result["recognition"]["shortSentenceReview"]["similarity"], 1)
        self.assertEqual(result["recognition"]["shortSentenceReview"]["left"]["transcript"], "回来")
        self.assertEqual(result["recognition"]["shortSentenceReview"]["final"]["transcript"], self.expected)

    def test_final_only_missing_particle_is_reviewed_after_the_complete_left_and_right_checks(self):
        with patch.object(helper, "transcribe", side_effect=[self.source(), self.left(), self.right(), self.left("回来", cropped=True)]) as transcribe:
            _, result = self.review_analyze()
        self.assertEqual(transcribe.call_count, 4)
        self.assertEqual(result["recognition"]["shortSentenceReview"]["left"]["transcript"], self.actual)
        self.assertNotIn("contentComparison", result["recognition"])

    def test_final_remainder_text_review_never_borrows_unaccounted_source_context(self):
        audio = np.concatenate([np.zeros(9600), tone(.4), np.zeros(9600)])
        with patch.object(helper, "transcribe", side_effect=[self.left(), self.left("回来", cropped=True)]) as transcribe:
            _, result = self.review_analyze(following="", audio=audio)
        self.assertEqual(transcribe.call_count, 2)
        review = result["recognition"]["shortSentenceReview"]
        self.assertNotIn("left", review)
        self.assertNotIn("right", review)
        self.assertEqual(review["final"]["transcript"], "回来")
        self.assertEqual(result["coverage"], .666667)
        with patch.object(helper, "transcribe", return_value=self.left("回来")), self.assertRaises(helper.UnsafeGroup):
            self.review_analyze(following="", audio=audio)

    def test_review_never_excuses_other_missing_or_changed_characters_invalid_words_or_the_right_context(self):
        for bad in ("回啦", "会来", "来啦", "回", "回来好", "回来啦啦"):
            replies = [self.source(), self.left(bad)]
            with self.subTest(bad=bad), patch.object(helper, "quiet_cut_candidates", return_value=self.one_cut()), \
                    patch.object(helper, "transcribe", side_effect=replies), self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
                self.review_analyze()
        replies = [self.source(), self.left("回来"), self.left("回来", cropped=True), self.right("静休息")]
        with patch.object(helper, "quiet_cut_candidates", return_value=self.one_cut()), \
                patch.object(helper, "transcribe", side_effect=replies), self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
            self.review_analyze()
        with patch.object(helper, "transcribe", return_value=self.source()), self.assertRaisesRegex(helper.UnsafeGroup, "^no_verified_quiet_cut$"):
            self.review_analyze(audio=tone(1.7))

    def test_review_opt_in_cannot_change_the_old_recipe_or_api_alignment_scope(self):
        replies = [self.source(), self.left("回来"), self.left("回来", cropped=True)]
        with patch.object(helper, "quiet_cut_candidates", return_value=self.one_cut()), \
                patch.object(helper, "transcribe", side_effect=replies), self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
            self.analyze()
        for scope in ({"require_two_sided": False, "allow_short_sentence_particle": True},
                {"require_two_sided": True, "allow_short_sentence_particle": False},
                {"require_two_sided": True, "allow_short_sentence_particle": True,
                 "alignment_hint": {"terminalWordIndex": 0, "recognizedPrefix": "回来了"}}):
            with self.subTest(scope=scope), patch.object(helper, "transcribe", side_effect=AssertionError("invalid scope must not transcribe")), \
                    self.assertRaisesRegex(helper.UnsafeGroup, "^invalid_target$"):
                helper.analyze(None, self.audio(), self.expected, self.following, [self.expected],
                               allow_short_sentence_text_review=True, **scope)

    def test_complete_left_and_final_text_are_automatically_checked_without_a_review_marker(self):
        with patch.object(helper, "transcribe", side_effect=[self.source(), self.left(), self.right(), self.left(cropped=True)]):
            _, result = self.review_analyze()
        self.assertNotIn("shortSentenceReview", result["recognition"])
        self.assertEqual(result["recognition"]["contentComparison"]["mode"], "sentence_particle")

    def test_public_review_snapshot_keeps_real_evidence_and_rejects_forged_prefixes_words_scores_or_context(self):
        replies = [self.source(), self.left("回来"), self.left("回来", cropped=True), self.right(), self.left("回来", cropped=True)]
        with patch.object(helper, "transcribe", side_effect=replies):
            _, result = self.review_analyze()
        original = result["recognition"]
        self.assertEqual(helper.recognition_snapshot(original), original)
        for mutation in ("score", "left_prefix", "final_prefix", "right_prefix", "source_missing", "target_changed", "final_timing", "no_right", "source_word_merge"):
            value = json.loads(json.dumps(original))
            review = value["shortSentenceReview"]
            if mutation == "score": review["similarity"] = 1
            elif mutation == "left_prefix": review["left"]["transcript"] = "会来"
            elif mutation == "final_prefix": review["final"]["transcript"] = "会来"
            elif mutation == "right_prefix": review["right"]["transcript"] = "静休息"
            elif mutation == "source_missing": review["sourcePrefix"] = "回来"
            elif mutation == "target_changed": value["targetTranscript"] = "回来啦"
            elif mutation == "final_timing": review["final"]["words"][0]["end"] = review["final"]["words"][0]["start"]
            elif mutation == "no_right": review.pop("right")
            else: value["sourceWords"] = [{"text": value["sourceTranscript"], "start": .2, "end": 1.5}]
            with self.subTest(mutation=mutation):
                self.assertNotIn("shortSentenceReview", helper.recognition_snapshot(value))

    def test_public_snapshot_rejects_forged_scores_missing_word_endings_and_nonliteral_prefixes(self):
        recognition = {"stage": "complete", "expectedText": self.expected, "followingText": self.following,
            "sourceTranscript": self.source()[0], "sourceWords": self.source()[1], "targetTranscript": self.actual,
            "contentComparison": self.compare()}
        self.assertEqual(helper.recognition_snapshot(recognition)["contentComparison"], self.compare())
        for mutation in ("similarity", "pinyin", "prefix", "interior", "merged_word", "zero_timing", "missing_target"):
            value = json.loads(json.dumps(recognition))
            if mutation == "similarity": value["contentComparison"]["similarity"] = 1
            elif mutation == "pinyin": value["contentComparison"]["differences"][0]["recognizedPinyin"] = "liao3"
            elif mutation == "prefix": value["contentComparison"]["sourcePrefix"] = "会来了"
            elif mutation == "interior": value["expectedText"] = "回来啦，"
            elif mutation == "merged_word": value["sourceWords"] = [{"text": value["sourceTranscript"], "start": .2, "end": 1.5}]
            elif mutation == "zero_timing": value["sourceWords"][0]["end"] = .2
            else: value.pop("targetTranscript")
            with self.subTest(mutation=mutation):
                self.assertNotIn("contentComparison", helper.recognition_snapshot(value))
        final = {**recognition, "followingText": "", "sourceTranscript": self.actual,
                 "sourceWords": recognition["sourceWords"][:1]}
        self.assertEqual(helper.recognition_snapshot(final)["contentComparison"], self.compare())
        self.assertNotIn("contentComparison", helper.recognition_snapshot({**recognition, "followingText": ""}))


class ShortSameToneTextReviewTests(unittest.TestCase):
    expected = "过来坐，炉子边暖和。"
    variant = "过来做，炉子边暖和。"
    following = "慢慢休息。"

    def audio(self):
        return np.concatenate([np.zeros(9600), tone(.4), np.zeros(24000), tone(.4), np.zeros(9600)])

    def target(self, text=None, *, cropped=False):
        text = text or self.expected
        offset = .12 if cropped else 0
        return text, [{"text": text, "start": .2 - offset, "end": .6 - offset}]

    def source(self, text=None):
        text = text or self.expected
        return text + self.following, self.target(text)[1] + [{"text": self.following, "start": 1.1, "end": 1.5}]

    def right(self):
        return self.following, [{"text": self.following, "start": .25, "end": .65}]

    def analyze(self, *, expected=None, following=None, audio=None):
        expected = expected or self.expected
        return helper.analyze(None, self.audio() if audio is None else audio, expected,
            self.following if following is None else following, [expected], require_two_sided=True,
            allow_short_sentence_particle=True, allow_short_sentence_text_review=True)

    def test_source_final_and_both_same_tone_variants_remain_manual_with_real_scores(self):
        audio = np.concatenate([np.zeros(9600), tone(.4), np.zeros(9600)])
        for source, final in ((self.expected, self.variant), (self.variant, self.expected), (self.variant, self.variant)):
            with self.subTest(source=source, final=final), patch.object(helper, "transcribe",
                    side_effect=[self.target(source), self.target(final, cropped=True)]) as transcribe:
                _, result = self.analyze(following="", audio=audio)
            self.assertEqual(transcribe.call_count, 2)
            review = result["recognition"]["shortSentenceReview"]
            self.assertEqual(review["reason"], "same_tone_substitution")
            self.assertEqual(review["status"], "needs_confirmation")
            self.assertEqual(review["sourcePrefix"], helper.sentence_particle_text(source))
            self.assertEqual(review["final"]["transcript"], final)
            self.assertEqual(review["differences"], [{"index": 2, "expected": "坐", "recognized": "做", "expectedPinyin": "zuo4", "recognizedPinyin": "zuo4", "rule": "same_tone"}])
            self.assertEqual(result["coverage"], 1 if final == self.expected else .875)
            if final == self.expected:
                self.assertEqual(result["recognition"]["contentComparison"]["status"], "matched")
            else:
                self.assertNotIn("contentComparison", result["recognition"])

    def test_left_variant_with_complete_final_still_needs_confirmation_and_preserves_cut(self):
        with patch.object(helper, "transcribe", side_effect=[self.source(), self.target(self.variant), self.right(), self.target(cropped=True)]):
            _, result = self.analyze()
        self.assertEqual(result["coverage"], 1)
        self.assertEqual(result["recognition"]["shortSentenceReview"]["left"]["transcript"], self.variant)
        self.assertEqual(result["recognition"]["shortSentenceReview"]["final"]["transcript"], self.expected)
        self.assertIn("cutValidation", result)

    def test_source_variant_locates_only_a_whole_word_with_strict_following_context(self):
        with patch.object(helper, "transcribe", side_effect=[self.source(self.variant), self.target(), self.right(), self.target(cropped=True)]):
            _, result = self.analyze()
        self.assertEqual(result["recognition"]["shortSentenceReview"]["sourcePrefix"], "过来做炉子边暖和")
        with patch.object(helper, "transcribe", return_value=(self.source(self.variant)[0], [{"text": self.source(self.variant)[0], "start": .2, "end": 1.5}])), self.assertRaises(helper.UnsafeGroup):
            self.analyze()

    def test_tone_changes_two_variants_missing_extra_protected_or_non_chinese_characters_are_not_reviewable(self):
        for actual in ("过来左炉子边暖和", "过来做炉字边暖和", "过来做炉子边暖", "过来做炉子边暖和啊"):
            with self.subTest(actual=actual), self.assertRaises(helper.UnsafeGroup):
                helper.short_same_tone_difference(self.expected, actual)
        for expected, actual in (("一起来坐下吧。", "衣起来坐下吧"), ("不要再慢慢说。", "布要再慢慢说")):
            with self.subTest(expected=expected), self.assertRaises(helper.UnsafeGroup):
                helper.short_same_tone_difference(expected, actual)
        audio = np.concatenate([np.zeros(9600), tone(.4), np.zeros(9600)])
        with patch.object(helper, "transcribe", side_effect=[self.target(self.variant), self.target("过来座炉子边暖和", cropped=True)]), self.assertRaises(helper.UnsafeGroup):
            self.analyze(following="", audio=audio)

    def test_following_same_tone_boundary_requires_exact_original_full_sentence_and_independent_words(self):
        expected, following = "鞋也换了吧，别把寒气带进来。", self.expected
        source = (expected + following, [{"text": expected, "start": .2, "end": .6}, {"text": following, "start": 1.1, "end": 1.5}])
        left = (expected, [{"text": expected, "start": .2, "end": .6}])
        right = (self.variant, [{"text": self.variant, "start": .25, "end": .65}])
        final = (expected, [{"text": expected, "start": .08, "end": .48}])
        with patch.object(helper, "transcribe", side_effect=[source, left, right, final]) as transcribe:
            _, result = self.analyze(expected=expected, following=following)
        self.assertEqual(transcribe.call_count, 4)
        self.assertEqual(result["coverage"], 1)
        self.assertNotIn("shortSentenceReview", result["recognition"])
        proof = result["recognition"]["followingPhoneticBoundary"]
        self.assertEqual(proof["expected"], "过来坐炉子边暖和")
        self.assertEqual(proof["recognized"], "过来做炉子边暖和")
        self.assertEqual(proof["sourceWordIndex"], 1)
        self.assertEqual(proof["right"]["transcript"], self.variant)
        self.assertEqual(proof["difference"]["expectedPinyin"], "zuo4")
        for mutation in ("source_variant", "right_missing", "right_tone", "right_words", "source_merged", "extra_field"):
            value = json.loads(json.dumps(result["recognition"]))
            boundary = value["followingPhoneticBoundary"]
            if mutation == "source_variant": value["sourceWords"][1]["text"] = self.variant
            elif mutation == "right_missing": boundary["right"]["transcript"] = "过来做炉子边暖"
            elif mutation == "right_tone": boundary["difference"]["recognizedPinyin"] = "zuo3"
            elif mutation == "right_words": boundary["right"]["words"][0]["text"] = self.expected
            elif mutation == "source_merged": value["sourceWords"] = [{"text": source[0], "start": .2, "end": 1.5}]
            else: boundary["automaticTextPass"] = True
            with self.subTest(mutation=mutation):
                self.assertNotIn("followingPhoneticBoundary", helper.recognition_snapshot(value))

    def test_existing_recipe_still_rejects_the_short_right_homophone_without_the_paragraph_review_opt_in(self):
        expected, following = "鞋也换了吧，别把寒气带进来。", self.expected
        source = (expected + following, [{"text": expected, "start": .2, "end": .6}, {"text": following, "start": 1.1, "end": 1.5}])
        left = (expected, [{"text": expected, "start": .2, "end": .6}])
        right = (self.variant, [{"text": self.variant, "start": .25, "end": .65}])
        candidates = [{"method": "two_sided", "thresholdDbfs": -68, "quietStartSeconds": .6, "quietEndSeconds": 1.1, "cut": .85}]
        with patch.object(helper, "quiet_cut_candidates", return_value=candidates), patch.object(helper, "transcribe", side_effect=[source, left, right]), self.assertRaisesRegex(helper.UnsafeGroup, "^cut_text_mismatch$"):
            helper.analyze(None, self.audio(), expected, following, [expected], require_two_sided=True)

    def test_same_tone_public_review_recomputes_pinyin_scores_and_only_the_same_original_variant(self):
        audio = np.concatenate([np.zeros(9600), tone(.4), np.zeros(9600)])
        with patch.object(helper, "transcribe", side_effect=[self.target(), self.target(self.variant, cropped=True)]):
            _, result = self.analyze(following="", audio=audio)
        original = result["recognition"]
        self.assertEqual(helper.recognition_snapshot(original), original)
        for mutation in ("both_wrong_tones", "extra_diff", "wrong_index", "other_variant", "extra_field", "score", "merged_source", "wrong_window_words"):
            value = json.loads(json.dumps(original))
            review = value["shortSentenceReview"]
            if mutation == "both_wrong_tones":
                review["differences"][0].update(expectedPinyin="zuo3", recognizedPinyin="zuo3")
            elif mutation == "extra_diff": review["differences"].append(review["differences"][0].copy())
            elif mutation == "wrong_index": review["differences"][0]["index"] = 1
            elif mutation == "other_variant": review["sourcePrefix"] = "过来座炉子边暖和"
            elif mutation == "extra_field": review["automaticPass"] = True
            elif mutation == "score": review["similarity"] = 1
            elif mutation == "merged_source": value["sourceWords"] = [{"text": "过来坐炉子边暖和慢慢休息", "start": .2, "end": .6}]
            else: review["final"]["words"][0]["text"] = self.expected
            with self.subTest(mutation=mutation):
                self.assertNotIn("shortSentenceReview", helper.recognition_snapshot(value))

    def test_following_review_never_accepts_source_extra_words_nonexact_source_or_dictionary_failure(self):
        expected = "鞋也换了吧，别把寒气带进来。"
        source_words = [{"text": expected, "start": .2, "end": .6}, {"text": self.expected, "start": 1.1, "end": 1.5}]
        right_words = [{"text": self.variant, "start": .25, "end": .65}]
        for actual in (self.variant, self.expected + "啊", "过来坐炉子边暖"):
            words = [source_words[0], {**source_words[1], "text": actual}]
            with self.subTest(actual=actual), self.assertRaises(helper.UnsafeGroup):
                helper.following_phonetic_boundary(expected, self.expected, words, 1, self.variant, right_words, .85)
        with patch.object(helper, "_lazy_pinyin", None), self.assertRaises(helper.UnsafeGroup):
            helper.following_phonetic_boundary(expected, self.expected, source_words, 1, self.variant, right_words, .85)
        with patch.object(helper, "_lazy_pinyin", side_effect=RuntimeError("private dictionary path")), self.assertRaises(helper.UnsafeGroup):
            helper.following_phonetic_boundary(expected, self.expected, source_words, 1, self.variant, right_words, .85)

    def test_same_tone_review_does_not_relax_the_existing_short_target_validation(self):
        audio = np.concatenate([np.zeros(9600), tone(.4), np.zeros(9600)])
        with patch.object(helper, "transcribe", side_effect=[self.target(), self.target(self.variant, cropped=True)]), self.assertRaises(helper.UnsafeGroup):
            helper.analyze(None, audio, self.expected, "", [self.expected], require_two_sided=True, allow_short_sentence_particle=True)


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
        test_root = Path("I:/AI/asmr_director/qa/voice-group-analysis/python-tests") if Path("I:/").is_dir() else Path(__file__).resolve().parents[3] / ".local/tmp/voice-group-analysis/python-tests"
        test_root.mkdir(parents=True, exist_ok=True)
        self.scratch = tempfile.TemporaryDirectory(dir=test_root)
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

    def test_forced_two_sided_exact_text_bypasses_one_sided_fast_path(self):
        source = ("慢慢放松，安静休息。", segment_words())
        left = ("慢慢放松", segment_words()[:1])
        right = ("安静休息", [{"text": "安静休息", "start": .25, "end": .65}])
        with patch.object(helper, "transcribe", side_effect=[source, left, right, left]) as recognize, \
                patch.object(helper, "choose_opening_cut", side_effect=AssertionError("one-sided path must not run")):
            _, result = helper.analyze(None, self.audio, "慢慢放松", "安静休息", ["慢慢放松"],
                                       require_two_sided=True)
        self.assertEqual(recognize.call_count, 4)
        self.assertEqual(result["recognition"]["stage"], "complete")
        self.assertEqual(result["coverage"], 1)
        self.assertIn("cutValidation", result)
        self.assertGreaterEqual(result["cutValidation"]["quietEndSeconds"] - result["cutValidation"]["quietStartSeconds"], .16)

    def test_json_request_enables_forced_two_sided_and_rejects_non_boolean_flag(self):
        request = json.loads(self.request.read_text(encoding="utf-8"))
        request["requireTwoSided"] = True
        self.request.write_text(json.dumps(request), encoding="utf-8")
        source = ("慢慢放松，安静休息。", segment_words())
        left = ("慢慢放松", segment_words()[:1])
        right = ("安静休息", [{"text": "安静休息", "start": .25, "end": .65}])
        with patch.object(helper, "transcribe", side_effect=[source, left, right, left]), \
                patch.object(helper, "choose_opening_cut", side_effect=AssertionError("one-sided path must not run")):
            self.assertEqual(helper.process_request(str(self.request), lambda _: None), 0)
        self.assertIn("cutValidation", self.read_result())
        before = self.output.read_bytes()
        request["requireTwoSided"] = "true"
        self.request.write_text(json.dumps(request), encoding="utf-8")
        with patch.object(helper, "transcribe", side_effect=AssertionError("invalid flag must not load/transcribe")):
            self.assertEqual(helper.process_request(str(self.request), lambda _: None), 2)
        self.assertEqual(self.output.read_bytes(), before)

    def test_json_cutting_only_uses_one_source_asr_and_preserves_exact_pcm(self):
        request = json.loads(self.request.read_text(encoding="utf-8"))
        request["cuttingOnly"] = True
        self.request.write_text(json.dumps(request), encoding="utf-8")
        source = ("慢慢放松，安静休息。", segment_words())
        with patch.object(helper, "transcribe", return_value=source) as transcribe:
            self.assertEqual(helper.process_request(str(self.request), lambda _: None), 0)
        self.assertEqual(transcribe.call_count, 1)
        result = self.read_result()
        self.assertEqual(result["recognition"]["analysisMode"], "cutting_only")
        self.assertFalse(result["boundaryOnly"]["contentVerified"])
        original, rate = helper.sf.read(self.source, dtype="int16")
        processed, _ = helper.sf.read(request["outputWav"], dtype="int16")
        self.assertTrue(np.array_equal(processed, original[:round(result["cutEndSeconds"] * rate)]))

    def test_json_cutting_only_rejects_invalid_flags_before_model_loading(self):
        request = json.loads(self.request.read_text(encoding="utf-8"))
        for fields in ({"cuttingOnly": "true"}, {"cuttingOnly": True,
                "alignmentHint": {"terminalWordIndex": 0, "recognizedPrefix": "慢慢放松"}}):
            self.request.write_text(json.dumps({**request, **fields}), encoding="utf-8")
            with self.subTest(fields=fields), patch.object(helper, "load_model", side_effect=AssertionError("invalid request")):
                self.assertEqual(helper.process_request(str(self.request)), 2)
        request["cuttingOnly"] = True
        self.request.write_text(json.dumps(request), encoding="utf-8")
        self.assertEqual(helper.process_request(str(self.request), lambda _: (_ for _ in ()).throw(RuntimeError("private model path"))), 0)
        result = self.read_result()
        self.assertFalse(result["success"])
        self.assertEqual(result["recognition"]["analysisMode"], "cutting_only")
        self.assertNotIn("private model path", json.dumps(result))

    def test_json_short_particle_flag_requires_boolean_two_sided_and_no_api_hint(self):
        request = json.loads(self.request.read_text(encoding="utf-8"))
        request.update(expectedText="回来啦。", followingText="安静休息。", clauses=["回来啦。"],
                       requireTwoSided=True, allowShortSentenceParticle=True)
        source = ("回来了。安静休息。", [{"text": "回来了。", "start": .2, "end": .6}, segment_words()[1]])
        left = ("回来了。", [{"text": "回来了。", "start": .2, "end": .6}])
        right = ("安静休息。", [{"text": "安静休息。", "start": .25, "end": .65}])
        final = ("回来了。", [{"text": "回来了。", "start": .08, "end": .48}])
        self.request.write_text(json.dumps(request), encoding="utf-8")
        with patch.object(helper, "transcribe", side_effect=[source, left, right, final]):
            self.assertEqual(helper.process_request(str(self.request), lambda _: None), 0)
        self.assertEqual(self.read_result()["recognition"]["contentComparison"]["mode"], "sentence_particle")
        before = self.output.read_bytes()
        for invalid in ({**request, "allowShortSentenceParticle": "true"}, {**request, "requireTwoSided": False},
                {**request, "alignmentHint": {"terminalWordIndex": 0, "recognizedPrefix": "回来了"}}):
            with self.subTest(invalid=invalid):
                self.request.write_text(json.dumps(invalid), encoding="utf-8")
                with patch.object(helper, "transcribe", side_effect=AssertionError("invalid flag must not transcribe")):
                    self.assertEqual(helper.process_request(str(self.request), lambda _: None), 2)
                self.assertEqual(self.output.read_bytes(), before)

    def test_json_manual_text_review_is_separate_opt_in_with_real_missing_transcripts_and_unchanged_scope(self):
        request = json.loads(self.request.read_text(encoding="utf-8"))
        request.update(expectedText="回来啦。", followingText="安静休息。", clauses=["回来啦。"],
                       requireTwoSided=True, allowShortSentenceParticle=True, allowShortSentenceTextReview=True)
        source = ("回来了。安静休息。", [{"text": "回来了。", "start": .2, "end": .6}, segment_words()[1]])
        missing = ("回来", [{"text": "回来", "start": .2, "end": .6}])
        refined = ("回来", [{"text": "回来", "start": .08, "end": .48}])
        right = ("安静休息。", [{"text": "安静休息。", "start": .25, "end": .65}])
        self.request.write_text(json.dumps(request), encoding="utf-8")
        with patch.object(helper, "transcribe", side_effect=[source, missing, refined, right, refined]):
            self.assertEqual(helper.process_request(str(self.request), lambda _: None), 0)
        result = self.read_result()
        self.assertTrue(result["success"])
        self.assertEqual(result["coverage"], .666667)
        self.assertEqual(result["recognition"]["stage"], "complete")
        self.assertEqual(result["recognition"]["shortSentenceReview"]["status"], "needs_confirmation")
        self.assertEqual(result["recognition"]["targetTranscript"], "回来")
        self.assertNotIn("contentComparison", result["recognition"])
        before = self.output.read_bytes()
        for invalid in ({**request, "allowShortSentenceTextReview": "true"}, {**request, "requireTwoSided": False},
                {**request, "allowShortSentenceParticle": False}, {**request, "alignmentHint": {"terminalWordIndex": 0, "recognizedPrefix": "回来了"}}):
            with self.subTest(invalid=invalid):
                self.request.write_text(json.dumps(invalid), encoding="utf-8")
                with patch.object(helper, "transcribe", side_effect=AssertionError("invalid scope must not transcribe")):
                    self.assertEqual(helper.process_request(str(self.request), lambda _: None), 2)
                self.assertEqual(self.output.read_bytes(), before)

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


class CuttingOnlyTests(unittest.TestCase):
    expected = "进来坐，炉子边暖和。"
    following = "擦擦脸吧。"

    def audio(self):
        return np.concatenate([np.zeros(9600), tone(.4), np.zeros(24000), tone(.4), np.zeros(9600)])

    def source(self, target=None, following=None):
        words = [{"text": target or "进来坐炉子边暖和", "start": .2, "end": .6},
                 {"text": following or "擦擦脸吧", "start": 1.1, "end": 1.5}]
        return "".join(word["text"] for word in words), words

    def analyze(self, source=None, audio=None, expected=None, following=None, clauses=None):
        with patch.object(helper, "transcribe", return_value=source or self.source()) as transcribe:
            result = helper.analyze(None, self.audio() if audio is None else audio,
                expected or self.expected, self.following if following is None else following,
                clauses or [expected or self.expected], cutting_only=True)
        self.assertEqual(transcribe.call_count, 1)
        return result

    def test_source_only_and_exact_pcm_no_left_right_or_final_transcription(self):
        audio = self.audio()
        processed, result = self.analyze(audio=audio)
        self.assertTrue(result["success"])
        self.assertEqual(result["cutStartSeconds"], 0)
        self.assertTrue(np.array_equal(processed, audio[:round(result["cutEndSeconds"] * helper.RATE)]))
        self.assertEqual(result["recognition"]["analysisMode"], "cutting_only")
        self.assertEqual(result["recognition"]["stage"], "complete")
        self.assertEqual(result["recognition"]["targetTranscript"], self.source()[1][0]["text"])
        self.assertEqual(result["transcript"], result["recognition"]["targetTranscript"])
        self.assertEqual(result["boundaryOnly"], {"method": "ordered_word_boundary",
            "alignmentSimilarity": 1.0, "targetEndWordIndex": 0, "followingStartWordIndex": 1,
            "contentVerified": False, "internalPausePositions": []})
        for field in ("contentComparison", "shortSentenceReview", "followingPhoneticBoundary"):
            self.assertNotIn(field, result["recognition"])

    def test_substitutions_and_independent_segment_text_are_not_content_gates(self):
        for text in ("进来做炉子边暖和", "进来坐炉子别暖和", "进来做炉子别暖和"):
            with self.subTest(text=text):
                source = self.source(text)
                source = ("这条segment文字与word数组不同", source[1])
                _, result = self.analyze(source=source)
                self.assertLess(result["coverage"], .9)
                self.assertEqual(result["recognition"]["targetTranscript"], text)
                self.assertFalse(result["boundaryOnly"]["contentVerified"])

    def test_missing_particle_can_locate_whole_word_endpoint(self):
        _, result = self.analyze(source=self.source("回来", "安静休息"), expected="回来啦。",
            following="安静休息。")
        self.assertLess(result["coverage"], .9)
        self.assertEqual(result["boundaryOnly"]["targetEndWordIndex"], 0)

    def test_single_changed_target_character_can_use_ordered_following_anchors(self):
        _, result = self.analyze(source=self.source("做", "我给你倒茶"), expected="坐。", following="我给你倒茶。")
        self.assertEqual(result["coverage"], 0)
        self.assertEqual(result["boundaryOnly"]["targetEndWordIndex"], 0)
        self.assertTrue(result["success"])

    def test_following_substitution_is_only_a_locator_difference(self):
        _, result = self.analyze(source=self.source(following="擦擦连吧"))
        self.assertTrue(result["success"])

    def test_final_take_keeps_all_original_pcm_despite_word_difference(self):
        source = ("进来做炉子别暖和", [{"text": "进来做炉子别暖和", "start": .2, "end": .6}])
        audio = self.audio()[:round(.9 * helper.RATE)]
        processed, result = self.analyze(source=source, audio=audio, following="")
        self.assertTrue(np.array_equal(processed, audio))
        self.assertEqual(result["cutEndSeconds"], .9)
        self.assertNotIn("followingStartWordIndex", result["boundaryOnly"])
        self.assertNotIn("cutValidation", result)
        self.assertEqual(result["boundaryOnly"]["method"], "whole_recording")

    def test_final_unrelated_asr_has_no_content_anchor_gate(self):
        source = ("完全另一些话", [{"text": "完全另一些话", "start": .2, "end": .6}])
        audio = self.audio()
        processed, result = self.analyze(source=source, audio=audio, following="")
        self.assertTrue(np.array_equal(processed, audio))
        self.assertEqual(result["boundaryOnly"]["method"], "whole_recording")
        self.assertEqual(result["coverage"], 0)

    def test_final_without_words_or_with_bad_word_fields_keeps_all_audio(self):
        for words in ([], [{"text": "坏", "start": float("nan"), "end": .1}]):
            with self.subTest(words=words):
                processed, result = self.analyze(source=("识别段文字仍可展示", words), following="")
                self.assertTrue(np.array_equal(processed, self.audio()))
                self.assertEqual(result["boundaryOnly"]["targetEndWordIndex"], -1)
                self.assertEqual(result["recognition"]["sourceWords"], [])
                self.assertEqual(result["transcript"], "")
                self.assertEqual(result["recognition"]["sourceTranscript"], "识别段文字仍可展示")

    def test_final_silent_recording_is_preserved_for_user_listening(self):
        audio = np.zeros(helper.RATE)
        processed, result = self.analyze(source=("", []), audio=audio, following="")
        self.assertTrue(np.array_equal(processed, audio))
        self.assertEqual(result["leadingQuietMs"], 1000)
        self.assertEqual(result["trailingQuietMs"], 0)

    def test_discarded_later_context_timing_cannot_block_this_cut(self):
        source = self.source()
        source[1].append({"text": "远处后文", "start": 30, "end": 120.5})
        _, result = self.analyze(source=source)
        self.assertEqual(len(result["recognition"]["sourceWords"]), 2)

    def test_unrelated_source_only_means_unlocatable_and_keeps_mode_in_failure(self):
        with self.assertRaisesRegex(helper.UnsafeGroup, "^boundary_unlocatable$") as caught:
            self.analyze(source=self.source("完全其他声音", "陌生故事继续"))
        self.assertEqual(caught.exception.recognition["analysisMode"], "cutting_only")
        self.assertEqual(caught.exception.recognition["sourceTranscript"], "完全其他声音陌生故事继续")

    def test_ambiguous_optimal_whole_word_positions_are_not_guessed(self):
        words = [{"text": char, "start": .1 + index * .2, "end": .2 + index * .2}
                 for index, char in enumerate("回来来坐")]
        with self.assertRaisesRegex(helper.UnsafeGroup, "^ambiguous_boundary$"):
            self.analyze(source=("回来来坐", words), expected="回来。", following="坐。")

    def test_merged_word_boundary_is_not_divided_by_character_count(self):
        words = [{"text": "进来坐炉子边", "start": .1, "end": .5},
                 {"text": "暖和擦擦脸吧", "start": .5, "end": 1.5}]
        with self.assertRaisesRegex(helper.UnsafeGroup, "^boundary_unlocatable$"):
            self.analyze(source=("进来坐炉子边暖和擦擦脸吧", words))

    def test_real_quiet_required_even_with_perfect_text(self):
        with self.assertRaisesRegex(helper.UnsafeGroup, "^no_verified_quiet_cut$"):
            self.analyze(audio=tone(1.7))

    def test_single_character_timestamps_can_absorb_a_real_pause(self):
        words = [{"text": "暖", "start": .2, "end": .4},
                 {"text": "和", "start": .4, "end": .9},
                 {"text": "擦", "start": .9, "end": 1.3},
                 {"text": "脸", "start": 1.3, "end": 1.5}]
        _, result = self.analyze(source=("暖和擦脸", words), expected="暖和。", following="擦脸。")
        self.assertTrue(result["success"])
        quiet = result["cutValidation"]
        self.assertLessEqual(quiet["quietStartSeconds"], .9)
        self.assertGreaterEqual(quiet["quietEndSeconds"], .9)
        self.assertGreaterEqual(result["cutEndSeconds"] - quiet["quietStartSeconds"], .08)
        self.assertGreaterEqual(quiet["quietEndSeconds"] - result["cutEndSeconds"], .08)

    def test_real_quiet_can_follow_the_nominal_join_inside_the_next_syllable_span(self):
        # Regression for c700: a word timestamp can precede the real sentence
        # pause. Keep the actual pause, not an 80ms gap around its coarse join.
        words = [{"text": "暖", "start": .2, "end": .4},
                 {"text": "和", "start": .4, "end": .5},
                 {"text": "擦", "start": .55, "end": 1.3},
                 {"text": "脸", "start": 1.3, "end": 1.5}]
        _, result = self.analyze(source=("暖和擦脸", words), expected="暖和。", following="擦脸。")
        self.assertGreater(result["cutValidation"]["quietStartSeconds"], .55)
        self.assertGreater(result["cutEndSeconds"], .55)

    def test_multi_character_target_keeps_its_span_while_next_syllable_absorbs_quiet(self):
        words = [{"text": "放松", "start": .2, "end": .5},
                 {"text": "先", "start": .55, "end": 1.5}]
        cut, quiet = helper.cutting_quiet_boundary(self.audio(), words, 0)
        self.assertAlmostEqual(cut, .85)
        self.assertGreaterEqual(quiet["quietStartSeconds"], words[0]["end"] + helper.WORD_GUARD)
        self.assertLessEqual(quiet["quietEndSeconds"], words[1]["end"] - helper.WORD_GUARD)

    def test_multi_character_following_keeps_its_span_while_target_syllable_absorbs_quiet(self):
        words = [{"text": "坐", "start": .2, "end": 1.25},
                 {"text": "喝茶", "start": 1.25, "end": 1.5}]
        cut, quiet = helper.cutting_quiet_boundary(self.audio(), words, 0)
        self.assertAlmostEqual(cut, .85)
        self.assertGreaterEqual(quiet["quietStartSeconds"], words[0]["start"] + helper.WORD_GUARD)
        self.assertLessEqual(quiet["quietEndSeconds"], words[1]["start"] - helper.WORD_GUARD)

    def test_refinement_does_not_borrow_internal_pause_from_multi_character_target(self):
        words = [{"text": "放松", "start": .2, "end": 1.2},
                 {"text": "先", "start": 1.2, "end": 1.5}]
        with self.assertRaisesRegex(helper.UnsafeGroup, "^no_verified_quiet_cut$"):
            helper.cutting_quiet_boundary(self.audio(), words, 0)

    def test_refinement_does_not_borrow_internal_pause_from_multi_character_following(self):
        words = [{"text": "坐", "start": .2, "end": .5},
                 {"text": "喝茶", "start": .5, "end": 1.5}]
        with self.assertRaisesRegex(helper.UnsafeGroup, "^no_verified_quiet_cut$"):
            helper.cutting_quiet_boundary(self.audio(), words, 0)

    def test_two_multi_character_spans_are_not_divided_to_guess_the_quiet_boundary(self):
        words = [{"text": "放松", "start": .2, "end": .9},
                 {"text": "喝茶", "start": .9, "end": 1.5}]
        with self.assertRaisesRegex(helper.UnsafeGroup, "^no_verified_quiet_cut$"):
            helper.cutting_quiet_boundary(self.audio(), words, 0)

    def test_f0eb_shape_still_rejects_early_pause_and_short_actual_boundary_quiet(self):
        # Recorded word bounds and quiet lengths, represented as synthetic PCM:
        # 2.64..2.82 is before the final target syllable; 3.35..3.48 is only 130ms.
        audio = np.concatenate([tone(2.64), np.zeros(round(.18 * helper.RATE)), tone(.53),
                                np.zeros(round(.13 * helper.RATE)), tone(.08)])
        words = [{"text": "和", "start": 2.96, "end": 3.16},
                 {"text": "擦", "start": 3.16, "end": 3.56}]
        with self.assertRaisesRegex(helper.UnsafeGroup, "^no_verified_quiet_cut$"):
            helper.cutting_quiet_boundary(audio, words, 0)

    def test_earlier_pause_cannot_cut_off_last_target_syllable(self):
        audio = np.concatenate([np.zeros(9600), tone(.3), np.zeros(14400), tone(.35),
                                np.zeros(4800), tone(.35), np.zeros(4800)])
        words = [{"text": "暖", "start": .2, "end": .9},
                 {"text": "和", "start": .9, "end": 1.2},
                 {"text": "擦", "start": 1.2, "end": 1.5}]
        with self.assertRaisesRegex(helper.UnsafeGroup, "^no_verified_quiet_cut$"):
            self.analyze(source=("暖和擦", words), audio=audio, expected="暖和。", following="擦。")

    def test_invalid_source_timestamps_still_prevent_cutting(self):
        source = self.source()
        source[1][0]["end"] = source[1][0]["start"]
        with self.assertRaisesRegex(helper.UnsafeGroup, "^invalid_word_timestamps$"):
            self.analyze(source=source)

    def test_unknown_internal_boundary_does_not_block_the_outer_cut_or_invent_zero(self):
        _, result = self.analyze(clauses=["进来坐，", "炉子边暖和。"])
        self.assertEqual(result["internalPausesMs"], [])
        self.assertEqual(result["boundaryOnly"]["internalPausePositions"], [])

    def test_located_internal_pause_has_explicit_position(self):
        words = [{"text": "进来坐", "start": .2, "end": .4},
                 {"text": "炉子边暖和", "start": .5, "end": .6},
                 {"text": "擦擦脸吧", "start": 1.1, "end": 1.5}]
        _, result = self.analyze(source=("进来坐炉子边暖和擦擦脸吧", words), clauses=["进来坐，", "炉子边暖和。"])
        self.assertEqual(result["internalPausesMs"], [100])
        self.assertEqual(result["boundaryOnly"]["internalPausePositions"], [0])


if __name__ == "__main__":
    unittest.main()
