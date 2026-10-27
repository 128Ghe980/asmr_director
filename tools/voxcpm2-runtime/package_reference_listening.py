"""Package existing native takes; measure loudness, apply static gain only."""
from __future__ import annotations

from array import array
import argparse
from datetime import datetime, timezone
import hashlib
import html
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import wave

QA = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26")
OUTPUT = Path("I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192")
FFMPEG = Path("D:/CodexWorkplace/asmr_director_runtime/engines/gpt-sovits/env-comfyui-clone/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe")
RECEIPT = QA / "package_receipt.json"


def digest(path):
    hasher = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def info(path):
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": digest(path)}


def metrics(path):
    with wave.open(str(path), "rb") as audio:
        channels, width, rate, frames = audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()
        if width != 2 or audio.getcomptype() != "NONE":
            raise ValueError(f"Expected PCM16: {path}")
        samples = array("h", audio.readframes(frames))
        if sys.byteorder != "little":
            samples.byteswap()
        if len(samples) != frames * channels or not samples:
            raise ValueError(f"Empty or truncated WAV: {path}")
        peak = max(abs(sample) for sample in samples) / 32768
        rms = math.sqrt(sum((sample / 32768) ** 2 for sample in samples) / len(samples))
        return {"frames": frames, "channels": channels, "sample_rate": rate,
                "duration_seconds": frames / rate, "sample_width_bytes": width,
                "peak": peak, "peak_dbfs": 20 * math.log10(peak) if peak else None,
                "rms": rms, "rms_dbfs": 20 * math.log10(rms) if rms else None,
                "clipped_samples": sum(sample in (-32768, 32767) for sample in samples)}


def execute(command):
    start = time.perf_counter()
    result = subprocess.run(command, capture_output=True, timeout=120,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    record = {"command": command, "exit_code": result.returncode,
              "wall_seconds": round(time.perf_counter() - start, 3),
              "stdout": result.stdout.decode("utf-8", errors="replace"),
              "stderr": result.stderr.decode("utf-8", errors="replace")}
    if result.returncode:
        raise RuntimeError(json.dumps(record, ensure_ascii=False))
    return record


def measure(path):
    record = execute([str(FFMPEG), "-hide_banner", "-nostdin", "-i", str(path), "-map", "0:a:0",
                      "-af", "loudnorm=I=-23:TP=-1:LRA=11:print_format=json", "-f", "null", "-"])
    match = re.search(r'\{\s*"input_i"[\s\S]*?\}', record["stderr"])
    if not match:
        raise ValueError("ffmpeg loudnorm measurement JSON was absent")
    measured = json.loads(match.group(0))
    record["measurement"] = measured
    for key in ("input_i", "input_tp"):
        if not math.isfinite(float(measured[key])):
            raise ValueError("Cannot align silent or invalid audio")
    return record


def copy_verified(source, destination):
    if destination.exists():
        raise FileExistsError(destination)
    shutil.copyfile(source, destination)
    if digest(source) != digest(destination):
        raise ValueError(f"Copy hash mismatch: {destination}")


def player(path, title, seconds, raw=None):
    link = f'<a class="download" href="{html.escape(raw)}" download>下载原生 WAV</a>' if raw else f'<a class="download" href="{html.escape(path)}" download>下载参考 WAV</a>'
    return f'<article class="player"><div class="player-top"><h3>{html.escape(title)}</h3><span>{seconds:.2f} 秒</span></div><audio controls preload="metadata" src="{html.escape(path)}">浏览器不支持音频播放，请使用下载链接。</audio>{link}</article>'


def write_page(manifest, references, rows, reference_listening=None, overwrite=False):
    lookup = {(row["reference_id"], row["text_id"]): row for row in rows}
    ref_lookup = {row["id"]: row for row in references}
    heads = ''.join(f'<div class="role"><span class="eyebrow">{html.escape(ref["id"].split("-")[-1])} · 日语干音</span><h2>{html.escape(ref["name"])}</h2></div>' for ref in manifest["references"])
    reference_players = ''.join(player(('reference-listen/' if reference_listening else 'references/') + ref['id'] + '.wav', ref['name'] + ' · 日语参考', ref_lookup[ref['id']]['metrics']['duration_seconds'], 'references/' + ref['id'] + '.wav' if reference_listening else None) for ref in manifest['references'])
    sections = [f'<section aria-label="两组日语参考"><div class="two roles">{heads}</div><div class="two">{reference_players}</div></section>']
    for index, text in enumerate(manifest["texts"], 1):
        label = "短句试听" if text["id"] == "short" else "长段试听"
        players = []
        for ref in manifest["references"]:
            row = lookup[(ref["id"], text["id"])]
            stem = ref["id"] + "-" + text["id"]
            players.append(player('listen/' + stem + '.wav', ref['name'] + ' · ' + label, row['listen_metrics']['duration_seconds'], 'raw/' + stem + '.wav'))
        sections.append(f'<section><div class="section-title"><span class="number">0{index}</span><h2>{label}</h2><span class="badge">同一份中文文案</span></div><p class="transcript">{html.escape(text["text"])}</p><div class="two">{"".join(players)}</div></section>')
    page = '''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>日语干音 → 中文试听 · 雪之下 / 由比滨</title>
<style>
:root{color-scheme:light;--ink:#24332e;--muted:#66746b;--line:#d9e0d8;--paper:#f3f5ef;--accent:#43755e}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1060px;margin:auto;padding:60px 28px 44px}header{padding-bottom:34px;border-bottom:1px solid var(--line)}.eyebrow{font-size:12px;font-weight:600;letter-spacing:.12em;color:var(--accent)}h1{font-size:clamp(30px,5vw,44px);line-height:1.28;letter-spacing:-.025em;margin:12px 0 16px}header p{max-width:780px;color:var(--muted);margin:0;font-size:15px}section{margin-top:32px}.two{display:grid;grid-template-columns:1fr 1fr;gap:22px}.role{padding:0 3px}.role h2{font-size:25px;margin:3px 0 15px}.player{min-width:0;border:1px solid var(--line);border-radius:14px;padding:20px 22px;background:#fff}.player-top{display:flex;justify-content:space-between;gap:12px;align-items:baseline}h3{font-size:16px;margin:0 0 15px}.player-top span{font-size:13px;white-space:nowrap;color:var(--muted)}audio{display:block;width:100%;height:42px}.download{display:inline-block;margin-top:13px;font-size:13px;color:var(--accent);text-underline-offset:3px}.section-title{display:flex;align-items:center;gap:13px}.section-title h2{font-size:20px;margin:0}.number{font-size:13px;color:var(--accent);font-weight:700}.badge{font-size:12px;background:#e5ece2;color:#4f6857;padding:3px 9px;border-radius:20px}.transcript{border-left:3px solid #a6bca9;padding:10px 0 10px 20px;margin:16px 0 19px;font-size:17px;line-height:1.9}footer{margin-top:34px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}a:focus-visible,audio:focus-visible{outline:3px solid #5d9674;outline-offset:4px}@media(max-width:640px){main{padding:32px 18px}.two{grid-template-columns:1fr;gap:12px}.roles{grid-template-columns:1fr 1fr}.role h2{font-size:22px}.player{padding:17px}.badge{font-size:11px}.transcript{font-size:16px}}
</style></head><body><main><header><span class="eyebrow">VoxCPM2 · 2026.10.26</span><h1>日语干音 → 中文试听</h1><p>雪之下 160 与由比滨 192，分别使用日语参考生成相同的中文文案。中文播放器使用音量对齐版，方便轮流比较；每条都保留原生 WAV 下载。</p></header>
''' + '\n'.join(sections) + '''
<footer>试听仅施加整条固定音量增益，以 −23 LUFS 为目标、−1 dBTP 为峰值上限；未使用动态压限、均衡、降噪或语速修改。日语参考及中文生成的原始文件均保留下载。本页可直接本地打开。</footer></main></body></html>
'''
    if reference_listening:
        page = page.replace('中文播放器使用音量对齐版', '所有播放器使用音量对齐版')
        for ref in manifest['references']:
            page = page.replace(f'href="references/{ref["id"]}.wav" download>下载原生 WAV', f'href="references/{ref["id"]}.wav" download>下载参考原始 WAV')
    path = OUTPUT / "index.html"
    with path.open("w" if overwrite else "x", encoding="utf-8", newline="\n") as stream:
        stream.write(page)
    for local in re.findall(r'(?:src|href)="([^"]+)"', page):
        if not (OUTPUT / local).is_file():
            raise ValueError(f"Missing local page asset: {local}")
    return info(path)


def align_references(receipt, manifest):
    if receipt.get('reference_listening'):
        raise FileExistsError('Reference listening copies already recorded')
    target_dir = OUTPUT / 'reference-listen'
    target_dir.mkdir(exist_ok=False)
    rows = []
    for ref in manifest['references']:
        source = OUTPUT / 'references' / (ref['id'] + '.wav')
        original = next(row for row in receipt['references'] if row['id'] == ref['id'])
        if digest(source) != original['target']['sha256']:
            raise ValueError('Original reference copy hash changed')
        target = target_dir / (ref['id'] + '.wav')
        before = measure(source)
        input_i = float(before['measurement']['input_i'])
        input_tp = float(before['measurement']['input_tp'])
        gain = min(-23 - input_i, -1 - input_tp)
        conversion = execute([str(FFMPEG), '-hide_banner', '-nostdin', '-n', '-i', str(source),
                              '-map', '0:a:0', '-af', f'volume={gain:.8f}dB', '-c:a', 'pcm_s16le', str(target)])
        after = measure(target)
        before_metrics, after_metrics = metrics(source), metrics(target)
        for key in ('frames', 'channels', 'sample_rate'):
            if before_metrics[key] != after_metrics[key]:
                raise ValueError(f'Reference alignment changed {key}')
        if float(after['measurement']['input_tp']) > -.9 or after_metrics['clipped_samples']:
            raise ValueError('Reference listening peak validation failed')
        row = {'reference_id': ref['id'], 'source': info(source), 'listen': info(target),
               'gain_db': round(gain, 8), 'target_integrated_lufs': -23, 'target_true_peak_dbtp': -1,
               'input_integrated_lufs': input_i, 'input_true_peak_dbtp': input_tp,
               'output_integrated_lufs': float(after['measurement']['input_i']),
               'output_true_peak_dbtp': float(after['measurement']['input_tp']),
               'peak_limited': -1-input_tp < -23-input_i,
               'source_metrics': before_metrics, 'listen_metrics': after_metrics,
               'measure_before': before, 'conversion': conversion, 'measure_after': after}
        rows.append(row)
        print(json.dumps({'event': 'reference_aligned', 'reference': ref['id'],
                          'gain_db': gain, 'lufs': row['output_integrated_lufs'],
                          'true_peak_dbtp': row['output_true_peak_dbtp']}), flush=True)
    receipt['reference_listening'] = rows
    return rows


def extend_existing():
    receipt = json.loads(RECEIPT.read_text(encoding='utf-8-sig'))
    if receipt.get('status') != 'complete' or Path(receipt['output_root']).resolve() != OUTPUT.resolve():
        raise ValueError('Existing completed package does not match output root')
    manifest = json.loads((QA / 'manifest.json').read_text(encoding='utf-8-sig'))
    if digest(QA / 'manifest.json') != receipt['manifest']['sha256']:
        raise ValueError('Manifest changed since packaging')
    before_audio = {row['listen']['path']: row['listen']['sha256'] for row in receipt['audio']}
    before_audio.update({row['raw']['path']: row['raw']['sha256'] for row in receipt['audio']})
    for path, expected in before_audio.items():
        if digest(path) != expected:
            raise ValueError('Previously packaged Chinese WAV hash changed')
    old_page = (OUTPUT / 'index.html').read_text(encoding='utf-8')
    old_page_info = info(OUTPUT / 'index.html')
    rows = align_references(receipt, manifest)
    page = write_page(manifest, receipt['references'], receipt['audio'], rows, overwrite=True)
    for path, expected in before_audio.items():
        if digest(path) != expected:
            raise ValueError('Chinese WAV was modified during reference alignment')
    receipt.setdefault('updates', []).append({
        'at': datetime.now(timezone.utc).isoformat(), 'action': 'add_static_gain_reference_listening',
        'script': info(Path(__file__)), 'previous_page': old_page_info,
        'previous_page_html': old_page, 'current_page': page,
        'verification': {'all_eight_existing_chinese_wav_hashes_unchanged': True,
                         'reference_frames_channels_rates_unchanged': True,
                         'all_page_local_links_exist': True}})
    original_script = receipt['script']
    if Path(original_script['path']).resolve() != Path(__file__).resolve():
        receipt['script_relocation'] = {
            'at': datetime.now(timezone.utc).isoformat(),
            'original_execution_script': original_script,
            'current_reusable_script': info(Path(__file__)),
            'reason': 'Packaging source moved from batch QA into project tools per user directory rules',
            'changes_after_move': 'Added CLI paths and additive reference-only loudness packaging; original four Chinese WAV files were not regenerated',
            'original_script_field_preserved_as_historical_execution_identity': True}
    receipt['current_page'] = page
    with RECEIPT.open('w', encoding='utf-8', newline='\n') as stream:
        json.dump(receipt, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write('\n')
    print(json.dumps({'event': 'reference_extension_complete', 'page': page['path'], 'receipt': str(RECEIPT)}), flush=True)


def package_new():
    if RECEIPT.exists() or OUTPUT.exists():
        raise FileExistsError("Existing package or receipt will not be overwritten")
    if not FFMPEG.is_file():
        raise FileNotFoundError(FFMPEG)
    manifest_path = QA / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    receipt = {"version": 1, "created_at": datetime.now(timezone.utc).isoformat(),
               "status": "running", "output_root": str(OUTPUT), "manifest": info(manifest_path),
               "script": info(Path(__file__)), "ffmpeg": info(FFMPEG), "references": [], "audio": [],
               "recipe": "Measure loudnorm I=-23 TP=-1 LRA=11; apply volume=min(-23-input_i,-1-input_tp) dB only; PCM16 output; raw and references byte-identical copies",
               "models_invoked": False, "subjective_listening_performed": False}
    OUTPUT.mkdir(parents=True, exist_ok=False)
    for child in ("raw", "listen", "references"):
        (OUTPUT / child).mkdir()
    try:
        for ref in manifest["references"]:
            source = Path(ref["path"])
            target = OUTPUT / "references" / (ref["id"] + ".wav")
            copy_verified(source, target)
            receipt["references"].append({"id": ref["id"], "name": ref["name"],
                                          "source": info(source), "target": info(target), "metrics": metrics(target)})
            for text in manifest["texts"]:
                candidates = sorted((QA / "audio" / ref["id"] / text["id"]).glob("take-*/receipt.json"))
                successful = [(path, json.loads(path.read_text(encoding="utf-8-sig"))) for path in candidates]
                successful = [(path, row) for path, row in successful if row.get("status") == "complete"]
                if not successful:
                    raise ValueError(f"No completed take: {ref['id']}/{text['id']}")
                generation_path, generation = successful[-1]
                source = Path(generation["output"]["path"])
                if digest(source) != generation["output"]["sha256"]:
                    raise ValueError(f"Generated audio changed: {source}")
                if generation["request"]["text"]["text"] != text["text"]:
                    raise ValueError("Manifest text differs from generated take")
                stem = ref["id"] + "-" + text["id"] + ".wav"
                raw, listen = OUTPUT / "raw" / stem, OUTPUT / "listen" / stem
                copy_verified(source, raw)
                before = measure(raw)
                input_i, input_tp = float(before["measurement"]["input_i"]), float(before["measurement"]["input_tp"])
                gain = min(-23 - input_i, -1 - input_tp)
                conversion = execute([str(FFMPEG), "-hide_banner", "-nostdin", "-n", "-i", str(raw),
                                      "-map", "0:a:0", "-af", f"volume={gain:.8f}dB", "-c:a", "pcm_s16le", str(listen)])
                after = measure(listen)
                raw_metrics, listen_metrics = metrics(raw), metrics(listen)
                for key in ("frames", "channels", "sample_rate"):
                    if raw_metrics[key] != listen_metrics[key]:
                        raise ValueError(f"Static gain changed {key}: {listen}")
                if float(after["measurement"]["input_tp"]) > -.9 or listen_metrics["clipped_samples"]:
                    raise ValueError(f"Listen copy exceeds peak validation: {listen}")
                row = {"reference_id": ref["id"], "text_id": text["id"], "text": text["text"],
                       "generation_receipt": info(generation_path), "source": info(source),
                       "raw": info(raw), "listen": info(listen), "gain_db": round(gain, 8),
                       "target_integrated_lufs": -23, "target_true_peak_dbtp": -1,
                       "peak_limited": -1-input_tp < -23-input_i,
                       "input_integrated_lufs": input_i, "input_true_peak_dbtp": input_tp,
                       "output_integrated_lufs": float(after["measurement"]["input_i"]),
                       "output_true_peak_dbtp": float(after["measurement"]["input_tp"]),
                       "raw_metrics": raw_metrics, "listen_metrics": listen_metrics,
                       "measure_before": before, "conversion": conversion, "measure_after": after}
                receipt["audio"].append(row)
                print(json.dumps({"event": "packaged", "reference": ref["id"], "text": text["id"],
                                  "gain_db": row["gain_db"], "lufs": row["output_integrated_lufs"],
                                  "true_peak_dbtp": row["output_true_peak_dbtp"]}), flush=True)
        reference_rows = align_references(receipt, manifest)
        receipt["page"] = write_page(manifest, receipt["references"], receipt["audio"], reference_rows)
        receipt["status"] = "complete"
    except BaseException as error:
        receipt["status"] = "failed"
        receipt["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        receipt["finished_at"] = datetime.now(timezone.utc).isoformat()
        with RECEIPT.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(receipt, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
    print(json.dumps({"event": "complete", "output_root": str(OUTPUT), "receipt": str(RECEIPT)}), flush=True)


def main():
    global QA, OUTPUT, FFMPEG, RECEIPT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--qa-root', type=Path, default=QA)
    parser.add_argument('--output-root', type=Path, default=OUTPUT)
    parser.add_argument('--ffmpeg', type=Path, default=FFMPEG)
    parser.add_argument('--add-reference-listening', action='store_true',
                        help='Add aligned reference copies to an existing completed package; preserve all Chinese WAVs')
    args = parser.parse_args()
    QA, OUTPUT, FFMPEG = args.qa_root.resolve(), args.output_root.resolve(), args.ffmpeg.resolve()
    RECEIPT = QA / 'package_receipt.json'
    if args.add_reference_listening:
        extend_existing()
    else:
        package_new()


if __name__ == '__main__':
    main()
