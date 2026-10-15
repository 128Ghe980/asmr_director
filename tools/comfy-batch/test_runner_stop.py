import importlib.util
from pathlib import Path
import threading
import time
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location("comfy_batch_stop", Path(__file__).with_name("runner.py"))
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class RunnerStopBoundaryTests(unittest.TestCase):
    def waiting_runner(self):
        batch = runner.BatchRunner.__new__(runner.BatchRunner)
        batch.log, batch.save = mock.Mock(), mock.Mock()
        batch.job_timeout, batch.missing_grace = 0, 0
        batch.poll_interval, batch.heartbeat_interval = .002, .000001
        batch.disconnect_timeout = .001
        batch.stop_event = threading.Event()
        batch.current_task_label = "shot / candidate 1"
        batch.completed_tasks, batch.total_tasks, batch.candidates = 0, 1, 1
        return batch

    def test_stop_from_callback_wins_over_missing_disconnect_and_job_limits(self):
        for scenario in ("missing", "disconnect", "job_timeout"):
            with self.subTest(scenario=scenario):
                batch = self.waiting_runner()
                receipt = {"shot_id": "shot", "candidate_index": 1, "submission_id": "submission",
                           "prompt_id": "prompt", "status": "queued"}
                events, reports = [], []

                def status(event):
                    events.append(event)
                    if event["phase"] in ("checking", "disconnected", "queued"):
                        reports.append(event)
                        if scenario != "disconnect" or len(reports) >= 2:
                            batch.stop_event.set()

                def get(route):
                    if scenario == "disconnect":
                        raise runner.ApiError("temporary offline")
                    if route.startswith("/history"):
                        return {}
                    if scenario == "job_timeout":
                        time.sleep(.003)
                    return {"queue_running": [], "queue_pending": [] if scenario == "missing" else
                            [[1, "prompt", {}, {}]]}

                batch.client = mock.Mock()
                batch.client.get.side_effect = get
                batch.status_callback = status
                if scenario == "job_timeout":
                    batch.job_timeout = .001
                self.assertEqual(batch.wait_job(receipt), ("paused", None))
                self.assertEqual(receipt["status"], "queued")
                self.assertEqual(receipt["prompt_id"], "prompt")
                self.assertEqual(events[-1]["phase"], "paused")
                batch.client.submit.assert_not_called()

    def test_corrupted_raw_submission_path_cannot_escape_output_root(self):
        batch = self.waiting_runner()
        batch.output = Path(__file__).parent / "outputs-for-path-validation"
        batch.client = mock.Mock()
        receipt = {"submission_id": "../../outside", "kind": "ambient", "status": "downloading",
                   "remote_output": {"filename": "generated.mp4", "type": "output"}}
        with self.assertRaisesRegex(runner.BatchError, "超出 outputs"):
            batch.collect({"id": "shot"}, receipt)
        batch.client.download.assert_not_called()
        batch.save.assert_not_called()

    def test_healthy_queue_remains_waiting_after_two_virtual_hours(self):
        batch = self.waiting_runner()
        clock, queries = [0.0], [0]
        receipt = {"shot_id": "shot", "candidate_index": 1, "submission_id": "submission",
                   "prompt_id": "prompt", "status": "queued"}
        status = mock.Mock()
        batch.status_callback = status

        def get(route):
            if route.startswith("/history"):
                queries[0] += 1
                return {} if queries[0] == 1 else {"prompt": {"status": {"completed": True, "status_str": "success"}}}
            clock[0] = 7201.0
            return {"queue_running": [], "queue_pending": [[1, "prompt", {}, {}]]}

        batch.client = mock.Mock()
        batch.client.get.side_effect = get
        with mock.patch.object(runner.time, "monotonic", side_effect=lambda: clock[0]):
            result, _ = batch.wait_job(receipt)
        self.assertEqual(result, "succeeded")
        self.assertTrue(any(call.args[0]["phase"] == "queued" and call.args[0]["wait_seconds"] > 7200
                            for call in status.call_args_list))
        batch.client.submit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
