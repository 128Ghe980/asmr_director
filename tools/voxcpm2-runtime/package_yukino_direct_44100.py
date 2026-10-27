"""Compare the verified 16 kHz baseline with one direct 44.1 kHz input take.

No model, ASR or browser calls. Input reference files retain their real levels;
the generated comparison audio is copied verbatim plus a fixed-gain audition.
"""
from __future__ import annotations

import argparse
import html
import json
import math
import os
from pathlib import Path
from urllib.parse import unquote, urlparse

import package_reference_comparison as common
from package_japanese_listening import verify_static_gain

QA = common.QA / 'yukino-direct-44100'
ROOT = common.OUTPUT
OUTPUT = ROOT / 'japanese/yukino-direct-44100'
PREPARATION = QA / 'preparation.json'
DESIGN = QA / 'design.json'
RECEIPT = QA / 'package-receipt.json'
BASELINE_ID = 'yukino-cfg2p5-step10'
NEW_ID = 'yukino-direct-44100'
TEXT_ID = 'japanese-paragraph'


def relative(path):
    return Path(os.path.relpath(Path(path).resolve(), OUTPUT.resolve())).as_posix()


def check_file(item):
    path = Path(item['path'])
    if path.stat().st_size != item['bytes'] or common.digest(path) != item['sha256']:
        raise ValueError(f'File identity changed: {path}')
    return path


def baseline():
    package_path = common.QA / 'parameter-sweep/package-receipt.json'
    package = common.read_json(package_path)
    generated = next(x for x in package['generated'] if x['id'] == BASELINE_ID)
    for key in ('generation_receipt', 'source', 'raw', 'listen'):
        check_file(generated[key])
    receipt = common.read_json(Path(generated['generation_receipt']['path']))
    request = receipt['request']
    if receipt['status'] != 'complete' or receipt['exit_code'] != 0:
        raise ValueError('Required baseline is not complete')
    if request['seed'] != 43 or request['mode'] != 'combined' or request['parameters']['cfg'] != 2.5 or request['parameters']['timesteps'] != 10:
        raise ValueError('Wrong Snow seed43/CFG2.5/10 baseline')
    check_file(request['reference']['file'])
    if receipt['output']['sha256'] != generated['raw']['sha256']:
        raise ValueError('Baseline delivered raw differs from native output')
    reference = package['references']['yukinoshita']['model_input']
    check_file(reference)
    if reference['sha256'] != request['reference']['file']['sha256']:
        raise ValueError('Published baseline reference is not the exact generation input')
    fmt = common.wav_format(Path(reference['path']))
    if (fmt['sample_rate'], fmt['channels'], fmt['sample_width_bytes'], fmt['frames']) != (16000, 1, 2, 401600):
        raise ValueError('Expected full 25.10 second 16 kHz mono PCM16 baseline reference')
    result = dict(generated, label='提前转换为 16 kHz', existing=True,
                  reference=reference, reference_metrics=fmt,
                  static_gain_verification=verify_static_gain(Path(generated['raw']['path']), Path(generated['listen']['path']), generated['gain_db']))
    return result, request, common.info(package_path)


def validate_preparation(preparation, design, baseline_row, request):
    for key in ('baseline_initial_pcm16_reproduced_exactly', 'baseline_minus6_pcm16_reproduced_exactly',
                'same_continuous_segment', 'all_frames_preserved', 'all_outputs_unclipped'):
        if preparation.get(key) is not True:
            raise ValueError(f'Input preparation did not verify {key}')
    for key in ('eq', 'denoise', 'limiter', 'gain_compensation', 'rms_matching'):
        if preparation.get(key) is not False:
            raise ValueError(f'Input preparation unexpectedly used {key}')
    for key in ('initial_gain_linear', 'initial_gain_db', 'second_gain_db', 'second_gain_linear'):
        if not math.isclose(preparation['direct_gain_stages'][key], preparation['baseline_gain_stages'][key], abs_tol=1e-12):
            raise ValueError('Direct-input gain differs from the baseline gain')
    if not math.isclose(preparation['direct_gain_stages']['initial_gain_db'], -1.0700021698755942, abs_tol=1e-12) or preparation['direct_gain_stages']['second_gain_db'] != -6:
        raise ValueError('The mono baseline gain sequence was not retained')
    if design['baseline']['files']['receipt.json'] != baseline_row['generation_receipt']:
        raise ValueError('Design baseline differs from the exact reused baseline')
    if design['baseline']['input']['sha256'] != request['reference']['file']['sha256'] or design['variant']['input']['sha256'] != preparation['input']['sha256']:
        raise ValueError('Design inputs differ from verified baseline/preparation')
    for item in design['baseline']['files'].values():
        check_file(item)
    check_file(design['baseline']['input'])
    check_file(design['variant']['input'])


def prepare_new(preparation, request, previous, commands):
    model = check_file(preparation['input'])
    manifest_path = check_file(preparation['manifest'])
    manifest = common.read_json(manifest_path)
    if len(manifest['references']) != 1 or manifest['references'][0]['id'] != NEW_ID:
        raise ValueError('Expected the one direct-44.1kHz reference')
    reference = manifest['references'][0]
    if manifest['texts'] != [request['text']] or manifest['seed'] != 43 or manifest['cfg'] != 2.5 or manifest.get('timesteps', 10) != 10:
        raise ValueError('Direct-input experiment changed target or generation settings')
    if reference['mode'] != 'combined' or reference['promptText'] != request['reference']['promptText']:
        raise ValueError('Direct-input experiment changed mode or transcript')
    if Path(reference['path']).resolve() != model.resolve():
        raise ValueError('Manifest input differs from prepared reference')
    fmt = common.wav_format(model)
    if (fmt['sample_rate'], fmt['channels'], fmt['sample_width_bytes'], fmt['frames']) != (44100, 1, 2, 1106910):
        raise ValueError('Expected full 25.10 second 44.1 kHz mono PCM16 input')
    destination = OUTPUT / 'references/direct-44100.wav'
    common.copy_verified(model, destination)
    result = {'id': NEW_ID, 'label': '直接输入 44.1 kHz', 'existing': False,
              'reference': common.info(destination), 'reference_metrics': fmt,
              'manifest': common.info(manifest_path)}
    receipt_path = QA / 'generation/audio' / NEW_ID / TEXT_ID / 'take-001/receipt.json'
    if not receipt_path.exists() or common.read_json(receipt_path).get('status') != 'complete':
        return dict(result, status='not_completed')
    receipt = common.read_json(receipt_path)
    actual = receipt['request']
    if receipt['exit_code'] != 0:
        raise ValueError('Direct-input native take exited unsuccessfully')
    for key in ('text', 'seed', 'mode', 'parameters', 'profile', 'files'):
        if actual[key] != request[key]:
            raise ValueError(f'Direct input changed the fixed generation {key}')
    if actual['reference']['id'] != NEW_ID or actual['reference']['promptText'] != request['reference']['promptText']:
        raise ValueError('Native reference ID/transcript differs')
    if actual['reference']['file']['sha256'] != preparation['input']['sha256'] or Path(actual['reference']['file']['path']).resolve() != model.resolve():
        raise ValueError('Native process did not use the prepared direct input')
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


def build_html(request, rows):
    cards = []
    for row in rows:
        generated = (common.player('生成日语 · 等音量', relative(row['listen']['path']), row['metrics']['duration_seconds'],
                                    relative(row['raw']['path']), '下载原生 WAV') if row['status'] == 'complete' else
                     '<article class="player"><h3>生成日语</h3><p>本次未完成</p></article>')
        reference = common.player('参考输入 · 原始音量', relative(row['reference']['path']),
                                  row['reference_metrics']['duration_seconds'], download_label='下载实际参考')
        note = '文件已是 16 kHz，按相同采样率读取。' if row['existing'] else '44.1 kHz 文件交给程序，内部再转换为 16 kHz。'
        cards.append(f'<section><h2>{html.escape(row["label"])}</h2><p class="route">{note}</p>' + generated
                     + '<details class="reference"><summary>听实际输入文件</summary>' + reference + '</details></section>')
    return '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>雪之下 · 直接输入 44.1 kHz</title>
<style>
:root{color-scheme:light;--ink:#24332e;--muted:#647268;--line:#d5dfd5;--accent:#356c51}
*{box-sizing:border-box}body{margin:0;background:#f2f5ef;color:var(--ink);font:16px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:1120px;margin:auto;padding:36px 26px}a{color:var(--accent);text-underline-offset:3px}nav{font-size:13px;margin-bottom:24px;display:flex;gap:20px;flex-wrap:wrap}
header{padding-bottom:22px;border-bottom:1px solid var(--line)}h1{font-size:clamp(26px,4vw,38px);margin:8px 0 12px}header p{margin:0;color:var(--muted)}
.text{margin:24px 0 30px;padding-left:18px;border-left:3px solid #8bad91}.text p{margin:0}.japanese{font-size:18px}.meaning{margin-top:8px!important;color:var(--muted);font-size:14px}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start}section{min-width:0}h2{font-size:23px;margin:0 0 8px}.route{font-size:13px;color:var(--muted);margin:0 0 18px}.player{background:white;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px;min-width:0}.player-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.player h3{font-size:15px;margin:0 0 12px}.player-top span{font-size:12px;white-space:nowrap;color:var(--muted)}
audio{width:100%;display:block;height:42px}.download{display:inline-block;margin-top:10px;font-size:12px}.reference{font-size:13px;color:var(--muted)}.reference .player{margin-top:14px}summary{cursor:pointer}.transcript{margin-top:28px;border-top:1px solid var(--line);padding-top:18px;font-size:14px;color:var(--muted)}
footer{margin-top:30px;color:var(--muted);font-size:12px}summary:focus-visible,a:focus-visible,audio:focus-visible{outline:3px solid #619b78;outline-offset:4px}
@media(max-width:700px){.two{grid-template-columns:1fr}main{padding:24px 16px}}
</style></head><body><main><nav><a href="../parameter-sweep/index.html">参数对照</a><a href="../input-clarity/index.html">输入清晰度诊断</a></nav>
<header><h1>雪之下 · 直接输入 44.1 kHz</h1><p>同源完整 25.10 秒、相同固定增益和日语原文，固定 Seed 43 / CFG 2.5 / 10 步。比较提前转换与程序内部转换两条路径。</p></header>
''' + f'<div class="text"><p class="japanese" lang="ja">{html.escape(request["text"]["text"])}</p>' + \
        '<p class="meaning">中文含义：稍微坐下来休息一下吧。茶还温热，请慢慢喝。今天的事，明天再想也没关系。</p></div>' + \
        '<div class="two">' + ''.join(cards) + '</div><details class="transcript"><summary>参考音频日语原文</summary><p lang="ja">' + \
        html.escape(request['reference']['promptText']) + '''</p></details>
<footer>两条生成试听只作固定音量匹配；原生 WAV 可单独下载。</footer></main>
<script>document.addEventListener('play',function(event){if(event.target.tagName==='AUDIO'){document.querySelectorAll('audio').forEach(function(audio){if(audio!==event.target)audio.pause();});}},true);</script></body></html>'''


def finalize():
    preparation_identity, design_identity = common.info(PREPARATION), common.info(DESIGN)
    preparation = common.read_json(PREPARATION)
    design = common.read_json(DESIGN)
    previous_row, request, prior_identity = baseline()
    validate_preparation(preparation, design, previous_row, request)
    protected = [common.info(p) for p in ROOT.rglob('*') if p.is_file() and OUTPUT not in p.parents]
    existing = common.read_json(RECEIPT) if RECEIPT.exists() else None
    previous_new = next((x for x in (existing or {}).get('generated', []) if x['id'] == NEW_ID), None)
    page = OUTPUT / 'index.html'
    page_before = common.info(page) if page.exists() else None
    if page_before and (not existing or existing['index'] != page_before):
        raise ValueError('Existing direct-input page was edited; refusing to overwrite')
    for folder in ('raw', 'listen', 'references'):
        (OUTPUT / folder).mkdir(parents=True, exist_ok=True)
    commands = []
    rows = [previous_row, prepare_new(preparation, request, previous_new, commands)]
    source = build_html(request, rows)
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
    result = {'status': 'complete' if len(complete) == 2 else 'partial_generation_page_complete', 'at': common.now(),
              'script': common.info(Path(__file__)), 'preparation': preparation_identity, 'design': design_identity,
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
    parser.parse_args()
    result = finalize()
    print(json.dumps({'status': result['status'], 'new_generated_count': result['new_generated_count'],
                      'playable_generated_count': result['playable_generated_count'], 'index': result['index']}, ensure_ascii=False))
