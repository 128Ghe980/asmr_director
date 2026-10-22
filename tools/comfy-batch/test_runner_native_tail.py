"""Native output/recovery contracts; no model or external media executable."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest import mock
import wave
import zlib

SOURCE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("native_tail_runner", SOURCE / "runner.py")
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)
ROOT = Path(os.environ.get("ASMR_BATCH_TEST_ROOT", str(Path(tempfile.gettempdir()) / "asmr-comfy-batch-native-tail-tests")))


def png(value=23):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes([0, value, 0, 0]))) + chunk(b"IEND", b""))


class Comfy:
    def __init__(self):
        self.posts, self.history, self.uploads, self.downloads = [], {}, [], []
        self.unknown_tail = False
        self.auxiliary_failure = False
        self.png_failure = False
        self.extension = ".mp4"
        self.info = {node["class_type"]: {} for node in json.loads((SOURCE / "workflow_api.json").read_text()).values()}
        self.info.update({name: {} for name in ("LoadVideo", "CLFSelectVideoTailFrames", "SaveImage", "ImageFromBatch", "TrimAudioDuration")})

    def upload(self, path):
        self.uploads.append(Path(path))
        return runner.file_hash(path) + Path(path).suffix

    def submit(self, graph, identity):
        self.posts.append((copy.deepcopy(graph), identity))
        job = "job-" + str(len(self.posts))
        if "22" not in graph and self.unknown_tail:
            raise runner.ApiError("lost tail response")
        outputs = {runner.TAIL_SAVE_NODE: {"images": [{"filename": job + ".png", "type": "output"}]}}
        if "26" in graph:
            outputs["26"] = {"images": [{"filename": job + self.extension, "type": "output"}]}
        if self.auxiliary_failure:
            outputs.pop(runner.TAIL_SAVE_NODE, None)
        self.history[job] = {"prompt": [1, job, graph, {"asmr_batch_submission_id": identity}],
                             "outputs": outputs, "status": {"completed": True, "status_str": "error" if self.auxiliary_failure else "success"}}
        return job

    def get(self, route):
        if route == "/object_info":
            return self.info
        if route.startswith("/history/"):
            job = route.removeprefix("/history/")
            return {job: self.history[job]} if job in self.history else {}
        if route.startswith("/history"):
            return self.history
        return {"queue_running": [], "queue_pending": []}

    def download(self, locator, target):
        self.downloads.append(copy.deepcopy(locator))
        if locator["filename"].endswith(".png"):
            if self.png_failure:
                raise runner.ApiError("temporary image download error")
            data = png(int(locator["filename"].split("-")[1].split(".")[0]) % 255)
        else:
            data = b"binary-workflow-video\x00\xff:" + locator["filename"].encode()
        Path(target).parent.mkdir(parents=True, exist_ok=True)
        Path(target).write_bytes(data)


class NativeTailTests(unittest.TestCase):
    def setUp(self):
        ROOT.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT)
        self.root = Path(self.temp.name)
        (self.root / "character.png").write_bytes(png())
        with wave.open(str(self.root / "speech.wav"), "wb") as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(8000)
            audio.writeframes(b"\x00\x00" * 4000)
        self.template = (SOURCE / "workflow_api.json").read_bytes()
        (self.root / "workflow_api.json").write_bytes(self.template)
        self.manifest = {"format": "asmr-video-package", "version": 1, "projectId": "native-test",
                         "workflow": "workflow_api.json", "characterReference": "character.png",
                         "shots": [{"id": "first", "order": 1, "kind": "speech", "referenceMode": "new", "prompt": "First", "durationSeconds": .5, "audio": "speech.wav"},
                                   {"id": "second", "order": 2, "kind": "ambient", "referenceMode": "continuous", "prompt": "Quiet room", "durationSeconds": 2}]}
        (self.root / "project.json").write_text(json.dumps(self.manifest), encoding="utf-8")
        self.client = Comfy()

    def tearDown(self):
        self.temp.cleanup()

    def batch(self, **options):
        return runner.BatchRunner(self.root, client=self.client, poll_interval=.001, job_timeout=.01,
                                  missing_grace=.002, log=lambda message: None, **options)

    def candidate(self, batch, shot="first", number=1):
        return batch.candidate_entry(shot, number)

    def test_graph_uses_original_audio_and_user_tail_node_without_template_rewrite(self):
        batch = self.batch()
        self.assertEqual(batch.run()["succeeded"], 2)
        graph = self.client.posts[0][0]
        self.assertEqual(graph["11"]["inputs"]["audio"], ["24", 0])
        self.assertEqual(graph[runner.TAIL_NODE]["class_type"], "CLFSelectVideoTailFrames")
        self.assertEqual(graph[runner.TAIL_NODE]["inputs"]["video"], ["11", 0])
        self.assertEqual(graph[runner.TAIL_NODE]["inputs"]["n"], 1)
        self.assertEqual(graph["11"]["inputs"]["images"], [runner.FRAME_LIMIT_NODE, 0])
        self.assertEqual(graph[runner.FRAME_LIMIT_NODE]["inputs"]["length"], 12)
        self.assertEqual(graph[runner.TAIL_SAVE_NODE]["inputs"]["images"], [runner.TAIL_NODE, 0])
        self.assertEqual((self.root / "workflow_api.json").read_bytes(), self.template)
        self.assertEqual(len(self.client.posts), 2)
        self.assertIn("ref_images.ref_image_1", self.client.posts[1][0]["22"]["inputs"])

    def test_finished_video_is_exact_download_without_encoder_or_audio_dependency(self):
        batch = self.batch(only="1")
        with mock.patch("subprocess.run", side_effect=AssertionError("No external media process")):
            self.assertEqual(batch.run()["succeeded"], 1)
        receipt = self.candidate(batch)
        output = batch.state_file(receipt["output"])
        self.assertEqual(output.read_bytes(), b"binary-workflow-video\x00\xff:job-1.mp4")
        self.assertEqual(receipt["output_sha256"], receipt["raw_sha256"])

    def test_missing_original_wav_does_not_block_recovery_of_saved_raw(self):
        def fail(*args):
            raise OSError("disk unavailable")
        first = self.batch(only="1", publisher=fail)
        self.assertEqual(first.run()["downloading"], 1)
        (self.root / "speech.wav").unlink()
        second = self.batch(only="1")
        second.load_state()
        self.assertEqual(second.reconcile(self.manifest["shots"][0], self.candidate(second)), "succeeded")
        self.assertEqual(len(self.client.posts), 1)

    def test_old_completed_video_gets_only_a_tail_task_and_keeps_its_fingerprint(self):
        first = self.batch(only="1"); first.run()
        receipt = self.candidate(first)
        original = {key: receipt[key] for key in ("fingerprint", "output", "output_sha256", "prompt_id")}
        for key in ("tail", "tail_sha256", "remote_tail"):
            receipt.pop(key, None)
        first.save()
        second = self.batch(); second.run()
        self.assertEqual({key: self.candidate(second)[key] for key in original}, original)
        self.assertEqual(len([graph for graph, identity in self.client.posts if "22" in graph]), 2)
        tail_graphs = [graph for graph, identity in self.client.posts if "22" not in graph]
        self.assertEqual(len(tail_graphs), 1)
        self.assertEqual(tail_graphs[0]["910"]["class_type"], "LoadVideo")
        self.assertEqual(self.candidate(second)["tail_job"]["status"], "succeeded")

    def test_unknown_tail_request_is_persisted_and_never_blindly_submitted_twice(self):
        first = self.batch(only="1"); first.run()
        receipt = self.candidate(first)
        for key in ("tail", "tail_sha256", "remote_tail"):
            receipt.pop(key, None)
        first.save(); self.client.unknown_tail = True
        for attempt in range(2):
            resumed = self.batch(); resumed.load_state()
            with self.assertRaises(runner.BatchError):
                resumed.previous_tail(1)
        self.assertEqual(len(self.client.posts), 2)
        self.assertEqual(self.candidate(resumed)["tail_job"]["status"], "unknown")
        self.assertEqual(self.candidate(resumed)["status"], "succeeded")

    def test_auxiliary_node_error_does_not_repeat_a_successful_gpu_video(self):
        self.client.auxiliary_failure = True
        batch = self.batch(only="1")
        self.assertEqual(batch.run()["succeeded"], 1)
        self.assertEqual(self.batch(only="1").run()["succeeded"], 1)
        self.assertEqual(len(self.client.posts), 1)

    def test_png_download_error_retains_video_and_resumes_without_h3(self):
        self.client.png_failure = True
        batch = self.batch(only="1")
        self.assertEqual(batch.run()["succeeded"], 1)
        self.assertIn("tail_error", self.candidate(batch))
        self.client.png_failure = False
        resumed = self.batch(); resumed.load_state()
        self.assertTrue(resumed.previous_tail(1).is_file())
        self.assertEqual(len(self.client.posts), 1)

    def test_candidate_tail_references_stay_in_the_same_numbered_lane(self):
        batch = self.batch(candidates=2); batch.run()
        self.assertEqual(len(self.client.posts), 4)
        tails = [self.candidate(batch, number=n)["tail_sha256"] for n in (1, 2)]
        references = [self.client.posts[n][0]["900"]["inputs"]["image"] for n in (2, 3)]
        self.assertEqual(references, [value + ".png" for value in tails])

    def test_non_mp4_savevideo_output_keeps_its_real_container_extension(self):
        self.client.extension = ".webm"
        batch = self.batch(only="1"); batch.run()
        receipt = self.candidate(batch)
        self.assertTrue(receipt["output"].endswith(".webm"))
        self.assertTrue(batch.state_file(receipt["output"]).read_bytes().endswith(b"job-1.webm"))

    def test_missing_required_clf_node_is_detected_before_gpu_submission(self):
        self.client.info.pop("CLFSelectVideoTailFrames")
        with self.assertRaisesRegex(runner.RemotePreflightError, "CLFSelectVideoTailFrames"):
            self.batch().run()
        self.assertFalse(self.client.posts)

    def test_cli_exposes_no_ffmpeg_path(self):
        with mock.patch("sys.stderr", new=io.StringIO()):
            with self.assertRaises(SystemExit):
                runner.parser().parse_args(["project", "--ffmpeg", "irrelevant.exe"])


if __name__ == "__main__":
    unittest.main()
