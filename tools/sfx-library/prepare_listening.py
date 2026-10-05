"""Prepare an independent, auditable ASMR recording listening collection.

This helper does not import recordings into the product or modify the existing
licensed library. New downloads are Freesound CC0 HQ previews, never original
WAV downloads. Run --help for the required input and artifact paths.
"""

from __future__ import annotations

import argparse
from array import array
from datetime import datetime, timezone
import hashlib
from html import escape
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urljoin, urlsplit
from urllib.request import ProxyHandler, Request, build_opener
import wave


FORMAT = "asmr-sfx-listening/v1"
LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"
CATEGORY_LABELS = {
    "cloth": "布料",
    "tapping": "轻敲",
    "rain": "雨声",
    "paper": "翻书",
    "brushing": "刷擦",
    "spray": "喷雾",
    "skin": "按摩动作",
    "ear_cleaning": "掏耳",
    "ear_rubbing": "揉耳",
}
EXISTING_LABELS = {
    "cloth_joao_janz_493260": "被子摩擦",
    "cloth_whitefire43_641387": "衣物摩擦",
    "tapping_laboratorio_669615": "指尖轻敲 · 木头",
    "tapping_jackthemurray_429395": "指尖轻敲 · 桌面",
    "rain_yostpeter_523405": "雨声 · 窗外",
    "rain_visionear_573335": "雨声 · 柔雨环境",
}
SAFE_ID = re.compile(r"[A-Za-z0-9_-]{1,160}\Z")
SOURCE_PATH = re.compile(r"/people/([^/]+)/sounds/([0-9]+)/?\Z")
PREVIEW_PATH = re.compile(r"/previews/[0-9]+/([0-9]+)_[0-9]+-hq\.mp3\Z")


class PreparationError(ValueError):
    """Input, ownership, provenance or audio verification failed."""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def safe_segment(value, name: str) -> str:
    if not isinstance(value, str) or not SAFE_ID.fullmatch(value):
        raise PreparationError(f"Invalid {name}: expected a safe identifier")
    return value


def text_field(value, name: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 2000:
        raise PreparationError(f"Invalid {name}: expected nonempty text")
    return value


def checked_url(value, hosts: set[str], name: str):
    value = text_field(value, name)
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or parsed.hostname not in hosts
            or parsed.username or parsed.password or parsed.port
            or parsed.query or parsed.fragment):
        raise PreparationError(f"Invalid {name}: expected an approved HTTPS URL")
    return parsed


def validate_source(item: dict) -> dict:
    if not isinstance(item, dict):
        raise PreparationError("Each source must be an object")
    source = dict(item)
    safe_segment(source.get("asset_id"), "asset_id")
    category = safe_segment(source.get("category"), "category")
    source["category_label"] = text_field(
        source.get("category_label", CATEGORY_LABELS.get(category, category)),
        "category_label",
    )
    for field in ("title", "author"):
        text_field(source.get(field), field)
    source["label"] = text_field(
        source.get("label", EXISTING_LABELS.get(source["asset_id"], source["title"])),
        "label",
    )
    page = checked_url(source.get("source_page_url"), {"freesound.org", "www.freesound.org"}, "source_page_url")
    match = SOURCE_PATH.fullmatch(page.path)
    if not match or unquote(match[1]) != source["author"]:
        raise PreparationError(f"Source page author does not match {source['asset_id']}")
    download = checked_url(source.get("download_url"), {"cdn.freesound.org"}, "download_url")
    preview = PREVIEW_PATH.fullmatch(download.path)
    if not preview or preview[1] != match[2]:
        raise PreparationError(f"HQ preview ID does not match source page: {source['asset_id']}")
    if (source.get("download_variant") != "preview"
            or source.get("license_name") != "CC0 1.0"
            or source.get("license_url") != LICENSE_URL
            or source.get("attribution_required") is not False
            or source.get("redistribution_allowed") is not True):
        raise PreparationError(f"Only documented CC0 HQ previews are supported: {source['asset_id']}")
    if "sha256" in source and not re.fullmatch(r"[a-f0-9]{64}", source["sha256"]):
        raise PreparationError("Invalid documented source SHA-256")
    return source


class PageLinks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []
        self.identities: list[str] = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        href = values.get("href")
        if href and tag in ("a", "link"):
            self.links.append(href)
        if tag == "link" and "canonical" in values.get("rel", "").lower().split() and href:
            self.identities.append(href)
        if tag == "meta" and values.get("property", "").lower() == "og:url":
            if values.get("content"):
                self.identities.append(values["content"])


def verify_source_page(source: dict, page_bytes: bytes) -> None:
    page = PageLinks()
    page.feed(page_bytes.decode("utf-8", errors="strict"))
    base = source["source_page_url"]
    expected = urlsplit(base)
    identities = [urlsplit(urljoin(base, value)) for value in page.identities]
    if identities and not any(
            value.hostname in {"freesound.org", "www.freesound.org"}
            and value.path.rstrip("/") == expected.path.rstrip("/")
            for value in identities):
        raise PreparationError(f"Source page identity does not match: {source['asset_id']}")
    decoded_html = page_bytes.decode("utf-8").replace("\\/", "/")
    if source["download_url"] not in decoded_html:
        raise PreparationError(f"Source page does not contain the configured HQ preview: {source['asset_id']}")
    links = [urlsplit(urljoin(base, value)) for value in page.links]
    author_path = f"/people/{source['author']}/"
    if not any(value.hostname in {"freesound.org", "www.freesound.org"}
               and unquote(value.path).rstrip("/") == author_path.rstrip("/")
               for value in links):
        raise PreparationError(f"Source page author link is missing: {source['asset_id']}")
    if not any(value.scheme in {"http", "https"}
               and value.hostname == "creativecommons.org"
               and (value.path.rstrip("/") == "/publicdomain/zero/1.0"
                    or value.path.startswith("/publicdomain/zero/1.0/"))
               for value in links):
        raise PreparationError(f"Source page has no CC0 license link: {source['asset_id']}")


def contained(root: Path, *parts: str) -> Path:
    target = root.joinpath(*parts)
    if not target.resolve().is_relative_to(root.resolve()):
        raise PreparationError("Output or source file escapes its permitted directory")
    return target


def atomic_write(path: Path, data: bytes, *, immutable: bool = False) -> None:
    """Publish complete files; immutable files can only be reused byte for byte."""
    if immutable and path.exists():
        if file_hash(path) != sha256(data):
            raise PreparationError(f"Refusing to replace immutable file: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}-", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if immutable:
            try:
                # Windows rename refuses an existing destination and also
                # works on artifact drives that do not support hard links.
                if os.name == "nt":
                    os.rename(temporary, path)
                else:
                    os.link(temporary, path)
            except FileExistsError:
                if file_hash(path) != sha256(data):
                    raise PreparationError(f"Immutable file collision: {path}") from None
        else:
            os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def claim_root(root: Path, existing_root: Path) -> None:
    if root == root.parent or root.is_relative_to(existing_root):
        raise PreparationError("Artifact root cannot be a drive root or the existing licensed library")
    root.mkdir(parents=True, exist_ok=True)
    marker = contained(root, ".asmr-sfx-listening-owner.json")
    ownership = {"format": FORMAT, "root": str(root)}
    if marker.exists():
        if read_json(marker) != ownership:
            raise PreparationError("Artifact directory belongs to a different preparation task")
        return
    for name in ("assets", "catalog.json", "index.html"):
        if contained(root, name).exists():
            raise PreparationError(f"Unowned artifact output already exists: {name}")
    atomic_write(marker, json_bytes(ownership), immutable=True)


def inspect_wav(path: Path) -> dict:
    try:
        with wave.open(str(path), "rb") as reader:
            channels = reader.getnchannels()
            sample_rate = reader.getframerate()
            frames = reader.getnframes()
            if (reader.getcomptype() != "NONE" or reader.getsampwidth() != 2
                    or channels != 2 or sample_rate != 48000 or frames <= 0):
                raise PreparationError(f"Expected nonempty 48 kHz stereo PCM16 WAV: {path}")
            if not 0.05 <= frames / sample_rate <= 3600:
                raise PreparationError(f"Unexpected recording duration: {path}")
            decoded_frames = 0
            sample_count = 0
            squares = 0
            peak = 0
            clipped = 0
            while True:
                raw = reader.readframes(65536)
                if not raw:
                    break
                if len(raw) % (channels * 2):
                    raise PreparationError(f"Incomplete PCM frame: {path}")
                pcm = array("h")
                pcm.frombytes(raw)
                if sys.byteorder != "little":
                    pcm.byteswap()
                decoded_frames += len(pcm) // channels
                sample_count += len(pcm)
                squares += sum(value * value for value in pcm)
                peak = max(peak, abs(min(pcm)), abs(max(pcm)))
                clipped += sum(value in (-32768, 32767) for value in pcm)
            if decoded_frames != frames:
                raise PreparationError(f"Truncated WAV: {path}")
            rms = math.sqrt(squares / sample_count) / 32768
            if peak == 0 or rms < 1e-7:
                raise PreparationError(f"Silent or invalid WAV: {path}")
            return {
                "channels": channels,
                "sample_rate": sample_rate,
                "bits_per_sample": 16,
                "frames": frames,
                "duration_seconds": frames / sample_rate,
                "peak_dbfs": round(20 * math.log10(peak / 32768), 3),
                "rms_dbfs": round(20 * math.log10(rms), 3),
                "clipped_samples": clipped,
                "wav_sha256": file_hash(path),
            }
    except (wave.Error, EOFError) as error:
        raise PreparationError(f"Invalid WAV {path}: {error}") from error


def download(opener, url: str, *, hosts: set[str], limit: int) -> bytes:
    request = Request(url, headers={"User-Agent": "ASMRDirectorListeningPrep/1.0", "Accept-Encoding": "identity"})
    with opener.open(request, timeout=30) as response:
        checked_url(response.url, hosts, "download redirect")
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > limit:
            raise PreparationError("Download exceeds the documented size limit")
        chunks = []
        size = 0
        while True:
            chunk = response.read(65536)
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise PreparationError("Download exceeds the documented size limit")
            chunks.append(chunk)
        if not size:
            raise PreparationError("Downloaded an empty file")
        return b"".join(chunks)


def provenance_fields(source: dict) -> dict:
    keys = (
        "asset_id", "category", "label", "title", "author", "source_page_url",
        "download_url", "download_variant", "license_name", "license_url",
        "attribution_required", "redistribution_allowed",
    )
    return {key: source[key] for key in keys}


def catalog_entry(source: dict, root: Path, wav_path: Path, source_hash: str, origin: str, processing: str) -> dict:
    return {
        **provenance_fields(source),
        "category_label": source["category_label"],
        "origin": origin,
        "source_sha256": source_hash,
        "audio_path": wav_path.relative_to(root).as_posix(),
        "processing": processing,
        **inspect_wav(wav_path),
        "listening_status": "pending",
    }


def copy_existing(source: dict, existing_root: Path, root: Path) -> dict:
    directory = contained(existing_root, source["category"], source["asset_id"])
    for name in ("original_file_name", "normalized_file_name"):
        file_name = source.get(name)
        if not isinstance(file_name, str) or Path(file_name).name != file_name or file_name in ("", ".", ".."):
            raise PreparationError(f"Unsafe existing library filename: {name}")
    original = contained(directory, source["original_file_name"])
    normalized = contained(directory, source["normalized_file_name"])
    original_hash = file_hash(original)
    if original_hash != source.get("sha256"):
        raise PreparationError(f"Existing source hash mismatch: {source['asset_id']}")
    metrics = inspect_wav(normalized)
    if (metrics["sample_rate"] != source.get("normalized_sample_rate")
            or metrics["channels"] != source.get("normalized_channels")
            or abs(metrics["duration_seconds"] - source.get("normalized_duration", -1)) > 1 / 48000):
        raise PreparationError(f"Existing WAV metadata mismatch: {source['asset_id']}")
    destination = contained(root, "assets", source["asset_id"], "listening.wav")
    atomic_write(destination, normalized.read_bytes(), immutable=True)
    if file_hash(destination) != metrics["wav_sha256"]:
        raise PreparationError("Existing WAV copy checksum mismatch")
    entry = catalog_entry(
        source, root, destination, original_hash, "existing-library",
        "沿用旧版统一 WAV（此前曾峰值归一）；本次仅逐字节复制",
    )
    atomic_write(destination.parent / "provenance.json", json_bytes(entry), immutable=True)
    return entry


def prepare_new(source: dict, root: Path, opener, ffmpeg: str | None) -> dict:
    directory = contained(root, "assets", source["asset_id"])
    page_path = contained(directory, "source-page.html")
    original_path = contained(directory, "source-hq.mp3")
    record_path = contained(directory, "source-record.json")
    expected_identity = provenance_fields(source)
    if record_path.exists():
        record = read_json(record_path)
        if record.get("source") != expected_identity:
            raise PreparationError(f"Cached download identity changed: {source['asset_id']}")
        page_bytes = page_path.read_bytes() if page_path.exists() else download(
            opener, source["source_page_url"], hosts={"freesound.org", "www.freesound.org"}, limit=4 * 1024 * 1024,
        )
        original_bytes = original_path.read_bytes() if original_path.exists() else download(
            opener, source["download_url"], hosts={"cdn.freesound.org"}, limit=64 * 1024 * 1024,
        )
        if (sha256(page_bytes) != record.get("source_page_sha256")
                or sha256(original_bytes) != record.get("source_sha256")):
            raise PreparationError(f"Cached download checksum changed: {source['asset_id']}")
    else:
        if page_path.exists() or original_path.exists():
            raise PreparationError(f"Untracked source files exist: {source['asset_id']}")
        page_bytes = download(opener, source["source_page_url"], hosts={"freesound.org", "www.freesound.org"}, limit=4 * 1024 * 1024)
        verify_source_page(source, page_bytes)
        original_bytes = download(opener, source["download_url"], hosts={"cdn.freesound.org"}, limit=64 * 1024 * 1024)
        record = {
            "format": FORMAT,
            "source": expected_identity,
            "source_page_sha256": sha256(page_bytes),
            "source_sha256": sha256(original_bytes),
        }
    verify_source_page(source, page_bytes)
    if source.get("sha256") and sha256(original_bytes) != source["sha256"]:
        raise PreparationError(f"Configured download checksum mismatch: {source['asset_id']}")
    # Record checksums before publishing immutable downloads, so interrupted runs
    # may only reuse bytes whose checksums were already documented.
    atomic_write(record_path, json_bytes(record), immutable=True)
    atomic_write(page_path, page_bytes, immutable=True)
    atomic_write(original_path, original_bytes, immutable=True)
    wav_path = contained(directory, "listening.wav")
    provenance_path = contained(directory, "provenance.json")
    if wav_path.exists():
        if not provenance_path.exists():
            raise PreparationError(f"Untracked converted WAV exists: {source['asset_id']}")
        previous = read_json(provenance_path)
        if previous.get("source_sha256") != record["source_sha256"] or previous.get("wav_sha256") != file_hash(wav_path):
            raise PreparationError(f"Converted WAV checksum mismatch: {source['asset_id']}")
    else:
        if not ffmpeg:
            raise PreparationError("ffmpeg is required to decode new MP3 previews; supply --ffmpeg")
        with tempfile.NamedTemporaryFile(dir=directory, prefix=".decode-", suffix=".wav", delete=False) as temporary:
            temporary_path = Path(temporary.name)
        try:
            subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                "-i", str(original_path), "-map", "0:a:0", "-vn",
                "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le",
                "-map_metadata", "-1", str(temporary_path),
            ], check=True, capture_output=True, text=True, timeout=120)
            metrics = inspect_wav(temporary_path)
            draft = catalog_entry(source, root, temporary_path, record["source_sha256"], "new-download", "仅解码/重采样；未调增益、未截取、未淡入淡出")
            draft["audio_path"] = wav_path.relative_to(root).as_posix()
            draft.update(metrics)
            atomic_write(provenance_path, json_bytes(draft), immutable=True)
            atomic_write(wav_path, temporary_path.read_bytes(), immutable=True)
        finally:
            temporary_path.unlink(missing_ok=True)
    entry = catalog_entry(source, root, wav_path, record["source_sha256"], "new-download", "仅解码/重采样；未调增益、未截取、未淡入淡出")
    atomic_write(provenance_path, json_bytes(entry), immutable=True)
    return entry


def listening_html(entries: list[dict]) -> str:
    cards = []
    for item in entries:
        search = " ".join(str(item[key]) for key in ("label", "title", "author", "category_label"))
        source_type = "新取得" if item["origin"] == "new-download" else "已有录音"
        cards.append(f"""<article class="card" data-category="{escape(item['category'], quote=True)}" data-search="{escape(search.lower(), quote=True)}">
<div class="tags"><span>{escape(item['category_label'])}</span><span>{source_type}</span><span>待试听</span></div>
<h2>{escape(item['label'])}</h2><p class="title">{escape(item['title'])}</p>
<p class="meta">{item['duration_seconds']:.2f} 秒 · 48 kHz · 双声道</p>
<audio controls preload="none" src="{escape(item['audition_path'], quote=True)}" aria-label="{escape(item['label'] + '试听', quote=True)}"></audio>
<p class="note">HQ MP3 预览转换 · CC0 1.0</p>
<details><summary>试听音量与原录音</summary><p class="meta">试听增益 {item['audition_gain_db']:+.1f} dB；只调整音量。<a href="{escape(item['audio_path'], quote=True)}" target="_blank" rel="noopener">播放原录音</a></p><p class="processing">{escape(item['processing'])}</p></details>
<p class="source"><a href="{escape(item['source_page_url'], quote=True)}" target="_blank" rel="noopener noreferrer">原作品页</a> · {escape(item['author'])}</p>
</article>""")
    categories = {item["category"]: item["category_label"] for item in entries}
    options = "".join(f'<option value="{escape(category, quote=True)}">{escape(label)}</option>' for category, label in categories.items())
    return """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>ASMR 音效试听</title><style>
:root{color-scheme:dark;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#10171c;color:#e7efed}
*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:32px 20px 48px}
h1{font-size:26px;margin:0 0 12px}header p{max-width:850px;line-height:1.7;color:#a7b8b3;margin:0 0 20px}
.filters{display:flex;gap:12px;flex-wrap:wrap}.filters label{display:flex;gap:8px;align-items:center}
.filters label:first-child{flex:1;min-width:220px}.filters input{flex:1;min-width:0}
input,select{font:inherit;color:inherit;background:#18262b;border:1px solid #3c5557;border-radius:8px;padding:10px}
input:focus,select:focus,a:focus,audio:focus{outline:2px solid #7bd5bb;outline-offset:3px}
#results{color:#a7b8b3;font-size:14px;margin:18px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:16px}
.card{min-width:0;background:#19262b;border:1px solid #2d4247;border-radius:14px;padding:20px;overflow-wrap:anywhere}.card[hidden]{display:none}
.tags{display:flex;gap:7px;flex-wrap:wrap;font-size:12px;color:#b7d6ce}.tags span{background:#253a3e;border-radius:5px;padding:4px 7px}
h2{font-size:19px;margin:15px 0 7px}.title{font-size:13px;color:#b3c2c0;min-height:2em;margin:0 0 14px}.meta,.note,.processing,.source{font-size:13px;line-height:1.6;color:#a7b8b3}
audio{width:100%;display:block;margin:12px 0}.processing{font-size:12px;min-height:3em}a{color:#85d9c0}.source{margin-bottom:0}#empty{color:#a7b8b3}
@media(max-width:480px){main{padding:24px 14px}.filters label{width:100%}.filters select{flex:1}.card{padding:17px}}
</style></head><body><main><header><h1>ASMR 音效试听</h1>
<p>试听录音的材质、动作与杂音，选出适合工程的声音。全部录音均来自 Freesound 的 CC0 高质量 MP3 预览。试听副本调整了音量以方便比较，原录音保留在卡片详情。候选尚待听感确认，尚未采用到工程。播放音量默认 35%。</p></header>
<p>本批优先贴耳护理：棉签清洁、揉耳、按摩动作、喷雾。刷擦是普通物体录音备选，真实刷耳仍待补充；双声道不等于双耳录音。</p>
<div class="filters"><label>搜索<input id="search" type="search" placeholder="声音名称、材质或作者" autocomplete="off"></label>
<label>类别<select id="category"><option value="">全部类别</option>""" + options + """</select></label></div>
<p id="results" aria-live="polite"></p><div class="grid">""" + "".join(cards) + """</div><p id="empty" hidden>没有匹配的声音。</p>
</main><script>
const cards=Array.from(document.querySelectorAll('.card'));
const audios=Array.from(document.querySelectorAll('audio'));
const search=document.getElementById('search'),category=document.getElementById('category');
function filter(){const query=search.value.trim().toLowerCase();let count=0;
for(const card of cards){const visible=(!category.value||card.dataset.category===category.value)&&(!query||card.dataset.search.includes(query));
card.hidden=!visible;if(visible)count++;else{const audio=card.querySelector('audio');audio.pause();}}
document.getElementById('results').textContent='显示 '+count+' / '+cards.length+' 个候选';
document.getElementById('empty').hidden=count!==0;}
for(const audio of audios){audio.volume=.35;audio.addEventListener('play',()=>{for(const other of audios){if(other!==audio){other.pause();other.currentTime=0;}}});}
search.addEventListener('input',filter);category.addEventListener('change',filter);filter();
</script></body></html>
"""


def prepare_audition(entry: dict, root: Path, ffmpeg: str | None) -> dict:
    """Level only a separate audition copy; keep the dry source WAV immutable."""
    gain_db = round(min(-30 - entry["rms_dbfs"], -6 - entry["peak_dbfs"]), 3)
    original = contained(root, *Path(entry["audio_path"]).parts)
    destination = original.parent / "audition.wav"
    record_path = original.parent / "audition-record.json"
    identity = {"source_wav_sha256": entry["wav_sha256"], "gain_db": gain_db,
                "target_rms_dbfs": -30, "peak_ceiling_dbfs": -6}
    if destination.exists():
        record = read_json(record_path)
        if record.get("identity") != identity or record.get("wav_sha256") != file_hash(destination):
            raise PreparationError("Audition WAV identity/checksum mismatch")
    else:
        if not ffmpeg:
            raise PreparationError("ffmpeg is required to prepare audition copies")
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".audition-", suffix=".wav", delete=False) as stream:
            temporary = Path(stream.name)
        try:
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                            "-i", str(original), "-af", f"volume={gain_db}dB", "-c:a", "pcm_s16le",
                            "-map_metadata", "-1", str(temporary)],
                           check=True, capture_output=True, text=True, timeout=120)
            metrics = inspect_wav(temporary)
            if metrics["frames"] != entry["frames"] or metrics["clipped_samples"]:
                raise PreparationError("Audition copy changed timing or clipped")
            record = {"identity": identity, "wav_sha256": metrics["wav_sha256"]}
            atomic_write(record_path, json_bytes(record), immutable=True)
            atomic_write(destination, temporary.read_bytes(), immutable=True)
        finally:
            temporary.unlink(missing_ok=True)
    metrics = inspect_wav(destination)
    if metrics["frames"] != entry["frames"] or metrics["clipped_samples"]:
        raise PreparationError("Invalid audition copy timing or clipping")
    return {**entry, "audition_path": destination.relative_to(root).as_posix(),
            "audition_gain_db": gain_db, "audition_wav_sha256": metrics["wav_sha256"],
            "audition_rms_dbfs": metrics["rms_dbfs"], "audition_peak_dbfs": metrics["peak_dbfs"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="Absolute task-owned artifact directory")
    parser.add_argument("--sources", type=Path, required=True, help="JSON containing version: 1 and sources: [...]")
    parser.add_argument("--existing", type=Path, required=True, help="Read-only existing licensed-assets manifest.json")
    parser.add_argument("--ffmpeg", help="ffmpeg executable; defaults to ffmpeg on PATH")
    parser.add_argument("--direct", action="store_true", help="Use direct HTTPS without environment proxies")
    args = parser.parse_args()
    if not args.root.is_absolute():
        parser.error("--root must be an absolute path")
    root = args.root.resolve()
    sources_path = args.sources.resolve(strict=True)
    existing_path = args.existing.resolve(strict=True)
    source_manifest = read_json(sources_path)
    existing_manifest = read_json(existing_path)
    if not isinstance(source_manifest, dict) or source_manifest.get("version") != 1 or not isinstance(source_manifest.get("sources"), list):
        raise PreparationError("Expected sources JSON with version: 1 and sources: [...]")
    if not isinstance(existing_manifest, dict) or existing_manifest.get("version") != 1 or not isinstance(existing_manifest.get("assets"), list):
        raise PreparationError("Expected existing library manifest version: 1")
    new_sources = [validate_source(item) for item in source_manifest["sources"]]
    existing_sources = [validate_source(item) for item in existing_manifest["assets"]]
    ids = [item["asset_id"] for item in existing_sources + new_sources]
    if len(ids) != len(set(ids)):
        raise PreparationError("Asset IDs must be unique across both inputs")
    ffmpeg = args.ffmpeg or shutil.which("ffmpeg")
    if ffmpeg and not Path(ffmpeg).is_file():
        ffmpeg = shutil.which(ffmpeg)
    claim_root(root, existing_path.parent)
    opener = build_opener(ProxyHandler({})) if args.direct else build_opener()
    entries = []
    for source in existing_sources:
        print(f"Verify/copy existing: {source['asset_id']}", flush=True)
        entries.append(copy_existing(source, existing_path.parent, root))
    for source in new_sources:
        print(f"Acquire/verify new preview: {source['asset_id']}", flush=True)
        entries.append(prepare_new(source, root, opener, ffmpeg))
    entries.sort(key=lambda item: item["origin"] != "new-download")
    entries = [prepare_audition(entry, root, ffmpeg) for entry in entries]
    catalog = {
        "format": FORMAT,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "inputs": {
            "sources": str(sources_path), "sources_sha256": file_hash(sources_path),
            "existing_manifest": str(existing_path), "existing_manifest_sha256": file_hash(existing_path),
            "helper_sha256": file_hash(Path(__file__)),
        },
        "assets": entries,
    }
    atomic_write(contained(root, "catalog.json"), json_bytes(catalog))
    atomic_write(contained(root, "index.html"), listening_html(entries).encode("utf-8"))
    print(f"Prepared {len(entries)} pending recordings: {root / 'index.html'}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (PreparationError, OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        print(f"Preparation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None
