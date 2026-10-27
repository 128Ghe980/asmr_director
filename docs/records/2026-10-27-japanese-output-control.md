# 日语输出对照与 VoxCPM2 跨语言说明

日期：2026-10-27（Asia/Hong_Kong）。承接[日语参考生成中文实验](2026-10-26-japanese-reference-chinese-listening.md)，仍属 Audio Quality V1；SFX 暂停、目标机 H3 实跑待办保持。

后续反馈：用户已确认雪之下25秒比短参考更像，但重音位置及讲话齿音噪声仍有问题；已按要求新增由比滨完整干音与雪之下参考处理对照，见[新干音和参考调整记录](2026-10-27-reference-refinement-listening.md)。以下“待用户听”保留为相应阶段的历史状态。

## 后续：雪之下参考时长对照

用户已听上述日语四条，反馈「仅音频不像，音频加原文稍微好一点，但也不算像」，四条未通过相似度验收。用户要求看雪之下参考加长效果，并询问最长时长和其他改善方案。

以同源开头 0–17.30 秒与 0–25.10 秒连续扩展，保留旧 0–6.85 秒内容；解码浮点前缀逐样本一致，两处结束点前后 100 ms 均全零。没有拼接、重复或额外降噪。模型输入仍 16 kHz mono PCM16，预览 44.1 kHz stereo PCM24，分别以约−1.0700／−1.6063 dB固定增益保留安全余量。源 MP4 SHA `c46b403d837f6ba112d226daa4ba8949a6a682c6cdb331b90d4cd99b76327f3c` 保持；由比滨完整 MP3 未动。

重新对两段做日语 ASR；恢复标点，首句沿用原6.85秒文本，新增共同前缀使用17.30秒识别结果，使两长参考的共同原文一致。`transcript-preparation.json` 保留处理与「いや／いやっ」「いえ／いいえ」等识别差异；未人工听辨确认，不把ASR当成百分之百准确转写。两段均采用 combined，目标文案、seed42、CFG2、10步及其余配置与6.85秒baseline相同。

两次新增GPU TTS均take001／exit0，分别耗时22.837和23.921秒；两输出均10.08秒、48k mono PCM16、零削波，无步数封顶。生成后两条日语ASR均对应目标文案，只见标点和「温かい／暖かい」同音字差异。源与输出ASR分别各一批2文件；无CPU TTS、无重抽。沿用用户授权的低启动门槛与50ms／1.5GiB运行保护，均无保护中止。更长是否更像，仍由用户试听判断，不能由ASR或正常退出代替。

本轮QA：前述根下 `yukino-length/`，入口为 `preparation.json`、`source-asr.json`、`transcript-preparation.json`、`manifest.json`、`generation-verification.json`、`generated-asr.json` 及独立 guard 证据。三档对照页位于 `I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/japanese/yukino-length/index.html`；旧6.85秒baseline直接链接已有文件，两个新结果保留原生与固定增益试听版。

独立复核确认两长参考各两路完整编码为109/109和157/157 patches，prefill分别361／490，没有自动截短；最低提交余量约2.144／2.100GiB，源／CLI／模型／profile当前SHA保持、锁释放。交付验证通过13个本地链接、逐样本固定增益和36项旧资产SHA；新试听实测−22.92／−23.00LUFS，无削波。未打开浏览器；证据见 `package-receipt.json`、`delivery-verification.json`。

### 参考最长时长及改善方向

1. [官方使用指南](https://voxcpm.readthedocs.io/en/latest/usage_guide.html#reference-audio)写5–30秒为实用范围，属于推荐范围。产品UI/API当前硬限1–30秒（`apps/web/src/lib/asmr/voice-reference-import.ts:180`）；不等于模型全局硬上限。
2. 官方模型总序列8192位置／6.25音频patch每秒。当前native low-vram总上下文4096，且整段prefill受n_batch1024约束、超出会assert；combined近似要求 `2*ceil(参考秒数/0.16)+tokenize(原文+目标文本)+3 <= 1024`，生成还共享4096总量。代码未见30秒自动截断；内存也可能先成为限制。因此本机实测可用参考达到本轮25.10秒，最长稳定时长仍未知，不能从token数推定分钟级支持。详见 `reference-limits-research.json` 的代码／构建身份与官方链接。
3. 我的后续实验建议：先选更有代表性的干净单人片段、核准原文；在选定参考后分别比较CFG1.5/2/2.5或10/20步。[官方参数说明](https://voxcpm.readthedocs.io/en/latest/usage_guide.html#generation-parameters)支持该范围，但不保证加步数或提高CFG就更像；强降噪可能改变原声，已处理干音保留。
4. 若仍不像，应先做官方PyTorch基线，区分native／量化实现差异和模型本身限制，尚未运行。更长期可考虑VoxCPM2 LoRA：模型卡提到5–10分钟音频，官方训练指南示例约20GB显存且依batch等配置变化；本机3060 Laptop 6GB和当前native无LoRA加载入口，不能承诺直接本机训练可行。[模型卡](https://huggingface.co/openbmb/VoxCPM2#fine-tuning)、[训练指南](https://voxcpm.readthedocs.io/en/latest/finetuning/finetune.html)。另一可比较方向为GPT-SoVITS，其官方支持日中跨语言及少量数据微调，本轮未启动或训练，也不声称必然胜过Vox。[官方仓库](https://github.com/RVC-Boss/GPT-SoVITS#features)

## 用户反馈与本轮范围

用户明确反馈第二轮中文「加日语原文明显生成的不是中文（也不是日语），但不加原文明显不像」，因此中文音色／发音没有验收通过。用户要求两种方式改生成同一段日语，并查官方的跨语言方法。本轮真实 GPU TTS 共 4 次，两角色各 reference-only / combined；没有 CPU 回退或质量重抽。

由比滨始终使用用户已处理的完整 12.64325 秒 MP3，其 SHA256 为 `59981701239ec9724cb32a18083d73e712d8d0408ceb1c8b6ae2a145305adf56`；模型参考为全段 16 kHz mono PCM16。雪之下仍使用原 6.85 秒内容。真正 combined 同时向 reference 与 prompt 输入同一参考，并传入该参考对应的日语原文；不把原文译成中文冒充音频转写。

共同目标文案：

> 少し座って休みましょう。お茶はまだ温かいので、ゆっくり飲んでください。今日のことは、明日また考えれば大丈夫です。

参数固定 seed42、CFG2、timesteps10、temperature1、steps600，沿用既有稳定 CLI、两权重、profile 及 low-vram GPU 配置。四条均 take-001、exit0、48 kHz mono PCM16、零削波、无步数封顶。

| 角色／方式 | WAV 时长 | 生成进程耗时 |
| --- | --- | --- |
| 雪之下／仅音频 | 9.92 秒 | 15.223 秒 |
| 雪之下／音频＋日语原文 | 10.88 秒 | 13.323 秒 |
| 由比滨／完整音频 | 9.44 秒 | 16.956 秒 |
| 由比滨／完整音频＋日语原文 | 9.92 秒 | 19.172 秒 |

随后独占模型锁进行一次 CUDA/int8_float16 faster-whisper-large-v3 日语识别，4 条内容均对应目标文本，差别只有标点及「温かい」识别为同音「暖かい」。这支持本批日语内容可识别，不等于主观自然度或角色相似度验收。

## 官方说法与本地实现边界

- [官方模型卡](https://huggingface.co/openbmb/VoxCPM2)列出中文和日语等 30 种语言，目标文本直接使用希望生成的语言，无需额外语言标签。
- 普通克隆只传 `reference_wav_path`；Ultimate 使用同一音频作为 `reference_wav_path` 与 `prompt_wav_path`，并提供准确 `prompt_text`。本轮两种模式参数结构与这一区分一致。
- [官方仓库贡献者 a710128 于 2026-06-03 的答复](https://github.com/OpenBMB/VoxCPM/issues/321#issuecomment-4612212263)解释：Ultimate 同时保留音色、节奏、韵律、发音习惯与口音，跨语言可能带入来源口音；若优先目标语言发音，建议普通克隆。该讨论案例是英语参考生成意大利语，不能当成日语到中文必然乱码的证明。
- [官方使用指南](https://voxcpm.readthedocs.io/en/latest/usage_guide.html)建议实用参考长度约 5–30 秒；由比滨完整干音在此范围内，不需要再裁短。干净输入无需额外降噪。

只读审计发现本批 native 日志中的目标文字／日语参考原文与 receipt 完全一致，相关日文可在当前 Windows CP936 中无损往返，没有已证实的命令行乱码。原生与官方代码都把 prompt 原文及目标文案共同编码；但原生 GGUF/llama tokenizer 与官方 HF tokenizer 的 CJK 拆分实现存在差异，尚未逐 token ID 对比，也没有跑官方 PyTorch 基线。不能把此前严重发音错误仅归因于口音迁移，也不能宣称已找到 native 根因。此次日语四条成功同样不证明跨语言实现完全等价。

## 资源授权与交付证据

用户明确授权临时退出 NVIDIA Overlay，并要求「没到启动线也生成吧」。只停止核实路径的 Overlay 进程，后续观察到它自动重启为新 PID；不声称一直关闭。未关闭 Clash Verge、驱动或其他应用，未修改分页／系统设置。

保护运行器新增显式 `--allow-low-start`：本次启动检查使用 1.5 GiB；默认启动门槛仍 5.75 GiB。运行中每 50 ms 检查全局提交余量，低于 1.5 GiB 或观测失败仍停止本次持有 handle 的子进程。四 TTS 最低提交余量 2.267–2.376 GiB，与本次 ASR 均没有触发保护。3 项既有保护回归测试通过；并不保证能阻止所有瞬时分配尖峰。ASR 最低提交余量约 2.13 GiB，退出后共享锁释放。

独立交付：`I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/japanese/index.html`。页面提供 4 条日语、原品质及等音量参考、日文和中文含义；原生文件在 `raw/`，试听 `listen/` 只作整条静态增益，约 −23 LUFS，无变速、变调、EQ 或降噪。用户全长 MP3 内容保持。13 个本地链接、逐样本增益及原生 SHA 通过；27 项原中文资产保持，未打开浏览器。

QA 根：`I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27/`。

- `japanese-output-manifest.json` 与 4 份 `japanese-guarded-*.json`。
- `japanese-generation/audio/<reference>/japanese-paragraph/take-001/receipt.json`。
- 4 份 `japanese-*-gpu-guard/summary.json`、原始 50 ms samples。
- `japanese-generation-verification.json`：独立生成／输入与参数复核。
- `japanese-generated-asr.json`、`japanese-generated-asr-guard/receipt.json`。
- `japanese-package-receipt.json`、`japanese-delivery-verification.json`。

上述初轮日语相似度已收到用户否定反馈，见文首后续；新增长参考相似度待听。本轮未部署应用、提交或推送；其他 spatial 工作保持。
