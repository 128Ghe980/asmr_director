"""Package a short/medium/long Yukinoshita Japanese comparison after TTS ends.

No model or browser calls. Existing Japanese/Chinese pages and baseline audio
remain read-only. The two expanded reference previews are declared explicitly
in packaging-inputs.json to avoid guessing their file names.
"""
from __future__ import annotations

import argparse
from array import array
import html
import json
import math
import os
from pathlib import Path
from urllib.parse import unquote, urlparse

import package_reference_comparison as common
from package_japanese_listening import verify_static_gain

QA = common.QA / 'yukino-length'
ROOT = common.OUTPUT
OUTPUT = ROOT / 'japanese/yukino-length'
RECEIPT = QA / 'package-receipt.json'
MANIFEST = QA / 'manifest.json'
INPUTS = QA / 'packaging-inputs.json'
BASELINE_ID = 'yukinoshita-160-v2-combined'
TEXT_ID = 'japanese-paragraph'


def relative(path):
    return Path(os.path.relpath(Path(path).resolve(), OUTPUT.resolve())).as_posix()


def check_file(item):
    actual = common.info(Path(item['path']))
    if actual != item:
        raise ValueError(f'File identity changed: {item["path"]}')
    return Path(item['path'])


def verify_reference_gain(source, matched, gain, commands):
    before, after = common.wav_format(source), common.wav_format(matched)
    if before != after or before['sample_width_bytes'] != 3:
        raise ValueError('Reference gain changed source format/duration')
    values = []
    for path in (source, matched):
        decoded = common.execute(['-loglevel', 'error', '-i', str(path), '-map', '0:a:0',
                                  '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], commands)
        values.append(array('f', decoded.stdout))
    if len(values[0]) != before['frames'] * before['channels'] or len(values[0]) != len(values[1]):
        raise ValueError('Reference sample count changed')
    ratio = 10 ** (gain / 20)
    error = max(abs(b - a * ratio) for a, b in zip(*values)) * (2 ** 23)
    if error > 1.1 or any(abs(x) >= 1 for x in values[1]):
        raise ValueError('Reference is not an unclipped static-gain copy')
    return {'max_static_gain_error_pcm24_units': error, 'full_scale_samples': 0}


def generated_row(receipt_path, expected, baseline_request, commands, previous):
    receipt = common.read_json(receipt_path)
    request = receipt['request']
    if receipt['status'] != 'complete' or receipt['exit_code'] != 0:
        raise ValueError('Cannot package incomplete generation as audio')
    if request['text'] != baseline_request['text'] or request['seed'] != baseline_request['seed']:
        raise ValueError('Target text or seed differs from the short baseline')
    for key in ('parameters', 'files', 'profile'):
        if request[key] != baseline_request[key]:
            raise ValueError(f'Generation {key} differs from the short baseline')
    if request['mode'] != 'combined' or request['reference']['id'] != expected['id']:
        raise ValueError('Expected combined mode and the declared reference')
    if request['reference'].get('promptText') != expected['promptText']:
        raise ValueError('Reference transcript changed')
    if Path(request['reference']['file']['path']).resolve() != Path(expected['path']).resolve():
        raise ValueError('Reference path changed')
    check_file(request['reference']['file'])
    for key in ('output', 'stdout', 'stderr'):
        check_file(receipt[key])
    raw = OUTPUT / 'raw' / f'{expected["id"]}.wav'
    source = Path(receipt['output']['path'])
    common.copy_verified(source, raw)
    loudness = common.loudness(raw, commands)
    gain = min(-23 - loudness['integrated_lufs'], -1 - loudness['true_peak_dbtp'])
    listen = OUTPUT / 'listen' / raw.name
    if listen.exists():
        common.verify_reusable_listen(previous, source, raw, listen, gain)
    else:
        common.render_gain(raw, listen, gain, 'pcm_s16le', commands)
    verification = verify_static_gain(raw, listen, gain)
    return {'id': expected['id'], 'status': 'complete', 'generation_receipt': common.info(receipt_path),
            'source': common.info(source), 'raw': common.info(raw), 'listen': common.info(listen),
            'gain_db': gain, 'metrics': common.metrics(raw, commands),
            'listen_metrics': common.metrics(listen, commands), 'input_loudness': loudness,
            'output_loudness': common.loudness(listen, commands), 'static_gain_verification': verification}


def build_html(text, rows):
    cards = []
    for row in rows:
        ref = row['reference']
        generated = row['generated']
        original = common.player('原声参考', relative(ref['original']['path']), row['seconds'],
                                 download_label='下载原品质参考')
        matched = common.player('等音量参考', relative(ref['matched']['path']), row['seconds'])
        audio = (common.player('音频＋日语原文', relative(generated['listen']['path']),
                               generated['metrics']['duration_seconds'], relative(generated['raw']['path']),
                               '下载原生 WAV') if generated['status'] == 'complete' else
                 '<article class="player"><h3>生成结果</h3><p>本次未完成</p></article>')
        cards.append(f'<section><h2>{row["seconds"]:.2f} 秒参考</h2>{original}'
                     '<details class="reference-option"><summary>等音量参考</summary>' + matched + '</details>'
                     '<details class="reference-option transcript"><summary>参考音频原文</summary>'
                     f'<p lang="ja">{html.escape(row["prompt_text"])}</p></details>'
                     '<h3 class="group-title">生成日语</h3>' + audio + '</section>')
    return '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>雪之下 · 参考长度对照</title>
<style>
:root{color-scheme:light;--ink:#24332e;--muted:#647268;--line:#d5dfd5;--accent:#356c51}
*{box-sizing:border-box}body{margin:0;background:#f2f5ef;color:var(--ink);font:16px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:1280px;margin:auto;padding:36px 26px}a{color:var(--accent);text-underline-offset:3px}nav{font-size:13px;margin-bottom:24px}
header{padding-bottom:24px;border-bottom:1px solid var(--line)}h1{font-size:clamp(26px,4vw,38px);margin:8px 0 12px}header p{margin:0;color:var(--muted)}
.text{margin:24px 0 30px;padding-left:18px;border-left:3px solid #8bad91}.text p{margin:0}.text .japanese{font-size:18px}.text .meaning{margin-top:8px;color:var(--muted);font-size:14px}
.three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}h2{font-size:23px;margin:0 0 16px}.group-title{font-size:15px;color:var(--muted);margin:24px 0 12px}
.player{background:white;border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:12px;min-width:0}.player-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.player h3{font-size:16px;margin:0 0 14px}.player-top span{font-size:12px;white-space:nowrap;color:var(--muted)}
audio{width:100%;display:block;height:42px}.download{display:inline-block;margin-top:10px;font-size:12px}.reference-option{font-size:13px;color:var(--muted)}.reference-option .player{margin-top:12px}.transcript{margin-top:10px}.transcript p{line-height:1.9}summary{cursor:pointer}
footer{margin-top:30px;color:var(--muted);font-size:12px}.history{margin-top:28px;border-top:1px solid var(--line);padding-top:18px;font-size:14px;color:var(--muted)}summary:focus-visible,a:focus-visible,audio:focus-visible{outline:3px solid #619b78;outline-offset:4px}
@media(max-width:900px){.three{grid-template-columns:1fr}main{max-width:700px;padding:24px 16px}}
</style></head><body><main><nav><a href="../index.html">返回两角色日语试听</a></nav>
<header><h1>雪之下 · 增加参考长度</h1><p>同一段日文，同样使用音频＋日语原文，比较三种参考长度。</p></header>
''' + f'<div class="text"><p class="japanese" lang="ja">{html.escape(text)}</p>' + \
        '<p class="meaning">中文含义：稍微坐下来休息一下吧。茶还温热，请慢慢喝。今天的事，明天再想也没关系。</p></div>' + \
        '<div class="three">' + ''.join(cards) + '</div>' + '''
<details class="history"><summary>上一轮试听反馈</summary><p>仅音频不像；音频加原文稍微好一点，但也不算像。本轮继续比较增加参考内容后的听感。</p></details>
<footer>生成试听版仅调整整条固定音量；原生 WAV 可单独下载。</footer></main>
<script>document.addEventListener('play',function(event){if(event.target.tagName==='AUDIO'){document.querySelectorAll('audio').forEach(function(audio){if(audio!==event.target)audio.pause();});}},true);</script></body></html>'''


def finalize():
    manifest_identity, inputs_identity = common.info(MANIFEST), common.info(INPUTS)
    manifest, inputs = common.read_json(MANIFEST), common.read_json(INPUTS)
    if len(manifest['references']) != 2 or len(manifest['texts']) != 1 or manifest['texts'][0]['id'] != TEXT_ID:
        raise ValueError('Expected two longer references and one Japanese target')
    if {x['id'] for x in inputs['references']} != {x['id'] for x in manifest['references']}:
        raise ValueError('Preview mapping must match the manifest references exactly')
    baseline_package = common.read_json(common.QA / 'japanese-package-receipt.json')
    baseline = next(x for x in baseline_package['generated'] if x['id'] == BASELINE_ID)
    baseline_ref = next(x for x in baseline_package['references'] if x['id'] == 'yukinoshita')
    for item in (baseline['generation_receipt'], baseline['raw'], baseline['listen'],
                 baseline_ref['original'], baseline_ref['matched']):
        check_file(item)
    baseline_request = common.read_json(Path(baseline['generation_receipt']['path']))['request']
    if baseline_request['text'] != manifest['texts'][0] or manifest['seed'] != baseline_request['seed'] or manifest['cfg'] != baseline_request['parameters']['cfg']:
        raise ValueError('Manifest text, seed or CFG differs from the 6.85 second baseline')
    protected = [common.info(p) for p in ROOT.rglob('*') if p.is_file() and OUTPUT not in p.parents]
    existing = common.read_json(RECEIPT) if RECEIPT.exists() else None
    page = OUTPUT / 'index.html'
    page_before = common.info(page) if page.exists() else None
    if page_before and (not existing or page_before != existing['index']):
        raise ValueError('Existing comparison page was edited; refusing to overwrite')
    for folder in ('raw', 'listen', 'references', 'reference-listen'):
        (OUTPUT / folder).mkdir(parents=True, exist_ok=True)
    commands, new_generated, new_refs = [], [], []
    rows = [{'id': BASELINE_ID, 'seconds': 6.85, 'reference': baseline_ref, 'generated': baseline,
             'prompt_text': baseline_request['reference']['promptText']}]
    previous_gen = {x['id']: x for x in (existing or {}).get('generated', [])}
    previous_ref = {x['id']: x for x in (existing or {}).get('references', [])}
    declared = {x['id']: x for x in inputs['references']}
    for ref in manifest['references']:
        preview = declared[ref['id']]['preview']
        source = check_file(preview)
        if QA.resolve() not in source.resolve().parents or ref.get('mode') != 'combined':
            raise ValueError('Expected a local experimental reference and combined mode')
        fmt, model_fmt = common.wav_format(source), common.wav_format(Path(ref['path']))
        if (fmt['sample_rate'], fmt['channels'], fmt['sample_width_bytes']) != (44100, 2, 3):
            raise ValueError('Expected original-quality PCM24 stereo preview')
        if abs(fmt['duration_seconds'] - model_fmt['duration_seconds']) > .001:
            raise ValueError('Preview and model reference durations differ')
        original = OUTPUT / 'references' / (ref['id'] + '.wav')
        common.copy_verified(source, original)
        measured = common.loudness(original, commands)
        gain = min(-23 - measured['integrated_lufs'], -1 - measured['true_peak_dbtp'])
        matched = OUTPUT / 'reference-listen' / original.name
        if matched.exists():
            prior = previous_ref.get(ref['id'])
            if not prior or prior['matched_gain_db'] != gain:
                raise ValueError('Unexpected existing matched reference')
            check_file(prior['matched'])
        else:
            common.render_gain(original, matched, gain, 'pcm_s24le', commands)
        reference = {'id': ref['id'], 'source': preview, 'original': common.info(original),
                     'original_metrics': common.metrics(original, commands), 'matched': common.info(matched),
                     'matched_gain_db': gain, 'matched_loudness': common.loudness(matched, commands),
                     'static_gain_verification': verify_reference_gain(original, matched, gain, commands)}
        new_refs.append(reference)
        receipt_path = QA / 'generation/audio' / ref['id'] / TEXT_ID / 'take-001/receipt.json'
        if receipt_path.exists() and common.read_json(receipt_path).get('status') == 'complete':
            generated = generated_row(receipt_path, ref, baseline_request, commands, previous_gen.get(ref['id']))
        else:
            generated = {'id': ref['id'], 'status': 'not_completed'}
        new_generated.append(generated)
        rows.append({'id': ref['id'], 'seconds': fmt['duration_seconds'], 'reference': reference,
                     'generated': generated, 'prompt_text': ref['promptText']})
    source = build_html(manifest['texts'][0]['text'], rows)
    parser = common.LinkParser()
    parser.feed(source)
    links = []
    for link in sorted(set(parser.links)):
        parsed = urlparse(link)
        if parsed.scheme or parsed.netloc:
            raise ValueError(f'Unexpected remote link: {link}')
        path = (OUTPUT / unquote(parsed.path)).resolve(strict=True)
        if ROOT.resolve() not in path.parents or not path.is_file():
            raise ValueError(f'Invalid local link: {link}')
        links.append(common.info(path))
    for item in protected:
        check_file(item)
    for item in (manifest_identity, inputs_identity):
        check_file(item)
    if (common.info(page) if page.exists() else None) != page_before:
        raise ValueError('Comparison page changed during preparation')
    if existing:
        history = QA / 'package-history'
        common.copy_verified(RECEIPT, history / (common.digest(RECEIPT) + '.json'))
        common.copy_verified(page, history / (common.digest(page) + '.html'))
    pending = OUTPUT / 'index.pending.html'
    pending.write_text(source, encoding='utf-8')
    pending.replace(page)
    count = sum(x['status'] == 'complete' for x in new_generated)
    result = {'status': 'complete' if count == 2 else 'partial_generation_page_complete', 'at': common.now(),
              'script': common.info(Path(__file__)), 'manifest': manifest_identity, 'packaging_inputs': inputs_identity,
              'baseline': baseline, 'baseline_reference': baseline_ref, 'generated': new_generated,
              'references': new_refs, 'new_generated_count': count, 'index': common.info(page),
              'links': links, 'existing_assets_preserved': protected, 'commands': commands,
              'model_runs': 0, 'browser_opened': False, 'subjective_listening_performed': False}
    common.write_json(RECEIPT, result)
    verification = {'status': 'published_delivery_verified', 'at': common.now(), 'index': result['index'],
                    'package_receipt': common.info(RECEIPT), 'new_generated_count': count,
                    'local_links_verified': len(links), 'existing_assets_preserved': len(protected),
                    'rows': [{'id': x['id'], **x['static_gain_verification']} for x in new_generated if x['status'] == 'complete'],
                    'model_runs': 0, 'browser_opened': False}
    common.write_json(QA / 'delivery-verification.json', verification)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['finalize'])
    parser.parse_args()
    result = finalize()
    print(json.dumps({'status': result['status'], 'new_generated_count': result['new_generated_count'],
                      'index': result['index']}, ensure_ascii=False))
