"""Package five new Japanese sentences using the unchanged full Yui 02 reference.

Only each target sentence changes. This packages finished native takes with
whole-file static listening gain and reuses the familiar previous paragraph.
No model, ASR, browser, reference processing or emotion controls are used here.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
from pathlib import Path
from urllib.parse import unquote, urlparse

import package_reference_comparison as common
from package_japanese_listening import verify_static_gain

QA = common.QA / 'yui-reference-02-sentences'
ROOT = common.OUTPUT
OUTPUT = ROOT / 'japanese/yui-reference-02-sentences'
DESIGN = QA / 'design.json'
RECEIPT = QA / 'package-receipt.json'
REFERENCE_ID = 'yui-reference-02'
SENTENCE_IDS = ['greeting', 'invitation', 'concern', 'shy', 'comfort']


def relative(path):
    return Path(os.path.relpath(Path(path).resolve(), OUTPUT.resolve())).as_posix()


def check_file(item):
    path = Path(item['path'])
    if path.stat().st_size != item['bytes'] or common.digest(path) != item['sha256']:
        raise ValueError(f'File identity changed: {path}')
    return path


def load_baseline():
    package_path = common.QA / 'yui-reference-02/package-receipt.json'
    package = common.read_json(package_path)
    old = next(x for x in package['generated'] if x['id'] == REFERENCE_ID)
    for key in ('generation_receipt', 'source', 'raw', 'listen', 'source_preview', 'model_input'):
        check_file(old[key])
    receipt = common.read_json(Path(old['generation_receipt']['path']))
    request = receipt['request']
    if old['status'] != 'complete' or receipt['status'] != 'complete' or receipt['exit_code'] != 0:
        raise ValueError('The familiar reference-02 paragraph is not complete')
    if (request['seed'], request['mode'], request['parameters']['cfg'], request['parameters']['timesteps']) != (42, 'combined', 2.5, 10):
        raise ValueError('Wrong familiar seed42/CFG2.5/10 combined paragraph')
    check_file(request['reference']['file'])
    if request['reference']['id'] != REFERENCE_ID or request['reference']['file']['sha256'] != old['model_input']['sha256']:
        raise ValueError('Familiar paragraph uses the wrong reference')
    if receipt['output']['sha256'] != old['raw']['sha256'] or old['source']['sha256'] != old['raw']['sha256']:
        raise ValueError('Familiar delivered raw differs from the native output')
    result = dict(old, existing=True, label='上一轮日文段落', text=request['text']['text'],
                  static_gain_verification=verify_static_gain(Path(old['raw']['path']), Path(old['listen']['path']), old['gain_db']))
    return result, request, common.info(package_path)


def validate_design(design, request):
    identities = [design['master'], design['prior_successful_request'], design['source_preparation']]
    for item in identities:
        check_file(item)
    master = common.read_json(Path(design['master']['path']))
    if master.get('executable') is not False or master['jobs'] != design['sentences']:
        raise ValueError('Sentence index must be non-executable and agree with the design')
    if [x['id'] for x in design['sentences']] != SENTENCE_IDS:
        raise ValueError('Expected exactly the five approved sentence categories')
    fixed = design['fixed']
    if fixed['seed'] != request['seed'] or fixed['mode'] != request['mode'] or fixed['parameters'] != request['parameters']:
        raise ValueError('Sentence design changed the fixed generation settings')
    if fixed['input'] != request['reference']['file'] or fixed['profile'] != request['profile']:
        raise ValueError('Sentence design changed the input or profile')
    check_file(fixed['input'])
    if fixed['reference']['promptText'] != request['reference']['promptText']:
        raise ValueError('Sentence design changed the reference transcript')
    if design['style_tags_added'] is not False or design['text_labels_are_categories_not_emotion_controls'] is not True:
        raise ValueError('Sentence categories must not add style controls')
    for item in design['sentences']:
        identities.append(item['manifest'])
        manifest = common.read_json(check_file(item['manifest']))
        target = {'id': item['id'], 'text': item['text']}
        if hashlib.sha256(item['text'].encode('utf-8')).hexdigest() != item['text_utf8_sha256']:
            raise ValueError(f'Target text changed: {item["id"]}')
        if manifest['texts'] != [target] or manifest['references'] != [fixed['reference']]:
            raise ValueError(f'Sentence manifest changed target or reference: {item["id"]}')
        if (manifest['seed'], manifest['cfg'], manifest.get('timesteps', 10)) != (42, 2.5, 10):
            raise ValueError(f'Sentence manifest changed fixed parameters: {item["id"]}')
        if item['reference_id'] != REFERENCE_ID or item['labels_describe_text_only'] is not True:
            raise ValueError('Sentence metadata has the wrong reference or category semantics')
    return identities


def package_take(item, fixed_request, previous, commands):
    take = QA / 'generation/audio' / REFERENCE_ID / item['id'] / 'take-001'
    if take.resolve() != Path(item['expected_take_directory']).resolve():
        raise ValueError('Unexpected take directory')
    receipt_path = take / 'receipt.json'
    if not receipt_path.exists():
        raise ValueError(f'Sentence not yet generated: {item["id"]}')
    receipt = common.read_json(receipt_path)
    if receipt['status'] != 'complete' or receipt['exit_code'] != 0:
        raise ValueError(f'Sentence generation did not complete: {item["id"]}')
    actual = receipt['request']
    for key in ('seed', 'mode', 'parameters', 'profile', 'files', 'reference'):
        if actual[key] != fixed_request[key]:
            raise ValueError(f'{item["id"]} changed fixed generation {key}')
    if actual['text'] != {'id': item['id'], 'text': item['text']}:
        raise ValueError(f'Native target differs from this sentence: {item["id"]}')
    check_file(actual['reference']['file'])
    for key in ('output', 'stdout', 'stderr'):
        check_file(receipt[key])
    source = Path(receipt['output']['path'])
    if source.resolve() != (take / 'generated.wav').resolve() or source.resolve() != Path(item['expected_generated_wav']).resolve():
        raise ValueError('Native output path does not match this sentence')
    raw = OUTPUT / 'raw' / (item['id'] + '.wav')
    common.copy_verified(source, raw)
    measured = common.loudness(raw, commands)
    gain = min(-23 - measured['integrated_lufs'], -1 - measured['true_peak_dbtp'])
    listen = OUTPUT / 'listen' / raw.name
    if listen.exists():
        common.verify_reusable_listen(previous, source, raw, listen, gain)
    else:
        common.render_gain(raw, listen, gain, 'pcm_s16le', commands)
    metrics, listen_metrics = common.metrics(raw, commands), common.metrics(listen, commands)
    if metrics['full_scale_samples'] or listen_metrics['full_scale_samples']:
        raise ValueError('Native or listening output has full-scale samples')
    return {'id': item['id'], 'reference_id': REFERENCE_ID, 'label': item['label'], 'text': item['text'],
            'translation': item['translation'], 'existing': False, 'status': 'complete',
            'manifest': item['manifest'], 'generation_receipt': common.info(receipt_path),
            'source': common.info(source), 'raw': common.info(raw), 'listen': common.info(listen), 'gain_db': gain,
            'input_loudness': measured, 'output_loudness': common.loudness(listen, commands),
            'metrics': metrics, 'listen_metrics': listen_metrics,
            'static_gain_verification': verify_static_gain(raw, listen, gain)}


def build_html(rows, baseline):
    cards = []
    for number, row in enumerate(rows, 1):
        player = common.player('日语试听', relative(row['listen']['path']), row['metrics']['duration_seconds'],
                               relative(row['raw']['path']), '下载原生 WAV')
        cards.append(f'<section class="sentence"><div class="eyebrow">{number:02d} · 文案类别</div>'
                     f'<h2>{html.escape(row["label"])}</h2><p class="japanese" lang="ja">{html.escape(row["text"])}</p>'
                     f'<p class="meaning">{html.escape(row["translation"])}</p>' + player + '</section>')
    familiar = common.player('上一轮日文段落 · 02 参考', relative(baseline['listen']['path']),
                             baseline['metrics']['duration_seconds'], relative(baseline['raw']['path']), '下载原生 WAV')
    original = common.player('原品质预听 · 44.1 kHz 双声道', relative(baseline['source_preview']['path']),
                             baseline['source_preview_metrics']['duration_seconds'], download_label='下载原品质预听')
    model = common.player('实际模型输入 · 16 kHz 单声道', relative(baseline['model_input']['path']),
                          baseline['model_input_metrics']['duration_seconds'], download_label='下载实际输入')
    return '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>由比滨 · 02 参考多句试听</title>
<style>
:root{color-scheme:light;--ink:#24332e;--muted:#647268;--line:#d5dfd5;--accent:#356c51}
*{box-sizing:border-box}body{margin:0;background:#f2f5ef;color:var(--ink);font:16px/1.75 "Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:1080px;margin:auto;padding:36px 26px}a{color:var(--accent);text-underline-offset:3px}nav{font-size:13px;margin-bottom:24px;display:flex;gap:20px;flex-wrap:wrap}
header{padding-bottom:24px;border-bottom:1px solid var(--line)}h1{font-size:clamp(26px,4vw,38px);margin:8px 0 12px}header p{margin:0;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin:28px 0}.sentence{background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px;min-width:0}
.eyebrow{font-size:12px;color:var(--muted);letter-spacing:1px}h2{font-size:23px;margin:4px 0 12px}.japanese{font-size:18px;margin:0 0 12px}.meaning{font-size:14px;color:var(--muted);margin:0 0 18px}
.player{min-width:0;margin:16px 0 0}.player-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.player h3{font-size:14px;margin:0 0 10px}.player-top span{font-size:12px;white-space:nowrap;color:var(--muted)}
audio{width:100%;display:block;height:42px}.download{display:inline-block;margin-top:9px;font-size:12px}details{border-top:1px solid var(--line);padding:18px 0;color:var(--muted);font-size:14px}summary{cursor:pointer;color:var(--ink)}.reference-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.reference-text{margin-top:22px;line-height:1.9}details .japanese{margin-top:16px}
footer{margin-top:12px;color:var(--muted);font-size:12px}summary:focus-visible,a:focus-visible,audio:focus-visible{outline:3px solid #619b78;outline-offset:4px}
@media(max-width:700px){.grid,.reference-grid{grid-template-columns:1fr}main{padding:24px 16px}.sentence{padding:18px}}
</style></head><body><main><nav><a href="../yui-reference-02/index.html">新旧参考对照</a><a href="../input-clarity/index.html">旧参考音量对照</a></nav>
<header><h1>由比滨 · 02 参考多句试听</h1><p>沿用完整 20.22 秒干音和对应日语原文，换五段日常对白。Seed 42 / CFG 2.5 / 10 步。</p></header>
<div class="grid">''' + ''.join(cards) + '</div>' + \
        '<details><summary>上一轮熟悉的日文段落</summary>' + \
        f'<p class="japanese" lang="ja">{html.escape(baseline["text"])}</p>' + familiar + '</details>' + \
        '<details><summary>参考音频与对应日语原文</summary><div class="reference-grid">' + original + model + '</div>' + \
        f'<p class="reference-text" lang="ja">{html.escape(baseline["prompt_text"])}</p></details>' + '''
<footer>生成试听统一作固定音量匹配，原生 WAV 可单独下载。参考试听保留原始音量。</footer></main>
<script>document.addEventListener('play',function(event){if(event.target.tagName==='AUDIO'){document.querySelectorAll('audio').forEach(function(audio){if(audio!==event.target)audio.pause();});}},true);</script></body></html>'''


def finalize():
    design_identity = common.info(DESIGN)
    design = common.read_json(DESIGN)
    baseline, request, prior_identity = load_baseline()
    identities = validate_design(design, request)
    protected = [common.info(p) for p in ROOT.rglob('*') if p.is_file() and OUTPUT not in p.parents]
    existing = common.read_json(RECEIPT) if RECEIPT.exists() else None
    previous = {x['id']: x for x in (existing or {}).get('generated', [])}
    page = OUTPUT / 'index.html'
    page_before = common.info(page) if page.exists() else None
    if page_before and (not existing or existing['index'] != page_before):
        raise ValueError('Existing sentence page was edited; refusing to overwrite')
    for folder in ('raw', 'listen'):
        (OUTPUT / folder).mkdir(parents=True, exist_ok=True)
    commands = []
    rows = [package_take(item, request, previous.get(item['id']), commands) for item in design['sentences']]
    source = build_html(rows, baseline)
    parser = common.LinkParser()
    parser.feed(source)
    if len(parser.audio) != 8:
        raise ValueError('Expected five sentence players, one familiar paragraph and two references')
    links = []
    for link in sorted(set(parser.links)):
        parsed = urlparse(link)
        if parsed.scheme or parsed.netloc:
            raise ValueError('Sentence page must link only to local listening assets')
        path = (OUTPUT / unquote(parsed.path)).resolve(strict=True)
        if ROOT.resolve() not in path.parents or not path.is_file():
            raise ValueError(f'Invalid local link: {link}')
        links.append(common.info(path))
    for item in protected + identities + [design_identity, prior_identity]:
        check_file(item)
    for row in rows:
        for key in ('source', 'raw', 'listen', 'generation_receipt'):
            check_file(row[key])
    if (common.info(page) if page.exists() else None) != page_before:
        raise ValueError('Page changed while preparing delivery')
    if existing:
        history = QA / 'package-history'
        common.copy_verified(RECEIPT, history / (common.digest(RECEIPT) + '.json'))
        common.copy_verified(page, history / (common.digest(page) + '.html'))
    pending = OUTPUT / 'index.pending.html'
    pending.write_text(source, encoding='utf-8')
    pending.replace(page)
    result = {'status': 'complete', 'at': common.now(), 'script': common.info(Path(__file__)),
              'design': design_identity, 'inputs': identities, 'prior_package': prior_identity,
              'generated': rows, 'familiar_paragraph': baseline, 'new_generated_count': len(rows),
              'reused_generated_count': 1, 'playable_generated_count': len(rows) + 1,
              'index': common.info(page), 'links': links, 'existing_assets_preserved': protected,
              'commands': commands, 'new_model_runs': 0, 'browser_opened': False,
              'subjective_listening_performed': False}
    common.write_json(RECEIPT, result)
    verification = {'status': 'published_delivery_verified', 'at': common.now(), 'index': result['index'],
                    'package_receipt': common.info(RECEIPT), 'new_generated_count': len(rows),
                    'reused_generated_count': 1, 'playable_generated_count': len(rows) + 1,
                    'local_links_verified': len(links), 'existing_assets_preserved': len(protected),
                    'rows': [{'id': x['id'], 'existing': x['existing'], **x['static_gain_verification']} for x in rows + [baseline]],
                    'new_model_runs': 0, 'browser_opened': False}
    common.write_json(QA / 'delivery-verification.json', verification)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['finalize'])
    parser.parse_args()
    result = finalize()
    print(json.dumps({'status': result['status'], 'new_generated_count': result['new_generated_count'],
                      'playable_generated_count': result['playable_generated_count'], 'index': result['index']}, ensure_ascii=False))
