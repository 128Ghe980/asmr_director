"""Frame presets preserve old identities and apply to both video lanes."""
import copy
import io
import json
from pathlib import Path
import unittest
from unittest import mock

import test_runner as support
import test_runner_text_to_video as native

runner = support.runner


class AspectRatioTests(unittest.TestCase):
    setUpClass = classmethod(lambda cls: support.TEST_ROOT.mkdir(parents=True, exist_ok=True))
    setUp = support.RunnerTests.setUp
    tearDown = support.RunnerTests.tearDown
    save_manifest = support.RunnerTests.save_manifest
    make_runner = support.RunnerTests.make_runner
    publish = support.RunnerTests.publish

    def add_sound(self):
        for shot in self.manifest["shots"]:
            shot["asmrSound"] = {"prompt": "Soft taps, no speech or music.", "postProcessing": {
                "start": {"pan": 0, "distance": "near"}, "end": {"pan": 0, "distance": "near"},
                "movement": "static", "gainDb": -9}}
        self.save_manifest()
        self.remote.classes.update({"AsmrDirectorSpatialAudio": {}, "AsmrDirectorMixAudio": {}})

    def test_manifest_portrait_applies_to_main_and_sound_without_rewriting_sources(self):
        self.add_sound()
        self.manifest["aspectRatio"] = "portrait"
        self.save_manifest()
        before = {name: runner.file_hash(self.package / name) for name in ("project.json", "workflow_api.json")}
        batch = self.make_runner(dry_run=True)
        result = batch.run()
        for path in result["dry_run"] + result["asmr_dry_run"]:
            payload = json.loads(Path(path).read_text())
            self.assertEqual(payload["prompt"]["22"]["inputs"]["width"], 672)
            self.assertEqual(payload["prompt"]["22"]["inputs"]["height"], 1216)
            self.assertEqual(payload["_dry_run"]["aspectRatio"], "portrait")
        self.assertEqual(before, {name: runner.file_hash(self.package / name) for name in before})
        self.assertFalse(self.remote.posts or self.remote.gets)

    def test_explicit_workflow_overrides_manifest_and_preserves_original_identity(self):
        original = self.make_runner(dry_run=True)
        shot = original.shots[0]
        facts = runner.shot_facts(original.root, shot)
        self.manifest["aspectRatio"] = "portrait"
        self.save_manifest()
        portrait = self.make_runner(dry_run=True)
        workflow = self.make_runner(dry_run=True, aspect_ratio="workflow")
        landscape = self.make_runner(dry_run=True, aspect_ratio="landscape")
        self.assertEqual((workflow.width, workflow.height), (1216, 672))
        self.assertEqual(original.fingerprint(shot, facts), workflow.fingerprint(shot, facts))
        self.assertEqual(workflow.fingerprint(shot, facts), landscape.fingerprint(shot, facts))
        self.assertNotEqual(portrait.fingerprint(shot, facts), workflow.fingerprint(shot, facts))

    def test_invalid_ratio_or_conflicting_dimensions_fails_before_network(self):
        for value in ("square", "9:16", "", 1, False, []):
            with self.subTest(value=value), self.assertRaises(runner.BatchError):
                self.make_runner(aspect_ratio=value)
        for values in ({"aspect_ratio": "portrait", "width": 672}, {"aspect_ratio": "landscape", "height": 672}):
            with self.subTest(values=values), self.assertRaisesRegex(runner.BatchError, "不能与"):
                self.make_runner(**values)
        self.manifest["aspectRatio"] = "square"
        self.save_manifest()
        with self.assertRaisesRegex(runner.BatchError, "aspectRatio"):
            self.make_runner()
        self.assertFalse(self.remote.posts or self.remote.gets)

    def test_linked_reference_selector_keeps_pixel_budget_and_both_lanes_linked(self):
        self.add_sound()
        path = self.package / "workflow_api.json"
        graph = json.loads(path.read_text())
        graph["21"] = {"class_type": "ResolutionSelector", "inputs": {
            "aspect_ratio": "9:16 (Portrait Widescreen)", "megapixels": 1, "multiple": 32}}
        graph["22"]["inputs"].update(width=["21", 0], height=["21", 1])
        path.write_text(json.dumps(graph))
        before = runner.file_hash(path)
        result = self.make_runner(dry_run=True, aspect_ratio="landscape").run()
        for payload_path in result["dry_run"] + result["asmr_dry_run"]:
            payload = json.loads(Path(payload_path).read_text())["prompt"]
            self.assertEqual(payload["21"]["inputs"], {"aspect_ratio": "16:9 (Widescreen)", "megapixels": 1, "multiple": 32})
            self.assertEqual(payload["22"]["inputs"]["width"], ["21", 0])
            self.assertEqual(payload["22"]["inputs"]["height"], ["21", 1])
        self.assertEqual(before, runner.file_hash(path))
        # The old default is intentionally unchanged even if an old reference template contains a selector.
        legacy = self.make_runner(dry_run=True).run()["dry_run"][0]
        self.assertEqual(json.loads(Path(legacy).read_text())["prompt"]["22"]["inputs"]["width"], 1216)

    def test_ratio_round_trip_restores_main_sound_and_both_preview_histories(self):
        self.add_sound()
        original = self.make_runner(concat=True)
        first = original.run()
        self.assertEqual((first["succeeded"], first["asmr_succeeded"]), (2, 2))
        before_main = copy.deepcopy(original.state)
        before_sound = copy.deepcopy(original.sound_runner.state)
        portrait = self.make_runner(concat=True, aspect_ratio="portrait")
        second = portrait.run()
        self.assertEqual((second["succeeded"], second["asmr_succeeded"]), (2, 2))
        self.assertEqual(len(self.remote.model_posts), 8)
        count = len(self.remote.posts)
        restored = self.make_runner(concat=True, aspect_ratio="workflow")
        restored.run()
        self.assertEqual(len(self.remote.posts), count)
        for shot in restored.shots:
            self.assertEqual(restored.candidate_entry(shot["id"])["fingerprint"], before_main["shots"][shot["id"]]["candidates"]["1"]["fingerprint"])
            self.assertEqual(restored.sound_runner.candidate_entry(shot["id"])["fingerprint"], before_sound["shots"][shot["id"]]["candidates"]["1"]["fingerprint"])
            self.assertTrue(portrait.state_file(portrait.candidate_entry(shot["id"])["output"]).is_file())
        self.assertEqual(restored.state["previews"]["1"]["fingerprint"], before_main["previews"]["1"]["fingerprint"])
        self.assertEqual(restored.state["asmrPreviews"]["1"]["fingerprint"], before_main["asmrPreviews"]["1"]["fingerprint"])

    def test_ratio_switch_does_not_resubmit_an_unknown_job(self):
        self.remote.behavior = "unknown"
        self.assertEqual(self.make_runner(only="1").run()["unknown"], 1)
        self.assertEqual(self.make_runner(only="1", aspect_ratio="portrait").run()["unknown"], 1)
        self.assertEqual(len(self.remote.model_posts), 1)

    def test_linked_selector_sidecar_hash_and_history_follow_the_selected_ratio(self):
        self.add_sound()
        path = self.package / "workflow_api.json"
        graph = json.loads(path.read_text())
        graph["21"] = {"class_type": "ResolutionSelector", "inputs": {
            "aspect_ratio": "9:16 (Portrait Widescreen)", "megapixels": 1, "multiple": 32}}
        graph["22"]["inputs"].update(width=["21", 0], height=["21", 1])
        path.write_text(json.dumps(graph))
        self.remote.classes["ResolutionSelector"] = {}
        portrait = self.make_runner(aspect_ratio="portrait")
        portrait.run()
        portrait_sidecar_hash = portrait.sound_runner.template_sha
        old = copy.deepcopy(portrait.sound_runner.candidate_entry(portrait.shots[0]["id"]))
        landscape = self.make_runner(aspect_ratio="landscape")
        landscape.run()
        self.assertNotEqual(portrait_sidecar_hash, landscape.sound_runner.template_sha)
        self.assertEqual(len(self.remote.model_posts), 8)
        restored = self.make_runner(aspect_ratio="portrait")
        restored.run()
        self.assertEqual(len(self.remote.model_posts), 8)
        self.assertEqual(restored.sound_runner.template_sha, portrait_sidecar_hash)
        self.assertEqual(restored.sound_runner.candidate_entry(restored.shots[0]["id"])["fingerprint"], old["fingerprint"])

    def test_gui_remembers_per_project_choice_but_dry_run_does_not_write_it(self):
        self.manifest["aspectRatio"] = "portrait"
        self.save_manifest()
        self.assertEqual(runner.gui_aspect_ratio_label(self.package), "竖屏 9:16")
        dry = self.make_runner(dry_run=True, aspect_ratio="landscape")
        runner.save_gui_aspect_ratio(dry, "landscape")
        self.assertFalse((self.package / "runner-settings.json").exists())
        batch = self.make_runner(aspect_ratio="landscape")
        runner.save_gui_aspect_ratio(batch, "landscape")
        self.assertEqual(runner.gui_aspect_ratio_label(self.package), "横屏 16:9")
        runner.save_gui_aspect_ratio(dry, "portrait")
        self.assertEqual(runner.gui_aspect_ratio_label(self.package), "横屏 16:9")
        runner.save_gui_aspect_ratio(batch, None)
        self.assertEqual(runner.gui_aspect_ratio_label(self.package), "按项目 / 原设置")
        self.manifest["projectId"] = "different-project"
        self.save_manifest()
        self.assertEqual(runner.gui_aspect_ratio_label(self.package), "竖屏 9:16")

    def test_cli_and_gui_have_distinct_auto_and_explicit_workflow_values(self):
        self.assertIsNone(runner.parser().parse_args(["package"]).aspect_ratio)
        self.assertEqual(runner.parser().parse_args(["package", "--aspect-ratio", "workflow"]).aspect_ratio, "workflow")
        for label, value in runner.GUI_ASPECT_RATIOS.items():
            self.assertEqual(runner.gui_options({"package": "package", "aspect_ratio": label})["aspect_ratio"], value)
        with self.assertRaises(runner.BatchError):
            runner.gui_options({"package": "package", "aspect_ratio": "invalid"})
        with mock.patch("sys.stderr", new=io.StringIO()), self.assertRaises(SystemExit):
            runner.parser().parse_args(["package", "--aspect-ratio", "invalid"])


class NativeAspectRatioTests(unittest.TestCase):
    setUpClass = classmethod(lambda cls: support.TEST_ROOT.mkdir(parents=True, exist_ok=True))
    setUp = native.TextToVideoTests.setUp
    tearDown = support.RunnerTests.tearDown
    save_manifest = support.RunnerTests.save_manifest
    save_template = native.TextToVideoTests.save_template
    make_runner = support.RunnerTests.make_runner
    publish = support.RunnerTests.publish

    def test_matching_native_preset_keeps_old_identity_and_changed_ratio_restores(self):
        default = self.make_runner(only="1")
        shot = default.shots[0]
        facts = runner.shot_facts(default.root, shot, default.generation_mode)
        matching = self.make_runner(only="1", aspect_ratio="portrait")
        self.assertEqual(default.fingerprint(shot, facts), matching.fingerprint(shot, facts))
        default.run()
        original = copy.deepcopy(default.candidate_entry(shot["id"]))
        landscape = self.make_runner(only="1", aspect_ratio="landscape")
        landscape.run()
        self.assertNotEqual(landscape.candidate_entry(shot["id"])["fingerprint"], original["fingerprint"])
        graph = self.remote.model_posts[-1]["prompt"]
        self.assertEqual(graph["21"]["inputs"]["aspect_ratio"], "16:9 (Widescreen)")
        self.assertEqual(graph["22"]["inputs"]["width"], ["21", 0])
        restored = self.make_runner(only="1", aspect_ratio="portrait")
        restored.run()
        self.assertEqual(len(self.remote.model_posts), 2)
        self.assertEqual(restored.candidate_entry(shot["id"])["fingerprint"], original["fingerprint"])


if __name__ == "__main__":
    unittest.main()
