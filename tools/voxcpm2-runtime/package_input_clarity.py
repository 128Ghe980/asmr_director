"""Package verified Yui input-gain takes and a Snow reference-bandwidth audition.

No model/ASR/browser calls. Generated listening copies get fixed gain only.
The Snow diagnostic adds only an arithmetic channel mean and separate fixed
listening gains; the actual model input remains untouched.
"""
from __future__ import annotations

import argparse
from array import array
import html
import json
import os
from pathlib import Path
from urllib.parse import unquote, urlparse

import package_reference_comparison as common
from package_japanese_listening import verify_static_gain

QA = common.QA / 'input-clarity'
ROOT = common.OUTPUT
OUTPUT = ROOT / 'japanese/input-clarity'
PREPARATION = QA / 'yui-gain-preparation.json'
DIAGNOSIS = QA / 'diagnosis.json'
RECEIPT = QA / 'package-receipt.json'
BASELINE_ID = 'yui-cfg2p5-step10'
TEXT_ID = 'japanese-paragraph'
VARIANTS = [('yui-gain-plus3', 3), ('yui-gain-plus6', 6)]


def relative(path):
    return Path(os.path.relpath(Path(path).resolve(), OUTPUT.resolve())).as_posix()


def check_file(item):
    path = Path(item['path'])
    if path.stat().st_size != item['bytes'] or common.digest(path) != item['sha256']:
        raise ValueError(f'File identity changed: {path}')
    return path


def decode(path, commands):
    result = common.execute(['-loglevel', 'error', '-i', str(path), '-map', '0:a:0',
                             '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], commands)
    return array('f', result.stdout)


def verify_gain(source, target, gain, commands):
    before, after = common.wav_format(source), common.wav_format(target)
    for key in ('frames', 'sample_rate', 'channels', 'sample_width_bytes'):
        if before[key] != after[key]:
            raise ValueError('Fixed gain changed audio content dimensions')
    original, rendered = decode(source, commands), decode(target, commands)
    if len(original) != len(rendered) or len(original) != before['frames'] * before['channels']:
        raise ValueError('Fixed gain sample count differs')
    scale = 2 ** (before['sample_width_bytes'] * 8 - 1)
    ratio = 10 ** (gain / 20)
    error = max(abs(b - a * ratio) for a, b in zip(original, rendered)) * scale
    clipped = sum(abs(x) >= 1 for x in rendered)
    if error > 1.1 or clipped:
        raise ValueError('Fixed gain verification failed')
    return {'max_error_pcm_units': error, 'sample_width_bytes': before['sample_width_bytes'],
            'full_scale_samples': clipped, 'frames': before['frames']}


def align_listen(source, target, codec, previous, commands):
    measured = common.loudness(source, commands)
    gain = min(-23 - measured['integrated_lufs'], -1 - measured['true_peak_dbtp'])
    if target.exists():
        if not previous or abs(previous['gain_db'] - gain) > 1e-8:
            raise ValueError('Unexpected existing diagnostic listening file')
        check_file(previous['listen'])
    else:
        common.render_gain(source, target, gain, codec, commands)
    return {'source': common.info(source), 'listen': common.info(target), 'gain_db': gain,
            'input_loudness': measured, 'output_loudness': common.loudness(target, commands),
            'metrics': common.metrics(target, commands), 'gain_verification': verify_gain(source, target, gain, commands)}


def load_baseline():
    package_path = common.QA / 'parameter-sweep/package-receipt.json'
    package = common.read_json(package_path)
    baseline = next(x for x in package['generated'] if x['id'] == BASELINE_ID)
    for key in ('generation_receipt', 'source', 'raw', 'listen'):
        check_file(baseline[key])
    receipt = common.read_json(Path(baseline['generation_receipt']['path']))
    if receipt['status'] != 'complete' or receipt['exit_code'] != 0:
        raise ValueError('Yui baseline is not complete')
    request = receipt['request']
    if request['mode'] != 'combined' or request['seed'] != 42 or request['parameters']['cfg'] != 2.5 or request['parameters']['timesteps'] != 10:
        raise ValueError('Wrong baseline settings')
    check_file(request['reference']['file'])
    if receipt['output']['sha256'] != baseline['raw']['sha256']:
        raise ValueError('Baseline delivered raw is not the native output')
    return baseline, request, common.info(package_path)


def new_take(row, request, previous, commands):
    manifest_path = check_file(row['manifest'])
    manifest = common.read_json(manifest_path)
    if len(manifest['references']) != 1 or manifest['references'][0]['id'] != row['id']:
        raise ValueError('Expected exactly the declared gain variant')
    reference = manifest['references'][0]
    if manifest['texts'] != [request['text']] or manifest['seed'] != 42 or manifest['cfg'] != 2.5 or manifest.get('timesteps', 10) != 10:
        raise ValueError('Gain comparison must retain seed, target, CFG and timesteps')
    if reference['mode'] != 'combined' or reference['promptText'] != request['reference']['promptText']:
        raise ValueError('Gain comparison changed mode/transcript')
    model = check_file(row['model'])
    if model.resolve() != Path(reference['path']).resolve():
        raise ValueError('Prepared gain input does not match the execution manifest')
    model_input = OUTPUT / 'reference-inputs' / (row['id'] + '.wav')
    common.copy_verified(model, model_input)
    reference_gain_check = verify_gain(Path(request['reference']['file']['path']), model_input, row['gain_db'], commands)
    input_metrics = common.metrics(model_input, commands)
    receipt_path = QA / 'generation/audio' / row['id'] / TEXT_ID / 'take-001/receipt.json'
    basic = {'id': row['id'], 'gain_db': row['gain_db'], 'model_input': common.info(model_input),
             'model_input_metrics': input_metrics, 'reference_gain_verification': reference_gain_check,
             'manifest': common.info(manifest_path), 'label': f'参考音量 +{row["gain_db"]:g} dB'}
    if not receipt_path.exists() or common.read_json(receipt_path).get('status') != 'complete':
        return dict(basic, status='not_completed')
    receipt = common.read_json(receipt_path)
    actual = receipt['request']
    if receipt['exit_code'] != 0:
        raise ValueError('Completed native take has a nonzero exit')
    for key in ('text', 'seed', 'mode', 'parameters', 'profile', 'files'):
        if actual[key] != request[key]:
            raise ValueError(f'Gain variant changed {key}')
    if actual['reference']['id'] != row['id'] or actual['reference']['promptText'] != request['reference']['promptText']:
        raise ValueError('Gain variant reference declaration differs')
    if actual['reference']['file']['sha256'] != row['model']['sha256'] or Path(actual['reference']['file']['path']).resolve() != model.resolve():
        raise ValueError('Native process did not use the declared gain input')
    check_file(actual['reference']['file'])
    for key in ('output', 'stdout', 'stderr'):
        check_file(receipt[key])
    source = Path(receipt['output']['path'])
    raw = OUTPUT / 'raw' / (row['id'] + '.wav')
    common.copy_verified(source, raw)
    measured = common.loudness(raw, commands)
    gain = min(-23 - measured['integrated_lufs'], -1 - measured['true_peak_dbtp'])
    listen = OUTPUT / 'listen' / raw.name
    if listen.exists():
        common.verify_reusable_listen(previous, source, raw, listen, gain)
    else:
        common.render_gain(raw, listen, gain, 'pcm_s16le', commands)
    return dict(basic, status='complete', generation_receipt=common.info(receipt_path), source=common.info(source),
                raw=common.info(raw), listen=common.info(listen), reference_gain_db=row['gain_db'], gain_db=gain,
                input_loudness=measured, output_loudness=common.loudness(listen, commands),
                metrics=common.metrics(raw, commands), listen_metrics=common.metrics(listen, commands),
                static_gain_verification=verify_static_gain(raw, listen, gain))


def prepare_snow(existing, commands):
    diagnosis = common.read_json(DIAGNOSIS)
    prior = common.read_json(common.QA / 'reference-refinement/package-receipt.json')
    reference = next(x for x in prior['references'] if x['id'] == 'yukino25-gain-minus6')
    stereo = check_file(reference['original'])
    actual = check_file(reference['model_input'])
    if common.digest(stereo) != diagnosis['inputs']['minus6_preview']['sha256'] or common.digest(actual) != diagnosis['inputs']['minus6_model']['sha256']:
        raise ValueError('Snow diagnostic does not match the diagnosed source/actual input')
    stereo_fmt, actual_fmt = common.wav_format(stereo), common.wav_format(actual)
    if (stereo_fmt['sample_rate'], stereo_fmt['channels'], stereo_fmt['sample_width_bytes']) != (44100, 2, 3):
        raise ValueError('Expected original PCM24 44.1 kHz stereo minus-6 preview')
    if (actual_fmt['sample_rate'], actual_fmt['channels'], actual_fmt['sample_width_bytes']) != (16000, 1, 2):
        raise ValueError('Expected actual PCM16 16 kHz mono model input')
    if stereo_fmt['duration_seconds'] != 25.1 or actual_fmt['duration_seconds'] != 25.1:
        raise ValueError('Snow diagnostic must retain the full 25.10 seconds')
    mono = OUTPUT / 'diagnostic/raw/snow-44100-mono.wav'
    if not mono.exists():
        common.execute(['-loglevel', 'error', '-i', str(stereo), '-map', '0:a:0', '-af',
                        'pan=mono|c0=0.5*c0+0.5*c1', '-c:a', 'pcm_s24le', '-n', str(mono)], commands)
    elif not existing:
        raise ValueError('Unexpected existing diagnostic mono file')
    else:
        check_file(existing['snow_diagnostic']['mono_raw'])
    mono_fmt = common.wav_format(mono)
    if (mono_fmt['frames'], mono_fmt['sample_rate'], mono_fmt['channels'], mono_fmt['sample_width_bytes']) != (stereo_fmt['frames'], 44100, 1, 3):
        raise ValueError('Arithmetic mean changed rate, duration or sample precision')
    channels, averaged = decode(stereo, commands), decode(mono, commands)
    if len(channels) != 2 * len(averaged):
        raise ValueError('Arithmetic mean sample count differs')
    mean_error = max(abs(y - .5 * (channels[2*i] + channels[2*i+1])) for i, y in enumerate(averaged)) * 2 ** 23
    if mean_error > 1.1:
        raise ValueError('Mono diagnostic is not the arithmetic left/right average')
    previous = {x['id']: x for x in (existing or {}).get('snow_diagnostic', {}).get('stages', [])}
    stages = []
    for stage_id, label, source, codec in [
        ('stereo441', '① 原预听 · 44.1 kHz 立体声', stereo, 'pcm_s24le'),
        ('mono441', '② 仅合并声道 · 44.1 kHz 单声道', mono, 'pcm_s24le'),
        ('mono16', '③ 实际输入 · 16 kHz 单声道', actual, 'pcm_s16le'),
    ]:
        target = OUTPUT / 'diagnostic/listen' / (stage_id + '.wav')
        aligned = align_listen(source, target, codec, previous.get(stage_id), commands)
        stages.append(dict(aligned, id=stage_id, label=label))
    return {'diagnosis': common.info(DIAGNOSIS), 'original_stereo': common.info(stereo),
            'actual_model_input': common.info(actual), 'mono_raw': common.info(mono),
            'arithmetic_mean_max_error_pcm24_units': mean_error, 'stages': stages,
            'duration_seconds': 25.1, 'model_input_modified': False, 'additional_eq_denoise_limiter': False}


def build_html(request, rows, snow):
    cards = []
    for row in rows:
        generated = (common.player('生成日语 · 等音量', relative(row['listen']['path']), row['metrics']['duration_seconds'],
                                    relative(row['raw']['path']), '下载原生 WAV') if row['status'] == 'complete' else
                     '<article class="player"><h3>生成日语</h3><p>本次未完成</p></article>')
        reference = common.player('实际 16 kHz 参考 · 原始音量', relative(row['model_input']['path']),
                                  row['model_input_metrics']['duration_seconds'], download_label='下载实际参考')
        cards.append(f'<section class="setting"><h2>{html.escape(row["label"])}</h2>' + generated
                     + '<details class="reference"><summary>听实际参考音量</summary>' + reference + '</details></section>')
    diagnostic = ''.join(common.player(x['label'], relative(x['listen']['path']), x['metrics']['duration_seconds']) for x in snow['stages'])
    return '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>由比滨 · 参考音量对照</title>
<style>
:root{color-scheme:light;--ink:#24332e;--muted:#647268;--line:#d5dfd5;--accent:#356c51}
*{box-sizing:border-box}body{margin:0;background:#f2f5ef;color:var(--ink);font:16px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:1300px;margin:auto;padding:36px 26px}a{color:var(--accent);text-underline-offset:3px}nav{font-size:13px;margin-bottom:24px;display:flex;gap:20px;flex-wrap:wrap}
header{padding-bottom:22px;border-bottom:1px solid var(--line)}h1{font-size:clamp(26px,4vw,38px);margin:8px 0 12px}header p{margin:0;color:var(--muted)}
.text{margin:24px 0 30px;padding-left:18px;border-left:3px solid #8bad91}.text p{margin:0}.japanese{font-size:18px}.meaning{margin-top:8px!important;color:var(--muted);font-size:14px}
.three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start}.setting{min-width:0}h2{font-size:23px;margin:0 0 16px}.player{background:white;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px;min-width:0}.player-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.player h3{font-size:15px;margin:0 0 12px}.player-top span{font-size:12px;white-space:nowrap;color:var(--muted)}
audio{width:100%;display:block;height:42px}.download{display:inline-block;margin-top:10px;font-size:12px}.reference{font-size:13px;color:var(--muted)}.reference .player{margin-top:14px}summary{cursor:pointer}.transcript,.snow{margin-top:28px;border-top:1px solid var(--line);padding-top:18px}.transcript{font-size:14px;color:var(--muted)}.snow>summary{font-size:18px;font-weight:600}.snow>p{font-size:14px;color:var(--muted)}
footer{margin-top:30px;color:var(--muted);font-size:12px}summary:focus-visible,a:focus-visible,audio:focus-visible{outline:3px solid #619b78;outline-offset:4px}
@media(max-width:900px){.three{grid-template-columns:1fr}main{max-width:760px;padding:24px 16px}}
</style></head><body><main><nav><a href="../parameter-sweep/index.html">上一轮参数对照</a><a href="../reference-refinement/index.html">参考与发音对照</a></nav>
<header><h1>由比滨 · 提高参考音量</h1><p>完整 23.82 秒参考，固定 CFG 2.5 / 10 步 / Seed 42。三条生成试听已对齐音量，比较输入音量变化后的结果。</p></header>
''' + f'<div class="text"><p class="japanese" lang="ja">{html.escape(request["text"]["text"])}</p>' + \
        '<p class="meaning">中文含义：稍微坐下来休息一下吧。茶还温热，请慢慢喝。今天的事，明天再想也没关系。</p></div>' + \
        '<div class="three">' + ''.join(cards) + '</div><details class="transcript"><summary>参考音频日语原文</summary><p lang="ja">' + \
        html.escape(request['reference']['promptText']) + '''</p></details>
<details class="snow"><summary>雪之下 · 预听与实际输入的清晰度对照</summary>
<p>三阶段分别对齐到相同响度。先比较①与②的声道变化，再比较②与③的采样率变化；三条都保留完整 25.10 秒。</p><div class="three">''' + diagnostic + '''</div>
<p>16 kHz 编码只能表示约 8 kHz 以下的频率，更高频细节会丢失。本轮诊断未发现额外处理错误；这组是等响诊断试听，模型仍使用原来的实际输入。</p>
<p>''' + f'<a href="{html.escape(relative(snow["actual_model_input"]["path"]))}" download>下载实际 16 kHz 输入（原始音量）</a>' + '''</p></details>
<footer>生成试听仅调整整条固定音量；原生 WAV 可单独下载。</footer></main>
<script>document.addEventListener('play',function(event){if(event.target.tagName==='AUDIO'){document.querySelectorAll('audio').forEach(function(audio){if(audio!==event.target)audio.pause();});}},true);</script></body></html>'''


def finalize():
    preparation_identity, diagnosis_identity = common.info(PREPARATION), common.info(DIAGNOSIS)
    preparation = common.read_json(PREPARATION)
    prepared = {x['id']: x for x in preparation['references']}
    if set(prepared) != {x[0] for x in VARIANTS}:
        raise ValueError('Expected exactly the +3 and +6 dB variants')
    baseline, request, prior_identity = load_baseline()
    protected = [common.info(p) for p in ROOT.rglob('*') if p.is_file() and OUTPUT not in p.parents]
    existing = common.read_json(RECEIPT) if RECEIPT.exists() else None
    previous = {x['id']: x for x in (existing or {}).get('generated', [])}
    page = OUTPUT / 'index.html'
    page_before = common.info(page) if page.exists() else None
    if page_before and (not existing or existing['index'] != page_before):
        raise ValueError('Existing input-clarity page was edited; refusing to overwrite')
    for folder in ('raw', 'listen', 'reference-inputs', 'diagnostic/raw', 'diagnostic/listen'):
        (OUTPUT / folder).mkdir(parents=True, exist_ok=True)
    commands = []
    baseline_input = OUTPUT / 'reference-inputs/yui-original.wav'
    common.copy_verified(Path(request['reference']['file']['path']), baseline_input)
    baseline_row = dict(baseline, label='原参考音量', model_input=common.info(baseline_input),
                        model_input_metrics=common.metrics(baseline_input, commands), reference_gain_db=0, existing=True)
    rows = [baseline_row]
    for ref_id, gain in VARIANTS:
        row = prepared[ref_id]
        if row['gain_db'] != gain:
            raise ValueError('Prepared input gain differs from declared experiment')
        result = new_take(row, request, previous.get(ref_id), commands)
        result['existing'] = False
        rows.append(result)
    snow = prepare_snow(existing, commands)
    source = build_html(request, rows, snow)
    parser = common.LinkParser()
    parser.feed(source)
    links = []
    for link in sorted(set(parser.links)):
        parsed = urlparse(link)
        if parsed.scheme or parsed.netloc:
            raise ValueError('Input-clarity page should link only to local listening artifacts')
        path = (OUTPUT / unquote(parsed.path)).resolve(strict=True)
        if ROOT.resolve() not in path.parents or not path.is_file():
            raise ValueError(f'Invalid local link: {link}')
        links.append(common.info(path))
    for item in protected + [preparation_identity, diagnosis_identity, prior_identity]:
        check_file(item)
    if (common.info(page) if page.exists() else None) != page_before:
        raise ValueError('Page changed during package preparation')
    if existing:
        history = QA / 'package-history'
        common.copy_verified(RECEIPT, history / (common.digest(RECEIPT) + '.json'))
        common.copy_verified(page, history / (common.digest(page) + '.html'))
    pending = OUTPUT / 'index.pending.html'
    pending.write_text(source, encoding='utf-8')
    pending.replace(page)
    complete = [x for x in rows if x['status'] == 'complete']
    result = {'status': 'complete' if len(complete) == 3 else 'partial_generation_page_complete', 'at': common.now(),
              'script': common.info(Path(__file__)), 'preparation': preparation_identity, 'diagnosis': diagnosis_identity,
              'prior_package': prior_identity, 'generated': rows, 'snow_diagnostic': snow,
              'playable_generated_count': len(complete), 'new_generated_count': sum(not x['existing'] for x in complete),
              'reused_count': 1, 'index': common.info(page), 'links': links,
              'existing_assets_preserved': protected, 'commands': commands,
              'new_model_runs': 0, 'browser_opened': False, 'subjective_listening_performed': False}
    common.write_json(RECEIPT, result)
    verification = {'status': 'published_delivery_verified', 'at': common.now(), 'index': result['index'],
                    'package_receipt': common.info(RECEIPT), 'playable_generated_count': len(complete),
                    'new_generated_count': result['new_generated_count'], 'reused_count': 1,
                    'local_links_verified': len(links), 'existing_assets_preserved': len(protected),
                    'rows': [{'id': x['id'], 'existing': x['existing'], **x['static_gain_verification']} for x in complete],
                    'snow_stages': [{'id': x['id'], **x['gain_verification']} for x in snow['stages']],
                    'arithmetic_mean_max_error_pcm24_units': snow['arithmetic_mean_max_error_pcm24_units'],
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
