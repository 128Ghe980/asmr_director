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
        result = runner.gui_options({"package": "  project  ", "character_image": "", "comfy_url": "http://localhost:8188",
                                     "candidates": "3", "job_minutes": "2.5", "only": " 2,3 ", "rerun": "", "rerun_candidates": "scene:two:2"}, dry_run=True, concat=True)
        self.assertEqual(result["package"], "project")
        self.assertEqual(result["candidates"], 3)
        self.assertEqual(result["job_timeout"], 150)
        self.assertIsNone(result["character_image"])
        self.assertNotIn("ffmpeg", result)
        self.assertEqual(result["only"], "2,3")
        self.assertIsNone(result["rerun"])
        self.assertEqual(result["rerun_candidates"], "scene:two:2")
        self.assertTrue(result["dry_run"])
        self.assertTrue(result["concat"])
        self.assertNotIn("job_minutes", result)
        self.assertEqual(runner.gui_options({"package": "project"})["job_timeout"], 0)
        self.assertFalse(runner.gui_options({"package": "project"})["concat"])

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


class FakeLogWidget:
    def __init__(self, content="", *, selected="", view=(0.0, 1.0)):
        self.content = content
        self.selected = selected
        self.view = view
        self.top = "2.0"
        self.state = "disabled"
        self.bindings = {}
        self.scrolls = []
        self.seen = []
        self.deleted = []
        self.focused = False

    def tag_ranges(self, tag):
        return ("1.0", "1.4") if self.selected else ()

    def tag_add(self, tag, first, last):
        self.selected = self.content

    def get(self, first, last):
        if first == "sel.first":
            if not self.selected:
                raise LookupError("no selection")
            return self.selected
        return self.content

    def bind(self, sequence, callback, add=None):
        self.bindings[sequence] = callback

    def focus_set(self):
        self.focused = True

    def yview(self, *args):
        if args:
            self.scrolls.append(args[0])
        return self.view

    def index(self, position):
        return self.top if position == "@0,0" else str(self.content.count("\n") + 1) + ".0"

    def configure(self, *, state):
        self.state = state

    def insert(self, position, text):
        if self.state != "normal":
            raise RuntimeError("read-only widget")
        self.content += text

    def delete(self, first, last):
        self.deleted.append((first, last))
        count = int(last.split(".")[0]) - 1
        self.content = "".join(self.content.splitlines(keepends=True)[count:])

    def see(self, position):
        self.seen.append(position)


class GuiLogTests(unittest.TestCase):
    def test_copy_all_preserves_multiline_unicode_and_does_not_modify_log(self):
        content = "错误：视频生成失败\n完整原生错误行 / 路径有空格\n"
        widget, clipboard = FakeLogWidget(content), mock.Mock()
        self.assertTrue(runner.gui_copy_log(widget, clipboard=clipboard))
        clipboard.clipboard_clear.assert_called_once_with()
        clipboard.clipboard_append.assert_called_once_with(content)
        self.assertEqual(widget.content, content)
        self.assertEqual(widget.state, "disabled")

    def test_copy_selected_uses_only_the_selection_and_never_clears_for_no_selection(self):
        widget, clipboard = FakeLogWidget("whole log", selected="selected error"), mock.Mock()
        self.assertTrue(runner.gui_copy_log(widget, selected=True, clipboard=clipboard))
        clipboard.clipboard_append.assert_called_once_with("selected error")
        clipboard.reset_mock()
        widget.selected = ""
        self.assertFalse(runner.gui_copy_log(widget, selected=True, clipboard=clipboard))
        clipboard.clipboard_clear.assert_not_called()
        clipboard.clipboard_append.assert_not_called()

    def test_empty_log_or_unavailable_clipboard_does_not_raise_or_change_text(self):
        clipboard = mock.Mock()
        self.assertFalse(runner.gui_copy_log(FakeLogWidget(), clipboard=clipboard))
        clipboard.clipboard_clear.assert_not_called()
        clipboard.clipboard_clear.side_effect = RuntimeError("clipboard busy")
        widget = FakeLogWidget("preserved")
        self.assertFalse(runner.gui_copy_log(widget, clipboard=clipboard))
        self.assertEqual(widget.content, "preserved")

    def test_control_a_and_c_handle_events_without_editing_or_using_the_system_clipboard(self):
        widget, clipboard = FakeLogWidget("first\nsecond\n"), mock.Mock()
        view = runner.GuiLogView(widget, clipboard=clipboard)
        view.bind_shortcuts()
        self.assertEqual(widget.bindings["<Control-a>"](object()), "break")
        self.assertTrue(widget.focused)
        self.assertEqual(widget.bindings["<Control-c>"](object()), "break")
        clipboard.clipboard_append.assert_called_once_with("first\nsecond\n")
        self.assertIn("<Control-A>", widget.bindings)
        self.assertIn("<Control-C>", widget.bindings)
        self.assertIn("<<Copy>>", widget.bindings)
        self.assertEqual(widget.state, "disabled")

    def test_append_preserves_selection_and_old_view_instead_of_following_or_trimming(self):
        widget = FakeLogWidget("old error\ncontext\n", selected="old error")
        runner.GuiLogView(widget, max_lines=2).append("new progress")
        self.assertEqual(widget.selected, "old error")
        self.assertEqual(widget.scrolls, ["2.0"])
        self.assertFalse(widget.seen)
        self.assertFalse(widget.deleted)
        self.assertIn("old error", widget.content)
        self.assertEqual(widget.state, "disabled")

    def test_scrollback_without_selection_is_not_forced_to_the_bottom(self):
        widget = FakeLogWidget("first\nsecond\n", view=(0.0, .5))
        runner.GuiLogView(widget, max_lines=2).append("third")
        self.assertEqual(widget.scrolls, ["2.0"])
        self.assertFalse(widget.seen)
        self.assertFalse(widget.deleted)

    def test_drag_selection_pauses_following_and_normal_tail_reading_resumes_bounded_logs(self):
        widget = FakeLogWidget("first\nsecond\n")
        view = runner.GuiLogView(widget, max_lines=3)
        view.bind_shortcuts()
        widget.bindings["<ButtonPress-1>"](object())
        view.append("third")
        self.assertFalse(widget.seen)
        self.assertFalse(widget.deleted)
        widget.bindings["<ButtonRelease-1>"](object())
        view.append("fourth")
        self.assertEqual(widget.seen, ["end"])
        self.assertTrue(widget.deleted)
        self.assertLessEqual(widget.content.count("\n") + 1, 3)
        self.assertEqual(widget.state, "disabled")

    def test_append_restores_read_only_state_even_if_painting_fails(self):
        widget = FakeLogWidget()
        with mock.patch.object(widget, "insert", side_effect=RuntimeError("widget failure")):
            with self.assertRaises(RuntimeError):
                runner.GuiLogView(widget).append("message")
        self.assertEqual(widget.state, "disabled")

    def test_real_tk_copy_uses_a_stub_clipboard_and_refresh_keeps_text_read_only(self):
        try:
            import tkinter as tk
            window = tk.Tk()
            window.withdraw()
        except Exception as error:
            self.skipTest("Tk unavailable: " + str(error))
        try:
            widget = tk.Text(window, state="disabled", exportselection=False, takefocus=True)
            widget.pack()
            clipboard = mock.Mock()
            view = runner.GuiLogView(widget, clipboard=clipboard)
            view.bind_shortcuts()
            view.append("错误详情\n第二行")
            widget.tag_add("sel", "1.0", "1.4")
            view.copy_selected()
            clipboard.clipboard_append.assert_called_once_with("错误详情")
            view.append("后续进度")
            self.assertEqual(widget.get("sel.first", "sel.last"), "错误详情")
            self.assertEqual(str(widget.cget("state")), "disabled")
            before = widget.get("1.0", "end-1c")
            widget.insert("end", "must not edit")
            self.assertEqual(widget.get("1.0", "end-1c"), before)
            clipboard.reset_mock()
            view.copy_all()
            clipboard.clipboard_append.assert_called_once_with(before)
        finally:
            window.destroy()


if __name__ == "__main__":
    unittest.main()
