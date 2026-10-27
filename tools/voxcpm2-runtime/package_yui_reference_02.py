"""Package one complete new Yui reference-02 take against the old original-level baseline.

The new transcript comes from its own execution manifest. Different references
may differ in content, length and source level; only generated listening copies
receive fixed whole-file gain. No model, ASR or browser calls are made here.
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

QA = common.QA / 'yui-reference-02'
ROOT = common.OUTPUT
OUTPUT = ROOT / 'japanese/yui-reference-02'
PREPARATION = QA / 'preparation.json'
DEFAULT_MANIFEST = QA / 'guarded-yui-reference-02.json'
RECEIPT = QA / 'package-receipt.json'
BASELINE_ID = 'yui-cfg2p5-step10'
NEW_ID = 'yui-reference-02'
TEXT_ID = 'japanese-paragraph'


def relative(path):
    return Path(os.path.relpath(Path(path).resolve(), OUTPUT.resolve())).as_posix()


def check_file(item):
    path = Path(item['path'])
    if path.stat().st_size != item['bytes'] or common.digest(path) != item['sha256']:
        raise ValueError(f'File identity changed: {path}')
    return path


def load_baseline():
    package_path = common.QA / 'parameter-sweep/package-receipt.json'
    package = common.read_json(package_path)
    old = next(x for x in package['generated'] if x['id'] == BASELINE_ID)
    for key in ('generation_receipt', 'source', 'raw', 'listen'):
        check_file(old[key])
    receipt = common.read_json(Path(old['generation_receipt']['path']))
    request = receipt['request']
    if receipt['status'] != 'complete' or receipt['exit_code'] != 0:
        raise ValueError('The old original-level baseline is not complete')
    if request['seed'] != 42 or request['mode'] != 'combined' or request['parameters']['cfg'] != 2.5 or request['parameters']['timesteps'] != 10:
        raise ValueError('Wrong original-level Yui seed42/CFG2.5/10 baseline')
    check_file(request['reference']['file'])
    if receipt['output']['sha256'] != old['raw']['sha256']:
        raise ValueError('Old delivered raw differs from native output')
    reference = package['references']['yuigahama']
    for key in ('source', 'original'):
        check_file(reference[key])
    inputs = common.read_json(common.QA / 'input-clarity/package-receipt.json')
    model_input = next(x for x in inputs['generated'] if x['id'] == BASELINE_ID)['model_input']
    check_file(model_input)
    if model_input['sha256'] != request['reference']['file']['sha256']:
        raise ValueError('Existing 16 kHz reference does not match the actual baseline input')
    result = dict(old, label='旧原参考', existing=True, prompt_text=request['reference']['promptText'],
                  source_preview=reference['original'], source_preview_metrics=reference['original_metrics'],
                  model_input=model_input, model_input_metrics=common.wav_format(Path(model_input['path'])),
                  static_gain_verification=verify_static_gain(Path(old['raw']['path']), Path(old['listen']['path']), old['gain_db']))
    return result, request, common.info(package_path)


def new_take(preparation, manifest_path, old_request, previous, commands):
    model = check_file(preparation['model'])
    preview = check_file(preparation['source_preview'])
    check_file(preparation['source'])
    model_fmt, preview_fmt = common.wav_format(model), common.wav_format(preview)
    if (model_fmt['sample_rate'], model_fmt['channels'], model_fmt['sample_width_bytes']) != (16000, 1, 2):
        raise ValueError('New reference must be preconverted 16 kHz mono PCM16')
    if preview_fmt['sample_width_bytes'] != 3:
        raise ValueError('Original-quality preview must preserve PCM24 precision')
    original_source = preparation['source']
    if (preview_fmt['frames'], preview_fmt['sample_rate'], preview_fmt['channels']) != (original_source['actual_full_decoded_frames'], original_source['sample_rate'], original_source['channels']):
        raise ValueError('Original-quality preview does not preserve the full decoded source')
    if model_fmt['frames'] != preparation['model']['metrics']['frames'] or preview_fmt['frames'] != preparation['source_preview']['metrics']['frames']:
        raise ValueError('Full prepared reference frame counts changed')
    if abs(model_fmt['duration_seconds'] - preview_fmt['duration_seconds']) > 1 / 16000:
        raise ValueError('Preview and model reference do not contain the same full duration')
    manifest = common.read_json(manifest_path)
    if len(manifest['references']) != 1 or manifest['references'][0]['id'] != NEW_ID:
        raise ValueError('Expected only the new reference-02 experiment')
    ref = manifest['references'][0]
    if manifest['texts'] != [old_request['text']] or manifest['seed'] != 42 or manifest['cfg'] != 2.5 or manifest.get('timesteps', 10) != 10:
        raise ValueError('New reference experiment changed fixed target or generation settings')
    if ref['mode'] != 'combined' or not ref.get('promptText'):
        raise ValueError('New reference requires its own nonempty transcript in combined mode')
    if Path(ref['path']).resolve() != model.resolve():
        raise ValueError('Manifest does not use the prepared reference-02 audio')
    model_copy = OUTPUT / 'references/yui-reference-02-16000.wav'
    preview_copy = OUTPUT / 'references/yui-reference-02-original.wav'
    common.copy_verified(model, model_copy)
    common.copy_verified(preview, preview_copy)
    result = {'id': NEW_ID, 'label': '新 02 参考', 'existing': False, 'prompt_text': ref['promptText'],
              'model_input': common.info(model_copy), 'model_input_metrics': common.metrics(model_copy, commands),
              'source_preview': common.info(preview_copy), 'source_preview_metrics': common.metrics(preview_copy, commands),
              'manifest': common.info(manifest_path)}
    receipt_path = QA / 'generation/audio' / NEW_ID / TEXT_ID / 'take-001/receipt.json'
    if not receipt_path.exists() or common.read_json(receipt_path).get('status') != 'complete':
        return dict(result, status='not_completed')
    receipt = common.read_json(receipt_path)
    actual = receipt['request']
    if receipt['exit_code'] != 0:
        raise ValueError('Completed reference-02 generation exited unsuccessfully')
    for key in ('text', 'seed', 'mode', 'parameters', 'profile', 'files'):
        if actual[key] != old_request[key]:
            raise ValueError(f'New reference changed fixed generation {key}')
    # Reference content/transcript can change: match the new manifest, never the old prompt.
    if actual['reference']['id'] != NEW_ID or actual['reference']['promptText'] != ref['promptText']:
        raise ValueError('Native take did not use the newly prepared transcript')
    if actual['reference']['file']['sha256'] != preparation['model']['sha256'] or Path(actual['reference']['file']['path']).resolve() != model.resolve():
        raise ValueError('Native process did not use the exact new reference audio')
    check_file(actual['reference']['file'])
    for key in ('output', 'stdout', 'stderr'):
        check_file(receipt[key])
    source = Path(receipt['output']['path'])
    raw = OUTPUT / 'raw' / (NEW_ID + '.wav')
    common.copy_verified(source, raw)
    measured = common.loudness(raw, commands)
    gain = min(-23 - measured['integrated_lufs'], -1 - measured['true_peak_dbtp'])
    listen = OUTPUT / 'listen' / raw.name
    if listen.exists():
        common.verify_reusable_listen(previous, source, raw, listen, gain)
    else:
        common.render_gain(raw, listen, gain, 'pcm_s16le', commands)
    return dict(result, status='complete', generation_receipt=common.info(receipt_path),
                source=common.info(source), raw=common.info(raw), listen=common.info(listen), gain_db=gain,
                input_loudness=measured, output_loudness=common.loudness(listen, commands),
                metrics=common.metrics(raw, commands), listen_metrics=common.metrics(listen, commands),
                static_gain_verification=verify_static_gain(raw, listen, gain))


def format_label(metrics):
    rate = f'{metrics["sample_rate"] / 1000:g}'
    channels = '单声道' if metrics['channels'] == 1 else f'{metrics["channels"]} 声道'
    return f'{rate} kHz · {channels}'


def build_html(request, rows):
    cards = []
    for row in rows:
        generated = (common.player('生成日语 · 等音量', relative(row['listen']['path']), row['metrics']['duration_seconds'],
                                    relative(row['raw']['path']), '下载原生 WAV') if row['status'] == 'complete' else
                     '<article class="player"><h3>生成日语</h3><p>本次未完成</p></article>')
        preview = common.player('原品质预听 · ' + format_label(row['source_preview_metrics']),
                                relative(row['source_preview']['path']), row['source_preview_metrics']['duration_seconds'],
                                download_label='下载原品质预听')
        model = common.player('模型参考 · ' + format_label(row['model_input_metrics']),
                              relative(row['model_input']['path']), row['model_input_metrics']['duration_seconds'],
                              download_label='下载实际 16 kHz 输入')
        cards.append(f'<section><h2>{html.escape(row["label"])}</h2>'
                     f'<p class="duration">完整参考 {row["source_preview_metrics"]["duration_seconds"]:.2f} 秒</p>' + generated
                     + '<details class="reference"><summary>查看参考音频与日语原文</summary>' + preview + model
                     + f'<p lang="ja">{html.escape(row["prompt_text"])}</p></details></section>')
    return '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>由比滨 · 新 02 参考试听</title>
<style>
:root{color-scheme:light;--ink:#24332e;--muted:#647268;--line:#d5dfd5;--accent:#356c51}
*{box-sizing:border-box}body{margin:0;background:#f2f5ef;color:var(--ink);font:16px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:1160px;margin:auto;padding:36px 26px}a{color:var(--accent);text-underline-offset:3px}nav{font-size:13px;margin-bottom:24px;display:flex;gap:20px;flex-wrap:wrap}
header{padding-bottom:22px;border-bottom:1px solid var(--line)}h1{font-size:clamp(26px,4vw,38px);margin:8px 0 12px}header p{margin:0;color:var(--muted)}
.text{margin:24px 0 30px;padding-left:18px;border-left:3px solid #8bad91}.text p{margin:0}.japanese{font-size:18px}.meaning{margin-top:8px!important;color:var(--muted);font-size:14px}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start}section{min-width:0}h2{font-size:24px;margin:0 0 8px}.duration{font-size:13px;color:var(--muted);margin:0 0 18px}.player{background:white;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px;min-width:0}.player-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.player h3{font-size:15px;margin:0 0 12px}.player-top span{font-size:12px;white-space:nowrap;color:var(--muted)}
audio{width:100%;display:block;height:42px}.download{display:inline-block;margin-top:10px;font-size:12px}.reference{font-size:13px;color:var(--muted)}.reference .player{margin-top:14px}.reference>p{line-height:1.9}summary{cursor:pointer}
footer{margin-top:30px;color:var(--muted);font-size:12px}summary:focus-visible,a:focus-visible,audio:focus-visible{outline:3px solid #619b78;outline-offset:4px}
@media(max-width:700px){.two{grid-template-columns:1fr}main{padding:24px 16px}}
</style></head><body><main><nav><a href="../input-clarity/index.html">旧参考原音量 / +3 / +6 dB 对照</a><a href="../parameter-sweep/index.html">参数对照</a></nav>
<header><h1>由比滨 · 新 02 参考</h1><p>使用完整新干音，提前转换为 16 kHz 后生成。与旧原参考比较同一段日文，固定 Seed 42 / CFG 2.5 / 10 步。</p></header>
''' + f'<div class="text"><p class="japanese" lang="ja">{html.escape(request["text"]["text"])}</p>' + \
        '<p class="meaning">中文含义：稍微坐下来休息一下吧。茶还温热，请慢慢喝。今天的事，明天再想也没关系。</p></div>' + \
        '<div class="two">' + ''.join(cards) + '''</div>
<footer>生成试听只作固定音量匹配；原生 WAV 可单独下载。折叠参考保留各自实际音量。</footer></main>
<script>document.addEventListener('play',function(event){if(event.target.tagName==='AUDIO'){document.querySelectorAll('audio').forEach(function(audio){if(audio!==event.target)audio.pause();});}},true);</script></body></html>'''


def finalize(manifest_path):
    manifest_path = manifest_path.resolve(strict=True)
    preparation_identity, manifest_identity = common.info(PREPARATION), common.info(manifest_path)
    preparation = common.read_json(PREPARATION)
    if preparation.get('full_input_used') is not True or preparation.get('source_unchanged') is not True:
        raise ValueError('New source must be unchanged and used in full')
    old, request, prior_identity = load_baseline()
    protected = [common.info(p) for p in ROOT.rglob('*') if p.is_file() and OUTPUT not in p.parents]
    existing = common.read_json(RECEIPT) if RECEIPT.exists() else None
    previous = next((x for x in (existing or {}).get('generated', []) if x['id'] == NEW_ID), None)
    page = OUTPUT / 'index.html'
    page_before = common.info(page) if page.exists() else None
    if page_before and (not existing or existing['index'] != page_before):
        raise ValueError('Existing reference-02 page was edited; refusing to overwrite')
    for folder in ('raw', 'listen', 'references'):
        (OUTPUT / folder).mkdir(parents=True, exist_ok=True)
    commands = []
    rows = [old, new_take(preparation, manifest_path, request, previous, commands)]
    source = build_html(request, rows)
    parser = common.LinkParser()
    parser.feed(source)
    links = []
    for link in sorted(set(parser.links)):
        parsed = urlparse(link)
        if parsed.scheme or parsed.netloc:
            raise ValueError('Reference-02 page must link only to local listening assets')
        path = (OUTPUT / unquote(parsed.path)).resolve(strict=True)
        if ROOT.resolve() not in path.parents or not path.is_file():
            raise ValueError(f'Invalid local link: {link}')
        links.append(common.info(path))
    for item in protected + [preparation_identity, manifest_identity, prior_identity]:
        check_file(item)
    if (common.info(page) if page.exists() else None) != page_before:
        raise ValueError('Page changed while preparing delivery')
    if existing:
        history = QA / 'package-history'
        common.copy_verified(RECEIPT, history / (common.digest(RECEIPT) + '.json'))
        common.copy_verified(page, history / (common.digest(page) + '.html'))
    pending = OUTPUT / 'index.pending.html'
    pending.write_text(source, encoding='utf-8')
    pending.replace(page)
    complete = [x for x in rows if x['status'] == 'complete']
    result = {'status': 'complete' if len(complete) == 2 else 'partial_generation_page_complete', 'at': common.now(),
              'script': common.info(Path(__file__)), 'preparation': preparation_identity, 'manifest': manifest_identity,
              'prior_package': prior_identity, 'generated': rows, 'playable_generated_count': len(complete),
              'new_generated_count': sum(not x['existing'] for x in complete), 'reused_count': 1,
              'index': common.info(page), 'links': links, 'existing_assets_preserved': protected, 'commands': commands,
              'new_model_runs': 0, 'browser_opened': False, 'subjective_listening_performed': False}
    common.write_json(RECEIPT, result)
    verification = {'status': 'published_delivery_verified', 'at': common.now(), 'index': result['index'],
                    'package_receipt': common.info(RECEIPT), 'playable_generated_count': len(complete),
                    'new_generated_count': result['new_generated_count'], 'reused_count': 1,
                    'local_links_verified': len(links), 'existing_assets_preserved': len(protected),
                    'rows': [{'id': x['id'], 'existing': x['existing'], **x['static_gain_verification']} for x in complete],
                    'new_model_runs': 0, 'browser_opened': False}
    common.write_json(QA / 'delivery-verification.json', verification)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['finalize'])
    parser.add_argument('--manifest', type=Path, default=DEFAULT_MANIFEST)
    args = parser.parse_args()
    result = finalize(args.manifest)
    print(json.dumps({'status': result['status'], 'new_generated_count': result['new_generated_count'],
                      'playable_generated_count': result['playable_generated_count'], 'index': result['index']}, ensure_ascii=False))
