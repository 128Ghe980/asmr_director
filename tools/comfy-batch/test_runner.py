import copy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import socket
import struct
import sys
import tempfile
import threading
import unittest
from unittest import mock
import wave

SOURCE = Path(__file__).resolve().parent
TEST_ROOT = Path(os.environ.get("ASMR_BATCH_TEST_ROOT", "I:/AI/asmr-director-video-batch/2026-10-15/runner-tests")) if Path("I:/").is_dir() else Path(tempfile.gettempdir())
SPEC = importlib.util.spec_from_file_location("comfy_batch_runner", SOURCE / "runner.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class FakeComfy:
    def __init__(self):
        self.posts, self.history, self.pending, self.uploads = [], {}, [], []
        self.behavior = "success"
        self.gets = []
        self.classes = {node["class_type"]: {} for node in json.loads((SOURCE / "workflow_api.json").read_text()).values()}
        self.classes["LoadImage"] = {}

    def record(self, prompt_id, body, failed=False):
        self.history[prompt_id] = {"prompt": [1, prompt_id, body["prompt"], body["extra_data"], ["26"]],
                                   "status": {"completed": True, "status_str": "error" if failed else "success"},
                                   "outputs": {} if failed else {"26": {"images": [{"filename": prompt_id + ".mp4", "subfolder": "batch", "type": "output"}]}}}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *unused):
        pass

    def send_json(self, value):
        body = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        state = self.server.state
        state.gets.append(self.path)
        if self.path == "/object_info":
            self.send_json(state.classes)
        elif self.path.startswith("/history/"):
            prompt_id = self.path[len("/history/"):]
            self.send_json({prompt_id: state.history[prompt_id]} if prompt_id in state.history else {})
        elif self.path.startswith("/history"):
            self.send_json(state.history)
        elif self.path == "/queue":
            self.send_json({"queue_running": state.pending, "queue_pending": []})
        elif self.path.startswith("/view?"):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"mock-video-content")
        else:
            self.send_error(404)

    def do_POST(self):
        state = self.server.state
        data = self.rfile.read(int(self.headers["Content-Length"]))
        if self.path == "/upload/image":
            name = re.search(rb'filename="([^"]+)"', data).group(1).decode()
            state.uploads.append(name)
            self.send_json({"name": name, "subfolder": "", "type": "input"})
            return
        if self.path != "/prompt":
            self.send_error(404)
            return
        body = json.loads(data)
        state.posts.append(body)
        prompt_id = "prompt-" + str(len(state.posts))
        prompt = body["prompt"]["22"]["inputs"]["prompt"]
        if state.behavior == "unknown":
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        if state.behavior in ("queued", "queued_lost"):
            state.pending.append([1, prompt_id, body["prompt"], body["extra_data"], ["26"]])
        else:
            state.record(prompt_id, body, failed="FAIL_THIS" in prompt)
        if state.behavior in ("lost_response", "queued_lost"):
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        self.send_json({"prompt_id": prompt_id})


class RunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        TEST_ROOT.mkdir(parents=True, exist_ok=True)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="runner-test-", dir=TEST_ROOT)
        self.root = Path(self.temporary.name)
        self.package = self.root / "package"
        self.package.mkdir()
        (self.package / "references").mkdir()
        (self.package / "references" / "character.png").write_bytes(b"synthetic-character")
        shutil.copyfile(SOURCE / "workflow_api.json", self.package / "workflow_api.json")
        self.wav = self.package / "shots" / "001" / "audio.wav"
        self.wav.parent.mkdir(parents=True)
        with wave.open(str(self.wav), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(8000)
            output.writeframes(struct.pack("<h", 1500) * 13000)  # 1.625 s.
        self.manifest = {"format": "asmr-video-package", "version": 1, "projectId": "mock-project", "title": "合成测试",
                         "characterReference": "references/character.png", "workflow": "workflow_api.json",
                         "shots": [{"id": "arbitrary/id:one", "order": 1, "kind": "speech", "referenceMode": "new", "prompt": "FIRST_SHOT", "durationSeconds": 1, "audio": "shots/001/audio.wav"},
                                   {"id": "second", "order": 2, "kind": "ambient", "referenceMode": "continuous", "prompt": "Room tone; no speech or music.", "durationSeconds": 5}]}
        self.save_manifest()
        self.remote = FakeComfy()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.state = self.remote
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.ffmpeg_patch = mock.patch.object(runner, "run_ffmpeg")
        self.ffmpeg_patch.start()
        self.finishes, self.tails, self.concatenations = [], [], []

    def tearDown(self):
        self.ffmpeg_patch.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temporary.cleanup()

    def save_manifest(self):
        (self.package / "project.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def finish(self, executable, raw, target, entry):
        self.finishes.append(copy.deepcopy(entry))
        Path(target).parent.mkdir(parents=True, exist_ok=True)
        Path(target).write_bytes(Path(raw).read_bytes() + str(entry["target_duration"]).encode())

    def tail(self, executable, previous, target):
        self.tails.append(Path(previous))
        Path(target).write_bytes(b"synthetic-tail")
        return target

    def concatenate(self, executable, clips, target):
        self.concatenations.append(clips)
        Path(target).write_bytes(b"complete-sequential-preview")
        return target

    def make_runner(self, **kwargs):
        package = kwargs.pop("package", self.package)
        options = dict(comfy_url=self.url, ffmpeg=sys.executable, poll_interval=.002, missing_grace=.006,
                       job_timeout=.04, log=lambda unused: None, finish=self.finish, tail_extractor=self.tail,
                       concatenator=self.concatenate)
        options.update(kwargs)
        return runner.BatchRunner(package, **options)

    def test_speech_routes_original_ambient_routes_generated_and_caps_five_seconds(self):
        batch = self.make_runner()
        self.assertEqual(batch.run()["succeeded"], 2)
        speech, ambient = [body["prompt"] for body in self.remote.posts]
        self.assertEqual(speech["11"]["inputs"]["audio"], ["24", 0])
        self.assertEqual(speech["22"]["inputs"]["ref_audios.ref_audio_0"], ["24", 0])
        self.assertNotIn("4", speech)
        self.assertEqual(ambient["11"]["inputs"]["audio"], ["4", 0])
        self.assertNotIn("24", ambient)
        self.assertFalse(any(key.startswith("ref_audios") for key in ambient["22"]["inputs"]))
        self.assertEqual(ambient["22"]["inputs"]["length"], 124)
        self.assertEqual(self.finishes[1]["target_duration"], 5)
        self.assertEqual(self.finishes[0]["source_duration"], 1.625)
        self.assertGreaterEqual(self.finishes[0]["target_duration"], 1.625)
        self.assertLess(self.finishes[0]["target_duration"] - 1.625, 1 / 24 + 1e-9)
        self.assertIn("ref_images.ref_image_1", ambient["22"]["inputs"])
        self.assertEqual(len(self.tails), 1)
        self.assertTrue((self.package / "outputs" / "run-state.json").is_file())
        self.assertEqual(len(list((self.package / "outputs").glob("*.mp4"))), 2)

    def test_resume_skips_success_and_changed_single_shot_does_not_cascade(self):
        self.make_runner().run()
        self.make_runner().run()
        self.assertEqual(len(self.remote.posts), 2)
        self.manifest["shots"][0]["prompt"] = "CHANGED_FIRST"
        self.save_manifest()
        self.make_runner().run()
        self.assertEqual(len(self.remote.posts), 3)
        self.assertEqual(self.remote.posts[-1]["prompt"]["22"]["inputs"]["prompt"], "CHANGED_FIRST")

    def test_explicit_failure_retries_bounded_and_next_shot_runs_independently(self):
        self.manifest["shots"][0]["prompt"] = "FAIL_THIS"
        self.save_manifest()
        batch = self.make_runner()
        result = batch.run()
        self.assertEqual(result["failed"], 1)
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(len(self.remote.posts), 3)
        self.assertNotIn("ref_images.ref_image_1", self.remote.posts[-1]["prompt"]["22"]["inputs"])
        self.assertFalse(self.tails)

    def test_lost_submit_response_is_reconciled_without_duplicate(self):
        self.remote.behavior = "lost_response"
        result = self.make_runner(only="1").run()
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(len(self.remote.posts), 1)
        self.assertTrue(any(path.startswith("/history?") for path in self.remote.gets))

    def test_unknown_submission_is_not_retried_even_when_rerun_requested(self):
        self.remote.behavior = "unknown"
        self.assertEqual(self.make_runner(only="1", retries=3).run()["unknown"], 1)
        self.assertEqual(self.make_runner(only="1", rerun="1", retries=3).run()["unknown"], 1)
        self.assertEqual(len(self.remote.posts), 1)

    def test_queued_prompt_id_recovers_and_finishes_without_new_submission(self):
        self.remote.behavior = "queued_lost"
        first = self.make_runner(only="1")
        self.assertEqual(first.run()["unknown"], 1)
        self.assertEqual(first.state["shots"]["arbitrary/id:one"]["prompt_id"], "prompt-1")
        self.remote.record("prompt-1", self.remote.posts[0])
        self.remote.pending.clear()
        self.assertEqual(self.make_runner(only="1").run()["succeeded"], 1)
        self.assertEqual(len(self.remote.posts), 1)

    def test_final_encoding_failure_resumes_without_regenerating_model(self):
        def fail(*unused):
            raise runner.BatchError("temporary encoder issue")
        first = self.make_runner(only="1", finish=fail)
        self.assertEqual(first.run()["downloading"], 1)
        self.assertEqual(self.make_runner(only="1").run()["succeeded"], 1)
        self.assertEqual(len(self.remote.posts), 1)

    def test_only_and_rerun_and_audio_change(self):
        self.make_runner(only="1").run()
        self.make_runner(only="1", rerun="1").run()
        self.assertEqual(len(self.remote.posts), 2)
        with self.wav.open("r+b") as handle:
            handle.seek(-2, 2)
            handle.write(b"\x01\x00")
        self.make_runner(only="1").run()
        self.assertEqual(len(self.remote.posts), 3)

    def test_dry_run_does_not_connect_and_supports_missing_character(self):
        self.manifest.pop("characterReference")
        self.manifest["shots"][1]["durationSeconds"] = 99
        self.save_manifest()
        batch = self.make_runner(comfy_url="http://127.0.0.1:1", dry_run=True)
        result = batch.run()
        self.assertEqual(len(result["dry_run"]), 2)
        payload = json.loads(Path(result["dry_run"][1]).read_text(encoding="utf-8"))
        self.assertEqual(payload["_dry_run"]["targetDurationSeconds"], 5)
        self.assertEqual(payload["prompt"]["20"]["inputs"]["image"], "__CHARACTER_IMAGE__")
        self.assertFalse(self.remote.gets)
        self.assertFalse(batch.state_path.exists())

    def test_duplicate_ids_orders_and_path_escape_are_rejected(self):
        self.manifest["shots"][1]["id"] = self.manifest["shots"][0]["id"]
        self.save_manifest()
        with self.assertRaises(runner.BatchError):
            self.make_runner()
        self.manifest["shots"][1]["id"] = "second"
        self.manifest["shots"][1]["order"] = 1
        self.save_manifest()
        with self.assertRaises(runner.BatchError):
            self.make_runner()
        with self.assertRaises(runner.BatchError):
            runner.package_path(self.package, "../../outside.wav")

    def test_failed_predecessor_never_borrows_earlier_success(self):
        self.manifest["shots"].append({"id": "third", "order": 3, "kind": "ambient", "referenceMode": "continuous", "prompt": "Wind", "durationSeconds": 2})
        self.manifest["shots"][1]["prompt"] = "FAIL_THIS"
        self.save_manifest()
        result = self.make_runner(retries=0).run()
        self.assertEqual(result["succeeded"], 2)
        self.assertEqual(result["failed"], 1)
        self.assertNotIn("ref_images.ref_image_1", self.remote.posts[-1]["prompt"]["22"]["inputs"])
        self.assertEqual(len(self.tails), 1)  # second tried first's frame; third never did.

    def test_template_and_character_fingerprints_invalidate_only_selected_shot(self):
        self.make_runner().run()
        (self.package / "references" / "character.png").write_bytes(b"changed-character")
        self.make_runner(only="2").run()
        self.assertEqual(len(self.remote.posts), 3)
        template = self.package / "workflow_api.json"
        template.write_text(template.read_text() + "\n")
        self.make_runner(only="1").run()
        self.assertEqual(len(self.remote.posts), 4)

    def test_missing_node_preflight_submits_nothing(self):
        self.remote.classes.pop("MiniMaxH3ReferenceToVideo")
        with self.assertRaises(runner.BatchError):
            self.make_runner().run()
        self.assertFalse(self.remote.posts)

    def test_preflight_rejects_missing_audio_reference_optional_branch(self):
        template = json.loads((SOURCE / "workflow_api.json").read_text(encoding="utf-8"))
        fields = {key.split(".", 1)[0]: [] for key in template["22"]["inputs"]}
        fields.pop("ref_audios")
        self.remote.classes["MiniMaxH3ReferenceToVideo"] = {"input": {"required": fields}}
        with self.assertRaisesRegex(runner.BatchError, "ref_audios"):
            self.make_runner(only="1").run()
        self.assertFalse(self.remote.posts)

    def test_clean_template_preserves_04_sampling_models_and_dynamic_codec(self):
        template = json.loads((SOURCE / "workflow_api.json").read_text(encoding="utf-8"))
        self.assertEqual(template["7"]["inputs"]["steps"], 20)
        self.assertEqual(template["6"]["inputs"]["sampler_name"], "res_multistep")
        self.assertEqual(template["26"]["inputs"]["format.codec"], "auto")
        source = Path(os.environ.get("ASMR_SOURCE_WORKFLOW", "I:/temp/asmr04.json"))
        if source.is_file():
            original = json.loads(source.read_text(encoding="utf-8-sig"))
            retained = {"2", "3", "6", "7", "11", "12", "13", "14", "15", "16", "17", "26"}
            for node in original["nodes"]:
                node_id = str(node["id"])
                if node_id not in retained:
                    continue
                self.assertEqual(template[node_id]["class_type"], node["type"])
                for key, value in node.get("widgets_values_named", {}).items():
                    if key != "filename_prefix":
                        self.assertEqual(template[node_id]["inputs"][key], value, f"source node {node_id}: {key}")

    def test_submission_identity_is_saved_before_post(self):
        client = runner.ComfyClient(self.url)
        original = client.submit
        batch = self.make_runner(only="1", client=client)

        def submit(graph, submission_id):
            state = json.loads(batch.state_path.read_text())
            saved = state["shots"]["arbitrary/id:one"]
            self.assertEqual(saved["status"], "submitting")
            self.assertEqual(saved["submission_id"], submission_id)
            self.assertTrue((batch.output / saved["payload"]).is_file())
            return original(graph, submission_id)
        client.submit = submit
        self.assertEqual(batch.run()["succeeded"], 1)

    def test_moved_package_recovers_submitted_job_using_only_moved_snapshots(self):
        self.remote.behavior = "queued"
        first = self.make_runner(only="1")
        self.assertEqual(first.run()["unknown"], 1)
        first_entry = first.state["shots"]["arbitrary/id:one"]
        for field in ("audio_snapshot", "payload"):
            self.assertFalse(Path(first_entry[field]).is_absolute())
        moved = self.root / "moved-package"
        shutil.copytree(self.package, moved)
        self.remote.record("prompt-1", self.remote.posts[0])
        self.remote.pending.clear()
        second = self.make_runner(package=moved, only="1")
        self.assertEqual(second.run()["succeeded"], 1)
        self.assertEqual(len(self.remote.posts), 1)
        self.assertTrue(Path(self.finishes[-1]["audio_snapshot"]).relative_to(moved))
        output = second.state["shots"]["arbitrary/id:one"]["output"]
        self.assertFalse(Path(output).is_absolute())
        self.assertTrue((moved / "outputs" / output).is_file())

    def test_missing_wav_does_not_erase_completed_receipt_or_resubmit_on_restore(self):
        first = self.make_runner(only="1")
        first.run()
        original_receipt = copy.deepcopy(first.state["shots"]["arbitrary/id:one"])
        unavailable = self.wav.with_suffix(".temporarily-unavailable")
        self.wav.rename(unavailable)
        second = self.make_runner(only="1")
        result = second.run()
        self.assertEqual(result["input_error"], 1)
        receipt = second.state["shots"]["arbitrary/id:one"]
        for field in ("fingerprint", "prompt_id", "output", "status"):
            self.assertEqual(receipt[field], original_receipt[field])
        unavailable.rename(self.wav)
        third = self.make_runner(only="1")
        self.assertEqual(third.run()["input_error"], 0)
        self.assertEqual(len(self.remote.posts), 1)

    def test_concat_three_successful_shots_in_order_and_cached_without_model_posts(self):
        self.manifest["shots"].append({"id": "third", "order": 3, "kind": "ambient", "referenceMode": "new", "prompt": "Quiet wind.", "durationSeconds": 2})
        self.save_manifest()
        first = self.make_runner(concat=True)
        self.assertEqual(first.run()["preview_failed"], 0)
        self.assertEqual(len(self.remote.posts), 3)
        self.assertEqual(len(self.concatenations), 1)
        self.assertEqual([path.name[:3] for path, duration in self.concatenations[0]], ["001", "002", "003"])
        self.assertTrue((first.output / "preview.mp4").is_file())
        self.assertEqual(first.state["preview"]["shot_count"], 3)
        self.make_runner(concat=True).run()
        self.assertEqual(len(self.remote.posts), 3)
        self.assertEqual(len(self.concatenations), 1)

    def test_concat_refuses_missing_shot_and_preserves_existing_preview(self):
        self.manifest["shots"][0]["prompt"] = "FAIL_THIS"
        self.save_manifest()
        batch = self.make_runner(concat=True, retries=0)
        preview = batch.output / "preview.mp4"
        preview.write_bytes(b"prior-preview")
        result = batch.run()
        self.assertEqual(result["preview_failed"], 1)
        self.assertFalse(self.concatenations)
        self.assertEqual(preview.read_bytes(), b"prior-preview")
        self.assertEqual(batch.state["preview"]["status"], "unavailable")

    def test_concat_error_does_not_recreate_models_or_replace_preview(self):
        first = self.make_runner()
        first.run()
        preview = first.output / "preview.mp4"
        preview.write_bytes(b"prior-preview")

        def fail(*unused):
            raise runner.BatchError("temporary concat issue")
        self.assertEqual(self.make_runner(concat=True, concatenator=fail).run()["preview_failed"], 1)
        self.assertEqual(preview.read_bytes(), b"prior-preview")
        self.assertEqual(len(self.remote.posts), 2)

    def test_concat_filter_resets_timestamps_and_exact_lengths_for_paths_with_spaces(self):
        directory = self.root / "output folder with spaces"
        directory.mkdir()
        source = directory / "source file with spaces.mp4"
        source.write_bytes(b"synthetic-source")
        target = directory / "preview.mp4"
        captures = []

        def ffmpeg(executable, arguments):
            captures.append(arguments)
            filters = arguments[arguments.index("-filter_complex") + 1]
            self.assertIn("trim=end_frame=8,setpts=N/(24*TB)", filters)
            self.assertIn("trim=end_frame=120,setpts=N/(24*TB)", filters)
            self.assertIn("atrim=end_sample=16000,asetpts=N/SR/TB", filters)
            self.assertIn("atrim=end_sample=240000,asetpts=N/SR/TB", filters)
            self.assertIn("concat=n=2:v=1:a=1", filters)
            self.assertNotIn(str(source), filters)
            self.assertEqual([arguments[index + 1] for index, value in enumerate(arguments) if value == "-i"], [source, source])
            self.assertEqual(arguments[arguments.index("-t") + 1], "5.333333333333")
            self.assertEqual(arguments[arguments.index("-frames:v") + 1], "128")
            self.assertEqual(arguments[arguments.index("-r") + 1], "24")
            Path(arguments[-1]).write_bytes(b"concatenated-preview")
        with mock.patch.object(runner, "run_ffmpeg", side_effect=ffmpeg):
            runner.concat_videos("ffmpeg", [(source, 8 / 24), (source, 5)], target)
        self.assertEqual(len(captures), 1)
        self.assertEqual(target.read_bytes(), b"concatenated-preview")
        self.assertEqual(source.read_bytes(), b"synthetic-source")
        self.assertFalse(list(directory.glob("preview.part-*")))

        def fail_final(executable, arguments):
            Path(arguments[-1]).write_bytes(b"partial-preview")
            raise runner.BatchError("concat failure")
        with mock.patch.object(runner, "run_ffmpeg", side_effect=fail_final):
            with self.assertRaises(runner.BatchError):
                runner.concat_videos("ffmpeg", [(source, 1)], target)
        self.assertEqual(target.read_bytes(), b"concatenated-preview")
        self.assertFalse(list(directory.glob("preview.part-*")))


if __name__ == "__main__":
    unittest.main()
