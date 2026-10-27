"""Run one reference/text pair with a Windows global-commit safety guard.

The original runner retains its locks, native command, timeout and immutable
receipts. Guard decisions and resource samples are separate QA evidence.
"""
import argparse
from contextlib import contextmanager
import ctypes
import ctypes.wintypes as wintypes
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import time


# The full-reference GPU success on 2026-10-27 retained 2.22 GiB minimum.
# Allow 0.25 GiB of idle-state variation; keep the 1.5 GiB live cutoff intact.
START_FLOOR = 5888 * 1024 ** 2
RUNNING_FLOOR = 1536 * 1024 ** 2
INTERVAL = .05
GUARD_EXIT_CODE = 0xE0000001
PROCESS_ACCESS = 0x00100000 | 0x0400 | 0x0010 | 0x0001
ROOT = Path(__file__).resolve().parents[2]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require_single_pair(manifest):
    if len(manifest.get("references", [])) != 1 or len(manifest.get("texts", [])) != 1:
        raise ValueError("Guarded runs require exactly one reference and one text; no subsequent item is allowed")


def require_start_headroom(row, floor=START_FLOOR):
    available = row.get("globalCommitAvailableBytes")
    if available is None or available < floor:
        raise RuntimeError(f"global_commit_start_floor: available={available}, required={floor}")


def open_resources(observer, pid):
    resources = observer.WindowsResources(pid, os.getpid())
    if pid:
        # Popen still owns the original child process handle while this opens.
        # Keep this dedicated handle through termination/exit; never reopen by
        # PID during monitoring, and never call taskkill or kill another PID.
        handle = resources.kernel.OpenProcess(PROCESS_ACCESS, False, pid)
        if resources.native:
            resources.kernel.CloseHandle(resources.native)
        resources.native = handle
        if not handle:
            resources.close_process_handles()
            raise ctypes.WinError(ctypes.get_last_error())
        resources.kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
        resources.kernel.TerminateProcess.restype = wintypes.BOOL
    return resources


def terminate_held_native(resources):
    if not resources.running(resources.native):
        return {"requested": False, "alreadyExited": True}
    accepted = bool(resources.kernel.TerminateProcess(resources.native, GUARD_EXIT_CODE))
    return {"requested": True, "accepted": accepted,
            "winError": None if accepted else ctypes.get_last_error()}


class CommitMonitor:
    def __init__(self, resources, observer, runner, evidence):
        self.resources, self.runner = resources, runner
        self.samples = observer.ResourceSamples()
        self.raw = (evidence / "samples.jsonl").open("x", encoding="utf-8", newline="\n")
        self.stop_event = threading.Event()
        self.thread = None
        self.started = time.perf_counter()
        self.abort = None
        self.errors = []
        self.first = self.last = None
        self.exit_confirmed = False
        self.closed = False

    def inspect(self, row):
        available = row.get("globalCommitAvailableBytes")
        if self.abort is None and (available is None or available < RUNNING_FLOOR):
            self.abort = {"reason": "global_commit_unavailable" if available is None
                          else "global_commit_below_running_floor", "sample": row,
                          "floorBytes": RUNNING_FLOOR}
            self.abort["termination"] = terminate_held_native(self.resources)

    def loop(self):
        try:
            while not self.stop_event.is_set():
                row = self.resources.sample(time.perf_counter() - self.started)
                row["observedAt"] = self.runner.now()
                row["nativeRunning"] = self.resources.running(self.resources.native)
                # Apply the guard before disk writes or formatting evidence.
                if row["nativeRunning"]:
                    self.inspect(row)
                self.samples.add(row)
                self.first = self.first or row
                self.last = row
                self.raw.write(json.dumps(row, separators=(",", ":")) + "\n")
                self.raw.flush()
                if not row["nativeRunning"]:
                    break
                self.stop_event.wait(INTERVAL)
        except Exception as error:
            self.errors.append(f"{type(error).__name__}: {error}")
            if self.abort is None:
                self.abort = {"reason": "resource_observation_failed"}
                self.abort["termination"] = terminate_held_native(self.resources)

    def start(self):
        self.thread = threading.Thread(target=self.loop, name="native-commit-guard", daemon=False)
        self.thread.start()

    def close(self):
        if self.closed:
            return
        self.stop_event.set()
        if self.thread and self.thread.ident is not None:
            self.thread.join()
        # The caller only invokes this after Popen.wait / poll has confirmed
        # exit, except the outer safety-finally where we record actual state.
        self.exit_confirmed = not self.resources.running(self.resources.native)
        self.raw.close()
        self.resources.close_process_handles()
        self.closed = True


def run_guarded(runner, observer, args):
    manifest = args.manifest.resolve(strict=True)
    require_single_pair(runner.read_json(manifest))
    evidence = args.evidence_dir.resolve()
    evidence.mkdir(parents=True, exist_ok=False)
    original_lock, original_check = runner.runtime_lock, runner.check_no_native_process
    preflights, monitor, native_pid, startup_fault = [], None, None, None
    native_exited = False
    code, failure = 1, None
    # Explicit per-run opt-in: retain the live cutoff even when the user asks
    # to attempt generation below the usual starting headroom recommendation.
    low_start = getattr(args, "allow_low_start", False)
    start_floor = RUNNING_FLOOR if low_start else START_FLOOR

    def checked_start():
        original_check()
        resources = open_resources(observer, 0)
        try:
            row = resources.sample(0)
        finally:
            resources.close_process_handles()
        row["observedAt"] = runner.now()
        preflights.append(row)
        require_start_headroom(row, start_floor)

    @contextmanager
    def guarded_lock():
        with original_lock() as record:
            def guarded_record(pid):
                nonlocal monitor, native_pid, startup_fault, native_exited
                if pid is None:
                    if monitor:
                        monitor.close()
                    native_exited = native_pid is not None
                    record(None)
                    return
                record(pid)
                try:
                    if native_pid is not None:
                        raise RuntimeError("Only one native launch is allowed")
                    native_pid = pid
                    resources = open_resources(observer, pid)
                    try:
                        monitor = CommitMonitor(resources, observer, runner, evidence)
                    except BaseException:
                        resources.close_process_handles()
                        raise
                    monitor.start()
                except BaseException as error:
                    startup_fault = f"{type(error).__name__}: {error}"
                    # Existing run_take catches this and kills/waits via its
                    # own Popen handle before record(None); never PID killing.
                    raise
            yield guarded_record

    runner.runtime_lock, runner.check_no_native_process = guarded_lock, checked_start
    original_argv = sys.argv
    sys.argv = [str(ROOT / "tools/voxcpm2-runtime/run_reference_listening.py"),
                "--manifest", str(manifest), "--output-root", str(args.output_root),
                "--profile", str(args.profile)]
    try:
        code = runner.main()
    except Exception as error:
        failure = f"{type(error).__name__}: {error}"
    finally:
        sys.argv = original_argv
        runner.runtime_lock, runner.check_no_native_process = original_lock, original_check
        # record(None) normally joined/closed it already; no second close.
        if monitor and not monitor.raw.closed:
            monitor.close()
        aborted = bool(startup_fault or (monitor and monitor.abort))
        if aborted:
            code = 3
        runner.write_new_json(evidence / "summary.json", {
            "finishedAt": runner.now(), "nativePid": native_pid, "exitCode": code,
            "manifest": runner.identity(manifest), "sampleIntervalMs": 50,
            "startFloorBytes": start_floor, "runningFloorBytes": RUNNING_FLOOR,
            "allowLowStart": low_start,
            "preflights": preflights, "guardAborted": aborted,
            "guard": monitor.abort if monitor else None,
            "guardStartupFault": startup_fault, "failure": failure,
            "nativeExitConfirmed": native_exited if native_pid is not None else True,
            "sampleCount": monitor.samples.count if monitor else 0,
            "metrics": monitor.samples.ranges if monitor else {},
            "firstSample": monitor.first if monitor else None,
            "lastSample": monitor.last if monitor else None,
            "observerErrors": monitor.errors if monitor else [],
            "rawSamples": runner.identity(evidence / "samples.jsonl") if monitor else None,
            "runtimeLockAbsent": not runner.RUNTIME_LOCK.exists(),
            "batchLockAbsent": not (args.output_root / ".reference-listening.lock").exists(),
            "limitations": "50 ms polling cannot prevent every sudden allocation spike. No GPU sampling."
        })
        runner.emit(event="guard_finished", exit_code=code, guard_aborted=aborted,
                    evidence=str(evidence), failure=failure)
    return code


def main():
    sys.dont_write_bytecode = True
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--allow-low-start", action="store_true",
                        help="Explicitly attempt below the usual start floor; live 1.5 GiB cutoff stays enabled")
    parser.add_argument("--profile", type=Path, default=Path(
        "D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/voxcpm2/profile.json"))
    args = parser.parse_args()
    runner = load_module("guarded_reference_runner", Path(__file__).with_name("run_reference_listening.py"))
    observer = load_module("guarded_windows_resources", ROOT / "apps/web/scripts/observe-native-resources.py")
    return run_guarded(runner, observer, args)


if __name__ == "__main__":
    raise SystemExit(main())
