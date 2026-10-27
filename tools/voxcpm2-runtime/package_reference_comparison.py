"""CPU-only round-two listening package; generated audio comes from verified receipts.

prepare copies the full-quality references and comparison files without changing
the existing page. finalize publishes only successful verified native WAVs.
"""
from __future__ import annotations

from array import array
import argparse
from datetime import datetime, timezone
import hashlib
import html
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import shutil
import struct
import subprocess
from urllib.parse import unquote, urlparse

QA = Path('I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27')
OUTPUT = Path('I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192')
FFMPEG = Path('D:/CodexWorkplace/asmr_director_runtime/engines/gpt-sovits/env-comfyui-clone/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe')
ROLES = [
    {'id': 'yukinoshita', 'name': '雪之下', 'label': '160',
     'source': QA / 'yukinoshita-diagnosis/quality-preserving/02_source_preview_44100_stereo_pcm24_safe.wav',
     'reference_prefix': 'yukinoshita-', 'expected_reference_seconds': 6.85,
     'origin': Path('H:/comfyui/output/sd2素材/干音/1163516765-1-160.mp4')},
    {'id': 'yuigahama', 'name': '由比滨', 'label': '新 MP3',
     'source': QA / 'yui-mp3-original-44100-stereo.wav',
     'reference_prefix': 'yuigahama-', 'expected_reference_seconds': 12.64325,
     'origin': Path('H:/comfyui/output/sd2素材/干音/由比滨.MP3')},
]


def now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def info(path):
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest(path)}


def write_json(path, value):
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    temporary.replace(path)


def copy_verified(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if digest(source) != digest(destination):
            raise ValueError(f'Existing file differs; refusing to overwrite: {destination}')
    else:
        shutil.copyfile(source, destination)
    if digest(source) != digest(destination):
        raise ValueError(f'Copy mismatch: {destination}')
    return info(destination)


def execute(args, commands):
    command = [str(FFMPEG), '-nostdin', '-hide_banner', *args]
    result = subprocess.run(command, capture_output=True, timeout=120,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    record = {'command': command, 'exit_code': result.returncode,
              'stderr': result.stderr.decode('utf-8', 'replace')}
    commands.append(record)
    if result.returncode:
        raise RuntimeError(record['stderr'])
    return result


def wav_format(path):
    with path.open('rb') as stream:
        header = stream.read(12)
        if header[:4] != b'RIFF' or header[8:] != b'WAVE':
            raise ValueError(f'Not RIFF WAV: {path}')
        fmt = None
        frames = None
        while block := stream.read(8):
            tag, size = struct.unpack('<4sI', block)
            if tag == b'fmt ':
                data = stream.read(size)
                format_id, channels, rate, _, block_align, bits = struct.unpack('<HHIIHH', data[:16])
                fmt = {'format': format_id, 'channels': channels, 'sample_rate': rate,
                       'sample_width_bytes': bits // 8, 'block_align': block_align}
            elif tag == b'data':
                if fmt is None or size % fmt['block_align']:
                    raise ValueError(f'Invalid PCM frames: {path}')
                frames = size // fmt['block_align']
                stream.seek(size, 1)
            else:
                stream.seek(size, 1)
            if size % 2:
                stream.seek(1, 1)
        if fmt is None or not frames:
            raise ValueError(f'No PCM data: {path}')
        return dict(fmt, frames=frames, duration_seconds=frames / fmt['sample_rate'])


def metrics(path, commands):
    fmt = wav_format(path)
    decoded = execute(['-loglevel', 'error', '-i', str(path), '-map', '0:a:0',
                       '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], commands)
    values = array('f', decoded.stdout)
    if len(values) != fmt['frames'] * fmt['channels']:
        raise ValueError(f'Decoded sample count mismatch: {path}')
    peak = max(abs(v) for v in values)
    rms = math.sqrt(sum(v * v for v in values) / len(values))
    return dict(fmt, peak=peak, peak_dbfs=20 * math.log10(peak) if peak else None,
                rms_dbfs=20 * math.log10(rms) if rms else None,
                full_scale_samples=sum(abs(v) >= 1 for v in values))


def loudness(path, commands):
    result = execute(['-i', str(path), '-map', '0:a:0', '-af',
                      'loudnorm=I=-23:TP=-1:LRA=7:print_format=json', '-f', 'null', 'NUL'], commands)
    matches = re.findall(r'\{[^{}]*"input_i"[^{}]*\}', result.stderr.decode('utf-8', 'replace'), re.S)
    if not matches:
        raise ValueError('Missing loudness measurement')
    result = json.loads(matches[-1])
    if not all(math.isfinite(float(result[key])) for key in ('input_i', 'input_tp')):
        raise ValueError(f'Cannot align silent audio: {path}')
    return {'integrated_lufs': float(result['input_i']), 'true_peak_dbtp': float(result['input_tp'])}


def render_gain(source, destination, gain, codec, commands):
    if destination.exists():
        raise FileExistsError(destination)
    execute(['-loglevel', 'error', '-i', str(source), '-map', '0:a:0', '-af',
             f'volume={gain:.8f}dB', '-c:a', codec, '-n', str(destination)], commands)
    before, after = wav_format(source), wav_format(destination)
    for key in ('frames', 'channels', 'sample_rate'):
        if before[key] != after[key]:
            raise ValueError(f'Static gain changed {key}: {destination}')


def prepare():
    existing = QA / 'round2-preparation.json'
    if existing.exists():
        receipt = read_json(existing)
        for item in receipt['files']:
            if digest(Path(item['path'])) != item['sha256']:
                raise ValueError(f'Prepared file changed: {item["path"]}')
        for role in ROLES:
            prepared = next(row for row in receipt['references'] if row['id'] == role['id'])
            if abs(wav_format(Path(prepared['original']['path']))['duration_seconds'] - role['expected_reference_seconds']) > 0.001:
                raise ValueError(f'Full reference duration changed: {role["id"]}')
            if digest(role['source']) != prepared['source']['sha256']:
                raise ValueError(f'Original-quality reference changed: {role["id"]}')
        receipt['reference_scope'] = 'Yuigahama uses the complete new MP3 (12.64325 seconds); no selected interval.'
        receipt['validated_at'] = now()
        write_json(existing, receipt)
        return receipt
    commands = []
    root = OUTPUT / 'round2'
    for name in ('references', 'reference-listen', 'reference-quality', 'raw', 'listen'):
        (root / name).mkdir(parents=True, exist_ok=True)
    backup = QA / 'index-before-round2.html'
    copy_verified(OUTPUT / 'index.html', backup)
    protected = [info(p) for p in OUTPUT.rglob('*') if p.is_file() and root not in p.parents]
    sources = [info(role['origin']) for role in ROLES]
    references = []
    for role in ROLES:
        src = role['source']
        fmt = wav_format(src)
        if fmt['sample_rate'] != 44100 or fmt['channels'] != 2:
            raise ValueError(f'Expected original-quality stereo: {src}')
        if abs(fmt['duration_seconds'] - role['expected_reference_seconds']) > 0.001:
            raise ValueError(f'Expected complete reference: {src}')
        measured = loudness(src, commands)
        original = root / 'references' / (role['id'] + '-original.wav')
        # The default reference preserves the source level, apart from needed peak headroom.
        safety_gain = min(0.0, -1 - measured['true_peak_dbtp'])
        if safety_gain < -0.001:
            render_gain(src, original, safety_gain, 'pcm_s24le', commands)
        else:
            copy_verified(src, original)
        original_metrics = metrics(original, commands)
        if original_metrics['full_scale_samples']:
            raise ValueError('Original-quality preview clips')
        original_loudness = loudness(original, commands)
        matched = root / 'reference-listen' / (role['id'] + '-matched.wav')
        gain = min(-23 - original_loudness['integrated_lufs'], -1 - original_loudness['true_peak_dbtp'])
        render_gain(original, matched, gain, 'pcm_s24le', commands)
        references.append({'id': role['id'], 'source': info(src), 'original': info(original),
                           'original_metrics': original_metrics, 'original_loudness': original_loudness,
                           'safety_gain_db': safety_gain, 'matched': info(matched),
                           'matched_gain_db': gain, 'matched_loudness': loudness(matched, commands),
                           'matched_metrics': metrics(matched, commands)})
    diagnosis = QA / 'yukinoshita-diagnosis/matched-final'
    quality = []
    for source_name, output_name, label in [
        ('01_01_source_original_44100_stereo_float.wav', 'yukinoshita-original-44100.wav', '原片 44.1 kHz'),
        ('03_old_reference_16000.wav', 'yukinoshita-old-16000.wav', '上一轮 16 kHz 参考'),
    ]:
        target = root / 'reference-quality' / output_name
        copy_verified(diagnosis / source_name, target)
        quality.append({'label': label, 'file': info(target), 'metrics': metrics(target, commands),
                        'loudness': loudness(target, commands)})
    receipt = {'status': 'references_prepared_page_unchanged', 'at': now(), 'references': references,
               'quality_comparison': quality, 'original_sources': sources, 'protected_previous_files': protected,
               'old_html_backup': info(backup), 'commands': commands,
               'files': [info(p) for p in root.rglob('*') if p.is_file()]}
    write_json(existing, receipt)
    return receipt


def relative(path):
    return str(Path(path).relative_to(OUTPUT)).replace('\\', '/')


def player(title, source, seconds, download=None, download_label='下载 WAV', note=None):
    note_html = f'<p class="listening-note">{html.escape(note)}</p>' if note else ''
    return (f'<article class="player"><div class="player-top"><h3>{html.escape(title)}</h3>'
            f'<span>{seconds:.2f} 秒</span></div><audio controls preload="metadata" src="{html.escape(source)}"></audio>'
            f'{note_html}<a class="download" href="{html.escape(download or source)}" download>{html.escape(download_label)}</a></article>')


def role_reference_ids(manifest, role):
    """Match current role/mode IDs, and never package an obsolete shortened MP3 run."""
    ids = []
    for mode in ('reference_only', 'combined'):
        matches = [row for row in manifest['references']
                   if row['id'].startswith(role['reference_prefix']) and row.get('mode', 'reference_only') == mode]
        if len(matches) != 1:
            raise ValueError(f'Expected exactly one {role["id"]} / {mode} reference')
        ref = matches[0]
        duration = wav_format(Path(ref['path']))['duration_seconds']
        if abs(duration - role['expected_reference_seconds']) > 0.001:
            raise ValueError(f'Reference must use the full approved audio, not a selected interval: {ref["id"]}')
        ids.append(ref['id'])
    return ids


def build_html(preparation, manifest, generated):
    ref_lookup = {r['id']: r for r in preparation['references']}
    gen_lookup = {r['id']: r for r in generated}
    columns = []
    for role in ROLES:
        ref = ref_lookup[role['id']]
        original = player('原声参考', relative(ref['original']['path']), ref['original_metrics']['duration_seconds'],
                          download_label='下载原品质参考')
        aligned = player('等音量参考', relative(ref['matched']['path']), ref['matched_metrics']['duration_seconds'])
        rows = []
        for ref_id, title in zip(role_reference_ids(manifest, role), ['仅音频', '音频＋日语原文']):
            row = gen_lookup.get(ref_id)
            if row and row['status'] == 'complete':
                rows.append(player(title, relative(row['listen']['path']), row['metrics']['duration_seconds'],
                                   relative(row['raw']['path']), '下载原生 WAV', row.get('listening_note')))
            else:
                rows.append(f'<article class="player unavailable"><h3>{title}</h3><p>本次未完成</p></article>')
        columns.append(f'<section class="role"><div class="role-heading"><span>{role["label"]}</span><h2>{role["name"]}</h2></div>'
                       f'{original}<details class="reference-option"><summary>等音量参考</summary>{aligned}</details>'
                       '<h3 class="group-title">中文试听</h3>' + ''.join(rows) + '</section>')
    quality = ''.join(player(row['label'], relative(row['file']['path']), row['metrics']['duration_seconds'])
                      for row in preparation['quality_comparison'])
    old = []
    for role_id, name in [('yukinoshita-160', '雪之下'), ('yuigahama-192', '由比滨')]:
        for kind, title in [('short', '短句'), ('paragraph', '长段')]:
            path = OUTPUT / 'listen' / f'{role_id}-{kind}.wav'
            old.append(player(f'{name} · {title}', relative(path), wav_format(path)['duration_seconds'],
                              f'raw/{role_id}-{kind}.wav', '下载旧版原生 WAV'))
    text = html.escape(manifest['texts'][0]['text'])
    page = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>第二轮中文试听 · 雪之下 / 由比滨</title><style>
:root{color-scheme:light;--ink:#24332e;--muted:#647268;--line:#d5dfd5;--accent:#356c51;--paper:#f2f5ef}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1120px;margin:auto;padding:50px 28px}header{padding-bottom:26px;border-bottom:1px solid var(--line)}.eyebrow{font-size:12px;letter-spacing:.12em;font-weight:650;color:var(--accent)}h1{font-size:clamp(28px,5vw,42px);line-height:1.3;margin:10px 0 12px;letter-spacing:-.03em}header p{margin:0;color:var(--muted);max-width:800px}.transcript{font-size:17px;border-left:3px solid #8bad91;padding:8px 0 8px 18px;margin:26px 0}.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}.role-heading{display:flex;align-items:baseline;gap:12px;margin-bottom:14px}.role-heading span{font-size:12px;color:var(--accent);font-weight:650;order:2}h2{margin:0;font-size:26px}.group-title{margin:28px 0 12px;font-size:15px;color:var(--muted)}.player{min-width:0;background:white;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:12px}.player-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.player h3{font-size:16px;line-height:1.4;margin:0 0 14px}.player-top span{font-size:12px;color:var(--muted);white-space:nowrap}audio{width:100%;display:block;height:42px}.download{display:inline-block;margin-top:12px;font-size:12px;color:var(--accent);text-underline-offset:3px}.reference-option{margin-top:-2px;font-size:13px;color:var(--muted)}.reference-option .player{margin-top:12px}.unavailable{background:#edf1eb}.unavailable p{font-size:14px;color:var(--muted);margin:4px 0}.fold{margin-top:30px;padding-top:22px;border-top:1px solid var(--line)}summary{cursor:pointer;font-weight:600}summary:focus-visible,a:focus-visible,audio:focus-visible{outline:3px solid #619b78;outline-offset:4px}.fold>p{font-size:14px;color:var(--muted);max-width:850px}.fold .two{margin-top:18px}.feedback{padding:10px 14px;background:#e8eee5;border-radius:8px}footer{margin-top:30px;padding-top:18px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}@media(max-width:680px){main{padding:28px 16px}.two{grid-template-columns:1fr;gap:24px}.player{padding:17px}.role+.role{padding-top:10px}h2{font-size:24px}}
</style></head><body><main><header><div class="eyebrow">VoxCPM2 · 2026.10.27 · 第二轮</div><h1>日语原声 → 中文试听</h1><p>同一句中文，两种参考方式。上方保留原品质日语参考，中文试听对齐音量，方便轮流比较。</p></header>'''+f'<p class="transcript">{text}</p><div class="two">'+''.join(columns)+'''</div><details class="fold"><summary>雪之下参考音质对比</summary><p>以下两条音量相同。旧 16 kHz 参考重新采样为 44.1 kHz 播放，已丢失的高频不会因此恢复。</p><div class="two">'''+quality+'''</div></details><details class="fold"><summary>上一轮试听</summary><p class="feedback">上一轮用户反馈：雪之下、由比滨的中文音色均不像。</p><div class="two">'''+''.join(old)+'''</div></details><footer>中文试听和可选等音量参考仅调整整条固定音量，原生文件保留下载。</footer></main><script>document.addEventListener('play',function(event){if(event.target.tagName==='AUDIO'){document.querySelectorAll('audio').forEach(function(audio){if(audio!==event.target)audio.pause();});}},true);</script></body></html>'''
    page = page.replace('</style>', '.listening-note{margin:12px 0 0;font-size:13px;color:#785d33}</style>')
    if not any(row['status'] == 'complete' for row in generated):
        page = page.replace('第二轮中文试听 · 雪之下 / 由比滨', '参考音频已更新 · 雪之下 / 由比滨')
        page = page.replace('VoxCPM2 · 2026.10.27 · 第二轮', 'VoxCPM2 · 2026.10.27 · 参考更新')
        page = page.replace('<h1>日语原声 → 中文试听</h1>', '<h1>参考音频已更新</h1>')
        page = page.replace('同一句中文，两种参考方式。上方保留原品质日语参考，中文试听对齐音量，方便轮流比较。',
                            '雪之下原品质预览与由比滨完整新干音已备好。本轮中文音频尚未生成。')
        page = page.replace('<h3 class="group-title">中文试听</h3>', '<h3 class="group-title">中文生成状态</h3>')
        page = page.replace('中文试听和可选等音量参考仅调整整条固定音量，原生文件保留下载。',
                            '可选等音量参考仅调整整条固定音量，原品质参考保留下载。')
    return page


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.audio = []
    def handle_starttag(self, tag, attrs):
        row = dict(attrs)
        for attribute in ('src', 'href'):
            if attribute in row:
                self.links.append(row[attribute])
        if tag == 'audio':
            self.audio.append(row['src'])


def verify_page(source):
    parser = LinkParser()
    parser.feed(source)
    items = []
    for link in sorted(set(parser.links)):
        parsed = urlparse(link)
        if parsed.scheme or parsed.netloc:
            raise ValueError(f'Unexpected remote link: {link}')
        path = (OUTPUT / unquote(parsed.path)).resolve(strict=True)
        if OUTPUT.resolve() not in path.parents or not path.is_file():
            raise ValueError(f'Link leaves package: {link}')
        items.append(info(path))
    return {'links': items, 'audio_count': len(parser.audio), 'single_player_handler_present': "document.addEventListener('play'" in source}


def validate_publish_base(page, initial_index, previous_receipt=None):
    """Accept only the original page or the exact page from the last completed publication."""
    page = page.resolve(strict=True)
    if Path(initial_index['path']).resolve() != page:
        raise ValueError('Initial page identity points elsewhere')
    allowed = {initial_index['sha256']: 'initial_backup'}
    if previous_receipt and previous_receipt.get('status') in ('complete', 'partial_generation_page_complete'):
        previous_index = previous_receipt.get('index', {})
        if Path(previous_index.get('path', '')).resolve() == page:
            recorded_sha = previous_index.get('sha256', '')
            if re.fullmatch(r'[0-9a-fA-F]{64}', recorded_sha):
                allowed[recorded_sha.lower()] = 'previous_verified_publication'
    current = info(page)
    if current['sha256'] not in allowed:
        raise ValueError('Existing index is neither the initial page nor the last verified publication; refusing to overwrite edits')
    return dict(current, accepted_as=allowed[current['sha256']])


def verify_reusable_listen(previous, source, raw, listen, gain):
    """Reuse a prior matched file only when both its provenance and bytes still match."""
    if not previous or previous.get('status') != 'complete':
        raise ValueError(f'Existing listen file has no completed publication receipt: {listen}')
    for key, actual in (('source', source), ('raw', raw), ('listen', listen)):
        recorded = previous.get(key, {})
        if Path(recorded.get('path', '')).resolve() != actual.resolve() or digest(actual) != recorded.get('sha256'):
            raise ValueError(f'Previous {key} identity changed: {actual}')
    if abs(previous['gain_db'] - gain) > 1e-8:
        raise ValueError('Matched audio gain changed; refusing to reuse an unrelated result')


def attach_asr_notes(generated):
    """Attach the two reviewed listening notes to the exact ASR input takes."""
    evidence_path = QA / 'generated-asr.json'
    if not evidence_path.exists():
        return None
    evidence = info(evidence_path)
    recognized = read_json(evidence_path)['files']
    reviewed = {
        ('yukinoshita-160-v2-combined', 'take-001'):
            '寒冷就來,休息一下吧,早點進去,慢慢喝,今天的事情可以等明天再說。',
        ('yuigahama-192-mp3-full-combined', 'take-001'):
            '先坐下来休息一会儿吧这还用在满满汉云天的市场开通明天再说',
    }
    for row in generated:
        if row['status'] != 'complete':
            continue
        source = Path(row['source']['path']).resolve()
        expected = reviewed.get((row['id'], source.parent.name))
        if expected is None:
            continue
        matches = [(index, entry) for index, entry in enumerate(recognized)
                   if Path(entry['path']).resolve() == source]
        if len(matches) != 1 or matches[0][1]['text'] != expected:
            raise ValueError(f'Reviewed ASR evidence changed: {row["id"]}')
        row['listening_note'] = '文字识别偏差较大，请重点听中文发音。'
        row['listening_note_source'] = {'asr_file_sha256': evidence['sha256'],
                                        'asr_entry_index': matches[0][0],
                                        'audio_source': row['source'],
                                        'recognized_text': expected}
    if digest(evidence_path) != evidence['sha256']:
        raise ValueError('ASR evidence changed while loading')
    return evidence


def finalize():
    preparation = prepare()
    page = OUTPUT / 'index.html'
    initial_index = next(row for row in preparation['protected_previous_files'] if Path(row['path']).resolve() == page.resolve())
    receipt_path_current = QA / 'round2-package-receipt.json'
    previous_publication = read_json(receipt_path_current) if receipt_path_current.exists() else None
    publication_base = validate_publish_base(page, initial_index, previous_publication)
    previous_generated = {row['id']: row for row in (previous_publication or {}).get('generated', [])}
    manifest = read_json(QA / 'comparison-manifest.json')
    if len(manifest['texts']) != 1 or manifest['texts'][0]['id'] != 'short':
        raise ValueError('Expected one shared short text')
    references = {r['id']: r for r in manifest['references']}
    generated = []
    commands = []
    for role in ROLES:
        for ref_id in role_reference_ids(manifest, role):
            ref = references[ref_id]
            candidates = sorted((QA / 'comparison-generation/audio' / ref_id / 'short').glob('take-*/receipt.json'), reverse=True)
            chosen = None
            for receipt_path in candidates:
                row = read_json(receipt_path)
                if row.get('status') == 'complete':
                    chosen = (receipt_path, row)
                    break
            if chosen is None:
                generated.append({'id': ref_id, 'status': 'not_completed', 'receipts_found': [str(p) for p in candidates]})
                continue
            receipt_path, receipt = chosen
            if receipt['exit_code'] != 0 or receipt['request']['text']['text'] != manifest['texts'][0]['text']:
                raise ValueError(f'Receipt text or exit mismatch: {receipt_path}')
            if receipt['request']['mode'] != ref.get('mode', 'reference_only'):
                raise ValueError('Reference mode mismatch')
            if receipt['request']['reference']['file']['sha256'] != digest(Path(ref['path'])):
                raise ValueError('Reference changed after generation')
            for key in ('output', 'stdout', 'stderr'):
                if digest(Path(receipt[key]['path'])) != receipt[key]['sha256']:
                    raise ValueError(f'Receipt {key} hash mismatch')
            source = Path(receipt['output']['path'])
            source_metrics = metrics(source, commands)
            if source_metrics['sample_rate'] != 48000 or source_metrics['channels'] != 1:
                raise ValueError('Expected 48 kHz mono generation')
            raw = OUTPUT / 'round2/raw' / (ref_id + '.wav')
            copy_verified(source, raw)
            measured = loudness(raw, commands)
            gain = min(-23 - measured['integrated_lufs'], -1 - measured['true_peak_dbtp'])
            listen = OUTPUT / 'round2/listen' / (ref_id + '.wav')
            if listen.exists():
                verify_reusable_listen(previous_generated.get(ref_id), source, raw, listen, gain)
            else:
                render_gain(raw, listen, gain, 'pcm_s16le', commands)
            generated.append({'id': ref_id, 'status': 'complete', 'generation_receipt': info(receipt_path),
                              'source': info(source), 'raw': info(raw), 'listen': info(listen), 'gain_db': gain,
                              'metrics': source_metrics, 'listen_metrics': metrics(listen, commands),
                              'input_loudness': measured, 'output_loudness': loudness(listen, commands)})
    asr_evidence = attach_asr_notes(generated)
    source = build_html(preparation, manifest, generated)
    links = verify_page(source)
    previous_preserved = []
    for item in preparation['protected_previous_files']:
        path = Path(item['path'])
        if path.name == 'index.html':
            continue
        same = digest(path) == item['sha256']
        if not same:
            raise ValueError(f'Previous asset changed: {path}')
        previous_preserved.append(item)
    origins_preserved = all(digest(Path(row['path'])) == row['sha256'] for row in preparation['original_sources'])
    if not origins_preserved:
        raise ValueError('User source changed')
    # A second check also protects an edit made while the audio was being prepared.
    if digest(page) != publication_base['sha256']:
        raise ValueError('Existing index changed during preparation; refusing to overwrite edits')
    if asr_evidence and digest(Path(asr_evidence['path'])) != asr_evidence['sha256']:
        raise ValueError('ASR evidence changed during preparation')
    previous_receipt_archive = None
    if receipt_path_current.exists():
        archive = QA / 'round2-package-history' / (digest(receipt_path_current) + '.json')
        previous_receipt_archive = copy_verified(receipt_path_current, archive)
    previous_page_archive = copy_verified(page, QA / 'round2-package-history' / (publication_base['sha256'] + '.html'))
    temporary = OUTPUT / 'round2/index.pending.html'
    temporary.write_text(source, encoding='utf-8')
    temporary.replace(page)
    complete = sum(row['status'] == 'complete' for row in generated)
    receipt = {'status': 'complete' if complete == 4 else 'partial_generation_page_complete', 'at': now(),
               'new_tts_calls': 0, 'new_asr_calls': 0, 'script': info(Path(__file__)),
               'manifest': info(QA / 'comparison-manifest.json'), 'generated': generated,
               'asr_evidence': asr_evidence,
               'generated_count': complete, 'references': preparation['references'],
               'quality_comparison': preparation['quality_comparison'], 'index': info(page),
               'publication_base': publication_base, 'previous_receipt_archive': previous_receipt_archive,
               'previous_page_archive': previous_page_archive,
               'old_html_backup': preparation['old_html_backup'], 'old_audio_preserved': previous_preserved,
               'user_sources_preserved': origins_preserved, 'link_verification': links,
               'browser_playback_verified': False, 'subjective_listening_performed': False, 'commands': commands}
    write_json(receipt_path_current, receipt)
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['prepare', 'finalize'])
    args = parser.parse_args()
    result = prepare() if args.phase == 'prepare' else finalize()
    print(json.dumps({'status': result['status'], 'generated_count': result.get('generated_count'),
                      'reference_count': len(result['references'])}, ensure_ascii=False))
