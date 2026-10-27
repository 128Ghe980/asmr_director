"""Reference-only adapter for the existing independent Chinese evidence audit."""
import argparse
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
COMMON = Path(__file__).with_name("verify_chinese_cfg2p5_step10.py")
spec = importlib.util.spec_from_file_location("chinese_evidence_common", COMMON)
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
h = v.h
PREVIOUS_QA = v.QA
QA = v.FOLLOWUP / "chinese-reference-only-cfg2p5-step10"
EXPECTED_CFG = 2.5
EXPECTED_TIMESTEPS = 10
EXPECTED_GRAPH_NODES = 4462
v.QA = QA
original_baselines, original_jobs, original_save = v.baselines, v.jobs, v.save


def baselines():
    bases = original_baselines()
    for base in bases.values():
        base["template"] = deepcopy(base["template"])
        base["template"]["references"][0]["mode"] = "reference_only"
        base["template"]["references"][0].pop("promptText")
        base["request"] = deepcopy(base["request"])
        base["request"]["mode"] = "reference_only"
        # The runner's legacy reference-only payload omits reference.mode.
        base["request"]["reference"].pop("mode", None)
        base["request"]["reference"].pop("promptText", None)
    return bases


def jobs(bases):
    found = original_jobs(bases)
    for job in found:
        old_path = PREVIOUS_QA / ("guarded-" + job["id"] + ".json")
        old = h.read(old_path)
        expected = deepcopy(old)
        expected["references"][0]["mode"] = "reference_only"
        expected["references"][0].pop("promptText")
        current = h.read(job["manifest"]["path"])
        h.check(current == expected, job["id"] + " only mode and prompt omission differ from previous Chinese case")
        h.check(not any(k.lower().startswith("prompt") for k in current["references"][0]), job["id"] + " manifest has no prompt fields")
        job["previous_combined_manifest"] = h.identity(old_path)
    return found


def save(name, report):
    report["audit_adapter"] = h.identity(Path(__file__))
    report["reference_mode"] = "reference_only"
    if name == "preparation-verification.json":
        report["checks"]["mode_and_prompt_only_change_from_previous_chinese"] = not h.ERRORS
        report["notes"] = ["Only mode changes to reference_only and promptText is removed from the four previous Chinese manifests.",
                           "Reference WAV, reference ID/name, seed, CFG2.5/10, both Chinese target texts and other controls are unchanged.",
                           "No prompt audio/text branch is authorized or prepared."]
    if name == "generation-verification.json":
        by_pair = {(r["voice"], r["target"]["id"]): r for r in report["results"]}
        token_checks = {}
        for text_id in v.TARGETS:
            counts = [by_pair[(voice, text_id)]["inferred_target_token_count"] for voice in v.BASES]
            h.check(counts[0] == counts[1], text_id + " target token count agrees across reference lengths")
            token_checks[text_id] = {"yukino": counts[0], "yui": counts[1], "equal": counts[0] == counts[1]}
        report["cross_voice_target_token_checks"] = token_checks
        report["notes"] = ["All four results are reference-only: no prompt audio/text arguments or prompt branch in native logs.",
                           "Forced-Chinese ASR remains content evidence only, not proof of language, intelligibility, accent or speaker similarity.",
                           "All native attempts are retained; resource failures are not quality selection."]
    return original_save(name, report)


def normalized_reference_request(request):
    normalized = deepcopy(request)
    normalized.setdefault("mode", "reference_only")
    if normalized["reference"].get("mode") == "reference_only":
        normalized["reference"].pop("mode")
    return normalized


def generation_case(job, base):
    case_dir = QA / "generation/audio" / job["reference_id"] / job["target"]["id"]
    history, completed = [], []
    for candidate in sorted(case_dir.glob("take-*/receipt.json")):
        prior = h.read(candidate)
        guard_path = next((p for p in QA.glob("guard*/summary.json") if h.read(p)["nativePid"] == prior.get("pid")), None)
        g = h.read(guard_path) if guard_path else None
        history.append({"take": candidate.parent.name, "receipt": h.identity(candidate), "status": prior.get("status"),
                        "exit_code": prior.get("exit_code"), "wav_exists": (candidate.parent / "generated.wav").exists(),
                        "guard": h.identity(guard_path) if guard_path else None, "guard_aborted": g.get("guardAborted") if g else None})
        if prior.get("status") == "complete" and prior.get("exit_code") == 0:
            completed.append(candidate)
        else:
            h.check(g is not None and g["guardAborted"] and g["nativeExitConfirmed"] and g["guard"]["reason"] == "global_commit_below_running_floor", job["id"] + " retained resource-aborted attempt")
            h.check(not (candidate.parent / "generated.wav").exists(), job["id"] + " aborted attempt has no WAV")
            expected = normalized_reference_request(prior["request"])
            expected["text"] = base["request"]["text"]
            h.check(expected == base["request"], job["id"] + " failed attempt had same reference-only controls")
            h.check(h.canonical(prior["request"]) == prior["request_sha256"] and h.canonical(prior["command"]) == prior["command_sha256"], job["id"] + " failed request/argv integrity")
            history[-1]["logs"] = {role: h.verify_file(prior[role], job["id"] + " failed " + role) for role in ("stdout", "stderr")}
            h.verify_file(g["rawSamples"], job["id"] + " failed guard samples")
            history[-1].update(resource_intervention=g["guard"], guard_extrema=h.sample_extrema(g["rawSamples"]["path"], g))
    h.check(len(completed) == 1, job["id"] + " unique successful take; no quality selection")
    if len(completed) != 1:
        raise ValueError("Expected one successful take for " + job["id"])
    receipt_path = completed[0]
    r = h.read(receipt_path)
    q, cmd, take = r["request"], r["command"], receipt_path.parent
    h.check(r["status"] == "complete" and r["exit_code"] == 0 and not r["oom_detected"] and not r["fatal_cuda_detected"], job["id"] + " native complete")
    h.check(q["text"] == job["target"], job["id"] + " target text unchanged")
    expected = normalized_reference_request(q)
    expected["text"] = base["request"]["text"]
    h.check(expected == base["request"], job["id"] + " reference-only request matches controls")
    h.check(q.get("mode", "reference_only") == "reference_only" and q["reference"].get("mode", "reference_only") == "reference_only", job["id"] + " legacy-compatible reference-only mode")
    h.check(not any(k.lower().startswith("prompt") for k in q["reference"]), job["id"] + " request has no prompt fields")
    h.check(h.canonical(q) == r["request_sha256"] and h.canonical(cmd) == r["command_sha256"], job["id"] + " request/argv integrity")
    initial = h.read(take / "request.json")
    h.check(initial["request"] == q and initial["command"] == cmd and initial["request_sha256"] == r["request_sha256"], job["id"] + " original request preserved")
    def opt(flag):
        return cmd[cmd.index(flag) + 1]
    cfg_literal = str(int(EXPECTED_CFG)) if float(EXPECTED_CFG).is_integer() else str(EXPECTED_CFG)
    for flag, value in {"--steps": "600", "--timesteps": str(EXPECTED_TIMESTEPS), "--cfg": cfg_literal, "--temperature": "1", "--seed": str(q["seed"]), "--n-gpu-layers": "0"}.items():
        h.check(opt(flag) == value, job["id"] + " CLI " + flag)
    h.check("--cpu" not in cmd and "--low-vram" in cmd, job["id"] + " GPU configuration")
    h.check(not any(str(arg).startswith("--prompt") for arg in cmd), job["id"] + " no prompt WAV/audio/text options")
    h.check(opt("-r") == q["reference"]["file"]["path"], job["id"] + " exact reference WAV")
    h.check(opt("-t") == job["target"]["text"] and Path(opt("-o")) == take / "generated.wav", job["id"] + " target/output arguments")
    h.check(cmd[0] == q["files"]["cliPath"]["path"] and cmd[-2:] == [q["files"]["baseModelPath"]["path"], q["files"]["acousticModelPath"]["path"]], job["id"] + " CLI/models")
    files = {role: h.verify_file(r[role], job["id"] + " " + role) for role in ("output", "stdout", "stderr")}
    metrics = h.pcm(files["output"]["path"])
    h.compare_metrics(metrics, r["wav_metrics"], job["id"] + " output PCM")
    h.check(metrics["sample_rate"] == 48000 and metrics["channels"] == 1 and metrics["clipped_samples"] == 0 and not metrics["max_steps_reached"], job["id"] + " PCM format/clipping/cap")
    log = Path(files["stderr"]["path"]).read_text(encoding="utf-8")
    config_pattern = r"Config:\s+steps=600 timesteps=" + str(EXPECTED_TIMESTEPS) + r" cfg=" + re.escape(f"{EXPECTED_CFG:.1f}") + r" temp=1\.0 seed=" + str(q["seed"])
    h.check(re.search(config_pattern, log) is not None, job["id"] + " actual settings")
    h.check("Backend:  GPU" in log and "custom component backend=CUDA0" in log, job["id"] + " actual GPU")
    duration = f'{base["metrics"]["frames"] / 16000:.2f}'
    h.check(f"Reference: {duration}s, 16000 Hz" in log and "sr=16000 out_sr=48000" in log, job["id"] + " full reference and encoder/output rates")
    h.check(not re.search(r"^\s*(Prompt:|Prompt text:|Loading prompt WAV:)", log, re.MULTILINE), job["id"] + " no prompt loading branch")
    h.check("combined prefill" not in log and "continuation prefill" not in log, job["id"] + " no combined/continuation prefill")
    graphs = re.findall(r"built decode_front_half graph \(timesteps=(\d+), cfg=([\d.]+), nodes=(\d+), buffer=([\d.]+) MiB\)", log)
    h.check(bool(graphs) and all((int(t), float(c), int(n)) == (EXPECTED_TIMESTEPS, EXPECTED_CFG, EXPECTED_GRAPH_NODES) for t, c, n, _ in graphs), job["id"] + " actual diffusion graph")
    seqs = [int(x) for x in re.findall(r"LocEnc sequence graph seq_len=(\d+)", log)]
    patches = (base["metrics"]["frames"] + 2559) // 2560
    h.check(len(seqs) == 1 and seqs[0] > patches + 3, job["id"] + " reference-only prefill total")
    tokens = seqs[0] - patches - 3 if seqs else None
    h.check(job["target"]["text"] in log, job["id"] + " UTF8 Chinese echo")
    guard_path = next(p for p in QA.glob("guard*/summary.json") if h.read(p)["nativePid"] == r["pid"])
    g = h.read(guard_path)
    h.check(g["exitCode"] == 0 and g["nativeExitConfirmed"] and not any(g[k] for k in ("guardAborted", "guardStartupFault", "failure", "observerErrors")), job["id"] + " successful guard exit")
    h.check(g["manifest"]["sha256"] == job["manifest"]["sha256"], job["id"] + " guarded manifest")
    h.verify_file(g["rawSamples"], job["id"] + " guard samples")
    extrema = h.sample_extrema(g["rawSamples"]["path"], g)
    h.check(extrema["globalCommitAvailableBytes"]["min"] >= g["runningFloorBytes"] and g["runtimeLockAbsent"] and g["batchLockAbsent"], job["id"] + " live protection and released locks")
    return {**job, "receipt": h.identity(receipt_path), "request_file": h.identity(take / "request.json"), "files": files,
            "request_sha256": r["request_sha256"], "command_sha256": r["command_sha256"], "parameters": q["parameters"], "seed": q["seed"],
            "reference": q["reference"]["file"], "reference_metrics": base["metrics"], "output_metrics": metrics, "actual_graphs": graphs,
            "reference_mode": "reference_only", "prompt_arguments_absent": True, "prompt_loading_branch_absent": True,
            "reference_patch_count": patches, "reference_patch_count_basis": "ceil(full reference PCM frames /2560); runtime reference-prefill structure, not a separately printed patch count",
            "logged_prefill_sequence_lengths": seqs, "inferred_target_token_count": tokens,
            "prefill_formula": "reference_patches + target_text_tokens +3 boundary tokens", "guard": h.identity(guard_path), "guard_extrema": extrema,
            "minimum_commit_gib": extrema["globalCommitAvailableBytes"]["min"] / 2 ** 30, "wall_seconds": r["wall_seconds"],
            "selected_take": take.name, "take_history": history, "resource_retry": len(history) > 1, "quality_based_selection": False}


v.baselines, v.jobs, v.save, v.generation_case = baselines, jobs, save, generation_case


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("preparation", "generation", "delivery"))
    args = parser.parse_args()
    {"preparation": v.preparation, "generation": v.generation, "delivery": v.delivery}[args.mode]()
    raise SystemExit(bool(h.ERRORS))
