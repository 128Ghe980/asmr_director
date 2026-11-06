"""Sound-first silent visuals: dependency order, recovery and single-pass mixing."""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import test_runner as support
import test_runner_asmr_sound as asmr_support

runner = support.runner


class SoundFirstTests(unittest.TestCase):
    setUpClass = classmethod(lambda cls: support.TEST_ROOT.mkdir(parents=True, exist_ok=True))
    tearDown = support.RunnerTests.tearDown
    save_manifest = support.RunnerTests.save_manifest
    make_runner = support.RunnerTests.make_runner
    publish = support.RunnerTests.publish

    def setUp(self):
        asmr_support.AsmrSoundTests.setUp(self)
        self.manifest["silentAudioMode"] = "asmr-first"
        self.manifest["shots"][1]["prompt"] = (
            "subject_definitions:\nS1 follows <Picture 1>.\n\nretention_analysis:\n"
            "Sound is synchronized foley accompanying S1's empty-hand gestures: fabric. Generate soft sounds.\n\n"
            "[Shot 1] One continuous shot.\nVisual: S1 at fixed camera.\nAction: Empty-handed collar gesture.\n"
            "Camera: Static.\nPerformance: S1 performs empty-handed.\nnon_diegetic_music: N/A")
        self.save_manifest()

    def graph(self, batch, shot="second", candidate=1):
        entry = batch.candidate_entry(shot, candidate)
        return json.loads(batch.state_file(entry["payload"]).read_text(encoding="utf-8"))["prompt"]

    def test_sound_precedes_main_and_same_candidate_audio_keeps_character_and_tail(self):
        batch = self.make_runner(candidates=2, concat=True)
        result = batch.run()
        self.assertEqual((result["succeeded"], result["asmr_succeeded"]), (4, 4))
        self.assertEqual(len(self.remote.model_posts), 8)
        self.assertTrue(all("ASMR_SOUND_" in item["prompt"]["22"]["inputs"]["prompt"] for item in self.remote.model_posts[:4]))
        for candidate in (1, 2):
            graph = self.graph(batch, candidate=candidate)
            ref = graph["22"]["inputs"]
            self.assertEqual(ref["ref_images.ref_image_0"], ["20", 0])
            self.assertEqual(ref["ref_images.ref_image_1"], ["900", 0])
            self.assertEqual(ref["ref_audios.ref_audio_0"], ["904", 0])
            self.assertEqual(graph["904"]["inputs"], {"audio": ["24", 0], "start_index": 0., "duration": 5.})
            self.assertEqual(graph["11"]["inputs"]["audio"], ["904", 0])
            self.assertNotIn("4", graph)
            self.assertNotIn("Sound is synchronized foley", ref["prompt"])
            self.assertNotIn("Generate soft sounds", ref["prompt"])
            self.assertEqual(ref["prompt"].count("<Audio 1>: fully_copy"), 1)
            self.assertIn("without speaking, vocal sounds or lip-sync", ref["prompt"])
            self.assertIn("Action: Empty-handed collar gesture.", ref["prompt"])
            self.assertIn("Performance: S1 performs empty-handed.", ref["prompt"])
            entry = batch.candidate_entry("second", candidate)
            sound = batch.sound_runner.candidate_entry("second", candidate)
            self.assertEqual(entry["sound_dependency"]["outputSha256"], sound["output_sha256"])
            self.assertEqual(entry["audio_sha256"], sound["output_sha256"])
            self.assertEqual(entry["sound_dependency"]["candidateIndex"], candidate)
            self.assertTrue(entry["audio_snapshot"].endswith(".mp4"))
            preview = batch.state["asmrPreviews"][str(candidate)]
            mix = json.loads(batch.state_file(preview["payload"]).read_text())["prompt"]
            self.assertEqual(mix["preview_asmr_mixed_1"]["inputs"]["audio1"], ["preview_empty_1", 0])
            self.assertEqual(mix["preview_asmr_mixed_0"]["inputs"]["audio1"], ["preview_padded_0", 0])
            self.assertEqual(sum(n["class_type"] == "AsmrDirectorSpatialAudio" for n in mix.values()), 2)
            self.assertFalse(any(n["class_type"].startswith("AsmrDirector") for n in graph.values()))
        self.make_runner(candidates=2, concat=True).run()
        self.assertEqual(len(self.remote.posts), 12)

    def test_failed_sound_blocks_only_matching_silent_candidate_and_speech_continues(self):
        self.remote.fail_posts = {3}  # Silent candidate 1; candidates 2 and speech sounds succeed.
        batch = self.make_runner(candidates=2, retries=0)
        result = batch.run()
        self.assertEqual(result["succeeded"], 3)
        self.assertEqual(result["input_error"], 1)
        self.assertIn("同候选前置 ASMR", batch.candidate_entry("second", 1)["input_error"])
        self.assertEqual(batch.candidate_entry("second", 2)["status"], "succeeded")
        self.assertEqual(len(self.remote.model_posts), 7)
        self.make_runner(candidates=2, retries=0, rerun_asmr_candidates="second:1").run()
        self.assertEqual(len(self.remote.model_posts), 9)

    def test_missing_plan_blocks_silent_without_native_fallback(self):
        del self.manifest["shots"][1]["asmrSound"]
        self.save_manifest()
        batch = self.make_runner()
        result = batch.run()
        self.assertEqual(result["succeeded"], 1)
        self.assertIn("缺少 asmrSound", batch.candidate_entry("second")["input_error"])
        self.assertEqual(len(self.remote.model_posts), 2)
        with self.assertRaisesRegex(runner.BatchError, "缺少 asmrSound"):
            self.make_runner(dry_run=True).run()

    def test_only_and_sound_rerun_invalidate_matching_visual_not_siblings(self):
        first = self.make_runner(candidates=2)
        first.run()
        old = copy.deepcopy(first.state)
        second = self.make_runner(candidates=2, only="second", rerun_asmr_candidates="second:2")
        second.run()
        self.assertEqual(len(self.remote.model_posts), 10)
        self.assertEqual(second.candidate_entry("second", 1), support.entry(old, "second", 1))
        self.assertEqual(second.candidate_entry("arbitrary/id:one", 2), support.entry(old, "arbitrary/id:one", 2))
        self.assertNotEqual(second.candidate_entry("second", 2)["fingerprint"], support.entry(old, "second", 2)["fingerprint"])
        self.assertTrue(first.state_file(support.entry(old, "second", 2)["output"]).is_file())
        self.assertEqual(second.concat_preview(2), "succeeded")
        self.assertEqual(second.concat_preview(2, with_asmr=True), "succeeded")

    def test_speech_only_selection_without_sound_plan_can_reuse_full_original_preview(self):
        del self.manifest["shots"][0]["asmrSound"]
        self.save_manifest()
        first = self.make_runner(concat=True)
        first.run()
        preview = copy.deepcopy(first.state["previews"])
        second = self.make_runner(only="1", concat=True)
        result = second.run()
        self.assertEqual(result["preview_failed"], 0)
        self.assertEqual(second.state["previews"], preview)
        self.assertEqual(second.sound_runner.only, set())
        self.assertEqual(len(self.remote.model_posts), 3)
        self.assertEqual(result["asmr_preview_failed"], 1)  # Speech has no enhancement plan.

    def test_new_candidate_only_fills_missing_sound_and_visual(self):
        self.make_runner().run()
        self.make_runner(candidates=2).run()
        self.assertEqual(len(self.remote.model_posts), 8)

    def test_preupgrade_sound_only_resume_recovers_candidate_count_and_custom_seed(self):
        original = self.make_runner(seed=937, candidates=2)
        child = original.prepare_sound_runner()
        self.assertEqual(child.run()["succeeded"], 4)
        # An interruption in an older runner left only the v2 sidecar. No
        # explicit base seed or range was saved outside individual receipts.
        for field in ("candidatePlan", "baseSeed"):
            child.state.pop(field)
        child.save()
        self.assertFalse(original.state_path.exists())
        recovered = self.make_runner()
        result = recovered.run()
        self.assertEqual((result["succeeded"], result["asmr_succeeded"]), (4, 4))
        self.assertEqual((recovered.seed, list(recovered.candidate_range)), (937, [1, 2]))
        self.assertEqual(len(self.remote.model_posts), 8)
        self.assertFalse(any("ASMR_SOUND_" in post["prompt"]["22"]["inputs"]["prompt"] for post in self.remote.model_posts[4:]))

    def test_changed_sound_prompt_invalidates_visual_but_spatial_settings_do_not(self):
        first = self.make_runner(concat=True)
        first.run()
        original = copy.deepcopy(first.state["previews"])
        self.manifest["shots"][1]["asmrSound"]["postProcessing"]["gainDb"] = -3
        self.save_manifest()
        second = self.make_runner(concat=True)
        second.run()
        self.assertEqual(len(self.remote.model_posts), 4)
        self.assertEqual(second.state["previews"], original)
        self.assertEqual(len(self.remote.preview_posts), 3)
        self.manifest["shots"][1]["asmrSound"]["prompt"] += " Different brushing rhythm."
        self.save_manifest()
        self.make_runner().run()
        self.assertEqual(len(self.remote.model_posts), 6)

    def test_failed_sound_rerun_keeps_prior_visual_but_refuses_stale_preview(self):
        first = self.make_runner(concat=True)
        first.run()
        old = copy.deepcopy(first.candidate_entry("second"))
        self.manifest["shots"][1]["asmrSound"]["prompt"] = "FAIL_THIS"
        self.save_manifest()
        second = self.make_runner(retries=0, concat=True)
        result = second.run()
        self.assertEqual(second.candidate_entry("second")["output"], old["output"])
        self.assertTrue(second.state_file(old["output"]).is_file())
        self.assertIn("input_error", second.candidate_entry("second"))
        self.assertEqual(result["preview_failed"], 1)
        self.assertEqual(result["asmr_preview_failed"], 1)
        self.assertEqual(len(self.remote.model_posts), 5)

    def test_pending_sound_blocks_silent_without_resubmitting_on_resume(self):
        self.remote.behavior = "queued"
        first = self.make_runner(only="second")
        result = first.run()
        self.assertEqual(len(self.remote.model_posts), 1)
        self.assertEqual(result["input_error"], 1)
        second = self.make_runner(only="second")
        second.run()
        self.assertEqual(len(self.remote.model_posts), 1)
        prompt_id = first.sound_runner.candidate_entry("second")["prompt_id"]
        self.remote.record(prompt_id, self.remote.posts[0])
        self.remote.pending = []
        self.remote.behavior = "success"
        third = self.make_runner(only="second")
        self.assertEqual(third.run()["succeeded"], 1)
        self.assertEqual(len(self.remote.model_posts), 2)

    def test_sound_batch_error_cannot_silently_reuse_old_audio_for_requested_rerun(self):
        self.make_runner().run()
        batch = self.make_runner(rerun_asmr="second")
        sound_runner = batch.prepare_sound_runner()
        with patch.object(sound_runner, "run", side_effect=runner.RemotePreflightError("missing decoder")):
            result = batch.run()
        self.assertEqual(result["input_error"], 1)
        self.assertIn("前置 ASMR 批次", batch.candidate_entry("second")["input_error"])
        self.assertEqual(len(self.remote.model_posts), 4)

    def test_changed_audio_container_sha_invalidates_visual_even_if_sound_input_identity_matches(self):
        batch = self.make_runner()
        batch.run()
        before = batch.candidate_entry("second")["fingerprint"]
        sound = batch.sound_runner.candidate_entry("second")
        sound_path = batch.sound_runner.state_file(sound["output"])
        sound_path.write_bytes(b"same-model-input-new-audio-result")
        sound["output_sha256"] = runner.file_hash(sound_path)
        batch.sound_runner.save()
        after = self.make_runner()
        after.run()
        self.assertEqual(len(self.remote.model_posts), 5)
        self.assertNotEqual(after.candidate_entry("second")["fingerprint"], before)

    def test_corrupt_sound_file_blocks_direct_visual_and_stale_preview(self):
        batch = self.make_runner()
        batch.run()
        sound = batch.sound_runner.candidate_entry("second")
        batch.sound_runner.state_file(sound["output"]).write_bytes(b"corrupt-output")
        with self.assertRaisesRegex(runner.BatchError, "已变化"):
            batch.main_facts(batch.shots[1])
        self.assertEqual(batch.concat_preview(), "unavailable")
        self.assertEqual(len(self.remote.model_posts), 4)

    def test_dry_run_declares_unresolved_same_candidate_dependency_without_network(self):
        batch = self.make_runner(dry_run=True, candidates=2)
        result = batch.run()
        self.assertFalse(self.remote.gets or self.remote.posts)
        for candidate, path in enumerate(result["dry_run"][2:], 1):
            payload = json.loads(Path(path).read_text())
            self.assertIsNone(payload["_dry_run"]["fingerprint"])
            self.assertEqual(payload["_dry_run"]["dependsOn"]["candidateIndex"], candidate)
            self.assertEqual(payload["prompt"]["22"]["inputs"]["ref_audios.ref_audio_0"], ["904", 0])
            self.assertIn(f"C{candidate:03d}", payload["prompt"]["24"]["inputs"]["audio"])

    def test_opt_in_defaults_and_native_override_preserve_legacy_fingerprint(self):
        default = self.make_runner(silent_audio_mode="native", seed=1)
        self.assertEqual(default.silent_audio_mode, "native")
        facts = runner.shot_facts(default.root, default.shots[1])
        expected = default.fingerprint(default.shots[1], facts)
        del self.manifest["silentAudioMode"]
        self.save_manifest()
        old = self.make_runner(seed=1)
        self.assertEqual(old.fingerprint(old.shots[1], facts), expected)
        old.run()
        self.assertIn("FIRST_SHOT", self.remote.model_posts[0]["prompt"]["22"]["inputs"]["prompt"])
        self.assertNotIn("ref_audios.ref_audio_0", self.graph(old)["22"]["inputs"])
        first = self.make_runner(silent_audio_mode="asmr-first")
        first.run()
        self.assertEqual(len(self.remote.model_posts), 5)
        restored = self.make_runner()
        restored.run()
        self.assertEqual(len(self.remote.model_posts), 5)
        self.assertEqual(restored.candidate_entry("second")["fingerprint"], expected)

    def test_native_override_rewrites_sound_reference_retention_and_custom_prompt_appends_priority(self):
        prompt = self.manifest["shots"][1]["prompt"]
        updated = runner.silent_reference_prompt(prompt, True)
        native = runner.silent_reference_prompt(updated, False, "Gentle taps.")
        self.assertNotIn("<Audio 1>", native)
        self.assertIn("Generate only quiet nonverbal ASMR", native)
        self.assertIn("Action: Empty-handed collar gesture.", native)
        self.assertEqual(runner.silent_reference_prompt(updated, True), updated)
        custom = runner.silent_reference_prompt("S1 mimes tapping near the camera.", True)
        self.assertTrue(custom.startswith("S1 mimes tapping near the camera."))
        self.assertIn("overrides earlier sound-generation directions", custom)

    def test_native_override_cache_tracks_sound_text_in_rewritten_retention(self):
        self.manifest["shots"][1]["prompt"] = runner.silent_reference_prompt(self.manifest["shots"][1]["prompt"], True)
        self.save_manifest()
        first = self.make_runner(silent_audio_mode="native")
        first.run()
        old = first.candidate_entry("second")["fingerprint"]
        self.manifest["shots"][1]["asmrSound"]["prompt"] += " A different gentle rhythm."
        self.save_manifest()
        second = self.make_runner(silent_audio_mode="native")
        second.run()
        self.assertNotEqual(second.candidate_entry("second")["fingerprint"], old)
        self.assertEqual(len(self.remote.model_posts), 6)
        self.assertIn("A different gentle rhythm", self.graph(second)["22"]["inputs"]["prompt"])

    def test_explicit_null_sound_plan_remains_supported_in_native_mode(self):
        self.manifest["shots"][1]["asmrSound"] = None
        self.save_manifest()
        self.assertEqual(self.make_runner(silent_audio_mode="native").run()["succeeded"], 2)

    def test_fractional_silent_duration_preserves_whole_sound_and_ceil_video_frames(self):
        self.manifest["shots"][1]["durationSeconds"] = 3.02
        self.save_manifest()
        batch = self.make_runner(only="second")
        self.assertEqual(batch.run()["succeeded"], 1)
        main = self.graph(batch)
        self.assertEqual(main["904"]["inputs"]["duration"], 3.02)
        self.assertEqual(main["903"]["inputs"]["length"], 73)
        sound = self.graph(batch.sound_runner)
        self.assertEqual(sound["904"]["inputs"]["duration"], 3.02)
        self.assertEqual(sound["903"]["inputs"]["length"], 73)
        self.assertEqual(batch.main_facts(batch.shots[1])["target_duration"], 73 / 24)
        native = self.make_runner(silent_audio_mode="native", dry_run=True)
        self.assertEqual(native.main_facts(native.shots[1])["target_frames"], 72)
        for duration in (.22, 1.63, 5.17, 15):
            shot = {**batch.shots[1], "durationSeconds": duration}
            facts = batch.source_facts(shot)
            self.assertGreaterEqual(facts["generation_frames"], facts["target_frames"])
            self.assertEqual(facts["generation_frames"] % 17, 5)

    def test_cli_and_gui_mode_validation_and_per_package_memory(self):
        self.assertEqual(runner.parser().parse_args(["x", "--silent-audio-mode", "asmr-first"]).silent_audio_mode, "asmr-first")
        self.assertEqual(runner.gui_options({"package": "x"})["silent_audio_mode"], None)
        self.assertEqual(runner.gui_options({"package": "x", "silent_audio_mode": "先声音后画面（试验）"})["silent_audio_mode"], "asmr-first")
        with self.assertRaises(runner.BatchError):
            self.make_runner(silent_audio_mode="bad")
        batch = self.make_runner()
        runner.save_gui_aspect_ratio(batch, "portrait")
        runner.save_gui_silent_audio_mode(batch, "asmr-first")
        runner.save_gui_aspect_ratio(batch, "landscape")
        self.assertEqual(runner.gui_silent_audio_label(self.package), "先声音后画面（试验）")
        self.assertEqual(runner.gui_aspect_ratio_label(self.package), "横屏 16:9")
        runner.save_gui_silent_audio_mode(self.make_runner(dry_run=True), "native")
        self.assertEqual(runner.gui_silent_audio_label(self.package), "先声音后画面（试验）")
        self.assertEqual(runner.gui_silent_audio_label(self.root), "按项目设置")


if __name__ == "__main__":
    unittest.main()
