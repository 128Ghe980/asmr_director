"""One bounded full-reference GPU retry, using the unchanged listening runner.

This is the 2026-10-27 take-002 diagnostic, not an automatic retry loop.
Only resource evidence is added; the runner owns locks, process and timeout.
"""
from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import time


ROOT = Path(__file__).resolve().parents[2]
QA = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27")
OUTPUT = QA / "comparison-generation"
MANIFEST = QA / "full-yui-gpu-retry-manifest.json"
PAIR = OUTPUT / "audio/yuigahama-192-mp3-full-ref/short"
EVIDENCE = QA / "full-yui-gpu-take002-resources"
INTERVAL = .05


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    sys.dont_write_bytecode = True
    runner_path = ROOT / "tools/voxcpm2-runtime/run_reference_listening.py"
    observer_path = ROOT / "apps/web/scripts/observe-native-resources.py"
    runner = load_module("reference_runner", runner_path)
    observer = load_module("native_resource_observer", observer_path)
    manifest = runner.read_json(MANIFEST)
    if len(manifest["references"]) != 1 or len(manifest["texts"]) != 1:
        raise ValueError("This diagnostic permits exactly one reference and one text")
    ref, text = manifest["references"][0], manifest["texts"][0]
    if (ref["id"] != "yuigahama-192-mp3-full-ref" or text["id"] != "short"
            or manifest.get("seed") != 42 or runner.manifest_cfg(manifest) != 2
            or runner.reference_options(ref)):
        raise ValueError("Expected the fixed seed-42 CFG-2 full-Yui reference-only request")
    reference = runner.identity(ref["path"])
    metrics = runner.wav_metrics(ref["path"])
    if (reference["sha256"] != "fac61906b84fc32b4f74d657093a16f5f56cb59f44d5046f2680e4db81f6ab03"
            or metrics["frames"] != 202292 or metrics["sample_rate"] != 16000):
        raise ValueError("Full uncut reference identity or duration changed")
    if sorted(p.name for p in PAIR.glob("take-*")) != ["take-001"]:
        raise RuntimeError("Expected only take-001; refusing another take or overwrite")
    old_receipt = runner.read_json(PAIR / "take-001/receipt.json")
    if old_receipt["status"] == "complete":
        raise RuntimeError("The previous take succeeded; diagnostic retry refused")
    runner.check_no_native_process()
    EVIDENCE.mkdir(exist_ok=False)
    resources = observer.WindowsResources(0, os.getpid())
    try:
        baseline = resources.sample(0)
    finally:
        resources.close_process_handles()
    runner.write_new_json(EVIDENCE / "setup.json", {
        "startedAt": runner.now(), "observerPid": os.getpid(),
        "manifest": runner.identity(MANIFEST), "reference": reference,
        "referenceMetrics": metrics, "runner": runner.identity(runner_path),
        "observerSource": runner.identity(observer_path),
        "wrapper": runner.identity(__file__), "baselineBeforeHashing": baseline,
        "sampleIntervalMs": 50, "expectedTake": str(PAIR / "take-002"),
        "notes": "Unchanged GPU request; complete 12.64325 s reference; one native launch only."
    })
    original_lock = runner.runtime_lock
    samples = observer.ResourceSamples()
    stop = threading.Event()
    thread = None
    native_pid = None
    errors = []
    first = last = None
    start = None

    def sample_loop(resources, raw):
        nonlocal first, last
        try:
            while True:
                row = resources.sample(time.perf_counter() - start)
                row["observedAt"] = runner.now()
                row["nativeRunning"] = resources.running(resources.native)
                raw.write(json.dumps(row, separators=(",", ":")) + "\n")
                raw.flush()
                samples.add(row)
                first = first or row
                last = row
                if not row["nativeRunning"] or stop.wait(INTERVAL):
                    break
        except Exception as error:
            errors.append(f"{type(error).__name__}: {error}")
        finally:
            raw.close()
            resources.close_process_handles()

    def stop_sampling():
        stop.set()
        if thread:
            thread.join()

    @contextmanager
    def observed_lock():
        nonlocal thread, native_pid, start
        with original_lock() as record:
            def observed_record(pid):
                nonlocal thread, native_pid, start
                record(pid)
                if pid is None:
                    stop_sampling()
                    return
                if native_pid is not None:
                    raise RuntimeError("Diagnostic permits only one native launch")
                native_pid = pid
                start = time.perf_counter()
                resources = observer.WindowsResources(pid, os.getpid())
                raw = (EVIDENCE / "samples.jsonl").open("x", encoding="utf-8", newline="\n")
                stop.clear()
                thread = threading.Thread(target=sample_loop, args=(resources, raw), daemon=False)
                thread.start()
            try:
                yield observed_record
            finally:
                stop_sampling()

    runner.runtime_lock = observed_lock
    sys.argv = [str(runner_path), "--manifest", str(MANIFEST), "--output-root", str(OUTPUT)]
    result = 1
    try:
        result = runner.main()
        return result
    finally:
        stop_sampling()
        receipt_path = PAIR / "take-002/receipt.json"
        receipt = runner.read_json(receipt_path) if receipt_path.is_file() else None
        runner.write_new_json(EVIDENCE / "summary.json", {
            "finishedAt": runner.now(), "nativePid": native_pid, "runnerExitCode": result,
            "sampleIntervalMs": 50, "sampleCount": samples.count,
            "metrics": samples.ranges, "firstSample": first, "lastSample": last,
            "errors": errors, "rawSamples": runner.identity(EVIDENCE / "samples.jsonl")
            if (EVIDENCE / "samples.jsonl").exists() else None,
            "nativeReceipt": runner.identity(receipt_path) if receipt else None,
            "nativeStatus": receipt.get("status") if receipt else None,
            "nativeExitCode": receipt.get("exit_code") if receipt else None,
            "sameRequestAsTake001": receipt["request_sha256"] == old_receipt["request_sha256"]
            if receipt else None,
            "sources": {"system": "GetPerformanceInfo global commit and physical memory",
                        "native": "GetProcessMemoryInfo PROCESS_MEMORY_COUNTERS_EX"},
            "limitations": "50 ms samples can miss brief allocation peaks; no GPU sampling."
        })
        runner.emit(event="resource_evidence", path=str(EVIDENCE), sample_count=samples.count)


if __name__ == "__main__":
    raise SystemExit(main())
