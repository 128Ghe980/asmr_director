import copy
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import socket
import struct
import tempfile
import threading
import time
import unittest
from unittest import mock
import urllib.parse
import wave
import zlib

SOURCE = Path(__file__).resolve().parent
TEST_ROOT = Path(os.environ.get("ASMR_BATCH_TEST_ROOT", "I:/AI/asmr-director-video-batch/2026-10-15/candidates-qa")) if Path("I:/").is_dir() else Path(tempfile.gettempdir())
SPEC = importlib.util.spec_from_file_location("comfy_batch_runner", SOURCE / "runner.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


def entry(batch, shot_id="arbitrary/id:one", index=1):
    state = batch if isinstance(batch, dict) else batch.state
    return state["shots"][shot_id]["candidates"][str(index)]


def seeds(posts):
    return [body["prompt"]["10"]["inputs"]["noise_seed"] for body in posts if "22" in body["prompt"]]


def png_bytes(filename):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    pixel = hashlib.sha256(filename.encode()).digest()[:3]
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\0" + pixel)) + chunk(b"IEND", b""))


def uploaded_name(path):
    path = Path(path)
    return "asmr_" + runner.file_hash(path)[:24] + path.suffix.lower()


class FakeComfy:
    def __init__(self):
        self.posts, self.history, self.pending, self.uploads = [], {}, [], []
        self.behavior = "success"
        self.queue_pending = False
        self.read_failures = 0
        self.fail_posts = set()
        self.fail_previews = False
        self.gets = []
        self.classes = {node["class_type"]: {} for node in json.loads((SOURCE / "workflow_api.json").read_text()).values()}
        self.classes.update({name: {} for name in ("LoadImage", "LoadVideo", "CLFSelectVideoTailFrames", "SaveImage", "ImageFromBatch", "TrimAudioDuration",
                            "ConcatenateVideo", "CLFLoadVideoTailFrames", "ComfyMathExpression", "EmptyAudio", "AudioMerge", "AudioConcat")})

    @property
    def model_posts(self):
        return [body for body in self.posts if "22" in body["prompt"]]

    @property
    def preview_posts(self):
        return [body for body in self.posts if "22" not in body["prompt"] and "26" in body["prompt"]]

    @property
    def tail_posts(self):
        return [body for body in self.posts if "22" not in body["prompt"] and "910" in body["prompt"]]

    def record(self, prompt_id, body, failed=False):
        outputs = {}
        if not failed:
            for node_id, extension in (("26", ".mp4"), ("902", ".png")):
                if node_id in body["prompt"]:
                    outputs[node_id] = {"images": [{"filename": prompt_id + extension, "subfolder": "batch", "type": "output"}]}
        self.history[prompt_id] = {"prompt": [1, prompt_id, body["prompt"], body["extra_data"], list(outputs)],
                                   "status": {"completed": True, "status_str": "error" if failed else "success"}, "outputs": outputs}


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
        if state.posts and state.read_failures and self.path.startswith(("/history", "/queue")):
            state.read_failures -= 1
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        if self.path == "/object_info":
            self.send_json(state.classes)
        elif self.path.startswith("/history/"):
            prompt_id = self.path[len("/history/"):]
            self.send_json({prompt_id: state.history[prompt_id]} if prompt_id in state.history else {})
        elif self.path.startswith("/history"):
            self.send_json(state.history)
        elif self.path == "/queue":
            self.send_json({"queue_running": [] if state.queue_pending else state.pending,
                            "queue_pending": state.pending if state.queue_pending else []})
        elif self.path.startswith("/view?"):
            self.send_response(200)
            self.end_headers()
            filename = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)["filename"][0]
            self.wfile.write(png_bytes(filename) if filename.endswith(".png") else b"mock-video-content:" + filename.encode())
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
        prompt = body["prompt"].get("22", {}).get("inputs", {}).get("prompt", "")
        if state.behavior == "unknown":
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        if state.behavior in ("queued", "queued_lost"):
            state.pending.append([1, prompt_id, body["prompt"], body["extra_data"], ["26"]])
        else:
            state.record(prompt_id, body, failed="FAIL_THIS" in prompt or len(state.posts) in state.fail_posts
                         or (state.fail_previews and "22" not in body["prompt"] and "26" in body["prompt"]))
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
        self.publishes, self.tails = [], []
        previous_tail = runner.BatchRunner.previous_tail

        def track_previous_tail(batch, index, candidate=1):
            result = previous_tail(batch, index, candidate)
            if result is not None:
                self.tails.append(batch.previous_output(index, candidate))
            return result
        self.tail_patch = mock.patch.object(runner.BatchRunner, "previous_tail", new=track_previous_tail)
        self.tail_patch.start()

    def tearDown(self):
        self.tail_patch.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temporary.cleanup()

    def save_manifest(self):
        (self.package / "project.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def publish(self, raw, target, receipt):
        self.publishes.append(copy.deepcopy(receipt))
        return runner.copy_saved_video(raw, target, receipt)

    def make_runner(self, **kwargs):
        package = kwargs.pop("package", self.package)
        options = dict(comfy_url=self.url, poll_interval=.002, missing_grace=.006,
                       job_timeout=.04, log=lambda unused: None, publisher=self.publish)
        options.update(kwargs)
        return runner.BatchRunner(package, **options)

    def test_speech_routes_original_ambient_routes_generated_and_exports_native_video_and_tail(self):
        batch = self.make_runner()
        self.assertEqual(batch.run()["succeeded"], 2)
        speech, ambient = [body["prompt"] for body in self.remote.posts]
        self.assertEqual(speech["11"]["inputs"]["audio"], ["24", 0])
        self.assertEqual(speech["22"]["inputs"]["ref_audios.ref_audio_0"], ["24", 0])
        self.assertNotIn("4", speech)
        self.assertEqual(ambient["11"]["inputs"]["audio"], ["904", 0])
        self.assertEqual(ambient["904"]["class_type"], "TrimAudioDuration")
        self.assertEqual(ambient["904"]["inputs"], {"audio": ["4", 0], "start_index": 0.0, "duration": 5.0})
        self.assertEqual(ambient["903"]["inputs"]["length"], 120)
        self.assertNotIn("24", ambient)
        self.assertFalse(any(key.startswith("ref_audios") for key in ambient["22"]["inputs"]))
        self.assertEqual(ambient["22"]["inputs"]["length"], 124)
        self.assertEqual(self.publishes[1]["target_duration"], 5)
        self.assertEqual(self.publishes[0]["source_duration"], 1.625)
        self.assertGreaterEqual(self.publishes[0]["target_duration"], 1.625)
        self.assertLess(self.publishes[0]["target_duration"] - 1.625, 1 / 24 + 1e-9)
        self.assertIn("ref_images.ref_image_1", ambient["22"]["inputs"])
        for graph in (speech, ambient):
            self.assertEqual(graph["903"]["class_type"], "ImageFromBatch")
            self.assertEqual(graph["11"]["inputs"]["images"], ["903", 0])
            self.assertEqual(graph["901"]["class_type"], "CLFSelectVideoTailFrames")
            self.assertEqual(graph["901"]["inputs"]["video"], ["11", 0])
            self.assertEqual(graph["902"]["inputs"]["images"], ["901", 0])
        self.assertEqual(len(self.tails), 1)
        self.assertFalse(self.remote.tail_posts)  # New outputs already include their PNG branch.
        self.assertTrue((self.package / "outputs" / "run-state.json").is_file())
        self.assertEqual(len(list((self.package / "outputs").glob("*.mp4"))), 2)
        self.assertEqual((batch.output / entry(batch)["output"]).read_bytes(), b"mock-video-content:prompt-1.mp4")

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
        self.assertEqual(entry(first)["prompt_id"], "prompt-1")
        self.remote.record("prompt-1", self.remote.posts[0])
        self.remote.pending.clear()
        self.assertEqual(self.make_runner(only="1").run()["succeeded"], 1)
        self.assertEqual(len(self.remote.posts), 1)

    def test_final_publish_failure_resumes_without_regenerating_model(self):
        def fail(*unused):
            raise runner.BatchError("temporary publisher issue")
        first = self.make_runner(only="1", publisher=fail)
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
            saved = entry(state)
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
        first_entry = entry(first)
        for field in ("audio_snapshot", "payload"):
            self.assertFalse(Path(first_entry[field]).is_absolute())
        moved = self.root / "moved-package"
        shutil.copytree(self.package, moved)
        self.remote.record("prompt-1", self.remote.posts[0])
        self.remote.pending.clear()
        second = self.make_runner(package=moved, only="1")
        self.assertEqual(second.run()["succeeded"], 1)
        self.assertEqual(len(self.remote.posts), 1)
        snapshot = second.state_file(entry(second)["audio_snapshot"])
        self.assertTrue(snapshot.relative_to(moved))
        self.assertEqual(runner.file_hash(snapshot), runner.file_hash(moved / "shots/001/audio.wav"))
        output = entry(second)["output"]
        self.assertFalse(Path(output).is_absolute())
        self.assertTrue((moved / "outputs" / output).is_file())

    def test_missing_wav_does_not_erase_completed_receipt_or_resubmit_on_restore(self):
        first = self.make_runner(only="1")
        first.run()
        original_receipt = copy.deepcopy(entry(first))
        unavailable = self.wav.with_suffix(".temporarily-unavailable")
        self.wav.rename(unavailable)
        second = self.make_runner(only="1")
        result = second.run()
        self.assertEqual(result["input_error"], 1)
        receipt = entry(second)
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
        self.assertEqual(len(self.remote.model_posts), 3)
        self.assertEqual(len(self.remote.preview_posts), 1)
        graph = self.remote.preview_posts[0]["prompt"]
        self.assertEqual([graph[str(2000 + index)]["inputs"]["file"] for index in range(3)],
                         [uploaded_name(first.output / entry(first, shot["id"])["output"]) for shot in self.manifest["shots"]])
        self.assertTrue((first.output / "preview.mp4").is_file())
        self.assertEqual(first.state["preview"]["shot_count"], 3)
        self.assertEqual(first.state["preview"]["method"], "comfy_native")
        self.make_runner(concat=True).run()
        self.assertEqual(len(self.remote.model_posts), 3)
        self.assertEqual(len(self.remote.preview_posts), 1)


    def test_concat_refuses_missing_shot_and_preserves_existing_preview(self):
        self.manifest["shots"][0]["prompt"] = "FAIL_THIS"
        self.save_manifest()
        batch = self.make_runner(concat=True, retries=0)
        preview = batch.output / "preview.mp4"
        preview.write_bytes(b"prior-preview")
        result = batch.run()
        self.assertEqual(result["preview_failed"], 1)
        self.assertFalse(self.remote.preview_posts)
        self.assertEqual(preview.read_bytes(), b"prior-preview")
        self.assertEqual(batch.state["preview"]["status"], "unavailable")


    def test_concat_error_does_not_recreate_models_or_replace_preview(self):
        first = self.make_runner()
        first.run()
        preview = first.output / "preview.mp4"
        preview.write_bytes(b"prior-preview")
        self.remote.fail_previews = True
        self.assertEqual(self.make_runner(concat=True).run()["preview_failed"], 1)
        self.assertEqual(preview.read_bytes(), b"prior-preview")
        self.assertEqual(len(self.remote.model_posts), 2)
        self.assertEqual(len(self.remote.preview_posts), 1)

    def test_candidate_count_increase_fills_only_missing_and_decrease_preserves_extras(self):
        first = self.make_runner(candidates=2)
        self.assertEqual(first.run()["succeeded"], 4)
        original = {shot_id: copy.deepcopy(value["candidates"])
                    for shot_id, value in first.state["shots"].items()}
        self.assertEqual(len(self.remote.posts), 4)
        for shot in self.manifest["shots"]:
            for number in (1, 2):
                self.assertRegex(entry(first, shot["id"], number)["output"],
                                 rf"^{shot['order']:03d}_c{number:03d}_[0-9a-f]{{10}}\.mp4$")
        larger = self.make_runner(candidates=3)
        self.assertEqual(larger.run()["succeeded"], 6)
        self.assertEqual(len(self.remote.posts), 6)
        smaller = self.make_runner(candidates=1)
        self.assertEqual(smaller.run()["succeeded"], 2)
        self.assertEqual(len(self.remote.posts), 6)
        for shot in self.manifest["shots"]:
            self.assertEqual(set(smaller.state["shots"][shot["id"]]["candidates"]), {"1", "2", "3"})
            for number in (1, 2):
                for field in ("fingerprint", "seed", "prompt_id", "output", "output_sha256"):
                    self.assertEqual(entry(smaller, shot["id"], number)[field],
                                     original[shot["id"]][str(number)][field])
        self.assertEqual(self.make_runner(candidates=3).run()["succeeded"], 6)
        self.assertEqual(len(self.remote.posts), 6)

    def test_candidate_seeds_are_distinct_stable_and_match_saved_payloads(self):
        first = self.make_runner(candidates=3)
        first.run()
        first_seeds = seeds(self.remote.posts)
        self.assertEqual(len(set(first_seeds)), 6)
        saved_seeds = [entry(first, shot["id"], number)["seed"]
                       for shot in self.manifest["shots"] for number in range(1, 4)]
        self.assertEqual(first_seeds, saved_seeds)
        second = self.make_runner(candidates=3)
        second.run()
        self.assertEqual(len(self.remote.posts), 6)
        self.assertEqual(saved_seeds, [entry(second, shot["id"], number)["seed"]
                                      for shot in self.manifest["shots"] for number in range(1, 4)])
        isolated_output = self.root / "isolated-outputs"
        self.make_runner(candidates=3, output_root=isolated_output).run()
        self.assertEqual(seeds(self.remote.posts[6:]), first_seeds)

    def test_changing_base_seed_one_to_two_generates_both_shots_without_history_collision(self):
        first = self.make_runner(seed=1)
        self.assertEqual(first.run()["succeeded"], 2)
        original = {shot["id"]: copy.deepcopy(entry(first, shot["id"])) for shot in self.manifest["shots"]}
        self.assertEqual(seeds(self.remote.posts), [2, 3])
        second = self.make_runner(seed=2)
        result = second.run()
        self.assertEqual(result["succeeded"], 2)
        self.assertEqual(result["input_error"], 0)
        self.assertEqual(len(self.remote.posts), 4)
        self.assertEqual(len(set(seeds(self.remote.posts))), 4)
        for shot in self.manifest["shots"]:
            current, previous = entry(second, shot["id"]), original[shot["id"]]
            self.assertEqual(current["base_seed"], 2)
            self.assertNotEqual(current["seed"], previous["seed"])
            self.assertTrue(any(old.get("prompt_id") == previous["prompt_id"] for old in current["history"]))
            self.assertTrue((second.output / previous["output"]).is_file())
        self.assertEqual(self.make_runner(seed=2).run()["succeeded"], 2)
        self.assertEqual(len(self.remote.posts), 4)

    def test_prompt_round_trip_reuses_success_history_without_post_or_output_overwrite(self):
        def distinctive_publish(raw, target, receipt):
            self.publish(raw, target, receipt)
            with Path(target).open("ab") as handle:
                handle.write(receipt["submission_id"].encode())

        first = self.make_runner(candidates=2, publisher=distinctive_publish)
        self.assertEqual(first.run()["succeeded"], 4)
        original = {number: copy.deepcopy(entry(first, index=number)) for number in (1, 2)}
        originals = {first.output / value["output"]: ((first.output / value["output"]).read_bytes(),
                     (first.output / value["output"]).stat().st_mtime_ns) for value in original.values()}
        self.manifest["shots"][0]["prompt"] = "CHANGED_FIRST"
        self.save_manifest()
        changed = self.make_runner(candidates=2, publisher=distinctive_publish)
        self.assertEqual(changed.run()["succeeded"], 4)
        changed_receipts = {number: copy.deepcopy(entry(changed, index=number)) for number in (1, 2)}
        self.assertEqual(len(self.remote.posts), 6)
        self.manifest["shots"][0]["prompt"] = "FIRST_SHOT"
        self.save_manifest()
        restored = self.make_runner(candidates=2, publisher=distinctive_publish)
        result = restored.run()
        self.assertEqual(result["succeeded"], 4)
        self.assertEqual(result["input_error"], 0)
        self.assertEqual(len(self.remote.posts), 6)
        self.assertEqual(len(self.publishes), 6)
        for number in (1, 2):
            current = entry(restored, index=number)
            for field in ("fingerprint", "seed", "submission_id", "prompt_id", "output", "output_sha256"):
                self.assertEqual(current[field], original[number][field])
            self.assertTrue(any(old.get("prompt_id") == changed_receipts[number]["prompt_id"]
                                for old in current["history"]))
            self.assertTrue((restored.output / changed_receipts[number]["output"]).is_file())
        for path, (content, modified_ns) in originals.items():
            self.assertEqual(path.read_bytes(), content)
            self.assertEqual(path.stat().st_mtime_ns, modified_ns)

    def test_base_seed_round_trip_restores_both_candidate_lanes_without_posts(self):
        first = self.make_runner(seed=1, candidates=2)
        self.assertEqual(first.run()["succeeded"], 4)
        original = {(shot["id"], number): copy.deepcopy(entry(first, shot["id"], number))
                    for shot in self.manifest["shots"] for number in (1, 2)}
        originals = {first.output / value["output"]: ((first.output / value["output"]).read_bytes(),
                     (first.output / value["output"]).stat().st_mtime_ns) for value in original.values()}
        second = self.make_runner(seed=2, candidates=2)
        result = second.run()
        self.assertEqual(result["succeeded"], 4)
        self.assertEqual(result["input_error"], 0)
        self.assertEqual(len(self.remote.posts), 8)
        changed = {(shot["id"], number): copy.deepcopy(entry(second, shot["id"], number))
                   for shot in self.manifest["shots"] for number in (1, 2)}
        restored = self.make_runner(seed=1, candidates=2)
        result = restored.run()
        self.assertEqual(result["succeeded"], 4)
        self.assertEqual(result["input_error"], 0)
        self.assertEqual(len(self.remote.posts), 8)
        for (shot_id, number), previous in original.items():
            current = entry(restored, shot_id, number)
            for field in ("fingerprint", "seed", "base_seed", "prompt_id", "submission_id", "output", "output_sha256"):
                self.assertEqual(current[field], previous[field])
            self.assertTrue(any(old.get("prompt_id") == changed[(shot_id, number)]["prompt_id"]
                                for old in current["history"]))
        for path, (content, modified_ns) in originals.items():
            self.assertEqual(path.read_bytes(), content)
            self.assertEqual(path.stat().st_mtime_ns, modified_ns)

    def test_rerun_after_restoring_older_generation_uses_new_generation_and_seed(self):
        first = self.make_runner(only="1")
        self.assertEqual(first.run()["succeeded"], 1)
        generation_zero = copy.deepcopy(entry(first))
        second = self.make_runner(only="1", rerun="1")
        self.assertEqual(second.run()["succeeded"], 1)
        generation_one = copy.deepcopy(entry(second))
        self.assertEqual(generation_zero["generation"], 0)
        self.assertEqual(generation_one["generation"], 1)
        # Restore an actual completed old receipt through the same helper used
        # for history reuse; the newer generation remains in its history.
        self.assertTrue(second.restore_history(self.manifest["shots"][0], 1, entry(second),
                                               generation_zero["fingerprint"]))
        self.assertEqual(entry(second)["generation"], 0)
        self.assertEqual(entry(second)["prompt_id"], generation_zero["prompt_id"])
        self.assertEqual(len(self.remote.posts), 2)
        third = self.make_runner(only="1", rerun="1")
        self.assertEqual(third.run()["succeeded"], 1)
        current = entry(third)
        self.assertEqual(current["generation"], 2)
        self.assertNotIn(current["seed"], {generation_zero["seed"], generation_one["seed"]})
        self.assertNotIn(current["fingerprint"], {generation_zero["fingerprint"], generation_one["fingerprint"]})
        self.assertEqual(len(self.remote.posts), 3)
        for previous in (generation_zero, generation_one):
            self.assertTrue(any(old.get("prompt_id") == previous["prompt_id"] for old in current["history"]))
            self.assertTrue((third.output / previous["output"]).is_file())

    def test_changed_historical_output_is_preserved_when_input_round_trip_cannot_reuse_it(self):
        self.manifest["shots"] = self.manifest["shots"][:1]
        self.save_manifest()
        first = self.make_runner()
        self.assertEqual(first.run()["succeeded"], 1)
        original = copy.deepcopy(entry(first))
        old_path = first.output / original["output"]
        external_content = b"externally-edited-A-video-that-must-be-retained"
        old_path.write_bytes(external_content)
        external_modified_ns = old_path.stat().st_mtime_ns
        self.manifest["shots"][0]["prompt"] = "CHANGED_FIRST"
        self.save_manifest()
        second = self.make_runner()
        self.assertEqual(second.run()["succeeded"], 1)
        changed = copy.deepcopy(entry(second))
        self.assertEqual(len(self.remote.model_posts), 2)
        self.manifest["shots"][0]["prompt"] = "FIRST_SHOT"
        self.save_manifest()
        third = self.make_runner(concat=True)
        result = third.run()
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(result["preview_failed"], 0)
        self.assertEqual(len(self.remote.model_posts), 3)
        current = copy.deepcopy(entry(third))
        self.assertEqual(current["fingerprint"], original["fingerprint"])
        self.assertNotEqual(current["output"], original["output"])
        self.assertRegex(current["output_suffix"], r"^[0-9a-f]{32}$")
        self.assertTrue((third.output / current["output"]).is_file())
        self.assertEqual(old_path.read_bytes(), external_content)
        self.assertEqual(old_path.stat().st_mtime_ns, external_modified_ns)
        self.assertTrue(any(old.get("prompt_id") == original["prompt_id"] for old in current["history"]))
        self.assertTrue(any(old.get("prompt_id") == changed["prompt_id"] for old in current["history"]))
        fourth = self.make_runner(concat=True)
        self.assertEqual(fourth.run()["succeeded"], 1)
        self.assertEqual(len(self.remote.model_posts), 3)
        self.assertEqual(entry(fourth)["output"], current["output"])
        self.assertEqual(entry(fourth)["output_suffix"], current["output_suffix"])
        self.assertEqual(old_path.read_bytes(), external_content)
        self.assertEqual(old_path.stat().st_mtime_ns, external_modified_ns)

    def test_repeated_external_edits_to_current_output_are_preserved_without_model_posts(self):
        self.manifest["shots"] = self.manifest["shots"][:1]
        self.save_manifest()
        first = self.make_runner()
        self.assertEqual(first.run()["succeeded"], 1)
        original = copy.deepcopy(entry(first))
        protected = {}
        previous = first
        for number in (1, 2):
            previous_receipt = copy.deepcopy(entry(previous))
            previous_path = previous.output / previous_receipt["output"]
            external_content = f"externally-edited-current-result-{number}-retain".encode()
            previous_path.write_bytes(external_content)
            protected[previous_path] = (external_content, previous_path.stat().st_mtime_ns)
            continued = self.make_runner(concat=True)
            result = continued.run()
            self.assertEqual(result["succeeded"], 1)
            self.assertEqual(result["preview_failed"], 0)
            self.assertEqual(len(self.remote.model_posts), 1)
            current = entry(continued)
            self.assertEqual(current["submission_id"], original["submission_id"])
            self.assertEqual(current["prompt_id"], original["prompt_id"])
            self.assertEqual(current["fingerprint"], original["fingerprint"])
            self.assertNotEqual(current["output"], previous_receipt["output"])
            self.assertRegex(current["output_suffix"], r"^[0-9a-f]{32}$")
            self.assertNotEqual(current["output_suffix"], previous_receipt.get("output_suffix"))
            self.assertTrue((continued.output / current["output"]).is_file())
            for path, (content, modified_ns) in protected.items():
                self.assertEqual(path.read_bytes(), content)
                self.assertEqual(path.stat().st_mtime_ns, modified_ns)
            previous = continued
        self.assertEqual(len(self.publishes), 3)  # Initial publish plus two local copy repairs.
        final = self.make_runner(concat=True)
        self.assertEqual(final.run()["succeeded"], 1)
        self.assertEqual(len(self.remote.model_posts), 1)
        self.assertEqual(len(self.publishes), 3)
        self.assertEqual(entry(final)["output"], entry(previous)["output"])
        for path, (content, modified_ns) in protected.items():
            self.assertEqual(path.read_bytes(), content)
            self.assertEqual(path.stat().st_mtime_ns, modified_ns)

    def test_technical_retries_reuse_candidate_seed(self):
        self.remote.fail_posts = {1, 3}
        first = self.make_runner(only="1", candidates=2, retries=1)
        self.assertEqual(first.run()["succeeded"], 2)
        submitted = seeds(self.remote.posts)
        self.assertEqual(len(submitted), 4)
        self.assertEqual(submitted[0], submitted[1])
        self.assertEqual(submitted[2], submitted[3])
        self.assertNotEqual(submitted[0], submitted[2])
        self.assertEqual(entry(first, index=1)["attempt_count"], 2)
        self.assertEqual(entry(first, index=2)["attempt_count"], 2)

    def test_rerun_all_current_candidates_changes_seeds_and_preserves_history(self):
        first = self.make_runner(candidates=3)
        first.run()
        original = [copy.deepcopy(entry(first, index=number)) for number in range(1, 4)]
        downstream = copy.deepcopy(first.state["shots"]["second"])
        second = self.make_runner(candidates=2, rerun="1")
        self.assertEqual(second.run()["succeeded"], 4)
        self.assertEqual(len(self.remote.posts), 8)
        for number in (1, 2):
            current = entry(second, index=number)
            previous = original[number - 1]
            self.assertNotEqual(current["seed"], previous["seed"])
            self.assertNotEqual(current["fingerprint"], previous["fingerprint"])
            self.assertTrue(any(old.get("prompt_id") == previous["prompt_id"]
                                and old.get("output") == previous["output"]
                                and old.get("seed") == previous["seed"] for old in current["history"]))
            self.assertTrue((second.output / previous["output"]).is_file())
        self.assertEqual(entry(second, index=3), original[2])
        self.assertEqual(second.state["shots"]["second"], downstream)

    def test_rerun_one_candidate_with_colon_in_shot_id_does_not_cascade(self):
        first = self.make_runner(candidates=2)
        first.run()
        before = copy.deepcopy(first.state)
        second = self.make_runner(candidates=2, rerun_candidates="arbitrary/id:one:2")
        second.run()
        self.assertEqual(len(self.remote.posts), 5)
        self.assertEqual(entry(second, index=1), entry(before, index=1))
        self.assertEqual(second.state["shots"]["second"], before["shots"]["second"])
        self.assertNotEqual(entry(second, index=2)["seed"], entry(before, index=2)["seed"])
        self.assertEqual(entry(second, index=2)["history"][-1]["output"], entry(before, index=2)["output"])
        self.assertEqual(self.remote.posts[-1]["prompt"]["22"]["inputs"]["prompt"], "FIRST_SHOT")

    def test_candidate_selection_validation_submits_nothing(self):
        for options in ({"candidates": 0}, {"candidates": True}, {"candidates": 1.5},
                        {"candidates": 2, "rerun_candidates": "2:0"},
                        {"candidates": 2, "rerun_candidates": "2:3"},
                        {"candidates": 2, "rerun_candidates": "missing:1"},
                        {"candidates": 2, "only": "1", "rerun_candidates": "2:1"}):
            with self.subTest(options=options):
                with self.assertRaises(runner.BatchError):
                    self.make_runner(**options)
        self.assertFalse(self.remote.posts)

    def test_continuous_candidates_use_same_numbered_predecessor_tail(self):
        first = self.make_runner(candidates=2)
        self.assertEqual(first.run()["succeeded"], 4)
        self.assertEqual(self.tails, [first.output / entry(first, index=1)["output"],
                                      first.output / entry(first, index=2)["output"]])
        for number in (1, 2):
            self.assertEqual(entry(first, "second", number)["effective_reference_mode"], "continuous")
            previous = entry(first, index=number)
            tail = first.state_file(previous["tail"])
            self.assertTrue(tail.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
            graph = json.loads(first.state_file(entry(first, "second", number)["payload"]).read_text(encoding="utf-8"))["prompt"]
            self.assertEqual(graph["900"]["inputs"]["image"], uploaded_name(tail))
        self.assertNotEqual(entry(first, index=1)["tail_sha256"], entry(first, index=2)["tail_sha256"])
        self.assertFalse(self.remote.tail_posts)

    def test_failed_corresponding_candidate_falls_back_without_borrowing_another(self):
        self.remote.fail_posts = {2}
        first = self.make_runner(candidates=2, retries=0)
        result = first.run()
        self.assertEqual(result["succeeded"], 3)
        self.assertEqual(result["failed"], 1)
        self.assertEqual(self.tails, [first.output / entry(first)["output"]])
        self.assertEqual(entry(first, "second", 1)["effective_reference_mode"], "continuous")
        self.assertEqual(entry(first, "second", 2)["effective_reference_mode"], "new")
        self.assertNotIn("ref_images.ref_image_1", self.remote.posts[-1]["prompt"]["22"]["inputs"])

    def test_true_v1_success_receipts_keep_old_fingerprints_names_and_outputs(self):
        batch = self.make_runner(candidates=2)
        legacy = {"version": 1, "projectId": self.manifest["projectId"], "shots": {}}
        for shot in self.manifest["shots"]:
            facts = runner.shot_facts(self.package, shot)
            # Independent copy of the released v1 formula: do not generate this
            # fixture using the new runner's fingerprint or output-name methods.
            identity = {"runner": 1, "kind": shot["kind"], "id": shot["id"], "order": shot["order"],
                        "referenceMode": shot["referenceMode"], "prompt": shot["prompt"],
                        "durationSeconds": facts["source_duration"], "audio": facts["audio_sha256"],
                        "character": hashlib.sha256((self.package / "references/character.png").read_bytes()).hexdigest(),
                        "template": hashlib.sha256((self.package / "workflow_api.json").read_bytes()).hexdigest(),
                        "width": 1216, "height": 672, "seed": 1}
            fingerprint = hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            filename = f"{shot['order']:03d}_{fingerprint[:10]}.mp4"
            content = b"genuine-v1-completed-output-" + shot["id"].encode()
            (batch.output / filename).write_bytes(content)
            legacy["shots"][shot["id"]] = {"fingerprint": fingerprint, "status": "succeeded", "kind": shot["kind"],
                "attempt_count": 1, "submission_id": f"legacy-{shot['order']}", "prompt_id": f"legacy-prompt-{shot['order']}",
                "output": filename, "output_sha256": hashlib.sha256(content).hexdigest(),
                "audio_sha256": facts["audio_sha256"],
                **{key: facts[key] for key in ("source_duration", "target_frames", "target_duration", "generation_frames")}}
        batch.state_path.write_text(json.dumps(legacy), encoding="utf-8")
        self.assertEqual(batch.run()["succeeded"], 4)
        self.assertEqual(batch.state["version"], 2)
        self.assertEqual(runner.RUNNER_VERSION, 1)
        self.assertEqual(len(self.remote.posts), 2)  # Only the new c2 slots.
        for shot in self.manifest["shots"]:
            old = legacy["shots"][shot["id"]]
            for field in ("fingerprint", "prompt_id", "output", "output_sha256", "attempt_count"):
                self.assertEqual(entry(batch, shot["id"])[field], old[field])
            self.assertEqual((batch.output / old["output"]).read_bytes(),
                             b"genuine-v1-completed-output-" + shot["id"].encode())
        self.assertTrue(list(batch.output.glob("run-state.v1-backup-*.json")))
        self.make_runner(candidates=2).run()
        self.assertEqual(len(self.remote.posts), 2)

    def test_multiple_candidate_dry_runs_use_unique_files_and_stable_seeds_without_network(self):
        first = self.make_runner(candidates=2, dry_run=True, comfy_url="http://127.0.0.1:1")
        paths = [Path(path) for path in first.run()["dry_run"]]
        self.assertEqual({path.name for path in paths}, {"001_c001.json", "001_c002.json", "002_c001.json", "002_c002.json"})
        first_seeds = [json.loads(path.read_text(encoding="utf-8"))["prompt"]["10"]["inputs"]["noise_seed"] for path in paths]
        self.assertEqual(len(set(first_seeds)), 4)
        second_paths = self.make_runner(candidates=2, dry_run=True).run()["dry_run"]
        self.assertEqual(first_seeds, [json.loads(Path(path).read_text(encoding="utf-8"))["prompt"]["10"]["inputs"]["noise_seed"] for path in second_paths])
        self.assertFalse(self.remote.gets)
        self.assertFalse(first.state_path.exists())
        single = self.make_runner(dry_run=True).run()["dry_run"]
        self.assertEqual([Path(path).name for path in single], ["001.json", "002.json"])


    def test_multiple_candidate_previews_are_separate_complete_numbered_lanes(self):
        first = self.make_runner(candidates=2, concat=True)
        self.assertEqual(first.run()["preview_failed"], 0)
        self.assertEqual(len(self.remote.preview_posts), 2)
        for number, body in enumerate(self.remote.preview_posts, 1):
            graph = body["prompt"]
            self.assertEqual([graph[str(2000 + index)]["inputs"]["file"] for index in range(2)],
                             [uploaded_name(first.output / entry(first, shot["id"], number)["output"]) for shot in self.manifest["shots"]])
            self.assertTrue((first.output / f"preview-c{number:03d}.mp4").is_file())
        self.assertFalse((first.output / "preview.mp4").exists())
        self.make_runner(candidates=2, concat=True).run()
        self.assertEqual(len(self.remote.model_posts), 4)
        self.assertEqual(len(self.remote.preview_posts), 2)


    def test_missing_candidate_lane_does_not_block_other_complete_preview(self):
        self.remote.fail_posts = {2}
        batch = self.make_runner(candidates=2, concat=True, retries=0)
        prior = batch.output / "preview-c002.mp4"
        prior.write_bytes(b"prior-candidate-two-preview")
        self.assertEqual(batch.run()["preview_failed"], 1)
        self.assertEqual(len(self.remote.preview_posts), 1)
        self.assertTrue((batch.output / "preview-c001.mp4").is_file())
        self.assertEqual(prior.read_bytes(), b"prior-candidate-two-preview")
        graph = self.remote.preview_posts[0]["prompt"]
        self.assertEqual([graph[str(2000 + index)]["inputs"]["file"] for index in range(2)],
                         [uploaded_name(batch.output / entry(batch, shot["id"], 1)["output"]) for shot in self.manifest["shots"]])

    def test_healthy_long_queue_has_heartbeats_and_no_implicit_job_deadline(self):
        self.remote.behavior, self.remote.queue_pending = "queued", True
        events, logs = [], []
        queued_since = [None]
        stop = threading.Event()
        watchdog = threading.Timer(1.5, stop.set)
        watchdog.start()

        def status(event):
            events.append(event)
            if event["phase"] == "queued":
                if queued_since[0] is None:
                    queued_since[0] = time.monotonic()
                if time.monotonic() - queued_since[0] >= .06:
                    self.remote.record("prompt-1", self.remote.posts[0])
                    self.remote.pending.clear()
        try:
            batch = self.make_runner(only="1", job_timeout=0, heartbeat_interval=.005,
                                     stop_event=stop, status_callback=status, log=logs.append)
            self.assertEqual(batch.run()["succeeded"], 1)
        finally:
            watchdog.cancel()
        queued = [event for event in events if event["phase"] == "queued"]
        self.assertGreaterEqual(len(queued), 2)
        self.assertTrue(any(event.get("queue_position") == 1 for event in queued))
        self.assertTrue(all(event["candidate_index"] == 1 and event["total"] == 1 for event in queued))
        self.assertTrue(any("排队" in line for line in logs))
        self.assertEqual(len(self.remote.posts), 1)

    def test_http_disconnect_reconnects_existing_prompt_without_duplicate_post(self):
        self.remote.behavior, self.remote.read_failures = "queued", 3
        events = []

        def status(event):
            events.append(event)
            if event["phase"] == "running":
                self.remote.record("prompt-1", self.remote.posts[0])
                self.remote.pending.clear()
        batch = self.make_runner(only="1", job_timeout=0, disconnect_timeout=.2,
                                 heartbeat_interval=.001, status_callback=status)
        self.assertEqual(batch.run()["succeeded"], 1)
        self.assertTrue(any(event["phase"] == "disconnected" for event in events))
        self.assertEqual(entry(batch)["prompt_id"], "prompt-1")
        self.assertEqual(len(self.remote.posts), 1)

    def test_disconnect_timeout_keeps_identity_and_resume_never_reposts(self):
        self.remote.behavior, self.remote.read_failures = "queued", 1000
        batch = self.make_runner(only="1", job_timeout=0, disconnect_timeout=.012, heartbeat_interval=.002)
        self.assertEqual(batch.run()["unknown"], 1)
        receipt = copy.deepcopy(entry(batch))
        self.assertEqual(receipt["prompt_id"], "prompt-1")
        self.remote.read_failures = 0
        self.remote.record("prompt-1", self.remote.posts[0])
        self.remote.pending.clear()
        second = self.make_runner(only="1", rerun_candidates="1:1")
        self.assertEqual(second.run()["succeeded"], 1)
        self.assertEqual(entry(second)["submission_id"], receipt["submission_id"])
        self.assertEqual(entry(second)["seed"], receipt["seed"])
        self.assertEqual(len(self.remote.posts), 1)

    def test_stop_while_queued_keeps_receipt_and_resumes_without_duplicate_submission(self):
        self.remote.behavior, self.remote.queue_pending = "queued", True
        stop = threading.Event()
        events = []

        def status(event):
            events.append(event)
            if event["phase"] == "queued":
                stop.set()
        first = self.make_runner(candidates=2, job_timeout=0, stop_event=stop, status_callback=status)
        first.run()
        self.assertEqual(len(self.remote.posts), 1)
        self.assertEqual(entry(first)["prompt_id"], "prompt-1")
        self.assertNotEqual(entry(first)["status"], "failed")
        self.assertTrue(any(event["phase"] == "paused" for event in events))
        submission_id = entry(first)["submission_id"]
        self.remote.record("prompt-1", self.remote.posts[0])
        self.remote.pending.clear()
        self.remote.behavior = "success"
        second = self.make_runner(candidates=2)
        self.assertEqual(second.run()["succeeded"], 4)
        self.assertEqual(entry(second)["submission_id"], submission_id)
        self.assertEqual(len(self.remote.posts), 4)

    def test_confirmed_raw_publishes_locally_when_comfy_is_offline(self):
        def fail(*unused):
            raise runner.BatchError("temporary publisher issue")
        first = self.make_runner(only="1", publisher=fail)
        self.assertEqual(first.run()["downloading"], 1)
        receipt = copy.deepcopy(entry(first))
        self.assertTrue(receipt.get("remote_output"))
        self.assertTrue(receipt.get("raw_sha256"))
        offline = runner.ComfyClient("http://127.0.0.1:1", timeout=.01)

        with mock.patch.object(offline, "get", side_effect=AssertionError("raw recovery must not request ComfyUI")), \
             mock.patch.object(offline, "download", side_effect=AssertionError("local recovery must not download video or optional tail")), \
             mock.patch.object(offline, "submit", side_effect=AssertionError("raw recovery must not resubmit")):
            second = self.make_runner(only="1", client=offline)
            self.assertEqual(second.run()["succeeded"], 1)
        self.assertEqual(entry(second)["submission_id"], receipt["submission_id"])
        self.assertTrue(entry(second)["remote_tail"])
        self.assertFalse(entry(second).get("tail"))  # Deferred until a later shot needs it.
        self.assertEqual(len(self.remote.posts), 1)

    def test_default_timeout_and_request_timeout_are_separate(self):
        batch = runner.BatchRunner(self.package, comfy_url=self.url,
                                   request_timeout=.75, log=lambda unused: None)
        self.assertEqual(batch.job_timeout, 0)
        self.assertEqual(batch.client.timeout, .75)
        for options in ({"request_timeout": 0}, {"disconnect_timeout": 0},
                        {"heartbeat_interval": 0}, {"job_timeout": -1}):
            with self.subTest(options=options):
                with self.assertRaises(runner.BatchError):
                    self.make_runner(**options)

    def test_remote_preflight_network_error_isolated_to_candidates_without_posts(self):
        client = runner.ComfyClient(self.url)
        with mock.patch.object(client, "get", side_effect=runner.ApiError("offline during object_info")):
            batch = self.make_runner(candidates=2, client=client)
            self.assertEqual(batch.run()["input_error"], 4)
        for shot in self.manifest["shots"]:
            for number in (1, 2):
                self.assertIn("offline", entry(batch, shot["id"], number)["input_error"])
        self.assertFalse(self.remote.posts)

    def test_broken_status_callback_does_not_interrupt_generation_or_receipt_saving(self):
        def broken_status(event):
            raise RuntimeError("display unavailable")
        batch = self.make_runner(candidates=2, status_callback=broken_status)
        self.assertEqual(batch.run()["succeeded"], 4)
        state = json.loads(batch.state_path.read_text(encoding="utf-8"))
        for shot in self.manifest["shots"]:
            for number in (1, 2):
                self.assertEqual(entry(state, shot["id"], number)["status"], "succeeded")
        self.assertEqual(len(self.remote.posts), 4)

    def test_stop_during_failed_upload_does_not_exhaust_retry_budget(self):
        stop = threading.Event()
        first = self.make_runner(candidates=2, retries=0, stop_event=stop)

        def upload(path):
            stop.set()
            raise runner.ApiError("upload interrupted")

        with mock.patch.object(first.client, "upload", side_effect=upload):
            self.assertTrue(first.run()["stopped"])
        self.assertFalse(self.remote.posts)
        saved = entry(first, "arbitrary/id:one")
        self.assertEqual(saved["status"], "preparing")
        self.assertEqual(saved["attempt_count"], 0)
        resumed = self.make_runner(candidates=2, retries=0)
        self.assertEqual(resumed.run()["succeeded"], 4)
        self.assertEqual(len(self.remote.posts), 4)

    def test_stop_at_submitting_status_prevents_post_and_remains_resumable(self):
        stop = threading.Event()

        def status(event):
            if event["phase"] == "submitting":
                stop.set()

        first = self.make_runner(candidates=2, status_callback=status, stop_event=stop)
        self.assertTrue(first.run()["stopped"])
        self.assertFalse(self.remote.posts)
        saved = entry(first, "arbitrary/id:one")
        self.assertEqual(saved["status"], "preparing")
        self.assertEqual(saved["attempt_count"], 0)
        resumed = self.make_runner(candidates=2)
        self.assertEqual(resumed.run()["succeeded"], 4)
        self.assertEqual(len(self.remote.posts), 4)



if __name__ == "__main__":
    unittest.main()
