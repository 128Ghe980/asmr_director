# 真实项目混音与 WAV 导出设计

状态：2026-07-10 用户确认，作为 Roadmap 第 9 步范围。

## 目标

Roadmap 第 9 步要把已经生成好的 clip 音频素材合成为一条真实整段 WAV。工作台应该消费现有 `asset://clip/...` 文件，按 Timeline DSL 混音，保存一个稳定的 `asset://mix/...` 引用，在 Preview Layer 里试听，并用同一份 WAV 文件下载。

这一步证明 ASMR Director 可以从“可编辑声音工程”走到“完整音频输出”。它不是新的顶层路线关卡。

## 选定方案

采用本地优先、严格素材齐全的项目混音器。

所有有声音的 clip 都必须先有 `asset://clip/...`，才允许生成项目混音。只要任意 `voice`、`breath`、`sfx` 或 `ambience` clip 缺少稳定本地素材，混音按钮就保持禁用，API 也直接拒绝请求。第一版不能偷偷用静音替代缺失素材。

混音器运行在本地 Next.js Node runtime 中，从 D 盘 runtime asset store 读取 WAV，生成真实整段 WAV，保存到本地 runtime，并返回 `asset://mix/<assetId>`。浏览器和 Project JSON 都不能保存本地文件路径、`blob:` URL、`data:audio` URL、签名 URL、jobId 或进度。

## 当前代码事实

现有 app 已经有这些边界：

- `AsmrProject.timeline.mixing` 已有 `target_lufs`、`binaural`、`master_limiter`。
- `AsmrProject.exports` 可以保存导出状态和 URI。
- 单个 clip 生成已经会写入 `asset://clip/...`。
- `/api/assets/clip/[assetId]` 已经可以返回本地 clip WAV。
- Preview Layer 已经有 `project_mix` slot、选中 clip 试听、紧凑生成状态。
- `GenerationBridge`、runtime state、`StudioApp` 目前仍偏向 clip-only。

缺的不是新的概念，而是真实本地项目混音链路和整段试听 / 下载的 UI 接线。

## 不做

- 不自动生成缺失 clip。
- 第一版不支持 `silence_missing_assets`。
- 不做 MP3、stems、云端保存、账号、计费、发布、协作。
- 不做真实 waveform 提取。
- 不做完整 DAW 编辑或拖拽时间线。
- 不做真正 HRTF 双耳渲染，也不做严格广播级 LUFS 测量。
- 不把 bridge cleanup、route shape 或 adapter refactor 包装成新的 roadmap 步骤。

## 项目混音就绪条件

有声音的 clip 来自这些轨道：

- `voice`
- `breath`
- `sfx`
- `ambience`

只有每个有声音 clip 都满足以下条件，项目混音才算就绪：

- `generation.status === "asset_generated"`
- `asset.asset_id` 存在
- `asset.uri` 以 `asset://clip/` 开头

`post_processing` 轨道不是音频素材来源。第 9 步里它只通过 `timeline.mixing` 表达混音意图。

缺少素材时，UI 给短原因，例如 `先生成片段`。完整缺失 clip id 列表放在 helper state 或 API error details，不挤进按钮文案。

## 本地 Runtime 与素材存储

扩展本地 runtime config，新增 mix asset root：

```text
ASMR_MIX_ASSET_ROOT
默认值：D:\CodexWorkplace\asmr_director_runtime\assets\mixes\app
```

现有 clip asset root 不变：

```text
D:\CodexWorkplace\asmr_director_runtime\assets\clips\app
```

local asset store 需要支持：

- `resolveClipAssetPath(assetId, config)`：现有 clip 播放。
- `saveClipAsset(...)`：现有 clip 生成。
- `resolveMixAssetPath(assetId, config)`：mix 播放 / 下载。
- `saveMixAsset(...)`：项目混音输出。

asset id 校验必须继续严格：路径段只允许字母、数字、`_` 和 `-`。解析后的路径必须留在对应 asset root 下面。

mix asset id 格式：

```text
<projectId>_wav_<timestamp>_<random8>
```

持久化 URI：

```text
asset://mix/<assetId>
```

## 混音器

新增一个聚焦的音频模块，负责 WAV 解析、时间线渲染和 WAV 编码。它不感知 React、API route 或浏览器状态。

混音器应该：

- 从本地 clip asset store 读取所需 `asset://clip/...` WAV。
- 解码 PCM WAV，至少支持 16-bit PCM mono 和 stereo。
- 必要时用简单线性重采样转到输出采样率。
- 输出 32 kHz stereo PCM WAV。
- 按 `project.duration` 分配输出 buffer。
- 把每个 clip 放到 `clip.start`。
- 以 `clip.duration` 作为时间线目标长度。
- 源音频长于 `clip.duration` 时裁切。
- 非 loop 源音频短于 `clip.duration` 时补静音。
- 当 `clip.type === "ambience"` 且 `clip.loop === true` 时，短素材循环铺满目标时长。
- 应用 `volume_db`、`fade_in`、`fade_out`、`position.pan`、`position.distance`、`position.movement`。
- 将 `timeline.mixing.target_lufs` 作为近似 RMS 归一化目标，不宣称严格 LUFS。
- 当 `timeline.mixing.master_limiter === true` 时应用简单 peak limiter。

### 空间规则

第一版空间渲染保持简单、可预测：

- 每个源先转 mono，再做声像。
- 输出 stereo。
- `position.pan` 使用 equal-power panning。
- `position.distance` 映射为音量系数：
  - `far`：更轻
  - `mid`：略轻
  - `near`：中性
  - `close`：略近
  - `very_close`：最贴近
- `static` 保持 pan 不变。
- `left_to_right` 在 clip 内从左移动到右。
- `right_to_left` 在 clip 内从右移动到左。
- `approach` 在 clip 内轻微增强距离音量。
- `recede` 在 clip 内轻微降低距离音量。

`binaural` 作为项目意图保留。第 9 步里它可以映射到上述 stereo panning 行为。真正 HRTF 是 Step 10 或更后面的事情。

## 项目导出状态

新增聚焦的 project-mix state helper。

WAV 混音成功后：

```ts
exports[type === "wav"].status = "exported";
exports[type === "wav"].uri = "asset://mix/<assetId>";
```

如果项目里没有 `wav` export entry，就新增一个。这能兼容旧 demo / 旧项目 JSON，而不改 schema。

第一次混音失败：

```ts
exports[type === "wav"].status = "export_failed";
exports[type === "wav"].uri = null;
```

如果已经有旧的 WAV mix，重混失败时必须保留原来的 `asset://mix/...` URI，让上一版整段音频继续可试听、可下载。UI 可以显示本次 runtime 错误，但失败不能毁掉上一份可用结果。

## Fingerprint 与过期结果

新增 project mix fingerprint。它应该包含：

- project ID
- project duration
- 请求的导出类型，第一版是 `wav`
- timeline mixing 设置
- 每个有声音 clip 的 ID
- clip `start`、`duration`、`volume_db`、`fade_in`、`fade_out`
- clip `position`
- clip asset URI
- clip asset duration

它不包含 runtime jobId、progress、临时消息或本地文件路径。

UI 只在 fingerprint 仍匹配当前项目时提交混音结果。如果用户在混音过程中改了 timeline，晚到的结果要忽略。

## Bridge 与 Runtime State

扩展现有 generation boundary，不推倒重写。

browser-side bridge 增加项目混音操作：

```ts
generateProjectMix(
  request: GenerateProjectMixRequest,
  onUpdate: (update: ProjectMixJobUpdate) => void,
): Promise<{ jobId: string }>;
```

local bridge 背后可以继续同步执行，和当前 selected-clip local bridge 一样：

1. 发出 queued snapshot
2. 发出 generating snapshot
3. 调用 `/api/generation/mix`
4. 发出 succeeded 或 failed update

project mix runtime job 仍然必须留在 `AsmrProject`、localStorage project JSON 和导出 JSON 外面。现有 clip generation 行为不能回退。

## API Routes

第 9 步采用简单本地 API：

```http
POST /api/generation/mix
```

请求：

```json
{
  "project": {},
  "exportType": "wav"
}
```

响应：

```json
{
  "asset": {
    "assetId": "asmr_demo_001_wav_20260710T000000000Z_abcd1234",
    "uri": "asset://mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234",
    "duration": 210
  }
}
```

缺少 clip asset 时返回 `409`：

```json
{
  "error": "Generate all required clips before project mix.",
  "missingClipIds": ["voice_001", "ambience_rain_001"]
}
```

播放 / 下载 route：

```http
GET /api/assets/mix/[assetId]
```

返回 `audio/wav` bytes。下载可以复用同一路由，并由前端 anchor 设置 `download`。route 应设置 `cache-control: no-store`。

## UI 行为

Preview Layer 是项目混音的主要操作面。

新增紧凑控制：

- `生成整段`：所有必要 clip assets 存在、且当前没有 mix 时启用。
- `重混`：已有旧 mix，但当前 fingerprint 过期，或用户主动重新生成时启用。
- `试听`：有当前 `asset://mix/...` 时启用。
- `WAV`：下载同一个当前 mix asset。

按钮名字必须短且清晰。顶部 workspace header 继续负责项目 JSON 导入 / 导出 / 重置。如果需要避免歧义，现有顶部导出按钮可改成 `JSON` 或 `导出JSON`，不要和 WAV 下载混在一起。

Preview Layer 状态应区分：

- 缺少 clip assets
- 可以混音
- 混音中
- 已导出 mix
- timeline / asset 修改后 mix 过期
- mix 失败

现有 selected-clip 试听按钮保留，和整段试听分开。

## 持久化与导入导出

允许持久化：

- 最终 `exports[type === "wav"].status`
- 最终 `exports[type === "wav"].uri`
- 最终 clip asset references
- 必要的短失败状态

永远不持久化：

- runtime job state
- progress
- 本地文件路径
- 生成出来的播放 URL
- browser `blob:` URL
- browser `data:audio` URL

导入包含 `asset://mix/...` 的 project JSON 时，应保留这个 URI。当前本地 runtime 如果解析不了该 asset，播放可以失败，但 JSON 本身仍是有效项目 metadata。

## 测试策略

单元测试：

- WAV decoder 接受 16-bit PCM mono / stereo，并拒绝坏 WAV。
- renderer 按 `start` 和 `duration` 放置 clip。
- renderer 应用 gain、fade、pan、简单 movement 和 limiter。
- looping ambience 在源素材短于 timeline clip 时会重复。
- 缺失 assets 会阻止 mix readiness 和 API 创建。
- mix asset store 能保存和解析 `asset://mix/...`。
- project mix success 写入或新增 `wav` export entry。
- project remix failure 保留旧 mix URI。
- project mix fingerprint 在 timing、mixing settings 或 asset URI 变化时变化。
- playback resolver 把 `asset://mix/...` 映射到 `/api/assets/mix/...`。
- local project mix bridge 发出 queued、generating、succeeded、failed、canceled updates，且不序列化 runtime state。

浏览器 / 手动验证：

- 使用一个所有有声音 clip 都有真实 `asset://clip/...` 的项目。
- 确认 Preview Layer 启用 `生成整段`。
- 生成 mix 后确认 Project JSON / localStorage 只保存 `asset://mix/...`，不保存本地路径。
- 确认 `/api/assets/mix/<assetId>` 返回 `audio/wav` 和 `RIFF`。
- 确认整段 `试听` 播放真实 mix。
- 确认 `WAV` 下载同一个 mix asset。
- 修改一个 clip timing 后，确认 UI 将旧 mix 视为过期。

## 验收标准

- Project mix 消费真实本地 `asset://clip/...` assets。
- 缺少任何有声音 clip asset 时，不能混音。
- 渲染 WAV 遵循 timeline `start` / `duration`。
- 应用基础 gain、fade、pan、distance、movement、归一化和 limiter 意图。
- 整段试听播放真实 `asset://mix/...` WAV。
- WAV 下载返回同一个真实 mix 文件。
- Project JSON 只保存稳定 `asset://mix/...` 导出状态。
- runtime project mix job 不进入 Project JSON、localStorage project data 或 export JSON。
- Step 10 产品化工作保持在本步之外。
