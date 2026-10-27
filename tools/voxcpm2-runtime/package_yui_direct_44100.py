"""Publish selected Yui direct-44.1kHz versus preconverted-16kHz comparisons.

Selection is explicit; preparing three input candidates never implies three
completed model runs. Old baselines are reused by their exact native receipts.
No model, ASR or browser calls are made by this packager.
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

QA = common.QA / 'yui-direct-44100'
ROOT = common.OUTPUT
OUTPUT = ROOT / 'japanese/yui-direct-44100'
PREPARATION = QA / 'preparation.json'
DESIGN = QA / 'design.json'
RECEIPT = QA / 'package-receipt.json'
TEXT_ID = 'japanese-paragraph'
IDS = ('original', 'plus3', 'plus6')
BASELINE_IDS = {'original': 'yui-cfg2p5-step10', 'plus3': 'yui-gain-plus3', 'plus6': 'yui-gain-plus6'}
GAINS = {'original': 0, 'plus3': 3, 'plus6': 6}
LABELS = {'original': '原参考音量', 'plus3': '参考音量 +3 dB', 'plus6': '参考音量 +6 dB'}


def relative(path):
    return Path(os.path.relpath(Path(path).resolve(), OUTPUT.resolve())).as_posix()


def check_file(item):
    path = Path(item['path'])
    if path.stat().st_size != item['bytes'] or common.digest(path) != item['sha256']:
        raise ValueError(f'File identity changed: {path}')
    return path


def load_baselines(selected, prepared):
    package_path = common.QA / 'input-clarity/package-receipt.json'
    package = common.read_json(package_path)
    rows = {}
    for choice in selected:
        ref_id = BASELINE_IDS[choice]
        old = next(x for x in package['generated'] if x['id'] == ref_id)
        for key in ('generation_receipt', 'source', 'raw', 'listen', 'model_input'):
            check_file(old[key])
        receipt = common.read_json(Path(old['generation_receipt']['path']))
        request = receipt['request']
        if receipt['status'] != 'complete' or receipt['exit_code'] != 0:
            raise ValueError('Selected baseline is not complete')
        if request['seed'] != 42 or request['mode'] != 'combined' or request['parameters']['cfg'] != 2.5 or request['parameters']['timesteps'] != 10:
            raise ValueError('Wrong Yui seed42/CFG2.5/10 baseline')
        check_file(request['reference']['file'])
        if receipt['output']['sha256'] != old['raw']['sha256'] or request['reference']['file']['sha256'] != old['model_input']['sha256']:
            raise ValueError('Baseline delivered audio/reference differs from generation input/output')
        declaration = prepared['yui-direct-44100-' + choice]['baseline']
        if declaration['id'] != ref_id or declaration['gain_db'] != GAINS[choice]:
            raise ValueError('Prepared baseline gain/identity does not match the selected pair')
        if declaration['files']['receipt.json'] != old['generation_receipt'] or declaration['input']['sha256'] != old['model_input']['sha256']:
            raise ValueError('Prepared baseline does not match the exact prior receipt/reference')
        for item in declaration['files'].values():
            check_file(item)
        check_file(declaration['input'])
        fmt = common.wav_format(Path(old['model_input']['path']))
        if (fmt['sample_rate'], fmt['channels'], fmt['sample_width_bytes'], fmt['frames']) != (16000, 1, 2, 381179):
            raise ValueError('Baseline must retain the full 23.82 second reference')
        row = dict(old, label='提前转换为 16 kHz', existing=True, reference=old['model_input'], reference_metrics=fmt,
                   static_gain_verification=verify_static_gain(Path(old['raw']['path']), Path(old['listen']['path']), old['gain_db']))
        rows[choice] = {'row': row, 'request': request}
    return rows, common.info(package_path)


def new_take(choice, variant, request, previous, commands):
    ref_id = 'yui-direct-44100-' + choice
    if variant['id'] != ref_id or variant['gain_db'] != GAINS[choice]:
        raise ValueError('Variant ID/gain differs from selected pair')
    if variant.get('selected_for_generation') is not True:
        raise ValueError('This prepared candidate has not been selected for generation')
    model = check_file(variant['input'])
    manifest_path = check_file(variant['manifest'])
    manifest = common.read_json(manifest_path)
    if len(manifest['references']) != 1 or manifest['references'][0]['id'] != ref_id:
        raise ValueError('Unexpected direct-input reference manifest')
    reference = manifest['references'][0]
    if manifest['texts'] != [request['text']] or manifest['seed'] != 42 or manifest['cfg'] != 2.5 or manifest.get('timesteps', 10) != 10:
        raise ValueError('Direct-input experiment changed target or generation settings')
    if reference['mode'] != 'combined' or reference['promptText'] != request['reference']['promptText']:
        raise ValueError('Direct-input experiment changed mode or transcript')
    if Path(reference['path']).resolve() != model.resolve():
        raise ValueError('Manifest input differs from prepared reference')
    fmt = common.wav_format(model)
    if (fmt['sample_rate'], fmt['channels'], fmt['sample_width_bytes'], fmt['frames']) != (44100, 1, 2, 1050624):
        raise ValueError('Expected full 23.823673 second 44.1 kHz mono PCM16 input')
    destination = OUTPUT / 'references' / (ref_id + '.wav')
    common.copy_verified(model, destination)
    result = {'id': ref_id, 'choice': choice, 'reference_gain_db': GAINS[choice], 'label': '直接输入 44.1 kHz',
              'existing': False, 'reference': common.info(destination), 'reference_metrics': fmt,
              'manifest': common.info(manifest_path)}
    receipt_path = QA / 'generation/audio' / ref_id / TEXT_ID / 'take-001/receipt.json'
    if not receipt_path.exists() or common.read_json(receipt_path).get('status') != 'complete':
        return dict(result, status='not_completed')
    receipt = common.read_json(receipt_path)
    actual = receipt['request']
    if receipt['exit_code'] != 0:
        raise ValueError('Completed direct-input native take exited unsuccessfully')
    for key in ('text', 'seed', 'mode', 'parameters', 'profile', 'files'):
        if actual[key] != request[key]:
            raise ValueError(f'Direct-input pair changed the fixed generation {key}')
    if actual['reference']['id'] != ref_id or actual['reference']['promptText'] != request['reference']['promptText']:
        raise ValueError('Native reference ID/transcript differs')
    if actual['reference']['file']['sha256'] != variant['input']['sha256'] or Path(actual['reference']['file']['path']).resolve() != model.resolve():
        raise ValueError('Native process did not use the prepared direct input')
    check_file(actual['reference']['file'])
    for key in ('output', 'stdout', 'stderr'):
        check_file(receipt[key])
    source = Path(receipt['output']['path'])
    raw = OUTPUT / 'raw' / (ref_id + '.wav')
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


def build_html(request, pairs):
    groups = []
    for pair in pairs:
        cards = []
        for row in pair['rows']:
            generated = (common.player('生成日语 · 等音量', relative(row['listen']['path']), row['metrics']['duration_seconds'],
                                        relative(row['raw']['path']), '下载原生 WAV') if row['status'] == 'complete' else
                         '<article class="player"><h3>生成日语</h3><p>本次未完成</p></article>')
            reference = common.player('参考输入 · 原始音量', relative(row['reference']['path']),
                                      row['reference_metrics']['duration_seconds'], download_label='下载实际参考')
            note = '文件已是 16 kHz，按相同采样率读取。' if row['existing'] else '44.1 kHz 文件交给程序，内部再转换为 16 kHz。'
            cards.append(f'<article class="setting"><h3>{html.escape(row["label"])}</h3><p class="route">{note}</p>'
                         + generated + '<details class="reference"><summary>听实际输入文件</summary>' + reference + '</details></article>')
        groups.append(f'<section><h2>{LABELS[pair["choice"]]}</h2><div class="two">' + ''.join(cards) + '</div></section>')
    return '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>由比滨 · 直接输入 44.1 kHz 对照</title>
<style>
:root{color-scheme:light;--ink:#24332e;--muted:#647268;--line:#d5dfd5;--accent:#356c51}
*{box-sizing:border-box}body{margin:0;background:#f2f5ef;color:var(--ink);font:16px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:1120px;margin:auto;padding:36px 26px}a{color:var(--accent);text-underline-offset:3px}nav{font-size:13px;margin-bottom:24px;display:flex;gap:20px;flex-wrap:wrap}
header{padding-bottom:22px;border-bottom:1px solid var(--line)}h1{font-size:clamp(26px,4vw,38px);margin:8px 0 12px}header p{margin:0;color:var(--muted)}
.text{margin:24px 0 30px;padding-left:18px;border-left:3px solid #8bad91}.text p{margin:0}.japanese{font-size:18px}.meaning{margin-top:8px!important;color:var(--muted);font-size:14px}
section{margin:28px 0 40px}.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start}.setting{min-width:0}h2{font-size:25px;margin:0 0 16px}.setting>h3{font-size:20px;margin:0 0 8px}.route{font-size:13px;color:var(--muted);margin:0 0 18px}.player{background:white;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px;min-width:0}.player-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.player h3{font-size:15px;margin:0 0 12px}.player-top span{font-size:12px;white-space:nowrap;color:var(--muted)}
audio{width:100%;display:block;height:42px}.download{display:inline-block;margin-top:10px;font-size:12px}.reference{font-size:13px;color:var(--muted)}.reference .player{margin-top:14px}summary{cursor:pointer}.transcript{margin-top:28px;border-top:1px solid var(--line);padding-top:18px;font-size:14px;color:var(--muted)}
footer{margin-top:30px;color:var(--muted);font-size:12px}summary:focus-visible,a:focus-visible,audio:focus-visible{outline:3px solid #619b78;outline-offset:4px}
@media(max-width:700px){.two{grid-template-columns:1fr}main{padding:24px 16px}}
</style></head><body><main><nav><a href="../input-clarity/index.html">由比滨参考增益对照</a><a href="../parameter-sweep/index.html">参数对照</a></nav>
<header><h1>由比滨 · 直接输入 44.1 kHz</h1><p>同源完整 23.82 秒，参考增益按档位对应，固定 Seed 42 / CFG 2.5 / 10 步。逐档比较提前转换与程序内部转换。</p></header>
''' + f'<div class="text"><p class="japanese" lang="ja">{html.escape(request["text"]["text"])}</p>' + \
        '<p class="meaning">中文含义：稍微坐下来休息一下吧。茶还温热，请慢慢喝。今天的事，明天再想也没关系。</p></div>' + \
        ''.join(groups) + '<details class="transcript"><summary>参考音频日语原文</summary><p lang="ja">' + \
        html.escape(request['reference']['promptText']) + '''</p></details>
<footer>生成试听只作固定音量匹配；原生 WAV 可单独下载。折叠参考保留实际输入音量。</footer></main>
<script>document.addEventListener('play',function(event){if(event.target.tagName==='AUDIO'){document.querySelectorAll('audio').forEach(function(audio){if(audio!==event.target)audio.pause();});}},true);</script></body></html>'''


def finalize(selected):
    if not selected or len(set(selected)) != len(selected) or any(x not in IDS for x in selected):
        raise ValueError('Select one or more unique original/plus3/plus6 groups explicitly')
    selected = [x for x in IDS if x in selected]
    preparation_identity, design_identity = common.info(PREPARATION), common.info(DESIGN)
    preparation, design = common.read_json(PREPARATION), common.read_json(DESIGN)
    for key in ('sources_unchanged', 'full_input_used', 'all_old_16k_candidates_pcm_reproduced_exactly',
                'all_frames_preserved', 'all_outputs_unclipped'):
        if preparation.get(key) is not True:
            raise ValueError(f'Input preparation did not verify {key}')
    for key in ('trim', 'padding', 'eq', 'denoise', 'limiter', 'gain_compensation', 'rms_matching', 'upsampling_from_16k'):
        if preparation.get(key) is not False:
            raise ValueError(f'Input preparation unexpectedly used {key}')
    if preparation['initial_gain_linear'] != 1.0:
        raise ValueError('The full Yui source initial gain must remain unity')
    prepared = {x['id']: x for x in preparation['variants']}
    designed = {x['id']: x for x in design['variants']}
    for choice in selected:
        ref_id = 'yui-direct-44100-' + choice
        if ref_id not in prepared or ref_id not in designed:
            raise ValueError('Selected candidate is absent from preparation/design')
        if prepared[ref_id]['input']['sha256'] != designed[ref_id]['input']['sha256'] or not designed[ref_id].get('selected_for_generation'):
            raise ValueError('Selected preparation and design disagree')
        if prepared[ref_id].get('old_16k_pcm_reproduced_exactly') is not True or prepared[ref_id].get('independent_from_original_gain1_pcm') is not True:
            raise ValueError('Variant gain chain was not verified against the matching old baseline')
        if prepared[ref_id]['initial_gain_linear'] != 1.0 or prepared[ref_id]['initial_gain_db'] != 0.0:
            raise ValueError('Variant initial gain differs from the matching old baseline')
    baselines, prior_identity = load_baselines(selected, prepared)
    protected = [common.info(p) for p in ROOT.rglob('*') if p.is_file() and OUTPUT not in p.parents]
    existing = common.read_json(RECEIPT) if RECEIPT.exists() else None
    if existing and existing['selected_ids'] != selected:
        raise ValueError('Changing an already published selection requires a separate reviewed delivery')
    previous = {x['id']: x for x in (existing or {}).get('generated', [])}
    page = OUTPUT / 'index.html'
    page_before = common.info(page) if page.exists() else None
    if page_before and (not existing or existing['index'] != page_before):
        raise ValueError('Existing direct-input page was edited; refusing to overwrite')
    for folder in ('raw', 'listen', 'references'):
        (OUTPUT / folder).mkdir(parents=True, exist_ok=True)
    commands, rows, pairs = [], [], []
    for choice in selected:
        old = baselines[choice]
        new = new_take(choice, prepared['yui-direct-44100-' + choice], old['request'],
                       previous.get('yui-direct-44100-' + choice), commands)
        pair_rows = [old['row'], new]
        pairs.append({'choice': choice, 'rows': pair_rows})
        rows.extend(pair_rows)
    request = baselines[selected[0]]['request']
    if any(x['request']['text'] != request['text'] or x['request']['reference']['promptText'] != request['reference']['promptText'] for x in baselines.values()):
        raise ValueError('Gain groups should share one target/transcript')
    source = build_html(request, pairs)
    parser = common.LinkParser()
    parser.feed(source)
    links = []
    for link in sorted(set(parser.links)):
        parsed = urlparse(link)
        if parsed.scheme or parsed.netloc:
            raise ValueError('Direct-input page must only link to local listening assets')
        path = (OUTPUT / unquote(parsed.path)).resolve(strict=True)
        if ROOT.resolve() not in path.parents or not path.is_file():
            raise ValueError(f'Invalid local link: {link}')
        links.append(common.info(path))
    for item in protected + [preparation_identity, design_identity, prior_identity]:
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
    result = {'status': 'complete' if len(complete) == len(selected) * 2 else 'partial_generation_page_complete', 'at': common.now(),
              'script': common.info(Path(__file__)), 'preparation': preparation_identity, 'design': design_identity,
              'prior_package': prior_identity, 'selected_ids': selected, 'generated': rows,
              'playable_generated_count': len(complete), 'new_generated_count': sum(not x['existing'] for x in complete),
              'reused_count': len(selected), 'index': common.info(page), 'links': links,
              'existing_assets_preserved': protected, 'commands': commands,
              'new_model_runs': 0, 'browser_opened': False, 'subjective_listening_performed': False}
    common.write_json(RECEIPT, result)
    verification = {'status': 'published_delivery_verified', 'at': common.now(), 'index': result['index'],
                    'package_receipt': common.info(RECEIPT), 'selected_ids': selected,
                    'playable_generated_count': len(complete), 'new_generated_count': result['new_generated_count'],
                    'reused_count': len(selected), 'local_links_verified': len(links),
                    'existing_assets_preserved': len(protected),
                    'rows': [{'id': x['id'], 'existing': x['existing'], **x['static_gain_verification']} for x in complete],
                    'new_model_runs': 0, 'browser_opened': False}
    common.write_json(QA / 'delivery-verification.json', verification)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['finalize'])
    parser.add_argument('--ids', nargs='+', choices=IDS, required=True)
    args = parser.parse_args()
    result = finalize(args.ids)
    print(json.dumps({'status': result['status'], 'selected_ids': result['selected_ids'],
                      'new_generated_count': result['new_generated_count'], 'playable_generated_count': result['playable_generated_count'],
                      'index': result['index']}, ensure_ascii=False))
