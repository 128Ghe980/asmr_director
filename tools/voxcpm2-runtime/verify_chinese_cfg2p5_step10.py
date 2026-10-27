"""Independent preparation/generation/delivery evidence audit; never runs models."""
import argparse
import array
from datetime import datetime, timezone
from difflib import SequenceMatcher
from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
from urllib.parse import unquote, urlparse
import wave

sys.dont_write_bytecode = True
FOLLOWUP = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27")
QA = FOLLOWUP / "chinese-cfg2p5-step10"
HELPER = FOLLOWUP / "input-clarity/verify_generation.py"
spec = importlib.util.spec_from_file_location("evidence_helpers", HELPER)
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
TARGETS = {"chinese-rest": "先坐下来休息一下吧，我给你倒杯温水。", "chinese-comfort": "今天已经很努力了，剩下的事情明天再慢慢想，好吗？"}
BASES = {
    "yukino": ("parameter-sweep", "yukino-cfg2p5-step10", 43, 401600),
    "yui": ("yui-reference-02", "yui-reference-02", 42, 323501),
}


def save(name, report):
    path = QA / name
    if path.exists():
        raise FileExistsError("Audit evidence already exists: " + str(path))
    report.update(verified_at=datetime.now(timezone.utc).isoformat(), audit_script=h.identity(Path(__file__)), audit_helper=h.identity(HELPER), errors=h.ERRORS)
    report["status"] = "passed" if not h.ERRORS else "failed"
    with path.open("x", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, allow_nan=False)
    return path


def baselines():
    result = {}
    for voice, (scope, key, seed, frames) in BASES.items():
        template_path = FOLLOWUP / scope / ("guarded-" + key + ".json")
        request_path = FOLLOWUP / scope / "generation/audio" / key / "japanese-paragraph/take-001/request.json"
        template, request = h.read(template_path), h.read(request_path)["request"]
        h.check((template["seed"], template["cfg"], template["timesteps"]) == (seed, 2.5, 10), voice + " baseline manifest controls")
        h.check(request["parameters"] == {"steps": 600, "timesteps": 10, "cfg": 2.5, "temperature": 1, "n_gpu_layers": 0, "low_vram": True}, voice + " baseline runtime controls")
        h.check(request["reference"]["mode"] == "combined" and request["mode"] == "combined", voice + " baseline combined")
        ref = h.verify_file(request["reference"]["file"], voice + " reference")
        metrics = h.pcm(ref["path"])
        h.check(metrics["sample_rate"] == 16000 and metrics["channels"] == 1 and metrics["frames"] == frames, voice + " full reference format")
        result[voice] = {"template": template, "request": request, "template_file": h.identity(template_path), "request_file": h.identity(request_path), "input": ref, "metrics": metrics}
    return result


def jobs(bases):
    found = []
    for path in sorted(QA.glob("guarded-*.json")):
        manifest = h.read(path)
        h.check(len(manifest["references"]) == 1 and len(manifest["texts"]) == 1, path.name + " single guarded job")
        voice = next(k for k, b in bases.items() if Path(manifest["references"][0]["path"]) == Path(b["input"]["path"]))
        target = manifest["texts"][0]
        h.check(target["id"] in TARGETS and target["text"] == TARGETS[target["id"]], path.name + " exact Chinese target")
        restored = dict(manifest)
        restored["texts"] = bases[voice]["template"]["texts"]
        h.check(restored == bases[voice]["template"], path.name + " text-only manifest change")
        found.append({"id": voice + "-" + target["id"], "voice": voice, "target": target, "manifest": h.identity(path), "reference_id": manifest["references"][0]["id"]})
    h.check(len(found) == 4 and {(r["voice"], r["target"]["id"]) for r in found} == {(v, t) for v in BASES for t in TARGETS}, "four unique voice/target jobs")
    return found


def preparation():
    bases = baselines()
    found = jobs(bases)
    snowprep = h.read(FOLLOWUP / "yukino-length/preparation.json")
    yuiprep = h.read(FOLLOWUP / "yui-reference-02/preparation.json")
    sources = {"yukino_video": h.verify_file(snowprep["source"], "Yukino original video"), "yui_mp3": h.verify_file(yuiprep["source"], "Yui02 original MP3")}
    profiles = {voice: h.verify_file(b["request"]["profile"], voice + " profile") for voice, b in bases.items()}
    master = h.read(QA / "manifest.json")
    h.check((master.get("executable") is False or master.get("master_is_executable") is False)
            and "references" not in master and "texts" not in master, "master index explicitly non-executable")
    report = {"checks": {"four_single_reference_text_jobs": len(found) == 4, "text_only_change": not h.ERRORS,
                         "current_reference_files_verified": True, "original_sources_verified": True, "profiles_verified": True},
              "jobs": found, "baselines": {v: {k: b[k] for k in ("template_file", "request_file", "input", "metrics")} for v, b in bases.items()},
              "original_sources": sources, "profiles": profiles, "design": h.identity(QA / "design.json"), "master": h.identity(QA / "manifest.json"),
              "model_calls": 0, "asr_calls": 0, "audio_conversions": 0,
              "notes": ["Yukino remains full25.10s with its existing -6dB input and seed43; Yui02 remains full20.2188s at its own level and seed42.",
                        "Reference identity/name/path/prompt, mode and parameters remain exact baseline copies; only target text changes."]}
    path = save("preparation-verification.json", report)
    print(json.dumps({"status": report["status"], "report": str(path), "jobs": [r["id"] for r in found], "errors": h.ERRORS}, ensure_ascii=False))


def review_text(target, transcript):
    def normalize(text):
        return "".join(c for c in unicodedata.normalize("NFKC", text) if not c.isspace() and not unicodedata.category(c).startswith("P"))
    a, b = normalize(target), normalize(transcript)
    differences = [{"operation": tag, "target": a[i:j], "asr": b[k:l]} for tag, i, j, k, l in SequenceMatcher(None, a, b, autojunk=False).get_opcodes() if tag != "equal"]
    return {"target": target, "asr_text": transcript, "exact_match": target == transcript,
            "punctuation_spacing_normalized_match": a == b, "normalized_character_similarity": SequenceMatcher(None, a, b, autojunk=False).ratio(),
            "difference_spans": differences, "content_review_needed": a != b,
            "limitation": "ASR is forced to Chinese. Even text agreement is not proof of actual language, intelligible Mandarin pronunciation, accent, naturalness or speaker similarity. No subjective listening was performed."}


def generation_case(job, base):
    key, target = job["reference_id"], job["target"]
    case_dir = QA / "generation/audio" / key / target["id"]
    history = []
    completed = []
    for candidate in sorted(case_dir.glob("take-*/receipt.json")):
        prior = h.read(candidate)
        prior_guard = next((p for p in QA.glob("guard*/summary.json") if h.read(p)["nativePid"] == prior.get("pid")), None)
        guard_record = h.read(prior_guard) if prior_guard else None
        history.append({"take": candidate.parent.name, "receipt": h.identity(candidate), "status": prior.get("status"),
                        "exit_code": prior.get("exit_code"), "wav_exists": (candidate.parent / "generated.wav").exists(),
                        "guard": h.identity(prior_guard) if prior_guard else None,
                        "guard_aborted": guard_record.get("guardAborted") if guard_record else None})
        if prior.get("status") == "complete" and prior.get("exit_code") == 0:
            completed.append(candidate)
        else:
            h.check(job["id"] == "yukino-chinese-comfort" and candidate.parent.name == "take-001", job["id"] + " only authorized resource failure")
            h.check(guard_record is not None and guard_record["guardAborted"] and guard_record["nativeExitConfirmed"], job["id"] + " failed take stopped by live resource guard")
            h.check(guard_record is not None and guard_record["guard"]["reason"] == "global_commit_below_running_floor", job["id"] + " documented global commit floor intervention")
            h.check(not (candidate.parent / "generated.wav").exists(), job["id"] + " aborted take has no generated WAV")
            h.check(h.canonical(prior["request"]) == prior["request_sha256"] and h.canonical(prior["command"]) == prior["command_sha256"], job["id"] + " failed take request/argv integrity")
            failed_logs = {role: h.verify_file(prior[role], job["id"] + " aborted " + role) for role in ("stdout", "stderr")}
            h.verify_file(guard_record["rawSamples"], job["id"] + " aborted guard samples")
            failed_extrema = h.sample_extrema(guard_record["rawSamples"]["path"], guard_record)
            history[-1].update(resource_intervention=guard_record["guard"], guard_extrema=failed_extrema, logs=failed_logs)
            restored_failed = dict(prior["request"])
            restored_failed["text"] = base["request"]["text"]
            h.check(restored_failed == base["request"], job["id"] + " resource retry retained configuration")
    h.check(len(completed) == 1, job["id"] + " exactly one successful result, no quality selection")
    if len(completed) != 1:
        raise ValueError("Expected exactly one successful take for " + job["id"])
    receipt_path = completed[0]
    take = receipt_path.parent
    r = h.read(receipt_path)
    q, cmd = r["request"], r["command"]
    h.check(r["status"] == "complete" and r["exit_code"] == 0 and not r["oom_detected"] and not r["fatal_cuda_detected"], job["id"] + " native completed")
    h.check(q["text"] == target, job["id"] + " target request")
    restored = dict(q)
    restored["text"] = base["request"]["text"]
    h.check(restored == base["request"], job["id"] + " request changes target only")
    h.check(h.canonical(q) == r["request_sha256"] and h.canonical(cmd) == r["command_sha256"], job["id"] + " immutable request/argv digest")
    initial = h.read(take / "request.json")
    h.check(initial["request"] == q and initial["command"] == cmd and initial["request_sha256"] == r["request_sha256"], job["id"] + " initial request")
    def opt(flag):
        return cmd[cmd.index(flag) + 1]
    for flag, value in {"--steps": "600", "--timesteps": "10", "--cfg": "2.5", "--temperature": "1", "--seed": str(q["seed"]), "--n-gpu-layers": "0"}.items():
        h.check(opt(flag) == value, job["id"] + " CLI " + flag)
    h.check("--cpu" not in cmd and "--low-vram" in cmd, job["id"] + " GPU settings")
    h.check(opt("-t") == target["text"] and Path(opt("-o")) == take / "generated.wav", job["id"] + " target/output arguments")
    h.check(opt("-r") == q["reference"]["file"]["path"] and opt("--prompt-wav") == opt("-r") and opt("--prompt-text") == q["reference"]["promptText"], job["id"] + " combined arguments")
    h.check(cmd[0] == q["files"]["cliPath"]["path"] and cmd[-2:] == [q["files"]["baseModelPath"]["path"], q["files"]["acousticModelPath"]["path"]], job["id"] + " native/model argv")
    files = {role: h.verify_file(r[role], job["id"] + " " + role) for role in ("output", "stdout", "stderr")}
    pcm = h.pcm(files["output"]["path"])
    h.compare_metrics(pcm, r["wav_metrics"], job["id"] + " native PCM")
    h.check(pcm["sample_rate"] == 48000 and pcm["channels"] == 1 and pcm["clipped_samples"] == 0 and not pcm["max_steps_reached"], job["id"] + " output format/clipping/cap")
    log = Path(files["stderr"]["path"]).read_text(encoding="utf-8")
    h.check(re.search(r"Config:\s+steps=600 timesteps=10 cfg=2\.5 temp=1\.0 seed=" + str(q["seed"]), log) is not None, job["id"] + " logged settings")
    h.check("Backend:  GPU" in log and "custom component backend=CUDA0" in log, job["id"] + " actual GPU backend")
    h.check("sr=16000 out_sr=48000" in log, job["id"] + " encoder/output rate")
    duration = f'{base["metrics"]["frames"] / 16000:.2f}'
    h.check(f"Reference: {duration}s, 16000 Hz" in log and f"Prompt:    {duration}s, 16000 Hz" in log, job["id"] + " full reference loaded")
    graphs = re.findall(r"built decode_front_half graph \(timesteps=(\d+), cfg=([\d.]+), nodes=(\d+), buffer=([\d.]+) MiB\)", log)
    h.check(bool(graphs) and all((int(t), float(c), int(n)) == (10, 2.5, 4462) for t, c, n, _ in graphs), job["id"] + " actual10step graph")
    patches = re.findall(r"combined prefill reference_patches=(\d+) text_tokens=(\d+) prompt_patches=(\d+) total=(\d+)", log)
    expected = (base["metrics"]["frames"] + 2559) // 2560
    h.check(len(patches) == 1 and int(patches[0][0]) == expected and int(patches[0][2]) == expected and int(patches[0][3]) == 2 * expected + int(patches[0][1]) + 3, job["id"] + " full combined patches")
    h.check(target["text"] in log and q["reference"]["promptText"] in log, job["id"] + " UTF8 echo")
    guard_path = next(p for p in QA.glob("guard*/summary.json") if h.read(p)["nativePid"] == r["pid"])
    guard = h.read(guard_path)
    h.check(guard["exitCode"] == 0 and guard["nativeExitConfirmed"] and not any(guard[k] for k in ("guardAborted", "guardStartupFault", "failure", "observerErrors")), job["id"] + " guard completion")
    h.check(guard["manifest"]["sha256"] == job["manifest"]["sha256"], job["id"] + " guarded manifest")
    h.verify_file(guard["rawSamples"], job["id"] + " guard samples")
    extrema = h.sample_extrema(guard["rawSamples"]["path"], guard)
    h.check(extrema["globalCommitAvailableBytes"]["min"] >= guard["runningFloorBytes"], job["id"] + " live memory floor")
    h.check(guard["runtimeLockAbsent"] and guard["batchLockAbsent"], job["id"] + " completed locks")
    return {**job, "receipt": h.identity(receipt_path), "request_file": h.identity(take / "request.json"), "files": files,
            "request_sha256": r["request_sha256"], "command_sha256": r["command_sha256"], "parameters": q["parameters"], "seed": q["seed"],
            "reference": q["reference"]["file"], "reference_metrics": base["metrics"], "output_metrics": pcm, "actual_graphs": graphs,
            "combined_patches": patches, "guard": h.identity(guard_path), "guard_extrema": extrema,
            "minimum_commit_gib": extrema["globalCommitAvailableBytes"]["min"] / 2 ** 30, "wall_seconds": r["wall_seconds"],
            "selected_take": take.name, "take_history": history, "resource_retry": len(history) > 1,
            "quality_based_selection": False}


def generation():
    pv = h.read(QA / "preparation-verification.json")
    h.check(pv["status"] == "passed", "independent preparation audit passed")
    bases = baselines()
    found = jobs(bases)
    runtime = {role: h.verify_file(item, role) for role, item in {**bases["yui"]["request"]["files"], "profile": bases["yui"]["request"]["profile"]}.items()}
    for voice, base in bases.items():
        h.check(base["request"]["files"] == bases["yui"]["request"]["files"] and base["request"]["profile"] == bases["yui"]["request"]["profile"], voice + " same runtime assets")
    sources = {role: h.verify_file(item, role) for role, item in pv["original_sources"].items()}
    results = [generation_case(row, bases[row["voice"]]) for row in found]
    selection_path = QA / "selection.json"
    selection = h.read(selection_path)
    h.check(len(selection["selections"]) == 4, "four explicit selected results")
    for result in results:
        selected = next(row for row in selection["selections"] if row["id"] == result["id"])
        selected_receipt = h.verify_file(selected["receipt"], result["id"] + " explicit selected receipt")
        h.check(selected_receipt == result["receipt"] and Path(selected["take_directory"]) == Path(result["receipt"]["path"]).parent, result["id"] + " explicit selected take agrees")
    a_path, ag_path = QA / "generated-asr.json", QA / "generated-asr-guard/receipt.json"
    asr, guard = h.read(a_path), h.read(ag_path)
    h.check(asr["language"] == "zh" and len(asr["files"]) == 4 and len(guard["inputFiles"]) == 4, "ASR Chinese setting and four inputs")
    h.check(guard["exitCode"] == 0 and guard["guard"] is None, "ASR completed without memory intervention")
    reviews = []
    for row in results:
        path = Path(row["files"]["output"]["path"])
        item = next(x for x in asr["files"] if Path(x["path"]) == path)
        declared = next(x for x in guard["inputFiles"] if Path(x["path"]) == path)
        h.verify_file(declared, row["id"] + " ASR input")
        h.check(declared["sha256"] == row["files"]["output"]["sha256"], row["id"] + " same audio ASR")
        reviews.append({"id": row["id"], "audio_sha256": declared["sha256"], **review_text(row["target"]["text"], item["text"])})
    extrema = h.sample_extrema(QA / "generated-asr-guard/samples.jsonl", guard)
    locks = {"runtime_absent": not Path("D:/CodexWorkplace/asmr_director_runtime/locks/voxcpm2-generation.lock").exists(), "batch_absent": not (QA / "generation/.reference-listening.lock").exists()}
    h.check(all(locks.values()), "all generation locks released")
    proc = subprocess.run(["tasklist", "/FI", "IMAGENAME eq voxcpm2-cli.exe", "/FO", "CSV", "/NH"], capture_output=True, timeout=15)
    remains = b"voxcpm2-cli.exe" in proc.stdout.lower()
    h.check(not remains, "native process released")
    report = {"status_scope": "Technical execution and controls only. Content, actual Mandarin intelligibility and speaker similarity remain separate.",
              "preparation_verification": h.identity(QA / "preparation-verification.json"), "selection": h.identity(selection_path), "runtime_assets": runtime, "current_sources": sources,
              "results": results, "asr": {"result": h.identity(a_path), "guard": h.identity(ag_path), "reviews": reviews, "extrema": extrema,
                                        "minimum_commit_gib": extrema["globalCommitAvailableBytes"]["min"] / 2 ** 30, "forced_language": "zh"},
              "content_review_needed": any(x["content_review_needed"] for x in reviews), "subjective_listening_passed": None,
              "locks": locks, "native_process_remains": remains, "new_generation_count": 4,
              "failed_or_aborted_take_count": sum(sum(x["status"] != "complete" for x in r["take_history"]) for r in results),
              "audit_triggered_retries": 0, "quality_based_selection": False,
              "notes": ["Forced-Chinese ASR is not language truth. A matching transcript does not certify pronunciation or naturalness.",
                        "All original takes are retained; this verifier does not run additional models, ASR or corrections.",
                        "Yukino comfort take001 was aborted by the live memory guard with no WAV; the authorized same-config take002 is a resource retry, not quality selection."]}
    path = save("generation-verification.json", report)
    print(json.dumps({"status": report["status"], "report": str(path), "errors": h.ERRORS, "content_reviews": reviews}, ensure_ascii=False))


def delivery():
    package = h.read(QA / "package-receipt.json")
    generation_report = h.read(QA / "generation-verification.json")
    h.check(generation_report["status"] == "passed", "technical generation audit passed")
    index = h.verify_file(package["index"], "delivery index")
    class Links(HTMLParser):
        def __init__(self):
            super().__init__()
            self.targets = []
        def handle_starttag(self, tag, attrs):
            for key, value in attrs:
                if key in ("src", "href") and value:
                    self.targets.append(value)
    parser = Links()
    parser.feed(Path(index["path"]).read_text(encoding="utf-8"))
    links = []
    for value in sorted(set(parser.targets)):
        u = urlparse(value)
        if not u.path or u.scheme in ("https", "http", "data", "javascript"):
            continue
        target = unquote(u.path)
        if u.scheme == "file":
            target = target[1:] if re.match(r"^/[A-Za-z]:/", target) else target
            path = Path(target)
        else:
            path = (Path(index["path"]).parent / target).resolve()
        h.check(path.is_file(), "delivery link exists " + value)
        if path.is_file():
            links.append({"href": value, **h.identity(path)})
    expected_sources = {Path(x["files"]["output"]["path"]): x for x in generation_report["results"]}
    reference_files = []
    def check_reference_tree(value):
        if isinstance(value, dict):
            if all(k in value for k in ("path", "bytes", "sha256")):
                reference_files.append(h.verify_file(value, "delivered reference asset"))
            else:
                for item in value.values():
                    check_reference_tree(item)
        elif isinstance(value, list):
            for item in value:
                check_reference_tree(item)
    check_reference_tree(package["references"])
    required_reference_hashes = {r["reference"]["sha256"] for r in generation_report["results"]}
    h.check(required_reference_hashes.issubset({r["sha256"] for r in reference_files}), "delivered reference inputs match both actual generation references")
    assets, matched = [], set()
    h.check(len(package["generated"]) == 4, "four generated players")
    for row in package["generated"]:
        source = h.verify_file(row["source"], "delivery source")
        raw = h.verify_file(row["raw"], "delivery raw")
        listen = h.verify_file(row["listen"], "delivery listen")
        source_path = Path(source["path"])
        h.check(source_path in expected_sources, "delivered current native take")
        matched.add(source_path)
        h.check(source["sha256"] == raw["sha256"], "native unchanged in raw delivery")
        with wave.open(raw["path"], "rb") as f:
            a, rate, count = array.array("h", f.readframes(f.getnframes())), f.getframerate(), f.getnframes()
        with wave.open(listen["path"], "rb") as f:
            b = array.array("h", f.readframes(f.getnframes()))
            h.check((f.getframerate(), f.getnframes(), f.getnchannels(), f.getsampwidth()) == (rate, count, 1, 2), "listen format and duration")
        gain = 10 ** (row["gain_db"] / 20)
        max_error = max(abs(y - x * gain) for x, y in zip(a, b))
        h.check(len(a) == len(b) and max_error <= 0.502, "listen fixed gain only")
        h.check(all(v not in (-32768, 32767) for v in b), "listen has no clipping")
        assets.append({"id": row["id"], "source": source, "raw": raw, "listen": listen, "gain_db": row["gain_db"], "max_abs_static_gain_error_pcm16_units": max_error})
    h.check(matched == set(expected_sources), "all four current takes delivered once")
    old = [h.verify_file(item, "old delivered asset") for item in package["existing_assets_preserved"]]
    report = {"package": h.identity(QA / "package-receipt.json"), "generation_verification": h.identity(QA / "generation-verification.json"),
              "index": index, "local_links": links, "local_link_count": len(links), "generated": assets, "references": reference_files,
              "old_asset_count": len(old), "existing_assets_preserved": old, "all_native_outputs_delivered": len(matched) == 4,
              "browser_opened": False, "subjective_listening_performed": False,
              "notes": ["Links and audio identities verified from files; no browser or model opened.", "Static gain preserves spectral balance; Chinese pronunciation and similarity still require listening."]}
    path = save("independent-delivery-verification.json", report)
    print(json.dumps({"status": report["status"], "report": str(path), "errors": h.ERRORS, "links": len(links), "old_assets": len(old)}, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("preparation", "generation", "delivery"))
    mode = parser.parse_args().mode
    {"preparation": preparation, "generation": generation, "delivery": delivery}[mode]()
    raise SystemExit(bool(h.ERRORS))
