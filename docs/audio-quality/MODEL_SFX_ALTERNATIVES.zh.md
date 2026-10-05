# 停止本机测试后的模型音效备选方案

调研核查日期：2026-10-04。状态更新并覆盖旧结论：2026-10-05。
[English](MODEL_SFX_ALTERNATIVES.md)。

## 当前状态：暂停模型测试（2026-10-05）

用户明确表示“相当烂，没法用，先这样吧，记录一下推一版”。远端 AudioLDM2
三条刷耳输出均为 8 秒，全部被用户拒绝、判定不可用。实际生成数仍为
**本机 0 条 / 远端 3 条**，没有采用任何模型输出。听感结论已是拒绝，覆盖
此前的待确认状态。

后续模型测试暂停；选择或连接 RTX 5070 Ti 主机不再是下一步。Stable Audio
Open 适配器与外部超时/取消监督器已准备，并完成轻量/合成用例检查，但从未
执行 Stable Audio Open 模型推理。另行整理的 CC0 录音库有 13 条试听条目，
仍待听感验收，与这三条被拒绝的模型输出分开记录。

用户已授权记录现状并推送一版仅含源码的版本。发布状态与实际 push 证据由
[主记录](../records/2026-10-04-audio-quality-v1-sfx-model-test.md) 记录；本备选
方案文档本身不表示已经完成推送。

## 历史备选方案调研（2026-10-04）

在本次调研检查点，用户报告尝试约五小时且难以中断，要求先调研其他方案。
当时已停止生成：本机 0 条，远端刷耳 3 条，听感仍待确认；该状态已被上文
覆盖。本轮调研没有安装、下载模型或调用收费接口。下文能力、价格、源码
事实与建议均保留为 2026-10-04 的调研结果，并非重新核查或恢复测试指令。

| 路线 | 已核实能力与适用性 | 尚未解决的限制 |
|---|---|---|
| **本地首选：Stable Audio 3 Small-SFX，LiteRT CPU** | 官方支持 Windows x64；运行时不依赖 PyTorch/CUDA，支持 seed、阶段后释放模型。小型资产约 2.3 GB。[运行说明](https://github.com/Stability-AI/stable-audio-3/blob/main/optimized/tflite/README.md) | 文件体积不是峰值内存；本机速度、内存与护理听感未测。优化版属于实验权重。 |
| Stable Audio 3 官方 API | 云端生成 1–380 秒、可指定 seed，适合完整长段。2026-10-04 核查价格为每次成功生成 26 credits / US$0.26。[接口](https://platform.stability.ai/docs/api-reference)、[价格](https://platform.stability.ai/pricing) | 需要付费账号和 key；API 用 Large，不能把本地 Small-SFX 名称当接口模型。未试听，付费路线仍暂缓。 |
| ElevenLabs SFX v2 | 专用云端音效，API 支持 0.5–30 秒，使用 `loop=false`。[接口](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) | 没有公开 seed 参数；官方价格描述有按分钟/按生成两种口径，需先核对账号实际计费。[价格](https://elevenlabs.io/pricing/api) |
| AudioLDM small-v2 后备 | 421M 参数，16kHz 单声道，CC-BY-NC-SA-4.0。[模型卡](https://huggingface.co/cvssp/audioldm-s-full-v2) | 体积更小不能证明能避开当前错误，仍走 PyTorch/Diffusers，且限非商用；优先级较低。 |

在调研检查点，官方 HF 元数据 API 显示 **optimized 仓库**
`gated=false`、`private=false`，
revision `da6edc54ddba10bfd79a077102ded687f80e882b`。原版 Small-SFX 是另一个
有门禁的仓库，不能混称。优化版仍有 Stable Audio Community 许可，文本编码器
另有 Gemma 条款，并非 CC0。[优化版模型卡](https://huggingface.co/stabilityai/stable-audio-3-optimized)。

历史推荐基于运行方式和接口适配，不代表声音更好：在 6GB 笔记本上免费
试验本地 CPU 路线，先加入外部强制五分钟时限和可取消流程，只跑一条
20–30 秒刷耳，记录内存/耗时，失败即停。当时工具尚未实现该监督机制；
后来准备的监督器已在上文记录，但未用于执行 Stable Audio Open 推理。
当时建议首条可用后才试三个独立 seed，再扩展其他护理种类；保留原音，
检查听觉和内部重复。不同 seed 或 stereo 不能证明动作独特或双耳真实，
不能用同一摩擦片段循环加长。

公开 AudioLDM2 演示在该检查点已因免费额度拒绝后续任务，不适合作长期
供应路线。现有 3 条模型输出与另行整理的 13 条录音候选继续保留。音质 V1
继续进行中，模型测试按上文状态暂停。

## 历史补充：另一台 RTX 5070 Ti 16GB 主机

在调研检查点，用户提出另一台主机可作测试，扩大 GPU 选择；当时未要求
连接、安装或执行，也未核查那台机器的系统、系统内存和运行环境。后来的
测试准备没有执行 Stable Audio Open 推理；最新暂停决定覆盖目标主机问题。

| 模型 | 本地能力 | 选择依据与限制 |
|---|---|---|
| **Stable Audio Open 1.0** | 最长 47 秒、44.1kHz stereo、可指定 seed；官方 FP16 Diffusers 示例。[模型卡](https://huggingface.co/stabilityai/stable-audio-open-1.0) | 环境较简单，没有单独安装 FA2 的步骤，适合首次 GPU 试跑；有门禁与 Community 条款。 |
| **Stable Audio 3 Medium** | 最长 380 秒、44.1kHz stereo，可编辑/续写；官方 H200 显存峰值：30 秒 5.49GB / 380 秒 6.52GB。[项目](https://github.com/Stability-AI/stable-audio-3) | 容量上 16GB 值得测试，不能当作 5070 Ti 实测；需要兼容 FA2，适合作长段比较。 |
| **TangoFlux** | 1–30 秒、44.1kHz stereo。[项目](https://github.com/declare-lab/TangoFlux) | 受研究/数据集许可限制，不是无限制产品素材路线；无官方 5070 Ti 内存实测，须处理底层 seed。 |
| AudioGen Medium | 16kHz mono，官方推理要求至少 16GB GPU。[说明](https://github.com/facebookresearch/audiocraft/blob/main/docs/AUDIOGEN.md) | 恰到门槛，不代表充分余量；权重 CC-BY-NC-4.0，作短音效后备。 |

TangoFlux 源码 `164420faa2b3f8a28bb013ccde7006422a616fc7` 中，`generate()`
不传 seed，`inference_flow(seed=0)` 每次重设随机状态；外部改变 seed 会被覆盖。
做独立变体须向底层显式传不同 seed。这是源码核查，未生成并测量逐 bit 相同。
[封装](https://github.com/declare-lab/TangoFlux/blob/164420faa2b3f8a28bb013ccde7006422a616fc7/tangoflux/__init__.py)、
[采样器](https://github.com/declare-lab/TangoFlux/blob/164420faa2b3f8a28bb013ccde7006422a616fc7/tangoflux/model.py)。

5070 Ti 为 Blackwell / sm_120，官方 PyTorch 从 2.7/cu128 起支持；不能
直接复制 Medium 默认 cu126 或旧 FA wheel 示例。[PyTorch](https://pytorch.org/blog/pytorch-2-7/)。
FA2 `v2.8.3.post1` 已有 sm_120 构建代码，仍须验证实际二进制和调用，不能
据旧硬件列表断言 Blackwell 不支持。[构建源码](https://github.com/Dao-AILab/flash-attention/blob/v2.8.3.post1/setup.py)。
Medium 优先 Linux/WSL2；Open + Diffusers 可作较简单的 Windows 原生起点。
[FA 平台说明](https://github.com/Dao-AILab/flash-attention#installation-and-features)。

历史建议顺序为先做有时限、可取消的单条试跑，再为符合时长的模型各生成
三条 20–30 秒独立版本，Small-SFX 作专用音效参照；保留原音，检查动作、
刺耳感和重复手势。测试暂停期间，该顺序不再执行。四条 GPU 路线均未在
此实测，不声称 5070 Ti 速度或护理音质通过。
