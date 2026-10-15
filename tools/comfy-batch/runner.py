#!/usr/bin/env python3
"""Standalone, standard-library ComfyUI batch runner. See README.zh.md."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import mimetypes
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave

FPS = 24
RUNNER_VERSION = 1
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v"}
CONTINUITY = (
    "<Picture 2> is the final frame of the immediately previous clip and the "
    "opening-frame target for this clip. Begin directly from <Picture 2>. "
    "Preserve its framing, viewpoint, lighting, pose and prop positions; "
    "continue smoothly without a cut or pose reset."
)


class BatchError(Exception):
    pass


class ApiError(BatchError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def slug(value):
    return re.sub(r"[^A-Za-z0-9_-]+", "_", str(value)).strip("_")[:64] or "project"


def package_path(root, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise BatchError("项目素材路径必须是项目内的相对路径。")
    root = Path(root).resolve()
    target = (root / relative).resolve()
    try:
        target.relative_to(root)
    except ValueError as error:
        raise BatchError("项目素材路径超出项目目录。") from error
    if not target.is_file():
        raise BatchError(f"项目文件不存在：{relative}")
    return target


def load_package(folder):
    root = Path(folder).expanduser().resolve()
    try:
        manifest = json.loads((root / "project.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise BatchError(f"无法读取 project.json：{error}") from error
    if not isinstance(manifest, dict) or manifest.get("format") != "asmr-video-package" or manifest.get("version") != 1:
        raise BatchError("不支持的项目包格式，需要 asmr-video-package version 1。")
    if not isinstance(manifest.get("projectId"), str) or not manifest["projectId"]:
        raise BatchError("projectId 必须是非空文字。")
    shots = manifest.get("shots")
    if not isinstance(shots, list) or not shots:
        raise BatchError("项目包没有镜头。")
    ids, orders = set(), set()
    for shot in shots:
        if not isinstance(shot, dict) or not isinstance(shot.get("id"), str) or not shot["id"]:
            raise BatchError("每个镜头需要非空 id。")
        order = shot.get("order")
        duration = shot.get("durationSeconds")
        if type(order) is not int or order <= 0 or order in orders or shot["id"] in ids:
            raise BatchError("镜头 id/order 必须唯一，order 必须为正整数。")
        if shot.get("kind") not in ("speech", "ambient") or shot.get("referenceMode") not in ("new", "continuous"):
            raise BatchError(f"镜头 {shot['id']} 的 kind/referenceMode 无效。")
        if not isinstance(shot.get("prompt"), str) or not shot["prompt"].strip():
            raise BatchError(f"镜头 {shot['id']} 缺少完整提示词。")
        if type(duration) not in (int, float) or not math.isfinite(duration) or duration <= 0:
            raise BatchError(f"镜头 {shot['id']} 的时长无效。")
        if shot["kind"] == "speech" and not isinstance(shot.get("audio"), str):
            raise BatchError(f"对白镜头 {shot['id']} 缺少音频。")
        ids.add(shot["id"])
        orders.add(order)
    manifest["shots"] = sorted(shots, key=lambda shot: shot["order"])
    template_path = package_path(root, manifest.get("workflow", "workflow_api.json"))
    try:
        template = json.loads(template_path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise BatchError(f"工作流不是有效 JSON：{error}") from error
    if not isinstance(template, dict) or "nodes" in template:
        raise BatchError("工作流需要 API 格式，不能使用带 nodes/links 的界面工作流。")
    for node_id, expected in {"22": "MiniMaxH3ReferenceToVideo", "11": "CreateVideo", "26": "SaveVideo", "20": "LoadImage", "24": "LoadAudio", "4": "VAEDecodeAudio", "10": "RandomNoise"}.items():
        if template.get(node_id, {}).get("class_type") != expected:
            raise BatchError(f"API 模板需要节点 {node_id} ({expected})。")
    return root, manifest, template, file_hash(template_path)


def shot_facts(root, shot):
    audio_path = None
    audio_sha = None
    if shot["kind"] == "speech":
        audio_path = package_path(root, shot["audio"])
        try:
            with wave.open(str(audio_path), "rb") as audio:
                if audio.getcomptype() != "NONE" or not audio.getnframes() or audio.getframerate() <= 0:
                    raise BatchError("对白需要有效的未压缩 PCM WAV。")
                duration = audio.getnframes() / audio.getframerate()
                remaining = audio.getnframes() * audio.getnchannels() * audio.getsampwidth()
                while remaining:
                    block = audio.readframes(65536)
                    if not block:
                        raise BatchError("对白 WAV 数据不完整，不能以声明时长代替真实音频。")
                    remaining -= len(block)
        except (wave.Error, EOFError, OSError) as error:
            raise BatchError(f"无法读取对白 WAV：{error}") from error
        audio_sha = file_hash(audio_path)
        target_frames = max(1, math.ceil(duration * FPS - 1e-9))
    else:
        duration = min(float(shot["durationSeconds"]), 5.0)
        target_frames = max(1, math.floor(duration * FPS + 1e-9))
    generation_frames = max(5, target_frames)
    generation_frames += (5 - generation_frames) % 17
    if generation_frames > 3600:
        raise BatchError("本镜超过 H3 单次 3600 帧输入上限，请先在项目中拆成较短镜头。")
    return {"kind": shot["kind"], "audio_path": audio_path, "audio_sha256": audio_sha,
            "source_duration": duration, "target_frames": target_frames,
            "target_duration": target_frames / FPS, "generation_frames": generation_frames}


def prune_graph(graph):
    needed = set()

    def visit(node_id):
        if node_id in needed:
            return
        if node_id not in graph:
            raise BatchError(f"工作流引用不存在的节点 {node_id}。")
        needed.add(node_id)
        for value in graph[node_id].get("inputs", {}).values():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and type(value[1]) is int:
                visit(value[0])
    visit("26")
    return {node_id: value for node_id, value in graph.items() if node_id in needed}


def build_graph(template, shot, facts, character, audio=None, tail=None, width=1216, height=672, seed=1, output_prefix=None):
    graph = copy.deepcopy(template)
    reference = graph["22"]["inputs"]
    for key in list(reference):
        if key.startswith(("ref_images", "ref_audios", "ref_videos", "ref_video_audios")):
            del reference[key]
    reference.update({"prompt": shot["prompt"].strip() + (("\n\n" + CONTINUITY) if tail else ""),
                      "width": width, "height": height, "length": facts["generation_frames"],
                      "ref_images.ref_image_0": ["20", 0]})
    graph["20"]["inputs"]["image"] = character
    graph["10"]["inputs"]["noise_seed"] = (seed + shot["order"]) % (2 ** 64)
    graph["11"]["inputs"]["fps"] = FPS
    if shot["kind"] == "speech":
        graph["24"]["inputs"]["audio"] = audio or "__SPEECH_AUDIO__"
        reference["ref_audios.ref_audio_0"] = ["24", 0]
        graph["11"]["inputs"]["audio"] = ["24", 0]
    else:
        graph["11"]["inputs"]["audio"] = ["4", 0]
    if tail:
        graph["900"] = {"class_type": "LoadImage", "inputs": {"image": tail}}
        reference["ref_images.ref_image_1"] = ["900", 0]
    graph["26"]["inputs"]["filename_prefix"] = output_prefix or f"asmr-batch/{slug(shot['id'])}"
    return prune_graph(graph)


def normalize_url(value):
    parsed = urllib.parse.urlsplit(value.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise BatchError("ComfyUI 地址需要 http(s)://主机:端口，不包含账号密码或查询参数。")
    return value.strip().rstrip("/")


class ComfyClient:
    def __init__(self, base_url, timeout=30):
        self.base_url = normalize_url(base_url)
        self.timeout = timeout

    def request(self, route, body=None, content_type=None):
        headers = {"User-Agent": "ASMR-Comfy-Batch/1"}
        if content_type:
            headers["Content-Type"] = content_type
        request = urllib.request.Request(self.base_url + route, data=body, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            # Do not print response bodies: they may echo the user's complete prompt.
            raise ApiError(f"ComfyUI HTTP {error.code}: {route.split('?')[0]}", error.code) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise ApiError(f"ComfyUI 网络请求未确认：{route.split('?')[0]} ({type(error).__name__})") from error

    def get(self, route):
        try:
            return json.loads(self.request(route))
        except (ValueError, UnicodeError) as error:
            raise ApiError("ComfyUI 返回了无效 JSON。") from error

    def submit(self, graph, submission_id):
        body = {"prompt": graph, "client_id": submission_id,
                "extra_data": {"asmr_batch_submission_id": submission_id}}
        try:
            result = json.loads(self.request("/prompt", json.dumps(body).encode("utf-8"), "application/json"))
        except (ValueError, UnicodeError) as error:
            raise ApiError("提交响应不可读，任务是否已入队需要对账。") from error
        if not isinstance(result, dict) or not isinstance(result.get("prompt_id"), str):
            raise ApiError("提交响应缺少 prompt_id，任务是否已入队需要对账。")
        return result["prompt_id"]

    def upload(self, path):
        path = Path(path)
        boundary = "asmr-" + uuid.uuid4().hex
        filename = "asmr_" + file_hash(path)[:24] + path.suffix.lower()
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        fields = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\ninput\r\n"
                  f"--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n"
                  f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{filename}\"\r\n"
                  f"Content-Type: {mime}\r\n\r\n").encode("ascii")
        result = json.loads(self.request("/upload/image", fields + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode("ascii"), f"multipart/form-data; boundary={boundary}"))
        if not isinstance(result.get("name"), str):
            raise BatchError("素材上传响应缺少文件名。")
        return "/".join(part for part in (result.get("subfolder", ""), result["name"]) if part)

    def download(self, locator, target):
        query = urllib.parse.urlencode({"filename": locator["filename"], "subfolder": locator.get("subfolder", ""), "type": locator.get("type", "output")})
        target = Path(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + ".part")
        try:
            with urllib.request.urlopen(self.base_url + "/view?" + query, timeout=self.timeout) as response, temporary.open("wb") as output:
                shutil.copyfileobj(response, output, 1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            if temporary.stat().st_size == 0:
                raise BatchError("ComfyUI 返回了空视频。")
            os.replace(temporary, target)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise ApiError("视频下载未完成；保留 prompt_id，恢复时重新下载。") from error


def record_submission(record):
    prompt = record.get("prompt") if isinstance(record, dict) else None
    if isinstance(prompt, list) and len(prompt) > 3 and isinstance(prompt[3], dict):
        extra = prompt[3]
        return extra.get("asmr_batch_submission_id") or extra.get("client_id")
    return None


def locate_job(client, entry):
    """Read-only reconciliation. A missing record never grants permission to submit."""
    prompt_id = entry.get("prompt_id")
    if prompt_id:
        history = client.get("/history/" + urllib.parse.quote(prompt_id, safe=""))
        if prompt_id in history:
            return "history", prompt_id, history[prompt_id]
    else:
        history = client.get("/history?max_items=1000")
        for candidate_id, record in history.items():
            if record_submission(record) == entry["submission_id"]:
                return "history", candidate_id, record
    remote_queue = client.get("/queue")
    for group in ("queue_running", "queue_pending"):
        for item in remote_queue.get(group, []):
            if not isinstance(item, list) or len(item) < 4:
                continue
            extra = item[3] if isinstance(item[3], dict) else {}
            submission = extra.get("asmr_batch_submission_id") or extra.get("client_id")
            if (prompt_id and item[1] == prompt_id) or (not prompt_id and submission == entry["submission_id"]):
                return "queue", item[1], None
    return "missing", prompt_id, None


def history_result(record):
    status = record.get("status", {})
    if status.get("status_str") == "error":
        return "failed"
    if status.get("completed") or status.get("status_str") == "success":
        return "succeeded"
    # Some server versions omit status on a completed nonempty history entry.
    if record.get("outputs", {}).get("26"):
        return "succeeded"
    return "failed"


def saved_video(record):
    output = record.get("outputs", {}).get("26", {})
    for key in ("videos", "images", "gifs"):
        for locator in output.get(key, []):
            if isinstance(locator, dict) and Path(locator.get("filename", "")).suffix.lower() in VIDEO_EXTENSIONS:
                return locator
    raise BatchError("SaveVideo 节点 26 没有可下载的视频输出。")


def find_ffmpeg(explicit=None):
    if explicit:
        candidate = shutil.which(explicit) or str(Path(explicit).expanduser())
        if not Path(candidate).is_file():
            raise BatchError("指定的 FFmpeg 文件不存在。")
        return candidate
    candidate = shutil.which("ffmpeg")
    if candidate:
        return candidate
    try:
        import imageio_ffmpeg  # Optional existing package; never installed by this runner.
        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError) as error:
        raise BatchError("找不到 FFmpeg，请用 --ffmpeg 指定 ffmpeg.exe，或在窗口中选择。") from error


def run_ffmpeg(executable, arguments, timeout=300):
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        result = subprocess.run([str(executable), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", *map(str, arguments)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, creationflags=flags)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise BatchError(f"FFmpeg 未完成：{type(error).__name__}") from error
    if result.returncode:
        detail = result.stderr.decode("utf-8", errors="replace")[-1600:]
        raise BatchError("FFmpeg 处理失败：" + detail)


def extract_tail(executable, video, target):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(executable, ["-sseof", "-2", "-i", video, "-map", "0:v:0", "-an", "-vsync", "0", "-update", "1", target])
    if not target.is_file() or not target.stat().st_size:
        raise BatchError("没有提取到上一镜尾帧。")
    return target


def finish_video(executable, raw, target, entry):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    # A closing GUI can leave an encoder finishing in the OS; do not reuse its file.
    temporary = target.with_name(target.stem + ".part-" + uuid.uuid4().hex + ".mp4")
    arguments = ["-i", raw]
    if entry["kind"] == "speech":
        if entry.get("audio_sha256") and file_hash(entry["audio_snapshot"]) != entry["audio_sha256"]:
            raise BatchError("已保存的原音快照发生变化，停止封装；不会重新生成模型任务。")
        arguments += ["-i", entry["audio_snapshot"], "-map", "0:v:0", "-map", "1:a:0"]
    else:
        arguments += ["-map", "0:v:0", "-map", "0:a:0"]
    arguments += ["-t", f"{entry['target_duration']:.12f}", "-r", str(FPS), "-af", "apad",
                  "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
                  "-threads", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", temporary]
    run_ffmpeg(executable, arguments)
    if not temporary.is_file() or not temporary.stat().st_size:
        raise BatchError("FFmpeg 没有输出最终视频。")
    os.replace(temporary, target)
    return target


def concat_videos(executable, clips, target):
    """Reset per-clip decoded timestamps; AAC packet padding must not add gaps."""
    target = Path(target)
    temporary = target.with_name(f"preview.part-{uuid.uuid4().hex}.mp4")
    try:
        if not clips:
            raise BatchError("顺序预览没有可拼接镜头。")
        arguments, filters, labels = [], [], []
        total_frames = 0
        for index, (source, duration) in enumerate(clips):
            if type(duration) not in (int, float) or not math.isfinite(duration) or duration <= 0:
                raise BatchError("顺序预览的片段时长无效。")
            frame_count = max(1, round(duration * FPS))
            sample_count = round(frame_count / FPS * 48000)
            total_frames += frame_count
            arguments += ["-i", source]
            # Only generated indices/numbers enter the filter expression; file
            # paths remain separate subprocess arguments, including paths with spaces.
            filters += [f"[{index}:v:0]trim=end_frame={frame_count},setpts=N/({FPS}*TB)[v{index}]",
                        f"[{index}:a:0]aresample=48000,aformat=channel_layouts=stereo,apad,"
                        f"atrim=end_sample={sample_count},asetpts=N/SR/TB[a{index}]"]
            labels.append(f"[v{index}][a{index}]")
        filters.append("".join(labels) + f"concat=n={len(clips)}:v=1:a=1[video][audio]")
        run_ffmpeg(executable, [*arguments, "-filter_complex", ";".join(filters), "-map", "[video]", "-map", "[audio]",
                               "-t", f"{total_frames / FPS:.12f}", "-frames:v", str(total_frames), "-r", str(FPS),
                               "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
                               "-threads", "2", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k",
                               "-movflags", "+faststart", temporary])
        if not temporary.is_file() or not temporary.stat().st_size:
            raise BatchError("FFmpeg 没有输出顺序预览片。")
        os.replace(temporary, target)
        return target
    finally:
        temporary.unlink(missing_ok=True)


class RunLock:
    def __init__(self, path):
        self.path, self.handle = Path(path), None

    def __enter__(self):
        self.handle = self.path.open("a+b")
        if not self.path.stat().st_size:
            self.handle.write(b"0")
            self.handle.flush()
        self.handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.handle.close()
            raise BatchError("同一项目已有批跑器正在运行，请等它结束。") from error
        return self

    def __exit__(self, *unused):
        self.handle.close()


class BatchRunner:
    def __init__(self, package, *, comfy_url="http://127.0.0.1:8188", character_image=None,
                 ffmpeg=None, output_root=None, width=1216, height=672, seed=1,
                 retries=1, job_timeout=3600, poll_interval=2, missing_grace=12,
                 only=None, rerun=None, dry_run=False, concat=False, log=print, client=None,
                 finish=finish_video, tail_extractor=extract_tail, concatenator=concat_videos):
        self.root, self.manifest, self.template, self.template_sha = load_package(package)
        self.shots = self.manifest["shots"]
        self.log = log
        if width <= 0 or height <= 0 or width % 32 or height % 32:
            raise BatchError("宽高必须为 32 的正整数倍。")
        if retries < 0 or job_timeout <= 0 or poll_interval < 0 or missing_grace < 0:
            raise BatchError("重试和等待参数无效。")
        self.width, self.height, self.seed = width, height, seed
        self.retries, self.job_timeout = retries, job_timeout
        self.poll_interval, self.missing_grace = poll_interval, missing_grace
        self.dry_run, self.ffmpeg_option = dry_run, ffmpeg
        self.ffmpeg = None
        self.finish, self.tail_extractor = finish, tail_extractor
        self.concat_requested, self.concatenator = concat, concatenator
        self.client = client or ComfyClient(comfy_url)
        self.character = Path(character_image).expanduser().resolve() if character_image else (
            package_path(self.root, self.manifest["characterReference"]) if self.manifest.get("characterReference") else None)
        if self.character and not self.character.is_file():
            raise BatchError("角色参考图不存在。")
        if self.character is None and not dry_run:
            raise BatchError("项目没有角色图，请在窗口选择，或传入 --character-image 图片路径。")
        self.character_sha = file_hash(self.character) if self.character else "missing-character"
        self.output = Path(output_root).expanduser().resolve() if output_root else self.root / "outputs"
        self.work_root = self.output
        self.output.mkdir(parents=True, exist_ok=True)
        self.state_path = self.output / "run-state.json"
        self.state = {"version": 1, "projectId": self.manifest["projectId"], "shots": {}}
        self.uploads = {}
        self.only, self.rerun = self.resolve_selection(only), self.resolve_selection(rerun)

    def resolve_selection(self, selection):
        if selection is None:
            return None
        terms = set(selection.split(",") if isinstance(selection, str) else selection)
        result = set()
        for term in terms:
            term = str(term).strip()
            matches = [shot["id"] for shot in self.shots if term == shot["id"] or (term.isdigit() and int(term) == shot["order"])]
            if len(matches) != 1:
                raise BatchError(f"镜头选择不存在或不唯一：{term}")
            result.add(matches[0])
        return result

    def save(self):
        self.state["updatedAt"] = time.time()
        atomic_json(self.state_path, self.state)

    def state_file(self, relative):
        """All durable file references live inside the chosen output directory."""
        if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
            raise BatchError("恢复状态中的文件路径需要相对于 outputs 目录。")
        target = (self.output / relative).resolve()
        try:
            target.relative_to(self.output.resolve())
        except ValueError as error:
            raise BatchError("恢复状态中的文件路径超出 outputs 目录。") from error
        return target

    def migrate_paths(self):
        # Early development receipts used absolute paths. Rebase known fields to
        # this copy of outputs; never read a previous package's files by accident.
        changed = False
        for entry in self.state["shots"].values():
            for field, filename in (("audio_snapshot", "speech.wav"), ("payload", "payload.json"), ("output", None)):
                value = entry.get(field)
                if not isinstance(value, str) or not Path(value).is_absolute():
                    continue
                if field == "output":
                    entry[field] = Path(value).name
                elif entry.get("submission_id"):
                    entry[field] = f"work/{slug(entry['submission_id'])}/{filename}"
                else:
                    continue
                changed = True
        if changed:
            self.save()

    def fingerprint(self, shot, facts):
        identity = {"runner": RUNNER_VERSION, "kind": shot["kind"], "id": shot["id"], "order": shot["order"],
                    "referenceMode": shot["referenceMode"], "prompt": shot["prompt"],
                    "durationSeconds": facts["source_duration"], "audio": facts["audio_sha256"],
                    "character": self.character_sha, "template": self.template_sha,
                    "width": self.width, "height": self.height, "seed": self.seed}
        return hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()

    def upload(self, path):
        key = file_hash(path)
        if key not in self.uploads:
            self.uploads[key] = self.client.upload(path)
        return self.uploads[key]

    def previous_output(self, index):
        if index <= 0:
            return None
        previous = self.state["shots"].get(self.shots[index - 1]["id"], {})
        if not previous.get("output"):
            return None
        path = self.state_file(previous["output"])
        return path if previous.get("status") == "succeeded" and not previous.get("input_error") and path.is_file() and file_hash(path) == previous.get("output_sha256") else None

    def preflight(self):
        self.ffmpeg = find_ffmpeg(self.ffmpeg_option)
        run_ffmpeg(self.ffmpeg, ["-version"], timeout=20)
        info = self.client.get("/object_info")
        classes = set()
        active_graphs = []
        for shot in self.shots:
            if self.only is not None and shot["id"] not in self.only:
                continue
            # Preflight only the active graph; speech does not need audio decode.
            graph = build_graph(self.template, shot, {"generation_frames": 124}, "placeholder", tail="placeholder" if shot["referenceMode"] == "continuous" else None)
            active_graphs.append(graph)
            classes.update(node["class_type"] for node in graph.values())
        missing = sorted(classes - set(info))
        if missing:
            raise BatchError("ComfyUI 缺少节点：" + ", ".join(missing))
        for graph in active_graphs:
            for node in graph.values():
                schema = info[node["class_type"]].get("input")
                if schema is None:
                    continue
                names = set(schema.get("required", {})) | set(schema.get("optional", {}))
                unavailable = sorted({name.split(".", 1)[0] for name in node["inputs"]} - names)
                if unavailable:
                    raise BatchError(f"ComfyUI 节点 {node['class_type']} 缺少需要的输入：{', '.join(unavailable)}。请核对工作流对应版本。")

    def wait_job(self, entry):
        deadline = time.monotonic() + self.job_timeout
        missing_since = None
        while True:
            try:
                where, prompt_id, record = locate_job(self.client, entry)
                if prompt_id and prompt_id != entry.get("prompt_id"):
                    entry["prompt_id"] = prompt_id
                    self.save()
                if where == "history":
                    return history_result(record), record
                if where == "missing":
                    missing_since = missing_since or time.monotonic()
                    if time.monotonic() - missing_since >= self.missing_grace:
                        return "unknown", None
                else:
                    missing_since = None
                    if entry.get("status") != "running":
                        entry["status"] = "running"
                        self.save()
            except ApiError as error:
                entry["last_error"] = str(error)
            if time.monotonic() >= deadline:
                return "unknown", None
            time.sleep(self.poll_interval)

    def collect(self, shot, entry, record):
        locator = saved_video(record)
        extension = Path(locator["filename"]).suffix.lower()
        raw = self.work_root / "raw" / (entry["submission_id"] + extension)
        entry["remote_output"] = locator
        entry["status"] = "downloading"
        self.save()
        if not raw.is_file() or entry.get("raw_sha256") != file_hash(raw):
            self.client.download(locator, raw)
            entry["raw_sha256"] = file_hash(raw)
            self.save()
        output = self.output / f"{shot['order']:03d}_{entry['fingerprint'][:10]}.mp4"
        media_entry = dict(entry)
        if entry["kind"] == "speech":
            media_entry["audio_snapshot"] = str(self.state_file(entry["audio_snapshot"]))
        self.finish(self.ffmpeg, raw, output, media_entry)
        entry.update({"status": "succeeded", "output": output.relative_to(self.output).as_posix(), "output_sha256": file_hash(output)})
        entry.pop("last_error", None)
        self.save()
        self.log(f"{shot['id']}：完成 → {output.name}")

    def reconcile(self, shot, entry):
        self.log(f"{shot['id']}：恢复已有任务，查询 history/queue。")
        result, record = self.wait_job(entry)
        if result == "succeeded":
            try:
                self.collect(shot, entry, record)
            except (BatchError, OSError) as error:
                # A completed GPU task must never be regenerated to retry a download/encode.
                entry.update({"status": "downloading", "last_error": str(error)})
                self.save()
                self.log(f"{shot['id']}：视频已生成，下载/封装待恢复：{error}")
                return "downloading"
        else:
            entry["status"] = result
            self.save()
        return result

    def process(self, shot, index):
        shot_id = shot["id"]
        existing = self.state["shots"].get(shot_id)
        if existing and existing.get("status") in ("submitting", "running", "unknown", "downloading"):
            result = self.reconcile(shot, existing)
            if result in ("unknown", "downloading"):
                self.log(f"{shot_id}：任务状态未确认/尚待下载，不重复提交；继续下一镜。")
                return
        facts = shot_facts(self.root, shot)
        if existing and existing.pop("input_error", None) is not None:
            self.save()
        fingerprint = self.fingerprint(shot, facts)
        force = self.rerun is not None and shot_id in self.rerun
        if existing and existing.get("fingerprint") == fingerprint:
            if existing.get("status") == "succeeded" and not force:
                output = self.state_file(existing["output"]) if existing.get("output") else self.output / "__missing__"
                if output.is_file() and file_hash(output) == existing.get("output_sha256"):
                    self.log(f"{shot_id}：已有相同输入的成功结果，跳过。")
                    return
                # Recover the completed remote output instead of generating it again.
                if existing.get("prompt_id"):
                    self.reconcile(shot, existing)
                    return
            if existing.get("status") == "failed" and not force and existing.get("attempt_count", 0) >= self.retries + 1:
                self.log(f"{shot_id}：已用完技术重试；用 --rerun {shot_id} 明确重做。")
                return
        # Previous-tail identity is intentionally excluded: a changed shot never reruns descendants.
        entry = {"fingerprint": fingerprint, "status": "preparing", "kind": shot["kind"], "attempt_count": 0,
                 "audio_sha256": facts["audio_sha256"],
                 **{key: facts[key] for key in ("source_duration", "target_frames", "target_duration", "generation_frames")}}
        if existing and not force and existing.get("fingerprint") == fingerprint:
            entry["attempt_count"] = existing.get("attempt_count", 0)
        self.state["shots"][shot_id] = entry
        self.save()
        while entry["attempt_count"] < self.retries + 1:
            entry["attempt_count"] += 1
            entry["submission_id"] = uuid.uuid4().hex
            entry.pop("prompt_id", None)
            entry["status"] = "preparing"
            work = self.work_root / "work" / entry["submission_id"]
            work.mkdir(parents=True, exist_ok=True)
            try:
                character_snapshot = work / ("character" + self.character.suffix.lower())
                shutil.copyfile(self.character, character_snapshot)
                if file_hash(character_snapshot) != self.character_sha:
                    raise BatchError("角色图在批次启动后发生变化，请重新运行以使用新图。")
                character = self.upload(character_snapshot)
                audio = None
                if facts["audio_path"]:
                    snapshot = work / "speech.wav"
                    shutil.copyfile(facts["audio_path"], snapshot)
                    if file_hash(snapshot) != facts["audio_sha256"]:
                        raise BatchError("对白文件在准备过程中发生变化，请重新运行。")
                    entry["audio_snapshot"] = snapshot.relative_to(self.output).as_posix()
                    audio = self.upload(snapshot)
                tail = None
                if shot["referenceMode"] == "continuous":
                    previous = self.previous_output(index)
                    if previous:
                        try:
                            tail = self.upload(self.tail_extractor(self.ffmpeg, previous, work / "previous-tail.png"))
                        except BatchError as error:
                            self.log(f"{shot_id}：上一镜尾帧不可用，改为独立镜头：{error}")
                    else:
                        self.log(f"{shot_id}：相邻上一镜没有成功输出，改为独立镜头。")
                entry["effective_reference_mode"] = "continuous" if tail else "new"
                graph = build_graph(self.template, shot, facts, character, audio, tail, self.width, self.height, self.seed,
                                    f"asmr-batch/{slug(self.manifest['projectId'])}/{shot['order']:03d}_{entry['submission_id']}")
                payload_file = work / "payload.json"
                atomic_json(payload_file, {"prompt": graph, "client_id": entry["submission_id"], "extra_data": {"asmr_batch_submission_id": entry["submission_id"]}})
                entry["payload"] = payload_file.relative_to(self.output).as_posix()
                # This state must reach disk before POST /prompt, including when its response is lost.
                entry["status"] = "submitting"
                self.save()
                self.log(f"{shot_id}：提交（{entry['attempt_count']}/{self.retries + 1}），{facts['generation_frames']} 帧。")
                try:
                    entry["prompt_id"] = self.client.submit(graph, entry["submission_id"])
                    entry["status"] = "running"
                    self.save()
                except ApiError as error:
                    entry["last_error"] = str(error)
                    if error.status in (400, 401, 403, 404, 405, 413, 415, 422):
                        entry["status"] = "failed"
                        self.save()
                        self.log(f"{shot_id}：提交被明确拒绝：{error}")
                        continue
                    entry["status"] = "unknown"
                    self.save()
                result = self.reconcile(shot, entry)
                if result == "succeeded" or result in ("unknown", "downloading"):
                    return
                self.log(f"{shot_id}：远端明确失败，按剩余技术重试继续。")
            except (BatchError, OSError, ValueError) as error:
                # Preparations fail before submission; completed tasks retain their ID for recovery.
                if entry.get("status") in ("submitting", "running", "unknown", "downloading"):
                    entry["status"] = "unknown" if entry.get("status") != "downloading" else "downloading"
                    entry["last_error"] = str(error)
                    self.save()
                    self.log(f"{shot_id}：已有任务待恢复：{error}")
                    return
                entry.update({"status": "failed", "last_error": str(error)})
                self.save()
                self.log(f"{shot_id}：技术失败：{error}")

    def dry_payloads(self):
        directory = self.output / "dry-run"
        prepared = []
        for index, shot in enumerate(self.shots):
            if self.only is not None and shot["id"] not in self.only:
                continue
            facts = shot_facts(self.root, shot)
            tail = "__PREVIOUS_SUCCESSFUL_TAIL__.png" if index > 0 and shot["referenceMode"] == "continuous" else None
            graph = build_graph(self.template, shot, facts, "__CHARACTER_IMAGE__",
                                shot.get("audio"), tail, self.width, self.height, self.seed)
            target = directory / f"{shot['order']:03d}.json"
            atomic_json(target, {"prompt": graph, "_dry_run": {"shotId": shot["id"], "fingerprint": self.fingerprint(shot, facts),
                        "targetDurationSeconds": facts["target_duration"], "generationFrames": facts["generation_frames"],
                        "note": "占位上传名称；连续参考以实际运行时的相邻成功输出为准。"}})
            prepared.append(str(target))
            self.log(f"{shot['id']}：dry-run payload → {target}")
        return {"dry_run": prepared}

    def concat_preview(self):
        clips, identities = [], []
        try:
            for shot in self.shots:
                entry = self.state["shots"].get(shot["id"], {})
                expected = f"{shot['order']:03d}_{entry.get('fingerprint', '')[:10]}.mp4"
                if entry.get("status") != "succeeded" or entry.get("input_error") or entry.get("output") != expected:
                    raise BatchError(f"镜头 {shot['id']} 没有当前有效成功输出，不生成缺镜预览。")
                facts = shot_facts(self.root, shot)
                path = self.state_file(entry["output"])
                if entry.get("fingerprint") != self.fingerprint(shot, facts) or not path.is_file() or file_hash(path) != entry.get("output_sha256"):
                    raise BatchError(f"镜头 {shot['id']} 的来源或输出已变化，不生成过期预览。")
                duration = entry.get("target_duration")
                if type(duration) not in (int, float) or not math.isfinite(duration) or duration <= 0:
                    raise BatchError(f"镜头 {shot['id']} 的输出时长记录无效。")
                clips.append((path, duration))
                identities.append([shot["id"], entry["fingerprint"], entry["output_sha256"]])
        except (BatchError, OSError, ValueError) as error:
            self.state["preview"] = {"status": "unavailable", "last_error": str(error)}
            self.save()
            self.log(f"未生成顺序预览：{error} 已有 preview.mp4 保留。")
            return "unavailable"
        identity = hashlib.sha256(json.dumps(identities, ensure_ascii=False).encode("utf-8")).hexdigest()
        preview = self.output / "preview.mp4"
        previous = self.state.get("preview", {})
        if previous.get("status") == "succeeded" and previous.get("fingerprint") == identity and preview.is_file() and file_hash(preview) == previous.get("output_sha256"):
            self.log("已有相同镜头结果的完整顺序预览，跳过合片。")
            return "succeeded"
        try:
            self.concatenator(self.ffmpeg, clips, preview)
            self.state["preview"] = {"status": "succeeded", "fingerprint": identity, "output": "preview.mp4",
                                     "output_sha256": file_hash(preview), "shot_count": len(clips)}
            self.save()
            self.log(f"完整顺序预览：{preview}")
            return "succeeded"
        except (BatchError, OSError, ValueError) as error:
            self.state["preview"] = {"status": "failed", "last_error": str(error)}
            self.save()
            self.log(f"顺序合片失败，已有 preview.mp4 保留；不重新生成镜头：{error}")
            return "failed"

    def run(self):
        if self.dry_run:
            return self.dry_payloads()
        with RunLock(self.output / ".runner.lock"):
            if self.state_path.exists():
                try:
                    self.state = json.loads(self.state_path.read_text(encoding="utf-8"))
                    if self.state.get("version") != 1 or self.state.get("projectId") != self.manifest["projectId"] or not isinstance(self.state.get("shots"), dict):
                        raise ValueError("invalid state")
                except (ValueError, OSError) as error:
                    raise BatchError("run-state.json 损坏，未提交任何任务；请先保留并检查该文件。") from error
                self.migrate_paths()
            self.preflight()
            for index, shot in enumerate(self.shots):
                if self.only is not None and shot["id"] not in self.only:
                    continue
                try:
                    self.process(shot, index)
                except (BatchError, OSError, ValueError) as error:
                    # Missing source files must not erase a completed/accepted
                    # task receipt and accidentally authorize another POST later.
                    receipt = self.state["shots"].setdefault(shot["id"], {"status": "failed"})
                    receipt["input_error"] = str(error)
                    self.save()
                    self.log(f"{shot['id']}：失败，继续下一镜：{error}")
            summary = {name: sum(1 for shot in self.shots if self.state["shots"].get(shot["id"], {}).get("status") == name)
                       for name in ("succeeded", "failed", "unknown", "downloading")}
            summary["input_error"] = sum(1 for shot in self.shots if self.state["shots"].get(shot["id"], {}).get("input_error"))
            if self.concat_requested:
                summary["preview_failed"] = int(self.concat_preview() != "succeeded")
            self.log("批次结束：" + ", ".join(f"{name}={count}" for name, count in summary.items()))
            self.log(f"结果及恢复状态：{self.output}")
            return summary


def parser():
    result = argparse.ArgumentParser(description="ASMR ComfyUI 视频批跑器；不带参数时打开窗口。")
    result.add_argument("package", nargs="?", help="包含 project.json 的解压目录")
    result.add_argument("--character-image", help="替换项目角色图")
    result.add_argument("--comfy-url", default="http://127.0.0.1:8188")
    result.add_argument("--ffmpeg", help="ffmpeg.exe 路径，默认查找 PATH/已有 imageio_ffmpeg")
    result.add_argument("--output-root", type=Path, help="输出/状态/临时目录，默认项目内 outputs")
    result.add_argument("--width", type=int, default=1216)
    result.add_argument("--height", type=int, default=672)
    result.add_argument("--seed", type=int, default=1)
    result.add_argument("--retries", type=int, default=1, help="明确技术失败后的最大重试次数")
    result.add_argument("--job-timeout", type=float, default=3600, help="等待单个远端任务的秒数，超时保留unknown")
    result.add_argument("--only", help="只处理这些镜头，逗号分隔 ID/order")
    result.add_argument("--rerun", help="重做指定镜头；仍先核对未确认的远端任务")
    result.add_argument("--dry-run", action="store_true", help="只准备本地 payload，不联网或运行 FFmpeg/模型")
    result.add_argument("--concat", action="store_true", help="全镜均有效成功时按顺序生成 preview.mp4；不加工程等待")
    return result


def launch_gui():
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox, ttk
        window = tk.Tk()
    except Exception:
        print("当前 Python 没有可用 Tk 窗口。请使用：\npython runner.py \"项目目录\" --character-image \"角色图.png\" --comfy-url http://127.0.0.1:8188\n运行 python runner.py --help 查看选项。", file=sys.stderr)
        return 1
    window.title("ASMR 视频整批生成")
    window.geometry("790x560")
    window.minsize(650, 450)
    frame = ttk.Frame(window, padding=14)
    frame.pack(fill="both", expand=True)
    frame.columnconfigure(1, weight=1)
    fields = {"package": tk.StringVar(), "character_image": tk.StringVar(), "comfy_url": tk.StringVar(value="http://127.0.0.1:8188"), "ffmpeg": tk.StringVar()}
    dry = tk.BooleanVar(value=False)
    concat_flag = tk.BooleanVar(value=False)
    for row, (key, label) in enumerate((("package", "项目文件夹"), ("character_image", "角色图（可替换）"), ("comfy_url", "ComfyUI 地址"), ("ffmpeg", "FFmpeg（可留空）"))):
        ttk.Label(frame, text=label).grid(row=row, column=0, sticky="w", pady=5)
        ttk.Entry(frame, textvariable=fields[key]).grid(row=row, column=1, sticky="ew", padx=8)
        if key != "comfy_url":
            def browse(field=key):
                value = filedialog.askdirectory(title="选择解压后的项目文件夹") if field == "package" else filedialog.askopenfilename(title="选择角色图" if field == "character_image" else "选择 ffmpeg 可执行文件")
                if value:
                    fields[field].set(value)
            ttk.Button(frame, text="选择", command=browse).grid(row=row, column=2)
    ttk.Checkbutton(frame, text="只检查项目并准备 payload（不连接 ComfyUI）", variable=dry).grid(row=4, column=0, columnspan=3, sticky="w", pady=8)
    ttk.Checkbutton(frame, text="全部镜头成功后，生成一份按镜头顺序拼接的预览片", variable=concat_flag).grid(row=5, column=0, columnspan=3, sticky="w", pady=4)
    ttk.Label(frame, text="有对白保留原 WAV；环境镜头生成声音且最长 5 秒。任务逐镜继续，可关闭后再恢复。", wraplength=720).grid(row=6, column=0, columnspan=3, sticky="w")
    text_box = tk.Text(frame, height=17, wrap="word", state="disabled")
    text_box.grid(row=8, column=0, columnspan=3, sticky="nsew", pady=10)
    frame.rowconfigure(8, weight=1)
    events = queue.Queue()
    running = [False]

    def start():
        values = {key: value.get().strip() for key, value in fields.items()}
        if not values["package"]:
            messagebox.showerror("缺少项目", "请选择包含 project.json 的项目文件夹。")
            return
        values["character_image"] = values["character_image"] or None
        values["ffmpeg"] = values["ffmpeg"] or None
        values["dry_run"] = dry.get()
        values["concat"] = concat_flag.get()
        running[0] = True
        button.configure(state="disabled")

        def worker():
            try:
                BatchRunner(**values, log=lambda message: events.put(("log", message))).run()
            except Exception as error:
                events.put(("log", f"未完成：{error}"))
            finally:
                events.put(("done", None))
        threading.Thread(target=worker, daemon=True).start()

    button = ttk.Button(frame, text="开始 / 继续整批", command=start)
    button.grid(row=7, column=0, columnspan=3, pady=8)

    def tick():
        try:
            while True:
                event, value = events.get_nowait()
                if event == "done":
                    running[0] = False
                    button.configure(state="normal")
                else:
                    text_box.configure(state="normal")
                    text_box.insert("end", value + "\n")
                    text_box.see("end")
                    text_box.configure(state="disabled")
        except queue.Empty:
            pass
        window.after(100, tick)

    def close():
        if running[0] and not messagebox.askyesno("保存后退出", "退出不会取消已经提交给 ComfyUI 的任务。下次运行会先对账恢复。现在退出？"):
            return
        window.destroy()
    window.protocol("WM_DELETE_WINDOW", close)
    tick()
    window.mainloop()
    return 0


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        return launch_gui()
    args = vars(parser().parse_args(argv))
    if not args["package"]:
        parser().error("请指定项目文件夹，或不带参数打开窗口。")
    try:
        result = BatchRunner(**args).run()
        return 0 if "dry_run" in result or not any(result.get(key) for key in ("failed", "unknown", "downloading", "input_error", "preview_failed")) else 2
    except (BatchError, OSError, ValueError) as error:
        print(f"未完成：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
