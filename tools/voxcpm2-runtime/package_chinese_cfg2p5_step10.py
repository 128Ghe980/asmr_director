"""Package two Chinese sentences for two voices from finished native takes.

Generation audio is preserved exactly in raw; listening copies receive only
whole-file static gain. Reference players reuse the prior verified deliveries.
This script never runs models, ASR, browsers or reference processing.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import unicodedata
from pathlib import Path
from urllib.parse import unquote, urlparse

import package_reference_comparison as common
from package_japanese_listening import verify_static_gain

QA = common.QA / 'chinese-cfg2p5-step10'
ROOT = common.OUTPUT
OUTPUT = ROOT / 'chinese-cfg2p5-step10'
RECEIPT = QA / 'package-receipt.json'
ROLES = {'yukinoshita': '雪之下', 'yuigahama': '由比滨 · 02'}
TEXTS = {
    'chinese-rest': {'title': '坐下休息', 'text': '先坐下来休息一下吧，我给你倒杯温水。'},
    'chinese-comfort': {'title': '今天辛苦了', 'text': '今天已经很努力了，剩下的事情明天再慢慢想，好吗？'},
}


def relative(path):
    return Path(os.path.relpath(Path(path).resolve(), OUTPUT.resolve())).as_posix()


def check_file(item):
    path = Path(item['path'])
    if path.stat().st_size != item['bytes'] or common.digest(path) != item['sha256']:
        raise ValueError(f'File identity changed: {path}')
    return path


def load_anchors():
    snow_path = common.QA / 'parameter-sweep/package-receipt.json'
    yui_path = common.QA / 'yui-reference-02/package-receipt.json'
    snow_package, yui_package = common.read_json(snow_path), common.read_json(yui_path)
    snow = next(x for x in snow_package['generated'] if x['id'] == 'yukino-cfg2p5-step10')
    yui = next(x for x in yui_package['generated'] if x['id'] == 'yui-reference-02')
    snow_ref = snow_package['references']['yukinoshita']
    anchors = {
        'yukinoshita': {'generation_receipt': snow['generation_receipt'], 'seed': 43,
                       'source_preview': snow_ref['original'], 'source_preview_metrics': snow_ref['original_metrics'],
                       'model_input': snow_ref['model_input'], 'model_input_metrics': snow_ref['model_input_metrics']},
        'yuigahama': {'generation_receipt': yui['generation_receipt'], 'seed': 42,
                     'source_preview': yui['source_preview'], 'source_preview_metrics': yui['source_preview_metrics'],
                     'model_input': yui['model_input'], 'model_input_metrics': yui['model_input_metrics']},
    }
    for role, anchor in anchors.items():
        for key in ('generation_receipt', 'source_preview', 'model_input'):
            check_file(anchor[key])
        receipt = common.read_json(Path(anchor['generation_receipt']['path']))
        request = receipt['request']
        if receipt['status'] != 'complete' or receipt['exit_code'] != 0:
            raise ValueError(f'Prior voice configuration did not complete: {role}')
        if (request['seed'], request['mode'], request['parameters']['cfg'], request['parameters']['timesteps']) != (anchor['seed'], 'combined', 2.5, 10):
            raise ValueError(f'Wrong prior voice settings: {role}')
        check_file(request['reference']['file'])
        if request['reference']['file']['sha256'] != anchor['model_input']['sha256']:
            raise ValueError('Delivered reference does not match the actual model input')
        fmt = common.wav_format(Path(anchor['model_input']['path']))
        if (fmt['sample_rate'], fmt['channels'], fmt['sample_width_bytes']) != (16000, 1, 2):
            raise ValueError('This round must use preconverted 16 kHz mono PCM16 inputs')
        anchor['request'] = request
        anchor['prompt_text'] = request['reference']['promptText']
    return anchors, [common.info(snow_path), common.info(yui_path)]


def load_plan(anchors):
    identities = [common.info(QA / name) for name in ('design.json', 'manifest.json')]
    design = common.read_json(QA / 'design.json')
    master = common.read_json(QA / 'manifest.json')
    if design['master_is_executable'] is not False or master['master_is_executable'] is not False:
        raise ValueError('The four-case index must not be an executable manifest')
    for key in ('roles', 'targets', 'cases'):
        if design[key] != master[key]:
            raise ValueError(f'Design and master index disagree: {key}')
    if design['targets'] != [{'id': key, 'text': value['text']} for key, value in TEXTS.items()]:
        raise ValueError('Design changed the requested Chinese sentences')
    for role, anchor in anchors.items():
        planned = design['roles'][role]
        for key in ('input', 'source_preview', 'anchor_receipt', 'baseline_package_receipt'):
            check_file(planned[key])
            identities.append(planned[key])
        if planned['input']['sha256'] != anchor['model_input']['sha256'] or planned['source_preview']['sha256'] != anchor['source_preview']['sha256']:
            raise ValueError('Design reference differs from the verified prior delivery')
    jobs = []
    for case in design['cases']:
        manifest_path = check_file(case['manifest'])
        identity = common.info(manifest_path)
        identities.append(identity)
        manifest = common.read_json(manifest_path)
        if len(manifest['references']) != 1 or len(manifest['texts']) != 1:
            raise ValueError('Each guarded job must contain one voice and one sentence')
        reference, target = manifest['references'][0], manifest['texts'][0]
        if target['id'] not in TEXTS or target['text'] != TEXTS[target['id']]['text']:
            raise ValueError('Guarded manifest changed the requested Chinese target')
        input_info = common.info(Path(reference['path']))
        matches = [role for role, anchor in anchors.items() if input_info['sha256'] == anchor['model_input']['sha256']]
        if len(matches) != 1:
            raise ValueError('Unknown or ambiguous reference input')
        role = matches[0]
        anchor = anchors[role]
        if (manifest['seed'], manifest['cfg'], manifest.get('timesteps', 10)) != (anchor['seed'], 2.5, 10):
            raise ValueError(f'Wrong fixed generation parameters: {role}')
        if reference['mode'] != 'combined' or reference['promptText'] != anchor['prompt_text']:
            raise ValueError('Changed combined mode or Japanese reference transcript')
        if case['role'] != role or case['target'] != target or case['reference'] != reference or case['input'] != input_info:
            raise ValueError('Case metadata differs from its executable manifest')
        take = QA / 'generation/audio' / reference['id'] / target['id'] / 'take-001'
        if take.resolve() != Path(case['expected_take_directory']).resolve() or (take / 'generated.wav').resolve() != Path(case['expected_generated_wav']).resolve():
            raise ValueError('Case expected output path does not match the generation layout')
        jobs.append({'id': case['id'], 'role': role, 'reference': reference, 'text': target,
                     'manifest': identity, 'input': input_info, 'initial_take_directory': str(take)})
    expected = {(role, text_id) for role in ROLES for text_id in TEXTS}
    actual = [(x['role'], x['text']['id']) for x in jobs]
    if len(actual) != 4 or set(actual) != expected:
        raise ValueError('Expected exactly two Chinese sentences for each of the two voices')
    selected = design.get('selected_successful_takes', {})
    selection_path = QA / 'selection.json'
    if selection_path.exists():
        selection_identity = common.info(selection_path)
        selection = common.read_json(selection_path)
        explicit = selection['selections']
        if len(explicit) != len(jobs) or {x['id'] for x in explicit} != {x['id'] for x in jobs}:
            raise ValueError('Selection evidence must name all four successful cases exactly once')
        from_file = {x['id']: x['receipt'] for x in explicit}
        if selected and selected != from_file:
            raise ValueError('Design and independent selection evidence disagree')
        selected = from_file
        identities.append(selection_identity)
        for item in explicit:
            if item.get('take_directory') and Path(item['take_directory']).resolve() != Path(item['receipt']['path']).parent.resolve():
                raise ValueError('Selection take directory differs from its receipt')
    if not isinstance(selected, dict) or set(selected) - {x['id'] for x in jobs}:
        raise ValueError('Selected successful takes must map known case IDs to receipt identities')
    for job in jobs:
        selection = selected.get(job['id'])
        if selection:
            receipt_path = check_file(selection)
            initial = Path(job['initial_take_directory'])
            selected_take = receipt_path.parent
            if receipt_path.name != 'receipt.json' or selected_take.parent.resolve() != initial.parent.resolve() or not re.fullmatch(r'take-\d{3}', selected_take.name):
                raise ValueError('Explicitly selected receipt does not belong to this case')
            if int(selected_take.name[5:]) < 1:
                raise ValueError('Selected take number must be positive')
            job['selected_receipt'] = selection
            identities.append(selection)
    return sorted(jobs, key=lambda x: (list(TEXTS).index(x['text']['id']), list(ROLES).index(x['role']))), identities


def package_take(job, anchor, previous, commands):
    receipt_path = (check_file(job['selected_receipt']) if job.get('selected_receipt') else
                    Path(job['initial_take_directory']) / 'receipt.json')
    take = receipt_path.parent
    if not receipt_path.exists():
        raise ValueError(f'Chinese take is not yet generated: {job["id"]}')
    receipt = common.read_json(receipt_path)
    if receipt['status'] != 'complete' or receipt['exit_code'] != 0:
        raise ValueError(f'Chinese generation did not complete: {job["id"]}')
    actual = receipt['request']
    for key in ('seed', 'mode', 'parameters', 'profile', 'files'):
        if actual[key] != anchor['request'][key]:
            raise ValueError(f'{job["id"]} changed fixed generation {key}')
    if actual['text'] != job['text']:
        raise ValueError('Native target differs from its approved Chinese sentence')
    ref = actual['reference']
    if ref['id'] != job['reference']['id'] or ref['promptText'] != anchor['prompt_text'] or ref['mode'] != 'combined':
        raise ValueError('Native take used an unexpected reference or transcript')
    if ref['file']['sha256'] != job['input']['sha256'] or Path(ref['file']['path']).resolve() != Path(job['input']['path']).resolve():
        raise ValueError('Native take did not use the exact prepared reference')
    check_file(ref['file'])
    for key in ('output', 'stdout', 'stderr'):
        check_file(receipt[key])
    source = Path(receipt['output']['path'])
    if source.resolve() != (take / 'generated.wav').resolve():
        raise ValueError('Native output path does not match this take')
    raw = OUTPUT / 'raw' / (job['id'] + '.wav')
    common.copy_verified(source, raw)
    measured = common.loudness(raw, commands)
    gain = min(-23 - measured['integrated_lufs'], -1 - measured['true_peak_dbtp'])
    listen = OUTPUT / 'listen' / raw.name
    if listen.exists():
        common.verify_reusable_listen(previous, source, raw, listen, gain)
    else:
        common.render_gain(raw, listen, gain, 'pcm_s16le', commands)
    raw_metrics, listen_metrics = common.metrics(raw, commands), common.metrics(listen, commands)
    if raw_metrics['full_scale_samples'] or listen_metrics['full_scale_samples']:
        raise ValueError('Native or listening take has full-scale samples')
    return {'id': job['id'], 'role': job['role'], 'reference_id': job['reference']['id'], 'text': job['text'],
            'seed': actual['seed'], 'cfg': 2.5, 'timesteps': 10, 'mode': 'combined', 'status': 'complete',
            'selected_take': take.name, 'initial_take_directory': job['initial_take_directory'],
            'manifest': job['manifest'], 'generation_receipt': common.info(receipt_path),
            'source': common.info(source), 'raw': common.info(raw), 'listen': common.info(listen), 'gain_db': gain,
            'input_loudness': measured, 'output_loudness': common.loudness(listen, commands),
            'metrics': raw_metrics, 'listen_metrics': listen_metrics,
            'static_gain_verification': verify_static_gain(raw, listen, gain)}


def attach_asr(rows):
    evidence_path = QA / 'generated-asr.json'
    evidence = common.read_json(evidence_path)
    by_path = {Path(x['path']).resolve(): x for x in evidence['files']}
    if len(by_path) != len(rows) or set(by_path) != {Path(x['source']['path']).resolve() for x in rows}:
        raise ValueError('ASR evidence does not name exactly the four selected native outputs')
    def normalized(text):
        return ''.join(c for c in text if not c.isspace() and not unicodedata.category(c).startswith('P'))
    for row in rows:
        recognized = by_path[Path(row['source']['path']).resolve()]['text']
        row['asr'] = {'text': recognized, 'language_setting': evidence['language'],
                      'matches_target_ignoring_punctuation': normalized(recognized) == normalized(row['text']['text'])}
    return common.info(evidence_path)


def build_html(rows, anchors):
    sections = []
    for text_id, sentence in TEXTS.items():
        cards = []
        for row in (x for x in rows if x['text']['id'] == text_id):
            cards.append(common.player(ROLES[row['role']], relative(row['listen']['path']), row['metrics']['duration_seconds'],
                                       relative(row['raw']['path']), '下载原生 WAV'))
        sections.append(f'<section class="sentence"><h2>{html.escape(sentence["title"])}</h2>'
                        f'<p class="target"><span class="meta">目标文案：</span>{html.escape(sentence["text"])}</p><div class="grid">' + ''.join(cards) + '</div></section>')
    reference_cards = []
    for role, anchor in anchors.items():
        source = common.player('原品质预听 · 44.1 kHz 双声道', relative(anchor['source_preview']['path']),
                               anchor['source_preview_metrics']['duration_seconds'], download_label='下载原品质预听')
        model = common.player('实际输入 · 16 kHz 单声道', relative(anchor['model_input']['path']),
                              anchor['model_input_metrics']['duration_seconds'], download_label='下载实际输入')
        note = '25.10 秒 · 参考降低 6 dB · Seed 43' if role == 'yukinoshita' else '20.22 秒 · 02 参考原音量 · Seed 42'
        reference_cards.append(f'<section><h3>{html.escape(ROLES[role])}</h3><p class="meta">{note}</p>' + source + model
                               + f'<p class="transcript" lang="ja">{html.escape(anchor["prompt_text"])}</p></section>')
    return '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>雪之下与由比滨 · 中文试听</title>
<style>
:root{color-scheme:light;--ink:#24332e;--muted:#647268;--line:#d5dfd5;--accent:#356c51}
*{box-sizing:border-box}body{margin:0;background:#f2f5ef;color:var(--ink);font:16px/1.75 "Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:1080px;margin:auto;padding:36px 26px}a{color:var(--accent);text-underline-offset:3px}nav{font-size:13px;margin-bottom:24px;display:flex;gap:20px;flex-wrap:wrap}
header{padding-bottom:24px;border-bottom:1px solid var(--line)}h1{font-size:clamp(26px,4vw,38px);margin:8px 0 12px}header p{margin:0;color:var(--muted)}
.sentence{margin:28px 0}h2{font-size:24px;margin:0 0 6px}.target{font-size:19px;margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;align-items:start}
.player{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;min-width:0;margin:0 0 14px}.player-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.player h3{font-size:16px;margin:0 0 10px}.player-top span{font-size:12px;white-space:nowrap;color:var(--muted)}
audio{width:100%;display:block;height:42px}.download{display:inline-block;margin-top:9px;font-size:12px}details{border-top:1px solid var(--line);padding:18px 0;color:var(--muted);font-size:14px}summary{cursor:pointer;color:var(--ink)}details .grid{margin-top:20px}.meta{font-size:13px;margin-top:0}.transcript{line-height:1.9}details h3{margin:0 0 6px}
footer{margin-top:12px;color:var(--muted);font-size:12px}summary:focus-visible,a:focus-visible,audio:focus-visible{outline:3px solid #619b78;outline-offset:4px}
@media(max-width:700px){.grid{grid-template-columns:1fr}main{padding:24px 16px}}
</style></head><body><main><nav><a href="../japanese/parameter-sweep/index.html">日语参数对照</a><a href="../japanese/yui-reference-02-sentences/index.html">由比滨 02 日语多句</a></nav>
<header><h1>雪之下与由比滨 · 中文试听</h1><p>沿用两人的完整日语参考和对应原文，生成两句中文。CFG 2.5 / 10 步。</p></header>
''' + ''.join(sections) + '<details><summary>完整参考音频与日语原文</summary><div class="grid">' + ''.join(reference_cards) + '''</div></details>
<footer>四条生成试听统一作固定音量匹配，原生 WAV 可单独下载。折叠参考保留各自实际音量。</footer></main>
<script>document.addEventListener('play',function(event){if(event.target.tagName==='AUDIO'){document.querySelectorAll('audio').forEach(function(audio){if(audio!==event.target)audio.pause();});}},true);</script></body></html>'''


def finalize():
    anchors, anchor_identities = load_anchors()
    jobs, identities = load_plan(anchors)
    protected = [common.info(p) for p in ROOT.rglob('*') if p.is_file() and OUTPUT not in p.parents]
    existing = common.read_json(RECEIPT) if RECEIPT.exists() else None
    previous = {x['id']: x for x in (existing or {}).get('generated', [])}
    page = OUTPUT / 'index.html'
    page_before = common.info(page) if page.exists() else None
    if page_before and (not existing or existing['index'] != page_before):
        raise ValueError('Existing Chinese page was edited; refusing to overwrite')
    for folder in ('raw', 'listen'):
        (OUTPUT / folder).mkdir(parents=True, exist_ok=True)
    commands = []
    rows = [package_take(job, anchors[job['role']], previous.get(job['id']), commands) for job in jobs]
    asr_identity = attach_asr(rows)
    identities.append(asr_identity)
    source = build_html(rows, anchors)
    parser = common.LinkParser()
    parser.feed(source)
    if len(parser.audio) != 8:
        raise ValueError('Expected four generated players and four folded reference players')
    links = []
    for link in sorted(set(parser.links)):
        parsed = urlparse(link)
        if parsed.scheme or parsed.netloc:
            raise ValueError('Chinese page must link only to local listening assets')
        path = (OUTPUT / unquote(parsed.path)).resolve(strict=True)
        if ROOT.resolve() not in path.parents or not path.is_file():
            raise ValueError(f'Invalid local link: {link}')
        links.append(common.info(path))
    for item in protected + identities + anchor_identities:
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
              'inputs': identities, 'prior_packages': anchor_identities, 'references': anchors,
              'generated': rows, 'new_generated_count': len(rows), 'playable_generated_count': len(rows),
              'asr_evidence': asr_identity, 'content_review_needed': any(not x['asr']['matches_target_ignoring_punctuation'] for x in rows),
              'index': common.info(page), 'links': links, 'existing_assets_preserved': protected,
              'commands': commands, 'new_model_runs': 0, 'browser_opened': False,
              'subjective_listening_performed': False}
    common.write_json(RECEIPT, result)
    common.write_json(QA / 'delivery-verification.json', {
        'status': 'published_delivery_verified', 'at': common.now(), 'index': result['index'],
        'package_receipt': common.info(RECEIPT), 'new_generated_count': len(rows),
        'local_links_verified': len(links), 'existing_assets_preserved': len(protected),
        'rows': [{'id': x['id'], **x['static_gain_verification']} for x in rows],
        'new_model_runs': 0, 'browser_opened': False,
    })
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['finalize'])
    parser.parse_args()
    result = finalize()
    print(json.dumps({'status': result['status'], 'new_generated_count': result['new_generated_count'],
                      'index': result['index']}, ensure_ascii=False))
