# 多类型真实 Clip 生成设计

状态：2026-07-07 由用户授权 Codex 自行设计。用户要求写好第 8 步计划并在离开电脑后直接开始实施。

## 目标

Roadmap 第 8 步要把真实 clip 生成从 voice 扩展到非人声类型。至少两个非 voice clip 类型必须能通过现有“选中片段生成”流程生成可播放音频，Project JSON 只保存 `asset://clip/...`，并且能通过现有 Preview Layer 预览。

本设计直接覆盖当前 demo 里的三类非 voice：

- `breath`
- `sfx`
- `ambience`

## 选定方案

非人声先使用本地程序化音频生成器。

voice 继续走 GPT-SoVITS。breath、SFX、ambience 在 Next Node API 中本地渲染为确定性的 PCM WAV，再通过现有 local asset store 保存。这样不需要新增大模型下载，不增加 C 盘 / D 盘模型压力，也不会把第 8 步拖成另一个 runtime 集成项目。

## 方案取舍

1. **本地程序化生成，选定**
   - 优点：不下载新模型、可离线、测试稳定、与现有 D 盘 runtime 兼容、风险低。
   - 缺点：音质是“可用的半真实音效”，不是模型级高品质。

2. **现在接入专门 SFX / ambience 模型**
   - 优点：未来可能有更丰富质感。
   - 缺点：安装、授权、磁盘和稳定性风险都高，会再次推迟真实生成路线。

3. **只用素材库**
   - 优点：如果有授权素材库，音质最稳定。
   - 缺点：当前仓库没有可用授权素材库，也不能很好验证 generation 参数。

## 架构

新增 `apps/web/src/lib/asmr/procedural-audio.ts`。

它负责：

- 接收非 voice `TimelineClip`；
- 根据 clip 类型、内容字段、seed、duration、fade、volume、位置等信息生成确定性 mono WAV；
- 输出 32 kHz、16-bit PCM WAV；
- 不向项目数据返回任何本地绝对路径。

改造 `apps/web/src/lib/asmr/local-clip-generation.ts`：

- `voice` 继续走 GPT-SoVITS；
- `breath`、`sfx`、`ambience` 走程序化生成；
- 不支持的类型给清晰错误；
- 返回值仍然是 `GeneratedAssetResult`。

API route、browser bridge、项目状态提交、播放 resolver 和 Preview Layer 继续复用现有 contract，不感知 provider 细节。

## 生成规则

`breath`：

- 用柔和噪声加吸气 / 呼气包络模拟轻呼吸。
- `light_breath` / `轻呼吸` 使用更短、更轻的起伏。
- 同一 clip seed 输出稳定，便于重现。

`sfx`：

- 被褥、布料、摩擦类标签生成摩擦噪声。
- 以后遇到敲击类标签时生成短衰减脉冲。
- 包络避免片段边缘爆音。

`ambience`：

- 生成雨声式连续底噪和稀疏雨滴颗粒。
- 支持 demo 中 3 分半的长环境片段。
- 开头和结尾做轻微 fade，保证 selected preview 不突兀。

## UI 行为

不新增控件。当前 Inspector 的 selected clip generation panel 已经对所有 clip 类型显示。

预期行为：

- 选中 breath、SFX、ambience 后点击 `生成`，复用现有运行中状态。
- 成功后按钮变成 `重生成`。
- 右侧 Preview Layer 的 selected clip preview 变成可播放。
- 单个 clip 的生成只修改当前 clip，不影响其他 clip。

## 持久化规则

- Project JSON 只保存最终 asset metadata 和 `asset://clip/<assetId>`。
- 不保存本地绝对路径、jobId、progress、`blob:` URL 或 `data:audio` URL。
- 默认 WAV 输出仍在 `D:\CodexWorkplace\asmr_director_runtime\assets\clips\app`。

## 错误处理

- voice 的 GPT-SoVITS 错误继续按原路径展示。
- 程序化生成失败按普通 local generation failure 处理，并通过现有 bridge 提交 `asset_failed`。
- clip id 缺失或不存在继续由 API route 报错。

## 测试

单元测试覆盖：

- 程序化输出包含 WAV 头，并且长度合理。
- 同一非 voice clip + 同一 seed 输出确定。
- 不同 seed 或不同类型输出不同。
- `generateLocalClip` 能把 voice 分流到 GPT-SoVITS，把非 voice 分流到程序化生成。
- 非 voice helper/API 路径保存 `asset://clip/...`。
- generation view 允许非 voice generated asset 通过 selected clip preview 播放。

手动 / 浏览器验收：

- 选中 `breath_001`，点击 `生成`，确认写入 `asset://clip/...`，播放接口返回 `audio/wav` 和 `RIFF`。
- 选中一个 SFX clip，做同样验证。
- 可选再验证 ambience 长片段。

## 不做

- 不做真实项目混音 / 导出，那是第 9 步。
- 不做真实 waveform rendering。
- 不做云存储或后端任务队列。
- 不训练、不微调、不下载新的 SFX 模型。
- 不在本步建立完整授权素材库工作流。
