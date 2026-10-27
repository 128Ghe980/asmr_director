"""Publish an eight-way parameter comparison without running models or browsers.

Rows declare independent seed/CFG/timestep values. The prior complete Yui base
take is reused by exact receipt and delivered-file identities; seven new takes
are copied verbatim and given only fixed gain for listening.
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

QA = common.QA / 'parameter-sweep'
ROOT = common.OUTPUT
OUTPUT = ROOT / 'japanese/parameter-sweep'
MANIFEST = QA / 'manifest.json'
RECEIPT = QA / 'package-receipt.json'
TEXT_ID = 'japanese-paragraph'
ROLES = ('yukinoshita', 'yuigahama')
ROLE_LABELS = {'yukinoshita': '雪之下', 'yuigahama': '由比滨'}
EXPECTED_SETTINGS = {(2.0, 10), (1.5, 10), (2.5, 10), (2.0, 20)}
EXPECTED_SEEDS = {'yukinoshita': 43, 'yuigahama': 42}
ANCHOR_IDS = {'yukinoshita': 'yukino25-gain-minus6', 'yuigahama': 'yuigahama-25s-full-combined'}


def relative(path):
    return Path(os.path.relpath(Path(path).resolve(), OUTPUT.resolve())).as_posix()


def check_file(item):
    path = Path(item['path'])
    if path.stat().st_size != item['bytes'] or common.digest(path) != item['sha256']:
        raise ValueError(f'File identity changed: {path}')
    return path


def load_anchors():
    package_path = common.QA / 'reference-refinement/package-receipt.json'
    package = common.read_json(package_path)
    anchors = {}
    for role, ref_id in ANCHOR_IDS.items():
        generated = next(x for x in package['generated'] if x['id'] == ref_id)
        reference = next(x for x in package['references'] if x['id'] == ref_id)
        for key in ('generation_receipt', 'source', 'raw', 'listen'):
            check_file(generated[key])
        for key in ('source', 'original', 'matched'):
            check_file(reference[key])
        if reference.get('model_input'):
            check_file(reference['model_input'])
        request = common.read_json(Path(generated['generation_receipt']['path']))['request']
        check_file(request['reference']['file'])
        anchors[role] = {'generated': generated, 'reference': reference, 'request': request}
    return anchors, common.info(package_path)


def validate_catalog(manifest, anchors):
    refs = manifest['references']
    if len(refs) != 8 or len({r['id'] for r in refs}) != 8:
        raise ValueError('Expected eight unique catalog rows')
    if len(manifest['texts']) != 1 or manifest['texts'][0]['id'] != TEXT_ID:
        raise ValueError('Expected one Japanese target paragraph')
    for role in ROLES:
        rows = [r for r in refs if r['role'] == role]
        if len(rows) != 4 or {(float(r['cfg']), r['timesteps']) for r in rows} != EXPECTED_SETTINGS:
            raise ValueError(f'Incorrect four-way parameter set for {role}')
        anchor = anchors[role]['request']
        if manifest['texts'][0] != anchor['text']:
            raise ValueError('Target text differs from previous listening text')
        signatures = set()
        for row in rows:
            if row['seed'] != EXPECTED_SEEDS[role] or row['mode'] != 'combined':
                raise ValueError('Role seed/mode does not match this experiment')
            reference_path = Path(row['path']).resolve(strict=True)
            digest = common.digest(reference_path)
            if digest != anchor['reference']['file']['sha256'] or row['promptText'] != anchor['reference']['promptText']:
                raise ValueError('Role reference or transcript changed')
            preview = Path(row['sourcePreviewPath']).resolve(strict=True)
            if common.digest(preview) != anchors[role]['reference']['source']['sha256']:
                raise ValueError('Source preview changed')
            signatures.add((str(reference_path).lower(), digest, row['promptText'], row['seed']))
        if len(signatures) != 1:
            raise ValueError('The four settings must use one fixed reference/transcript/seed per role')
    if sum(bool(r.get('existingReceiptPath')) for r in refs) != 1:
        raise ValueError('Only the prior Yui baseline is intended for reuse')


def verify_generation(receipt, row, target, anchor, existing=False):
    request = receipt['request']
    if receipt.get('status') != 'complete' or receipt.get('exit_code') != 0:
        raise ValueError('Cannot present an incomplete take as playable')
    if request['text'] != target or request['seed'] != row['seed'] or request['mode'] != row['mode']:
        raise ValueError('Generation text, seed or mode differs from its catalog row')
    expected = dict(anchor['request']['parameters'], cfg=row['cfg'], timesteps=row['timesteps'])
    if request['parameters'] != expected:
        raise ValueError('Generation parameters differ from declared CFG/timesteps and fixed other parameters')
    for key in ('files', 'profile'):
        if request[key] != anchor['request'][key]:
            raise ValueError(f'Generation {key} changed')
    expected_id = anchor['request']['reference']['id'] if existing else row['id']
    if request['reference']['id'] != expected_id or request['reference']['promptText'] != row['promptText']:
        raise ValueError('Generation reference ID or transcript mismatch')
    if Path(request['reference']['file']['path']).resolve() != Path(row['path']).resolve():
        raise ValueError('Generation reference path mismatch')
    check_file(request['reference']['file'])
    for key in ('output', 'stdout', 'stderr'):
        check_file(receipt[key])


def package_row(row, target, anchor, previous, commands):
    existing = bool(row.get('existingReceiptPath'))
    receipt_path = (Path(row['existingReceiptPath']) if existing else
                    QA / 'generation/audio' / row['id'] / TEXT_ID / 'take-001/receipt.json')
    if not receipt_path.exists() or common.read_json(receipt_path).get('status') != 'complete':
        return {'id': row['id'], 'status': 'not_completed', 'seed': row['seed'],
                'cfg': row['cfg'], 'timesteps': row['timesteps'], 'existing': existing}
    receipt = common.read_json(receipt_path)
    verify_generation(receipt, row, target, anchor, existing)
    source = Path(receipt['output']['path'])
    if existing:
        prior = anchor['generated']
        if row['role'] != 'yuigahama' or (float(row['cfg']), row['timesteps']) != (2.0, 10):
            raise ValueError('Unexpected existing take reuse')
        for key, declared_path in [('generation_receipt', receipt_path), ('raw', Path(row['existingRawPath'])),
                                   ('listen', Path(row['existingListenPath']))]:
            if declared_path.resolve() != Path(prior[key]['path']).resolve():
                raise ValueError('Existing Yui baseline paths differ from the verified prior package')
            check_file(prior[key])
        if receipt['output']['sha256'] != prior['raw']['sha256']:
            raise ValueError('Existing delivered raw file differs from its generation')
        raw, listen, gain = Path(prior['raw']['path']), Path(prior['listen']['path']), prior['gain_db']
        input_loudness, output_loudness = prior['input_loudness'], prior['output_loudness']
        metrics, listen_metrics = prior['metrics'], prior['listen_metrics']
    else:
        raw = OUTPUT / 'raw' / f'{row["id"]}.wav'
        common.copy_verified(source, raw)
        input_loudness = common.loudness(raw, commands)
        gain = min(-23 - input_loudness['integrated_lufs'], -1 - input_loudness['true_peak_dbtp'])
        listen = OUTPUT / 'listen' / raw.name
        if listen.exists():
            common.verify_reusable_listen(previous, source, raw, listen, gain)
        else:
            common.render_gain(raw, listen, gain, 'pcm_s16le', commands)
        output_loudness = common.loudness(listen, commands)
        metrics, listen_metrics = common.metrics(raw, commands), common.metrics(listen, commands)
    return {'id': row['id'], 'status': 'complete', 'role': row['role'], 'seed': row['seed'],
            'cfg': row['cfg'], 'timesteps': row['timesteps'], 'existing': existing,
            'generation_receipt': common.info(receipt_path), 'source': common.info(source),
            'raw': common.info(raw), 'listen': common.info(listen), 'gain_db': gain,
            'input_loudness': input_loudness, 'output_loudness': output_loudness,
            'metrics': metrics, 'listen_metrics': listen_metrics,
            'static_gain_verification': verify_static_gain(raw, listen, gain)}


def build_html(manifest, anchors, generated):
    lookup = {x['id']: x for x in generated}
    sections = []
    for role in ROLES:
        anchor = anchors[role]
        reference = anchor['reference']
        ref_players = common.player(reference.get('preview_label', '原声参考'), relative(reference['original']['path']),
                                    reference['original_metrics']['duration_seconds'], download_label='下载参考音频')
        ref_players += common.player('等音量参考', relative(reference['matched']['path']), reference['original_metrics']['duration_seconds'])
        if reference.get('model_input'):
            ref_players += common.player(reference['model_input_label'], relative(reference['model_input']['path']),
                                         reference['model_input_metrics']['duration_seconds'])
        cards = []
        for row in (r for r in manifest['references'] if r['role'] == role):
            result = lookup[row['id']]
            audio = (common.player('生成日语', relative(result['listen']['path']), result['metrics']['duration_seconds'],
                                    relative(result['raw']['path']), '下载原生 WAV') if result['status'] == 'complete' else
                     '<article class="player unavailable"><h3>生成日语</h3><p>本次未完成</p></article>')
            cards.append(f'<article class="setting"><h3>{html.escape(row["label"])}</h3>'
                         f'<p class="parameters">CFG {row["cfg"]:g} · {row["timesteps"]} 步</p>' + audio + '</article>')
        descriptor = '25.10 秒参考，音量降低 6 dB' if role == 'yukinoshita' else '新的完整 23.82 秒参考'
        sections.append(f'<section><div class="role-title"><h2>{ROLE_LABELS[role]}</h2><p>{descriptor}</p></div>'
                        '<details class="reference"><summary>查看固定参考与原文</summary><div class="reference-grid">'
                        + ref_players + '</div><p lang="ja">' + html.escape(anchor['request']['reference']['promptText'])
                        + f'</p><p class="seed">四档均使用 Seed {EXPECTED_SEEDS[role]}</p></details>'
                        '<div class="four">' + ''.join(cards) + '</div></section>')
    return '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>日语试听 · 参数对照</title>
<style>
:root{color-scheme:light;--ink:#24332e;--muted:#647268;--line:#d5dfd5;--accent:#356c51}
*{box-sizing:border-box}body{margin:0;background:#f2f5ef;color:var(--ink);font:16px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:1400px;margin:auto;padding:36px 26px}a{color:var(--accent);text-underline-offset:3px}nav{font-size:13px;margin-bottom:24px;display:flex;gap:20px;flex-wrap:wrap}
header{padding-bottom:22px;border-bottom:1px solid var(--line)}h1{font-size:clamp(26px,4vw,38px);margin:8px 0 12px}header p{margin:0;color:var(--muted)}
.text{margin:24px 0 30px;padding-left:18px;border-left:3px solid #8bad91}.text p{margin:0}.japanese{font-size:18px}.meaning{margin-top:8px!important;color:var(--muted);font-size:14px}
section{margin:34px 0 44px}.role-title{display:flex;align-items:baseline;gap:20px;flex-wrap:wrap;margin-bottom:12px}.role-title p{color:var(--muted);font-size:14px;margin:0}h2{font-size:27px;margin:0}.four{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;align-items:start}.setting{min-width:0}.setting>h3{font-size:18px;margin:0 0 3px}.parameters{font-size:13px;color:var(--muted);margin:0 0 12px}
.player{background:white;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px;min-width:0}.player-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.player h3{font-size:15px;margin:0 0 12px}.player-top span{font-size:12px;white-space:nowrap;color:var(--muted)}
audio{width:100%;display:block;height:42px}.download{display:inline-block;margin-top:10px;font-size:12px}.reference{font-size:13px;color:var(--muted);margin:0 0 20px}.reference-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:14px}.reference>p{line-height:1.9}.seed{font-size:12px}summary{cursor:pointer}
footer{margin-top:30px;color:var(--muted);font-size:12px}summary:focus-visible,a:focus-visible,audio:focus-visible{outline:3px solid #619b78;outline-offset:4px}
@media(max-width:1100px){.four{grid-template-columns:repeat(2,minmax(0,1fr))}.reference-grid{grid-template-columns:1fr}}@media(max-width:620px){.four{grid-template-columns:1fr}main{padding:24px 16px}}
</style></head><body><main><nav><a href="../reference-refinement/index.html">上一轮参考与发音对照</a><a href="../index.html">最初两角色日语试听</a></nav>
<header><h1>日语参数对照</h1><p>每个角色固定参考、原文和 Seed，比较四档参数。先听基准，再比较发音、重音与声音细节。</p></header>
''' + f'<div class="text"><p class="japanese" lang="ja">{html.escape(manifest["texts"][0]["text"])}</p>' + \
        '<p class="meaning">中文含义：稍微坐下来休息一下吧。茶还温热，请慢慢喝。今天的事，明天再想也没关系。</p></div>' + \
        ''.join(sections) + '''<footer>试听版只调整整条固定音量；原生 WAV 可单独下载。</footer></main>
<script>document.addEventListener('play',function(event){if(event.target.tagName==='AUDIO'){document.querySelectorAll('audio').forEach(function(audio){if(audio!==event.target)audio.pause();});}},true);</script></body></html>'''


def finalize():
    manifest_identity = common.info(MANIFEST)
    manifest = common.read_json(MANIFEST)
    anchors, anchor_package = load_anchors()
    validate_catalog(manifest, anchors)
    protected = [common.info(p) for p in ROOT.rglob('*') if p.is_file() and OUTPUT not in p.parents]
    existing = common.read_json(RECEIPT) if RECEIPT.exists() else None
    previous = {x['id']: x for x in (existing or {}).get('generated', [])}
    page = OUTPUT / 'index.html'
    page_before = common.info(page) if page.exists() else None
    if page_before and (not existing or existing['index'] != page_before):
        raise ValueError('Existing parameter page was edited; refusing to overwrite')
    for folder in ('raw', 'listen'):
        (OUTPUT / folder).mkdir(parents=True, exist_ok=True)
    generated, commands = [], []
    for row in manifest['references']:
        generated.append(package_row(row, manifest['texts'][0], anchors[row['role']], previous.get(row['id']), commands))
    source = build_html(manifest, anchors, generated)
    parser = common.LinkParser()
    parser.feed(source)
    links = []
    for link in sorted(set(parser.links)):
        parsed = urlparse(link)
        if parsed.scheme or parsed.netloc:
            raise ValueError('Parameter page must use only local artifact links')
        path = (OUTPUT / unquote(parsed.path)).resolve(strict=True)
        if ROOT.resolve() not in path.parents or not path.is_file():
            raise ValueError(f'Invalid local link: {link}')
        links.append(common.info(path))
    for item in protected + [manifest_identity, anchor_package]:
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
    complete = [x for x in generated if x['status'] == 'complete']
    result = {'status': 'complete' if len(complete) == 8 else 'partial_generation_page_complete', 'at': common.now(),
              'script': common.info(Path(__file__)), 'manifest': manifest_identity, 'anchor_package': anchor_package,
              'references': {role: anchors[role]['reference'] for role in ROLES}, 'generated': generated,
              'playable_count': len(complete), 'new_generated_count': sum(not x['existing'] for x in complete),
              'reused_count': sum(x['existing'] for x in complete), 'index': common.info(page), 'links': links,
              'existing_assets_preserved': protected, 'commands': commands,
              'new_model_runs': 0, 'browser_opened': False, 'subjective_listening_performed': False}
    common.write_json(RECEIPT, result)
    verification = {'status': 'published_delivery_verified', 'at': common.now(), 'index': result['index'],
                    'package_receipt': common.info(RECEIPT), 'playable_count': len(complete),
                    'new_generated_count': result['new_generated_count'], 'reused_count': result['reused_count'],
                    'local_links_verified': len(links), 'existing_assets_preserved': len(protected),
                    'rows': [{'id': x['id'], 'seed': x['seed'], 'cfg': x['cfg'], 'timesteps': x['timesteps'],
                              'existing': x['existing'], **x['static_gain_verification']} for x in complete],
                    'new_model_runs': 0, 'browser_opened': False}
    common.write_json(QA / 'delivery-verification.json', verification)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['finalize'])
    parser.parse_args()
    result = finalize()
    print(json.dumps({'status': result['status'], 'new_generated_count': result['new_generated_count'],
                      'playable_count': result['playable_count'], 'index': result['index']}, ensure_ascii=False))
