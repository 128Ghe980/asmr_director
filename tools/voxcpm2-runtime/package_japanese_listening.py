"""Package completed Japanese comparison takes with CPU-only static gain.

Run finalize only after generation has ended. Existing Chinese pages and audio
are read-only; the new delivery is confined to the japanese/ subdirectory.
"""
from __future__ import annotations

import argparse
from array import array
import html
import json
from pathlib import Path
from urllib.parse import unquote, urlparse
import wave

import package_reference_comparison as common

QA = common.QA
ROOT = common.OUTPUT
OUTPUT = ROOT / 'japanese'
MANIFEST = QA / 'japanese-output-manifest.json'
RECEIPT = QA / 'japanese-package-receipt.json'
TEXT_ID = 'japanese-paragraph'
MEANING = '稍微坐下来休息一下吧。茶还温热，请慢慢喝。今天的事，明天再想也没关系。'
OFFICIAL_LINKS = {
    'https://github.com/OpenBMB/VoxCPM/issues/321#issuecomment-4612212263',
    'https://voxcpm.readthedocs.io/en/latest/usage_guide.html#hi-fi-cloning',
    'https://openbmb.cn/docs/en/guides/voxcpm/voxcpm-2#supported-languages-and-dialects',
}


def relative(path):
    path = Path(path).resolve()
    if OUTPUT.resolve() in path.parents:
        return path.relative_to(OUTPUT.resolve()).as_posix()
    return '../' + path.relative_to(ROOT.resolve()).as_posix()


def build_html(manifest, references, generated):
    lookup = {row['id']: row for row in generated}
    sections = []
    for role in common.ROLES:
        ref = next(row for row in references if row['id'] == role['id'])
        original = common.player('原声参考', relative(ref['original']['path']),
                                 ref['original_metrics']['duration_seconds'], download_label='下载原品质参考')
        matched = common.player('等音量参考', relative(ref['matched']['path']),
                                ref['matched_metrics']['duration_seconds'])
        players = []
        for ref_id, title in zip(common.role_reference_ids(manifest, role), ['仅音频', '音频＋日语原文']):
            row = lookup[ref_id]
            if row['status'] == 'complete':
                players.append(common.player(title, relative(row['listen']['path']),
                                              row['metrics']['duration_seconds'],
                                              relative(row['raw']['path']), '下载原生 WAV'))
            else:
                players.append(f'<article class="player unavailable"><h3>{title}</h3><p>本次未完成</p></article>')
        sections.append(f'<section class="role"><h2>{role["name"]}</h2>{original}'
                        f'<details class="reference-option"><summary>等音量参考</summary>{matched}</details>'
                        '<h3 class="group-title">日语试听</h3>' + ''.join(players) + '</section>')
    completed = sum(row['status'] == 'complete' for row in generated)
    title = '日语原声 → 日语试听' if completed else '日语试听待生成'
    intro = ('同一段日文，分别比较仅音频与音频加原文两种方式。先听原声，再切换下方结果。'
             if completed else '原声参考已备好，四组日语音频尚未生成。')
    return '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>日语试听 · 雪之下 / 由比滨</title>
<style>
:root{color-scheme:light;--ink:#24332e;--muted:#647268;--line:#d5dfd5;--accent:#356c51}
*{box-sizing:border-box}body{margin:0;background:#f2f5ef;color:var(--ink);font:16px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:1120px;margin:auto;padding:42px 28px}header{padding-bottom:24px;border-bottom:1px solid var(--line)}
nav a,a{color:var(--accent);text-underline-offset:3px}nav{font-size:13px;margin-bottom:24px}.eyebrow{color:var(--accent);font-size:12px;letter-spacing:.12em}
h1{font-size:clamp(28px,5vw,40px);line-height:1.35;margin:8px 0 12px}header p{margin:0;color:var(--muted)}
.text{margin:25px 0 28px;border-left:3px solid #8bad91;padding:6px 0 6px 18px}.text p{margin:0}.text .japanese{font-size:18px;line-height:1.8}.text .meaning{font-size:14px;color:var(--muted);margin-top:10px}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}h2{font-size:26px;margin:0 0 16px}.group-title{font-size:15px;color:var(--muted);margin:26px 0 12px}
.player{min-width:0;background:white;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:12px}.player-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.player h3{font-size:16px;line-height:1.4;margin:0 0 14px}.player-top span{font-size:12px;color:var(--muted);white-space:nowrap}
audio{width:100%;display:block;height:42px}.download{display:inline-block;margin-top:12px;font-size:12px}.reference-option{font-size:13px;color:var(--muted)}.reference-option .player{margin-top:12px}.unavailable{background:#edf1eb}.unavailable p{margin:4px 0;color:var(--muted);font-size:14px}
details.fold{margin-top:30px;border-top:1px solid var(--line);padding-top:20px}summary{cursor:pointer;font-weight:600}.fold p{font-size:14px;color:var(--muted)}footer{font-size:12px;color:var(--muted);margin-top:28px}
summary:focus-visible,a:focus-visible,audio:focus-visible{outline:3px solid #619b78;outline-offset:4px}
@media(max-width:680px){main{padding:24px 16px}.two{grid-template-columns:1fr;gap:28px}.player{padding:17px}}
</style></head><body><main><nav><a href="../index.html">返回中文试听</a></nav><header>
<div class="eyebrow">VoxCPM2 · 日语对照</div>''' + f'<h1>{title}</h1><p>{intro}</p></header>' + \
        f'<div class="text"><p class="japanese" lang="ja">{html.escape(manifest["texts"][0]["text"])}</p><p class="meaning">中文含义：{MEANING}</p></div>' + \
        '<div class="two">' + ''.join(sections) + '''</div>
<details class="fold"><summary>官方对两种方式的说明</summary>
<p>VoxCPM2 支持直接输入日文，不需要额外语言标签。<a href="https://openbmb.cn/docs/en/guides/voxcpm/voxcpm-2#supported-languages-and-dialects" target="_blank" rel="noopener noreferrer">语言说明</a></p>
<p>加准确原文的高保真方式更强调音色与原声细节；跨语言时也可能带入来源口音。若优先保留目标语言发音，维护者建议普通克隆。<a href="https://voxcpm.readthedocs.io/en/latest/usage_guide.html#hi-fi-cloning" target="_blank" rel="noopener noreferrer">模式说明</a> · <a href="https://github.com/OpenBMB/VoxCPM/issues/321#issuecomment-4612212263" target="_blank" rel="noopener noreferrer">维护者答复</a></p>
</details><footer>试听版仅调整整条固定音量；原生 WAV 可单独下载。</footer>
</main><script>document.addEventListener('play',function(event){if(event.target.tagName==='AUDIO'){document.querySelectorAll('audio').forEach(function(audio){if(audio!==event.target)audio.pause();});}},true);</script></body></html>'''


def verify_page(source):
    parser = common.LinkParser()
    parser.feed(source)
    local = []
    remote = []
    for link in sorted(set(parser.links)):
        parsed = urlparse(link)
        if parsed.scheme or parsed.netloc:
            if link not in OFFICIAL_LINKS:
                raise ValueError(f'Unexpected remote link: {link}')
            remote.append(link)
            continue
        path = (OUTPUT / unquote(parsed.path)).resolve(strict=True)
        if ROOT.resolve() not in path.parents or not path.is_file():
            raise ValueError(f'Link leaves existing listening package: {link}')
        local.append(common.info(path))
    return {'links': local, 'official_links': remote, 'audio_count': len(parser.audio),
            'single_player_handler_present': "document.addEventListener('play'" in source}


def verify_static_gain(raw, listen, gain_db):
    def pcm(path):
        with wave.open(str(path), 'rb') as stream:
            fmt = (stream.getframerate(), stream.getnchannels(), stream.getsampwidth(), stream.getnframes())
            if fmt[:3] != (48000, 1, 2):
                raise ValueError(f'Expected native 48 kHz mono PCM16: {path}')
            return fmt, array('h', stream.readframes(fmt[3]))
    raw_fmt, original = pcm(raw)
    listen_fmt, matched = pcm(listen)
    if raw_fmt != listen_fmt:
        raise ValueError('Static gain changed format or duration')
    ratio = 10 ** (gain_db / 20)
    error = max(abs(y - x * ratio) for x, y in zip(original, matched))
    clipped = sum(value in (-32768, 32767) for value in matched)
    if error > 1.01 or clipped:
        raise ValueError('Static gain sample verification failed')
    return {'max_static_gain_error_pcm16_units': error, 'listen_clipped_samples': clipped,
            'duration_seconds': raw_fmt[3] / raw_fmt[0], 'sample_rate': raw_fmt[0], 'channels': raw_fmt[1]}


def finalize():
    manifest_info = common.info(MANIFEST)
    manifest = common.read_json(MANIFEST)
    if len(manifest['texts']) != 1 or manifest['texts'][0]['id'] != TEXT_ID:
        raise ValueError('Expected one shared Japanese target paragraph')
    references = common.read_json(QA / 'round2-preparation.json')
    for row in references['references']:
        for key in ('original', 'matched'):
            if common.digest(Path(row[key]['path'])) != row[key]['sha256']:
                raise ValueError('Prepared reference changed')
    existing = common.read_json(RECEIPT) if RECEIPT.exists() else None
    previous_generated = {row['id']: row for row in (existing or {}).get('generated', [])}
    page = OUTPUT / 'index.html'
    page_before = common.info(page) if page.exists() else None
    if page_before and (not existing or existing.get('index') != page_before):
        raise ValueError('Existing Japanese page was edited; refusing to overwrite')
    protected = [common.info(path) for path in ROOT.rglob('*') if path.is_file() and OUTPUT not in path.parents]
    for name in ('raw', 'listen'):
        (OUTPUT / name).mkdir(parents=True, exist_ok=True)
    lookup = {row['id']: row for row in manifest['references']}
    generated, commands = [], []
    for role in common.ROLES:
        for ref_id in common.role_reference_ids(manifest, role):
            ref = lookup[ref_id]
            candidates = sorted((QA / 'japanese-generation/audio' / ref_id / TEXT_ID).glob('take-*/receipt.json'), reverse=True)
            complete = [(path, common.read_json(path)) for path in candidates]
            complete = [(path, row) for path, row in complete if row.get('status') == 'complete']
            if not complete:
                generated.append({'id': ref_id, 'status': 'not_completed', 'receipts_found': [str(path) for path in candidates]})
                continue
            receipt_path, receipt = complete[0]
            request = receipt['request']
            if receipt['exit_code'] != 0 or request['text'] != manifest['texts'][0]:
                raise ValueError('Generation text or exit status mismatch')
            if request['mode'] != ref.get('mode', 'reference_only') or request['reference']['id'] != ref_id:
                raise ValueError('Generation reference or mode mismatch')
            if request['seed'] != manifest['seed'] or request['parameters']['cfg'] != manifest['cfg']:
                raise ValueError('Generation settings mismatch')
            if request['reference'].get('promptText') != ref.get('promptText'):
                raise ValueError('Generation transcript mismatch')
            if request['reference']['file']['sha256'] != common.digest(Path(ref['path'])):
                raise ValueError('Generation reference hash changed')
            for key in ('output', 'stdout', 'stderr'):
                if common.digest(Path(receipt[key]['path'])) != receipt[key]['sha256']:
                    raise ValueError(f'Generation {key} hash mismatch')
            source = Path(receipt['output']['path'])
            raw = OUTPUT / 'raw' / (ref_id + '.wav')
            common.copy_verified(source, raw)
            measured = common.loudness(raw, commands)
            gain = min(-23 - measured['integrated_lufs'], -1 - measured['true_peak_dbtp'])
            listen = OUTPUT / 'listen' / (ref_id + '.wav')
            if listen.exists():
                common.verify_reusable_listen(previous_generated.get(ref_id), source, raw, listen, gain)
            else:
                common.render_gain(raw, listen, gain, 'pcm_s16le', commands)
            checked = verify_static_gain(raw, listen, gain)
            generated.append({'id': ref_id, 'status': 'complete', 'generation_receipt': common.info(receipt_path),
                              'source': common.info(source), 'raw': common.info(raw), 'listen': common.info(listen),
                              'gain_db': gain, 'metrics': common.metrics(raw, commands),
                              'listen_metrics': common.metrics(listen, commands), 'static_gain_verification': checked,
                              'input_loudness': measured, 'output_loudness': common.loudness(listen, commands)})
    source = build_html(manifest, references['references'], generated)
    links = verify_page(source)
    for item in protected + references['original_sources']:
        if common.digest(Path(item['path'])) != item['sha256']:
            raise ValueError('Existing asset or original user source changed')
    if common.info(MANIFEST) != manifest_info:
        raise ValueError('Manifest changed while preparing delivery')
    if (common.info(page) if page.exists() else None) != page_before:
        raise ValueError('Japanese page changed while preparing delivery')
    if page_before:
        common.copy_verified(page, QA / 'japanese-package-history' / (page_before['sha256'] + '.html'))
    if RECEIPT.exists():
        common.copy_verified(RECEIPT, QA / 'japanese-package-history' / (common.digest(RECEIPT) + '.json'))
    temporary = OUTPUT / 'index.pending.html'
    temporary.write_text(source, encoding='utf-8')
    temporary.replace(page)
    complete_count = sum(row['status'] == 'complete' for row in generated)
    result = {'status': 'complete' if complete_count == 4 else 'partial_generation_page_complete', 'at': common.now(),
              'script': common.info(Path(__file__)), 'common_helpers': common.info(Path(common.__file__)),
              'manifest': manifest_info, 'generated_count': complete_count, 'generated': generated,
              'references': references['references'], 'index': common.info(page), 'link_verification': links,
              'existing_assets_preserved': protected, 'user_sources_preserved': references['original_sources'],
              'new_tts_calls': 0, 'new_asr_calls': 0, 'browser_opened': False,
              'subjective_listening_performed': False, 'commands': commands}
    common.write_json(RECEIPT, result)
    verification = {'status': 'published_delivery_verified', 'at': common.now(),
                    'index': result['index'], 'package_receipt': common.info(RECEIPT),
                    'generated_count': complete_count, 'local_links_verified': len(links['links']),
                    'existing_assets_preserved': len(protected), 'model_runs': 0, 'browser_opened': False,
                    'rows': [{'id': row['id'], **row['static_gain_verification']} for row in generated if row['status'] == 'complete']}
    common.write_json(QA / 'japanese-delivery-verification.json', verification)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['finalize'])
    parser.parse_args()
    result = finalize()
    print(json.dumps({'status': result['status'], 'generated_count': result['generated_count'],
                      'index': result['index']}, ensure_ascii=False))
