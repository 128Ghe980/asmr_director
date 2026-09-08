# VoxCPM2 调研、集成与试听报告

日期：2026-07-26

状态：主要试听已完成；温柔中文长文本已有当前首选，尚未接入产品

读者：后续实施会话

## 1. 执行结论

VoxCPM2 值得作为 ASMR Director 的第三个人声候选进行本地测试。它的核心价值不是单纯增加一个 TTS 名称，而是补足当前方案在以下方面的不足：

- 无需微调的 zero-shot 声音克隆；
- 在保留参考音色的同时，用自然语言控制柔和、耳语、情绪和语速；
- 中文、英文及跨语言生成；
- 48 kHz 输出；
- 更适合把 Timeline DSL 中的 `emotion`、`style` 和 `pace` 转化为真实可听的表演差异。

本机是 NVIDIA GeForce RTX 3060 Laptop GPU，只有 6 GB 显存。VoxCPM2 官方 BF16 推理档约需 8 GB，因此第一轮不应强行从 PyTorch BF16 产品接入开始，而应优先验证官方文档收录的 GGUF 路线：

```text
VoxCPM2-BaseLM-Q8_0.gguf
+ VoxCPM2-Acoustic-F16.gguf
+ llama.cpp-omni
```

Q8 运行档通过稳定性和耳机盲听后，才能注册为实验 Provider。它在试听中胜过现有 GPT-SoVITS / CosyVoice 候选之前，不应替换默认人声来源。

## 2. VoxCPM2 是什么

VoxCPM2 是 OpenBMB / ModelBest 团队发布的 tokenizer-free、多语言扩散自回归 TTS 模型。官方资料给出的主要信息如下：

- 约 2B 参数；
- 约 236 万小时多语言训练数据；
- 30 种语言与 9 种中文方言；
- MiniCPM-4 语言模型骨干；
- AudioVAE V2，16 kHz 编码、48 kHz 解码；
- 6.25 Hz 语言模型音频 token rate；
- 代码和原始权重按 Apache-2.0 发布。

“Tokenizer-free”在这里主要指语音生成不依赖外部离散语音 tokenizer，而是在连续语音潜空间中建模。它不代表文本输入完全不做文本 tokenization。

官方模型及文档：

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [VoxCPM2 模型卡](https://huggingface.co/openbmb/VoxCPM2)
- [VoxCPM2 技术报告](https://arxiv.org/abs/2606.06928)
- [VoxCPM2 官方音频样例](https://openbmb.github.io/voxcpm2-demopage/)

## 3. Zero-shot 与生成模式

VoxCPM2 的几种模式必须明确区分。

### 3.1 普通 TTS

只给目标文本，不给参考音频。模型自行选择声音和韵律。这能生成语音，但不能复制某个特定说话人。

### 3.2 Voice Design

不提供参考音频，在文本前加入自然语言描述，例如：

```text
(A soft-spoken, breathy female voice with a calm ASMR delivery)
把眼睛慢慢闭上，今天已经结束了。
```

模型据此设计一个新声音。这是无参考音频的声音设计，不是对真实人物的声音克隆。

### 3.3 Reference-only Controllable Cloning

提供一段已获授权的参考音频，不需要参考音频文本，也不需要微调。参考音频决定“谁在说”，括号内控制指令决定“怎么说”：

```text
reference_wav_path = authorized_reference.wav
text = "(A very soft, breathy near-whisper, slow and comforting)把眼睛慢慢闭上。"
```

这是本项目第一轮最应该测试的模式。它同时覆盖：

- zero-shot 音色克隆；
- 跨语言克隆；
- 情感、语速和说话风格控制。

### 3.4 Ultimate Cloning

同时提供参考音频、参考音频的准确文本和目标文本。模型以音频续写方式尽量保留参考声音中的音色、节奏、呼吸和情绪细节。

Ultimate Cloning 可以作为“音色相似度上限”附加测试，但不建议作为 ASMR Director 的默认模式：

- 它依赖准确的参考文本；
- 更倾向延续参考录音的表演上下文；
- 当前项目需要执行每个 Clip 自己的导演字段，而不是机械复制参考片段节奏。

## 4. 官方质量证据应如何解读

VoxCPM2 在作者报告的 Seed-TTS-eval 上得到：

| 测试 | 可懂度 | 说话人相似度 |
| --- | ---: | ---: |
| 英文 | WER 1.84% | SIM 75.3% |
| 中文 | CER 0.97% | SIM 79.5% |
| Hard 中文 | CER 8.13% | SIM 75.3% |

这些结果表明它的中英文 zero-shot 克隆属于开源模型第一梯队，但不能据此宣称绝对最佳：

- LongCat-Audio-DiT 在同表的相似度更高；
- Qwen3-TTS、Fish Audio S2 等模型在部分可懂度指标更强；
- 表格由 VoxCPM2 作者整理，最终选型仍必须以本机同素材盲听为准。

在 InstructTTSEval 中，VoxCPM2 的英文声音设计与指令遵循非常有竞争力；中文控制也有效，但部分维度低于 Qwen3-TTS。官方同时明确说明 Voice Design 和 Style Control 会随生成轮次波动，建议生成 1–3 次挑选。

因此，本项目应把 VoxCPM2 视为“很强的候选”，而不是在试听前预设它一定胜出。

## 5. 对 ASMR Director 的价值

VoxCPM2 与本项目最匹配的能力是“可控克隆”：同一个已授权声音，可以分别生成普通、柔和、耳语、困倦、安抚等候选，而不必为每种风格训练一个模型。

推荐把现有导演字段转换成稳定、明确的自然语言控制指令。例如：

| Timeline 字段 | 推荐控制语义 |
| --- | --- |
| `emotion: comforting` | calm, reassuring and comforting |
| `emotion: sleepy_whisper` | sleepy, intimate and barely above a whisper |
| `style: soft` | very soft, breathy and gentle |
| `style: whisper` | close, natural near-whisper without dramatic emphasis |
| `pace: slow` | slow pace with relaxed pauses |
| `emotion: fade_out` | gradually softer and sleepier toward the end |

第一轮可以优先使用英文控制指令，即使目标文本是中文；官方指令基准显示英文控制能力更稳定。实施会话应保留映射层，不要把任意 UI 字符串未经处理直接拼入模型提示。

以下内容不应交给 TTS 控制提示：

- 左耳、右耳；
- 距离；
- 水平或垂直环绕；
- Timeline 音量、淡入淡出。

这些仍由项目已有的空间音频和混音层负责，避免同一效果被 TTS 与后处理重复实现。

## 6. 显存和量化结论

### 6.1 BF16 推理档

官方模型卡标注 VoxCPM2：

- dtype：BF16；
- 模型文件约 4.96 GB；
- 推理 VRAM：约 8 GB。

8 GB 是推理参考值，不是训练要求。2B BF16 权重本身约占 4 GB，实际推理还需要 AudioVAE、ResidualLM、LocDiT、激活值、上下文缓存、CUDA workspace 和框架分配器。

本机只有 6 GB 显存，而且 Windows 桌面还会占用一部分显存。原生 PyTorch CUDA 路径可能在模型加载后、第一次生成时才 OOM，不能只以“模型成功加载”判定可用。

CPU 推理是官方支持路径：

```python
VoxCPM.from_pretrained(
    "openbmb/VoxCPM2",
    device="cpu",
    optimize=False,
    load_denoiser=False,
)
```

它适合接口或音质验证，但速度可能无法接受，必须测量而不是假设。

### 6.2 推荐的 Q8 GGUF 档

官方仓库已把 `llama.cpp-omni` 列为 VoxCPM2 的端侧运行方案，并推荐：

| 文件 | 精度 | 大小 | 作用 |
| --- | --- | ---: | --- |
| `VoxCPM2-BaseLM-Q8_0.gguf` | Q8_0 | 约 1.6 GB | 基础语言模型 |
| `VoxCPM2-Acoustic-F16.gguf` | F16 | 约 1.7 GB | ResidualLM、FSQ、LocEnc、LocDiT、AudioVAE |

需要强调：

- 这不是完整 INT8；只有 BaseLM 是 Q8_0，声学栈仍是 F16；
- 权重文件合计约 3.3 GB，不等于推理峰值显存只有 3.3 GB；
- 官方说明 BaseLM Q8_0 相比 F16 体积约减半，质量损失很小，但本项目仍需自己盲听；
- `llama.cpp-omni` 支持 CPU、Metal、CUDA 和 Vulkan；
- 当前没有官方 PyTorch INT4 / AWQ / GPTQ VoxCPM2 作为推荐路径。

第一轮使用：

- [llama.cpp-omni](https://github.com/tc-mb/llama.cpp-omni)
- [VoxCPM2 GGUF 权重说明](https://huggingface.co/DennisHuang648/VoxCPM2-GGUF)

Hugging Face 上还有 MLX INT8/INT4、ONNX 和其他社区转换。MLX 主要面向 Apple Silicon；其他社区版本不应在第一轮替代官方文档收录的 Q8 路线。

## 7. 第一轮测试路线

### 7.1 运行可行性探针

先在仓库外的 D 盘 runtime 中测试，不先改产品调用链。实施会话根据现场最新结构决定具体目录与包装方式，但必须：

1. 固定 `llama.cpp-omni` 源码提交；
2. 固定 GGUF 文件名称、来源和校验值；
3. 优先构建 Windows CUDA 版本；CUDA 不可用时可试 Vulkan或 CPU；
4. 使用当前已获授权的同一参考音频；
5. 连续生成至少 3 次；
6. 记录峰值 VRAM、系统内存、模型加载时间、单句生成时间、音频时长和 RTF；
7. 保存 stdout、stderr 和完整生成参数。

如果 Q8 仍持续 OOM、崩溃或生成不可懂语音，应停止产品接入，先记录失败证据。不得静默切换到另一个模型或假装成功。

### 7.2 推荐的 VoxCPM2 测试模式

主测试使用 Reference-only Controllable Cloning：

- `cfg = 2.0`；
- `timesteps = 10`；
- 使用固定 seed，另用 2 个额外 seed 检查波动；
- 使用相同授权参考音频；
- 关闭与比较无关的自动后处理；
- 保留原始 48 kHz mono WAV。

测试至少覆盖：

1. 普通、自然的近讲；
2. 柔和、慢速；
3. 自然耳语或近耳低语；
4. 困倦、安抚；
5. 当前参考语言到中文的跨语言克隆。

Ultimate Cloning 只额外生成一组，用来判断音色和细节上限，不参与默认模式决策。

### 7.3 A/B/C 样本

GPT-SoVITS、CosyVoice 和 VoxCPM2 必须使用：

- 同一个已授权参考音频；
- 同一段目标文本；
- 相同内容分句；
- 相近响度；
- 不暴露 Provider 名称的随机顺序；
- 原始输出和响度匹配输出都保留。

推荐三句固定文本：

```text
今天辛苦了，现在什么都不用做，慢慢放松就好。
把眼睛慢慢闭上，听着雨声，我会一直陪着你。
不用担心，也不用急着睡着，只要安静地呼吸。
```

每个 Provider 至少保存普通版和“更柔”版。VoxCPM2 再保存一个明确耳语版，用来验证控制能力是否真的存在。

## 8. 验收标准

### 8.1 运行门槛

VoxCPM2 Q8 必须：

- 连续 3 次生成无 OOM、进程崩溃或不可恢复错误；
- 输出为可读取、非空的 WAV；
- 没有整句截断、严重重复或明显乱码发音；
- 记录真实峰值显存和生成耗时；
- 失败时返回明确错误，不覆盖旧资产。

如果只能使用 CPU，也可以完成音质评估，但应记录为 `experimental_cpu`；耗时不可接受时，不进入交互式默认 Provider。

### 8.2 自动音频检查

每个输出至少检查：

- sample rate、channels、duration；
- peak、RMS、clipped sample count；
- 开头和结尾异常静音；
- 片段开头 click/chirp；
- 参考音频尾音泄漏；
- 过短、过长、整句截断和重复。

### 8.3 耳机盲听维度

使用 1–5 分并记录具体原因：

- 音色相似度；
- 中文可懂度与发音；
- 自然度；
- 柔和/耳语指令遵循；
- 情感是否符合 Clip；
- 呼吸感和近讲感；
- 金属感、底噪、click、爆音或漂移；
- 长时间听感是否疲劳。

通过标准：

- 在响度匹配的三组固定样本中，VoxCPM2 的“更柔”版至少有 2 组被稳定判断为比普通版更柔；
- 相比 GPT-SoVITS / CosyVoice，至少在 2 组中成为“柔声 ASMR”首选或并列首选；
- 不以明显降低音色相似度或可懂度换取柔和；
- 没有高频出现的 click、截断或音色漂移；
- 用户完成耳机试听并明确批准后，才可以设为默认或动作 Provider。

## 9. 产品接入原则

报告不规定实施会话的详细文件结构。实施会话应先检查最新分支和当前 Provider 注册方式，再遵循现有边界接入。

必须保持以下原则：

- VoxCPM2 首先是实验候选，不直接替换正式资产；
- 按已批准的方案建立候选、试听、采用和撤回边界，同时复用现有的稳定资产、预览、版本和重混基础设施；
- 复用现有授权 Voice Pack，不接受未确认授权的参考音频；
- 记录 Provider、后端、量化档、权重版本、seed、CFG、timesteps、控制指令和参考音频标识；
- 参考音频路径只能来自允许的 runtime / voice-pack 根目录；
- 不把模型权重、运行环境、用户参考音频或生成 WAV 提交进 Git；
- 不把 Provider 私有参数扩散进 Timeline DSL；
- 左右耳和空间运动继续由后处理层完成；
- 如果现场已经存在 CosyVoice 或 Provider registry，应扩展现有抽象，不另起平行调用链。

## 10. 已知风险

1. **控制结果波动**

   官方建议为 Voice Design 和 Style Control 生成 1–3 次再选择。固定 seed 能复现单次结果，但不代表不同文本都同样稳定。

2. **片段开头 artifact**

   官方仓库已有 one-shot 克隆开头出现 click/chirp 或参考尾音泄漏的用户报告。大量短 Clip 拼接时尤其要检查。

3. **长文本音色漂移**

   长输出可能逐渐偏离参考音色。本项目按 Clip 生成能降低长文本风险，但会增加句间一致性和接缝检查需求。

4. **跨语言口音**

   模型可以保留音色跨语言生成，但也可能保留参考说话人的口音。当前参考音频若为日语、目标为中文，必须作为单独测试项。

5. **48 kHz 不等于真实录音带宽**

   AudioVAE V2 从 16 kHz 表征重建 48 kHz，是模型内置超分辨率，不代表恢复了参考录音中原本不存在的细节。

6. **量化质量不等于 BF16**

   官方称 BaseLM Q8_0 质量损失很小，但 ASMR 对呼吸、齿音和微小韵律非常敏感，必须以本机盲听验证。

7. **许可与声音授权**

   原始代码和权重按 Apache-2.0 发布；GGUF 转换继承原始权重条款。参考声音仍需单独取得授权，生成内容不得用于冒充、欺诈或误导。

## 11. 给实施会话的最终指令

实施会话应把本报告当成模型评估和验收约束，不是固定的代码文件清单。

执行顺序：

1. 检查最新代码、现有 CosyVoice/GPT-SoVITS 状态和候选流程；
2. 在 D 盘 runtime 完成 VoxCPM2 Q8 GGUF 独立探针；
3. 保存运行证据和原始 WAV；
4. 通过运行门槛后，以最小方式注册实验 Provider；
5. 完成同参考、同文本、响度匹配的 A/B/C；
6. 把试听文件、参数、指标和结论交给用户；
7. 未经用户耳机试听批准，不切换默认 Provider，不宣称“更柔”已经完成。

## 12. 主要资料

- [VoxCPM 官方仓库](https://github.com/OpenBMB/VoxCPM)
- [VoxCPM2 模型卡](https://huggingface.co/openbmb/VoxCPM2)
- [VoxCPM2 官方文档](https://voxcpm.readthedocs.io/en/latest/models/voxcpm2.html)
- [VoxCPM2 技术报告](https://arxiv.org/abs/2606.06928)
- [VoxCPM2 官方音频样例](https://openbmb.github.io/voxcpm2-demopage/)
- [llama.cpp-omni](https://github.com/tc-mb/llama.cpp-omni)
- [VoxCPM2 GGUF 权重说明](https://huggingface.co/DennisHuang648/VoxCPM2-GGUF)
- [one-shot cloning click/chirp 报告](https://github.com/OpenBMB/VoxCPM/issues/272)
- [长文本音色漂移报告](https://github.com/OpenBMB/VoxCPM/issues/302)

## 13. 试听定案补充（2026-09-04）

### 13.1 当前首选

在已测试的温柔中文参考和 16 短句长文本上，当前首选成品为：

`I:\AI\voxcpm2-evaluation\listening\longtext-deepseek-class-local-pause-20260904\03_deepseek_class_local_rule.wav`

当前首选流程是：

1. 使用本地 VoxCPM2 GGUF、`gpu_layers=0` / low-VRAM 和温柔中文参考音频；提供准确参考文本，把其中的标点换为空格，并在末尾保留一个空格。当前成品使用 `cfg=2`、`timesteps=10`、`temperature=1`；第 1–5 组来源是 `seed=7901`、`max_steps=420` 的长开头生成，真结尾来源是 `seed=8201`、`max_steps=220`。这些值用于记录本次成品来源，不是产品默认值。
2. 主体候选用中文省略号连接短句；真正的结尾单独生成，实际文本为 `……我会一直陪在这里……不催促你，也不会突然离开，直到困意自然地靠近。`，其中仍有句首省略号和“这里”后的连接省略号，后半段使用自然逗号并以句号收尾。不要直接采用一次整段生成的全部结果，因为长文本后半段容易变尖、出现电流音或偏离参考音色。
3. 先按语意把文本分组。2026-09-08，用户决定按已成功样片保留固定中性补句，作为长文产品默认条件；用户回忆此前整段生成后半段会变快、变尖。非末组输入为“目标组 + 剩余全部正文 + 按需添加的固定中性补句”，完整生成后只取开头的目标组；末组独立生成真正的结尾，不补全文本。旧样片的 16 句构造和约 177–196 字输入只是样片细节，不是所有文案的硬上限，不能截断正文凑 16 句。固定补句的独立效果未做消融，不能据此宣称其单独因果已证实；这不再是待办、删除优化或接入前置。每组保留多个候选并检查内容完整、音色和异常噪声。
4. 当前 class-local 成品只重定时 5 个语义组间连接；组内 10 个短句停顿保持 VoxCPM2 原样，只作为测量和兜底证据，不能把这条方案扩大成重排全部 15 个边界。连接处先由文本模型判断短、中、长停顿，再参考连接前后两组内部短句的真实停顿。只有无法得到合适结果时，才使用短 180 ms、中 350 ms、长 600 ms 的默认值。
5. 本次五处连接最终为 `350 / 350 / 350 / 440 / 290 ms`。用户试听认为固定类型默认版和局部版都自然，综合选择局部版，因为它更能适应前后内容。

### 13.2 当前结论的边界

- 这是当前温柔中文参考、该文本和已挑选素材下的最好结果，不是所有音色、语言和文本的通用最优。
- 更柔主要来自温柔参考音频和候选选择，不能据此宣称自然语言“更柔”指令已在所有情况下稳定实现。
- 当前成品包含候选挑选、截取和拼接，还不是可稳定一键复现的产品功能。
- 当前试听成品第 1–5 组均来自 seed7901 的长开头生成；为了修复第 5 组读音，实际改用从第 9 句开头的连续长生成中截取的中段；第 6 组使用已认可的 seed8201 真结尾。这些 seed 只记录本次成品来源，不是建议锁定的默认值。第 5 组替换是本次成品的例外，以后默认流程仍是“当前语义组置于长文本开头，整段生成后只截开头组”。
- 六组结构最初由本地 Ollama `qwen3:1.7b` 给出，后来 DeepSeek V4 独立复核得到相同分组；最终短/中/长停顿分类来自 DeepSeek。它们都只分析文本，不生成声音；产品必须保留免费本地分析和固定默认停顿作为兜底。
- 关键试听结论和技术证据索引位于 `I:\AI\voxcpm2-evaluation\evidence\LISTENING_RESULTS.zh.md`；2026-08-12 至 2026-09-03 的逐轮细节需继续查看各试听包 README 与 JSON 证据。
