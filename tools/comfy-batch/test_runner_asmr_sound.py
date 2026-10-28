"""Per-shot ASMR sidecars, D post-processing and independent dual-preview recovery."""
import copy
import json
import math
from pathlib import Path
import threading
import unittest
from unittest.mock import patch

import test_runner as support

runner = support.runner


class AsmrSoundTests(unittest.TestCase):
    setUpClass = classmethod(lambda cls: support.TEST_ROOT.mkdir(parents=True, exist_ok=True))
    tearDown = support.RunnerTests.tearDown
    save_manifest = support.RunnerTests.save_manifest
    make_runner = support.RunnerTests.make_runner
    publish = support.RunnerTests.publish

    def setUp(self):
        support.RunnerTests.setUp(self)
        for index, shot in enumerate(self.manifest["shots"]):
            shot["asmrSound"] = {"prompt": f"ASMR_SOUND_{index}; gentle fabric, no voices or music.",
                "durationSeconds": 99, "postProcessing": {
                    "start": {"pan": -.5, "distance": "near"}, "end": {"pan": .25, "distance": "close"},
                    "movement": "left_to_right", "gainDb": -9}}
        self.remote.classes.update({"AsmrDirectorSpatialAudio": {}, "AsmrDirectorMixAudio": {}})
        self.save_manifest()

    def test_dry_run_uses_real_audio_duration_and_crops_sound_without_references(self):
        before = runner.file_hash(self.wav)
        batch = self.make_runner(dry_run=True, candidates=2)
        result = batch.run()
        self.assertEqual(len(result["dry_run"]), 4)
        self.assertEqual(len(result["asmr_dry_run"]), 4)
        self.assertFalse(self.remote.gets or self.remote.posts)
        for index, path in enumerate(result["asmr_dry_run"]):
            item = json.loads(Path(path).read_text(encoding="utf-8"))
            graph = item["prompt"]
            duration = 1.625 if index < 2 else 5
            self.assertEqual(item["_dry_run"]["requestedDurationSeconds"], duration)
            self.assertEqual(graph["904"]["inputs"]["duration"], duration)
            self.assertEqual(graph["903"]["inputs"]["length"], math.ceil(duration * 24))
            self.assertEqual(graph["11"]["inputs"]["audio"], ["904", 0])
            self.assertFalse(any(key.startswith("ref_audios") or key.startswith("ref_images") for key in graph["22"]["inputs"]))
            self.assertNotIn("20", graph)
            self.assertNotIn("24", graph)
            self.assertNotIn("901", graph)
        self.assertEqual(runner.file_hash(self.wav), before)

    def test_dual_outputs_align_each_sound_and_resume_without_gpu_repeats(self):
        batch = self.make_runner(concat=True, candidates=2)
        result = batch.run()
        self.assertEqual(result["succeeded"], 4)
        self.assertEqual(result["asmr_succeeded"], 4)
        self.assertEqual(result["asmr_failed"], 0)
        self.assertEqual(result["preview_failed"], 0)
        self.assertEqual(result["asmr_preview_failed"], 0)
        self.assertEqual(len(self.remote.model_posts), 8)
        self.assertEqual(len(self.remote.preview_posts), 4)
        for candidate in (1, 2):
            self.assertEqual(batch.state["previews"][str(candidate)]["output"], f"preview-c{candidate:03d}.mp4")
            mixed = batch.state["asmrPreviews"][str(candidate)]
            self.assertEqual(mixed["output"], f"preview-asmr-c{candidate:03d}.mp4")
            graph = json.loads(batch.state_file(mixed["payload"]).read_text())["prompt"]
            for index, duration in enumerate((1.625, 5)):
                node = graph[f"preview_asmr_spatial_{index}"]
                self.assertEqual(node["class_type"], "AsmrDirectorSpatialAudio")
                self.assertEqual(node["inputs"]["duration_seconds"], duration)
                self.assertEqual(node["inputs"]["gain_db"], -9)
                self.assertEqual(graph[f"preview_asmr_mixed_{index}"]["inputs"]["audio1"], [f"preview_padded_{index}", 0])
            self.assertEqual(graph["preview_audio_concat_1"]["inputs"], {
                "audio1": ["preview_asmr_mixed_0", 0], "audio2": ["preview_asmr_mixed_1", 0], "direction": "after"})
        self.assertEqual(self.make_runner(concat=True, candidates=2).run()["asmr_succeeded"], 4)
        self.assertEqual(len(self.remote.posts), 12)

    def test_changing_only_spatial_settings_reuses_all_video_and_original_preview(self):
        first = self.make_runner(concat=True)
        first.run()
        original = copy.deepcopy(first.state["previews"])
        self.manifest["shots"][0]["asmrSound"]["postProcessing"]["gainDb"] = -3
        self.save_manifest()
        second = self.make_runner(concat=True)
        second.run()
        self.assertEqual(len(self.remote.model_posts), 4)
        self.assertEqual(len(self.remote.preview_posts), 3)
        self.assertEqual(second.state["previews"], original)
        self.assertTrue(first.state_file(first.state["asmrPreviews"]["1"]["output"]).is_file())
        self.manifest["shots"][0]["asmrSound"]["postProcessing"]["gainDb"] = -9
        self.save_manifest()
        self.make_runner(concat=True).run()
        self.assertEqual(len(self.remote.posts), 7)

    def test_changing_sound_prompt_only_regenerates_that_sound(self):
        first = self.make_runner()
        first.run()
        original = copy.deepcopy(first.state["shots"])
        self.manifest["shots"][0]["asmrSound"]["prompt"] = "New paper rustle; no voices or music."
        self.save_manifest()
        second = self.make_runner()
        second.run()
        self.assertEqual(len(self.remote.model_posts), 5)
        self.assertEqual(second.state["shots"], original)

    def test_missing_d_nodes_preserves_original_and_all_generated_sources(self):
        self.remote.classes.pop("AsmrDirectorSpatialAudio")
        batch = self.make_runner(concat=True)
        result = batch.run()
        self.assertEqual(result["succeeded"], 2)
        self.assertEqual(result["asmr_succeeded"], 2)
        self.assertEqual(result["preview_failed"], 0)
        self.assertEqual(result["asmr_preview_failed"], 1)
        self.assertEqual(len(self.remote.model_posts), 4)
        self.remote.classes["AsmrDirectorSpatialAudio"] = {}
        self.assertEqual(self.make_runner(concat=True).run()["asmr_preview_failed"], 0)
        self.assertEqual(len(self.remote.model_posts), 4)

    def test_missing_shot_plan_does_not_fake_complete_mixed_preview(self):
        self.manifest["shots"][1].pop("asmrSound")
        self.save_manifest()
        batch = self.make_runner(concat=True)
        result = batch.run()
        self.assertEqual(result["asmr_succeeded"], 1)
        self.assertEqual(result["preview_failed"], 0)
        self.assertEqual(result["asmr_preview_failed"], 1)
        self.assertIn("缺少 ASMR", batch.state["asmrPreviews"]["1"]["last_error"])

    def test_missing_wav_records_one_sound_error_and_continues_valid_shots_then_resumes(self):
        original_audio = self.manifest["shots"][0]["audio"]
        self.manifest["shots"][0]["audio"] = "shots/missing.wav"
        self.save_manifest()
        first = self.make_runner(concat=True)
        result = first.run()
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(result["asmr_succeeded"], 1)
        self.assertEqual(result["asmr_failed"], 1)
        self.assertEqual(result["asmr_preview_failed"], 1)
        self.assertEqual(set(first.state["asmrRun"]["inputErrors"]), {self.manifest["shots"][0]["id"]})
        self.assertEqual(len(self.remote.model_posts), 2)
        self.assertEqual([shot["id"] for shot in first.sound_runner.shots], ["second"])
        self.assertEqual(first.sound_runner.shots[0]["durationSeconds"], 5)
        self.assertFalse(self.remote.preview_posts)
        self.manifest["shots"][0]["audio"] = original_audio
        self.save_manifest()
        second = self.make_runner(concat=True)
        restored = second.run()
        self.assertEqual(restored["asmr_succeeded"], 2)
        self.assertEqual(restored["asmr_failed"], 0)
        self.assertEqual(restored["asmr_preview_failed"], 0)
        self.assertEqual(second.state["asmrRun"]["inputErrors"], {})
        self.assertEqual(len(self.remote.model_posts), 4)

    def test_only_does_not_probe_an_unselected_bad_wav(self):
        self.manifest["shots"][0]["audio"] = "shots/missing.wav"
        self.save_manifest()
        original = runner.shot_facts
        def measured(root, shot, *args):
            self.assertEqual(shot["id"], "second", "--only probed an unrelated WAV")
            return original(root, shot, *args)
        with patch.object(runner, "shot_facts", side_effect=measured):
            batch = self.make_runner(only="2")
            result = batch.run()
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(result["asmr_succeeded"], 1)
        self.assertEqual(result["asmr_failed"], 0)
        self.assertEqual(batch.state["asmrRun"]["inputErrors"], {})
        self.assertEqual(len(self.remote.model_posts), 2)

    def test_only_can_reuse_other_completed_sounds_for_a_full_preview(self):
        self.make_runner(concat=True).run()
        self.manifest["shots"][1]["asmrSound"]["postProcessing"]["gainDb"] = -3
        self.save_manifest()
        batch = self.make_runner(only="2", concat=True)
        result = batch.run()
        self.assertEqual(result["asmr_succeeded"], 1)
        self.assertEqual(result["asmr_preview_failed"], 0)
        self.assertEqual(len(self.remote.model_posts), 4)
        self.assertEqual(len(self.remote.preview_posts), 3)

    def test_missing_wav_preserves_an_unknown_sound_job_until_source_recovery(self):
        self.make_runner().run()
        self.remote.behavior = "unknown"
        pending = self.make_runner(only="1", rerun_asmr="1")
        pending.run()
        pending_entry = copy.deepcopy(pending.sound_runner.candidate_entry(self.manifest["shots"][0]["id"]))
        before = len(self.remote.model_posts)
        original_audio = self.manifest["shots"][0]["audio"]
        self.manifest["shots"][0]["audio"] = "shots/missing.wav"
        self.save_manifest()
        missing = self.make_runner()
        missing.run()
        saved = json.loads((missing.output / "asmr/outputs/run-state.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["shots"][self.manifest["shots"][0]["id"]]["candidates"]["1"], pending_entry)
        self.assertEqual(len(self.remote.model_posts), before)
        self.manifest["shots"][0]["audio"] = original_audio
        self.save_manifest()
        self.assertEqual(self.make_runner(only="1", rerun_asmr="1").run()["asmr_failed"], 1)
        self.assertEqual(len(self.remote.model_posts), before)

    def test_unknown_sound_task_is_not_resubmitted_on_rerun(self):
        self.make_runner().run()
        self.remote.behavior = "unknown"
        first = self.make_runner(only="1", rerun_asmr="1")
        self.assertEqual(first.run()["asmr_failed"], 1)
        before = len(self.remote.model_posts)
        self.assertEqual(self.make_runner(only="1", rerun_asmr="1").run()["asmr_failed"], 1)
        self.assertEqual(len(self.remote.model_posts), before)

    def test_explicit_sound_rerun_leaves_main_video_and_other_candidates_intact(self):
        self.make_runner(candidates=2).run()
        batch = self.make_runner(candidates=2, rerun_asmr_candidates="1:2")
        self.assertEqual(batch.run()["asmr_succeeded"], 4)
        self.assertEqual(len(self.remote.model_posts), 9)
        self.assertEqual(batch.sound_runner.candidate_entry(batch.shots[0]["id"], 2)["generation"], 1)
        self.assertEqual(batch.candidate_entry(batch.shots[0]["id"], 2)["generation"], 0)

    def test_trim_short_duration_never_requests_more_frames_than_generated(self):
        shot = {"kind": "ambient", "durationSeconds": .22, "trimToDuration": True}
        facts = runner.shot_facts(self.package, shot, runner.TEXT_TO_VIDEO)
        self.assertEqual(facts["target_frames"], 6)
        self.assertGreaterEqual(facts["generation_frames"], 6)
        # A reference empty shot was already floored to video frames by the old
        # runner; its sidecar must follow that effective time, not extend it.
        main = runner.shot_facts(self.package, {"kind": "ambient", "durationSeconds": .22})
        self.assertEqual(runner.sound_duration(main), 5 / 24)

    def test_stop_during_sound_task_resumes_accepted_job_without_repeat(self):
        stop = threading.Event()
        def status(event):
            if event.get("task_kind") == "asmr" and event.get("phase") == "submitting":
                self.remote.behavior = "queued"
            if event.get("task_kind") == "asmr" and event.get("phase") == "running":
                stop.set()
        first = self.make_runner(stop_event=stop, status_callback=status)
        first.run()
        self.assertTrue(stop.is_set())
        before = len(self.remote.model_posts)
        self.assertEqual(before, 3)
        self.remote.record("prompt-3", self.remote.posts[-1])
        self.remote.pending.clear()
        self.remote.behavior = "success"
        result = self.make_runner().run()
        self.assertEqual(result["asmr_succeeded"], 2)
        self.assertEqual(len(self.remote.model_posts), 4)

    def test_reject_invalid_post_processing_before_submission(self):
        for change in (lambda x: x.update(gainDb=float("nan")), lambda x: x.update(movement="jump"),
                       lambda x: x["start"].update(pan=2), lambda x: x["end"].update(distance="outside")):
            manifest = copy.deepcopy(self.manifest)
            change(manifest["shots"][0]["asmrSound"]["postProcessing"])
            (self.package / "project.json").write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaises(runner.BatchError):
                self.make_runner()
        self.assertFalse(self.remote.posts)


if __name__ == "__main__":
    unittest.main()
