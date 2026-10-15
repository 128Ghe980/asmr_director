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
STATE_VERSION = 2
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v"}
CONTINUITY = (
    "<Picture 2> is the final frame of the immediately previous clip and the "
    "opening-frame target for this clip. Begin directly from <Picture 2>. "
    "Preserve its framing, viewpoint, lighting, pose and prop positions; "
    "continue smoothly without a cut or pose reset."
)


class BatchError(Exception):
    pass


class RemotePreflightError(BatchError):
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
        items = remote_queue.get(group, [])
        for position, item in enumerate(items, 1):
            if not isinstance(item, list) or len(item) < 4:
                continue
            extra = item[3] if isinstance(item[3], dict) else {}
            submission = extra.get("asmr_batch_submission_id") or extra.get("client_id")
            if (prompt_id and item[1] == prompt_id) or (not prompt_id and submission == entry["submission_id"]):
                return ("running" if group == "queue_running" else "queued"), item[1], {
                    "queue_position": position, "queue_length": len(items)}
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
                 retries=1, job_timeout=0, poll_interval=2, missing_grace=12,
                 candidates=1, rerun_candidates=None, request_timeout=30,
                 disconnect_timeout=300, heartbeat_interval=15, status_callback=None, stop_event=None,
                 only=None, rerun=None, dry_run=False, concat=False, log=print, client=None,
                 finish=finish_video, tail_extractor=extract_tail, concatenator=concat_videos):
        self.root, self.manifest, self.template, self.template_sha = load_package(package)
        self.shots = self.manifest["shots"]
        self.log = log
        if width <= 0 or height <= 0 or width % 32 or height % 32:
            raise BatchError("宽高必须为 32 的正整数倍。")
        if (not isinstance(candidates, int) or isinstance(candidates, bool) or candidates < 1):
            raise BatchError("每镜候选数必须是正整数。")
        if (retries < 0 or not all(math.isfinite(value) for value in
                (job_timeout, poll_interval, missing_grace, request_timeout, disconnect_timeout, heartbeat_interval))
                or min(job_timeout, poll_interval, missing_grace) < 0
                or min(request_timeout, disconnect_timeout, heartbeat_interval) <= 0):
            raise BatchError("重试和等待参数无效。")
        self.candidates = candidates
        self.status_callback = status_callback
        self.stop_event = stop_event if stop_event is not None else threading.Event()
        self.disconnect_timeout, self.heartbeat_interval = disconnect_timeout, heartbeat_interval
        self.total_tasks, self.completed_tasks, self.current_task_label = 0, 0, ""
        self.seed_reservations = {}
        self.remote_preflight_done = False
        self.width, self.height, self.seed = width, height, seed
        self.retries, self.job_timeout = retries, job_timeout
        self.poll_interval, self.missing_grace = poll_interval, missing_grace
        self.dry_run, self.ffmpeg_option = dry_run, ffmpeg
        self.ffmpeg = None
        self.finish, self.tail_extractor = finish, tail_extractor
        self.concat_requested, self.concatenator = concat, concatenator
        self.client = client or ComfyClient(comfy_url, timeout=request_timeout)
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
        self.state = {"version": STATE_VERSION, "projectId": self.manifest["projectId"], "shots": {}}
        self.uploads = {}
        self.only, self.rerun = self.resolve_selection(only), self.resolve_selection(rerun)
        self.rerun_candidates = self.resolve_candidates(rerun_candidates)

    def resolve_candidates(self, selection):
        result = set()
        if selection is None:
            return result
        terms = selection.split(",") if isinstance(selection, str) else selection
        for term in terms:
            try:
                shot, number = str(term).strip().rsplit(":", 1)
                candidate = int(number)
            except (ValueError, TypeError) as error:
                raise BatchError("候选选择格式为 镜头:候选，例如 2:1,4:3。") from error
            if candidate < 1 or candidate > self.candidates:
                raise BatchError("重做候选编号须在本次每镜候选数范围内。")
            shot_id = next(iter(self.resolve_selection(shot)))
            if self.only is not None and shot_id not in self.only:
                raise BatchError("重做候选不在本次只做镜头范围内。")
            result.add((shot_id, candidate))
        return result

    def candidate_entry(self, shot_id, candidate=1):
        return self.state["shots"].get(shot_id, {}).get("candidates", {}).get(str(candidate))

    def store_entry(self, shot_id, candidate, entry):
        self.state["shots"].setdefault(shot_id, {"candidates": {}})["candidates"][str(candidate)] = entry

    def all_entries(self):
        for shot in self.state["shots"].values():
            for entry in shot.get("candidates", {}).values():
                yield entry
                yield from entry.get("history", [])

    def load_state(self):
        if not self.state_path.exists():
            return
        try:
            saved = json.loads(self.state_path.read_text(encoding="utf-8"))
            if (saved.get("version") not in (1, STATE_VERSION)
                    or saved.get("projectId") != self.manifest["projectId"]
                    or not isinstance(saved.get("shots"), dict)):
                raise ValueError("invalid state")
            if saved["version"] == 1:
                backup = self.output / ("run-state.v1-backup-" + file_hash(self.state_path)[:12] + ".json")
                if not backup.exists():
                    atomic_json(backup, saved)
                for shot_id, entry in list(saved["shots"].items()):
                    if not isinstance(entry, dict):
                        raise ValueError("invalid old receipt")
                    entry.update({"shot_id": shot_id, "candidate_index": 1, "generation": 0, "legacy_output": True})
                    saved["shots"][shot_id] = {"candidates": {"1": entry}}
                saved["version"] = STATE_VERSION
                if isinstance(saved.get("preview"), dict):
                    saved["previews"] = {"1": copy.deepcopy(saved["preview"])}
            for shot_id, shot in saved["shots"].items():
                if not isinstance(shot, dict) or not isinstance(shot.get("candidates"), dict):
                    raise ValueError("invalid candidate map")
                for number, entry in shot["candidates"].items():
                    if (not isinstance(number, str) or not number.isdigit() or str(int(number)) != number
                            or int(number) < 1 or not isinstance(entry, dict)
                            or type(entry.get("generation", 0)) is not int or entry.get("generation", 0) < 0
                            or not isinstance(entry.get("history", []), list)):
                        raise ValueError("invalid candidate receipt")
                    entry["shot_id"], entry["candidate_index"] = shot_id, int(number)
            self.state = saved
            self.migrate_paths()
            self.save()
        except (ValueError, OSError, TypeError, AttributeError) as error:
            raise BatchError("run-state.json 损坏，未提交任何任务；请先保留并检查该文件。") from error

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
        for entry in self.all_entries():
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

    def fingerprint(self, shot, facts, candidate=1, generation=0):
        identity = {"runner": RUNNER_VERSION, "kind": shot["kind"], "id": shot["id"], "order": shot["order"],
                    "referenceMode": shot["referenceMode"], "prompt": shot["prompt"],
                    "durationSeconds": facts["source_duration"], "audio": facts["audio_sha256"],
                    "character": self.character_sha, "template": self.template_sha,
                    "width": self.width, "height": self.height, "seed": self.seed}
        # Preserve the exact v1 identity for candidate 1, generation 0.
        # Candidate count is deliberately absent: increasing N only adds slots.
        if candidate != 1 or generation != 0:
            identity.update({"candidate": candidate, "generation": generation,
                             "actual_seed": self.seed_for(shot, candidate, generation)})
        return hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()

    def seed_for(self, shot, candidate=1, generation=0):
        identity = (self.manifest["projectId"], shot["id"], candidate, generation, self.seed)
        if identity in self.seed_reservations:
            return self.seed_reservations[identity]
        existing = self.candidate_entry(shot["id"], candidate)
        receipts = ([existing] + list(reversed(existing.get("history", [])))) if existing else []
        for receipt in receipts:
            if (receipt.get("generation", 0) == generation and receipt.get("base_seed") == self.seed
                    and type(receipt.get("seed")) is int and 0 <= receipt["seed"] < 2 ** 64):
                self.seed_reservations[identity] = receipt["seed"]
                return receipt["seed"]
        used = set(self.seed_reservations.values())
        for entry in self.all_entries():
            same = (entry.get("shot_id") == shot["id"] and entry.get("candidate_index", 1) == candidate
                    and entry.get("generation", 0) == generation and entry.get("base_seed", self.seed) == self.seed)
            if not same and type(entry.get("seed")) is int:
                used.add(entry["seed"])
        value = (self.seed + shot["order"]) % (2 ** 64) if candidate == 1 and generation == 0 else None
        if value is None or value in used:
            salt = 0
            while True:
                value = int(hashlib.sha256(json.dumps([*identity, salt], ensure_ascii=False).encode("utf-8")).hexdigest()[:16], 16)
                if value not in used:
                    break
                salt += 1
        self.seed_reservations[identity] = value
        return value

    def output_name(self, shot, entry):
        prefix = f"{shot['order']:03d}"
        if not entry.get("legacy_output"):
            prefix += f"_c{entry.get('candidate_index', 1):03d}"
        name = f"{prefix}_{entry['fingerprint'][:10]}"
        suffix = entry.get("output_suffix")
        if suffix is not None:
            if not isinstance(suffix, str) or not re.fullmatch(r"[0-9a-f]{32}", suffix):
                raise BatchError("视频输出身份无效，保留已有文件等待检查。")
            name += "_" + suffix
        return name + ".mp4"

    def restore_history(self, shot, candidate, existing, fingerprint):
        if not existing:
            return False
        history = existing.get("history", [])
        for index in range(len(history) - 1, -1, -1):
            receipt = history[index]
            if receipt.get("fingerprint") != fingerprint or receipt.get("status") != "succeeded" or not receipt.get("output"):
                continue
            output = self.state_file(receipt["output"])
            if not output.is_file() or file_hash(output) != receipt.get("output_sha256"):
                continue
            restored = copy.deepcopy(receipt)
            restored.pop("input_error", None)
            restored["history"] = copy.deepcopy(history[:index] + history[index + 1:])
            restored["history"].append({key: copy.deepcopy(value) for key, value in existing.items() if key != "history"})
            self.store_entry(shot["id"], candidate, restored)
            self.save()
            self.log(f"{shot['id']} / 候选 {candidate}：恢复相同输入的历史成功结果，跳过生成。")
            return True
        return False

    def upload(self, path):
        key = file_hash(path)
        if key not in self.uploads:
            self.uploads[key] = self.client.upload(path)
        return self.uploads[key]

    def previous_output(self, index, candidate=1):
        if index <= 0:
            return None
        previous = self.candidate_entry(self.shots[index - 1]["id"], candidate) or {}
        if not previous.get("output"):
            return None
        path = self.state_file(previous["output"])
        return path if previous.get("status") == "succeeded" and not previous.get("input_error") and path.is_file() and file_hash(path) == previous.get("output_sha256") else None

    def preflight(self, remote=True):
        if self.ffmpeg is None:
            self.ffmpeg = find_ffmpeg(self.ffmpeg_option)
            run_ffmpeg(self.ffmpeg, ["-version"], timeout=20)
        if not remote or self.remote_preflight_done:
            return
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
            raise RemotePreflightError("ComfyUI 缺少节点：" + ", ".join(missing))
        for graph in active_graphs:
            for node in graph.values():
                schema = info[node["class_type"]].get("input")
                if schema is None:
                    continue
                names = set(schema.get("required", {})) | set(schema.get("optional", {}))
                unavailable = sorted({name.split(".", 1)[0] for name in node["inputs"]} - names)
                if unavailable:
                    raise RemotePreflightError(f"ComfyUI 节点 {node['class_type']} 缺少需要的输入：{', '.join(unavailable)}。请核对工作流对应版本。")
        self.remote_preflight_done = True

    def progress(self, entry=None, phase=None, **details):
        """Publish optional UI status without making a callback part of job safety."""
        entry = entry or {}
        task_key = (entry.get("shot_id"), entry.get("candidate_index"), entry.get("submission_id"))
        now = time.monotonic()
        if task_key != getattr(self, "_progress_task_key", None):
            self._progress_task_key, self._progress_started = task_key, now
        event = {"phase": phase or entry.get("status", "idle"),
                 "shot_id": entry.get("shot_id"), "candidate_index": entry.get("candidate_index", 1),
                 "candidate_total": getattr(self, "candidates", 1),
                 "completed": getattr(self, "completed_tasks", 0), "total": getattr(self, "total_tasks", 0),
                 "elapsed_seconds": round(now - getattr(self, "_progress_started", now), 1),
                 "task_label": getattr(self, "current_task_label", ""),
                 "prompt_id": entry.get("prompt_id"), "seed": entry.get("seed"), **details}
        callback = getattr(self, "status_callback", None)
        if callback:
            try:
                callback(event)
            except Exception as error:
                if not getattr(self, "_status_callback_error_reported", False):
                    self._status_callback_error_reported = True
                    self.log(f"状态显示回调失败，任务继续：{type(error).__name__}")
        return event

    def wait_job(self, entry):
        started = time.monotonic()
        deadline = started + self.job_timeout if self.job_timeout > 0 else None
        missing_since = disconnected_since = None
        last_report, last_phase = None, None
        stop_event = getattr(self, "stop_event", None)
        heartbeat = getattr(self, "heartbeat_interval", 15)
        disconnect_timeout = getattr(self, "disconnect_timeout", 300)
        label = getattr(self, "current_task_label", "") or entry.get("shot_id") or "当前镜头"

        def stopped():
            return stop_event is not None and stop_event.is_set()

        def report(phase, now, **details):
            nonlocal last_report, last_phase
            if phase != last_phase or last_report is None or now - last_report >= heartbeat:
                elapsed = int(now - started)
                text = {"queued": "排队中", "running": "ComfyUI 正在执行", "checking": "暂未查到任务，继续对账",
                        "disconnected": "连接中断，保留任务身份并重连"}[phase]
                position = details.get("queue_position")
                if phase == "queued" and position is not None:
                    text += f"（等待队列第 {position} 个）"
                self.log(f"{label}：{text}，已等待 {elapsed} 秒。")
                self.progress(entry, phase, wait_seconds=round(now - started, 1), **details)
                last_report, last_phase = now, phase

        while True:
            if stopped():
                self.progress(entry, "paused", resume_phase=entry.get("status"))
                return "paused", None
            try:
                where, prompt_id, record = locate_job(self.client, entry)
                now = time.monotonic()
                disconnected_since = None
                changed = False
                if prompt_id and prompt_id != entry.get("prompt_id"):
                    entry["prompt_id"] = prompt_id
                    changed = True
                if changed:
                    self.save()
                if stopped():
                    self.progress(entry, "paused", resume_phase=entry.get("status"))
                    return "paused", None
                if where == "history":
                    result = history_result(record)
                    self.progress(entry, result)
                    return result, record
                if where == "missing":
                    if missing_since is None:
                        missing_since = now
                    report("checking", now)
                    if stopped():
                        self.progress(entry, "paused", resume_phase=entry.get("status"))
                        return "paused", None
                    if now - missing_since >= self.missing_grace:
                        entry["last_error"] = "ComfyUI history/queue 中暂无法确认该任务；保留身份，不重复提交。"
                        self.progress(entry, "unknown", reason="missing_record")
                        return "unknown", None
                else:
                    missing_since = None
                    phase = "queued" if where == "queued" else "running"
                    changed = entry.get("status") != phase or "last_error" in entry
                    entry["status"] = phase
                    entry.pop("last_error", None)
                    if changed:
                        self.save()
                    details = record if isinstance(record, dict) else {}
                    report(phase, now, **details)
            except ApiError as error:
                now = time.monotonic()
                missing_since = None
                first_error = disconnected_since is None
                if first_error:
                    disconnected_since = now
                if first_error or entry.get("last_error") != str(error):
                    entry["last_error"] = str(error)
                    self.save()
                if stopped():
                    self.progress(entry, "paused", resume_phase=entry.get("status"))
                    return "paused", None
                report("disconnected", now, last_error=str(error),
                       disconnected_seconds=round(now - disconnected_since, 1))
                if stopped():
                    self.progress(entry, "paused", resume_phase=entry.get("status"))
                    return "paused", None
                if now - disconnected_since >= disconnect_timeout:
                    self.log(f"{label}：连接中断超过 {disconnect_timeout:g} 秒，标记 unknown；不重复提交。")
                    self.progress(entry, "unknown", reason="disconnect_timeout", last_error=str(error))
                    return "unknown", None
            if stopped():
                self.progress(entry, "paused", resume_phase=entry.get("status"))
                return "paused", None
            if deadline is not None and time.monotonic() >= deadline:
                entry["last_error"] = f"超过指定任务等待上限 {self.job_timeout:g} 秒；远端任务未被取消。"
                self.log(f"{label}：{entry['last_error']}")
                self.progress(entry, "unknown", reason="job_timeout")
                return "unknown", None
            if stop_event is not None:
                stop_event.wait(self.poll_interval)
            else:
                time.sleep(self.poll_interval)

    def collect(self, shot, entry, record=None):
        locator = saved_video(record) if record is not None else entry.get("remote_output")
        if not isinstance(locator, dict) or not isinstance(locator.get("filename"), str):
            raise BatchError("没有已确认成功的视频下载位置，保留任务身份等待恢复。")
        extension = Path(locator["filename"]).suffix.lower()
        if extension not in VIDEO_EXTENSIONS:
            raise BatchError("已保存的视频输出扩展名无效。")
        submission_id = entry.get("submission_id")
        if not isinstance(submission_id, str) or not submission_id:
            raise BatchError("恢复状态缺少有效的提交身份，停止下载/封装。")
        raw = self.state_file("raw/" + submission_id + extension)
        entry["remote_output"] = locator
        entry["status"] = "downloading"
        self.save()
        stop_event = getattr(self, "stop_event", None)
        if stop_event is not None and stop_event.is_set():
            self.progress(entry, "paused", resume_phase="downloading")
            return "paused"
        if not raw.is_file() or entry.get("raw_sha256") != file_hash(raw):
            self.log(f"{shot['id']}：下载已生成视频。")
            self.progress(entry, "downloading")
            self.client.download(locator, raw)
            entry["raw_sha256"] = file_hash(raw)
            self.save()
        else:
            self.log(f"{shot['id']}：完整原始视频已在本地，直接继续封装。")
        if stop_event is not None and stop_event.is_set():
            self.progress(entry, "paused", resume_phase="downloading")
            return "paused"
        output = self.output / self.output_name(shot, entry)
        if output.exists() and (not entry.get("output") or file_hash(output) != entry.get("output_sha256")):
            # A new result must not replace a retained file, including an
            # externally changed historical result that cannot be reused.
            entry["output_suffix"] = uuid.uuid4().hex
            self.save()
            output = self.output / self.output_name(shot, entry)
        media_entry = dict(entry)
        if entry["kind"] == "speech":
            media_entry["audio_snapshot"] = str(self.state_file(entry["audio_snapshot"]))
        self.log(f"{shot['id']}：封装最终音画。")
        self.progress(entry, "encoding")
        self.finish(self.ffmpeg, raw, output, media_entry)
        entry.update({"status": "succeeded", "output": output.relative_to(self.output).as_posix(), "output_sha256": file_hash(output)})
        entry.pop("last_error", None)
        self.save()
        self.log(f"{shot['id']}：完成 → {output.name}")
        self.progress(entry, "succeeded", output=entry["output"])
        return "succeeded"

    def reconcile(self, shot, entry):
        stop_event = getattr(self, "stop_event", None)
        if stop_event is not None and stop_event.is_set():
            self.progress(entry, "paused", resume_phase=entry.get("status"))
            return "paused"
        if entry.get("remote_output"):
            # This locator is saved only after confirmed GPU success. Neither a
            # surviving raw file nor a retryable download needs remote history.
            self.log(f"{shot['id']}：恢复已确认成功的视频，继续下载/封装。")
            result, record = "succeeded", None
        else:
            self.log(f"{shot['id']}：恢复已有任务，查询 history/queue。")
            result, record = self.wait_job(entry)
        if result == "paused":
            return "paused"
        if result == "succeeded":
            try:
                if self.collect(shot, entry, record) == "paused":
                    return "paused"
            except (BatchError, OSError) as error:
                # A completed GPU task must never be regenerated to retry a download/encode.
                entry.update({"status": "downloading", "last_error": str(error)})
                self.save()
                self.log(f"{shot['id']}：视频已生成，下载/封装待恢复：{error}")
                self.progress(entry, "downloading", last_error=str(error))
                return "downloading"
        else:
            entry["status"] = result
            self.save()
        return result

    def process(self, shot, index, candidate=1):
        shot_id = shot["id"]
        label = f"{shot_id} / 候选 {candidate}"
        existing = self.candidate_entry(shot_id, candidate)
        recovered = False
        if existing and existing.get("status") in ("submitting", "running", "queued", "unknown", "downloading"):
            result = self.reconcile(shot, existing)
            if result in ("unknown", "downloading", "paused"):
                self.log(f"{label}：保留已有任务身份，稍后恢复，不重复提交。")
                return
            recovered = result == "succeeded"
        if self.stop_event.is_set():
            return
        facts = shot_facts(self.root, shot)
        if existing and existing.pop("input_error", None) is not None:
            self.save()
        force = (self.rerun is not None and shot_id in self.rerun) or (shot_id, candidate) in self.rerun_candidates
        if recovered and force:
            self.log(f"{label}：已恢复原任务，本次不追加同输入重做；需要换种子可再次明确重做。")
            force = False
        generation = existing.get("generation", 0) if existing else 0
        if force:
            generation = max([generation, *[old.get("generation", 0) for old in existing.get("history", [])]] if existing else [0]) + 1
        fingerprint = self.fingerprint(shot, facts, candidate, generation)
        if existing and existing.get("fingerprint") == fingerprint:
            if existing.get("status") == "succeeded" and not force:
                output = self.state_file(existing["output"]) if existing.get("output") else self.output / "__missing__"
                if output.is_file() and file_hash(output) == existing.get("output_sha256"):
                    self.log(f"{label}：已有相同输入的成功结果，跳过。")
                    return
                # Recover the completed remote output instead of generating it again.
                if existing.get("prompt_id"):
                    self.reconcile(shot, existing)
                    return
        if not force and self.restore_history(shot, candidate, existing, fingerprint):
            return
        if (existing and existing.get("fingerprint") == fingerprint and existing.get("status") == "failed"
                and not force and existing.get("attempt_count", 0) >= self.retries + 1):
            self.log(f"{label}：已用完技术重试；可用 --rerun-candidates '{shot['order']}:{candidate}' 明确重做。")
            return
        self.progress(existing, phase="connecting", shot_id=shot_id, candidate_index=candidate)
        if self.stop_event.is_set():
            return
        self.preflight()
        if self.stop_event.is_set():
            return
        # Previous-tail identity is intentionally excluded: a changed shot never reruns descendants.
        entry = {"fingerprint": fingerprint, "status": "preparing", "kind": shot["kind"], "attempt_count": 0,
                 "shot_id": shot_id, "candidate_index": candidate, "generation": generation,
                 "base_seed": self.seed, "seed": self.seed_for(shot, candidate, generation),
                 "audio_sha256": facts["audio_sha256"],
                 **{key: facts[key] for key in ("source_duration", "target_frames", "target_duration", "generation_frames")}}
        if existing and not force and existing.get("fingerprint") == fingerprint:
            entry["attempt_count"] = existing.get("attempt_count", 0)
        if existing:
            entry["history"] = copy.deepcopy(existing.get("history", []))
            entry["history"].append({key: copy.deepcopy(value) for key, value in existing.items() if key != "history"})
        self.store_entry(shot_id, candidate, entry)
        self.save()
        while entry["attempt_count"] < self.retries + 1:
            if self.stop_event.is_set():
                return
            entry["attempt_count"] += 1
            entry["submission_id"] = uuid.uuid4().hex
            entry.pop("prompt_id", None)
            entry["status"] = "preparing"
            work = self.work_root / "work" / entry["submission_id"]
            work.mkdir(parents=True, exist_ok=True)
            try:
                self.progress(entry, phase="preparing")
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
                    previous = self.previous_output(index, candidate)
                    if previous:
                        try:
                            tail = self.upload(self.tail_extractor(self.ffmpeg, previous, work / "previous-tail.png"))
                        except BatchError as error:
                            self.log(f"{label}：上一镜同编号尾帧不可用，改为独立镜头：{error}")
                    else:
                        self.log(f"{label}：相邻上一镜同编号没有成功输出，改为独立镜头。")
                entry["effective_reference_mode"] = "continuous" if tail else "new"
                graph = build_graph(self.template, shot, facts, character, audio, tail, self.width, self.height, self.seed,
                                    f"asmr-batch/{slug(self.manifest['projectId'])}/{shot['order']:03d}_{entry['submission_id']}")
                graph["10"]["inputs"]["noise_seed"] = entry["seed"]
                payload_file = work / "payload.json"
                atomic_json(payload_file, {"prompt": graph, "client_id": entry["submission_id"], "extra_data": {"asmr_batch_submission_id": entry["submission_id"]}})
                entry["payload"] = payload_file.relative_to(self.output).as_posix()
                if self.stop_event.is_set():
                    entry["attempt_count"] -= 1
                    self.save()
                    return
                # This state must reach disk before POST /prompt, including when its response is lost.
                entry["status"] = "submitting"
                self.save()
                self.progress(entry, phase="submitting")
                if self.stop_event.is_set():
                    entry["status"] = "preparing"
                    entry["attempt_count"] -= 1
                    self.save()
                    return
                self.log(f"{label}：提交（{entry['attempt_count']}/{self.retries + 1}），{facts['generation_frames']} 帧，seed={entry['seed']}。")
                try:
                    entry["prompt_id"] = self.client.submit(graph, entry["submission_id"])
                    entry["status"] = "running"
                    self.save()
                except ApiError as error:
                    entry["last_error"] = str(error)
                    if error.status in (400, 401, 403, 404, 405, 413, 415, 422):
                        entry["status"] = "failed"
                        self.save()
                        self.log(f"{label}：提交被明确拒绝：{error}")
                        continue
                    entry["status"] = "unknown"
                    self.save()
                result = self.reconcile(shot, entry)
                if result in ("succeeded", "unknown", "downloading", "paused"):
                    return
                self.log(f"{label}：远端明确失败，按剩余技术重试继续。")
            except (BatchError, OSError, ValueError) as error:
                # Preparations fail before submission; completed tasks retain their ID for recovery.
                if self.stop_event.is_set() and entry.get("status") == "preparing":
                    entry["attempt_count"] = max(0, entry["attempt_count"] - 1)
                    entry["last_error"] = str(error)
                    self.save()
                    return
                if entry.get("status") in ("submitting", "running", "queued", "unknown", "downloading"):
                    entry["status"] = "unknown" if entry.get("status") != "downloading" else "downloading"
                    entry["last_error"] = str(error)
                    self.save()
                    self.log(f"{label}：已有任务待恢复：{error}")
                    return
                entry.update({"status": "failed", "last_error": str(error)})
                self.save()
                self.log(f"{label}：技术失败：{error}")

    def dry_payloads(self):
        directory = self.output / "dry-run"
        prepared = []
        for index, shot in enumerate(self.shots):
            if self.only is not None and shot["id"] not in self.only:
                continue
            facts = shot_facts(self.root, shot)
            for candidate in range(1, self.candidates + 1):
                tail = (f"__PREVIOUS_SUCCESSFUL_TAIL_C{candidate:03d}__.png"
                        if index > 0 and shot["referenceMode"] == "continuous" else None)
                graph = build_graph(self.template, shot, facts, "__CHARACTER_IMAGE__",
                                    shot.get("audio"), tail, self.width, self.height, self.seed)
                actual_seed = self.seed_for(shot, candidate)
                graph["10"]["inputs"]["noise_seed"] = actual_seed
                name = f"{shot['order']:03d}" + (f"_c{candidate:03d}" if self.candidates > 1 else "")
                target = directory / (name + ".json")
                atomic_json(target, {"prompt": graph, "_dry_run": {
                    "shotId": shot["id"], "candidateIndex": candidate, "seed": actual_seed,
                    "fingerprint": self.fingerprint(shot, facts, candidate),
                    "targetDurationSeconds": facts["target_duration"], "generationFrames": facts["generation_frames"],
                    "note": "占位上传名称；连续参考取相邻上一镜同编号候选的实际成功输出。"}})
                prepared.append(str(target))
                self.log(f"{shot['id']} / 候选 {candidate}：dry-run payload → {target}")
        return {"dry_run": prepared}

    def set_preview(self, candidate, receipt):
        self.state.setdefault("previews", {})[str(candidate)] = receipt
        if candidate == 1:
            self.state["preview"] = receipt
        self.save()

    def concat_preview(self, candidate=1):
        clips, identities = [], []
        name = "preview.mp4" if self.candidates == 1 else f"preview-c{candidate:03d}.mp4"
        preview = self.output / name
        try:
            for shot in self.shots:
                entry = self.candidate_entry(shot["id"], candidate) or {}
                if (entry.get("status") != "succeeded" or entry.get("input_error")
                        or entry.get("output") != self.output_name(shot, entry)):
                    raise BatchError(f"镜头 {shot['id']} 候选 {candidate} 没有当前有效成功输出，不生成缺镜预览。")
                facts = shot_facts(self.root, shot)
                path = self.state_file(entry["output"])
                if (entry.get("fingerprint") != self.fingerprint(shot, facts, candidate, entry.get("generation", 0))
                        or not path.is_file() or file_hash(path) != entry.get("output_sha256")):
                    raise BatchError(f"镜头 {shot['id']} 候选 {candidate} 的来源或输出已变化，不生成过期预览。")
                duration = entry.get("target_duration")
                if type(duration) not in (int, float) or not math.isfinite(duration) or duration <= 0:
                    raise BatchError(f"镜头 {shot['id']} 的输出时长记录无效。")
                clips.append((path, duration))
                identities.append([shot["id"], entry["fingerprint"], entry["output_sha256"]])
        except (BatchError, OSError, ValueError) as error:
            self.set_preview(candidate, {"status": "unavailable", "last_error": str(error)})
            self.log(f"未生成候选 {candidate} 的顺序预览：{error} 已有 {name} 保留。")
            return "unavailable"
        identity = hashlib.sha256(json.dumps(identities, ensure_ascii=False).encode("utf-8")).hexdigest()
        previous = self.state.get("previews", {}).get(str(candidate), {})
        if (previous.get("status") == "succeeded" and previous.get("fingerprint") == identity
                and previous.get("output") == name and preview.is_file()
                and file_hash(preview) == previous.get("output_sha256")):
            self.log(f"候选 {candidate} 已有相同镜头结果的完整顺序预览，跳过合片。")
            return "succeeded"
        try:
            self.current_task_label = f"候选 {candidate} 顺序预览"
            self.progress(phase="preview", candidate_index=candidate)
            self.concatenator(self.ffmpeg, clips, preview)
            self.set_preview(candidate, {"status": "succeeded", "fingerprint": identity, "output": name,
                                        "output_sha256": file_hash(preview), "shot_count": len(clips)})
            self.log(f"完整顺序预览：{preview}")
            return "succeeded"
        except (BatchError, OSError, ValueError) as error:
            self.set_preview(candidate, {"status": "failed", "last_error": str(error)})
            self.log(f"顺序合片失败，已有 {name} 保留；不重新生成镜头：{error}")
            return "failed"

    def run(self):
        if self.dry_run:
            return self.dry_payloads()
        with RunLock(self.output / ".runner.lock"):
            self.load_state()
            selected = [(index, shot) for index, shot in enumerate(self.shots)
                        if self.only is None or shot["id"] in self.only]
            self.total_tasks, self.completed_tasks = len(selected) * self.candidates, 0
            self.progress(phase="checking")
            self.preflight(remote=False)
            for index, shot in selected:
                if self.stop_event.is_set():
                    break
                for candidate in range(1, self.candidates + 1):
                    if self.stop_event.is_set():
                        break
                    self.current_task_label = f"镜头 {shot['order']} / 候选 {candidate}/{self.candidates}"
                    try:
                        self.process(shot, index, candidate)
                    except RemotePreflightError:
                        raise
                    except (BatchError, OSError, ValueError) as error:
                        # Keep completed and accepted receipts intact when inputs disappear.
                        receipt = self.candidate_entry(shot["id"], candidate)
                        if receipt is None:
                            receipt = {"status": "failed", "shot_id": shot["id"],
                                       "candidate_index": candidate, "generation": 0}
                            self.store_entry(shot["id"], candidate, receipt)
                        receipt["input_error"] = str(error)
                        self.save()
                        self.log(f"{shot['id']} / 候选 {candidate}：失败，继续后续候选：{error}")
                    receipt = self.candidate_entry(shot["id"], candidate) or {}
                    if receipt.get("status") == "succeeded" and not receipt.get("input_error"):
                        self.completed_tasks += 1
                    self.progress(receipt, phase=receipt.get("status", "pending"))
            receipts = [self.candidate_entry(shot["id"], candidate) or {} for _, shot in selected
                        for candidate in range(1, self.candidates + 1)]
            summary = {name: sum(entry.get("status") == name for entry in receipts)
                       for name in ("succeeded", "failed", "unknown", "downloading", "running", "queued", "preparing")}
            summary["input_error"] = sum(bool(entry.get("input_error")) for entry in receipts)
            summary["total"] = self.total_tasks
            summary["stopped"] = self.stop_event.is_set()
            if self.concat_requested and not self.stop_event.is_set():
                summary["preview_failed"] = 0
                for candidate in range(1, self.candidates + 1):
                    if self.stop_event.is_set():
                        break
                    summary["preview_failed"] += int(self.concat_preview(candidate) != "succeeded")
            summary["stopped"] = self.stop_event.is_set()
            self.progress(phase="stopped" if summary["stopped"] else "finished")
            self.log(("批次已停止：" if summary["stopped"] else "批次结束：") + ", ".join(f"{name}={count}" for name, count in summary.items()))
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
    result.add_argument("--candidates", type=positive_integer, default=1, help="每镜候选数 N；默认 1，增加 N 只补缺少候选")
    result.add_argument("--job-timeout", type=nonnegative_seconds, default=0, help="单个远端任务最长等待秒数，0=健康连接时不限；到时保留任务身份")
    result.add_argument("--request-timeout", type=positive_seconds, default=30, help="单次 HTTP 请求超时秒数，默认 30")
    result.add_argument("--disconnect-timeout", type=positive_seconds, default=300, help="持续无法连接多久后保留 unknown 并继续，默认 300 秒")
    result.add_argument("--heartbeat-interval", type=positive_seconds, default=15, help="等待状态心跳间隔秒数，默认 15")
    result.add_argument("--only", help="只处理这些镜头，逗号分隔 ID/order")
    result.add_argument("--rerun", help="重做指定镜头；仍先核对未确认的远端任务")
    result.add_argument("--rerun-candidates", help="重做指定候选：镜头ID或编号:候选号，逗号分隔；按最后一个冒号分隔")
    result.add_argument("--dry-run", action="store_true", help="只准备本地 payload，不联网或运行 FFmpeg/模型")
    result.add_argument("--concat", action="store_true", help="按候选号生成完整顺序预览；N=1为preview.mp4，N>1为preview-c001.mp4等")
    return result


def positive_integer(value):
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise argparse.ArgumentTypeError("候选数必须是正整数。") from error
    if number < 1:
        raise argparse.ArgumentTypeError("候选数必须是正整数。")
    return number


def nonnegative_seconds(value):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise argparse.ArgumentTypeError("等待时间必须是大于或等于 0 的有限数字。") from error
    if not math.isfinite(number) or number < 0:
        raise argparse.ArgumentTypeError("等待时间必须是大于或等于 0 的有限数字。")
    return number


def positive_seconds(value):
    number = nonnegative_seconds(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("请求、断线和心跳时间必须大于 0。")
    return number


def gui_options(raw, *, dry_run=False, concat=False):
    """Validate editable text before starting any thread, file access or request."""
    values = {key: str(value).strip() for key, value in raw.items()}
    if not values.get("package"):
        raise BatchError("请选择包含 project.json 的项目文件夹。")
    try:
        candidates = positive_integer(values.get("candidates", "1"))
        minutes = nonnegative_seconds(values.get("job_minutes", "0"))
        seconds = minutes * 60
        if not math.isfinite(seconds):
            raise argparse.ArgumentTypeError("最长等待时间过大。")
    except argparse.ArgumentTypeError as error:
        raise BatchError(str(error)) from error
    return {"package": values["package"], "character_image": values.get("character_image") or None,
            "comfy_url": values.get("comfy_url") or "http://127.0.0.1:8188", "ffmpeg": values.get("ffmpeg") or None,
            "candidates": candidates, "job_timeout": seconds,
            "only": values.get("only") or None, "rerun": values.get("rerun") or None,
            "rerun_candidates": values.get("rerun_candidates") or None, "dry_run": dry_run, "concat": concat}


def duration_text(seconds):
    seconds = max(0, int(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes:02d}:{seconds:02d}"


def gui_progress_text(progress, elapsed_seconds=0, run_seconds=0):
    labels = {"idle": "就绪", "preflight": "检查运行环境", "checking": "检查与对账", "connecting": "连接生成主机",
              "pending": "等待处理", "preparing": "准备素材", "submitting": "提交任务",
              "queued": "远端排队", "queue": "远端排队", "running": "远端生成", "waiting": "等待远端任务",
              "reconciling": "核对已有任务", "reconcile": "核对已有任务", "disconnected": "连接中断，正在恢复",
              "downloading": "下载与封装", "encoding": "封装视频", "succeeded": "候选已完成", "failed": "候选失败",
              "unknown": "任务待对账", "stopping": "已要求停止后续提交", "stopped": "已停止后续提交",
              "paused": "已停止本地等待，任务可恢复", "input_error": "请检查输入素材",
              "complete": "本轮结束", "completed": "本轮结束", "finished": "本轮结束", "done": "本轮结束",
              "concat": "生成顺序预览", "preview": "生成顺序预览"}
    phase = str(progress.get("phase", "idle"))
    parts = [labels.get(phase, phase)]
    shot = progress.get("shot_id")
    if shot is not None:
        parts.append(f"镜头 {shot}")
    if progress.get("candidate_index") is not None:
        parts.append(f"候选 {progress['candidate_index']}" + (f"/{progress['candidate_total']}" if progress.get("candidate_total") is not None else ""))
    if progress.get("total") is not None:
        parts.append(f"已完成 {progress.get('completed', 0)}/{progress['total']}")
    parts.append(f"当前任务 {duration_text(elapsed_seconds)}")
    parts.append(f"本次运行 {duration_text(run_seconds)}")
    return " · ".join(parts)


def queue_gui_event(events, event, value):
    """A bounded event ring keeps slow GUI paints from retaining unlimited logs."""
    while True:
        try:
            events.put_nowait((event, value))
            return
        except queue.Full:
            try:
                events.get_nowait()
            except queue.Empty:
                pass


def launch_gui():
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox, ttk
        window = tk.Tk()
    except Exception:
        print("当前 Python 没有可用 Tk 窗口。请使用：\npython runner.py \"项目目录\" --character-image \"角色图.png\" --comfy-url http://127.0.0.1:8188\n运行 python runner.py --help 查看选项。", file=sys.stderr)
        return 1
    window.title("ASMR 视频整批生成")
    window.geometry("860x740")
    window.minsize(700, 580)
    frame = ttk.Frame(window, padding=14)
    frame.pack(fill="both", expand=True)
    frame.columnconfigure(1, weight=1)
    fields = {"package": tk.StringVar(), "character_image": tk.StringVar(), "comfy_url": tk.StringVar(value="http://127.0.0.1:8188"), "ffmpeg": tk.StringVar(),
              "candidates": tk.StringVar(value="1"), "job_minutes": tk.StringVar(value="0"),
              "only": tk.StringVar(), "rerun": tk.StringVar(), "rerun_candidates": tk.StringVar()}
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
    controls = ttk.Frame(frame)
    controls.grid(row=4, column=0, columnspan=3, sticky="ew", pady=8)
    ttk.Label(controls, text="每镜候选数 N").grid(row=0, column=0, sticky="w")
    ttk.Entry(controls, textvariable=fields["candidates"], width=8).grid(row=0, column=1, padx=(8, 20))
    ttk.Label(controls, text="最长任务等待（分钟，0=不限）").grid(row=0, column=2, sticky="w")
    ttk.Entry(controls, textvariable=fields["job_minutes"], width=10).grid(row=0, column=3, padx=8)
    ttk.Checkbutton(frame, text="只检查项目并准备 payload（不连接 ComfyUI）", variable=dry).grid(row=5, column=0, columnspan=3, sticky="w", pady=4)
    ttk.Checkbutton(frame, text="全部镜头成功后，按同一候选号生成完整顺序预览片", variable=concat_flag).grid(row=6, column=0, columnspan=3, sticky="w", pady=4)
    advanced = ttk.LabelFrame(frame, text="选填；镜头可用 ID 或序号，候选用 镜头:候选号", padding=8)
    advanced.grid(row=8, column=0, columnspan=3, sticky="ew", pady=5)
    advanced.columnconfigure(1, weight=1)
    for row, (key, label) in enumerate((("only", "只做镜头"), ("rerun", "重做镜头"), ("rerun_candidates", "重做某候选"))):
        ttk.Label(advanced, text=label).grid(row=row, column=0, sticky="w", pady=3)
        ttk.Entry(advanced, textvariable=fields[key]).grid(row=row, column=1, sticky="ew", padx=8)
    advanced.grid_remove()
    advanced_open = tk.BooleanVar(value=False)
    ttk.Checkbutton(frame, text="高级：选择镜头或重做候选", variable=advanced_open,
                    command=lambda: advanced.grid() if advanced_open.get() else advanced.grid_remove()).grid(row=7, column=0, columnspan=3, sticky="w", pady=4)
    ttk.Label(frame, text="N=1保持单结果；增加N只补候选，减少N保留已有文件。停止不会取消ComfyUI已提交任务。", wraplength=780).grid(row=9, column=0, columnspan=3, sticky="w", pady=5)
    status_text = tk.StringVar(value="就绪")
    ttk.Label(frame, textvariable=status_text, wraplength=780).grid(row=11, column=0, columnspan=3, sticky="w", pady=5)
    text_box = tk.Text(frame, height=16, wrap="word", state="disabled")
    text_box.grid(row=12, column=0, columnspan=3, sticky="nsew", pady=8)
    frame.rowconfigure(12, weight=1)
    events = queue.Queue(maxsize=500)
    running = [False]
    active_stop = [None]
    run_started = [0.0]
    run_finished = [None]
    progress = [{"phase": "idle"}]
    progress_received = [0.0]

    def post(event, value):
        queue_gui_event(events, event, value)

    def append_log(message):
        text_box.configure(state="normal")
        text_box.insert("end", str(message) + "\n")
        line_count = int(text_box.index("end-1c").split(".")[0])
        if line_count > 2000:
            text_box.delete("1.0", f"{line_count - 2000 + 1}.0")
        text_box.see("end")
        text_box.configure(state="disabled")

    def start():
        if running[0]:
            return
        try:
            values = gui_options({key: value.get() for key, value in fields.items()}, dry_run=dry.get(), concat=concat_flag.get())
        except BatchError as error:
            messagebox.showerror("请检查设置", str(error))
            return
        stop = threading.Event()
        active_stop[0] = stop
        running[0] = True
        run_started[0] = time.monotonic()
        run_finished[0] = None
        progress[0], progress_received[0] = {"phase": "preflight"}, run_started[0]
        button.configure(state="disabled")
        stop_button.configure(state="normal")

        def worker():
            try:
                result = BatchRunner(**values, log=lambda message: post("log", message),
                                     status_callback=lambda event: post("progress", dict(event)), stop_event=stop).run()
                post("result", result)
            except Exception as error:
                post("log", f"未完成：{error}")
                post("progress", {"phase": "failed"})
            finally:
                post("done", None)
        threading.Thread(target=worker, daemon=True).start()

    def stop_submissions():
        if active_stop[0] is not None:
            active_stop[0].set()
        stop_button.configure(state="disabled")
        progress[0] = {**progress[0], "phase": "stopping"}
        append_log("已要求停止后续提交；已提交给 ComfyUI 的任务继续运行，下次先对账恢复。")

    actions = ttk.Frame(frame)
    actions.grid(row=10, column=0, columnspan=3, pady=8)
    button = ttk.Button(actions, text="开始 / 继续整批", command=start)
    button.grid(row=0, column=0, padx=5)
    stop_button = ttk.Button(actions, text="停止后续提交", command=stop_submissions, state="disabled")
    stop_button.grid(row=0, column=1, padx=5)

    def tick():
        paint_deadline = time.monotonic() + .02
        for _ in range(100):
            try:
                event, value = events.get_nowait()
            except queue.Empty:
                break
            if event == "done":
                running[0] = False
                run_finished[0] = time.monotonic()
                button.configure(state="normal")
                stop_button.configure(state="disabled")
            elif event == "progress":
                progress[0], progress_received[0] = value, time.monotonic()
            elif event == "result":
                progress[0] = {**progress[0], "phase": "stopped" if value.get("stopped") or value.get("cancelled") else "complete"}
            else:
                append_log(value)
            if time.monotonic() >= paint_deadline:
                break
        if running[0]:
            now = time.monotonic()
            try:
                elapsed = float(progress[0].get("elapsed_seconds", 0))
            except (TypeError, ValueError):
                elapsed = 0
            status_text.set(gui_progress_text(progress[0], elapsed + now - progress_received[0], now - run_started[0]))
        elif progress[0].get("phase") != "idle":
            end = run_finished[0] or time.monotonic()
            status_text.set(gui_progress_text(progress[0], float(progress[0].get("elapsed_seconds", 0)), end - run_started[0]))
        window.after(100, tick)

    def close():
        if running[0] and not messagebox.askyesno("保存后退出", "退出不会取消已经提交给 ComfyUI 的任务。下次运行会先对账恢复。现在退出？"):
            return
        if active_stop[0] is not None:
            active_stop[0].set()
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
        if result.get("stopped") or result.get("cancelled"):
            return 130
        return 0 if "dry_run" in result or not any(result.get(key) for key in ("failed", "unknown", "downloading", "input_error", "preview_failed")) else 2
    except KeyboardInterrupt:
        print("已停止本地等待与后续提交。ComfyUI 已提交任务继续运行；重新运行同一项目会先对账恢复。", file=sys.stderr)
        return 130
    except (BatchError, OSError, ValueError) as error:
        print(f"未完成：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
