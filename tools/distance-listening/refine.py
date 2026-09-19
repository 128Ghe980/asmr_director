"""Render an isolated D/E/F/G comparison, preserving the initial D algorithm."""
import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

from render import (FS, METER, MODES, Profile, digest, direct_ir, metrics,
                    prepare_source, render_filters, room_ir, save_clip, write_page)
from refine_room import FDN_DELAYS, WALLS, refined_ir
from source_geometry import GeometryProfile

METHODS = [
    dict(id="room", mark="D", label="D · 原房间算法", description="保留上一轮 D 的算法：实测 HRTF＋DVF 近场补偿＋六面墙首阶反射＋短扩散尾声。"),
    dict(id="room_refined", mark="E", label="E · 房间细化", description="在 D 上替换房间层：24 条一／二阶镜像反射、各墙不同的吸收滤波，以及更克制的 FDN 短尾声。"),
    dict(id="geometry", mark="F", label="F · 贴耳与朝向", description="保持 D 的房间结构；直达声加入逐耳视差与延时对齐插值，人声的辐射朝向分别作用于双耳直达和每条墙面反射。"),
    dict(id="combined", mark="G", label="G · 两项合并", description="E 的房间层＋F 的贴耳与人声朝向。增强是否舒服，由与 D 的试听比较决定。"),
]
SCENES = [
    dict(id="tour", label="完整串听", description="左耳旁 → 面前 → 房间远处 → 左前方靠近 → 近处转头。"),
    dict(id="ear", label="左耳旁", description="距头中心 14 cm，纯左侧；这个方向视差变化很小，可作为控制。", azimuth=90., distance=.14),
    dict(id="front", label="面前", description="正前方 65 cm，观察两耳各自的入射角和房间包围感。", azimuth=0., distance=.65),
    dict(id="far", label="房间远处", description="正前方 2.5 m，比较反射的方向、密度和尾声。", azimuth=0., distance=2.5),
    dict(id="approach", label="左前方靠近", description="从左前方 45°、2.5 m 靠近到 14 cm；朝向头中心。同一句／刷声重复两次。", azimuth=45., distance=2.5),
    dict(id="turn", label="近处转头", description="左前方 45°、距离固定 35 cm；人声从面向你转开 110°再回来。D/E 无朝向建模；刷声保持不转，作为控制。", azimuth=45., distance=.35),
]


def trajectory(scene, duration):
    if scene['id'] not in ('approach', 'turn'):
        return np.array([0.]), [scene['distance']], [0.]
    times = np.linspace(0, duration, 41)
    p = times/duration
    if scene['id'] == 'approach':
        t = p*p*(3-2*p)
        radii = np.clip(np.exp(np.log(2.5)*(1-t)+np.log(.14)*t), .14, 2.5)
        return times, radii, np.zeros_like(p)
    # Raised cosine gives stationary start, fully turned middle, stationary end.
    return times, np.full_like(p, .35), 110*np.sin(np.pi*p)**2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    reference, out = args.reference.resolve(), args.output.resolve()
    if reference == out:
        raise ValueError('Keep the original listening artifact intact')
    config = json.loads((reference/'render-config.json').read_text(encoding='utf-8-sig'))
    old = json.loads((reference/'manifest.json').read_text(encoding='utf-8'))
    out.mkdir(parents=True, exist_ok=True)
    (out/'audio').mkdir(exist_ok=True)
    (out/'sources').mkdir(exist_ok=True)
    profile = Profile(config['hrtf'])
    geometry = GeometryProfile(profile)
    manifest = dict(title='ASMR 距离感 · D 的改进对照', subtitle='房间反射 × 贴耳与朝向',
        intro='用相同原声比较 D、E、F、G。先听左前方靠近与近处转头，再听远处的房间质感。',
        default_method='room', reference_url='http://127.0.0.1:8767/',
        sources=[], methods=METHODS, scenes=SCENES, modes=[dict(m) for m in MODES], clips=[], notes=[
        '原版试听和音频仍保留在 8767。本页 D 使用原算法重新渲染新轨迹，所有版本增加同一段插值保护延迟，并统一预留峰值余量。',
        '沿用原来的同一句人声、同一份 CC0 画刷录音及源预处理；人声未重新生成，刷声仍统一使用 40 Hz 二阶高通。',
        'E/G 的房间仍为 6×6×2.7 米；墙面参数是试听预设，非实测材质。FDN 为八延迟线合成短尾声，低频 RT60 设计值约 0.24 秒，非实测 BRIR 或 SDN。',
        'F/G 的逐耳视差采用测量球交点方向，HRIR 去延时插值后恢复头中心方向的到达延时，再叠加原方向 DVF；属于 3D Tune-In 类近场近似。',
        '人声方向性为低频较均匀、高频更向前的简化辐射模型，非这个人的实测嘴部指向性；刷子不使用嘴部模型。',
        'Viking A，Spagnol / Miccini / Unnthorsson，2020，CC BY 4.0，DOI 10.5281/zenodo.4160401；测量距离 1 米，最低仰角 −45°。更低的地板反射使用最近实测方向近似；未模拟个体化或头部跟踪。',
        '转头段的朝向变化只影响 F/G 人声；靠近及转头在匹配模式下只匹配整段响度，保留段内动态，不把朝向变化抹平。',
        '保留 HRIR 自身延时；未加入随距离变化的直达声传播延迟、多普勒或完整波动声学。技术检查通过不代表新版本听感更好。',
        ], provenance=dict(sample_rate=FS, hrtf_path=str(profile.path), hrtf_sha256=digest(profile.path),
            reference_manifest=str(reference/'manifest.json'), reference_manifest_sha256=digest(reference/'manifest.json'),
            reference_distance_m=profile.reference_distance, head_radius_m=profile.head_radius,
            common_guard_delay_samples=geometry.latency_samples,
            wall_presets=WALLS, fdn_delays_samples=FDN_DELAYS.tolist(), fdn_low_frequency_rt60_target_s=.24,
            code_sha256={name:digest(Path(__file__).with_name(name)) for name in
                         ['render.py','near_field.py','refine.py','refine_room.py','source_geometry.py']}))
    manifest['modes'][1]['description'] = '静态段分别匹配整体响度；靠近／转头只匹配整段，保留段内音量和左右差。串听由这些片段直接连接。'
    for source in config['sources']:
        sid = source['id']
        print('source', sid, flush=True)
        audio = prepare_source(source['path'], source.get('start',0), source.get('seconds'), source.get('channel'), source.get('highpass_hz'))
        prepared = out/'sources'/f'{sid}-dry.wav'
        sf.write(prepared, audio, FS, subtype='PCM_24')
        old_source = next(s for s in old['sources'] if s['id'] == sid)
        assert digest(prepared) == old_source['prepared_sha256'], 'Preparation changed since original D'
        info = {**source, 'source_sha256':digest(source['path']), 'prepared_sha256':digest(prepared),
                'prepared_file':f'sources/{sid}-dry.wav', 'prepared_duration':len(audio)/FS}
        manifest['sources'].append(info)
        moving = np.concatenate([audio, np.zeros(round(.3*FS)), audio])
        renders = {}
        for scene in SCENES[1:]:
            samples = moving if scene['id'] in ('approach','turn') else audio
            times, radii, yaws = trajectory(scene, len(samples)/FS)
            for method in METHODS:
                mid = method['id']
                print('render', sid, scene['id'], mid, flush=True)
                filters = []
                # Static D/E in the turn scene need one filter; the repeated speech remains.
                entries = list(zip(radii, yaws))
                selected_times = times
                if scene['id'] == 'turn' and (mid in ('room','room_refined') or sid == 'brush'):
                    entries, selected_times = entries[:1], np.array([0.])
                for r, yaw in entries:
                    if mid == 'room':
                        h = np.pad(room_ir(profile, scene['azimuth'], r), ((0,0),(geometry.latency_samples,0)))
                    else:
                        h = refined_ir(profile, geometry, scene['azimuth'], r,
                            room_refined=mid in ('room_refined','combined'), source_geometry=mid in ('geometry','combined'),
                            voice=sid == 'voice', yaw_offset_deg=yaw)
                    filters.append(h)
                result = render_filters(samples, selected_times, filters)
                count = len(samples)+round(.65*FS)+geometry.latency_samples
                result = np.pad(result, ((0,max(0,count-len(result))),(0,0)))[:count]
                result[-720:] *= np.linspace(1,0,720)[:,None]
                renders[mid,scene['id']] = result
        measured = {key:metrics(x) for key,x in renders.items()}
        peak = max(m['true_peak_dbtp'] for m in measured.values())
        natural_gain = min(1.,10**((-2.1-peak)/20))
        target = -25.-max(0., max(m['true_peak_dbtp']-m['lufs']-25 for m in measured.values())+2.1)
        info['matched_target_lufs'], info['natural_headroom_gain_db'] = target, float(20*np.log10(natural_gain))
        for method in METHODS:
            parts = {'natural':[], 'matched':[]}
            for scene in SCENES[1:]:
                key = method['id'],scene['id']
                for mode in MODES:
                    gain = natural_gain if mode['id']=='natural' else 10**((target-measured[key]['lufs'])/20)
                    data = renders[key]*gain
                    parts[mode['id']].append(data)
                    save_clip(out,manifest,sid,method['id'],scene['id'],mode['id'],data)
            for mode in MODES:
                chunks = []
                for i,data in enumerate(parts[mode['id']]):
                    if i: chunks.append(np.zeros((round(.6*FS),2)))
                    chunks.append(data)
                save_clip(out,manifest,sid,method['id'],'tour',mode['id'],np.concatenate(chunks))
    original_evidence, evidence = [], []
    for scene in SCENES[1:4]:
        direct = direct_ir(profile,'nearfield',scene['azimuth'],scene['distance'])
        total = room_ir(profile,scene['azimuth'],scene['distance'])
        total[:,:direct.shape[1]] -= direct
        original_evidence.append(dict(scene=scene['id'], direct_to_reflected_db=float(10*np.log10(np.sum(direct**2)/np.sum(total**2)))))
        for mid in ('room_refined','geometry','combined'):
            _,d,e,l = refined_ir(profile,geometry,scene['azimuth'],scene['distance'],
                room_refined=mid in ('room_refined','combined'),source_geometry=mid in ('geometry','combined'),voice=True,return_components=True)
            evidence.append(dict(method=mid,scene=scene['id'],direct_to_reflected_db=float(10*np.log10(np.sum(d*d)/np.sum((e+l)**2))),
                late_to_early_db=float(10*np.log10(np.sum(l*l)/np.sum(e*e)))))
    manifest['room_evidence'], manifest['refinement_room_evidence'] = original_evidence,evidence
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    (out/'render-config.json').write_text(json.dumps(config,ensure_ascii=False,indent=2),encoding='utf-8')
    write_page(out)
    print(json.dumps(dict(output=str(out),clips=len(manifest['clips']),room_evidence=evidence),ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
