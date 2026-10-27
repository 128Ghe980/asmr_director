# 日语干音参考生成中文试听

日期：2026-10-26（Asia/Hong_Kong）。用户要求读取 handoff，并用「160 雪之下、192 由比滨」两份日语干音试验当前 VoxCPM2 的中文效果。归属现有 Audio Quality V1；阶段继续进行，其他 SFX 工作暂停，目标机 H3 实跑待办保留，不新增顶层路线。

## 后续反馈与日语控制实验

用户随后明确反馈本页第二轮「加日语原文明显生成的不是中文（也不是日语），但不加原文明显不像」，中文未通过主观验收。按要求完成4条日语对照并查官方跨语言说明，详见[2026-10-27 日语输出记录](2026-10-27-japanese-output-control.md)。以下保留中文实验交付时的历史状态。

## 2026-10-27 中文交付：完整参考 GPU 对照已完成

用户恢复系统并要求继续后，在提交内存保护下完成 **4 条新中文**，全部使用原稳定 VoxCPM2 GPU 配置；未跑 CPU、未更换模型、没有裁短由比滨 MP3。两角色各生成 reference-only 与真正 combined，同一中文短句、seed42、CFG2。原生输出全部 48 kHz 单声道 PCM16、零削波、未封顶；共享锁已释放。

| 角色／模式 | 新输出时长 | 原生耗时 | 中文 ASR |
| --- | --- | --- | --- |
| 雪之下／仅音频 | 7.20 秒 | 13.387 秒 | 去标点逐字匹配 |
| 雪之下／音频＋原文 | 7.84 秒 | 15.725 秒 | 识别偏差较大，需听发音 |
| 由比滨／完整 MP3 仅音频 | 5.76 秒 | 14.156 秒 | 去标点逐字匹配 |
| 由比滨／完整 MP3＋原文 | 7.84 秒 | 18.184 秒 | 识别偏差较大，需听发音 |

ASR 偏差是试听提示，不能直接认定具体误读或混语；音色相似度仍由用户试听，不称本轮已更像。`round2-generation-verification.json` 独立核对四份成功 receipt、输出与日志 SHA、参考／生产 profile 保持、音频结构和 ASR；`generated-asr.json` 保留全文。

新 `guard_reference_listening.py` 只许单条运行，50 ms 采样、提交余量低于 1.5 GiB 或观测失效时通过持有的进程 handle 停止本次子进程，保留独立证据。初始启动门槛 6 GiB；完整 MP3 成功时最低余量为 2.22 GiB，随后两次启动检查仅差 27–50 MiB、没有加载模型，因此按真实数据把启动门槛校准为 5.75 GiB，运行中 1.5 GiB 保护未放宽。四次成功最低余量均约 2.22–2.28 GiB，无保护触发；ASR 同样受保护，最低约 2.18 GiB。轮询不能保证拦住所有瞬时分配峰值，不宣称 GPU 故障永久修复。保护 3 项测试与原运行器 7 项测试通过；`guard-start-calibration.json` 及各 `*-guard*/summary.json` 保留前置检查和成功数据。

原试听页 `I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/index.html` 已更新四条新结果和原品质参考；旧轮结果折叠保留用户否定反馈。中文试听仅静态增益至约 −23 LUFS，原生 WAV 保留，完整由比滨参考为 12.64325 秒。`round2-package-receipt.json` 与 `round2-delivery-verification.json` 记录当前页面、用户源与旧资产保持、链接／PCM 检查；打包不代表主观试听通过。未打开浏览器，避免重新占用用户刚释放的资源。下面未完成／失败描述均为成功之前的过程记录。

## 2026-10-27 用户反馈与完整干音纠正

用户明确反馈首轮两角色「都不像」，因此首轮不能记为音色验收通过。用户认为雪之下参考音质比原视频差，并指出旧由比滨参考带背景音乐，另提供 `H:/comfyui/output/sd2素材/干音/由比滨.MP3`，这是用户已经处理好的完整干音。新 MP3 为 12.64325 秒、44.1 kHz 双声道，SHA256 `59981701239ec9724cb32a18083d73e712d8d0408ceb1c8b6ae2a145305adf56`。

曾为排查 GPU 失败擅自准备 3.2–9.4 秒选段；用户明确反对裁短。该方案已撤回，`selection.json` 标为 withdrawn_by_user_correction；当前 `comparison-manifest.json` 两条由比滨均恢复完整 `yuigahama-192-mp3/reference.wav`，combined 文本也改为对应全段原文。截短方案的旧清单仅作 QA 历史证据，不得再运行或交付。用户保存关闭剪映、之后又关闭浏览器，并明确要求继续 GPU；CPU 实验取消，实际 CPU 生成调用为 0。

本次 QA 位于首轮 QA 根下 `followup-2026-10-27/`。截至记录时新中文尚未生成成功：关闭应用后仍在参考 VAE 首次计算的 `cublasCreate` 报 `CUBLAS_STATUS_NOT_INITIALIZED`，还未进入中文正文生成。完整由比滨与旧长度雪之下都发生此错误，不得把裁短当作修复。独立同 CUDA 11.6 的 `cublas-init-probe.json` 为 context/create/destroy 全部状态 0；说明不加载模型时可初始化，不证明模型加载后的资源充足。原生 CLI、两权重和 profile SHA 与首轮成功相同。C 盘约 1.1 GiB 空闲及全局提交余量偏低是线索，不能仅由错误码断言显存或系统内存耗尽。

随后同完整输入 GPU take-002 的 50 ms 观测实际取得 112 样本：全局提交余量从 4.351 GiB 降至 **5 MiB**，同点物理可用约 3.603 GiB，原生 private 峰值 5.715 GiB；7.042 秒后 cuBLAS 失败，无 WAV。`full-yui-gpu-take002-resources/{summary,verification}.json` 留证，输入 request hash 与 take-001 相同，锁均释放。该证据强烈支持系统提交内存压力；没有 GPU 瞬时采样，不把它等同显存 OOM。用户随后报告系统卡死，恢复后要求继续 GPU；下一次必须主动提交内存保护，不能继续无保护重试。恢复时 C 盘约 8.60 GiB 空闲、系统可新增提交约 6.63 GiB，属于用户环境变化，本轮未清 C 盘或修改分页文件。

参考修正页已在原 `artifacts/voice-listening/japanese-160-192/index.html` 发布，初版第二轮状态 `partial_generation_page_complete`、新中文 0，明确显示参考已更新／中文尚未生成。`round2-package-receipt.json` 验证 12 旧资产 SHA 保持、14 本地引用有效、用户源保持；未打开浏览器或宣称播放通过。之后若重试成功，须以最新回执和页面更新本节结果。

### 雪之下参考音质核对

旧播放器使用的是 16 kHz 单声道模型输入，又做了 −11.88 dB 静态增益；不应将它标作原视频品质参考。解码对照证实旧模型输入与相同 FFmpeg 转换逐采样一致，没有时间错位或额外损坏。L/R 相关系数 0.99464，平均混合仅损失约 0.0118 dB，不支持相位抵消解释；源单声道约 4.12% 能量位于 8 kHz 以上，16 kHz 输入会丢失这一部分高频。低采样率和预览音量变化能解释比较条件不同，但不证明角色不像只由这些因素造成。

`yukinoshita-diagnosis/quality-preserving/` 保存原解码与安全预览；`matched-final/` 保存等响度对照。新主参考播放器使用原采样率 44.1 kHz 双声道；完整由比滨主参考不降音量，雪之下仅留峰值余量。模型本身的 AudioVAE 仍工作于 16 kHz，交付高品质预览不等于模型内部升采样。新的安全雪之下模型输入保持原 6.85 秒，避免源 AAC 超满幅造成削波。

### 参考模式的历史结论纠正

下文首轮所引 7 月 27 日「附日语原文会混语」不能推广到 combined。重新检查历史 `compare-jaref-zh-ultimate-seed42-cap60-gpu0/result.json`，其 `reference_path` 为空，仅传 prompt_wav 与 prompt_text，实际是 continuation-only。真正 combined 同时传 `-r`、`--prompt-wav` 和 `--prompt-text`。本轮计划同 seed42/CFG2 比较 reference-only 与真正 combined；若生成失败，不能声称该模式的音质已有结论。

运行器新增显式 combined 支持及 cuBLAS fatal/Memory allocation failure 分类，遇此错误停止批次；7 项标准库测试通过。源日语 ASR 已成功，完整由比滨原文保留在 `source-asr.json`。ASR 只作文本证据，不代替主观试听。

## 输入与参考选段

输入目录 `H:/comfyui/output/sd2素材/干音/` 只读，未向其写入生成物，也没有整部翻译或逐句配音。

| 角色 | 原文件 | 原片时长 | 本轮参考范围 |
| --- | --- | --- | --- |
| 雪之下160 | `1163516765-1-160.mp4` | 约59分07秒 | 0–6.85秒 |
| 由比滨192 | `1451031154-1-192.mp4` | 约5分13秒 | 0–6.5秒 |

先对两份源音频开头各60秒做日语ASR，辅助选择完整开场对白并核对低能量结束点；这不是完整原片听辨。选段只做FFmpeg单声道混合与16kHz重采样，保存为PCM16，未做降噪、响度、EQ或音高处理。日语识别文本作为近似来源记录，未作为 `--prompt-text` 传入TTS。

永久参考根：`I:/AI/asmr_director/runtime/voice-references/japanese-characters/`，角色子目录为 `yukinoshita-160/`、`yuigahama-192/`，各含 `reference.wav` 与 `provenance.json`。来源收据保存原片与参考SHA、选段起止和处理方式。参考没有加入或改写生产profile。

## 生成配方与执行

首轮沿用已有日语跨语言实听获选的 reference-only 方向。历史依据是 `I:/AI/voxcpm2-evaluation/evidence/LISTENING_RESULTS.zh.md` 的2026-07-27记录：当时仅音频参考的中文A清楚自然，附日语原文的中文B出现混语。2026-10-27 已核实 B 实为 continuation-only，不能由此否定真正 combined；该结论也只有一段参考及一个 seed。

- 当前稳定CLI：`I:/AI/asmr_director/runtime/engines/voxcpm2/reliability-20261019/voxcpm2-cli.exe`。
- 使用生产profile登记的BaseLM Q8_0与Acoustic F16权重；本轮没有更换模型或CLI。
- 两角色均使用同一中文短句和长段、seed42、steps600上限、timesteps10、CFG2、temperature1、GPU layers0与low-VRAM，只传 `-r`，不传参考prompt文本。
- 可复用脚本：[run_reference_listening.py](../../tools/voxcpm2-runtime/run_reference_listening.py)。占用生产 `voxcpm2-generation.lock` 并串行生成；每次保留独立take、完整命令、输入/输出/日志SHA和原生退出结果，成功复用前核对SHA，失败结果不覆盖。

实际完成4次TTS，没有根据质量更换seed或重抽。另完成源音频2段日语ASR与生成结果4段中文ASR；ASR为faster-whisper-large-v3，源识别使用CUDA/int8_float16。原片、生产profile和参考内容的哈希保持，共享生产锁已释放。

## 验证结果与听感边界

QA根：`I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/`。

| 角色 | 文案 | 生成时长 | 原生耗时 | 中文ASR去标点核对 |
| --- | --- | --- | --- | --- |
| 雪之下160 | 短句 | 7.36秒 | 16.035秒 | 逐字匹配 |
| 雪之下160 | 长段 | 17.92秒 | 22.606秒 | 逐字匹配 |
| 由比滨192 | 短句 | 6.88秒 | 14.685秒 | 逐字匹配 |
| 由比滨192 | 长段 | 15.04秒 | 19.716秒 | 「调暗」识别成同音「条按」，字符相似度97.65% |

4条全部exit0、48kHz单声道PCM16、可完整读取，0削波采样、未达到600步上限、未检测到OOM。`verification.json` 独立核对输出/参考SHA、原片/profile保持和锁释放；四份 `audio/<角色>/<文案>/take-001/receipt.json` 留存具体命令、模型身份、时长和指标，`manifest.json` 留存两条实际中文文案，`source-asr.json` 与 `generated-asr.json` 留存识别结果。

`complete` 只表示原生正常退出且WAV结构有效；ASR不等于听感验收。「调暗／条按」是同音字差，不能据此断言模型真实读错。用户于 2026-10-27 反馈两角色「都不像」，首轮未获音色认可。参考雪之下选段有2个满幅采样，生成的4条均无满幅削波；不把生成结果的无削波结论套到参考本身。

两角色原音量明显不同：短句RMS分别约−14.50／−31.47 dBFS，相差约17dB，长段也约差17dB；原参考RMS约差17.22dB。音量差会影响直接听感比较，需同时保留原音并提供响度匹配副本。

## 试听交付状态

交付目录 `I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/`。已包含原始 `raw/`、仅作静态增益匹配的 `listen/`、两条原始 `references/` 和本地 `index.html`。中文4条对齐后实测为−23.01／−23.02／−23.04／−23.00 LUFS，最高真峰−1.37 dBTP，全部零削波且帧数、采样率、声道不变；原始输出SHA核对保持，HTML本地文件引用存在。完整测量、增益、命令与SHA见QA的 `package_receipt.json`。已请求在Codex打开试听页，工具返回queued；没有据此声称实际浏览器播放或主观试听通过。

两条日语参考另备 `reference-listen/` 静态音量对齐版，分别实测−23.01／−23.00 LUFS，原始参考下载保留。最终独立核对13个交付文件SHA、12个WAV和全部HTML本地引用通过，证据 `delivery-verification.json`。原页面与打包脚本历史身份仍保存在收据，最新页面以 `current_page` 为准；脚本已迁至源码tools并使用明确QA参数。

辅助脚本 `tools/voxcpm2-runtime/transcribe_reference_listening.py` 复现本机离线ASR，`package_reference_listening.py` 处理此次试听包；均不改应用生产接口。

本轮没有改应用代码、生产profile、3001启动配置或用户工程，没有部署、提交或推送；已有无关工作区改动保留。新运行器和本记录属于此次独立试听工作，音频与运行日志留在项目外置数据根，不进入Git。未重跑整站测试或验收真实H3视频。
