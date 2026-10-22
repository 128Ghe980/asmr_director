"""Native preview contract tests; no FFmpeg, real ComfyUI, or generated media."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("native_concat_runner", SOURCE / "runner.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)
TEST_ROOT = Path(os.environ.get("ASMR_BATCH_TEST_ROOT", str(Path(tempfile.gettempdir()) / "asmr-comfy-batch-native-concat-tests")))


class NativeComfy:
    def __init__(self):
        self.classes = {name: {} for name in ("LoadVideo", "ConcatenateVideo", "SaveVideo", "CLFLoadVideoTailFrames",
                                             "ComfyMathExpression", "EmptyAudio", "LoadAudio", "AudioMerge", "AudioConcat")}
        self.posts, self.history, self.uploads, self.downloads = [], {}, [], []
        self.pending = []
        self.behavior = "success"
        self.download_failure = False
        self.before_submit = None
        self.after_submit = None
        self.offline = False

    def get(self, route):
        if self.offline:
            raise runner.ApiError("synthetic offline")
        if route == "/object_info":
            return self.classes
        if route.startswith("/history/"):
            prompt_id = route.removeprefix("/history/")
            return {prompt_id: self.history[prompt_id]} if prompt_id in self.history else {}
        if route.startswith("/history?"):
            return self.history
        if route == "/queue":
            return {"queue_running": [], "queue_pending": self.pending}
        raise AssertionError(route)

    def upload(self, path):
        self.uploads.append((str(path), Path(path).read_bytes()))
        return "synthetic/" + Path(path).name

    def complete(self, prompt_id, graph, submission_id, failed=False):
        self.pending = [item for item in self.pending if item[1] != prompt_id]
        self.history[prompt_id] = {
            "prompt": [0, prompt_id, graph, {"asmr_batch_submission_id": submission_id}, ["26"]],
            "status": {"completed": True, "status_str": "error" if failed else "success"},
            "outputs": {} if failed else {"26": {"images": [{
                "filename": prompt_id + ".mp4", "subfolder": "native-preview", "type": "output"}]}}}

    def submit(self, graph, submission_id):
        if self.before_submit:
            self.before_submit(graph, submission_id)
        self.posts.append((copy.deepcopy(graph), submission_id))
        prompt_id = "native-preview-" + str(len(self.posts))
        if self.behavior == "queued":
            self.pending.append([0, prompt_id, graph, {"asmr_batch_submission_id": submission_id}, ["26"]])
        elif self.behavior != "unknown":
            self.complete(prompt_id, graph, submission_id, failed=self.behavior == "failed")
        if self.after_submit:
            self.after_submit()
        if self.behavior in ("lost_response", "unknown"):
            raise runner.ApiError("synthetic lost POST response")
        return prompt_id

    def download(self, locator, target):
        self.downloads.append(copy.deepcopy(locator))
        if self.download_failure:
            raise runner.ApiError("synthetic interrupted download")
        Path(target).parent.mkdir(parents=True, exist_ok=True)
        Path(target).write_bytes(b"original-remote-save-video-bytes:" + locator["filename"].encode())


class NativeConcatTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        TEST_ROOT.mkdir(parents=True, exist_ok=True)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="native-concat-", dir=TEST_ROOT)
        self.package = Path(self.temp.name) / "package"
        self.package.mkdir()
        shutil.copyfile(SOURCE / "workflow_api.json", self.package / "workflow_api.json")
        (self.package / "character.png").write_bytes(b"synthetic-reference")
        self.manifest = {"format": "asmr-video-package", "version": 1, "projectId": "native-preview-test",
                         "title": "Synthetic preview", "workflow": "workflow_api.json", "characterReference": "character.png",
                         "shots": [{"id": "first", "order": 1, "kind": "ambient", "referenceMode": "new", "prompt": "Synthetic first", "durationSeconds": 1},
                                   {"id": "second", "order": 2, "kind": "ambient", "referenceMode": "continuous", "prompt": "Synthetic second", "durationSeconds": 2}]}
        self.write_manifest()
        self.client = NativeComfy()

    def tearDown(self):
        self.temp.cleanup()

    def write_manifest(self):
        (self.package / "project.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def batch(self, **options):
        batch = runner.BatchRunner(self.package, client=self.client, poll_interval=.001, missing_grace=.002,
                                   job_timeout=.015, disconnect_timeout=.005, heartbeat_interval=.002,
                                   log=lambda unused: None, **options)
        batch.load_state()
        return batch

    def ready(self, batch, candidate=1):
        for shot in batch.shots:
            facts = runner.shot_facts(batch.root, shot)
            item = {"status": "succeeded", "generation": 0, "shot_id": shot["id"], "candidate_index": candidate,
                    "fingerprint": batch.fingerprint(shot, facts, candidate, 0), "target_duration": facts["target_duration"]}
            target = batch.output / batch.output_name(shot, item)
            target.write_bytes(f"synthetic-shot:{shot['id']}:candidate:{candidate}:{shot['prompt']}".encode())
            item.update(output=target.name, output_sha256=runner.file_hash(target))
            batch.store_entry(shot["id"], candidate, item)
        batch.save()

    def preview(self, batch, candidate=1):
        return batch.state["previews"][str(candidate)]

    def test_native_graph_preserves_order_and_downloads_original_bytes(self):
        batch = self.batch()
        self.ready(batch)
        shots = copy.deepcopy(batch.state["shots"])

        def check_persisted(graph, submission_id):
            state = json.loads(batch.state_path.read_text())
            receipt = state["previews"]["1"]
            self.assertEqual(receipt["status"], "submitting")
            self.assertEqual(receipt["submission_id"], submission_id)
            self.assertEqual(json.loads(batch.state_file(receipt["payload"]).read_text())["prompt"], graph)
        self.client.before_submit = check_persisted
        self.assertEqual(batch.concat_preview(), "succeeded")
        graph = self.client.posts[0][0]
        concat = graph["concat_0"]["inputs"]
        self.assertEqual(concat, {"videos.video0": ["2000", 0], "videos.video1": ["2001", 0], "codec": "auto",
                                  "complete_audio": ["preview_audio_concat_1", 0]})
        self.assertEqual([graph[str(2000 + i)]["inputs"]["file"] for i in range(2)],
                         ["synthetic/" + batch.candidate_entry(shot["id"])["output"] for shot in batch.shots])
        self.assertEqual(graph["26"]["inputs"]["video"], ["concat_0", 0])
        self.assertEqual(batch.state_file(self.preview(batch)["output"]).read_bytes(), b"original-remote-save-video-bytes:native-preview-1.mp4")
        self.assertEqual(batch.state["shots"], shots)
        self.assertEqual(batch.concat_preview(), "succeeded")
        self.assertEqual(len(self.client.posts), 1)

    def test_audio_padding_uses_actual_remote_frame_counts_and_preserves_clip_order(self):
        batch = self.batch()
        self.ready(batch)
        self.assertEqual(batch.concat_preview(), "succeeded")
        graph = self.client.posts[0][0]
        for index in range(2):
            uploaded = graph[str(2000 + index)]["inputs"]["file"]
            self.assertEqual(graph[f"preview_frames_{index}"], {"class_type": "CLFLoadVideoTailFrames", "inputs": {
                "video_path": uploaded, "n": 1, "x": 0, "order": "chronological", "out_of_range": "error"}})
            self.assertEqual(graph[f"preview_duration_{index}"]["inputs"], {
                "expression": "a / 24", "values.a": [f"preview_frames_{index}", 2]})
            self.assertEqual(graph[f"preview_empty_{index}"]["inputs"], {
                "duration": [f"preview_duration_{index}", 0], "sample_rate": 48000, "channels": 2})
            self.assertEqual(graph[f"preview_audio_{index}"]["inputs"], {"audio": uploaded})
            self.assertEqual(graph[f"preview_padded_{index}"]["inputs"], {
                "audio1": [f"preview_empty_{index}", 0], "audio2": [f"preview_audio_{index}", 0], "merge_method": "add"})
        self.assertEqual(graph["preview_audio_concat_1"]["inputs"], {
            "audio1": ["preview_padded_0", 0], "audio2": ["preview_padded_1", 0], "direction": "after"})
        self.assertFalse(any(node["class_type"] in ("GetVideoComponents", "GetImageSize") for node in graph.values()))
        self.assertEqual(self.preview(batch)["audio_alignment"], "per_clip_frames_24fps")

    def test_single_clip_still_routes_padded_track_through_native_video(self):
        self.manifest["shots"] = self.manifest["shots"][:1]
        self.write_manifest()
        batch = self.batch()
        self.ready(batch)
        self.assertEqual(batch.concat_preview(), "succeeded")
        graph = self.client.posts[0][0]
        self.assertEqual(graph["concat_0"]["inputs"], {
            "videos.video0": ["2000", 0], "codec": "auto", "complete_audio": ["preview_padded_0", 0]})
        self.assertNotIn("preview_audio_concat_1", graph)

    def test_missing_audio_alignment_node_skips_preview_before_upload_or_submit(self):
        batch = self.batch()
        self.ready(batch)
        del self.client.classes["AudioMerge"]
        self.assertEqual(batch.concat_preview(), "unavailable")
        self.assertIn("AudioMerge", self.preview(batch)["last_error"])
        self.assertFalse(self.client.posts)
        self.assertFalse(self.client.uploads)

    def test_invalid_remote_node_catalog_only_makes_preview_unavailable(self):
        batch = self.batch()
        self.ready(batch)
        before = copy.deepcopy(batch.state["shots"])
        self.client.classes = None
        self.assertEqual(batch.concat_preview(), "unavailable")
        self.assertEqual(batch.state["shots"], before)
        self.assertFalse(self.client.posts)

    def test_missing_native_node_is_unavailable_without_touching_shots_or_old_preview(self):
        batch = self.batch()
        self.ready(batch)
        old = batch.output / "preview.mp4"
        old.write_bytes(b"old-preview")
        before = copy.deepcopy(batch.state["shots"])
        del self.client.classes["ConcatenateVideo"]
        self.assertEqual(batch.concat_preview(), "unavailable")
        self.assertIn("ConcatenateVideo", self.preview(batch)["last_error"])
        self.assertEqual(batch.state["shots"], before)
        self.assertEqual(old.read_bytes(), b"old-preview")
        self.assertFalse(self.client.posts)

    def test_lost_submit_response_is_reconciled_by_submission_without_duplicate(self):
        batch = self.batch()
        self.ready(batch)
        self.client.behavior = "lost_response"
        self.assertEqual(batch.concat_preview(), "succeeded")
        resumed = self.batch()
        self.assertEqual(resumed.concat_preview(), "succeeded")
        self.assertEqual(len(self.client.posts), 1)
        self.assertEqual(self.preview(resumed)["prompt_id"], "native-preview-1")

    def test_unknown_preview_stays_unknown_without_duplicate_even_if_shot_changes(self):
        batch = self.batch()
        self.ready(batch)
        self.client.behavior = "unknown"
        self.assertEqual(batch.concat_preview(), "unknown")
        self.manifest["shots"][0]["prompt"] = "Changed while remote identity is unknown"
        self.write_manifest()
        resumed = self.batch()
        self.ready(resumed)
        self.client.behavior = "success"
        self.assertEqual(resumed.concat_preview(), "unknown")
        self.assertEqual(len(self.client.posts), 1)
        self.assertEqual(resumed.state["preview"], self.preview(resumed))

    def test_queued_old_inputs_are_completed_before_new_inputs_submit_and_old_file_is_kept(self):
        batch = self.batch()
        self.ready(batch)
        self.client.behavior = "queued"
        self.assertEqual(batch.concat_preview(), "unknown")
        graph, submission = self.client.posts[0]
        self.client.complete("native-preview-1", graph, submission)
        self.client.behavior = "success"
        self.manifest["shots"][0]["prompt"] = "New completed shot"
        self.write_manifest()
        resumed = self.batch()
        self.ready(resumed)
        self.assertEqual(resumed.concat_preview(), "succeeded")
        receipt = self.preview(resumed)
        self.assertEqual(len(self.client.posts), 2)
        self.assertEqual((resumed.output / "preview.mp4").read_bytes(), b"original-remote-save-video-bytes:native-preview-1.mp4")
        self.assertNotEqual(receipt["output"], "preview.mp4")
        self.assertEqual(receipt["history"][-1]["status"], "succeeded")

    def test_interrupted_download_resumes_offline_without_history_or_second_submit(self):
        batch = self.batch()
        self.ready(batch)
        self.client.download_failure = True
        self.assertEqual(batch.concat_preview(), "downloading")
        self.assertEqual(self.preview(batch)["remote_output"]["filename"], "native-preview-1.mp4")
        self.client.download_failure = False
        self.client.offline = True
        resumed = self.batch()
        self.assertEqual(resumed.concat_preview(), "succeeded")
        self.assertEqual(len(self.client.posts), 1)
        self.assertEqual(resumed.state["preview"], self.preview(resumed))

    def test_stopping_after_post_retains_task_for_recovery_without_duplicate(self):
        batch = self.batch()
        self.ready(batch)
        self.client.after_submit = batch.stop_event.set
        self.assertEqual(batch.concat_preview(), "paused")
        self.assertEqual(self.preview(batch)["prompt_id"], "native-preview-1")
        self.client.after_submit = None
        resumed = self.batch()
        self.assertEqual(resumed.concat_preview(), "succeeded")
        self.assertEqual(len(self.client.posts), 1)

    def test_changed_preview_file_is_preserved_and_redownloaded_without_new_task(self):
        batch = self.batch()
        self.ready(batch)
        self.assertEqual(batch.concat_preview(), "succeeded")
        first = batch.state_file(self.preview(batch)["output"])
        first.write_bytes(b"externally-edited-preview")
        before = first.stat().st_mtime_ns
        resumed = self.batch()
        self.client.offline = True
        self.assertEqual(resumed.concat_preview(), "succeeded")
        self.assertEqual(first.read_bytes(), b"externally-edited-preview")
        self.assertEqual(first.stat().st_mtime_ns, before)
        self.assertNotEqual(self.preview(resumed)["output"], first.name)
        self.assertEqual(len(self.client.posts), 1)

    def test_legacy_success_preview_is_reused_with_no_remote_requirement(self):
        batch = self.batch()
        self.ready(batch)
        identities = [[shot["id"], batch.candidate_entry(shot["id"])["fingerprint"],
                       batch.candidate_entry(shot["id"])["output_sha256"]] for shot in batch.shots]
        preview = batch.output / "preview.mp4"
        preview.write_bytes(b"legacy-ffmpeg-preview")
        receipt = {"status": "succeeded", "fingerprint": runner.hashlib.sha256(json.dumps(identities, ensure_ascii=False).encode()).hexdigest(),
                   "output": "preview.mp4", "output_sha256": runner.file_hash(preview), "shot_count": 2}
        batch.set_preview(1, receipt)
        self.client.offline = True
        self.assertEqual(self.batch().concat_preview(), "succeeded")
        self.assertFalse(self.client.posts)
        self.assertEqual(preview.read_bytes(), b"legacy-ffmpeg-preview")

    def test_explicit_remote_failure_does_not_modify_any_shot(self):
        batch = self.batch()
        self.ready(batch)
        before = copy.deepcopy(batch.state["shots"])
        self.client.behavior = "failed"
        self.assertEqual(batch.concat_preview(), "failed")
        self.assertEqual(batch.state["shots"], before)
        self.assertEqual(self.preview(batch)["status"], "failed")

    def test_each_candidate_has_its_own_native_preview_and_source_videos(self):
        batch = self.batch(candidates=2)
        self.ready(batch, 1)
        self.ready(batch, 2)
        self.assertEqual(batch.concat_preview(1), "succeeded")
        self.assertEqual(batch.concat_preview(2), "succeeded")
        self.assertEqual(self.preview(batch, 1)["output"], "preview-c001.mp4")
        self.assertEqual(self.preview(batch, 2)["output"], "preview-c002.mp4")
        self.assertNotEqual(self.preview(batch, 1)["submission_id"], self.preview(batch, 2)["submission_id"])
        self.assertTrue(all("_c002_" in node["inputs"]["file"] for node in self.client.posts[1][0].values() if node["class_type"] == "LoadVideo"))

    def test_over_one_hundred_shots_chain_native_nodes_without_reordering(self):
        self.manifest["shots"] = [{"id": "shot-" + str(i), "order": i + 1, "kind": "ambient", "referenceMode": "new", "prompt": "Synthetic " + str(i), "durationSeconds": 1} for i in range(101)]
        self.write_manifest()
        batch = self.batch()
        self.ready(batch)
        self.assertEqual(batch.concat_preview(), "succeeded")
        graph = self.client.posts[0][0]
        nodes = [node for node in graph.values() if node["class_type"] == "ConcatenateVideo"]
        self.assertEqual(len(nodes), 2)
        self.assertEqual(graph["concat_0"]["inputs"]["videos.video99"], ["2099", 0])
        self.assertEqual(graph["concat_1"]["inputs"]["videos.video0"], ["concat_0", 0])
        self.assertEqual(graph["concat_1"]["inputs"]["videos.video1"], ["2100", 0])
        self.assertEqual(graph["concat_1"]["inputs"]["complete_audio"], ["preview_audio_concat_100", 0])
        self.assertNotIn("complete_audio", graph["concat_0"]["inputs"])
        self.assertEqual(len([node for node in graph.values() if node["class_type"] == "LoadVideo"]), 101)


if __name__ == "__main__":
    unittest.main()
