import importlib.util
import io
from pathlib import Path
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location("comfy_batch_append_controls", Path(__file__).with_name("runner.py"))
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class AppendControlsTests(unittest.TestCase):
    def test_cli_distinguishes_resume_target_and_append_and_forwards_seed(self):
        with mock.patch.object(runner, "BatchRunner") as batch:
            batch.return_value.run.return_value = {}
            for options, expected in [
                ([], (None, None, None)),
                (["--candidates", "1"], (1, None, None)),
                (["--append-candidates", "3", "--seed", "46"], (None, 3, 46))
            ]:
                with self.subTest(options=options):
                    self.assertEqual(runner.main(["package", *options]), 0)
                    values = batch.call_args.kwargs
                    self.assertEqual((values["candidates"], values["append_candidates"], values["seed"]), expected)

    def test_cli_rejects_invalid_append_or_both_counts(self):
        for suffix in [["0"], ["-1"], ["1.2"], ["2", "--candidates", "1"]]:
            with self.subTest(suffix=suffix), mock.patch("sys.stderr", new=io.StringIO()), self.assertRaises(SystemExit):
                runner.parser().parse_args(["package", "--append-candidates", *suffix])

    def test_append_is_one_full_version_regardless_of_target_field(self):
        options = runner.gui_options({"package": "project", "candidates": "8"}, append_version=True, dry_run=True, concat=True)
        self.assertIsNone(options["candidates"])
        self.assertEqual(options["append_candidates"], 1)
        self.assertTrue(options["dry_run"])
        self.assertTrue(options["concat"])
        self.assertIsNone(runner.gui_options({"package": "project", "candidates": " "})["candidates"])
        for field in ("only", "rerun", "rerun_candidates", "rerun_asmr", "rerun_asmr_candidates"):
            with self.subTest(field=field), self.assertRaisesRegex(runner.BatchError, "追加"):
                runner.gui_options({"package": "project", field: "1"}, append_version=True)

    def test_absolute_candidate_number_survives_final_dry_run_and_partial_status(self):
        for result, expected in [
            ({"succeeded": 3}, "本轮结束"), ({"stopped": True}, "本批已停止，可继续"),
            ({"dry_run": 3}, "项目检查结束"), ({"asmr_preview_failed": 1}, "有任务待处理"),
        ]:
            with self.subTest(result=result):
                text = runner.gui_progress_text(runner.gui_result_status(result, range(4, 6)))
                self.assertIn("候选 4 至 5", text)
                self.assertIn(expected, text)

    def test_tk_buttons_dispatch_append_then_resume_and_prevent_double_start(self):
        try:
            import tkinter as tk
            from tkinter import ttk
            window = tk.Tk()
            window.withdraw()
        except Exception as error:
            self.skipTest("Tk unavailable: " + str(error))
        self.addCleanup(window.destroy)

        def widgets(widget):
            for child in widget.winfo_children():
                yield child
                yield from widgets(child)

        def exercise_buttons():
            buttons = {w.cget("text"): w for w in widgets(window) if isinstance(w, ttk.Button)}
            append, resume = buttons["再生成一版"], buttons["开始 / 断点继续"]
            count_label = next(w for w in widgets(window) if isinstance(w, ttk.Label) and "每镜候选总数" in w.cget("text"))
            count = count_label.master.grid_slaves(row=0, column=1)[0]
            count.insert(0, "1")
            append.invoke()
            self.assertEqual(batch.call_args.kwargs["append_candidates"], 1)
            self.assertIsNone(batch.call_args.kwargs["candidates"])
            self.assertEqual(count.get(), "")
            self.assertTrue(append.instate(["disabled"]))
            self.assertTrue(resume.instate(["disabled"]))
            append.invoke()
            self.assertEqual(batch.call_count, 1)
            tick = window.after.call_args.args[1]
            tick()
            resume.invoke()
            self.assertEqual(batch.call_count, 2)
            self.assertIsNone(batch.call_args.kwargs["append_candidates"])
            self.assertIsNone(batch.call_args.kwargs["candidates"])

        with (mock.patch.object(tk, "Tk", return_value=window),
              mock.patch.object(window, "after"),
              mock.patch.object(window, "mainloop", side_effect=exercise_buttons),
              mock.patch.object(runner, "gui_default_package", return_value="."),
              mock.patch.object(runner, "BatchRunner") as batch,
              mock.patch.object(runner.threading, "Thread", side_effect=lambda *, target, daemon: mock.Mock(start=target))):
            batch.return_value.dry_run = True
            batch.return_value.candidate_range = range(2, 3)
            batch.return_value.run.return_value = {"succeeded": 3}
            self.assertEqual(runner.launch_gui(), 0)


if __name__ == "__main__":
    unittest.main()
