# API 后端生成桥接设计

日期：2026-06-24

## 背景

当前工作台已经有一版 mock-first `GenerationBridge`，支持选中片段生成。这一版已经验证了几个关键边界：

- UI 组件不关心背后是 mock 生成还是真实生成。
- 运行时 job 状态不写进 `AsmrProject`。
- 只有终态成功后，才把最终 clip asset 写回项目数据。
- 生成失败只写入短错误和终态失败。
- 重生成失败时保留上一版可用 asset。
- `mock://` asset URI 只在运行时解析播放，不会把浏览器 `blob:` 或 `data:` URL 写进项目 JSON。

下一步不是把某个 TTS、SFX、环境声、存储或混音服务直接焊进前端，而是先设计一套 API-backed generation contract。以后真实服务替换 mock bridge 时，导演台工作流不应该被推倒重写。

## 已确认方向

采用 **B：API 后端片段生成 + 项目混音**。

API 合同同时覆盖两类能力：

1. **片段生成**
   - 把单个 timeline clip 生成成可复用的 clip asset。
   - 覆盖 voice、breath、SFX、ambience。
   - 保留当前以 Inspector 为主的片段生成流程。

2. **项目混音**
   - 按 Timeline DSL 把已经生成的 clip assets 混成一份完整项目音频。
   - 项目混音 asset 同时作为整段试听和 WAV 导出的来源。
   - 如果已经有有效 mix asset，导出 WAV 不应该另起一套音频生成流程。

## 目标

- 定义后端形态的生成 API 合同，但不绑定具体供应商。
- 把当前 bridge 从选中片段扩展到项目级混音。
- 让 clip generation 和 project mix 共用统一 job 生命周期。
- `AsmrProject` 里只保存稳定 asset 引用，不保存临时播放 URL。
- 让整段试听和 WAV 导出复用同一个项目混音 asset。
- 保留当前本地优先前端、导入、导出、重置、自动保存、校验、Preview Layer、Inspector、Timeline 状态信号和简洁中文 UI。
- 先以 polling 为基础，后续再可选升级 SSE 或 WebSocket。

## 非目标

- 本设计步骤不接真实 TTS、SFX、环境声或混音供应商。
- 不做云端项目持久化、登录、计费、协作、发布或账号系统。
- 不做完整 DAW 拖拽编辑。
- 不要求真实 waveform 提取。
- 不把浏览器 `blob:` URL、`data:audio` URL、job 进度或队列状态写进项目 JSON。
- 第一版不要求 MP3。MP3 只作为后续转码或导出格式预留。

## 核心架构

生成系统分成五个边界：

1. **前端生成桥接层**
   - `StudioApp` 使用的 TypeScript interface。
   - 让现有 UI 组件不关心 HTTP 细节。
   - 负责客户端 polling，未来也可以负责事件订阅。

2. **Generation API**
   - 接收生成命令。
   - 创建 job。
   - 暴露 job snapshot 和取消接口。
   - job 成功后返回最终 asset reference。

3. **Job store**
   - 后端拥有的 job 状态。
   - 保存 queued、running、progress、error、canceling 等状态。
   - job 状态不写进 `AsmrProject`。

4. **Provider adapters**
   - 位于 API 边界后面。
   - 未来可以接 TTS、SFX、环境声或本地混音服务。
   - 前端永远不直接调用供应商。

5. **Asset store 和 resolver**
   - 保存生成好的 clip assets 和 project mix assets。
   - `AsmrProject` 只保存稳定内部 URI，例如 `asset://clip/<assetId>` 和 `asset://mix/<assetId>`。
   - 播放和下载时，通过 resolver endpoint 获取短期可访问 URL。

## Job 模型

所有生成工作使用同一套 job 模型。

```ts
type GenerationJobType = "clip_generation" | "project_mix";

type GenerationJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceling"
  | "canceled";

type GenerationJobSnapshot = {
  jobId: string;
  type: GenerationJobType;
  projectId: string;
  target:
    | { type: "clip"; clipId: string }
    | { type: "project_mix"; exportType: "wav" };
  status: GenerationJobStatus;
  progress: number;
  message?: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  result?: {
    asset: GeneratedAssetReference;
  };
  inputFingerprint: string;
  createdAt: string;
  updatedAt: string;
};
```

状态生命周期：

```text
queued -> running -> succeeded
queued -> running -> failed
queued -> running -> canceling -> canceled
queued -> canceling -> canceled
```

取消不算持久失败。取消后清理运行时 job，并保留之前的持久项目状态。

## Asset 模型

生成结果是持久 asset reference，不是直接播放 URL。

```ts
type GeneratedAssetKind = "clip" | "project_mix";

type GeneratedAssetReference = {
  assetId: string;
  kind: GeneratedAssetKind;
  uri: string; // asset://clip/<assetId> or asset://mix/<assetId>
  duration: number;
  format: "wav" | "mp3";
  mimeType: string;
  sampleRate?: number;
  channels?: number;
  sizeBytes?: number;
  sourceJobId: string;
};
```

稳定 asset URI：

```text
asset://clip/<assetId>
asset://mix/<assetId>
```

前端永远不持久化 signed HTTP URL、browser object URL 或 data URL。需要播放或下载时，再向 asset resolver 要一个新 URL。

## 持久项目写回规则

### Clip 生成成功

单个片段生成成功后，把最终 asset reference 写回该 clip：

```ts
clip.generation.status = "asset_generated";
clip.generation.error = null;
clip.asset = {
  asset_id: asset.assetId,
  uri: "asset://clip/<assetId>",
  duration: asset.duration
};
```

### Clip 生成失败

第一次生成失败：

```ts
clip.generation.status = "asset_failed";
clip.generation.error = "给用户看的短错误";
clip.asset = {
  asset_id: null,
  uri: null,
  duration: null
};
```

重生成失败时，保留之前已经可用的 generated asset，并让 clip 继续保持 `asset_generated`。这和当前 mock bridge 规则一致，可以避免一次失败毁掉已有创作成果。

### 项目混音成功

第一版 API-backed 设计先复用现有 `exports` 数组，不新增破坏 schema 的 project-level asset section。

WAV 混音成功后：

```ts
exports[type === "wav"].status = "exported";
exports[type === "wav"].uri = "asset://mix/<assetId>";
```

Preview Layer 读取同一个 WAV export URI 作为整段试听来源。WAV 导出按钮也下载同一份 asset。这样整段试听和导出是同一个音频结果。

### 项目混音失败

第一次混音失败：

```ts
exports[type === "wav"].status = "export_failed";
exports[type === "wav"].uri = null;
```

如果已经有旧的 mix asset，重新混音失败时要保留旧的 `asset://mix/<assetId>`，继续允许用户试听和下载上一版完整音频。UI 可以显示本次 remix 的运行时错误，但失败不能破坏上一份可用整段音频。

## API Endpoints

第一版 API 合同以 polling 为基础。以后可以增加 SSE 或 WebSocket，不改变持久项目模型。

### 创建 Clip 生成任务

```http
POST /api/generation/jobs/clip
```

请求：

```json
{
  "project": { "project_id": "asmr_demo_001" },
  "clipId": "voice_001",
  "reason": "generate",
  "inputFingerprint": "sha256:...",
  "idempotencyKey": "client-generated-key"
}
```

本地优先阶段，`project` 携带完整 `AsmrProject` snapshot。未来有后端项目持久化后，可以改为传 `projectId` 和 `projectVersion`。

响应：

```json
{
  "job": {
    "jobId": "job_123",
    "type": "clip_generation",
    "projectId": "asmr_demo_001",
    "target": { "type": "clip", "clipId": "voice_001" },
    "status": "queued",
    "progress": 0,
    "inputFingerprint": "sha256:...",
    "createdAt": "2026-06-24T00:00:00.000Z",
    "updatedAt": "2026-06-24T00:00:00.000Z"
  }
}
```

允许的 reason：

```ts
type ClipGenerationReason = "generate" | "regenerate" | "retry";
```

### 创建项目混音任务

```http
POST /api/generation/jobs/project-mix
```

请求：

```json
{
  "project": { "project_id": "asmr_demo_001" },
  "exportType": "wav",
  "reason": "mix",
  "mixPolicy": "require_all_assets",
  "inputFingerprint": "sha256:...",
  "idempotencyKey": "client-generated-key"
}
```

允许的 reason：

```ts
type ProjectMixReason = "mix" | "remix" | "retry";
```

默认 `mixPolicy` 是 `require_all_assets`。在这个规则下，如果任何有声 timeline clip 缺少 generated asset，API 直接拒绝创建混音任务。这样第一版真实混音不会悄悄导出残缺音频。

未来可预留：

```ts
type ProjectMixPolicy = "require_all_assets" | "silence_missing_assets";
```

`silence_missing_assets` 只作为后续高级选项，不作为第一版默认行为。

响应：

```json
{
  "job": {
    "jobId": "job_456",
    "type": "project_mix",
    "projectId": "asmr_demo_001",
    "target": { "type": "project_mix", "exportType": "wav" },
    "status": "queued",
    "progress": 0,
    "inputFingerprint": "sha256:...",
    "createdAt": "2026-06-24T00:00:00.000Z",
    "updatedAt": "2026-06-24T00:00:00.000Z"
  }
}
```

如果缺少必要 clip asset，返回 `409`：

```json
{
  "error": {
    "code": "missing_required_assets",
    "message": "Generate all required clips before project mix.",
    "details": {
      "missingClipIds": ["voice_001", "ambience_rain_001"]
    }
  }
}
```

### 读取 Job Snapshot

```http
GET /api/generation/jobs/:jobId
```

响应：

```json
{
  "job": {
    "jobId": "job_456",
    "type": "project_mix",
    "projectId": "asmr_demo_001",
    "target": { "type": "project_mix", "exportType": "wav" },
    "status": "running",
    "progress": 62,
    "message": "Mixing timeline",
    "inputFingerprint": "sha256:...",
    "createdAt": "2026-06-24T00:00:00.000Z",
    "updatedAt": "2026-06-24T00:00:10.000Z"
  }
}
```

成功时：

```json
{
  "job": {
    "jobId": "job_456",
    "type": "project_mix",
    "projectId": "asmr_demo_001",
    "target": { "type": "project_mix", "exportType": "wav" },
    "status": "succeeded",
    "progress": 100,
    "inputFingerprint": "sha256:...",
    "result": {
      "asset": {
        "assetId": "mix_789",
        "kind": "project_mix",
        "uri": "asset://mix/mix_789",
        "duration": 210,
        "format": "wav",
        "mimeType": "audio/wav",
        "sampleRate": 48000,
        "channels": 2,
        "sourceJobId": "job_456"
      }
    },
    "createdAt": "2026-06-24T00:00:00.000Z",
    "updatedAt": "2026-06-24T00:01:20.000Z"
  }
}
```

### 取消 Job

```http
POST /api/generation/jobs/:jobId/cancel
```

响应：

```json
{
  "job": {
    "jobId": "job_456",
    "status": "canceling"
  }
}
```

取消是 best-effort。如果供应商已经完成，下一次 job snapshot 仍可能是 `succeeded`。前端仍然必须用 input fingerprint 判断结果是否还能写回当前项目。

### 获取播放 URL

```http
GET /api/assets/:assetId/playback-url
```

响应：

```json
{
  "assetId": "mix_789",
  "url": "https://signed.example/audio/mix_789.wav",
  "expiresAt": "2026-06-24T00:11:20.000Z"
}
```

### 获取下载 URL

```http
GET /api/assets/:assetId/download-url
```

响应：

```json
{
  "assetId": "mix_789",
  "url": "https://signed.example/download/mix_789.wav",
  "filename": "rain-night-before-sleep.wav",
  "expiresAt": "2026-06-24T00:11:20.000Z"
}
```

## 前端 Bridge 合同

现有 bridge 应扩展，而不是推倒。

```ts
type ApiGenerationBridge = {
  generateClip(
    request: GenerateClipRequest,
    onUpdate: (update: GenerationJobUpdate) => void,
  ): Promise<{ jobId: string }>;

  generateProjectMix(
    request: GenerateProjectMixRequest,
    onUpdate: (update: GenerationJobUpdate) => void,
  ): Promise<{ jobId: string }>;

  cancelGeneration(jobId: string): Promise<void>;

  resolvePlaybackUrl(assetUri: string): Promise<string>;

  resolveDownloadUrl(assetUri: string): Promise<{
    url: string;
    filename: string;
  }>;
};
```

Bridge 负责 polling。UI 组件继续消费派生后的 generation view state，而不是直接消费 HTTP response。

## Input Fingerprint 和过期结果

每个 job request 都包含 `inputFingerprint`。

Clip generation fingerprint 应包含：

- Clip ID。
- Clip 内容字段。
- 时间点和时长。
- 空间位置和音量。
- 生成模型、seed、temperature、retry count 和相关生成参数。

Project mix fingerprint 应包含：

- Project ID。
- 项目时长。
- Timeline tracks 和 clip positions。
- Clip asset URIs 和 durations。
- 混音设置，例如 target LUFS、binaural、master limiter。
- 请求的 export type。

前端只有在返回 job fingerprint 仍然匹配当前项目或当前 clip fingerprint 时，才允许写回成功结果。这延续现有 mock bridge 对过期 callback 的保护。

## 项目混音就绪规则

第一版默认规则：

```text
只有所有有声 clip 都已经有 generated asset 时，才允许项目混音。
```

有声 clip 包括：

- `voice`
- `breath`
- `sfx`
- `ambience`

`post_processing` 轨道不是生成音频素材来源。

如果缺少必要 asset，Preview Layer 显示短原因，例如：

```text
先生成缺失片段
```

完整缺失 clip 列表可以放在 validation 或 job error details 里，不挤进按钮文案。

## 混音规则

Timeline DSL 是最终对齐的事实来源。

Mix engine 应该：

- 把每个 clip asset 放到 `clip.start`。
- 使用 `clip.duration` 作为目标 timeline 时长。
- 应用 `volume_db`、`fade_in`、`fade_out`、`position.pan`、`position.distance` 和 `position.movement`。
- 应用项目混音设置：`target_lufs`、`binaural`、`master_limiter`。
- 对轻微 asset duration mismatch 进行 trim 或 pad，使其贴合 timeline duration。
- 如果 asset URI 无法解析，或 `require_all_assets` 下缺少必要素材，则让 job 失败。

第一版可以把高级母带和真实双耳渲染保持在 API 边界后面。合同层只需要保留意图和输出 asset 语义。

## UI 表面

### Inspector

Inspector 仍是选中片段生成的主要入口：

- 生成 pending clip。
- 取消当前片段生成。
- 重试 failed clip。
- 重生成 generated clip。
- 显示短错误和进度。

### Preview Layer

Preview Layer 成为项目混音的主要入口：

- 选中片段有 generated asset 时，显示选中片段播放。
- 显示项目混音就绪状态。
- 所有必要 clip assets 存在时，显示 `生成整段` 或同等简短中文动作。
- 显示项目混音进度。
- mix asset 存在时，启用整段播放。
- WAV 导出复用同一个 mix asset。

### Timeline

Timeline 继续显示紧凑 clip 级生成状态。项目混音就绪可以通过 Preview Layer 计数体现，Timeline 不成为主要 project mix 控制面。

### Export

WAV 导出动作应该：

- 如果已有 `asset://mix/<assetId>`，且 fingerprint 匹配当前项目，则直接下载它。
- 否则引导用户先生成或重新生成项目混音。

MP3 以后可以作为单独 transcode/export job。第一版 API-backed bridge 不要求 MP3。

## 错误处理

推荐持久或用户可见错误分类：

- `invalid_project`
- `invalid_clip`
- `missing_required_assets`
- `asset_not_found`
- `provider_failed`
- `mix_failed`
- `canceled`
- `rate_limited`
- `network_error`

规则：

- 运行时细节留在 job snapshots。
- 项目 JSON 只保存短用户可读错误。
- 取消不变成持久失败。
- Clip 重生成失败保留旧 clip asset。
- Project remix 失败保留旧 mix asset。
- 缺少素材时，project mix 创建请求以清晰 `409` 响应失败。

## 持久化和导入导出

项目 JSON 中允许保存：

- 最终 clip `asset_generated` / `asset_failed`。
- 最终 clip `asset` metadata。
- 最终 WAV export status 和 `asset://mix/<assetId>` URI。
- 短错误信息。

永远不保存：

- Job progress。
- Queue state。
- Polling state。
- Runtime messages。
- Signed playback URL。
- Signed download URL。
- Browser `blob:` URL。
- Browser `data:audio` URL。

导入包含 `asset://` URI 的项目时，应保留这些稳定 asset references。如果当前后端无法解析它们，播放或下载可以失败，但 JSON 本身仍是有效项目 metadata。

## 测试策略

单元测试：

- API bridge 可以启动 clip job，并把 job snapshots 映射到当前 `GenerationJobUpdate` 形态。
- API bridge 可以启动 project mix job，并把成功 mix asset 写入项目 export 状态。
- Project mix readiness 能检测缺失 clip assets。
- Clip success 写入 `asset://clip/<assetId>`。
- Project mix success 把 `asset://mix/<assetId>` 写入 WAV export。
- Clip regeneration failure 保留旧 clip asset。
- Project remix failure 保留旧 mix asset。
- Signed playback/download URL 永不序列化进 `AsmrProject`。
- 过期 fingerprint 结果会被忽略。

浏览器验证：

- 通过 bridge-shaped flow 生成一个 clip。
- 缺少必要 clips 时，project mix 保持禁用。
- 所有必要 clips 有 asset 后，project mix 动作启用。
- Project mix 进度显示在 Preview Layer。
- Project mix 成功后，整段播放启用。
- WAV 导出下载同一个 project mix asset。
- Reset、import、export、autosave 仍排除运行时 job 状态。
- 左右折叠和专注编辑仍保持 Timeline 可用。

## 验收标准

- 设计定义了 clip generation 和 project mix 共用的一套 job 模型。
- Clip generation 和 project mix 都有明确 API endpoints。
- 整段试听和 WAV 导出共用同一个 durable mix asset。
- `asset://clip/...` 和 `asset://mix/...` 是持久化 URI 形式。
- Signed playback/download URL 只在使用时解析，不写进项目 JSON。
- 默认只有所有必要 clip assets 存在时，才允许 project mix。
- 生成或混音失败不会毁掉上一份可用 asset。
- 第一版 API-backed 实现只需要 polling，SSE/WebSocket 作为未来优化。
- 设计不要求真实供应商接入、登录、计费、云端项目持久化或完整 DAW。

## 实施计划提示

下一步 implementation plan 不应该从接真实供应商开始。应该先加入 API-backed bridge 类型、project-mix state derivation、asset URI helpers，以及围绕 durable state commits 的测试。后端可以先用 mock API adapter 顶住，但要保持新的 HTTP-shaped contract。
