"""Bounded, standard-library-only Windows observer. Never controls the native PID.

The stdout protocol is one final JSON summary; stdin EOF requests completion.
System commit comes from GetPerformanceInfo, not ullAvailPageFile (which is the
calling process's additional commit allowance). GPU data describe the whole
device and do not establish the cause of a failed native allocation.
"""
import argparse
from collections import deque
import ctypes as C
import ctypes.wintypes as W
from datetime import datetime, timezone
import json
import math
import os
import shutil
import subprocess
import sys
import time

SAMPLE_INTERVAL_SECONDS = .25
MAX_SECONDS = 600
METRICS = (
    "physicalAvailableBytes", "globalCommitUsedBytes", "globalCommitLimitBytes",
    "globalCommitAvailableBytes", "nativeWorkingSetBytes",
    "nativePeakWorkingSetBytes", "nativePrivateBytes",
)


class ResourceSamples:
    def __init__(self):
        self.tail = deque(maxlen=32)
        self.ranges = {name: None for name in METRICS}
        self.count = 0

    def add(self, values):
        sample = {"elapsedSeconds": values["elapsedSeconds"]}
        for name in METRICS:
            value = values.get(name)
            sample[name] = value
            if value is not None:
                previous = self.ranges[name]
                self.ranges[name] = {
                    "min": min(previous["min"], value) if previous else value,
                    "max": max(previous["max"], value) if previous else value,
                    "last": value,
                }
        self.tail.append(sample)
        self.count += 1


def parse_gpu_line(line):
    fields = [field.strip() for field in line.split(",")]
    if len(fields) != 4 or not fields[0] or len(fields[0]) > 128:
        return None
    try:
        values = [float(field) for field in fields[1:]]
        if any(not math.isfinite(value) or value < 0 for value in values):
            return None
        total, used, free = [int(value * 1024 ** 2) for value in values]
        return {"uuid": fields[0], "totalBytes": total, "usedBytes": used, "freeBytes": free}
    except (ValueError, OverflowError):
        return None


class GpuSamples:
    def __init__(self):
        self.devices = {}
        self.count = 0

    def add(self, row):
        if row is None:
            return
        previous = self.devices.get(row["uuid"])
        if previous is None and len(self.devices) >= 16:
            return
        self.devices[row["uuid"]] = {
            "uuid": row["uuid"], "totalBytes": row["totalBytes"],
            "minimumFreeBytes": min(previous["minimumFreeBytes"], row["freeBytes"]) if previous else row["freeBytes"],
            "maximumUsedBytes": max(previous["maximumUsedBytes"], row["usedBytes"]) if previous else row["usedBytes"],
            "lastFreeBytes": row["freeBytes"], "lastUsedBytes": row["usedBytes"],
        }
        self.count += 1

    def summary(self):
        return {"status": "available" if self.count else "unavailable", "sampleCount": self.count,
                "devices": [dict(row) for row in self.devices.values()]}


class PerformanceInfo(C.Structure):
    _fields_ = [("cb", W.DWORD)] + [(name, C.c_size_t) for name in (
        "CommitTotal", "CommitLimit", "CommitPeak", "PhysicalTotal", "PhysicalAvailable",
        "SystemCache", "KernelTotal", "KernelPaged", "KernelNonpaged", "PageSize",
    )] + [(name, W.DWORD) for name in ("HandleCount", "ProcessCount", "ThreadCount")]


class ProcessMemory(C.Structure):
    _fields_ = [("cb", W.DWORD), ("PageFaultCount", W.DWORD)] + [(name, C.c_size_t) for name in (
        "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
        "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage", "PrivateUsage",
    )]


class BasicJobLimits(C.Structure):
    _fields_ = [("PerProcessUserTimeLimit", C.c_longlong), ("PerJobUserTimeLimit", C.c_longlong),
                ("LimitFlags", W.DWORD), ("MinimumWorkingSetSize", C.c_size_t),
                ("MaximumWorkingSetSize", C.c_size_t), ("ActiveProcessLimit", W.DWORD),
                ("Affinity", C.c_size_t), ("PriorityClass", W.DWORD), ("SchedulingClass", W.DWORD)]


class IoCounters(C.Structure):
    _fields_ = [(name, C.c_ulonglong) for name in (
        "ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
    )]


class ExtendedJobLimits(C.Structure):
    _fields_ = [("BasicLimitInformation", BasicJobLimits), ("IoInfo", IoCounters)] + [(name, C.c_size_t) for name in (
        "ProcessMemoryLimit", "JobMemoryLimit", "PeakProcessMemoryUsed", "PeakJobMemoryUsed",
    )]


class WindowsResources:
    def __init__(self, native_pid, parent_pid):
        import msvcrt
        self.get_osfhandle = msvcrt.get_osfhandle
        self.stdin_fd = sys.stdin.fileno()
        self.kernel = C.WinDLL("kernel32", use_last_error=True)
        self.psapi = C.WinDLL("psapi", use_last_error=True)
        self.kernel.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
        self.kernel.OpenProcess.restype = W.HANDLE
        self.kernel.CloseHandle.argtypes = [W.HANDLE]
        self.kernel.CloseHandle.restype = W.BOOL
        self.kernel.WaitForSingleObject.argtypes = [W.HANDLE, W.DWORD]
        self.kernel.WaitForSingleObject.restype = W.DWORD
        self.kernel.GetCurrentProcess.restype = W.HANDLE
        self.kernel.PeekNamedPipe.argtypes = [W.HANDLE, C.c_void_p, W.DWORD,
                                             C.POINTER(W.DWORD), C.POINTER(W.DWORD), C.POINTER(W.DWORD)]
        self.kernel.PeekNamedPipe.restype = W.BOOL
        self.psapi.GetPerformanceInfo.argtypes = [C.POINTER(PerformanceInfo), W.DWORD]
        self.psapi.GetPerformanceInfo.restype = W.BOOL
        self.psapi.GetProcessMemoryInfo.argtypes = [W.HANDLE, C.POINTER(ProcessMemory), W.DWORD]
        self.psapi.GetProcessMemoryInfo.restype = W.BOOL
        self.native = self.kernel.OpenProcess(0x00100000 | 0x0400 | 0x0010, False, native_pid)
        self.parent = self.kernel.OpenProcess(0x00100000, False, parent_pid)
        self.job = None

    def read_pipe(self, fd):
        """Poll only raw pipe bytes, without a blocking buffered IO thread."""
        try:
            available = W.DWORD()
            if not self.kernel.PeekNamedPipe(self.get_osfhandle(fd), None, 0, None, C.byref(available), None):
                return ("closed" if C.get_last_error() in (109, 232) else "unavailable", b"")
            if not available.value:
                return "open", b""
            data = os.read(fd, min(available.value, 4096))
            return ("open" if data else "closed", data)
        except (OSError, ValueError):
            return "unavailable", b""

    def running(self, handle):
        return bool(handle) and self.kernel.WaitForSingleObject(handle, 0) == 0x00000102

    def sample(self, elapsed):
        row = {"elapsedSeconds": round(elapsed, 6)}
        info = PerformanceInfo()
        info.cb = C.sizeof(info)
        if self.psapi.GetPerformanceInfo(C.byref(info), C.sizeof(info)):
            row.update(physicalAvailableBytes=info.PhysicalAvailable * info.PageSize,
                       globalCommitUsedBytes=info.CommitTotal * info.PageSize,
                       globalCommitLimitBytes=info.CommitLimit * info.PageSize,
                       globalCommitAvailableBytes=max(0, info.CommitLimit - info.CommitTotal) * info.PageSize)
        # A process that disappeared before startup is unknown, never zero.
        if self.running(self.native):
            memory = ProcessMemory()
            memory.cb = C.sizeof(memory)
            if self.psapi.GetProcessMemoryInfo(self.native, C.byref(memory), C.sizeof(memory)):
                row.update(nativeWorkingSetBytes=memory.WorkingSetSize,
                           nativePeakWorkingSetBytes=memory.PeakWorkingSetSize,
                           nativePrivateBytes=memory.PrivateUsage)
        return row

    def guard_gpu_child(self):
        """Only this observer and its future children join; never the native PID.

        Job membership automatically covers nvidia-smi and KILL_ON_JOB_CLOSE
        also works if Node forcibly kills this observer before Python finally.
        If a containing job disallows nesting, skip GPU observation entirely.
        """
        kernel = self.kernel
        kernel.CreateJobObjectW.argtypes = [C.c_void_p, W.LPCWSTR]
        kernel.CreateJobObjectW.restype = W.HANDLE
        kernel.SetInformationJobObject.argtypes = [W.HANDLE, C.c_int, C.c_void_p, W.DWORD]
        kernel.SetInformationJobObject.restype = W.BOOL
        kernel.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]
        kernel.AssignProcessToJobObject.restype = W.BOOL
        job = kernel.CreateJobObjectW(None, None)
        if not job:
            return False
        limits = ExtendedJobLimits()
        limits.BasicLimitInformation.LimitFlags = 0x00002000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not kernel.SetInformationJobObject(job, 9, C.byref(limits), C.sizeof(limits)) or not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
            kernel.CloseHandle(job)
            return False
        # Deliberately retain the non-inherited handle until this process exits.
        # Closing it here would terminate this observer before summary output.
        self.job = job
        return True

    def close_process_handles(self):
        for handle in (self.native, self.parent):
            if handle:
                self.kernel.CloseHandle(handle)


class GpuPipeReader:
    def __init__(self, fd, resources, samples):
        self.fd, self.resources, self.samples = fd, resources, samples
        self.pending = b""
        self.closed = False

    def pump(self):
        # One pass reads at most 16 KiB; unfinished lines retain at most 1 KiB.
        for _ in range(4):
            state, data = self.resources.read_pipe(self.fd)
            if state != "open":
                self.closed = True
                return
            if not data:
                return
            lines = (self.pending + data).split(b"\n")
            self.pending = lines.pop()[-1024:]
            for line in lines:
                self.samples.add(parse_gpu_line(line.decode("utf-8", errors="replace")))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--parent-pid", type=int, required=True)
    args = parser.parse_args()
    started_at = datetime.now(timezone.utc).isoformat()
    started = time.monotonic()
    samples, gpu_samples = ResourceSamples(), GpuSamples()
    resources, gpu, gpu_reader = None, None, None
    unavailable = set()
    reason = "observer_error"
    try:
        if sys.platform != "win32":
            reason = "unsupported_platform"
        elif os.getppid() != args.parent_pid:
            # A Windows venv redirector or another wrapper may own the PID
            # tracked by Node. Do not create GPU descendants in that case.
            unavailable.add("observer_error")
        else:
            resources = WindowsResources(args.pid, args.parent_pid)
            if resources.guard_gpu_child():
                smi = shutil.which("nvidia-smi")
                if smi:
                    try:
                        gpu = subprocess.Popen([smi, "--query-gpu=uuid,memory.total,memory.used,memory.free",
                                                "--format=csv,noheader,nounits", "--loop-ms=1000"],
                                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                               bufsize=0, creationflags=subprocess.CREATE_NO_WINDOW)
                        gpu_reader = GpuPipeReader(gpu.stdout.fileno(), resources, gpu_samples)
                    except OSError:
                        unavailable.add("gpu_unavailable")
            else:
                unavailable.add("job_guard_unavailable")
            while True:
                elapsed = time.monotonic() - started
                if gpu_reader and not gpu_reader.closed:
                    gpu_reader.pump()
                row = resources.sample(elapsed)
                samples.add(row)
                if "globalCommitAvailableBytes" not in row:
                    unavailable.add("global_memory_unavailable")
                if "nativePrivateBytes" not in row:
                    unavailable.add("native_process_unavailable")
                if not resources.native:
                    reason = "native_unavailable"
                    break
                if not resources.running(resources.native):
                    reason = "native_exited"
                    break
                if not resources.parent:
                    unavailable.add("parent_unavailable")
                    reason = "parent_unavailable"
                    break
                if not resources.running(resources.parent):
                    reason = "parent_exited"
                    break
                if resources.read_pipe(resources.stdin_fd)[0] == "closed":
                    reason = "finished_stdin"
                    break
                if elapsed >= MAX_SECONDS:
                    reason = "time_limit"
                    break
                time.sleep(SAMPLE_INTERVAL_SECONDS)
    except Exception:
        unavailable.add("observer_error")
    finally:
        # This only terminates our own GPU query, never the observed native PID.
        if gpu:
            try:
                if gpu.poll() is None:
                    gpu.terminate()
                gpu.wait(timeout=.5)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    gpu.kill()
                    gpu.wait(timeout=.25)
                except (OSError, subprocess.TimeoutExpired):
                    pass
            if gpu_reader:
                gpu_reader.pump()
            if gpu.stdout:
                gpu.stdout.close()
        if resources:
            resources.close_process_handles()
    gpu_result = gpu_samples.summary()
    if not gpu_result["sampleCount"]:
        unavailable.add("gpu_unavailable")
    result = {
        "version": 1, "nativePid": args.pid, "observerPid": os.getpid(),
        "startedAt": started_at, "finishedAt": datetime.now(timezone.utc).isoformat(),
        "durationSeconds": round(time.monotonic() - started, 6), "stopReason": reason,
        "sampleCount": samples.count, "sampleIntervalMs": int(SAMPLE_INTERVAL_SECONDS * 1000),
        "metrics": samples.ranges, "samples": list(samples.tail), "gpu": gpu_result,
        "sources": {
            "system": "GetPerformanceInfo: global CommitTotal/CommitLimit/PhysicalAvailable * PageSize",
            "native": "GetProcessMemoryInfo: PROCESS_MEMORY_COUNTERS_EX",
            "gpu": "nvidia-smi: whole-device framebuffer; sampled values do not establish OOM causality",
        },
        "unavailable": sorted(unavailable),
    }
    print(json.dumps(result, separators=(",", ":"), allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
