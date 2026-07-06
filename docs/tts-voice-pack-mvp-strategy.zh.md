# TTS Voice Pack MVP Strategy

Last updated: 2026-07-06

本文记录当前关于 ASMR Director 第 7 步“真实生成 MVP”的 TTS 方案决策，供后续实现对话读取。它不是新的顶层 roadmap；顶层路线仍以 `docs/ROADMAP.md` 为准。

## 背景

当前项目已经有前端生成闭环、Preview Layer、稳定 asset reference、mock playback、failure / retry / cancel 状态。下一步必须打通至少一条真实 voice clip 生成链路，产出真实可播放音频。

用户当前约束发生了变化：

- 不想先做很大的训练平台。
- 希望别人先备好参考音频或模型。
- 本项目负责把 ASMR 台词、分镜和导演参数生成成可播放音频。
- 强需求是音色克隆，目标偏“动漫角色声音”或“原创二次元角色声音卡”。

因此当前应做的是 **BYO Voice Pack 生成器**，不是完整声音训练平台。

## 核心结论

首选方案：

> 先做 GPT-SoVITS Voice Pack MVP。

含义：

- 用户自带授权参考音频或已训练好的 GPT-SoVITS 模型包。
- ASMR Director 只做推理调用、片段生成、预览、重生成和 asset 引用保存。
- 不在第一版内置训练平台。
- 不把 GPT-SoVITS 写死进 Project JSON，仍通过 TTS Router / Provider Adapter 接入。

后续顺序：

1. **GPT-SoVITS Voice Pack MVP**
   - 最适合“别人准备好模型或参考素材，我这边帮他生成”。
   - 适合声音卡原型和动漫感声线克隆。
   - 社区生态更接近“导入已有模型 / 权重 / 参考音频后推理”。

2. **IndexTTS2 zero-shot / A-B backend**
   - 适合用户只提供参考音频、不提供模型包的场景。
   - 更适合后续验证“同一角色 + 不同情绪 / 语速 / 表演控制”。
   - 商业使用和许可证需要更谨慎确认。

3. **CosyVoice3 fallback**
   - 适合作为稳定中文、多语言或通用 TTS 兜底。
   - 不是当前“动漫角色音色相似”优先级下的第一选择。

## Voice Pack 定义

第一版可支持一种或两种 voice pack 类型：

### 1. GPT-SoVITS Model Pack

用户提供：

- 模型权重。
- 配置文件。
- 参考音频。
- 参考文本 / prompt text。
- 授权声明。

系统负责：

- 校验包结构。
- 注册为 `voice_card`。
- 调用本地 GPT-SoVITS 推理服务。
- 生成 voice clip WAV。
- 将结果保存为稳定 asset reference。

### 2. Reference Audio Pack

用户提供：

- 一段或多段授权参考音频。
- 对应文本。
- 角色名 / 声音卡名。
- 授权声明。

系统负责：

- 作为后续 IndexTTS2 或 CosyVoice3 zero-shot 输入。
- 第一版可以先登记，不一定马上支持全部 provider。

## 推荐 MVP 边界

第一版只做：

- 选中 voice clip 后触发真实生成。
- 只支持一个本地 GPT-SoVITS provider。
- 只支持已准备好的 voice pack。
- 生成真实 WAV 文件。
- 通过现有 Preview Layer / selected clip preview 播放。
- Project JSON 只保存 stable asset reference 和必要 generation metadata。
- runtime job state、progress、临时文件路径不写入 Project JSON。
- 保留 failure / retry / cancel。

第一版不做：

- 在线训练。
- 数据集清洗平台。
- 声音市场。
- 用户账号、计费、权限系统。
- 多 provider UI 暴露。
- 自动判断是否侵犯版权。
- 完整项目混音与导出；这仍属于 roadmap 后续步骤。

## 架构建议

继续使用现有 Generation Bridge 思路，新增真实 provider adapter。

建议数据流：

```text
Voice Clip
  text / style / speed / timing
  voice_card_id
        |
        v
TTS Router
        |
        v
GPT-SoVITS Adapter
        |
        v
Local GPT-SoVITS Inference Service
        |
        v
Generated WAV
        |
        v
asset://clip/<clipId>/<assetId>
        |
        v
Preview Layer playback
```

Provider adapter 的职责：

- 把 ASMR Director 的 voice clip 请求转成 GPT-SoVITS 推理参数。
- 处理超时、失败、取消和重试。
- 把生成文件移动或登记到项目 asset 存储位置。
- 返回稳定 asset reference。

不建议让前端直接理解 GPT-SoVITS 的复杂参数。前端仍只理解“生成当前 clip”“使用某张 voice card”“播放生成结果”。

## 合规边界

动漫角色声线和声优声音非常敏感。产品上应采用以下口径：

- 使用“授权角色声音卡”或“原创角色声音卡”表述。
- 用户导入 voice pack 时必须确认拥有授权。
- 不默认鼓励克隆公众人物、声优、主播或商业角色原声。
- 生成记录中保留 voice pack 的授权状态字段。
- 第一版可以只做声明和元数据记录，不做复杂审核系统。

建议字段方向：

```text
voice_card:
  id
  display_name
  provider
  model_type
  reference_asset_id
  license_status
  consent_confirmed_at
```

## 第三方 runtime 与协议记录

本方案当前使用 GPT-SoVITS 作为第一条本地 TTS runtime 候选，但 ASMR Director 仓库不应直接包含 GPT-SoVITS 源码、模型权重、Python 环境、用户参考音频或生成 WAV。

当前实测版本记录：

- 上游项目：`https://github.com/RVC-Boss/GPT-SoVITS.git`
- 本地位置：`D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\GPT-SoVITS`
- 本地提交：`bf81cdb`
- 本地 `LICENSE` 显示 GPT-SoVITS 根代码许可证为 MIT License。

注意：MIT 只说明当前本地 checkout 中 GPT-SoVITS 根代码的许可证。预训练模型、ASR 模型、vocoder、用户参考音频、声音包和生成音频可能有单独授权要求，不能默认被 GPT-SoVITS 根许可证覆盖。详细边界统一记录在 `docs/THIRD_PARTY_RUNTIMES.md`。

## 对三个方案的最终排序

在“用户自备素材 / 模型，本项目帮他生成”的约束下：

| 排名 | 方案 | 定位 |
| --- | --- | --- |
| 1 | GPT-SoVITS | 第一版 Voice Pack MVP；用户给模型或参考素材，本地推理生成 |
| 2 | IndexTTS2 | 第二后端；用户只给参考音频时做 zero-shot 和表演控制验证 |
| 3 | CosyVoice3 | 稳定兜底；适合通用中文、多语言，不作为克隆优先主线 |

## 2026-07-06 runtime 实测补充

当前已经完成一次本地 GPT-SoVITS Voice Pack 真实生成验证，但尚未接入 checked-in 前端工作台。

### 已验证

- GPT-SoVITS runtime 可在本机启动并提供 `http://127.0.0.1:9880/tts`。
- 默认 voice pack 已建立在 `D:\CodexWorkplace\asmr_director_runtime\voice-packs\default`。
- 用户参考音频 `D:\temp\音频.MP3` 已转换为 `reference.wav`。
- 使用 GPT-SoVITS 自带 Faster Whisper ASR 得到了日语参考转写。
- 使用真实日语 `prompt_text` + `prompt_lang: "ja"` 可以生成中文目标文本 WAV。
- 手动生成 6 个 voice clips 并拼接出约 `59.53s` 的连贯 ASMR voice-only 试听。

### 重要路径

- Runtime root: `D:\CodexWorkplace\asmr_director_runtime`
- GPT-SoVITS repo: `D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\GPT-SoVITS`
- Python env: `D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\env-comfyui-clone`
- Voice pack: `D:\CodexWorkplace\asmr_director_runtime\voice-packs\default\voice-pack.json`
- Reference wav: `D:\CodexWorkplace\asmr_director_runtime\voice-packs\default\reference.wav`
- Prompt text: `D:\CodexWorkplace\asmr_director_runtime\voice-packs\default\prompt.txt`
- ASR list: `D:\CodexWorkplace\asmr_director_runtime\asr\output\reference-input.list`
- Faster Whisper model: `D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\GPT-SoVITS\tools\asr\models\faster-whisper-large-v3`
- Successful single test wav: `D:\CodexWorkplace\asmr_director_runtime\assets\clips\manual-test-prompt-transcribed-ja-serial.wav`
- Successful multi-clip test mix: `D:\CodexWorkplace\asmr_director_runtime\assets\mixes\workbench-asmr-test-2026-07-06.wav`
- Multi-clip manifest: `D:\CodexWorkplace\asmr_director_runtime\assets\clips\workbench-asmr-test-2026-07-06\manifest.json`

### 当前参考转写

```text
助けてくれたのかなあの時はありがとう今は財布持ってないから昼休みに非常階段に来てもらって
```

### 稳定推理参数

在本机 RTX 3060 Laptop 6GB 显存上，稳定测试路径为：

```json
{
  "batch_size": 1,
  "parallel_infer": false,
  "split_bucket": false,
  "text_split_method": "cut5",
  "prompt_lang": "ja",
  "text_lang": "all_zh",
  "speed_factor": 0.86
}
```

原因：并行推理曾触发 CUDNN / ONNX Runtime memory allocation failure。后续产品接入时默认应走保守参数，再逐步开放性能模式。

### 必须保留的教训

- GPT-SoVITS 的 `prompt_text` 是参考音频转写，不是“让模型怎么说”的自然语言提示词。
- `text` 才是真正要合成的目标文本。
- 日语参考音频用于中文 zero-shot 是可行但效果一般，跨语言口音、节奏和音色稳定性需要继续评估。
- PowerShell 管道可能把中文 JSON 请求变成 `?`；生产代码必须用明确 UTF-8 请求体。
- C 盘空间非常紧张；所有模型、缓存、临时目录和生成物都应固定到 D 盘 runtime。

### 下一步产品接入边界

下一步不是重新设计 provider，也不是再做 mock bridge，而是把这条已验证 runtime 接入现有工作台：

- 点击 selected voice clip 的 `生成` 控制。
- 通过内部 adapter 调用本地 GPT-SoVITS API。
- 把生成 WAV 保存到 runtime asset storage。
- 返回稳定 asset reference。
- 让现有 Preview Layer / selected clip preview 播放真实音频。
- 继续保持 runtime job state 不进入 Project JSON。

该工作仍然属于 `docs/ROADMAP.md` 第 7 步“真实生成 MVP”，不能升格为新的顶层 roadmap gate。

## 给后续实现对话的建议

下一步不要再扩大成“训练平台”。请聚焦一个可验收闭环：

> 导入或配置一张 GPT-SoVITS voice pack，选中一个 voice clip，点击生成，得到真实 WAV，并在现有 Preview Layer 中播放。

验收标准应对应 `docs/ROADMAP.md` 第 7 步：

- 用户点击 voice clip 生成控制后，可以触发真实本地生成服务。
- 结果是真实可播放音频文件，不再是 mock WAV synthesis。
- Project JSON 只保存稳定 durable asset reference。
- 生成结果可以走现有 selected clip preview flow 播放。
- failure、retry、cancel 仍然可用。

实现时请优先保持现有项目边界：

- 不改变顶层 roadmap。
- 不把 adapter / API wrapper 升级成新的 roadmap 步骤。
- 不让 runtime state 污染 Project JSON。
- 不把 GPT-SoVITS 参数泄漏成前端长期 API。
