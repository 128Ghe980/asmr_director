"""The preferred original D room, with a long source and continuous orbits.

Only source trajectory and convolution scheduling change. room_ir is imported
unchanged from the initial experiment and its source hashes are checked.
"""
import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import soundfile as sf

from motion_convolution import render_moving
from render import (FS, Profile, digest, direct_ir, metrics, prepare_source,
                    room_ir, save_clip, vector, write_page)

METHODS = [
    dict(id='orbit_near', mark='1', label='近处环绕', caption='保持 18 cm，缓慢绕一圈，最后停在左侧。', radius_m=.18),
    dict(id='orbit_mid', mark='2', label='中距离环绕', caption='保持 80 cm，沿同一条环绕路线移动。', radius_m=.8),
    dict(id='orbit_far', mark='3', label='远处环绕', caption='保持 1.75 m，听声音在房间里绕过身后。', radius_m=1.75),
    dict(id='spiral', mark='4', label='一边环绕，一边靠近', caption='从 1.75 m 靠近到 18 cm，末段保持近处。', radius_m=None),
]


def orbit_phase(times, duration):
    """One revolution with a cosine velocity ramp, stationary at both ends."""
    first, last = 1.5, duration-2.5
    span = last-first
    u = np.clip((np.asarray(times)-first)/span, 0, 1)
    ramp = .1
    left = .5*(u-ramp/np.pi*np.sin(np.pi*u/ramp))
    remaining = 1-u
    right = 1-ramp-.5*(remaining-ramp/np.pi*np.sin(np.pi*remaining/ramp))
    phase = np.where(u < ramp, left, np.where(u > 1-ramp, right, u-ramp/2))/(1-ramp)
    return np.clip(phase, 0, 1)


def trajectory(method_id, times, duration):
    if duration < 12:
        raise ValueError('Use a genuinely longer source (at least 12 seconds)')
    method = next(m for m in METHODS if m['id']==method_id)
    times = np.asarray(times, dtype=float)
    azimuth = 90+360*orbit_phase(times, duration)
    if method['radius_m'] is not None:
        radii = np.full_like(times, method['radius_m'])
    else:
        p = np.clip((times-2)/(duration*.78-2), 0, 1)
        smooth = p*p*(3-2*p)
        radii = np.exp(np.log(1.75)*(1-smooth)+np.log(.18)*smooth)
        radii = np.clip(radii, .18, 1.75)
    return azimuth, radii


def key_times(duration, step=.1):
    start, end = 1.5, duration-2.5
    ramp = (end-start)*.1
    return np.unique(np.r_[np.arange(0,duration,step), duration,
                           start, start+ramp, end-ramp, end, 2., duration*.78])


def source_presentation(record, metadata, duration):
    """Describe provenance separately from the waveform/trajectory processing."""
    coverage = record['ordered_clause_coverage']
    count = int(coverage['total_count'])
    if count < 1 or int(coverage['covered_count']) != count or not coverage['all_covered_in_order']:
        raise ValueError('Source ASR must cover every expected clause in order')
    fresh = metadata.get('new_generation', False)
    prefix = '用本轮新文案重新生成' if fresh else '复用此前选过'
    source_description = metadata.get('source_description',f'{prefix}的完整 {duration:.2f} 秒人声，共 {count} 个短句；四条都使用同一份干声。')
    source_note = metadata.get('source_note',
        f'本轮新文案由本地 VoxCPM2 生成人声，最终 ASR {count}/{count} 句顺序覆盖。未重复短句或拉伸语速；新声音的听感尚待判断。' if fresh else
        f'完整长文为此前已选 VoxCPM2 六语义组与自适应停顿成品，原 ASR {count}/{count} 句顺序覆盖。没有重复短句、拉伸语速或重新生成 TTS。')
    return count, source_description, source_note


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--asr-evidence', type=Path, required=True)
    parser.add_argument('--source-metadata', type=Path, help='Optional source/title/provenance presentation for a new generation')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out, reference, source = args.output.resolve(), args.reference.resolve(), args.source.resolve()
    if out in (reference, source.parent):
        raise ValueError('Use a separate output directory')
    original = json.loads((reference/'manifest.json').read_text(encoding='utf-8'))
    for module, key in [('render.py','renderer_sha256'),('near_field.py','nearfield_sha256')]:
        assert digest(Path(__file__).with_name(module)) == original['provenance'][key], 'Original D code changed'
    asr = json.loads(args.asr_evidence.read_text(encoding='utf-8-sig'))
    record = next(r for r in asr['records'] if Path(r['path']).resolve()==source)
    assert record['sha256'].lower()==digest(source) and record['passed']
    assert record['ordered_clause_coverage']['all_covered_in_order'] and not record['unexpected_repeated_12grams']
    profile = Profile(original['provenance']['hrtf_path'])
    assert digest(profile.path)==original['provenance']['hrtf_sha256']
    out.mkdir(parents=True,exist_ok=True)
    (out/'audio').mkdir(exist_ok=True)
    (out/'sources').mkdir(exist_ok=True)
    audio = prepare_source(source,0,None)
    duration = len(audio)/FS
    metadata = json.loads(args.source_metadata.read_text(encoding='utf-8-sig')) if args.source_metadata else {}
    clause_count, source_description, source_note = source_presentation(record,metadata,duration)
    times = key_times(duration)
    sf.write(out/'sources'/'voice-dry.wav',audio,FS,subtype='PCM_24')
    shutil.copy2(source,out/'sources'/'voice-original.wav')
    (out/'transcript.txt').write_text(asr['source_text'],encoding='utf-8')
    (out/'source-asr-evidence.json').write_text(json.dumps(dict(source_text=asr['source_text'],record=record),ensure_ascii=False,indent=2),encoding='utf-8')
    source_info = dict(id='voice',label=metadata.get('source_label','温柔长文'),path=str(source),source_sha256=digest(source),
        prepared_file='sources/voice-dry.wav',prepared_sha256=digest(out/'sources'/'voice-dry.wav'),prepared_duration=duration,
        asr_clause_count=clause_count,new_generation=bool(metadata.get('new_generation',False)),description=source_description)
    manifest = dict(title=metadata.get('title','D · 长文连续环绕'),eyebrow='ASMR · 连续运动试听',
        subtitle='保留 D 的房间感，比较声音围着你移动时的距离',
        intro=f'同一段约 {round(duration)} 秒的温柔长文。左侧 → 身后 → 右侧 → 面前 → 左侧；前三条保持距离，第四条慢慢靠近。',
        methods_heading='四条运动对照 · 全部使用 D',default_method='spiral',reference_url=metadata.get('reference_url','http://127.0.0.1:8768/'),
        listening_prompt=f'切换版本保留同一句话与同一个方位。先听保留远近音量，再用匹配整体响度比较空间变化；靠近版最后约 {round(duration*.22)} 秒保持近处。',
        transcript=asr['source_text'],sources=[source_info],methods=[],scenes=[dict(id='full',label='完整长文',description='开头短暂停留，再平滑绕过一整圈，结尾停在左侧。所有距离均从头中心计算；18 cm 的侧面位置距模型耳朵约 10 cm。')],
        modes=[dict(id='natural',label='保留远近音量',description='四条使用同一干声与共同增益，保留 D 本身的远近音量及房间反射变化。'),
               dict(id='matched',label='匹配整体响度',description='每条长音频只匹配一次整体响度；保持左右差、环绕中的动态和靠近过程。')],
        clips=[],notes=[
        '依据本轮听感保留原 D：6×6×2.7 米房间、听者位置 (2,2,1.2)、六面墙首阶反射系数 0.55、6.5 kHz 低通、RT60 0.28 秒合成扩散尾声，尾声系数 0.72。没有改用 E/F/G。',
        '沿用 Viking A 的 1 米实测 HRTF 与原刚性球 DVF。只新增连续轨迹及等价的局部卷积计算；不加入耳廓视差、嘴部朝向或 FDN。',
        '轨迹每约 100 ms 计算原 D 的完整脉冲响应并交叉淡化输出，保留卷积历史和完整尾声。原 HRIR 仍取最近实测方向，角度展开后连续变化，不模拟多普勒。',
        '原 D 的听者偏离房间中心，远处环绕取 1.75 米以保证整圈不穿墙；经过近墙一侧时早反射会自然增强。',
        source_note,
        '统一干声处理仅含 12 ms 首尾淡化与整体响度调整，保留原有组间停顿；未给人声增加高通或降噪。',
        'Viking HRTF Dataset v2：Spagnol / Miccini / Unnthorsson，2020，CC BY 4.0，DOI 10.5281/zenodo.4160401；缺失的更低仰角反射仍按原 D 最近实测方向近似。',
        '房间是合成模型，距离音量采用柔和创作曲线，非实测 BRIR 或绝对声压校准。页面的位置显示为预设轨迹，听感由你判断。',
        ],provenance=dict(sample_rate=FS,reference_manifest=str(reference/'manifest.json'),reference_manifest_sha256=digest(reference/'manifest.json'),
            hrtf_path=str(profile.path),hrtf_sha256=digest(profile.path),reference_distance_m=profile.reference_distance,
            head_radius_m=profile.head_radius,asr_evidence=str(args.asr_evidence.resolve()),asr_evidence_sha256=digest(args.asr_evidence),
            keyframe_max_step_s=.1,common_guard_delay_samples=0,
            code_sha256={name:digest(Path(__file__).with_name(name)) for name in ['render.py','near_field.py','long_motion.py','motion_convolution.py']}))
    if args.source_metadata:
        if args.source_metadata.resolve()!=out/'source-metadata.json':
            shutil.copy2(args.source_metadata,out/'source-metadata.json')
        manifest['provenance']['source_metadata_sha256']=digest(args.source_metadata)
    if metadata.get('generation_manifest'):
        generation_manifest = Path(metadata['generation_manifest']).resolve()
        manifest['provenance']['generation_manifest']=str(generation_manifest)
        manifest['provenance']['generation_manifest_sha256']=digest(generation_manifest)
    renders, measurements = {}, {}
    for method in METHODS:
        mid = method['id']
        azimuths, radii = trajectory(mid,times,duration)
        positions = np.array([np.array([2.,2.,1.2])+r*vector(az) for az,r in zip(azimuths,radii)])
        assert np.all(positions>0) and np.all(positions<np.array([6.,6.,2.7]))
        description = method['caption']+' 方位和语句时间与其他版本一致，使用原版 D 的近场与房间处理。'
        manifest['methods'].append({**method,'description':description,
            'trajectory':dict(times_s=times.tolist(),azimuth_unwrapped_deg=azimuths.tolist(),distance_m=radii.tolist())})
        def filters():
            for i,(az,r) in enumerate(zip(azimuths,radii)):
                if i%75==0: print('render',mid,i,'/',len(times),flush=True)
                yield room_ir(profile,float(az%360),float(r))
        result = render_moving(audio,times,filters(),FS)
        # One zero sample and the same final tail fade as the original D harness.
        result = np.pad(result,((0,1),(0,0)))
        result[-720:] *= np.linspace(1,0,720)[:,None]
        renders[mid], measurements[mid] = result,metrics(result)
    natural_gain = min(1.,10**((-2.1-max(m['true_peak_dbtp'] for m in measurements.values()))/20))
    target = -25.-max(0.,max(m['true_peak_dbtp']-m['lufs']-25 for m in measurements.values())+2.1)
    source_info['natural_headroom_gain_db'] = float(20*np.log10(natural_gain))
    source_info['matched_target_lufs'] = target
    for method in METHODS:
        mid = method['id']
        for mode in manifest['modes']:
            gain = natural_gain if mode['id']=='natural' else 10**((target-measurements[mid]['lufs'])/20)
            save_clip(out,manifest,'voice',mid,'full',mode['id'],renders[mid]*gain)
    # Same direction across these fixed-distance anchors; record impulse DRR.
    manifest['room_evidence'] = []
    for scene,r in [('ear',.18),('front',.8),('far',1.75)]:
        direct = direct_ir(profile,'nearfield',90,r)
        reflections = room_ir(profile,90,r)
        reflections[:,:direct.shape[1]] -= direct
        manifest['room_evidence'].append(dict(scene=scene,azimuth_deg=90,distance_m=r,
            direct_to_reflected_db=float(10*np.log10(np.sum(direct**2)/np.sum(reflections**2)))))
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    write_page(out)
    (out/'README.zh.md').write_text(f'四条约{round(duration)}秒完整长文，全部采用原D。\n\n近处18cm／中距80cm／远处1.75m／1.75m环绕靠近到18cm。\n\n打开 index.html 或 '+metadata.get('serving_url','http://127.0.0.1:8769/')+'。原文见 transcript.txt；技术数据与来源见 manifest.json。\n',encoding='utf-8')
    print(json.dumps(dict(output=str(out),clips=len(manifest['clips']),duration=duration,keyframes=len(times),matched_target_lufs=target),ensure_ascii=False),flush=True)


if __name__=='__main__':
    main()
