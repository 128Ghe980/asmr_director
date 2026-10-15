import importlib.util
import io
from pathlib import Path
import queue
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location("comfy_batch_controls", Path(__file__).with_name("runner.py"))
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class RunnerControlTests(unittest.TestCase):
    def test_cli_defaults_to_one_candidate_and_unlimited_healthy_job_wait(self):
        args = runner.parser().parse_args(["package"])
        self.assertEqual(args.candidates, 1)
        self.assertEqual(args.job_timeout, 0)
        self.assertEqual(args.request_timeout, 30)
        self.assertEqual(args.disconnect_timeout, 300)
        self.assertEqual(args.heartbeat_interval, 15)

    def test_cli_keeps_candidate_selector_for_last_colon_resolution_in_runner(self):
        args = runner.parser().parse_args(["package", "--candidates", "3", "--rerun-candidates", "scene:two:2,003:1", "--job-timeout", "120"])
        self.assertEqual(args.candidates, 3)
        self.assertEqual(args.rerun_candidates, "scene:two:2,003:1")
        self.assertEqual(args.job_timeout, 120)

    def test_cli_rejects_invalid_candidate_and_timeout_numbers(self):
        for option, value in [("--candidates", "0"), ("--candidates", "1.5"), ("--job-timeout", "-1"),
                              ("--job-timeout", "nan"), ("--request-timeout", "0"), ("--disconnect-timeout", "inf")]:
            with self.subTest(option=option, value=value), mock.patch("sys.stderr", new=io.StringIO()):
                with self.assertRaises(SystemExit):
                    runner.parser().parse_args(["package", option, value])

    def test_gui_options_validate_before_starting_a_worker_and_convert_minutes(self):
        result = runner.gui_options({"package": "  project  ", "character_image": "", "ffmpeg": "", "comfy_url": "http://localhost:8188",
                                     "candidates": "3", "job_minutes": "2.5", "only": " 2,3 ", "rerun": "", "rerun_candidates": "scene:two:2"}, concat=True)
        self.assertEqual(result["package"], "project")
        self.assertEqual(result["candidates"], 3)
        self.assertEqual(result["job_timeout"], 150)
        self.assertIsNone(result["character_image"])
        self.assertIsNone(result["ffmpeg"])
        self.assertEqual(result["only"], "2,3")
        self.assertIsNone(result["rerun"])
        self.assertEqual(result["rerun_candidates"], "scene:two:2")
        self.assertTrue(result["concat"])
        self.assertNotIn("job_minutes", result)
        self.assertEqual(runner.gui_options({"package": "project"})["job_timeout"], 0)

    def test_gui_rejects_blank_project_or_bad_numbers(self):
        for raw in [{"package": " "}, {"package": "project", "candidates": "0"},
                    {"package": "project", "job_minutes": "nan"}, {"package": "project", "job_minutes": "-1"}]:
            with self.subTest(raw=raw), self.assertRaises(runner.BatchError):
                runner.gui_options(raw)

    def test_progress_text_updates_elapsed_time_without_another_http_event(self):
        progress = {"phase": "running", "shot_id": "shot_2", "candidate_index": 3, "completed": 1, "total": 6}
        first = runner.gui_progress_text(progress, 65, 130)
        later = runner.gui_progress_text(progress, 70, 135)
        self.assertIn("shot_2", first)
        self.assertIn("候选 3", first)
        self.assertIn("1/6", first)
        self.assertIn("01:05", first)
        self.assertIn("01:10", later)
        self.assertNotEqual(first, later)

    def test_gui_event_queue_is_bounded_and_keeps_completion_event(self):
        events = queue.Queue(maxsize=3)
        for value in range(10):
            runner.queue_gui_event(events, "log", str(value))
        runner.queue_gui_event(events, "done", None)
        self.assertLessEqual(events.qsize(), 3)
        kept = [events.get_nowait() for _ in range(events.qsize())]
        self.assertEqual(kept[-1], ("done", None))

    def test_keyboard_interrupt_reports_recovery_and_returns_130(self):
        with mock.patch.object(runner, "BatchRunner") as factory, mock.patch("sys.stderr", new=io.StringIO()) as error:
            factory.return_value.run.side_effect = KeyboardInterrupt
            self.assertEqual(runner.main(["package"]), 130)
            self.assertIn("恢复", error.getvalue())
            self.assertIn("ComfyUI", error.getvalue())

    def test_stopped_run_does_not_report_success(self):
        with mock.patch.object(runner, "BatchRunner") as factory:
            factory.return_value.run.return_value = {"stopped": True, "succeeded": 1}
            self.assertEqual(runner.main(["package"]), 130)


if __name__ == "__main__":
    unittest.main()
