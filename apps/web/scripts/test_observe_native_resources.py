"""Pure observer protocol tests; no Windows API, GPU query or model execution."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("native_observer", Path(__file__).with_name("observe-native-resources.py"))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class NativeResourceSamplesTest(unittest.TestCase):
    def test_missing_process_values_stay_unknown(self):
        samples = observer.ResourceSamples()
        samples.add({"elapsedSeconds": 0, "physicalAvailableBytes": 123})
        self.assertIsNone(samples.tail[0]["nativePrivateBytes"])
        self.assertIsNone(samples.ranges["nativeWorkingSetBytes"])
        self.assertEqual(samples.ranges["physicalAvailableBytes"], {"min": 123, "max": 123, "last": 123})

    def test_bounds_tail_and_keeps_whole_run_extrema(self):
        samples = observer.ResourceSamples()
        for value in range(100):
            samples.add({"elapsedSeconds": value, "globalCommitAvailableBytes": value})
        self.assertEqual(samples.count, 100)
        self.assertEqual(len(samples.tail), 32)
        self.assertEqual(samples.tail[0]["elapsedSeconds"], 68)
        self.assertEqual(samples.ranges["globalCommitAvailableBytes"], {"min": 0, "max": 99, "last": 99})

    def test_failed_sample_does_not_replace_last_known_measurement(self):
        samples = observer.ResourceSamples()
        samples.add({"elapsedSeconds": 0, "nativePrivateBytes": 15})
        samples.add({"elapsedSeconds": 1})
        self.assertIsNone(samples.tail[-1]["nativePrivateBytes"])
        self.assertEqual(samples.ranges["nativePrivateBytes"]["last"], 15)

    def test_gpu_parser_treats_na_as_unknown_and_uses_mib(self):
        self.assertEqual(observer.parse_gpu_line("GPU-test, 6144, 1024, 5120"),
                         {"uuid": "GPU-test", "totalBytes": 6144 * 1024 ** 2,
                          "usedBytes": 1024 * 1024 ** 2, "freeBytes": 5120 * 1024 ** 2})
        self.assertIsNone(observer.parse_gpu_line("GPU-test, 6144, N/A, 5120"))
        self.assertIsNone(observer.parse_gpu_line("malformed"))

    def test_gpu_extrema_are_whole_device_sampled_values(self):
        gpu = observer.GpuSamples()
        gpu.add(observer.parse_gpu_line("GPU-test, 6144, 1024, 5120"))
        gpu.add(observer.parse_gpu_line("GPU-test, 6144, 2048, 4096"))
        result = gpu.summary()
        self.assertEqual(result["status"], "available")
        self.assertEqual(result["sampleCount"], 2)
        self.assertEqual(result["devices"][0]["minimumFreeBytes"], 4096 * 1024 ** 2)
        self.assertEqual(result["devices"][0]["maximumUsedBytes"], 2048 * 1024 ** 2)
        self.assertEqual(observer.GpuSamples().summary(), {"status": "unavailable", "sampleCount": 0, "devices": []})

    def test_system_commit_is_global_pages_times_page_size(self):
        resources = observer.WindowsResources.__new__(observer.WindowsResources)
        resources.native = None
        resources.kernel = MagicMock()
        resources.psapi = MagicMock()

        def performance(pointer, _size):
            info = pointer._obj
            info.CommitTotal, info.CommitLimit, info.PhysicalAvailable, info.PageSize = 7, 10, 4, 4096
            return True

        resources.psapi.GetPerformanceInfo.side_effect = performance
        row = resources.sample(.25)
        self.assertEqual(row["globalCommitUsedBytes"], 7 * 4096)
        self.assertEqual(row["globalCommitLimitBytes"], 10 * 4096)
        self.assertEqual(row["globalCommitAvailableBytes"], 3 * 4096)
        self.assertEqual(row["physicalAvailableBytes"], 4 * 4096)
        self.assertNotIn("nativePrivateBytes", row)
        resources.psapi.GetProcessMemoryInfo.assert_not_called()

    def test_failed_memory_api_does_not_produce_zero_values(self):
        resources = observer.WindowsResources.__new__(observer.WindowsResources)
        resources.native = 123
        resources.kernel = MagicMock()
        resources.kernel.WaitForSingleObject.return_value = 0x102
        resources.psapi = MagicMock()
        resources.psapi.GetPerformanceInfo.return_value = False
        resources.psapi.GetProcessMemoryInfo.return_value = False
        self.assertEqual(resources.sample(1), {"elapsedSeconds": 1})

    def test_job_guard_only_assigns_this_observer_and_retains_handle(self):
        resources = observer.WindowsResources.__new__(observer.WindowsResources)
        resources.kernel = MagicMock()
        resources.kernel.CreateJobObjectW.return_value = 99
        resources.kernel.GetCurrentProcess.return_value = 55
        resources.kernel.SetInformationJobObject.return_value = True
        resources.kernel.AssignProcessToJobObject.return_value = True
        self.assertTrue(resources.guard_gpu_child())
        resources.kernel.AssignProcessToJobObject.assert_called_once_with(99, 55)
        limits = resources.kernel.SetInformationJobObject.call_args.args[2]._obj
        self.assertEqual(limits.BasicLimitInformation.LimitFlags, 0x2000)
        resources.kernel.CloseHandle.assert_not_called()
        self.assertEqual(resources.job, 99)

    def test_unavailable_job_guard_does_not_start_a_gpu_child(self):
        resources = MagicMock()
        resources.native = None
        resources.guard_gpu_child.return_value = False
        resources.sample.return_value = {"elapsedSeconds": 0}
        output = io.StringIO()
        with patch.object(observer.sys, "platform", "win32"), \
                patch.object(observer.sys, "argv", ["observer", "--pid", "123", "--parent-pid", "456"]), \
                patch.object(observer.os, "getppid", return_value=456), \
                patch.object(observer, "WindowsResources", return_value=resources), \
                patch.object(observer.subprocess, "Popen") as spawn, \
                patch.object(observer.sys, "stdout", output):
            observer.main()
        result = json.loads(output.getvalue())
        self.assertEqual(result["stopReason"], "native_unavailable")
        self.assertIsNone(result["samples"][0]["nativePrivateBytes"])
        self.assertIn("job_guard_unavailable", result["unavailable"])
        spawn.assert_not_called()
        resources.close_process_handles.assert_called_once()

    def test_pipe_poll_handles_eof_without_reading_buffered_stdin(self):
        resources = observer.WindowsResources.__new__(observer.WindowsResources)
        resources.kernel = MagicMock()
        resources.kernel.PeekNamedPipe.return_value = False
        resources.get_osfhandle = lambda fd: fd
        with patch.object(observer.C, "get_last_error", return_value=109, create=True), \
                patch.object(observer.os, "read") as read:
            self.assertEqual(resources.read_pipe(0), ("closed", b""))
        read.assert_not_called()

    def test_pipe_poll_never_reads_when_no_bytes_are_available(self):
        resources = observer.WindowsResources.__new__(observer.WindowsResources)
        resources.kernel = MagicMock()
        resources.kernel.PeekNamedPipe.return_value = True
        resources.get_osfhandle = lambda fd: fd
        with patch.object(observer.os, "read") as read:
            self.assertEqual(resources.read_pipe(0), ("open", b""))
        read.assert_not_called()

    def test_pipe_poll_caps_each_unbuffered_read(self):
        resources = observer.WindowsResources.__new__(observer.WindowsResources)
        resources.kernel = MagicMock()
        resources.get_osfhandle = lambda fd: fd

        def peek(_handle, _buffer, _size, _read, available, _left):
            available._obj.value = 50_000
            return True

        resources.kernel.PeekNamedPipe.side_effect = peek
        with patch.object(observer.os, "read", return_value=b"data") as read:
            self.assertEqual(resources.read_pipe(42), ("open", b"data"))
        read.assert_called_once_with(42, 4096)

    def test_gpu_pipe_accepts_split_lines_and_bounds_pending_bytes(self):
        resources = MagicMock()
        resources.read_pipe.side_effect = [("open", b"GPU-test, 6144, 1024, "),
                                           ("open", b"5120\n"), ("open", b"")]
        gpu = observer.GpuSamples()
        reader = observer.GpuPipeReader(42, resources, gpu)
        reader.pump()
        self.assertEqual(gpu.summary()["sampleCount"], 1)
        self.assertEqual(gpu.summary()["devices"][0]["minimumFreeBytes"], 5120 * 1024 ** 2)
        resources.read_pipe.side_effect = [("open", b"x" * 4096)] * 4
        reader.pump()
        self.assertLessEqual(len(reader.pending), 1024)

    def test_gpu_pipe_poll_is_bounded_and_handles_a_closed_pipe(self):
        resources = MagicMock()
        resources.read_pipe.return_value = ("open", b"x" * 4096)
        reader = observer.GpuPipeReader(42, resources, observer.GpuSamples())
        reader.pump()
        self.assertEqual(resources.read_pipe.call_count, 4)
        resources.read_pipe.return_value = ("closed", b"")
        reader.pump()
        self.assertTrue(reader.closed)

    def test_wrapped_python_does_not_start_gpu_or_observe_the_native_process(self):
        output = io.StringIO()
        with patch.object(observer.sys, "platform", "win32"), \
                patch.object(observer.sys, "argv", ["observer", "--pid", "123", "--parent-pid", "456"]), \
                patch.object(observer.os, "getppid", return_value=999), \
                patch.object(observer, "WindowsResources") as resources, \
                patch.object(observer.subprocess, "Popen") as spawn, \
                patch.object(observer.sys, "stdout", output):
            observer.main()
        result = json.loads(output.getvalue())
        self.assertEqual(result["stopReason"], "observer_error")
        self.assertEqual(result["sampleCount"], 0)
        self.assertIn("observer_error", result["unavailable"])
        resources.assert_not_called()
        spawn.assert_not_called()


if __name__ == "__main__":
    unittest.main()
