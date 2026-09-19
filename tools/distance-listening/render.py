"""Reproducible, local-only ASMR distance listening experiment.

This harness is deliberately separate from the product mixer. See README.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
from pathlib import Path

import h5py
import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import butter, fftconvolve, resample_poly, sosfilt

from near_field import near_field_firs

FS = 48000
METER = pyln.Meter(FS)
METHODS = [
    dict(id="baseline", label="A · 声像与音量", description="现有方式的对照：等功率声像＋距离音量。"),
    dict(id="hrtf", label="B · 双耳定位", description="Viking A 实测 1 米 HRTF，保留双耳时间差和频谱；与 A 共用距离音量曲线。"),
    dict(id="nearfield", label="C · 加入近场", description="在 B 上加入刚性球模型的距离补偿，模拟贴耳时频率相关的双耳变化。"),
    dict(id="room", label="D · 加入房间", description="在 C 上加入按房间几何计算的六面墙首阶反射和短扩散尾声。"),
]
SCENES = [
    dict(id="tour", label="完整串听", description="左耳旁 → 面前 → 远处 → 从左侧远处靠近。"),
    dict(id="ear", label="左耳旁", description="距头中心 14 cm，模型中距左耳约 6.4 cm。", azimuth=90., distance=.14),
    dict(id="front", label="面前", description="正前方 65 cm。", azimuth=0., distance=.65),
    dict(id="far", label="房间远处", description="正前方 2.5 m。", azimuth=0., distance=2.5),
    dict(id="approach", label="逐渐靠近", description="固定在左侧，从 2.5 m 靠近到耳旁；同一句／刷声重复两次。", azimuth=90., distance=2.5),
]
MODES = [
    dict(id="natural", label="保留远近音量", description="所有方法共用距离音量曲线，保留空间处理带来的整体能量变化。"),
    dict(id="matched", label="匹配整体响度", description="每个静态样片匹配到相同 LUFS；靠近段只匹配整段响度，保留段内音量运动和左右差。"),
]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def vector(azimuth, elevation=0.):
    az, el = np.deg2rad([azimuth, elevation])
    return np.array([np.cos(az)*np.cos(el), np.sin(az)*np.cos(el), np.sin(el)])


def angles(v):
    return float(np.rad2deg(np.arctan2(v[1], v[0]))), float(np.rad2deg(np.arctan2(v[2], np.hypot(v[0], v[1]))))


def distance_gain(r):
    # Shared ASMR production curve. These are product gain anchors, NOT calibrated SPL.
    return np.interp(np.log(r), np.log([.14, .35, .65, 1.2, 2.5]), [1.12, 1., .82, .62, .35])


class Profile:
    def __init__(self, path):
        self.path = Path(path)
        with h5py.File(path, "r") as f:
            self.positions = np.asarray(f["SourcePosition"], dtype=float)
            self.ir = np.asarray(f["Data.IR"], dtype=float)
            rate = np.asarray(f["Data.SamplingRate"]).ravel()
            delay = np.asarray(f["Data.Delay"])
            self.receivers = np.asarray(f["ReceiverPosition"])
            pos_type = f["SourcePosition"].attrs.get("Type", b"spherical")
        if rate.size != 1 or rate[0] != FS or np.any(delay):
            raise ValueError("This experiment requires 48kHz SOFA with delays already in HRIR.")
        if pos_type not in (b"spherical", "spherical"):
            raise ValueError("Expected spherical SOFA coordinates.")
        radii = np.unique(self.positions[:, 2])
        if len(radii) != 1:
            raise ValueError("This harness expects a single measured radius; do not silently discard distance.")
        self.reference_distance = float(radii[0])
        self.head_radius = float(np.abs(self.receivers[:, 1]).mean())
        self.directions = np.array([vector(*p[:2]) for p in self.positions])
        front = self.raw(0., 0.)
        spectrum = np.fft.rfft(front, n=2048, axis=1)
        freqs = np.fft.rfftfreq(2048, 1/FS)
        band = (freqs >= 200) & (freqs <= 12000)
        # One shared scalar for every angle, distance and ear; no per-ear normalization.
        self.calibration = 1 / np.sqrt(np.mean(np.sum(np.abs(spectrum[:, band])**2, axis=0)))

    def raw(self, az, el):
        index = int(np.argmax(self.directions @ vector(az, el)))
        return self.ir[index].copy()

    def hrir(self, az, el):
        return self.raw(az, el) * self.calibration


def prepare_source(path, start, seconds, channel=None, highpass_hz=None):
    audio, rate = sf.read(path, always_2d=True)
    if audio.shape[1] != 1 and channel is None:
        raise ValueError("Do not silently collapse an existing stereo/binaural source.")
    audio = audio[:, 0 if channel is None else channel]
    first = int(round(start*rate))
    last = len(audio) if seconds is None else min(len(audio), first+round(seconds*rate))
    audio = audio[first:last]
    if len(audio) < rate*.5:
        raise ValueError("Source selection is too short.")
    if rate != FS:
        common = math.gcd(rate, FS)
        audio = resample_poly(audio, FS//common, rate//common)
    if highpass_hz is not None:
        if not 10 <= highpass_hz <= 80:
            raise ValueError("Source rumble filter must be explicitly set between 10 and 80 Hz.")
        audio = sosfilt(butter(2, highpass_hz, fs=FS, output="sos", btype="highpass"), audio)
    # Same preparation in every condition. No pitch/tempo changes or regeneration.
    edge = min(round(.012*FS), len(audio)//4)
    fade = np.sin(np.linspace(0, np.pi/2, edge))**2
    audio[:edge] *= fade
    audio[-edge:] *= fade[::-1]
    audio *= 10**((-27-METER.integrated_loudness(audio))/20)
    return audio


def diffuse_tail():
    rng = np.random.default_rng(20260913)
    n = round(.42*FS)
    t = np.arange(n)/FS
    result = rng.normal(size=(2, n))
    result = sosfilt(butter(2, 4300, fs=FS, output="sos"), result, axis=1)
    # RT60 0.28 s, smooth first 20ms; relative onset handled by room_ir.
    result *= np.exp(-np.log(1000)*t/.28) * np.minimum(t/.02, 1)[None, :]
    result /= np.sqrt(np.sum(result**2))
    return result


TAIL = diffuse_tail()


def direct_ir(profile, method, az, r):
    if method == "baseline":
        pan = -np.sin(np.deg2rad(az))
        theta = (pan+1)*np.pi/4
        return np.array([[np.cos(theta)], [np.sin(theta)]]) * distance_gain(r)
    h = profile.hrir(az, 0.)
    if method in ("nearfield", "room"):
        dvf = near_field_firs(az, 0., r, profile.reference_distance, FS, head_radius_m=profile.head_radius)
        h = np.array([fftconvolve(h[e], dvf[e]) for e in range(2)])
    return h * distance_gain(r)


def room_ir(profile, az, r):
    dry = direct_ir(profile, "nearfield", az, r)
    h = np.zeros((2, round(.65*FS)))
    h[:, :dry.shape[1]] = dry
    room = np.array([6., 6., 2.7])
    listener = np.array([2., 2., 1.2])
    source = listener + r*vector(az)
    if np.any(source <= 0) or np.any(source >= room):
        raise ValueError("Source outside the defined room.")
    reflection_energies = []
    delays = []
    for axis in range(3):
        for wall in (0., room[axis]):
            mirrored = source.copy()
            mirrored[axis] = 2*wall-source[axis]
            path = mirrored-listener
            length = np.linalg.norm(path)
            ref_az, ref_el = angles(path)
            reflection = profile.hrir(ref_az, ref_el)
            reflection = sosfilt(butter(1, 6500, fs=FS, output="sos"), reflection, axis=1)
            # Relative path law r/L; direct level uses the same bounded creative curve as A/B/C.
            reflection *= distance_gain(r)*.55*r/length
            delay = (length-r)/343*FS
            integer, fraction = int(delay), delay-int(delay)
            taps = reflection.shape[1]
            h[:, integer:integer+taps] += reflection*(1-fraction)
            h[:, integer+1:integer+taps+1] += reflection*fraction
            reflection_energies.append(float(np.sum(reflection**2)))
            delays.append(float(delay/FS))
    # Statistical late component, not a measured BRIR or an exact room solver.
    tail_start = round((max(delays)+.012)*FS)
    diffuse_gain = .72*np.sqrt(sum(reflection_energies))
    h[:, tail_start:tail_start+TAIL.shape[1]] += TAIL*diffuse_gain
    return h


def render_filters(audio, times, filters):
    """Output crossfade of complete convolutions; retains FIR tails without block-edge resets."""
    length = len(audio)+max(f.shape[1] for f in filters)-1
    out = np.zeros((length, 2))
    axis = np.arange(length)/FS
    for index, h in enumerate(filters):
        weights = np.zeros(len(times))
        weights[index] = 1
        envelope = np.interp(axis, times, weights)
        active = np.flatnonzero(envelope > 0)
        if not len(active):
            continue
        first, last = active[0], active[-1]+1
        for ear in range(2):
            wet = fftconvolve(audio, h[ear])
            end = min(last, len(wet))
            out[first:end, ear] += wet[first:end]*envelope[first:end]
    return out


def build_bank(profile, duration):
    bank = {}
    for scene in SCENES[1:]:
        if scene["id"] == "approach":
            times = np.linspace(0, duration, 33)
            p = times/duration
            smooth = p*p*(3-2*p)
            radii = np.clip(np.exp(np.log(2.5)*(1-smooth)+np.log(.14)*smooth), .14, 2.5)
        else:
            times, radii = np.array([0.]), [scene["distance"]]
        for method in METHODS:
            name = method["id"]
            print("filters", scene["id"], name, flush=True)
            filters = [room_ir(profile, scene["azimuth"], r) if name == "room" else direct_ir(profile, name, scene["azimuth"], r) for r in radii]
            bank[scene["id"], name] = (times, filters)
    return bank


def metrics(audio):
    if not np.isfinite(audio).all():
        raise ValueError("Non-finite output")
    peak = float(np.max(np.abs(audio)))
    true_peak = float(np.max(np.abs(resample_poly(audio, 4, 1, axis=0))))
    return dict(duration=len(audio)/FS, lufs=float(METER.integrated_loudness(audio)), peak_dbfs=float(20*np.log10(max(peak, 1e-15))), true_peak_dbtp=float(20*np.log10(max(true_peak, 1e-15))), clipped_samples=int(np.sum(np.abs(audio)>=1)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--page-only", action="store_true", help="Rebuild the listening page from an existing audio manifest.")
    args = parser.parse_args()
    if args.page_only:
        write_page(args.output.resolve())
        return
    if args.config is None:
        parser.error("--config is required unless --page-only is used")
    config = json.loads(args.config.read_text(encoding="utf-8-sig"))
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    (output/"audio").mkdir(exist_ok=True)
    (output/"sources").mkdir(exist_ok=True)
    profile = Profile(config["hrtf"])
    source_info, renders = [], {}
    # Banks are independent of source timbre; cache identical-duration sources.
    banks = {}
    for source in config["sources"]:
        print("source", source["id"], flush=True)
        audio = prepare_source(source["path"], source.get("start", 0), source.get("seconds"), source.get("channel"), source.get("highpass_hz"))
        source_path = output/"sources"/(source["id"]+"-dry.wav")
        sf.write(source_path, audio, FS, subtype="PCM_24")
        moving = np.concatenate([audio, np.zeros(round(.3*FS)), audio])
        duration = len(moving)/FS
        if duration not in banks:
            banks[duration] = build_bank(profile, duration)
        bank = banks[duration]
        source_info.append({**source, "source_sha256": digest(source["path"]), "prepared_sha256": digest(source_path), "prepared_file": str(source_path.relative_to(output)).replace("\\", "/"), "prepared_duration": len(audio)/FS})
        for scene in SCENES[1:]:
            samples = moving if scene["id"] == "approach" else audio
            for method in METHODS:
                times, filters = bank[scene["id"], method["id"]]
                result = render_filters(samples, times, filters)
                # Equal durations and timeline placement permit instant A/B switching.
                target_length = len(samples)+round(.65*FS)
                result = np.pad(result, ((0, max(0, target_length-len(result))), (0, 0)))[:target_length]
                # Fade only the final 15ms tail; never truncate the speech body.
                result[-720:] *= np.linspace(1, 0, 720)[:, None]
                renders[source["id"], method["id"], scene["id"]] = result
    manifest = dict(title="ASMR 距离感试听", sources=source_info, methods=METHODS, scenes=SCENES, modes=MODES, clips=[], notes=[
        "四种方法使用同一份源音频；本轮没有重新生成 TTS，也没有修改工作台工程。",
        "刷子原录音含明显超低频能量，所有刷声版本统一使用一次 40 Hz 二阶高通预处理；人声没有使用该高通。",
        "自然模式共用柔和的距离衰减曲线，非按米校准的绝对声压；匹配模式每个静态样片只用一个双声道共同增益。靠近段保留动态响度变化。",
        "Viking HRTF Dataset v2，Spagnol / Miccini / Unnthorsson，2020，CC BY 4.0，DOI 10.5281/zenodo.4160401。使用 A 耳型，实测距离 1 米。",
        "近场由 Duda–Martens 刚性球模型的幅度比和最小相位滤波器近似，非实测厘米级 HRTF；保留原始 HRIR 的 ITD，未做耳廓视差校正或个体化。",
        "房间为 6×6×2.7 米，六面墙首阶反射＋合成短扩散尾声（RT60 0.28秒），非实测 BRIR。距离运动通过滤波输出交叉淡化，不模拟多普勒。",
        "通用耳型的前后、距离效果因人而异。技术检查不代表听感验收。",
    ], provenance=dict(hrtf_path=str(profile.path), hrtf_sha256=digest(profile.path), reference_distance_m=profile.reference_distance, head_radius_m=profile.head_radius, hrtf_calibration=profile.calibration, sample_rate=FS, renderer_sha256=digest(__file__), nearfield_sha256=digest(Path(__file__).with_name("near_field.py"))))
    for source in source_info:
        keys = [k for k in renders if k[0] == source["id"]]
        # Whole set gets one headroom scalar. Avoid any limiter obscuring spatial cues.
        peak = max(metrics(renders[k])["true_peak_dbtp"] for k in keys)
        natural_scale = min(1., 10**((-2-peak)/20))
        matched_target = -25.
        predicted = [metrics(renders[k])["true_peak_dbtp"]+matched_target-metrics(renders[k])["lufs"] for k in keys]
        matched_target -= max(0., max(predicted)+2.)
        source["matched_target_lufs"] = matched_target
        source["natural_headroom_gain_db"] = float(20*np.log10(natural_scale))
        for method in METHODS:
            sequences = {mode["id"]: [] for mode in MODES}
            for scene in SCENES[1:]:
                data = renders[source["id"], method["id"], scene["id"]]
                for mode in MODES:
                    gain = natural_scale if mode["id"] == "natural" else 10**((matched_target-METER.integrated_loudness(data))/20)
                    selected = data*gain
                    sequences[mode["id"]].append(selected)
                    save_clip(output, manifest, source["id"], method["id"], scene["id"], mode["id"], selected)
            for mode in MODES:
                sequence = sequences[mode["id"]]
                gap = np.zeros((round(.6*FS), 2))
                montage = np.concatenate([part for i, data in enumerate(sequence) for part in ([data, gap] if i < len(sequence)-1 else [data])])
                save_clip(output, manifest, source["id"], method["id"], "tour", mode["id"], montage)
    # Store objective direct/reflected impulse-energy evidence without calling it perception.
    room_evidence = []
    for scene in SCENES[1:4]:
        direct = direct_ir(profile, "nearfield", scene["azimuth"], scene["distance"])
        total = room_ir(profile, scene["azimuth"], scene["distance"])
        reflected = total.copy()
        reflected[:, :direct.shape[1]] -= direct
        room_evidence.append(dict(scene=scene["id"], direct_to_reflected_db=float(10*np.log10(np.sum(direct**2)/np.sum(reflected**2)))))
    manifest["room_evidence"] = room_evidence
    (output/"manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    write_page(output)
    if args.config.resolve() != output/"render-config.json":
        shutil.copy2(args.config, output/"render-config.json")
    print(json.dumps(dict(output=str(output), clips=len(manifest["clips"]), room_evidence=room_evidence), ensure_ascii=False), flush=True)


def write_page(output):
    manifest = json.loads((output/"manifest.json").read_text(encoding="utf-8"))
    template = Path(__file__).with_name("listening-template.html").read_text(encoding="utf-8")
    safe_json = json.dumps(manifest, ensure_ascii=False).replace("<", "\\u003c")
    (output/"index.html").write_text(template.replace("__MANIFEST_JSON__", safe_json), encoding="utf-8")


def save_clip(output, manifest, source, method, scene, mode, data):
    name = f"{source}_{method}_{scene}_{mode}.wav"
    path = output/"audio"/name
    sf.write(path, data, FS, subtype="PCM_24")
    decoded, rate = sf.read(path, always_2d=True)
    measurement = metrics(decoded)
    assert rate == FS and decoded.shape[1] == 2
    assert measurement["clipped_samples"] == 0 and measurement["true_peak_dbtp"] <= -1.98
    manifest["clips"].append(dict(source=source, method=method, scene=scene, mode=mode, file="audio/"+name, sha256=digest(path), **measurement))


if __name__ == "__main__":
    main()
