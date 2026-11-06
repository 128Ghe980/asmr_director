"""Native silent performance -> conditioned continuation effects -> mixed speech video."""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import test_runner as support
import test_runner_asmr_sound as asmr_support

runner = support.runner


class ActionFirstTests(unittest.TestCase):
    setUpClass = classmethod(lambda cls: support.TEST_ROOT.mkdir(parents=True, exist_ok=True))
    tearDown = support.RunnerTests.tearDown
    save_manifest = support.RunnerTests.save_manifest
    make_runner = support.RunnerTests.make_runner
    publish = support.RunnerTests.publish

    def setUp(self):
        asmr_support.AsmrSoundTests.setUp(self)
        speech, silent = self.manifest["shots"]
        silent.update(order=1, referenceMode="new")
        speech.update(order=2, referenceMode="continuous")
        self.manifest["shots"] = [silent, speech]
        self.manifest["silentAudioMode"] = "action-first"
        for shot in self.manifest["shots"]:
            shot["asmrSound"]["role"] = "trigger"
            shot["prompt"] = ("subject_definitions:\nS1 follows <Picture 1>.\n\nretention_analysis:\n"
                + ("Sound is the main content of this non-speaking performance: soft wood tapping."
                   if shot["kind"] == "ambient" else runner.SPEECH_RETENTION)
                + "\n\n[Shot 1] One continuous shot.\nVisual: S1 at fixed camera.\n"
                + "Action: Continue gentle tapping on the same wood tray.\nCamera: Static.\n"
                + ("S1 stays silent." if shot["kind"] == "ambient" else
                   "S1 speaks: <d>[Chinese]继续听这个声音。</d> Mouth movements follow <Audio 1>; lips closed in pauses.")
                + "\nnon_diegetic_music: N/A")
        silent["asmrSound"]["mixMode"] = "replace"
        speech["asmrSound"].update(mixMode="overlay", referenceShotId=silent["id"])
        self.remote.classes[runner.BALANCED_AUDIO_NODE] = {}
        self.save_manifest()

    def graph(self, batch, shot, candidate=1):
        entry = batch.candidate_entry(shot, candidate)
        return json.loads(batch.state_file(entry["payload"]).read_text(encoding="utf-8"))["prompt"]

    def test_append_uses_new_same_candidate_sound_and_previews(self):
        self.make_runner(concat=True).run()
        new = self.make_runner(append_candidates=1, concat=True)
        result = new.run()
        self.assertEqual((result["succeeded"], result["asmr_succeeded"], result["preview_failed"], result["asmr_preview_failed"]), (2, 1, 0, 0))
        self.assertEqual((len(self.remote.model_posts), len(self.remote.preview_posts)), (6, 4))
        self.assertEqual(len(set(support.seeds(self.remote.model_posts))), 6)
        source, speech = new.shots
        effect = new.sound_runner.candidate_entry(speech["id"], 2)
        self.assertEqual(effect["action_dependency"]["candidateIndex"], 2)
        self.assertEqual(effect["action_dependency"]["outputSha256"], new.candidate_entry(source["id"], 2)["output_sha256"])
        self.assertEqual(new.candidate_entry(speech["id"], 2)["sound_dependency"]["outputSha256"], effect["output_sha256"])
        self.assertEqual(new.sound_runner.state["candidatePlan"], {"first": 2, "last": 2, "highWater": 2})
        self.assertTrue((new.output / "preview-asmr-c002.mp4").is_file())
        self.make_runner(concat=True).run()
        self.assertEqual((len(self.remote.model_posts), len(self.remote.preview_posts)), (6, 4))

    def test_native_source_and_separate_voice_and_trigger_references_align_to_both_previews(self):
        batch = self.make_runner(candidates=2, concat=True)
        result = batch.run()
        self.assertEqual((result["succeeded"], result["asmr_succeeded"], result["asmr_failed"]), (4, 2, 0))
        self.assertEqual(len(self.remote.model_posts), 6)
        self.assertEqual([bool("ASMR_SOUND" in x["prompt"]["22"]["inputs"]["prompt"]) for x in self.remote.model_posts],
                         [False, False, True, False, True, False])
        self.assertEqual([shot["id"] for shot in batch.sound_runner.shots], ["arbitrary/id:one"])
        for candidate in (1, 2):
            native = self.graph(batch, "second", candidate)
            self.assertNotIn("ref_audios.ref_audio_0", native["22"]["inputs"])
            self.assertEqual(native["904"]["inputs"]["audio"], ["4", 0])
            self.assertIn("dedicated ASMR performance for relaxation and sleep", native["22"]["inputs"]["prompt"])
            effect = self.graph(batch.sound_runner, "arbitrary/id:one", candidate)
            self.assertEqual(effect["22"]["inputs"]["ref_audios.ref_audio_0"], ["action_reference_audio", 0])
            self.assertNotIn("ref_images.ref_image_0", effect["22"]["inputs"])
            self.assertIn("acoustic reference only", effect["22"]["inputs"]["prompt"])
            self.assertNotIn("fully_copy", effect["22"]["inputs"]["prompt"])
            self.assertEqual(effect["904"]["inputs"]["audio"], ["4", 0])
            self.assertEqual(effect["904"]["inputs"]["duration"], 1.625)
            speech = self.graph(batch, "arbitrary/id:one", candidate)
            self.assertEqual(speech["22"]["inputs"]["ref_audios.ref_audio_0"], ["24", 0])
            self.assertEqual(speech["22"]["inputs"]["ref_audios.ref_audio_1"], ["action_effect_spatial", 0])
            self.assertIn("<Audio 2>: partially_copy", speech["22"]["inputs"]["prompt"])
            self.assertNotIn("fully_copy", speech["22"]["inputs"]["prompt"])
            self.assertEqual(speech["11"]["inputs"]["audio"], ["action_mixed_audio", 0])
            self.assertEqual(speech["action_mixed_audio"]["inputs"], {"audio1": ["24", 0], "audio2": ["action_effect_spatial", 0], "preserve_base": True})
            self.assertEqual(speech["action_effect_spatial"]["class_type"], runner.BALANCED_AUDIO_NODE)
            self.assertEqual(speech["action_effect_spatial"]["inputs"]["previous_trigger_audio"], ["action_source_spatial", 0])
            self.assertEqual(speech["action_effect_spatial"]["inputs"]["previous_gain_db"], self.manifest["shots"][0]["asmrSound"]["postProcessing"]["gainDb"])
            self.assertEqual(speech["action_source_audio"]["inputs"]["audio"], effect["action_reference_audio"]["inputs"]["audio"])
            self.assertEqual(speech["action_effect_spatial"]["inputs"]["reference_audio"], ["24", 0])
            self.assertEqual(speech["action_effect_spatial"]["inputs"]["duration_seconds"], 1.625)
            self.assertEqual(speech["22"]["inputs"]["ref_images.ref_image_1"], ["900", 0])
            self.assertIn("Mouth movements follow only the spoken words", speech["22"]["inputs"]["prompt"])
            source = batch.candidate_entry("second", candidate)
            sound = batch.sound_runner.candidate_entry("arbitrary/id:one", candidate)
            main = batch.candidate_entry("arbitrary/id:one", candidate)
            self.assertEqual(sound["action_dependency"]["outputSha256"], source["output_sha256"])
            self.assertEqual(main["sound_dependency"]["outputSha256"], sound["output_sha256"])
            self.assertEqual(main["sound_dependency"]["source"]["candidateIndex"], candidate)
            for field in ("previews", "asmrPreviews"):
                preview = batch.state[field][str(candidate)]
                graph = json.loads(batch.state_file(preview["payload"]).read_text())["prompt"]
                self.assertEqual(graph["preview_asmr_mixed_0"]["inputs"]["audio1"], ["preview_empty_0", 0])
                self.assertNotIn("preview_asmr_mixed_1", graph)
                self.assertEqual(graph["preview_next_voice_0"]["inputs"], speech["24"]["inputs"])
                self.assertEqual(graph["preview_asmr_audio_0"]["inputs"], speech["action_source_audio"]["inputs"])
                anchor_params = dict(speech["action_source_spatial"]["inputs"], audio=["preview_asmr_audio_0", 0],
                                     reference_audio=["preview_next_voice_0", 0])
                self.assertEqual(graph["preview_asmr_spatial_0"]["inputs"], anchor_params)
                self.assertEqual(sum(node["class_type"] == runner.BALANCED_AUDIO_NODE for node in graph.values()), 1)
        before = len(self.remote.posts)
        self.make_runner(candidates=2, concat=True).run()
        self.assertEqual(len(self.remote.posts), before)

    def test_only_speech_requires_existing_same_candidate_source_without_submitting_it(self):
        batch = self.make_runner(only="2", retries=0)
        result = batch.run()
        self.assertEqual(len(self.remote.model_posts), 0)
        self.assertEqual(result["input_error"], 1)
        self.assertIn("上一无台词段", batch.sound_runner.candidate_entry("arbitrary/id:one")["input_error"])
        self.make_runner(only="1").run()
        self.assertEqual(self.make_runner(only="2").run()["succeeded"], 1)
        self.assertEqual(len(self.remote.model_posts), 3)

    def test_failed_source_blocks_only_its_candidate_and_can_resume(self):
        self.remote.fail_posts = {1}
        batch = self.make_runner(candidates=2, retries=0)
        result = batch.run()
        self.assertEqual((result["succeeded"], result["asmr_succeeded"]), (2, 1))
        self.assertEqual(len(self.remote.model_posts), 4)
        self.assertEqual(batch.candidate_entry("arbitrary/id:one", 2)["status"], "succeeded")
        self.assertIn("input_error", batch.candidate_entry("arbitrary/id:one", 1))
        retry = self.make_runner(candidates=2, retries=0, rerun_candidates="1:1")
        self.assertEqual(retry.run()["succeeded"], 4)
        self.assertEqual(len(self.remote.model_posts), 7)

    def test_failed_effect_blocks_speech_and_no_native_fallback(self):
        self.remote.fail_posts = {2}
        batch = self.make_runner(retries=0)
        result = batch.run()
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(len(self.remote.model_posts), 2)
        self.assertIn("同候选前置 ASMR", batch.candidate_entry("arbitrary/id:one")["input_error"])
        self.assertEqual(self.make_runner(retries=0, rerun_asmr="2").run()["succeeded"], 2)
        self.assertEqual(len(self.remote.model_posts), 4)

    def test_pending_effect_is_reconciled_without_duplicate_model_submission(self):
        self.make_runner(only="1").run()
        self.remote.behavior = "queued"
        first = self.make_runner(only="2")
        self.assertEqual(first.run()["input_error"], 1)
        self.assertEqual(len(self.remote.model_posts), 2)
        self.make_runner(only="2").run()
        self.assertEqual(len(self.remote.model_posts), 2)
        pending = first.sound_runner.candidate_entry("arbitrary/id:one")
        self.remote.record(pending["prompt_id"], self.remote.posts[1])
        self.remote.pending = []
        self.remote.behavior = "success"
        self.assertEqual(self.make_runner(only="2").run()["succeeded"], 1)
        self.assertEqual(len(self.remote.model_posts), 3)

    def test_increasing_candidates_only_generates_new_dependency_chain(self):
        self.make_runner().run()
        self.assertEqual(self.make_runner(candidates=2).run()["succeeded"], 4)
        self.assertEqual(len(self.remote.model_posts), 6)

    def test_changed_source_and_effect_reruns_invalidate_only_same_candidate(self):
        batch = self.make_runner(candidates=2)
        batch.run()
        old_main = copy.deepcopy(batch.candidate_entry("arbitrary/id:one", 1))
        old_sound = copy.deepcopy(batch.sound_runner.candidate_entry("arbitrary/id:one", 1))
        rerun = self.make_runner(candidates=2, rerun_candidates="1:2")
        rerun.run()
        self.assertEqual(len(self.remote.model_posts), 9)
        self.assertEqual(rerun.candidate_entry("arbitrary/id:one", 1), old_main)
        self.assertEqual(rerun.sound_runner.candidate_entry("arbitrary/id:one", 1), old_sound)
        self.make_runner(candidates=2, only="2", rerun_asmr_candidates="2:1").run()
        self.assertEqual(len(self.remote.model_posts), 11)

    def test_post_change_rerenders_mixed_main_but_not_source_or_effect(self):
        batch = self.make_runner(concat=True)
        batch.run()
        source = copy.deepcopy(batch.candidate_entry("second"))
        sound = copy.deepcopy(batch.sound_runner.candidate_entry("arbitrary/id:one"))
        self.manifest["shots"][1]["asmrSound"]["postProcessing"]["gainDb"] = -12
        self.save_manifest()
        updated = self.make_runner(concat=True)
        updated.run()
        self.assertEqual(len(self.remote.model_posts), 4)
        self.assertEqual(updated.candidate_entry("second"), source)
        self.assertEqual(updated.sound_runner.candidate_entry("arbitrary/id:one"), sound)
        self.manifest["shots"][0]["asmrSound"]["postProcessing"]["gainDb"] = -15
        self.save_manifest()
        self.make_runner(concat=True).run()
        self.assertEqual(len(self.remote.model_posts), 5)  # X now sets the audible reference level for X+1.

    def test_noncontinuing_speech_keeps_voice_only_and_legacy_enhanced_overlay(self):
        del self.manifest["shots"][1]["asmrSound"]["referenceShotId"]
        self.save_manifest()
        batch = self.make_runner(concat=True)
        batch.run()
        main = self.graph(batch, "arbitrary/id:one")
        self.assertEqual(main["11"]["inputs"]["audio"], ["24", 0])
        effect = self.graph(batch.sound_runner, "arbitrary/id:one")
        self.assertNotIn("ref_audios.ref_audio_0", effect["22"]["inputs"])
        enhanced = batch.state["asmrPreviews"]["1"]
        graph = json.loads(batch.state_file(enhanced["payload"]).read_text())["prompt"]
        self.assertEqual(graph["preview_asmr_mixed_1"]["inputs"]["audio1"], ["preview_padded_1", 0])

    def test_only_existing_silent_runs_no_sound_and_can_reuse_complete_previews(self):
        batch = self.make_runner(concat=True)
        batch.run()
        previews = copy.deepcopy(batch.state["asmrPreviews"])
        updated = self.make_runner(only="1", concat=True)
        result = updated.run()
        self.assertEqual(result["asmr_succeeded"], 0)
        self.assertEqual(result["asmr_preview_failed"], 0)
        self.assertEqual(updated.state["asmrPreviews"], previews)
        self.assertEqual(len(self.remote.model_posts), 3)

    def test_audio_continuity_is_independent_of_visual_new_shot(self):
        self.manifest["shots"][1]["referenceMode"] = "new"
        self.save_manifest()
        batch = self.make_runner()
        batch.run()
        graph = self.graph(batch, "arbitrary/id:one")
        self.assertNotIn("900", graph)
        self.assertIn("action_mixed_audio", graph)

    def test_corrupt_or_changed_source_refuses_direct_use_and_stale_preview(self):
        batch = self.make_runner()
        batch.run()
        source = batch.candidate_entry("second")
        batch.state_file(source["output"]).write_bytes(b"tampered")
        with self.assertRaisesRegex(runner.BatchError, "上一无台词段"):
            batch.main_facts(batch.shots[1])
        self.assertEqual(batch.concat_preview(), "unavailable")
        self.assertEqual(batch.concat_preview(with_asmr=True), "unavailable")
        updated = self.make_runner(only="2")
        updated.run()
        self.assertEqual(len(self.remote.model_posts), 3)

    def test_dry_payloads_have_explicit_unresolved_dependencies_and_no_network(self):
        batch = self.make_runner(dry_run=True, candidates=2)
        with patch.object(batch.client, "request", side_effect=AssertionError("network forbidden")):
            result = batch.run()
        self.assertEqual((len(result["dry_run"]), len(result["asmr_dry_run"])), (4, 2))
        self.assertFalse(self.remote.posts or self.remote.gets)
        for candidate, path in enumerate(result["dry_run"][2:], 1):
            value = json.loads(Path(path).read_text())
            self.assertIsNone(value["_dry_run"]["fingerprint"])
            self.assertEqual(value["_dry_run"]["dependsOn"]["source"]["candidateIndex"], candidate)
            self.assertIn(f"C{candidate:03d}", value["prompt"]["action_effect_audio"]["inputs"]["audio"])
        for path in result["asmr_dry_run"]:
            value = json.loads(Path(path).read_text())
            self.assertIsNone(value["_dry_run"]["fingerprint"])
            self.assertEqual(value["_dry_run"]["dependsOn"]["shotId"], "second")

    def test_action_mode_validation_rejects_invalid_links_and_missing_silent_plan(self):
        original = copy.deepcopy(self.manifest)
        for change in ("missing_plan", "source_role", "target_role", "wrong_ref", "silent_ref", "empty_ref"):
            with self.subTest(change=change):
                self.manifest = copy.deepcopy(original)
                silent, speech = self.manifest["shots"]
                if change == "missing_plan": silent["asmrSound"] = None
                if change == "source_role": silent["asmrSound"]["role"] = "ambience"
                if change == "target_role": speech["asmrSound"]["role"] = "ambience"
                if change == "wrong_ref": speech["asmrSound"]["referenceShotId"] = speech["id"]
                if change == "silent_ref": silent["asmrSound"]["referenceShotId"] = speech["id"]
                if change == "empty_ref": speech["asmrSound"]["referenceShotId"] = ""
                self.save_manifest()
                with self.assertRaises(runner.BatchError): self.make_runner()

    def test_native_override_rewrites_mixed_export_and_mode_switch_restores_history(self):
        self.manifest["shots"][1]["prompt"] = runner.speech_reference_prompt(self.manifest["shots"][1]["prompt"], True)
        self.save_manifest()
        action = self.make_runner()
        action.run()
        before = copy.deepcopy(action.candidate_entry("arbitrary/id:one"))
        native = self.make_runner(silent_audio_mode="native")
        native.run()
        graph = self.graph(native, "arbitrary/id:one")
        self.assertIn("supplied speech track unchanged", graph["22"]["inputs"]["prompt"])
        self.assertNotIn("mixed track", graph["22"]["inputs"]["prompt"])
        self.assertNotIn("never the trigger sounds", graph["22"]["inputs"]["prompt"])
        self.assertNotIn("action_mixed_audio", graph)
        after_native = len(self.remote.model_posts)
        back = self.make_runner()
        back.run()
        self.assertEqual(len(self.remote.model_posts), after_native)
        self.assertEqual(back.candidate_entry("arbitrary/id:one")["fingerprint"], before["fingerprint"])

    def test_old_sound_first_override_keeps_material_filming_out_of_main_pantomime(self):
        self.manifest["silentAudioMode"] = "asmr-first"
        shot = self.manifest["shots"][0]
        shot["prompt"] = runner.silent_reference_prompt(shot["prompt"].replace("Continue gentle tapping on the same wood tray.",
            "S1 performs empty-handed tapping gestures into open air."), True)
        shot["asmrSound"]["prompt"] = (
            "integrated_multimodal_description: [Shot 1] A dedicated close-miked ASMR trigger recording for relaxation and sleep. "
            "One fixed live-action macro or close-up view shows only the specified sound-producing material and the hands or tool needed to operate it. "
            "Soft woody fingertip taps with gentle pauses. Show real physical contact and the small material response that produces each sound, "
            "in a calm, deliberate performance.\n\noverall_soundscape: clear tactile ASMR.\n\nnon_diegetic_music: N/A")
        self.save_manifest()
        for mode in ("native", "action-first"):
            with self.subTest(mode=mode):
                batch = self.make_runner(only="1", silent_audio_mode=mode, dry_run=True)
                payload = json.loads(Path(batch.run()["dry_run"][0]).read_text())["prompt"]
                prompt = payload["22"]["inputs"]["prompt"]
                self.assertNotIn("One fixed live-action macro", prompt)
                self.assertNotIn("Show real physical contact", prompt)
                self.assertNotIn("integrated_multimodal_description", prompt)
                self.assertIn("Soft woody fingertip taps", prompt)
                self.assertIn("descriptions specify acoustic textures only", prompt)
                self.assertIn("S1 performs empty-handed tapping gestures into open air.", prompt)
                self.assertNotIn("ref_audios.ref_audio_0", payload["22"]["inputs"])

    def test_rerun_silent_asmr_has_explicit_main_video_guidance(self):
        for options in ({"rerun_asmr": "1"}, {"rerun_asmr_candidates": "1:1"}):
            with self.subTest(options=options), self.assertRaisesRegex(runner.BatchError, "主视频重做"):
                self.make_runner(**options)

    def test_missing_mix_node_fails_preflight_without_model_submission(self):
        del self.remote.classes[runner.BALANCED_AUDIO_NODE]
        with self.assertRaisesRegex(runner.RemotePreflightError, "AsmrDirectorBalancedSpatialAudio"):
            self.make_runner().run()
        self.assertEqual(len(self.remote.posts), 0)

    def test_h3_preflight_requires_second_standalone_audio_slot(self):
        fields = {key.split(".", 1)[0]: [] for key in json.loads((self.package / "workflow_api.json").read_text())["22"]["inputs"]}
        fields["ref_audios"] = ["COMFY_AUTOGROW_V3", {"template": {"prefix": "ref_audio_", "max": 1}}]
        self.remote.classes["MiniMaxH3ReferenceToVideo"] = {"input": {"required": fields}}
        with self.assertRaisesRegex(runner.RemotePreflightError, "两个独立音频"):
            self.make_runner().run()
        self.assertFalse(self.remote.posts)
        fields["ref_audios"][1]["template"]["max"] = 3
        self.assertEqual(self.make_runner().run()["succeeded"], 2)

    def test_prefetched_source_checks_dual_consumer_before_submitting_new_sidecar(self):
        self.make_runner(only="1").run()
        del self.remote.classes[runner.BALANCED_AUDIO_NODE]
        with self.assertRaisesRegex(runner.RemotePreflightError, runner.BALANCED_AUDIO_NODE):
            self.make_runner(only="2").run()
        self.assertEqual(len(self.remote.model_posts), 1)

    def test_freeform_old_combined_reference_is_replaced_on_mode_switch(self):
        scene = "S1 taps the same tray and speaks. Mouth movements follow <Audio 1>."
        old = scene + "\n\nAudio priority:\n<Audio 1>: fully_copy - Use the entire supplied mixed track of narration and non-vocal ASMR unchanged."
        dual = runner.speech_reference_prompt(old, mixed=True)
        self.assertNotIn("fully_copy", dual)
        self.assertIn("<Audio 2>: partially_copy", dual)
        self.assertEqual(runner.speech_reference_prompt(dual, mixed=True), dual)
        native = runner.speech_reference_prompt(dual)
        self.assertNotIn("<Audio 2>", native)
        self.assertIn(scene, native)

    def test_missing_later_speech_wav_does_not_block_valid_silent_source(self):
        self.manifest["shots"][1]["audio"] = "shots/missing.wav"
        self.save_manifest()
        batch = self.make_runner(retries=0)
        result = batch.run()
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(len(self.remote.model_posts), 1)
        self.assertEqual(batch.candidate_entry("second")["status"], "succeeded")
        self.assertIn("input_error", batch.candidate_entry("arbitrary/id:one"))

    def test_cli_gui_and_fractional_native_duration(self):
        self.assertEqual(runner.parser().parse_args(["x", "--silent-audio-mode", "action-first"]).silent_audio_mode, "action-first")
        self.assertEqual(runner.gui_options({"package": "x", "silent_audio_mode": "先动作，接着边做边说（试验）"})["silent_audio_mode"], "action-first")
        self.manifest["shots"][0]["durationSeconds"] = 3.02
        self.save_manifest()
        batch = self.make_runner(only="1")
        batch.run()
        graph = self.graph(batch, "second")
        self.assertEqual(graph["904"]["inputs"]["duration"], 3.02)
        self.assertEqual(graph["903"]["inputs"]["length"], 73)
        self.assertIsNone(batch.sound_runner.candidate_entry("second"))


if __name__ == "__main__":
    unittest.main()
