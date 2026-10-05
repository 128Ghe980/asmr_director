"""Run one local SFX test with an external deadline and an owned-process cleanup.

Example (no shell expansion is performed)::

    python run_bounded.py --log-path I:/trial/run.log \
        --receipt-path I:/trial/receipt.json --cancel-file I:/trial/cancel \
        -- python generate_stable_open.py --model-path I:/models/stable-audio

Create the cancel file to stop the run, or press Ctrl-C. A cancel file that
already exists prevents launch. Use a new cancel-file path for each attempt.
The child writes stdout and stderr directly to the log, so an undrained pipe or
inherited descendant pipe cannot hold the supervisor open. Receipts intentionally
retain executable/path arguments and option names only; other values are redacted.
Exit status is 124 for a deadline, 130 for cancellation and 125 for a supervisor
failure. Otherwise it is the child's status (negative statuses map to 128+signal).
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
from typing import BinaryIO, List, Optional


POLL_SECONDS = 0.2
CLEANUP_TIMEOUT_SECONDS = 10.0
SECRET_OPTION = re.compile(
    r"token|password|passwd|secret|credential|authorization|api[-_]?key|private[-_]?key",
    re.IGNORECASE,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_command(command: List[str], cwd: Path) -> List[str]:
    """Keep command structure and paths without copying arbitrary argument values."""
    result = []
    secret_next = False
    for index, argument in enumerate(command):
        if secret_next:
            result.append("<redacted>")
            secret_next = False
        elif index == 0:
            result.append(argument)
        elif argument.startswith("-"):
            option, separator, _ = argument.partition("=")
            result.append(option + "=<redacted>" if separator else option)
            secret_next = bool(SECRET_OPTION.search(option)) and not separator
        else:
            # URLs, inline code, prompts, tokens and other opaque values are not
            # needed to identify a run. Only actual filesystem paths are retained.
            try:
                candidate = Path(argument)
                looks_like_path = candidate.is_absolute() or "/" in argument or "\\" in argument
                candidate = candidate if candidate.is_absolute() else cwd / candidate
                result.append(argument if (looks_like_path or candidate.is_file()) and candidate.exists() else "<redacted>")
            except (OSError, ValueError):
                result.append("<redacted>")
    return result


def atomic_receipt(path: Path, receipt: dict) -> None:
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=str(path.parent),
            prefix=path.name + ".", suffix=".tmp", delete=False,
        ) as output:
            temporary = Path(output.name)
            json.dump(receipt, output, ensure_ascii=False, indent=2, allow_nan=False)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(str(temporary), str(path))
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def log_message(log: BinaryIO, message: str) -> None:
    log.write(("\n[bounded supervisor] " + message + "\n").encode("utf-8"))


def terminate_owned_tree(process: subprocess.Popen, log: BinaryIO) -> dict:
    """Never enumerate or kill unrelated Python/GPU processes."""
    cleanup = {
        "method": "taskkill /PID /T /F" if os.name == "nt" else "killpg SIGKILL",
        "tree_termination_requested": False,
        "tree_termination_succeeded": False,
        "root_exit_confirmed": False,
    }
    if process.poll() is not None:
        cleanup["root_exit_confirmed"] = True
        cleanup["method"] = "already exited"
        return cleanup
    cleanup["tree_termination_requested"] = True
    try:
        if os.name == "nt":
            taskkill = Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32" / "taskkill.exe"
            result = subprocess.run(
                [str(taskkill), "/PID", str(process.pid), "/T", "/F"],
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                timeout=CLEANUP_TIMEOUT_SECONDS, check=False, shell=False,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            cleanup["taskkill_exit_code"] = result.returncode
            cleanup["tree_termination_succeeded"] = result.returncode == 0
        else:
            os.killpg(process.pid, signal.SIGKILL)
            cleanup["tree_termination_succeeded"] = True
    except (OSError, subprocess.TimeoutExpired) as error:
        cleanup["error_type"] = type(error).__name__
        log_message(log, "Tree cleanup failed: " + type(error).__name__)

    # A failed OS tree request must never be reported as successful. Still reap
    # our direct child where possible and bound cleanup itself.
    if process.poll() is None and not cleanup["tree_termination_succeeded"]:
        try:
            process.kill()
            cleanup["root_kill_fallback"] = True
        except OSError as error:
            cleanup["root_kill_error_type"] = type(error).__name__
    try:
        process.wait(timeout=CLEANUP_TIMEOUT_SECONDS)
        cleanup["root_exit_confirmed"] = True
    except subprocess.TimeoutExpired:
        cleanup["root_exit_confirmed"] = False
    return cleanup


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout-seconds", type=float, default=300.0)
    parser.add_argument("--log-path", type=Path, required=True)
    parser.add_argument("--receipt-path", type=Path, required=True)
    parser.add_argument("--cwd", type=Path)
    parser.add_argument("--cancel-file", type=Path)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if not args.command or args.command[0] != "--" or len(args.command) < 2:
        parser.error("provide the child executable and arguments after --")
    if not math.isfinite(args.timeout_seconds) or args.timeout_seconds <= 0:
        parser.error("--timeout-seconds must be finite and positive")
    command = args.command[1:]
    cwd = (args.cwd or Path.cwd()).resolve()
    if not cwd.is_dir():
        parser.error("--cwd must be an existing directory")
    log_path = args.log_path.resolve()
    receipt_path = args.receipt_path.resolve()
    cancel_file = args.cancel_file.resolve() if args.cancel_file else None
    distinct_paths = [log_path, receipt_path] + ([cancel_file] if cancel_file else [])
    if len(set(distinct_paths)) != len(distinct_paths):
        parser.error("log, receipt and cancel paths must be different")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.parent.mkdir(parents=True, exist_ok=True)

    started = time.monotonic()
    receipt = {
        "schema_version": 1,
        "started_at": utc_now(),
        "timeout_seconds": args.timeout_seconds,
        "poll_seconds": POLL_SECONDS,
        "command": safe_command(command, cwd),
        "command_values_redacted": True,
        "cwd": str(cwd),
        "log_path": str(log_path),
        "cancel_file": str(cancel_file) if cancel_file else None,
        "supervisor_pid": os.getpid(),
        "pid": None,
        "outcome": "launch_error",
        "exit_code": None,
        "timed_out": False,
        "cancelled": False,
        "root_exit_confirmed": False,
    }
    cancellation = {"signal": None}
    previous_handlers = {}

    def request_cancel(signum: int, _frame) -> None:
        cancellation["signal"] = signum

    for signum in (signal.SIGINT, signal.SIGTERM, getattr(signal, "SIGBREAK", None)):
        if signum is not None:
            previous_handlers[signum] = signal.signal(signum, request_cancel)

    process = None
    status = 125
    try:
        # Unbuffered file writes and direct child redirection avoid reader threads
        # or pipe EOF waits. Append preserves evidence if a log path is reused.
        with log_path.open("ab", buffering=0) as log:
            log_message(log, "Started " + receipt["started_at"])
            if cancellation["signal"] is not None or (cancel_file and cancel_file.exists()):
                receipt.update(outcome="cancelled_before_launch", cancelled=True, root_exit_confirmed=True)
                status = 130
            else:
                child_env = os.environ.copy()
                child_env.update(
                    SFX_BOUNDED_RUN="1",
                    SFX_BOUNDED_SUPERVISOR_PID=str(os.getpid()),
                    SFX_BOUNDED_TIMEOUT_SECONDS=str(args.timeout_seconds),
                )
                child_env.setdefault("PYTHONUNBUFFERED", "1")
                process = subprocess.Popen(
                    command, cwd=str(cwd), env=child_env, stdin=subprocess.DEVNULL,
                    stdout=log, stderr=subprocess.STDOUT, shell=False,
                    creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW)
                    if os.name == "nt" else 0,
                    start_new_session=os.name != "nt",
                )
                receipt["pid"] = process.pid
                log_message(log, "Created owned child PID " + str(process.pid))
                deadline = started + args.timeout_seconds
                reason = None
                while process.poll() is None:
                    if cancellation["signal"] is not None:
                        reason = "signal"
                        break
                    if cancel_file and cancel_file.exists():
                        reason = "cancel_file"
                        break
                    if time.monotonic() >= deadline:
                        reason = "timeout"
                        break
                    time.sleep(min(POLL_SECONDS, max(0.0, deadline - time.monotonic())))
                if reason:
                    receipt["timed_out"] = reason == "timeout"
                    receipt["cancelled"] = reason != "timeout"
                    receipt["stop_reason"] = reason
                    receipt["stop_requested_at_seconds"] = round(time.monotonic() - started, 6)
                    if cancellation["signal"] is not None:
                        receipt["cancel_signal"] = cancellation["signal"]
                    log_message(log, "Stopping owned child: " + reason)
                    cleanup = terminate_owned_tree(process, log)
                    receipt["cleanup"] = cleanup
                    receipt["root_exit_confirmed"] = cleanup["root_exit_confirmed"]
                    if not cleanup["root_exit_confirmed"] or (
                        cleanup["tree_termination_requested"] and not cleanup["tree_termination_succeeded"]
                    ):
                        receipt["outcome"] = "termination_failed"
                        status = 125
                    else:
                        receipt["outcome"] = "timed_out" if reason == "timeout" else "cancelled"
                        status = 124 if reason == "timeout" else 130
                else:
                    receipt["root_exit_confirmed"] = True
                    receipt["outcome"] = "completed" if process.returncode == 0 else "failed"
                    status = process.returncode if process.returncode >= 0 else 128 - process.returncode
                receipt["exit_code"] = process.poll()
            log_message(log, "Outcome: " + receipt["outcome"])
    except Exception as error:
        # Do not expose a failing command's arguments in a traceback or receipt.
        receipt["error_type"] = type(error).__name__
        receipt["outcome"] = "supervisor_error" if process else "launch_error"
        if process is not None:
            with log_path.open("ab", buffering=0) as log:
                receipt["cleanup"] = terminate_owned_tree(process, log)
            receipt["root_exit_confirmed"] = receipt["cleanup"]["root_exit_confirmed"]
            receipt["exit_code"] = process.poll()
        status = 125
    finally:
        receipt["finished_at"] = utc_now()
        receipt["elapsed_seconds"] = round(time.monotonic() - started, 6)
        receipt["supervisor_exit_code"] = status
        for signum, previous in previous_handlers.items():
            signal.signal(signum, previous)
        atomic_receipt(receipt_path, receipt)
    print(json.dumps({
        "outcome": receipt["outcome"], "exit_code": receipt["exit_code"],
        "elapsed_seconds": receipt["elapsed_seconds"],
        "root_exit_confirmed": receipt["root_exit_confirmed"],
        "log_path": str(log_path), "receipt_path": str(receipt_path),
    }, ensure_ascii=False))
    return status


if __name__ == "__main__":
    sys.exit(main())
