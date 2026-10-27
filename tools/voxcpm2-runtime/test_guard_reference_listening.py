"""Guard regressions: no real processes, Windows calls or model loading."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


PATH = Path(__file__).with_name("guard_reference_listening.py")
SPEC = importlib.util.spec_from_file_location("guard_reference", PATH)
GUARD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GUARD)


class GuardTests(unittest.TestCase):
    def test_start_threshold_fails_closed(self):
        GUARD.require_start_headroom({"globalCommitAvailableBytes": GUARD.START_FLOOR})
        GUARD.require_start_headroom({"globalCommitAvailableBytes": GUARD.START_FLOOR + 1})
        for row in ({}, {"globalCommitAvailableBytes": GUARD.START_FLOOR - 1}):
            with self.subTest(row=row), self.assertRaisesRegex(RuntimeError, "global_commit_start_floor"):
                GUARD.require_start_headroom(row)

    def test_running_threshold_terminates_only_the_held_handle_once(self):
        for row, expected in (({"globalCommitAvailableBytes": GUARD.RUNNING_FLOOR - 1},
                               "global_commit_below_running_floor"), ({}, "global_commit_unavailable")):
            with self.subTest(row=row):
                resources = Mock(native=0x123456789ABC)
                resources.running.return_value = True
                resources.kernel.TerminateProcess.return_value = 1
                monitor = GUARD.CommitMonitor.__new__(GUARD.CommitMonitor)
                monitor.resources, monitor.abort = resources, None
                monitor.inspect({"globalCommitAvailableBytes": GUARD.RUNNING_FLOOR})
                resources.kernel.TerminateProcess.assert_not_called()
                monitor.inspect(row)
                monitor.inspect(row)
                resources.kernel.TerminateProcess.assert_called_once_with(
                    resources.native, GUARD.GUARD_EXIT_CODE)
                resources.kernel.OpenProcess.assert_not_called()
                self.assertEqual(monitor.abort["reason"], expected)
                self.assertTrue(monitor.abort["termination"]["accepted"])

    def test_multiple_items_rejected_before_runner_or_any_native_launch(self):
        root = Path("I:/AI/asmr_director/tmp")
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="commit-guard-test-", dir=root) as directory:
            temp = Path(directory)
            manifest = temp / "manifest.json"
            manifest.write_text(json.dumps({"references": [{"id": "voice"}],
                                           "texts": [{"id": "one"}, {"id": "two"}]}))
            runner = Mock()
            runner.read_json.side_effect = lambda path: json.loads(path.read_text())
            args = SimpleNamespace(manifest=manifest, output_root=temp / "out",
                                   evidence_dir=temp / "evidence", profile=temp / "profile")
            with redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, "exactly one"):
                GUARD.run_guarded(runner, Mock(), args)
            runner.main.assert_not_called()
            runner.runtime_lock.assert_not_called()
            self.assertFalse(args.evidence_dir.exists())
            GUARD.require_single_pair({"references": [{}], "texts": [{}]})


if __name__ == "__main__":
    unittest.main()
