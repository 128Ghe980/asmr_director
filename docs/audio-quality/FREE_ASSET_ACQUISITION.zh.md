# 真实 ASMR 素材取得与试听

更新日期：2026-10-04。

## 当前状态

正式工作台目前仍使用基础程序合成。示例名称为轻呼吸、轻笑、被子摩擦、衣物摩擦和雨夜房间；敲击名称使用单独的合成分支，其余音效名称共用摩擦算法，环境名称共用雨声算法。仅增加名称不等于取得新声音。

原实验目录已有 6 份真实录音：被子、衣物、木材指敲、桌面指敲、窗外雨和柔雨。位于 `D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/licensed-assets`。本轮对原 MP3 的 SHA-256、WAV 时长和声道做了复核，六份均完整。它们全部是 Freesound 的 HQ MP3 预览转换版，不能描述为原始 WAV 下载。

用户明确选择首批「贴耳护理：掏耳、刷耳、按摩、喷雾」。本轮准备棉签清洁耳部、揉耳、两种按摩动作、喷雾，以及两种刷擦备选，共 7 份新候选，来源定义在 [`sources.json`](../../tools/sfx-library/sources.json)。各项作品页均标注 CC0；下载仍使用公开 HQ MP3 预览，原文件下载需登录。新取得的 HQ MP3 预览源文件、作品页快照、转换 WAV 和独立试听清单只保存在 I 盘，不覆盖原实验清单，也不写入工程或 VoxCPM2 候选清单。

刷耳仍有缺口：当前刷擦录音是普通物体/织物动作，不能标为真实刷耳；揉耳也不能改名冒充刷耳。棉签清洁与揉耳来源页标注 ASMR，但仅凭 stereo 声道不能宣称是真正双耳录音。是否足够贴耳、柔和仍待用户试听。此前查到的翻书来源保留为后续通用组建议，本轮不下载。

## 获取更多声音

- 首选逐项来源明确的 CC0 录音；CC-BY 可作为后续扩展，但需要完整署名流程。
- [Freesound](https://freesound.org/) 适合细动作、材质和近距离录音。先核对单项作品页与许可证，保留预览/原文件区别，不把网站 API 作为产品运行时依赖。
- 作者发布的 [Owlish Media CC0 完整包](https://opengameart.org/content/sound-effects-pack) 提供织物、纸张、呼吸、笑声、水声等原文件，可作为后续升级来源。包内还含非 ASMR 声音，需要逐项筛选。本轮完整包下载中止，仅保留独立目录里的未完成 `.part`，没有将其当作已取得素材。
- [BigSoundBank](https://bigsoundbank.com/) 可补充生活动作录音，仍逐项确认作者、许可证和实际音质。
- 本地 AI 仍按既有音质 V1 设计评估 [Stable Audio 3 Small SFX](https://huggingface.co/stabilityai/stable-audio-3-small-sfx)。当前没有本机 SFX 权重/生成验收，不声称可用；模型页要求账号接受条款，不能绕过。效果要在 Windows / RTX 3060 Laptop 6GB 上验证。

## 本轮七份来源

| 用途 | 作者 / 原标题 | 原作品页 |
| --- | --- | --- |
| 棉签清洁耳部 | Elias79 / ASMR cleaning ear.mp3 | [690078](https://freesound.org/people/Elias79/sounds/690078/) |
| 揉耳、轻敲 | Elias79 / ASMR Rubbing ear.mp3 | [690077](https://freesound.org/people/Elias79/sounds/690077/) |
| 手部圆形摩擦 | Vrymaa / Body - Hands | [770121](https://freesound.org/people/Vrymaa/sounds/770121/) |
| 慢速搓手 | LizzBitzz / Hands Rubbing_Slow rubs | [766063](https://freesound.org/people/LizzBitzz/sounds/766063/) |
| 手动喷瓶 | OwlStorm / Spray Bottle | [212178](https://freesound.org/people/OwlStorm/sounds/212178/) |
| 刷擦短动作 | lzmraul / Brushing.wav | [389452](https://freesound.org/people/lzmraul/sounds/389452/) |
| 织物桌垫刷擦 | franckwalden / 4 strokes on a fabric desk mat | [832225](https://freesound.org/people/franckwalden/sounds/832225/) |

## 复现与边界

在项目根目录运行准备工具；`--root` 必须为独立的试听输出目录。工具保留 MP3，转换为 48 kHz / 双声道 / PCM16 的 `listening.wav`，不对该新声音干声额外加音量、淡入淡出、循环或空间处理。已有六份 WAV 原样复制并验证，不能将其此前的峰值归一处理误称为本轮新处理。

另生成独立的 `audition.wav` 供试听页默认播放：仅调整增益，以 -30 dBFS RMS 为比较目标并将峰值限制在 -6 dBFS。页面详情显示实际增益并保留干声播放链接。个别下载预览原始音量非常低（慢速搓手 RMS 约 -79 dBFS、短刷擦约 -63 dBFS），试听需要大幅放大，底噪/量化问题应重点听辨；该处理不能修复素材品质，也不将副本自动采用到工程。

```powershell
& 'C:/Users/Yuki1/AppData/Local/Programs/Python/Python311/python.exe' tools/sfx-library/prepare_listening.py --root 'I:/AI/asmr_director/qa/sfx-expansion/2026-10-04/listening' --sources tools/sfx-library/sources.json --existing 'D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/licensed-assets/manifest.json' --direct
& 'C:/Users/Yuki1/AppData/Local/Programs/Python/Python311/python.exe' tools/distance-listening/serve.py 'I:/AI/asmr_director/qa/sfx-expansion/2026-10-04/listening' --port 8768
```

工具使用 Python 3.9+ 标准库和 PATH 中的 ffmpeg（可用 `--ffmpeg` 指定）；本机采用 Python 3.11。`--direct` 仅对该命令忽略环境代理，不修改系统网络设置。本机旧 Anaconda 的环境代理连接失败，直接 HTTPS 已验证可用。

试听页是独立素材筛选入口。所有素材的听感状态保持待试听：技术完整性不代表适合 ASMR；检查背景人声/音乐、尖锐瞬态、底噪、材质、动作速度、人声遮挡及雨声循环接缝。短动作不能自动拉长/循环成连续声音。新下载的两种按摩动作来源为单声道；转换为双声道保留兼容性，不产生双耳空间信息。

主工作台素材库选择、采用/撤回、来源保存及非人声空间处理尚未实现。现有候选格式只接受 VoxCPM2 人声，不能把本清单塞进该清单，旧实验工作树也不能整体合入。
