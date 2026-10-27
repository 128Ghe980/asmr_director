"""Publish verified Japanese reference-refinement takes after all models stop.

Each manifest reference carries its own seed. Native outputs are copied exactly;
listening files only receive fixed whole-file gain. Old deliveries stay read-only.
"""
from __future__ import annotations

import argparse
import html
import json
import os
from pathlib import Path
from urllib.parse import unquote, urlparse

import package_reference_comparison as common
from package_japanese_listening import verify_static_gain
from package_yukino_length import verify_reference_gain

QA = common.QA / 'reference-refinement'
ROOT = common.OUTPUT
OUTPUT = ROOT / 'japanese/reference-refinement'
MANIFEST = QA / 'manifest.json'
INPUTS = QA / 'packaging-inputs.json'
RECEIPT = QA / 'package-receipt.json'
TEXT_ID = 'japanese-paragraph'
ROLES = ('yuigahama', 'yukinoshita')
ROLE_LABELS = {'yuigahama': '由比滨 · 更换完整参考', 'yukinoshita': '雪之下 · 重音与说话噪感对照'}


def relative(path):
    return Path(os.path.relpath(Path(path).resolve(), OUTPUT.resolve())).as_posix()


def check_file(item):
    path = Path(item['path'])
    if path.stat().st_size != item['bytes'] or common.digest(path) != item['sha256']:
        raise ValueError(f'File identity changed: {path}')
    return path


def prepare_baselines():
    japanese = common.read_json(common.QA / 'japanese-package-receipt.json')
    length = common.read_json(common.QA / 'yukino-length/package-receipt.json')
    result = {}
    for role, package, ref_id, reference_id, label in [
        ('yuigahama', japanese, 'yuigahama-192-mp3-full-combined', 'yuigahama', '原 12.64 秒参考'),
        ('yukinoshita', length, 'yukinoshita-160-25p10s-combined', 'yukinoshita-160-25p10s-combined', '原 25.10 秒参考 · 原版'),
    ]:
        generated = next(x for x in package['generated'] if x['id'] == ref_id)
        reference = next(x for x in package['references'] if x['id'] == reference_id)
        for key in ('generation_receipt', 'raw', 'listen'):
            check_file(generated[key])
        for key in ('original', 'matched'):
            check_file(reference[key])
        request = common.read_json(Path(generated['generation_receipt']['path']))['request']
        result[role] = {'id': ref_id, 'role': role, 'label': label, 'seed': request['seed'],
                        'request': request, 'generated': generated, 'reference': reference,
                        'prompt_text': request['reference']['promptText'], 'baseline': True}
    return result


def prepare_reference(ref, declared, previous, commands):
    declared_source = declared.get('declared_source_preview', declared['preview'])
    declared_path = check_file(declared_source)
    if declared_path.resolve() != Path(ref['sourcePreviewPath']).resolve():
        raise ValueError('Preview mapping differs from the manifest source preview')
    if declared_source['sha256'] != declared['preview']['sha256']:
        raise ValueError('Reusable preview differs from the declared prepared source')
    source = check_file(declared['preview'])
    allowed = (common.QA.resolve() in source.resolve().parents or ROOT.resolve() in source.resolve().parents)
    if not allowed:
        raise ValueError('Preview must come from current QA or a verified old delivery')
    fmt = common.wav_format(source)
    model = Path(ref['path']).resolve(strict=True)
    model_fmt = common.wav_format(model)
    if (fmt['sample_rate'], fmt['channels'], fmt['sample_width_bytes']) != (44100, 2, 3):
        raise ValueError('Expected original-quality PCM24 stereo preview')
    if abs(fmt['duration_seconds'] - model_fmt['duration_seconds']) > .001:
        raise ValueError('Original-quality preview and full model input durations differ')
    if ROOT.resolve() in source.resolve().parents:
        original = source
    else:
        original = OUTPUT / 'references' / f'{ref["id"]}.wav'
        common.copy_verified(source, original)
    measured = common.loudness(original, commands)
    gain = min(-23 - measured['integrated_lufs'], -1 - measured['true_peak_dbtp'])
    matched = (check_file(declared['matched']) if declared.get('matched') else
               OUTPUT / 'reference-listen' / f'{ref["id"]}.wav')
    if declared.get('matched'):
        if abs(gain - declared['matched_gain_db']) > 1e-8 or ROOT.resolve() not in matched.resolve().parents:
            raise ValueError('Existing matched reference gain/location differs')
    elif matched.exists():
        if not previous or abs(previous['matched_gain_db'] - gain) > 1e-8:
            raise ValueError('Unexpected existing reference listening file')
        check_file(previous['matched'])
    else:
        common.render_gain(original, matched, gain, 'pcm_s24le', commands)
    result = {'id': ref['id'], 'source': declared['preview'], 'original': common.info(original),
              'preview_label': declared.get('preview_label', '原声参考'),
              'original_metrics': common.metrics(original, commands), 'matched': common.info(matched),
              'matched_gain_db': gain, 'matched_loudness': common.loudness(matched, commands),
              'static_gain_verification': verify_reference_gain(original, matched, gain, commands)}
    if declared.get('show_model_input', False):
        target = OUTPUT / 'reference-inputs' / f'{ref["id"]}.wav'
        common.copy_verified(model, target)
        result['model_input'] = common.info(target)
        result['model_input_metrics'] = model_fmt
        result['model_input_label'] = declared.get('model_input_label', '实际使用的参考')
    return result


def prepare_generated(receipt_path, ref, manifest, baseline_request, previous, commands):
    receipt = common.read_json(receipt_path)
    request = receipt['request']
    if receipt.get('status') != 'complete' or receipt.get('exit_code') != 0:
        raise ValueError('Cannot publish incomplete generation as audio')
    seed = ref.get('seed', manifest.get('seed'))
    if seed is None or request['seed'] != seed:
        raise ValueError('Generation seed differs from this variant declaration')
    if request['text'] != manifest['texts'][0] or request['text'] != baseline_request['text']:
        raise ValueError('Target text differs from the baseline/manifest')
    for key in ('parameters', 'files', 'profile'):
        if request[key] != baseline_request[key]:
            raise ValueError(f'Generation {key} differs from its role baseline')
    if request['parameters']['cfg'] != manifest['cfg']:
        raise ValueError('CFG differs from manifest')
    if request['mode'] != 'combined' or request['reference']['id'] != ref['id']:
        raise ValueError('Unexpected reference or mode')
    if request['reference']['promptText'] != ref['promptText']:
        raise ValueError('Reference transcript differs from manifest')
    if Path(request['reference']['file']['path']).resolve() != Path(ref['path']).resolve():
        raise ValueError('Model reference path changed')
    check_file(request['reference']['file'])
    for key in ('output', 'stdout', 'stderr'):
        check_file(receipt[key])
    source = Path(receipt['output']['path'])
    raw = OUTPUT / 'raw' / f'{ref["id"]}.wav'
    common.copy_verified(source, raw)
    measured = common.loudness(raw, commands)
    gain = min(-23 - measured['integrated_lufs'], -1 - measured['true_peak_dbtp'])
    listen = OUTPUT / 'listen' / raw.name
    if listen.exists():
        common.verify_reusable_listen(previous, source, raw, listen, gain)
    else:
        common.render_gain(raw, listen, gain, 'pcm_s16le', commands)
    return {'id': ref['id'], 'status': 'complete', 'seed': seed,
            'generation_receipt': common.info(receipt_path), 'source': common.info(source),
            'raw': common.info(raw), 'listen': common.info(listen), 'gain_db': gain,
            'input_loudness': measured, 'output_loudness': common.loudness(listen, commands),
            'metrics': common.metrics(raw, commands), 'listen_metrics': common.metrics(listen, commands),
            'static_gain_verification': verify_static_gain(raw, listen, gain)}


def build_html(text, groups):
    sections = []
    for role in ROLES:
        cards = []
        for row in groups[role]:
            reference, generated = row['reference'], row['generated']
            playable = (common.player('生成日语', relative(generated['listen']['path']),
                                      generated['metrics']['duration_seconds'], relative(generated['raw']['path']),
                                      '下载原生 WAV') if generated['status'] == 'complete' else
                        '<article class="player unavailable"><h3>生成日语</h3><p>本次未完成</p></article>')
            details = common.player(reference.get('preview_label', '原声参考'), relative(reference['original']['path']),
                                    reference['original_metrics']['duration_seconds'], download_label='下载参考音频')
            details += common.player('等音量参考', relative(reference['matched']['path']),
                                     reference['original_metrics']['duration_seconds'])
            if reference.get('model_input'):
                details += common.player(reference['model_input_label'], relative(reference['model_input']['path']),
                                         reference['model_input_metrics']['duration_seconds'])
            details += f'<p class="transcript" lang="ja">{html.escape(row["prompt_text"])}</p>'
            cards.append(f'<article class="variant"><h3 class="variant-title">{html.escape(row["label"])}</h3>'
                         + playable + '<details class="reference-details"><summary>查看参考与原文</summary>'
                         + details + f'<p class="seed">Seed {row["seed"]}</p></details></article>')
        sections.append(f'<section><h2>{ROLE_LABELS[role]}</h2><div class="cards">' + ''.join(cards) + '</div></section>')
    return '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>日语试听 · 参考与发音对照</title>
<style>
:root{color-scheme:light;--ink:#24332e;--muted:#647268;--line:#d5dfd5;--accent:#356c51}
*{box-sizing:border-box}body{margin:0;background:#f2f5ef;color:var(--ink);font:16px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:1160px;margin:auto;padding:36px 26px}a{color:var(--accent);text-underline-offset:3px}nav{font-size:13px;margin-bottom:24px;display:flex;gap:20px;flex-wrap:wrap}
header{padding-bottom:22px;border-bottom:1px solid var(--line)}h1{font-size:clamp(26px,4vw,38px);margin:8px 0 12px}header p{margin:0;color:var(--muted)}
.text{margin:24px 0 30px;padding-left:18px;border-left:3px solid #8bad91}.text p{margin:0}.japanese{font-size:18px}.meaning{margin-top:8px!important;color:var(--muted);font-size:14px}
section{margin:32px 0 40px}h2{font-size:25px;margin:0 0 16px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;align-items:start}.variant{min-width:0;background:#e9efe5;border-radius:16px;padding:18px}.variant-title{font-size:18px;margin:0 0 14px}
.player{background:white;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px;min-width:0}.player-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.player h3{font-size:15px;margin:0 0 12px}.player-top span{font-size:12px;white-space:nowrap;color:var(--muted)}
audio{width:100%;display:block;height:42px}.download{display:inline-block;margin-top:10px;font-size:12px}.reference-details{font-size:13px;color:var(--muted)}.reference-details .player{margin-top:12px}.transcript{line-height:1.9}.seed{font-size:12px}summary{cursor:pointer}
footer{margin-top:30px;color:var(--muted);font-size:12px}.history{margin-top:28px;border-top:1px solid var(--line);padding-top:18px;font-size:14px;color:var(--muted)}summary:focus-visible,a:focus-visible,audio:focus-visible{outline:3px solid #619b78;outline-offset:4px}
@media(max-width:700px){.cards{grid-template-columns:1fr}main{padding:24px 16px}.variant{padding:14px}}
</style></head><body><main><nav><a href="../index.html">两角色日语试听</a><a href="../yukino-length/index.html">雪之下参考长度对照</a></nav>
<header><h1>参考与发音对照</h1><p>由比滨换用新的完整干音；雪之下比较原版与三种调整。</p></header>
''' + f'<div class="text"><p class="japanese" lang="ja">{html.escape(text)}</p>' + \
        '<p class="meaning">中文含义：稍微坐下来休息一下吧。茶还温热，请慢慢喝。今天的事，明天再想也没关系。</p></div>' + \
        ''.join(sections) + '''<details class="history"><summary>上一轮试听反馈</summary><p>雪之下 25 秒参考更像，但重音有异常；三档都有 si / tsh 一类说话噪感。</p></details>
<footer>生成试听版只调整整条固定音量；原生 WAV 可单独下载。</footer></main>
<script>document.addEventListener('play',function(event){if(event.target.tagName==='AUDIO'){document.querySelectorAll('audio').forEach(function(audio){if(audio!==event.target)audio.pause();});}},true);</script></body></html>'''


def finalize():
    manifest_identity, inputs_identity = common.info(MANIFEST), common.info(INPUTS)
    manifest, inputs = common.read_json(MANIFEST), common.read_json(INPUTS)
    if len(manifest['references']) != 4 or len(manifest['texts']) != 1 or manifest['texts'][0]['id'] != TEXT_ID:
        raise ValueError('Expected four declared variants and one Japanese target')
    declared = {x['id']: x for x in inputs['references']}
    if set(declared) != {x['id'] for x in manifest['references']}:
        raise ValueError('Preview mapping must exactly match the variants')
    baseline = prepare_baselines()
    for role in ROLES:
        if baseline[role]['request']['text'] != manifest['texts'][0]:
            raise ValueError('Target text differs from old role baseline')
    protected = [common.info(p) for p in ROOT.rglob('*') if p.is_file() and OUTPUT not in p.parents]
    existing = common.read_json(RECEIPT) if RECEIPT.exists() else None
    previous_gen = {x['id']: x for x in (existing or {}).get('generated', [])}
    previous_ref = {x['id']: x for x in (existing or {}).get('references', [])}
    page = OUTPUT / 'index.html'
    page_before = common.info(page) if page.exists() else None
    if page_before and (not existing or existing['index'] != page_before):
        raise ValueError('Existing refinement page was edited; refusing to overwrite')
    for folder in ('raw', 'listen', 'references', 'reference-listen', 'reference-inputs'):
        (OUTPUT / folder).mkdir(parents=True, exist_ok=True)
    groups = {role: [baseline[role]] for role in ROLES}
    commands, references, generated_rows = [], [], []
    for ref in manifest['references']:
        declaration = declared[ref['id']]
        role = ref.get('role', declaration.get('role'))
        if role not in ROLES or ref.get('mode') != 'combined':
            raise ValueError('Expected known role and combined mode')
        reference = prepare_reference(ref, declaration, previous_ref.get(ref['id']), commands)
        references.append(reference)
        receipt_path = QA / 'generation/audio' / ref['id'] / TEXT_ID / 'take-001/receipt.json'
        if receipt_path.exists() and common.read_json(receipt_path).get('status') == 'complete':
            generated = prepare_generated(receipt_path, ref, manifest, baseline[role]['request'], previous_gen.get(ref['id']), commands)
        else:
            generated = {'id': ref['id'], 'status': 'not_completed'}
        generated_rows.append(generated)
        label = ref.get('label', declaration.get('label'))
        seed = ref.get('seed', manifest.get('seed'))
        if not label or seed is None:
            raise ValueError('Every variant needs a label and explicit/inherited seed')
        groups[role].append({'id': ref['id'], 'role': role, 'label': label, 'seed': seed,
                             'reference': reference, 'generated': generated, 'prompt_text': ref['promptText'], 'baseline': False})
    source = build_html(manifest['texts'][0]['text'], groups)
    parser = common.LinkParser()
    parser.feed(source)
    links = []
    for link in sorted(set(parser.links)):
        parsed = urlparse(link)
        if parsed.scheme or parsed.netloc:
            raise ValueError('Refinement page should only link to local listening assets')
        path = (OUTPUT / unquote(parsed.path)).resolve(strict=True)
        if ROOT.resolve() not in path.parents or not path.is_file():
            raise ValueError(f'Invalid local link: {link}')
        links.append(common.info(path))
    for item in protected:
        check_file(item)
    for item in (manifest_identity, inputs_identity):
        check_file(item)
    if (common.info(page) if page.exists() else None) != page_before:
        raise ValueError('Page changed during preparation')
    if existing:
        history = QA / 'package-history'
        common.copy_verified(RECEIPT, history / (common.digest(RECEIPT) + '.json'))
        common.copy_verified(page, history / (common.digest(page) + '.html'))
    pending = OUTPUT / 'index.pending.html'
    pending.write_text(source, encoding='utf-8')
    pending.replace(page)
    complete_count = sum(x['status'] == 'complete' for x in generated_rows)
    result = {'status': 'complete' if complete_count == 4 else 'partial_generation_page_complete', 'at': common.now(),
              'script': common.info(Path(__file__)), 'manifest': manifest_identity, 'packaging_inputs': inputs_identity,
              'baselines': baseline, 'generated': generated_rows, 'references': references,
              'new_generated_count': complete_count, 'index': common.info(page), 'links': links,
              'existing_assets_preserved': protected, 'commands': commands,
              'new_model_runs': 0, 'browser_opened': False, 'subjective_listening_performed': False}
    common.write_json(RECEIPT, result)
    verification = {'status': 'published_delivery_verified', 'at': common.now(), 'index': result['index'],
                    'package_receipt': common.info(RECEIPT), 'new_generated_count': complete_count,
                    'local_links_verified': len(links), 'existing_assets_preserved': len(protected),
                    'rows': [{'id': x['id'], 'seed': x['seed'], **x['static_gain_verification']} for x in generated_rows if x['status'] == 'complete'],
                    'new_model_runs': 0, 'browser_opened': False}
    common.write_json(QA / 'delivery-verification.json', verification)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['finalize'])
    parser.parse_args()
    result = finalize()
    print(json.dumps({'status': result['status'], 'new_generated_count': result['new_generated_count'],
                      'index': result['index']}, ensure_ascii=False))
