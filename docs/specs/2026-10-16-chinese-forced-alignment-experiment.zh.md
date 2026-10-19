# 中文强制对齐：独立实验协议

日期：2026-10-16。状态：**独立初测完成，未接入产品**；父阶段Audio Quality V1继续进行中，不新增顶层路线。[English version](2026-10-16-chinese-forced-alignment-experiment.en.md)。真实结果和限制见[实验记录](../records/2026-10-16-audio-quality-v1-chinese-forced-alignment-experiment.md)：三份原音及错文控制、9个可用独立Whisper窗口未显示字面改善，28合成测试通过；不代表人工盲听或完整产品切分验收。

## 实验问题与授权范围

用现有轻声音频测试逐字声学对齐能否辅助定位完整中文句尾，覆盖句末轻声语气词、句中长停顿以及可能出现的后句语气音。先测真实时间、资源占用和失败表现，再讨论产品改动。

只用三份已有完整原始WAV与限定的错文对照。不新生成TTS，不替换生产识别／切分，不改产品门槛，不创建生产候选，不确认文字或采用音频。实验报告与原PCM试听片段均放仓库外 `I:/AI/asmr-director-forced-alignment/2026-10-16/`；私人原音不得复制进Git。

## 固定模型与方法身份

WhisperX当前对 `zh` 默认选择 `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn`。该模型从XLSR-53在中文Common Voice 6.1、CSS10和ST-CMDS上微调。模型卡的历史ASR指标不代表强制对齐质量或本项目轻声准确率。[WhisperX对齐源码](https://github.com/m-bain/whisperX/blob/771b4a14a9486f8fd5aef18ef49e35d639523dd3/whisperx/alignment.py)、[作者模型卡](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn)。

| 项目 | 固定身份 |
|---|---|
| HF仓库revision | `99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd` |
| 公开ModelScope镜像 | `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn` |
| ModelScope revision | `dc70e032dd023312c750ac50ba03ade725fd8016` |
| `pytorch_model.bin`长度 | `1,276,296,151 bytes` |
| 两站文件metadata一致的权重SHA256 | `de031fd4b29e0c0667e5346450fadfe1326c89936b888b59c4ede608db763ee4` |
| 必需运行文件 | `pytorch_model.bin`、`config.json`、`preprocessor_config.json`、`special_tokens_map.json`、`vocab.json` |

仅下载这一种PyTorch权重。加载前须对完整下载文件核对长度与SHA256；服务器metadata相同或小范围测速均不能代替全文件核验。即使从ModelScope取字节，收据仍保留HF原始身份。[HF版本](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn/commit/99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd)、[HF权重metadata](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn/blob/main/pytorch_model.bin)、[ModelScope文件metadata](https://modelscope.cn/api/v1/models/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn/repo/files?Revision=dc70e032dd023312c750ac50ba03ade725fd8016&Recursive=true)。

沿用现有Torch／TorchAudio 2.8、Transformers 4.50环境，不整装WhisperX依赖栈。由 `Wav2Vec2Processor` 与 `Wav2Vec2ForCTC` 加载固定本地文件，推理阶段禁用联网。主方法为 **CUDA fp16声学推理＋TorchAudio 2.8标准CTC强制对齐**，不是完整WhisperX流程，也不声称复现其全部前后处理。

在内存制作单声道16kHz分析副本，通过processor执行配置中的归一化并提供attention mask。波形／模型转fp16时，整数mask仍保留mask类型。使用eval／inference mode，取log-softmax emissions，以blank ID 0对齐指定文本token。记录emission／CTC计算的dtype与device；CTC可采用float32 log概率。模型词表3503项，卷积stride乘积320，因此16kHz下输出步长约20ms，不是采样级的音素真值边界。[模型配置](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn/blob/main/config.json)、[processor配置](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn/blob/main/preprocessor_config.json)。

TorchAudio `forced_align`只支持batch 1，帧数须覆盖目标token及相邻重复token所需额外帧；返回log分数，取exp或聚合方式均须记录。该接口在2.8弃用、2.9移除，本次不得因此升级环境。若另做自行实现或抽取上游trellis的对照，须单独标方法并固定源码／许可证，不得暗中替换主标准CTC结果。[TorchAudio 2.8接口](https://docs.pytorch.org/audio/2.8.0/generated/torchaudio.functional.forced_align.html)、[merge_tokens](https://docs.pytorch.org/audio/2.8.0/generated/torchaudio.functional.merge_tokens.html)。

## 固定的已有原音与错文对照

`I:/AI/asmr-director-forced-alignment/2026-10-16/cases.json`为输入权威manifest，推理前在运行收据中保存其SHA256。该文件提供原音路径、WAV及PCM哈希、完整有序句文、旧plan／失败记录和历史证据。重新核对原音身份及WAV参数；不得按同名文件另找替代品，输入缺失时不得偷偷重生成。三份原音均为单声道48kHz、16-bit PCM。

| case | 已有原音trace | 时长／帧数 | 用途 |
|---|---|---|---|
| `five_sentences` | `9f662760-6b5b-4ed0-a900-e40c50ebb1d1` | 15.36秒／737280 | 句尾「啦」与既有五句安全切点历史 |
| `long_internal_pause` | `c6953f1e-bfd9-4c65-9569-0775e1537693` | 30.40秒／1459200 | 长音频内的句中停顿 |
| `following_hmm` | `7e564226-9ac0-462c-a736-38016383a316` | 26.56秒／1274880 | 后句前边界与可能出现的「嗯」 |

每份manifest基准文本均对齐同一份不变原音。五句基准首句为「回来啦。」；错文对照分别为「回来了。」「回来。」「回来香蕉啦。」及列出的雪→血／坐→做变体。对照只改指定文本，PCM完全相同；即使成功对齐也须独立报告。同音字变体可能声学不可区分，不能用CTC分数宣称核对了字形。

`following_hmm`对照在「面快好了」前加入「嗯」，来自旧ASR假说，**不是人工确认的真值文本**。它相对分数更高或时间更合理，均不能独自证明原音读了「嗯」。不得因强制对齐能找到路径就改写基准或选出所谓正确文本。

旧五句切点为2.02、5.17、8.97、12.26秒；另外两例历史各只提供目标句末5.57秒、4.36秒，其余边界未知。这些是历史安全PCM切点证据，不是音素级金标准。与旧切点的距离只作对比，不能报告成对齐准确率。

## 文本与证据规则

保留原有句文及归一化后逐字映射；标点、`~~`等格式记号单独标明没有对应的发音字目标。对所有剩余字符按固定词表逐项预检。缺字不得默默转成 `<unk>`、wildcard、猜测读音或别的字，必须显式记为不支持。大小写、数字读法或繁简等有意规范化都需保留明确映射，不能隐式改文。

当前WhisperX源码会对词表外字加入通配emission，并对部分缺失时间插值；本实验均不采用。保留未对齐、不支持、无效及低分结果，不用相邻时间补齐，不把路径存在解释为文本通过。逐字分数只描述给定文本下声学路径的证据，不是校准后的正确概率。[固定实现](https://raw.githubusercontent.com/m-bain/whisperX/771b4a14a9486f8fd5aef18ef49e35d639523dd3/whisperx/alignment.py)、[模型词表](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn/blob/main/vocab.json)。

强制对齐以给定文本为条件，漏掉句末语气词或插入词也可能获得看似合理的时间。基准与错文对照并列记录，包括字时长及分数；不得事后挑选恰好让这几例通过的数值作为接受门槛。

## 原PCM静音guard与独立识别

逐字时间只能提出搜索位置。实验可用切点候选还必须通过预期句末附近、原48kHz PCM上的真实静音区检查。记录guard实际参数、静音区起止、实测电平、搜索范围、最终源帧位置及与相邻字跨度的距离。找不到合适静音区则保留诊断，该边界不产出guard通过的切点；空结果或未对齐字不等于测到了静音。

实验试听片段只复制原PCM帧，不重采样、不淡入淡出、不补静音、不改增益、不生成声音。完整切分组须按顺序连续覆盖第0帧至最后一帧，拼接PCM与原音字节相等。报告明确区分原始逐字时间、静音guard候选和实际经独立核对的片段，均不自动发布或采用。

释放对齐模型后，计划用 `cases.json` 指向的现有本地faster-whisper-large-v3做独立复测。输入实际原音／片段PCM，不把对齐目标作为强制转录或语义解码提示。记录真实窗口、模型／选项、转录、分数、词时间及实际调用次数；核对句尾与后句保留，包括啦／了和可能的嗯。此项在真实结果收据出现前一律为**待复测**，CTC成功或旧Whisper结果都不能代替。两模型不一致仍是试听证据，不自动证明任何一方正确。

## 资源、收据与完成边界

检查现有模型活动后，实验阶段串行执行，TTS／Whisper／对齐模型不并存推理。独立工具使用可用物理内存至少 **3 GiB（3,221,225,472 bytes）**，以及Windows当前进程可新增提交余量至少 **4.82十进制GB（4,820,000,000 bytes）** 两项预算，不修改产品内存gate。提交余量取GlobalMemoryStatusEx的ullAvailPageFile，不是进程虚拟地址空间，也不是磁盘pagefile空闲。每阶段记录两项实际字节值；门槛不满足时停止并留记录。初次把提交预算套作物理内存的两次预检失败亦保留，指标修正与各次门槛写入运行记录，不把它们当模型失败。

实测模型加载时间、每原音／变体的推理与对齐时间、源时长／实时率、进程RAM基线及峰值、可用RAM、CUDA设备／dtype与allocated／reserved基线及峰值，并说明采样测量局限。CPU／fp32回退或重试均单独标记原因与运行，不能未说明就充当CUDA fp16证据。按阶段释放模型，不从权重磁盘大小推断6GB显存必定够用。

收据绑定源WAV／PCM、文本身份、固定权重／配置哈希、方法及环境版本、参数、原始逐字证据、OOV／失败状态、静音测量、片段PCM核验和实际执行的独立ASR输出。真实尝试及失败均保留。本规格不预填成功、资源数字、试听认可、准确率或独立ASR结果。

完成指有边界、有局限和证据的实验报告，包含错文对照及未完成检查；不授权生产实现、服务重启／部署、门槛放宽、确认／采用或路线变更。此前[只读评估](../records/2026-10-14-safe-cuts-and-manual-text-confirmation.md)仍是历史评估，实际结果应写入新的开发记录与仓库外收据。
