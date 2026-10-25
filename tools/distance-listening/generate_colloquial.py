"""Generate the authorized colloquial long voice outside the workbench.

This harness uses the product's actual TypeScript long-text input/pause
functions and actual Python ASR/safe-cut implementation. It writes all takes,
ASR traces, logs, temporary files and final audio to its separate I-drive run.
The product's native-generation lock remains held across all six groups.
No text API is used. Existing takes and completed groups are resumed by hash.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import traceback
import unicodedata
import uuid

import numpy as np
import soundfile as sf

REPO = Path(__file__).resolve().parents[2]
RUNTIME = Path("D:/CodexWorkplace/asmr_director_runtime")
ASR_PYTHON = RUNTIME / "engines/gpt-sovits/env-comfyui-clone/python.exe"
ASR_MODEL = RUNTIME / "engines/gpt-sovits/GPT-SoVITS/tools/asr/models/faster-whisper-large-v3"
ANALYSIS_HELPER = REPO / "apps/web/scripts/analyze-voice-group.py"
PLAN_HELPER = REPO / "apps/web/src/lib/asmr/voice-longtext-plan.ts"
LEGACY_ASR_HELPER = Path("I:/AI/voxcpm2-evaluation/tools/package-clause16-edge-opening-comparison.py")
PROFILE = RUNTIME / "audio-quality-v1/voxcpm2/profile.json"
DEFAULT_OUTPUT = Path("I:/AI/asmr_director/qa/distance-listening/2026-09-14-colloquial-source")
GROUPS = [
    "你躺好了吗？枕头不舒服的话，就挪一挪。",
    "被子盖到这里可以吗？脚别露在外面，会有点凉。",
    "手机先放旁边吧，有消息明天再看。现在不用陪我聊天，想闭眼就闭眼。",
    "我就小声跟你说几句，你听着就行。今天忙了一天，先歇一歇，别的事等睡醒了再说。",
    "要是还没困，也没关系，不用急着睡。你就找个舒服的姿势，慢慢呼吸。",
    "我会陪着你，你想睡的时候就睡。",
]
RATE = 48000


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PLAN_BRIDGE = r'''
const fs=require('fs'), path=require('path'), {createRequire}=require('module');
const [repo,requestPath]=process.argv.slice(2);
const appRequire=createRequire(path.join(repo,'apps/web/package.json'));
const ts=appRequire('typescript');
const source=fs.readFileSync(path.join(repo,'apps/web/src/lib/asmr/voice-longtext-plan.ts'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleObject={exports:{}};
new Function('require','module','exports',code)(appRequire,moduleObject,moduleObject.exports);
const H=moduleObject.exports,request=JSON.parse(fs.readFileSync(requestPath,'utf8'));
let result;
if(request.action==='plan') {
 const clauses=request.groups.flatMap(text=>H.splitVoiceClauses(text));
 const classes=clauses.slice(0,-1).map(text=>/[。！？!?；;]/.test(text)?'medium':'short');
 let cursor=0;
 const groups=request.groups.map(text=>{const count=H.splitVoiceClauses(text).length,start=cursor;cursor+=count;return {start,end:cursor-1,text,pauseAfter:classes[cursor-1]??'long'};});
 const plan={clauses,groups,clausePauseClasses:classes,provider:'manual',model:'user-approved six semantic groups; punctuation pause classes',warnings:[]};
 result={plan,targets:H.buildLongTextInputs(plan)};
} else if(request.action==='pauses') result=H.chooseGroupPauses(request.groups);
else throw new Error('Unknown bridge action');
process.stdout.write(JSON.stringify(result));
'''


def product_plan_call(output, request):
    bridge = output / "product-plan-bridge.cjs"
    bridge.write_text(PLAN_BRIDGE, encoding="utf-8")
    request_path = output / ("product-" + request["action"] + "-request.json")
    write_json(request_path, request)
    result = subprocess.run(["D:/nodejs/node.exe", str(bridge), str(REPO), str(request_path)],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return json.loads(result.stdout.decode("utf-8"))


@contextmanager
def runtime_lock():
    path = RUNTIME / "locks/voxcpm2-generation.lock"
    path.parent.mkdir(exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    token = str(uuid.uuid4())
    owner = dict(ownerPid=os.getpid(), ownerToken=token, childPid=None, createdAt=now())
    child_alive = False

    def record(pid):
        nonlocal child_alive
        child_alive = pid is not None
        owner["childPid"] = pid
        data = json.dumps(owner).ljust(256).encode("utf-8")
        os.lseek(fd, 0, os.SEEK_SET)
        os.write(fd, data)
        os.ftruncate(fd, len(data))
        os.fsync(fd)

    try:
        record(None)
        yield record
    finally:
        os.close(fd)
        # Do not release an unconfirmed child or a lock owned by another run.
        if not child_alive and path.exists() and read_json(path).get("ownerToken") == token:
            path.unlink()


def run_child(command, log_path, cwd, output, lock_record, timeout=600):
    env = dict(os.environ, HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", PYTHONDONTWRITEBYTECODE="1",
               TEMP=str(output / "tmp"), TMP=str(output / "tmp"), PYTHONIOENCODING="utf-8",
               CUDA_CACHE_PATH=str(output / "cuda-cache"))
    start = time.perf_counter()
    with log_path.open("wb") as log:
        child = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        lock_record(child.pid)
        try:
            code = child.wait(timeout=timeout)
        except BaseException:
            child.kill()
            child.wait(timeout=30)
            raise
        finally:
            if child.poll() is not None:
                lock_record(None)
    return dict(command=command, cwd=str(cwd), exit_code=code, wall_seconds=round(time.perf_counter() - start, 3), log=str(log_path))


def analysis_child(request_path):
    request = read_json(request_path)
    H = load_module(ANALYSIS_HELPER, "product_group_analysis")
    from faster_whisper import WhisperModel
    model = WhisperModel(str(ASR_MODEL), device="cpu", compute_type="int8", cpu_threads=4, num_workers=1, local_files_only=True)
    source, rate = sf.read(request["inputWav"], dtype="float64")
    if rate != RATE or source.ndim != 1:
        raise ValueError("expected native 48 kHz mono")
    traces = []
    transcribe = H.transcribe

    def capture(model, audio):
        transcript, words = transcribe(model, audio)
        traces.append(dict(duration=len(audio) / RATE, transcript=transcript, words=words))
        write_json(request["traceJson"], traces)
        return transcript, words

    H.transcribe = capture
    try:
        processed, result = H.analyze(model, source, request["expectedText"], request["followingText"], request["clauses"])
        sf.write(request["outputWav"], processed, RATE, subtype="PCM_16")
    except H.UnsafeGroup as error:
        result = dict(version=1, success=False, code=str(error))
    except Exception:
        traceback.print_exc()
        result = dict(version=1, success=False, code="analysis_failed")
    result["analysisHelperSha256"] = digest(ANALYSIS_HELPER)
    write_json(request["outputJson"], result)


def final_asr_child(output):
    H = load_module(ANALYSIS_HELPER, "product_group_analysis")
    E = load_module(LEGACY_ASR_HELPER, "prior_listening_asr_checks")
    from faster_whisper import WhisperModel
    model = WhisperModel(str(ASR_MODEL), device="cpu", compute_type="int8", cpu_threads=4, num_workers=1, local_files_only=True)
    path = output / "colloquial-final.wav"
    plan = read_json(output / "plan.json")
    source_text = "".join(plan["plan"]["clauses"])
    audio, rate = sf.read(path, dtype="float64")
    if rate != RATE or audio.ndim != 1:
        raise ValueError("unexpected final audio format")
    transcript, words = H.transcribe(model, audio)
    coverage = E.ordered_clause_coverage(plan["plan"]["clauses"], transcript)
    repeats = E.unexpected_repeated_ngrams(source_text, transcript, n=12)
    errors = []
    try:
        H.validate_words(words, len(audio) / RATE)
        content_score = H.content_score(source_text, transcript)
    except H.UnsafeGroup as error:
        errors.append(str(error))
        content_score = None
    passed = coverage["all_covered_in_order"] and not repeats and not errors
    record = dict(path=str(path), sha256=digest(path), passed=passed, duration=len(audio) / RATE,
                  transcript=transcript, words=words, content_score=content_score, errors=errors,
                  ordered_clause_coverage=coverage, unexpected_repeated_12grams=repeats)
    write_json(output / "final-asr.json", dict(source_text=source_text, created_at=now(),
               model=str(ASR_MODEL), backend="faster-whisper-large-v3/cpu/int8", records=[record]))


def assemble(output, selected, plan):
    pause_groups = [dict(internalPausesMs=row["analysis"]["internalPausesMs"],
                         internalPauseClasses=plan["plan"]["clausePauseClasses"][group["start"]:group["end"]],
                         pauseAfter=group["pauseAfter"])
                    for row, group in zip(selected, plan["plan"]["groups"])]
    joins = product_plan_call(output, dict(action="pauses", groups=pause_groups))
    parts, timeline, cursor = [], [], 0
    for index, row in enumerate(selected):
        audio, rate = sf.read(row["processed_path"], dtype="float32")
        if rate != RATE or audio.ndim != 1:
            raise ValueError("invalid processed group")
        parts.append(audio)
        timeline.append(dict(group=index + 1, start_sample=cursor, frames=len(audio), duration=len(audio) / RATE))
        cursor += len(audio)
        if index < len(joins):
            existing = row["analysis"]["trailingQuietMs"] + selected[index + 1]["analysis"]["leadingQuietMs"]
            added = max(0, int(np.floor((joins[index]["durationMs"] - existing) * 48 + 0.5)))
            joins[index].update(addedSilenceSamples=added, existingQuietMs=existing, actualDurationMs=round(existing + added / 48, 1))
            parts.append(np.zeros(added, dtype=np.float32))
            cursor += added
    samples = np.concatenate(parts)
    peak = float(abs(samples).max())
    active = samples[abs(samples) >= max(peak * .01, .001)].astype(np.float64)
    rms = float(np.sqrt(np.mean(active**2)))
    gain = min(10 ** (-27 / 20) / rms, 10 ** (-1 / 20) / peak)
    samples *= gain
    path = output / "colloquial-final.wav"
    sf.write(path, samples, RATE, subtype="PCM_16")
    return dict(path=str(path), sha256=digest(path), duration=len(samples) / RATE, frames=len(samples),
                sample_rate=RATE, channels=1, loudness_gain_db=20 * np.log10(gain), joins=joins, timeline=timeline,
                assembly_recipe="product class-local pauses; add only zero silence; one whole-result active RMS -27dBFS, peak ceiling -1dBFS")


def generate(output, revise_source=False):
    output.mkdir(parents=True, exist_ok=True)
    (output / "tmp").mkdir(exist_ok=True)
    (output / "cuda-cache").mkdir(exist_ok=True)
    plan = product_plan_call(output, dict(action="plan", groups=GROUPS))
    revision_record = None
    if (output / "plan.json").exists() and read_json(output / "plan.json") != plan:
        if not revise_source:
            raise ValueError("existing run belongs to another text or plan; use --revise-source only for the explicitly authorized text revision")
        revision_index = len(list(output.glob("plan-before-revision-*.json"))) + 1
        old_plan = output / f"plan-before-revision-{revision_index}.json"
        old_manifest = output / f"source_tts-before-revision-{revision_index}.json"
        old_plan.write_bytes((output / "plan.json").read_bytes())
        old_manifest.write_bytes((output / "source_tts.json").read_bytes())
        revision_record = dict(at=now(), previous_plan=str(old_plan), previous_manifest=str(old_manifest),
                               previous_manifest_sha256=digest(old_manifest), new_source_text="".join(GROUPS),
                               reason="Root-authorized colloquial wording revision to avoid ambiguous erhua transcription; strict product ASR unchanged; earlier accepted prefixes and their actual historical continuation inputs retained.",
                               changed_groups=[dict(group=index + 1, previous=old["text"], current=new)
                                               for index, (old, new) in enumerate(zip(read_json(old_plan)["plan"]["groups"], GROUPS))
                                               if old["text"] != new])
    write_json(output / "plan.json", plan)
    (output / "transcript.txt").write_text("".join(GROUPS), encoding="utf-8")
    profile = read_json(PROFILE)
    reference = next(row for row in profile["references"] if row["id"] == "soft_zh")
    reference_path = Path(reference["audioPath"])
    prompt = (PROFILE.parent / reference["promptTextPath"]).read_text(encoding="utf-8").strip()
    prompt = "".join(" " if unicodedata.category(char).startswith("P") else char for char in prompt)
    prompt = re.sub(r"\s+", " ", prompt).strip() + " "
    metadata_path = output / "source_tts.json"
    metadata = read_json(metadata_path) if metadata_path.exists() else dict(version=1, created_at=now(), status="running", attempts=[])
    if revision_record:
        metadata.setdefault("source_revisions", []).append(revision_record)
    for old_attempt in metadata["attempts"]:
        if old_attempt.get("failure") == "native_generation_failed" and not Path(old_attempt["raw_path"]).exists():
            old_attempt["failure_class"] = "technical_no_audio"
    metadata.update(status="running", technical_recovery="Initial no-audio CUDA/native failures retained and excluded from content retry budget; CUDA cache redirected to I drive.")
    metadata.update(source_text="".join(GROUPS), semantic_groups=GROUPS, profile=str(PROFILE), profile_sha256=digest(PROFILE),
                    model="VoxCPM2", reference_mode="with_reference_text", reference_id="soft_zh",
                    reference_path=str(reference_path), reference_sha256=digest(reference_path), prompt_text=prompt,
                    cli_path=profile["cliPath"], cli_sha256=digest(profile["cliPath"]),
                    parameters=dict(timesteps=10, cfg=2, temperature=1, gpu_layers=0, low_vram=True),
                    asr_python=str(ASR_PYTHON), asr_model=str(ASR_MODEL),
                    product_plan_sha256=digest(PLAN_HELPER), product_analysis_sha256=digest(ANALYSIS_HELPER),
                    generator_sha256=digest(__file__), output_root=str(output), network_used=False)
    metadata["models"] = []
    for key in ("baseModelPath", "acousticModelPath"):
        info = Path(profile[key]).stat()
        metadata["models"].append(dict(role=key, path=profile[key], bytes=info.st_size, mtime_ns=info.st_mtime_ns))
    selected = []
    write_json(metadata_path, metadata)
    with runtime_lock() as lock_record:
        for index, target in enumerate(plan["targets"], 1):
            saved = next((row for row in metadata["attempts"] if row["group"] == index and row.get("accepted") and row["expected_text"] == target["expectedText"]), None)
            if saved and Path(saved["processed_path"]).exists() and digest(saved["processed_path"]) == saved["processed_sha256"]:
                selected.append(saved)
                print(f"resume accepted group {index}", flush=True)
                continue
            accepted = None
            prior_attempts = [row["attempt"] for row in metadata["attempts"] if row["group"] == index]
            content_attempts = sum(row.get("failure_class") != "technical_no_audio" for row in metadata["attempts"] if row["group"] == index and row["expected_text"] == target["expectedText"])
            for attempt in range(max(prior_attempts, default=0) + 1, max(prior_attempts, default=0) + 4 - content_attempts):
                directory = output / f"group-{index:02d}-take-{attempt}"
                directory.mkdir(exist_ok=False)
                raw, processed = directory / "raw.wav", directory / "processed.wav"
                seed = 92014000 + index * 100 + content_attempts + 1
                steps = min(600, max(120, len(target["text"]) * 5 + 60))
                row = dict(group=index, attempt=attempt, seed=seed, created_at=now(), expected_text=target["expectedText"],
                           input_text=target["text"], padding_clauses=target["paddingClauses"], raw_path=str(raw),
                           processed_path=str(processed), accepted=False, max_steps=steps)
                metadata["attempts"].append(row)
                write_json(metadata_path, metadata)
                command = [profile["cliPath"], "-t", target["text"], "-o", str(raw), "--steps", str(steps),
                           "--timesteps", "10", "--cfg", "2", "--temperature", "1", "--seed", str(seed),
                           "--n-gpu-layers", "0", "--low-vram", "-r", str(reference_path),
                           "--prompt-wav", str(reference_path), "--prompt-text", prompt,
                           profile["baseModelPath"], profile["acousticModelPath"]]
                print(f"generate group {index}/6 attempt {attempt}, seed {seed}", flush=True)
                row["generation"] = run_child(command, directory / "generation.log", Path(profile["cliPath"]).parent, output, lock_record)
                if row["generation"]["exit_code"] != 0 or not raw.exists():
                    row["failure"] = "native_generation_failed"
                    row["failure_class"] = "technical_no_audio"
                    write_json(metadata_path, metadata)
                    raise RuntimeError("native technical failure; inspect before another attempt")
                content_attempts += 1
                info = sf.info(raw)
                row.update(raw_sha256=digest(raw), raw_duration=info.duration, generated_steps=info.frames / 7680)
                if info.channels != 1 or info.samplerate != RATE or info.frames / 7680 >= steps - .001:
                    row["failure"] = "native_format_or_length_limit"
                    write_json(metadata_path, metadata)
                    continue
                request = dict(inputWav=str(raw), outputWav=str(processed), outputJson=str(directory / "analysis.json"),
                               traceJson=str(directory / "asr-traces.json"), expectedText=target["expectedText"],
                               followingText=target.get("followingText", ""), clauses=target["clauses"])
                request_path = directory / "analysis-request.json"
                write_json(request_path, request)
                write_json(metadata_path, metadata)
                print(f"verify/cut group {index}/6 attempt {attempt}, raw {info.duration:.2f}s", flush=True)
                row["analysis_process"] = run_child([str(ASR_PYTHON), str(Path(__file__).resolve()), "--analyze-request", str(request_path)],
                                                    directory / "analysis.log", directory, output, lock_record)
                row["analysis"] = read_json(request["outputJson"]) if Path(request["outputJson"]).exists() else dict(success=False, code="missing_analysis_output")
                if row["analysis_process"]["exit_code"] == 0 and row["analysis"]["success"] and processed.exists():
                    row.update(accepted=True, processed_sha256=digest(processed), processed_duration=sf.info(processed).duration)
                    accepted = row
                else:
                    row["failure"] = row["analysis"].get("code", "failed_analysis")
                write_json(metadata_path, metadata)
                print(f"group {index} result: {row.get('failure', 'accepted')}", flush=True)
                if accepted:
                    break
            if not accepted:
                metadata.update(status="failed", failed_group=index)
                write_json(metadata_path, metadata)
                raise RuntimeError(f"group {index} did not pass bounded retries")
            selected.append(accepted)
        metadata["final"] = assemble(output, selected, plan)
        write_json(metadata_path, metadata)
        print(f"assembled {metadata['final']['duration']:.2f}s; final independent ASR", flush=True)
        metadata["final_asr_process"] = run_child([str(ASR_PYTHON), str(Path(__file__).resolve()), "--verify-final", str(output)],
                                                 output / "final-asr.log", output, output, lock_record)
        report = read_json(output / "final-asr.json")
        metadata.update(status="complete" if report["records"][0]["passed"] else "final_asr_failed", completed_at=now(), final_asr_path=str(output / "final-asr.json"))
        metadata["final_asr_sha256"] = digest(output / "final-asr.json")
        if metadata["status"] == "complete":
            metadata.pop("failed_group", None)
        write_json(metadata_path, metadata)
        print(json.dumps(dict(status=metadata["status"], final=metadata["final"], asr=metadata["final_asr_path"]), ensure_ascii=False), flush=True)
        if metadata["status"] != "complete":
            raise RuntimeError("final independent ASR did not pass")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--analyze-request", type=Path)
    parser.add_argument("--verify-final", type=Path)
    parser.add_argument("--revise-source", action="store_true")
    args = parser.parse_args()
    if args.analyze_request:
        analysis_child(args.analyze_request)
    elif args.verify_final:
        final_asr_child(args.verify_final)
    else:
        generate(args.output.resolve(), revise_source=args.revise_source)
