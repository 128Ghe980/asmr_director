# Stable Audio Open 1.0 本地对比

**最新状态，2026-10-05：**用户反馈 **“相当烂，没法用，先这样吧，记录一下推一版”**。
三条远端 AudioLDM2 8 秒刷耳输出全部拒绝、不可用；计数仍为**本机 0 / 远端 3**，
没有采用。后续模型测试暂停，5070 Ti 主机问题不再作为下一步待答事项。
本 Open 适配器和监督器只完成工具准备，从未执行 Open 模型推理。
独立 CC0 录音试听库仍待听感确认。已授权记录/推送，本条不宣称发布完成。
见 [当前记录](../../docs/records/2026-10-04-audio-quality-v1-stable-open-resume.md)。

[English](README_stable_open.md)。此适配器为此前提出的 CUDA 对比准备，当前实现
没有生成音频，也没有验证 RTX 5070 Ti 的性能。环境安装、模型协议接受和权重获取
是独立步骤；本脚本不会执行这些操作。

[官方模型卡](https://huggingface.co/stabilityai/stable-audio-open-1.0)说明模型原生输出
44.1 kHz 双声道，每次最长 47 秒，使用
[Stability AI Community License](https://huggingface.co/stabilityai/stable-audio-open-1.0/blob/main/LICENSE.md)。
保留固定版本对应的许可证和模型卡。此处只做独立试听实验，产品接入和商业用途资格
需要另行确认。

提供现有、完整的 **Diffusers** 本地快照，包含 `model_index.json`、scheduler、
tokenizer、text_encoder、projection_model、transformer、vae 子目录及其 safetensors
权重。只有 stable-audio-tools 的顶层检查点不能使用。`--revision` 必须填写下载时
固定的完整 40 位上游提交 SHA。Hugging Face `snapshots/<SHA>` 路径会核对目录名；
复制到普通目录时，SHA 只是调用者提供的来源记录，离线适配器无法验证上游身份。
在实验目录外保留下载凭据和各权重校验值。

运行环境需要 CUDA PyTorch、支持
[StableAudioPipeline](https://huggingface.co/docs/diffusers/api/pipelines/stable_audio)
的 Diffusers、Transformers、Accelerate、NumPy、SciPy、Safetensors，以及 tokenizer
所需依赖。5070 Ti 属于 Blackwell，需要兼容的 CUDA 栈；
[PyTorch 2.7](https://pytorch.org/blog/pytorch-2-7/)开始通过 CUDA 12.8 构建支持
Blackwell。不能据此保证任意旧环境或 wheel 可用。适配器不会安装依赖。

默认 FP16，直接 `pipe.to("cuda")`，面向计划中的 16 GB 主机。
`--cpu-offload`（别名 `--enable-model-cpu-offload`）才会显式使用模型 CPU 卸载，
没有自动降级。默认时长 24 秒、50 步、guidance 7、每次一条音频、CPU 单线程。
类别和种子默认读取现有 `prompts.json`；首轮务必显式选择一个类别和一个种子。

所有待生成任务必须通过 **`run_bounded.py`** 启动，整个子进程最多 **300 秒**，
包括导入和模型加载。监督器保留日志与凭据，支持 Ctrl-C 和取消文件，超时或取消
后终止其负责的进程树。适配器在导入昂贵依赖前检查监督器的环境启动约定；此约定
不是认证机制。不要手动设置相关变量绕过监督器。

仅在用户明确恢复模型测试，并确认实际主机、本地快照和运行环境后，才在仓库根目录
执行，并将占位路径和提交 SHA
改成真实值。权重、环境、日志和音频保存在 Git 外。以下示例尚未执行。

PowerShell：

```powershell
$taskPython = 'X:/existing-runtime/python.exe'
$taskModel = 'X:/models/stable-audio-open-1.0/snapshots/ACTUAL_COMMIT_SHA'
$taskRevision = 'ACTUAL_40_CHARACTER_COMMIT_SHA'
$taskOutput = 'X:/experiments/stable-open/brush-24s-first'
& $taskPython tools/sfx-model-test/run_bounded.py --timeout-seconds 300 --log-path "$taskOutput/run.log" --receipt-path "$taskOutput/run-receipt.json" --cancel-file "$taskOutput/cancel" -- $taskPython tools/sfx-model-test/generate_stable_open.py --model-path $taskModel --revision $taskRevision --artifact-root $taskOutput --categories ear_brushing --seeds 104729 --duration 24 --steps 50
```

Linux / WSL（路径必须在实际主机上可访问）：

```sh
task_python=/path/to/existing-venv/bin/python
task_model=/path/to/stable-audio-open-1.0/snapshots/ACTUAL_COMMIT_SHA
task_revision=ACTUAL_40_CHARACTER_COMMIT_SHA
task_output=/path/to/experiments/stable-open/brush-24s-first
"$task_python" tools/sfx-model-test/run_bounded.py --timeout-seconds 300 --log-path "$task_output/run.log" --receipt-path "$task_output/run-receipt.json" --cancel-file "$task_output/cancel" -- "$task_python" tools/sfx-model-test/generate_stable_open.py --model-path "$task_model" --revision "$task_revision" --artifact-root "$task_output" --categories ear_brushing --seeds 104729 --duration 24 --steps 50
```

在另一个终端创建指定的取消文件即可取消；已存在的取消文件会阻止启动。强制超时、
取消或原生崩溃可能使清单保留 `loading` 或 `running` 状态，以监督器凭据记录的
终止结果为准。保留整个目录并停止。先检查失败首例，再显式选择新目录启动；没有
自动重试或失败后的批量继续。不要用忽略退出码的 shell 循环连续启动多个尝试。

输出两个声道原样保存为 float32 WAV，不调增益、不削波、不混音、不循环或拼接，
不降噪、淡入淡出或添加空间处理。每条都从独立种子的噪声开始。严格检查帧数、
有限数值和非静音；形状正确但检查失败的原始 WAV 仍保留，标为失败。意外输出
形状保存为诊断 NPY，随后立即失败。所有成功结果都会保留，试听验收均为待定。
原生双声道不等于真实双耳录音，也不能证明 ASMR 质量。

`generation-manifest.json` 兼容 `analyze_and_listen.py`，记录原始 SHA256、提示词、
种子、时长、步数、主机、Python/依赖版本、CUDA/GPU、显存容量及加载前空闲字节、
模型放置方式、scheduler、进程显存峰值和推理耗时。峰值只覆盖此 PyTorch 进程；
推理耗时不包含模型加载和写文件。记录模型索引 SHA256，但它不能代替权重下载凭据。

```powershell
& $taskPython tools/sfx-model-test/analyze_and_listen.py --manifest "$taskOutput/generation-manifest.json" --artifact-root $taskOutput
```

再次选择成功案例时会核对请求、提示词和原始 SHA256，不加载模型，保留现有结果。
完成目录可以加入其他类别或种子，但公共参数和提示文件必须一致。改变时长、步数、
放置方式、CPU 线程数、模型路径/版本或提示文件必须使用新目录。失败或中断目录
禁止继续生成。已有原始输出永不覆盖。

准备阶段只检查标准库解析、错误参数、路径和清单保留规则。监督器测试只使用合成
进程。这些检查没有进行模型推理、生成模型音频或验证试听质量。
