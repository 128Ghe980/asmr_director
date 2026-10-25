"""Synthetic forced-CTC and exact native-frame tests; never load a model."""
from __future__ import annotations

import importlib.util
import hashlib
import itertools
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

import numpy as np

SPEC = importlib.util.spec_from_file_location("force_align_voice", Path(__file__).with_name("force-align-voice.py"))
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)


def emissions(labels, width=5, maximum=-.2):
    values = np.full((len(labels), width), -12.0, dtype=np.float32)
    for frame, token in enumerate(labels):
        values[frame, token] = maximum
    return values


class CtcPathTests(unittest.TestCase):
    def test_full_and_prefix_scores_match_exhaustive_ctc_paths(self):
        # Independent tiny label-path enumeration catches skip/repeat/sink bugs.
        random = np.random.default_rng(21)
        values = random.normal(size=(5, 4)).astype(np.float32)
        values -= np.log(np.exp(values).sum(axis=1, keepdims=True))

        def collapsed(path):
            return [token for token, _ in itertools.groupby(path) if token != 0]

        for tokens in ([1, 2, 1], [1, 1, 2]):
            full_scores, prefix_scores = [], []
            for labels in itertools.product(range(4), repeat=5):
                if collapsed(labels) == list(tokens):
                    full_scores.append(sum(float(values[index, token]) for index, token in enumerate(labels)))
                prior = collapsed(labels)
                if len(prior) >= 2 and prior == list(tokens[:len(prior)]):
                    prefix_scores.append(sum(float(values[index, token]) for index, token in enumerate(labels)))
            self.assertAlmostEqual(helper.ctc_align(values, list(tokens))["totalLogScore"], max(full_scores), places=5)
            self.assertAlmostEqual(helper.ctc_align(values, list(tokens), prefix=True, required_tokens=2)["totalLogScore"],
                                   max(prefix_scores), places=5)

    def test_full_ctc_retains_order_and_characters_instead_of_greedy_text(self):
        result = helper.ctc_align(emissions([0, 1, 1, 0, 2, 0]), [1, 2])
        self.assertEqual([(span["tokenIndex"], span["startFrame"], span["endFrame"]) for span in result["spans"]],
                         [(0, 1, 3), (1, 4, 5)])
        self.assertNotIn("sinkStartFrame", result)

    def test_prefix_does_not_force_unread_tail_into_target_or_following_character(self):
        result = helper.ctc_align(emissions([0, 1, 0, 2, 0, 4, 4, 4]), [1, 2, 3, 3, 3],
                                  prefix=True, required_tokens=2)
        self.assertEqual(len(result["spans"]), 2)
        self.assertEqual(result["spans"][0]["startFrame"], 1)
        self.assertEqual(result["spans"][1]["startFrame"], 3)
        self.assertNotIn("sinkStartFrame", result)

    def test_prefix_all_frames_must_follow_known_tokens_or_blank_without_free_tail(self):
        values = emissions([1, 0, 2, 4, 4, 0], maximum=-.3)
        result = helper.ctc_align(values, [1, 2, 3], prefix=True, required_tokens=2)
        self.assertAlmostEqual(result["totalLogScore"], -12 * 2 - .3 * 4, places=5)

    def test_unrestricted_sink_counterexample_no_longer_compresses_target_into_opening(self):
        # Old free-sink path emitted target token2 at frame1, following token3 at
        # frame2, then ignored known context through a max-emission sink. Its
        # score was -4.0, but it cut before the real target ending at frame6.
        values = np.full((12, 7), -12.0, dtype=np.float32)
        values[:, 0] = -3
        for frame, token in enumerate([1, 6, 6, 6, 6, 2, 0, 3, 0, 4, 0, 5]):
            values[frame, token] = -.1
        values[1, 2], values[2, 3] = -1.5, -1.5
        legacy_early_score = sum(float(values[index, token]) for index, token in enumerate([1, 2, 3]))
        legacy_early_score += sum(float(row.max()) for row in values[3:])
        self.assertAlmostEqual(legacy_early_score, -4, places=5)
        result = helper.ctc_align(values, [1, 2, 3, 4, 5], prefix=True, required_tokens=3)
        self.assertEqual((result["spans"][1]["startFrame"], result["spans"][1]["endFrame"]), (5, 6))
        self.assertEqual(result["spans"][2]["startFrame"], 7)
        self.assertEqual([span["tokenIndex"] for span in result["spans"]], [0, 1, 2, 3, 4])
        self.assertLess(result["totalLogScore"], legacy_early_score)

    def test_prefix_must_emit_target_and_first_following_not_just_target(self):
        result = helper.ctc_align(emissions([1, 0, 2, 4]), [1, 2, 3], prefix=True, required_tokens=2)
        self.assertGreaterEqual(len(result["spans"]), 2)

    def test_prefix_may_end_on_last_required_token_without_a_sink_frame(self):
        result = helper.ctc_align(emissions([1, 2]), [1, 2, 3], prefix=True, required_tokens=2)
        self.assertEqual(len(result["spans"]), 2)
        self.assertNotIn("sinkStartFrame", result)

    def test_wildcard_retains_original_character_and_uses_nonblank_acoustic_score(self):
        values = emissions([0, 1, 0, 2, 0])
        result = helper.ctc_align(values, ["龘", "靐"])
        characters = helper.characters_from_alignment("龘靐", result, .1)
        self.assertEqual([character["char"] for character in characters], ["龘", "靐"])
        self.assertTrue(all(character["wildcard"] is True for character in characters))
        self.assertTrue(all(character["score"] > .8 for character in characters))
        quiet = helper.ctc_align(emissions([0, 0]), ["龘"])
        self.assertLess(quiet["spans"][0]["score"], .001)

    def test_same_unknown_character_repeat_still_needs_a_blank(self):
        with self.assertRaisesRegex(helper.AlignmentError, "^insufficient_ctc_frames$"):
            helper.ctc_align(emissions([1, 2]), ["龘", "龘"])
        result = helper.ctc_align(emissions([1, 0, 2]), ["龘", "龘"])
        self.assertEqual([span["startFrame"] for span in result["spans"]], [0, 2])
        distinct = helper.ctc_align(emissions([1, 1]), ["龘", "靐"])
        self.assertEqual(len(distinct["spans"]), 2)

    def test_repeated_characters_require_a_real_blank_frame(self):
        result = helper.ctc_align(emissions([1, 0, 1, 0]), [1, 1])
        self.assertEqual(len(result["spans"]), 2)
        self.assertLess(result["spans"][0]["endFrame"], result["spans"][1]["startFrame"])
        for prefix in (False, True):
            with self.subTest(prefix=prefix), self.assertRaisesRegex(helper.AlignmentError, "^insufficient_ctc_frames$"):
                helper.ctc_align(emissions([1, 1]), [1, 1], prefix=prefix, required_tokens=2)

    def test_prefix_frame_budget_counts_only_required_not_unread_tokens(self):
        result = helper.ctc_align(emissions([1, 2, 4]), [1, 2] + [3] * 30,
                                  prefix=True, required_tokens=2)
        self.assertEqual(len(result["spans"]), 2)
        with self.assertRaisesRegex(helper.AlignmentError, "^insufficient_ctc_frames$"):
            helper.ctc_align(emissions([1, 2, 4]), [1, 2] + [3] * 30)

    def test_low_but_finite_char_scores_do_not_gate_forced_alignment(self):
        values = emissions([3, 3, 3, 3])
        result = helper.ctc_align(values, [1, 2])
        characters = helper.characters_from_alignment("甲乙", result, .08)
        self.assertTrue(all(character["score"] < .001 for character in characters))
        self.assertEqual([character["char"] for character in characters], ["甲", "乙"])

    def test_invalid_emission_or_token_ids_are_not_guessed(self):
        cases = [(np.empty((0, 5)), [1]), (np.zeros((2, 5, 1)), [1]),
                 (np.array([[0, np.nan]]), [1]), (np.array([[0, -np.inf]]), [1]),
                 (emissions([1]), []), (emissions([1]), [0]), (emissions([1]), [5])]
        for values, tokens in cases:
            with self.subTest(tokens=tokens, shape=values.shape), self.assertRaises(helper.AlignmentError):
                helper.ctc_align(values, tokens)

    def test_prefix_does_not_allow_empty_or_out_of_range_required_path(self):
        for required in (None, 0, -1, 4, True):
            with self.subTest(required=required), self.assertRaises(helper.AlignmentError):
                helper.ctc_align(emissions([1, 2, 3]), [1, 2, 3], prefix=True, required_tokens=required)


class TextAndCutTests(unittest.TestCase):
    vocabulary = {"<pad>": 0, "<unk>": 3, "甲": 1, "乙": 2, "丙": 4}

    def test_oov_is_an_original_character_wildcard_without_dropping_known_tail(self):
        for required in (None, 2, 3):
            with self.subTest(required=required):
                self.assertEqual(helper.encode_alignment_text("甲乙蕉丙", self.vocabulary, required_chars=required), [1, 2, "蕉", 4])

    def test_blank_and_unknown_cannot_silently_represent_a_character(self):
        for dictionary in ({"甲": 0}, {"甲": 3}, {"甲": -1}):
            with self.subTest(dictionary=dictionary):
                self.assertEqual(helper.encode_alignment_text("甲", dictionary), ["甲"])

    def test_ctc_grid_is_real_emission_frame_time_not_text_length(self):
        alignment = helper.ctc_align(emissions([0, 1, 1, 0, 0, 2, 0, 0]), [1, 2])
        characters = helper.characters_from_alignment("甲乙", alignment, 4)
        self.assertEqual((characters[0]["startSeconds"], characters[0]["endSeconds"]), (.5, 1.5))
        self.assertEqual((characters[1]["startSeconds"], characters[1]["endSeconds"]), (2.5, 3.0))

    def test_midpoint_can_cut_contiguous_characters_without_quiet_or_eighty_ms_guard(self):
        characters = [{"char": "甲", "startSeconds": .1, "endSeconds": .2, "score": .01},
                      {"char": "乙", "startSeconds": .2, "endSeconds": .3, "score": .01}]
        self.assertEqual(helper.cut_frames(characters, [1, 1], 48_000, mode="paragraph"), [9600])
        self.assertEqual(helper.cut_frames(characters, [1], 48_000, mode="prefix"), [9600])

    def test_paragraph_cuts_use_clause_character_counts_and_keep_original_pcm_partition(self):
        characters = [{"char": char, "startSeconds": index / 10, "endSeconds": (index + 1) / 10, "score": .1}
                      for index, char in enumerate("甲乙丙甲")]
        cuts = helper.cut_frames(characters, [1, 2, 1], 48_000, mode="paragraph")
        self.assertEqual(cuts, [4800, 14400])
        source = np.arange(48_000, dtype=np.int16).tobytes()
        edges = [0, *cuts, 48_000]
        self.assertEqual(b"".join(source[left * 2:right * 2] for left, right in zip(edges, edges[1:])), source)

    def test_invalid_unordered_or_same_sample_boundaries_are_not_published(self):
        cases = [[{"char": "甲", "startSeconds": .1, "endSeconds": .4, "score": .2},
                  {"char": "乙", "startSeconds": .3, "endSeconds": .5, "score": .2}],
                 [{"char": "甲", "startSeconds": 0, "endSeconds": .000001, "score": .2},
                  {"char": "乙", "startSeconds": .000001, "endSeconds": .000002, "score": .2}]]
        for characters in cases:
            with self.subTest(characters=characters), self.assertRaises(helper.AlignmentError):
                helper.cut_frames(characters, [1, 1], 48_000, mode="paragraph")

    def test_prefix_needs_an_aligned_following_character(self):
        with self.assertRaises(helper.AlignmentError):
            helper.cut_frames([{"char": "甲", "startSeconds": .1, "endSeconds": .2, "score": .2}],
                              [1], 48_000, mode="prefix")


class RequestTests(unittest.TestCase):
    def setUp(self):
        root = Path("I:/AI/asmr_director/qa/force-split/python-tests") if Path("I:/").is_dir() else Path(__file__).resolve().parents[3] / ".local/tmp/force-split"
        root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=root, prefix="protocol-")
        self.directory = Path(self.temporary.name)
        self.source = self.directory / "source.wav"
        self.output = self.directory / "result.json"
        self.request_file = self.directory / "request.json"
        self.write_wav()
        self.request = {"version": 1, "inputWav": str(self.source), "outputJson": str(self.output),
                        "modelPath": str(self.directory / "no-model-loaded"), "mode": "paragraph",
                        "clauses": ["甲。", "乙。"], "inputText": "甲。乙。"}
        self.vocabulary = {"甲": 1, "乙": 2, "丙": 4}
        self.converter = type("Converter", (), {"convert": staticmethod(lambda value: value)})()

    def tearDown(self):
        self.temporary.cleanup()

    def write_wav(self, channels=1, rate=48_000):
        with wave.open(str(self.source), "wb") as output:
            output.setnchannels(channels)
            output.setsampwidth(2)
            output.setframerate(rate)
            output.writeframes(np.full(4800 * channels, 5000, dtype="<i2").tobytes())

    def run_request(self, provider=None):
        self.request_file.write_text(json.dumps(self.request, ensure_ascii=False), encoding="utf-8")
        return helper.process_request(self.request_file, vocabulary=self.vocabulary, converter=self.converter,
                                      emission_provider=provider or (lambda _model, _pcm: emissions([0, 1, 0, 2, 0])))

    def result(self):
        return json.loads(self.output.read_text(encoding="utf-8"))

    def test_real_wav_protocol_hashes_original_utf8_and_cuts_native_frames_without_quiet(self):
        original = self.source.read_bytes()
        self.assertEqual(self.run_request(), 0)
        result = self.result()
        self.assertEqual(set(result), {"version", "success", "method", "mode", "sourceSha256", "inputTextSha256",
            "modelId", "modelRevision", "sampleRate", "sourceFrames", "cutFrames", "characters", "contentVerified"})
        self.assertEqual(result["sourceSha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual(result["inputTextSha256"], hashlib.sha256(self.request["inputText"].encode("utf-8")).hexdigest())
        self.assertEqual(result["cutFrames"], [2400])
        self.assertEqual(result["sourceFrames"], 4800)
        self.assertEqual(result["method"], "ctc_forced")
        self.assertFalse(result["contentVerified"])
        self.assertEqual(self.source.read_bytes(), original)

    def test_oov_request_keeps_original_characters_and_marks_real_wildcard_times(self):
        self.request.update(clauses=["甲蕉。"], inputText="甲蕉。")
        self.assertEqual(self.run_request(lambda *_: emissions([0, 1, 0, 4, 0])), 0)
        self.assertTrue(self.result()["success"])
        self.assertEqual([character["char"] for character in self.result()["characters"]], ["甲", "蕉"])
        self.assertNotIn("wildcard", self.result()["characters"][0])
        self.assertTrue(self.result()["characters"][1]["wildcard"])

    def test_insufficient_frames_business_failure_is_json_and_exit_zero(self):
        self.request.update(clauses=["甲甲甲。"], inputText="甲甲甲。")
        self.assertEqual(self.run_request(lambda *_: emissions([1, 1])), 0)
        self.assertEqual(self.result(), {"version": 1, "success": False, "code": "insufficient_ctc_frames"})

    def test_prefix_protocol_allows_unread_oov_tail_and_keeps_original_input_hash(self):
        self.request.update(mode="prefix", clauses=["甲。"], inputText="甲，乙蕉丙。")
        self.assertEqual(self.run_request(lambda *_: emissions([1, 0, 2, 4, 4])), 0)
        self.assertTrue(self.result()["success"])
        self.assertGreaterEqual(len(self.result()["characters"]), 2)
        self.assertEqual("".join(character["char"] for character in self.result()["characters"]),
                         "甲乙蕉丙"[:len(self.result()["characters"])])
        self.assertEqual(len(self.result()["cutFrames"]), 1)
        self.assertEqual(self.result()["inputTextSha256"], hashlib.sha256("甲，乙蕉丙。".encode("utf-8")).hexdigest())

    def test_invalid_audio_and_source_text_binding_fail_without_model(self):
        self.write_wav(channels=2)
        self.assertEqual(self.run_request(lambda *_: self.fail("invalid audio must not infer")), 0)
        self.assertEqual(self.result()["code"], "invalid_audio")
        self.write_wav()
        self.request["inputText"] = "乙。甲。"
        self.assertEqual(self.run_request(lambda *_: self.fail("binding must precede inference")), 0)
        self.assertEqual(self.result()["code"], "input_text_mismatch")

    def test_extra_or_duplicate_request_keys_are_protocol_errors(self):
        self.request["unexpected"] = True
        self.assertEqual(self.run_request(), 2)
        self.assertFalse(self.output.exists())
        self.request.pop("unexpected")
        raw = json.dumps(self.request, ensure_ascii=False).replace('"version": 1', '"version": 1, "version": 1')
        self.request_file.write_text(raw, encoding="utf-8")
        self.assertEqual(helper.process_request(self.request_file), 2)

    def test_output_cannot_escape_request_directory_or_overwrite_source_or_request(self):
        for output in (self.directory.parent / "escape.json", self.source, self.request_file):
            with self.subTest(output=output):
                self.request["outputJson"] = str(output)
                self.assertEqual(self.run_request(), 2)

    def test_atomic_temporary_json_cannot_alias_the_source_recording(self):
        self.source = self.output.with_name(self.output.name + ".tmp")
        self.write_wav()
        original = self.source.read_bytes()
        self.request["inputWav"] = str(self.source)
        self.assertEqual(self.run_request(), 2)
        self.assertEqual(self.source.read_bytes(), original)
        self.assertFalse(self.output.exists())

    def test_runtime_errors_do_not_leak_paths_or_masquerade_as_content_errors(self):
        def unavailable(*_):
            raise RuntimeError("private model/path/secret")
        self.assertEqual(self.run_request(unavailable), 0)
        self.assertEqual(self.result(), {"version": 1, "success": False, "code": "alignment_failed"})
        self.assertFalse(self.output.with_suffix(".json.tmp").exists())

    def test_original_pcm_and_wav_hash_are_read_from_the_same_snapshot(self):
        frozen = self.source.read_bytes()
        self.write_wav(rate=16_000)
        with patch.object(Path, "read_bytes", return_value=frozen):
            snapshot = helper.read_source(self.source)
        self.assertEqual(snapshot["sourceSha256"], hashlib.sha256(frozen).hexdigest())
        self.assertEqual(snapshot["sourceFrames"], 4800)

    def test_exact_120_second_source_is_supported_and_over_limit_is_not(self):
        with wave.open(str(self.source), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(48_000)
            for _ in range(120):
                output.writeframesraw(bytes(48_000 * 2))
        self.assertEqual(helper.read_source(self.source)["sourceFrames"], 120 * 48_000)
        with wave.open(str(self.source), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(48_000)
            for _ in range(121):
                output.writeframesraw(bytes(48_000 * 2))
        with self.assertRaisesRegex(helper.AlignmentError, "^invalid_audio$"):
            helper.read_source(self.source)


if __name__ == "__main__":
    unittest.main()
