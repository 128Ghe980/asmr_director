"""Small stdlib regressions; native processes and the production lock are mocked."""
from contextlib import nullcontext, redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import wave


MODULE_PATH = Path(__file__).with_name("run_reference_listening.py")
SPEC = importlib.util.spec_from_file_location("reference_listening", MODULE_PATH)
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class ReferenceListeningTests(unittest.TestCase):
    def run_fake_batch(self, manifest_overrides=None, reference_overrides=None, result=None, text_count=1):
        temporary_root = Path("I:/AI/asmr_director/tmp")
        if not temporary_root.is_dir():
            temporary_root = MODULE_PATH.parents[2] / ".local" / "tmp"
            temporary_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="reference-listening-test-", dir=temporary_root) as directory:
            root = Path(directory)
            reference_path = root / "reference.wav"
            with wave.open(str(reference_path), "wb") as audio:
                audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                audio.writeframes(b"\x01\x00" * 160)
            profile = {}
            for key in ("cliPath", "baseModelPath", "acousticModelPath"):
                asset = root / key
                asset.write_bytes(b"fixture only: never executed")
                profile[key] = str(asset)
            profile_path = root / "profile.json"
            profile_path.write_text(json.dumps(profile), encoding="utf-8")
            reference = dict(id="voice", name="voice", path=str(reference_path))
            reference.update(reference_overrides or {})
            manifest = {"references": [reference], "seed": 42,
                        "texts": [{"id": f"text-{index}", "text": "坐下喝杯茶。"} for index in range(text_count)]}
            manifest.update(manifest_overrides or {})
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            result = result or {"status": "complete", "oom_detected": False, "fatal_cuda_detected": False}
            stdout = io.StringIO()
            with patch.object(RUNNER, "check_no_native_process"), \
                 patch.object(RUNNER, "runtime_lock", return_value=nullcontext(lambda pid: None)), \
                 patch.object(RUNNER, "run_take", return_value=result) as run_take, \
                 patch.object(RUNNER.sys, "argv", [str(MODULE_PATH), "--manifest", str(manifest_path),
                                                  "--profile", str(profile_path), "--output-root", str(root / "out")]), \
                 redirect_stdout(stdout):
                code = RUNNER.main()
            return code, run_take.call_args_list, stdout.getvalue()

    def test_default_request_keeps_legacy_resume_hash(self):
        for reference_fields in ({}, {"mode": "reference_only"}):
            with self.subTest(reference_fields=reference_fields):
                code, calls, _ = self.run_fake_batch(reference_overrides=reference_fields)
                self.assertEqual(code, 0)
                request, request_sha = calls[0].args[2:4]
                reference = request["reference"]
                self.assertEqual(set(reference), {"id", "name", "file", "metrics"})
                expected = {"mode": "reference_only", "seed": 42, "files": request["files"],
                            "profile": request["profile"],
                            "parameters": {"steps": 600, "timesteps": 10, "cfg": 2,
                                           "temperature": 1, "n_gpu_layers": 0, "low_vram": True},
                            "reference": reference, "text": {"id": "text-0", "text": "坐下喝杯茶。"}}
                self.assertEqual(RUNNER.canonical(request), RUNNER.canonical(expected))
                self.assertEqual(request_sha, hashlib.sha256(RUNNER.canonical(expected)).hexdigest())

    def test_default_command_is_unchanged(self):
        files = {key: {"path": value} for key, value in
                 (("cliPath", "cli.exe"), ("baseModelPath", "base.gguf"), ("acousticModelPath", "acoustic.gguf"))}
        command = RUNNER.build_command(files, {"file": {"path": "reference.wav"}}, {"text": "中文。"}, 42, "output.wav")
        self.assertEqual(command, ["cli.exe", "-t", "中文。", "-o", "output.wav", "--steps", "600",
                                  "--timesteps", "10", "--cfg", "2", "--temperature", "1", "--seed", "42",
                                  "--n-gpu-layers", "0", "--low-vram", "-r", "reference.wav", "base.gguf", "acoustic.gguf"])

    def test_combined_preserves_exact_prompt_and_cfg(self):
        prompt = "こんにちは。\n今日も、ありがとう。 "
        code, calls, _ = self.run_fake_batch({"cfg": 2.5}, {"mode": "combined", "promptText": prompt})
        self.assertEqual(code, 0)
        request = calls[0].args[2]
        self.assertEqual(request["mode"], "combined")
        self.assertEqual(request["parameters"]["cfg"], 2.5)
        self.assertEqual(request["reference"]["promptText"], prompt)
        command = RUNNER.build_command(request["files"], request["reference"], request["text"], 42, "out.wav", 2.5)
        self.assertEqual(command[command.index("--cfg") + 1], "2.5")
        self.assertEqual(command[command.index("--prompt-text") + 1], prompt)
        self.assertEqual(command[command.index("-r") + 1], command[command.index("--prompt-wav") + 1])

    def test_cfg_validation(self):
        self.assertEqual(RUNNER.manifest_cfg({}), 2)
        self.assertIsInstance(RUNNER.manifest_cfg({"cfg": 2.0}), int)
        for value in (1, 1.5, 3):
            self.assertEqual(RUNNER.manifest_cfg({"cfg": value}), value)
        for value in (None, True, "2", 0.99, 3.01, float("nan"), float("inf")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                RUNNER.manifest_cfg({"cfg": value})

    def test_diffusion_timesteps_reach_request_hash_and_command_without_changing_audio_cap(self):
        code, calls, _ = self.run_fake_batch({"timesteps": 20, "cfg": 1.5},
                                             {"mode": "combined", "promptText": "こんにちは。"})
        self.assertEqual(code, 0)
        request, request_sha = calls[0].args[2:4]
        self.assertEqual(request["parameters"]["timesteps"], 20)
        self.assertEqual(request["parameters"]["steps"], 600)
        default_request = dict(request, parameters=dict(request["parameters"], timesteps=10))
        self.assertNotEqual(request_sha, hashlib.sha256(RUNNER.canonical(default_request)).hexdigest())
        self.assertEqual(request_sha, hashlib.sha256(RUNNER.canonical(request)).hexdigest())
        command = RUNNER.build_command(request["files"], request["reference"], request["text"],
                                       request["seed"], "out.wav", request["parameters"]["cfg"],
                                       request["parameters"]["timesteps"])
        self.assertEqual(command[command.index("--timesteps") + 1], "20")
        self.assertEqual(command[command.index("--steps") + 1], "600")
        self.assertEqual(command[command.index("--cfg") + 1], "1.5")

    def test_invalid_timesteps_rejected_before_hashing_or_native_launch(self):
        self.assertEqual(RUNNER.manifest_timesteps({}), 10)
        for value in (4, 10, 20, 30):
            self.assertEqual(RUNNER.manifest_timesteps({"timesteps": value}), value)
        for value in (None, True, "20", 20.0, 3, 31):
            with self.subTest(value=value), patch.object(RUNNER, "identity") as identity, \
                 self.assertRaisesRegex(ValueError, "timesteps"):
                self.run_fake_batch({"timesteps": value})
            identity.assert_not_called()

    def test_run_take_executes_the_timesteps_recorded_in_its_receipt(self):
        temporary_root = Path("I:/AI/asmr_director/tmp")
        temporary_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="reference-command-test-", dir=temporary_root) as directory:
            root = Path(directory)
            files = {key: {"path": str(root / value)} for key, value in
                     (("cliPath", "cli.exe"), ("baseModelPath", "base.gguf"), ("acousticModelPath", "acoustic.gguf"))}
            reference = {"id": "voice", "file": {"path": str(root / "reference.wav")}}
            text = {"id": "line", "text": "こんにちは。"}
            request = {"parameters": {"cfg": 2, "timesteps": 20}}
            pair = root / "audio/voice/line"
            pair.mkdir(parents=True)

            def fake_popen(command, **kwargs):
                with wave.open(command[command.index("-o") + 1], "wb") as audio:
                    audio.setparams((1, 2, 48000, 0, "NONE", "not compressed"))
                    audio.writeframes(b"\x01\x00" * 4800)
                return Mock(pid=123, wait=Mock(return_value=0), poll=Mock(return_value=0))

            with patch.object(RUNNER, "check_no_native_process"), \
                 patch.object(RUNNER.subprocess, "Popen", side_effect=fake_popen) as popen, \
                 redirect_stdout(io.StringIO()):
                receipt = RUNNER.run_take(root, pair, request, "test-request", files,
                                          reference, text, 42, lambda pid: None)
            self.assertEqual(receipt["status"], "complete")
            command = popen.call_args.args[0]
            self.assertEqual(command[command.index("--timesteps") + 1], "20")
            self.assertEqual(command[command.index("--steps") + 1], "600")
            self.assertEqual(receipt["command"], command)
            persisted = RUNNER.read_json(pair / "take-001/receipt.json")
            self.assertEqual(persisted["command"], command)
            self.assertEqual(persisted["request"]["parameters"]["timesteps"], 20)

    def test_bad_reference_mode_and_missing_prompt_rejected(self):
        for row in ({"mode": "continuation"}, {"mode": None}, {"mode": "combined"},
                    {"mode": "combined", "promptText": " \n"}, {"mode": "combined", "promptText": 42}):
            with self.subTest(row=row), self.assertRaises(ValueError):
                RUNNER.reference_options(row)
        with patch.object(RUNNER, "identity") as identity, self.assertRaises(ValueError):
            self.run_fake_batch(reference_overrides={"mode": "combined"})
        identity.assert_not_called()

    def test_memory_and_cuda_failures_are_distinct(self):
        memory = RUNNER.classify_native_failure("fatal : Memory allocation failure")
        self.assertTrue(memory["oom_detected"])
        self.assertFalse(memory["fatal_cuda_detected"])
        self.assertEqual(RUNNER.batch_stop_reason(memory), "oom")
        cuda = RUNNER.classify_native_failure("cublasCreate: CUBLAS_STATUS_NOT_INITIALIZED")
        self.assertFalse(cuda["oom_detected"])
        self.assertTrue(cuda["fatal_cuda_detected"])
        self.assertEqual(RUNNER.batch_stop_reason(cuda), "fatal_cuda")
        self.assertIsNone(RUNNER.batch_stop_reason(RUNNER.classify_native_failure("normal completion")))

    def test_fatal_cuda_or_oom_stops_before_next_text(self):
        for log, reason in (("CUBLAS_STATUS_NOT_INITIALIZED", "fatal_cuda"),
                            ("fatal : Memory allocation failure", "oom")):
            result = dict(status="failed", **RUNNER.classify_native_failure(log))
            code, calls, stdout = self.run_fake_batch(result=result, text_count=2)
            self.assertEqual(code, 2)
            self.assertEqual(len(calls), 1)
            self.assertIn(f'"reason": "{reason}"', stdout)


if __name__ == "__main__":
    unittest.main()
