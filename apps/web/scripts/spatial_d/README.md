# Original D spatial processor / 原 D 空间处理

Run `python -B apps/web/scripts/spatial_d/render.py --request request.json`.
Dependencies: NumPy, SciPy, h5py, SoundFile, pyloudnorm. No network, model
download or GPU is used. Runtime SOFA data remains configured outside git.
Install with `python -m pip install -r apps/web/scripts/spatial_d/requirements.txt`
in a Python 3.10+ environment. Verified locally with NumPy 2.4.6, SciPy 1.17.1,
SoundFile 0.14.0, h5py 3.16.0 and pyloudnorm 0.1.1. The working local Python is
`D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/.venv/Scripts/python.exe`.

本机可复用上述 Python 环境，无需重新下载 HRTF。当前已安装 Viking A 文件为
`D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/hrtf/viking/subj_A.sofa`；
上层默认配置可指向它，每个请求通过必填 `hrtfPath` 明确传入。
No HRTF is bundled in git: the current local default is the path above, and
the caller passes that path explicitly as `hrtfPath`.

请求示例 / Request:

```json
{
  "version": 1,
  "inputWav": "I:/run/input.wav",
  "outputWav": "I:/run/output.wav",
  "outputJson": "I:/run/output.json",
  "hrtfPath": "D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/hrtf/viking/subj_A.sofa",
  "position": {"pan": -1, "distance": "very_close", "movement": "orbit"},
  "preprocess": "listening",
  "fadeInSeconds": 0,
  "fadeOutSeconds": 0
}
```

Outputs must be new files beside the request. Mono 32/44.1/48 kHz input is
converted to 48 kHz stereo PCM24. Existing stereo is rejected so the caller
can retain it without a second spatialization. Optional `durationSeconds`
crops the input and never pads its body. Output retains 0.65 seconds of tail.

输出必须与请求文件同目录且尚不存在。接受 32/44.1/48 kHz 单声道，输出
48 kHz 双声道 PCM24。拒绝已有立体声，由上层保留原空间信息。
`durationSeconds` 仅截短，不补齐语音；输出另保留 0.65 秒房间尾声。

Default `listening` preparation is the accepted sample's 12 ms sin² edge
fades and -27 LUFS source level, before distance/room. Sources shorter than
400 ms use measurement-only zero padding; silence stays silent. `none` skips
that shared preparation. Optional linear user fades run after preparation
and before convolution. Do not apply clip volume here: the mixer applies it
once to the stereo result. Do not pan, apply distance gains, or trim/fade
its room tail a second time. There is no output LUFS matching. A shared
stereo attenuation is applied only if necessary for a -2.1 dBTP ceiling.

默认先做已认可样片的 12 ms 首尾淡化与 -27 LUFS 干声调整；400 ms 以下
仅测量时补零，静音保持静音。`none` 跳过这层预处理。用户淡入/淡出在
预处理后、卷积前施加，不截房间尾声。片段音量交给上层仅施加一次；
上层不得重复声像、距离处理或二次截尾。空间处理后不做 LUFS 匹配，
仅在必要时双声道共同衰减以保持 -2.1 dBTP 余量。

Distances from head center: `very_close=.18`, `close=.35`, `near=.5`,
`mid=.8`, `far=1.75` metres. Pan -1 is left (+90°), +1 right (-90°),
0 front. Movement: `static`, `approach` (far to selected distance),
`recede` (reverse), `left_to_right`, `right_to_left`, `orbit` (90→450°),
`orbit_approach` (90→450° and 1.75→.18 m). Original timings are unchanged
at durations >=12s; shorter sources proportionally shorten endpoint holds
and use denser keys. Interpolation is of complete convolution outputs.

距离从头中心计算。环绕从左侧绕过身后、右侧、前方再回到左侧。
12 秒以上保留原停留与运动曲线，短片同比缩短停留并加密关键帧。
采用完整卷积输出的连续交叉淡化，不模拟多普勒。

The mathematics is extracted from the frozen `tools/distance-listening`
original D, but product runtime has no import dependency on those tools:
measured Viking A HRIR, rigid-sphere DVF, room 6×6×2.7 m, listener (2,2,1.2),
six first-order image reflections with .55 coefficient / 6.5 kHz lowpass,
deterministic diffuse tail with RT60 .28s and coefficient .72. No E/F/G,
parallax correction, voice directivity or FDN is included. It is a synthetic
room and regularized near-field model, not a measured BRIR or individual HRTF.

数学实现来自冻结的原 D，产品运行不依赖试听工具或 I 盘临时脚本。
保留原六面墙反射与扩散尾声；不加入 E/F/G、耳间视差、嘴部朝向或 FDN。
这是合成房间与近场近似，非实测 BRIR 或个人耳型。

Viking HRTF Dataset v2: Spagnol, Miccini, Unnthorsson (2020), CC BY 4.0,
https://doi.org/10.5281/zenodo.4160401 . Sphere equations and boundaries are
documented in `near_field.py`. Original nearest-direction HRIR lookup is
preserved, including the dataset's lower-elevation coverage limit.

Tests: `python -B -m unittest discover -s apps/web/scripts/spatial_d -p test_*.py -v`.
Real-data regression: `verify.py --reference APPROVED_8770_DIRECTORY --output NEW_DIRECTORY`.
