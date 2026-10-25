"""Native H3 ASMR clips share batch recovery without reference-media processing."""
import copy
import hashlib
import io
import json
from pathlib import Path
import threading
import unittest
from unittest import mock

import test_runner as support

runner = support.runner


class TextToVideoTests(unittest.TestCase):
    setUpClass = classmethod(lambda cls: support.TEST_ROOT.mkdir(parents=True, exist_ok=True))
    tearDown = support.RunnerTests.tearDown
    save_manifest = support.RunnerTests.save_manifest
    make_runner = support.RunnerTests.make_runner
    publish = support.RunnerTests.publish

    def setUp(self):
        support.RunnerTests.setUp(self)
        self.reference_manifest = copy.deepcopy(self.manifest)
        self.reference_template = json.loads((self.package / "workflow_api.json").read_text())
        self.manifest.pop("characterReference")
        self.manifest["generationMode"] = "text-to-video"
        for shot in self.manifest["shots"]:
            shot.update(kind="ambient", referenceMode="new", durationSeconds=5)
            shot.pop("audio", None)
        self.save_manifest()
        # These active nodes/links match the supplied 文生视频 UI workflow after
        # flattening its prompt/length primitives and renaming SaveVideo 24→26.
        self.template = copy.deepcopy(self.reference_template)
        for node_id in ("20", "24"):
            self.template.pop(node_id)
        self.template["21"] = {"class_type": "ResolutionSelector", "inputs": {
            "aspect_ratio": "9:16 (Portrait Widescreen)", "megapixels": 1, "multiple": 32}}
        reference = self.template["22"]["inputs"]
        for name in list(reference):
            if name.startswith("ref_") and name != "ref_image_size":
                reference.pop(name)
        reference.update(width=["21", 0], height=["21", 1], length=124, prompt="")
        self.template["11"]["inputs"]["audio"] = ["4", 0]
        self.save_template()
        (self.package / "references" / "character.png").unlink()
        self.wav.unlink()
        self.remote.classes = {node["class_type"]: {} for node in self.template.values()}

    def save_template(self):
        (self.package / "workflow_api.json").write_text(json.dumps(self.template), encoding="utf-8")

    def test_native_batch_needs_no_uploads_or_auxiliary_nodes_and_retains_full_sound(self):
        batch = self.make_runner(candidates=2)
        self.assertEqual(batch.run()["succeeded"], 4)
        self.assertFalse(self.remote.uploads)
        self.assertFalse(self.tails)
        self.assertEqual(len(self.remote.posts), 4)
        for body in self.remote.posts:
            graph = body["prompt"]
            self.assertEqual(graph["11"]["inputs"], self.template["11"]["inputs"])
            self.assertEqual(graph["22"]["inputs"]["width"], ["21", 0])
            self.assertEqual(graph["22"]["inputs"]["height"], ["21", 1])
            self.assertEqual(graph["21"], self.template["21"])
            self.assertEqual(graph["22"]["inputs"]["length"], 124)
            self.assertNotIn(runner.CONTINUITY, graph["22"]["inputs"]["prompt"])
            self.assertEqual(set(graph), set(self.template))
        for receipt in self.publishes:
            self.assertEqual(receipt["target_frames"], 124)
            self.assertEqual(receipt["target_duration"], 124 / 24)
            self.assertEqual(receipt["source_duration"], 5)
            self.assertIsNone(receipt["audio_sha256"])
        for shot in batch.shots:
            for candidate in (1, 2):
                receipt = batch.candidate_entry(shot["id"], candidate)
                content = (batch.output / receipt["output"]).read_bytes()
                self.assertEqual(content, b"mock-video-content:" + receipt["prompt_id"].encode() + b".mp4")
                self.assertNotIn("tail", receipt)

    def test_dry_run_has_native_duration_no_placeholders_and_stable_candidates(self):
        batch = self.make_runner(candidates=3, dry_run=True)
        paths = batch.run()["dry_run"]
        self.assertEqual(len(paths), 6)
        payloads = [json.loads(Path(path).read_text(encoding="utf-8")) for path in paths]
        self.assertFalse(self.remote.gets or self.remote.posts or self.remote.uploads)
        self.assertEqual(len({value["_dry_run"]["seed"] for value in payloads}), 6)
        for payload in payloads:
            self.assertEqual(payload["_dry_run"]["targetDurationSeconds"], 124 / 24)
            self.assertNotIn("__CHARACTER", json.dumps(payload))
            self.assertIn("文生视频", payload["_dry_run"]["note"])
        repeated = self.make_runner(candidates=3, dry_run=True).run()["dry_run"]
        self.assertEqual(payloads, [json.loads(Path(path).read_text(encoding="utf-8")) for path in repeated])

    def test_candidate_increase_resume_and_explicit_rerun_keep_existing_results(self):
        first = self.make_runner(candidates=2)
        self.assertEqual(first.run()["succeeded"], 4)
        old = copy.deepcopy(first.state)
        second = self.make_runner(candidates=3)
        self.assertEqual(second.run()["succeeded"], 6)
        self.assertEqual(len(self.remote.posts), 6)
        for shot in second.shots:
            for candidate in (1, 2):
                self.assertEqual(second.candidate_entry(shot["id"], candidate),
                                 old["shots"][shot["id"]]["candidates"][str(candidate)])
        third = self.make_runner(candidates=3, rerun_candidates="1:2")
        self.assertEqual(third.run()["succeeded"], 6)
        self.assertEqual(len(self.remote.posts), 7)
        changed = third.candidate_entry(third.shots[0]["id"], 2)
        previous = second.candidate_entry(second.shots[0]["id"], 2)
        self.assertNotEqual(changed["seed"], previous["seed"])
        self.assertTrue((third.output / previous["output"]).is_file())
        self.assertEqual(len(set(support.seeds(self.remote.posts))), 7)

    def test_unknown_submission_is_not_duplicated_even_on_explicit_rerun(self):
        self.remote.behavior = "unknown"
        self.assertEqual(self.make_runner(only="1", retries=3).run()["unknown"], 1)
        self.assertEqual(self.make_runner(only="1", retries=3, rerun_candidates="1:1").run()["unknown"], 1)
        self.assertEqual(len(self.remote.posts), 1)
        self.assertFalse(self.remote.uploads)

    def test_lost_response_and_missing_local_files_recover_original_output(self):
        self.remote.behavior = "lost_response"
        first = self.make_runner(only="1")
        self.assertEqual(first.run()["succeeded"], 1)
        receipt = first.candidate_entry(first.shots[0]["id"])
        (first.output / receipt["output"]).unlink()
        (first.output / "raw" / (receipt["submission_id"] + ".mp4")).unlink()
        second = self.make_runner(only="1")
        self.assertEqual(second.run()["succeeded"], 1)
        self.assertEqual(len(self.remote.posts), 1)
        self.assertEqual(second.candidate_entry(second.shots[0]["id"])["output_sha256"], receipt["output_sha256"])

    def test_explicit_failures_retry_same_seed_and_stop_resume_does_not_duplicate(self):
        self.remote.fail_posts = {1}
        first = self.make_runner(only="1")
        self.assertEqual(first.run()["succeeded"], 1)
        self.assertEqual(support.seeds(self.remote.posts), [2, 2])
        self.remote.behavior = "queued"
        stop = threading.Event()
        def status(value):
            if value.get("phase") in ("queued", "running"):
                stop.set()
        second = self.make_runner(only="2", candidates=2, stop_event=stop, status_callback=status)
        self.assertTrue(second.run()["stopped"])
        self.assertEqual(len(self.remote.posts), 3)
        self.remote.record("prompt-3", self.remote.posts[-1])
        self.remote.pending.clear()
        self.remote.behavior = "success"
        resumed = self.make_runner(only="2", candidates=2)
        self.assertEqual(resumed.run()["succeeded"], 2)
        self.assertEqual(len(self.remote.posts), 4)

    def test_dimensions_preserve_selector_unless_explicitly_overridden(self):
        default = self.make_runner(dry_run=True)
        custom = self.make_runner(dry_run=True, width=672, height=1216)
        shot = default.shots[0]
        facts = runner.shot_facts(default.root, shot, default.generation_mode)
        self.assertNotEqual(default.fingerprint(shot, facts), custom.fingerprint(shot, facts))
        payload = json.loads(Path(custom.run()["dry_run"][0]).read_text(encoding="utf-8"))
        self.assertEqual(payload["prompt"]["22"]["inputs"]["width"], 672)
        self.assertEqual(payload["prompt"]["22"]["inputs"]["height"], 1216)
        self.assertNotIn("21", payload["prompt"])
        self.assertIsNone(runner.parser().parse_args([str(self.package)]).width)

    def test_native_frame_alignment_uses_source_rounding_without_legacy_five_second_cap(self):
        shot = {**self.manifest["shots"][0], "durationSeconds": 5.19}
        native = runner.shot_facts(self.package, shot, runner.TEXT_TO_VIDEO)
        self.assertEqual(native["generation_frames"], 141)
        self.assertEqual(native["target_frames"], 141)
        self.assertEqual(native["target_duration"], 141 / 24)
        legacy = runner.shot_facts(self.package, shot)
        self.assertEqual(legacy["generation_frames"], 124)
        self.assertEqual(legacy["target_frames"], 120)

    def test_duration_override_is_memory_only_and_exposes_requested_and_aligned_seconds(self):
        original_manifest = (self.package / "project.json").read_bytes()
        original_template = (self.package / "workflow_api.json").read_bytes()
        logs = []
        batch = self.make_runner(duration_seconds=10, dry_run=True, log=logs.append)
        self.assertEqual([shot["durationSeconds"] for shot in batch.shots], [10, 10])
        self.assertEqual([shot["durationSeconds"] for shot in batch.manifest["shots"]], [5, 5])
        self.assertIsNot(batch.shots, batch.manifest["shots"])
        for path in batch.run()["dry_run"]:
            payload = json.loads(Path(path).read_text(encoding="utf-8"))
            self.assertEqual(payload["_dry_run"]["requestedDurationSeconds"], 10)
            self.assertEqual(payload["_dry_run"]["targetDurationSeconds"], 10.125)
            self.assertEqual(payload["prompt"]["22"]["inputs"]["length"], 243)
            self.assertEqual(payload["prompt"]["11"]["inputs"]["audio"], ["4", 0])
        self.assertEqual([shot["prompt"] for shot in batch.shots], [shot["prompt"] for shot in self.manifest["shots"]])
        self.assertTrue(any("请求 10 秒，对齐后 10.125 秒" in message for message in logs))
        self.assertEqual((self.package / "project.json").read_bytes(), original_manifest)
        self.assertEqual((self.package / "workflow_api.json").read_bytes(), original_template)
        self.assertFalse(self.remote.gets or self.remote.posts)

    def test_per_shot_durations_and_blank_override_keep_default_identity(self):
        self.manifest["shots"][0]["durationSeconds"] = 8
        self.manifest["shots"][1]["durationSeconds"] = 10
        self.save_manifest()
        default = self.make_runner(dry_run=True)
        blank = self.make_runner(dry_run=True, duration_seconds=None)
        for shot in default.shots:
            facts = runner.shot_facts(default.root, shot, runner.TEXT_TO_VIDEO)
            self.assertEqual(default.fingerprint(shot, facts), blank.fingerprint(shot, facts))
        payloads = [json.loads(Path(path).read_text(encoding="utf-8")) for path in default.run()["dry_run"]]
        self.assertEqual([value["prompt"]["22"]["inputs"]["length"] for value in payloads], [192, 243])
        self.assertEqual([value["_dry_run"]["requestedDurationSeconds"] for value in payloads], [8, 10])

    def test_duration_change_renders_new_candidates_and_round_trip_restores_history(self):
        first = self.make_runner(only="1", candidates=2)
        self.assertEqual(first.run()["succeeded"], 2)
        original = copy.deepcopy(first.state)
        second = self.make_runner(only="1", candidates=2, duration_seconds=10)
        self.assertEqual(second.run()["succeeded"], 2)
        self.assertEqual(len(self.remote.posts), 4)
        changed = copy.deepcopy(second.state)
        restored = self.make_runner(only="1", candidates=2, duration_seconds=5)
        self.assertEqual(restored.run()["succeeded"], 2)
        self.assertEqual(len(self.remote.posts), 4)
        shot_id = restored.shots[0]["id"]
        for index in (1, 2):
            before = original["shots"][shot_id]["candidates"][str(index)]
            after = changed["shots"][shot_id]["candidates"][str(index)]
            current = restored.candidate_entry(shot_id, index)
            self.assertNotEqual(before["fingerprint"], after["fingerprint"])
            self.assertEqual(current["output_sha256"], before["output_sha256"])
            self.assertEqual(current["fingerprint"], before["fingerprint"])
            self.assertTrue((restored.output / after["output"]).is_file())

    def test_invalid_duration_fails_before_network_or_arithmetic_overflow(self):
        for value in (0, -1, float("nan"), float("inf"), 1e308, 10 ** 400, 150, 149.7, True, "bad"):
            with self.subTest(value=str(value)[:30]), self.assertRaises(runner.BatchError):
                self.make_runner(duration_seconds=value)
        for value in (1e308, 10 ** 400, 150):
            self.manifest["shots"][0]["durationSeconds"] = value
            self.save_manifest()
            with self.subTest(manifest=str(value)[:30]), self.assertRaises(runner.BatchError):
                self.make_runner()
        self.assertEqual(runner.native_duration_frames(3592 / 24)[1], 3592)
        self.assertEqual(runner.native_duration_frames(.01)[1], 5)
        self.assertFalse(self.remote.gets or self.remote.posts or self.remote.uploads)

    def test_gui_and_cli_duration_are_optional_or_finite_positive(self):
        self.assertIsNone(runner.gui_options({"package": "project", "duration_seconds": "  "})["duration_seconds"])
        self.assertEqual(runner.gui_options({"package": "project", "duration_seconds": " 10.5 "})["duration_seconds"], 10.5)
        self.assertIsNone(runner.parser().parse_args(["project"]).duration_seconds)
        self.assertEqual(runner.parser().parse_args(["project", "--duration-seconds", "10.5"]).duration_seconds, 10.5)
        for value in ("0", "-1", "nan", "inf", "1e308", "150", "bad"):
            with self.subTest(gui=value), self.assertRaises(runner.BatchError):
                runner.gui_options({"package": "project", "duration_seconds": value})
            with self.subTest(cli=value), mock.patch("sys.stderr", new=io.StringIO()), self.assertRaises(SystemExit):
                runner.parser().parse_args(["project", "--duration-seconds", value])

    def test_duration_override_rejects_reference_packages_without_changing_audio_semantics(self):
        self.manifest = self.reference_manifest
        self.save_manifest()
        self.template = self.reference_template
        self.save_template()
        with self.assertRaisesRegex(runner.BatchError, "仅支持文生视频"):
            self.make_runner(duration_seconds=10)
        self.assertFalse(self.remote.gets or self.remote.posts or self.remote.uploads)

    def test_reference_mode_retains_original_v1_fingerprint_and_defaults(self):
        self.manifest = self.reference_manifest
        self.save_manifest()
        self.template = self.reference_template
        self.save_template()
        image = self.package / "references" / "character.png"
        image.write_bytes(b"synthetic-character")
        batch = self.make_runner(dry_run=True)
        shot = batch.shots[1]
        facts = runner.shot_facts(batch.root, shot)
        identity = {"runner": 1, "kind": shot["kind"], "id": shot["id"], "order": shot["order"],
                    "referenceMode": shot["referenceMode"], "prompt": shot["prompt"], "durationSeconds": 5.0,
                    "audio": None, "character": runner.file_hash(image), "template": batch.template_sha,
                    "width": 1216, "height": 672, "seed": 1}
        expected = hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        self.assertEqual(batch.fingerprint(shot, facts), expected)
        self.assertEqual(facts["target_frames"], 120)
        graph = runner.build_graph(batch.template, shot, facts, "character.png")
        self.assertEqual(graph["11"]["inputs"]["audio"], ["904", 0])
        self.assertIn("902", graph)

    def test_reference_metadata_or_direct_template_overrides_are_rejected_before_network(self):
        original = copy.deepcopy(self.manifest)
        for mutation in ({"kind": "speech"}, {"referenceMode": "continuous"},
                         {"audio": "missing.wav"}, {"characterReference": "missing.png"}):
            with self.subTest(mutation=mutation):
                self.manifest = copy.deepcopy(original)
                self.manifest["shots"][0].update(mutation)
                self.save_manifest()
                with self.assertRaises(runner.BatchError):
                    self.make_runner()
        self.manifest = copy.deepcopy(original)
        self.manifest["characterReference"] = "missing.png"
        self.save_manifest()
        with self.assertRaises(runner.BatchError):
            self.make_runner()
        self.manifest = original
        self.save_manifest()
        with self.assertRaises(runner.BatchError):
            self.make_runner(character_image="missing.png")
        for field, value in (("audio", None), ("fps", 30)):
            original_value = self.template["11"]["inputs"][field]
            self.template["11"]["inputs"][field] = value
            self.save_template()
            with self.assertRaises(runner.BatchError):
                self.make_runner()
            self.template["11"]["inputs"][field] = original_value
        self.assertFalse(self.remote.gets or self.remote.posts or self.remote.uploads)

    def test_native_concat_is_explicitly_unavailable_and_default_gui_finds_sibling_project(self):
        batch = self.make_runner(concat=True)
        self.assertEqual(batch.run()["succeeded"], 2)
        self.assertEqual(batch.state["preview"]["status"], "unavailable")
        self.assertEqual(len(self.remote.posts), 2)
        with mock.patch.object(runner, "__file__", str(self.package / "runner.py")):
            self.assertEqual(runner.gui_default_package(), str(self.package.resolve()))
        with mock.patch.object(runner, "__file__", str(self.root / "runner.py")):
            self.assertEqual(runner.gui_default_package(), "")


if __name__ == "__main__":
    unittest.main()
