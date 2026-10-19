# 中文强制对齐独立实验

用于比较给定中文文稿的CTC时间候选与现有Whisper切分。采用WhisperX默认中文Wav2Vec2模型和现有TorchAudio 2.8的标准CTC接口，**不是完整WhisperX流程**。不安装依赖、不生成TTS、不写生产候选或人工确认。

实验模型、已有原音路径和全部输出都在仓库外。协议见[中文版](../../docs/specs/2026-10-16-chinese-forced-alignment-experiment.zh.md)／[English](../../docs/specs/2026-10-16-chinese-forced-alignment-experiment.en.md)，本轮实测见[结果记录](../../docs/records/2026-10-16-audio-quality-v1-chinese-forced-alignment-experiment.md)。使用已有Torch／TorchAudio 2.8、Transformers 4.50、OpenCC、NumPy、SciPy和psutil环境；不要升级生产环境。

```powershell
& '<现有ASR环境>/python.exe' -B tools/forced-alignment/experiment.py `
  --model '<本地已核验模型目录>' --cases '<冻结cases.json>' --output '<新的实验输出目录>'

& '<现有ASR环境>/python.exe' -B tools/forced-alignment/compare_asr.py `
  --model '<已有faster-whisper-large-v3目录>' --jobs '<冻结asr-jobs.json>' --output '<对照报告.json>'

& '<现有ASR环境>/python.exe' -B -m unittest discover -s tools/forced-alignment -p 'test_*.py' -v
```

`cases.json`包含`cases`数组。每项使用`id`、原始PCM16 WAV的`source`／`sourceSha256`、有序`clauses`，可选每边界的`baselineCuts`（未知用null）及`variants:[{id,clauses}]`。每段最多45秒，每次最多10段；自动先测试reference，同段变体复用同一次声学推理。

输出包含逐字时间、声学分数、原文归一化映射、词表不支持状态、真实静音与80ms保护区、资源和耗时。只有reference所有边界都有候选时才保存整组原PCM切片，并核验拼回字节完全一致。输出目录必须为空，不能与模型或原音目录重叠。`safe`只表示通过本实验的静音候选规则；`text_correctness`仍为`not_verified_by_forced_alignment`。

`asr-jobs.json`包含`jobs:[{id,source,sourceSha256,expected,provenance}]`，输入必须为48kHz单声道PCM16，每窗不超过35秒、最多12窗、合计不超过180秒。沿用现有Whisper CPU int8识别参数，保存真实文字和字面分数；相同PCM和expected只识别一次，其余标记cache_hit。它不会更新产品识别分数或自动确认。

Windows启动检查分别记录可用物理内存至少3GiB、当前进程可新增提交余量至少4.82十进制GB；不是修改产品门槛，也不是把磁盘pagefile空闲当RAM。模型分阶段串行加载，实际峰值另行记录。强制对齐能为错误文稿排出时间，不可据路径存在、平均分或静音候选证明文稿完整。
