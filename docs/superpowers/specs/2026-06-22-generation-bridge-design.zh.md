# 生成桥接层设计

日期：2026-06-22

## 背景

当前应用已经有了批准后的项目工作区和预览层分支：

- 左侧项目栏和右侧项目详情栏可以独立折叠。
- 右侧详情栏里有轻量预览层和生成槽。
- Timeline、Storyboard、Inspector 已经能显示轻量的生成 / 准备状态信号。
- 项目仍然是本地优先，并由 `AsmrProject` 驱动。

路线图下一步是 **真实生成链路**，但现在不应该直接接真实 TTS、SFX、环境声模型、后端队列或云端资产。下一步应该先定义并实现一个桥接层，让产品行为像一个生成系统，同时第一版仍然可以本地 mock。

这份设计应该接在预览层工作之后实现，或者在该分支合并到 `master` 后再从 `master` 开始。

## 已确认方向

采用 **C：mock 优先，但边界按未来后端设计**。

第一版引入 `GenerationBridge` 和运行时 job store。Bridge 背后先使用本地 mock 生成，但它的接口和状态边界要按未来真实后端来设计。以后替换成 API 后端时，不应该重写预览层、Timeline、Inspector 或持久化逻辑。

## 目标

- 为选中片段增加清晰的生成命令边界。
- 增加只存在于运行时的 job store，用于排队、生成中、取消中、进度等状态。
- 把最终生成资产引用保存在 `AsmrProject` 里。
- 不把临时 job 数据写入导入 / 导出的项目 JSON。
- 让预览层、Timeline、Inspector 使用同一份合并后的生成视图。
- 允许 mock 生成的资产被预览，但明确它不是真实模型输出。
- 保留现有本地优先流程、中文界面、校验、导入 / 导出 / 重置、自动保存和工作区折叠行为。

## 非目标

- 不接真实 TTS。
- 不接真实 SFX 或环境声模型。
- 不做后端队列。
- 不做云存储。
- 不做账号、登录、计费、协作或发布。
- 不做完整项目混音导出。
- 第一版不做全轨道批量生成。
- 不把二进制音频写进项目 JSON。
- 不做破坏性 schema 迁移。

## 核心概念

生成状态分成三层：

1. **持久项目数据**
   - 保存在 `AsmrProject` 中。
   - 会随项目导入、导出、自动保存和重置。
   - 保存最终片段生成状态、生成参数、最终资产 ID、URI 和时长。

2. **运行时 job 状态**
   - 保存在 `AsmrProject` 外。
   - 只存在于当前浏览器会话。
   - 保存 job ID、排队 / 生成进度、取消中状态、临时 job 消息和运行时错误。
   - 永远不出现在导出的项目 JSON 中。

3. **生成桥接层**
   - 只有这一层知道背后是 mock、本地生成还是后端生成。
   - UI 组件不关心具体实现，只调用同一套 bridge 方法。
   - 未来真实服务替换 bridge 实现，而不是替换周围产品界面。

## 数据归属

### 持久项目数据

持久项目数据是最终资产准备状态的事实来源。

生成成功后，应用写入：

```ts
clip.generation.status = "asset_generated";
clip.generation.error = undefined;
clip.asset = {
  asset_id: "mock_clip_001_job_001",
  uri: "mock://asset/clip_001/job_001",
  duration: 6.2
};
```

生成失败后，应用写入终态失败：

```ts
clip.generation.status = "asset_failed";
clip.generation.error = "Mock generation failed";
clip.asset = undefined;
```

生成开始时，第一版应优先把排队、生成中、进度放在运行时 job store，而不是持久写进 `AsmrProject`。UI 通过合并项目数据和运行时 job 得到展示用的“生成中”状态。

这样可以避免把已经失效的进行中任务保存到 localStorage 或导出的 JSON 里。

### 运行时 Job 状态

运行时 store 按 `clipId` 和 `jobId` 管理。

推荐结构：

```ts
type GenerationRuntimeStatus =
  | "queued"
  | "generating"
  | "succeeded"
  | "failed"
  | "canceling"
  | "canceled";

type GenerationJobSnapshot = {
  jobId: string;
  clipId: string;
  status: GenerationRuntimeStatus;
  progress: number;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
```

当 job 到达终态，并且结果已经写入项目数据后，运行时状态应被清掉。只有 UI 需要短暂显示失败反馈时，才保留短生命周期的失败消息。

如果浏览器在 mock job 进行中刷新，该 job 会丢失。片段回到自己的持久项目状态，通常是 `asset_pending` 或上一次终态。第一版不尝试恢复 mock job。

## Generation Bridge 契约

推荐的桥接层边界：

```ts
type GenerateClipRequest = {
  project: AsmrProject;
  clipId: string;
  reason: "generate" | "regenerate" | "retry";
};

type GeneratedAssetResult = {
  assetId: string;
  uri: string;
  duration: number;
};

type GenerationJobUpdate =
  | { type: "snapshot"; job: GenerationJobSnapshot }
  | { type: "succeeded"; job: GenerationJobSnapshot; asset: GeneratedAssetResult }
  | { type: "failed"; job: GenerationJobSnapshot; error: string }
  | { type: "canceled"; job: GenerationJobSnapshot };

type GenerationBridge = {
  generateClip(
    request: GenerateClipRequest,
    onUpdate: (update: GenerationJobUpdate) => void
  ): Promise<{ jobId: string }>;
  cancelGeneration(jobId: string): Promise<void>;
};
```

`重生成` 和 `重试` 可以调用同一个 `generateClip`，只是传入不同的 `reason`。是否在开始前清理旧资产，由应用层决定。

## Mock 资产策略

Mock bridge 不能把浏览器 `blob:` object URL 保存进 `AsmrProject`，因为这些 URL 无法跨刷新、导入、导出保持可用。

Mock 生成应返回持久的 mock URI：

```txt
mock://asset/<clipId>/<jobId>
```

运行时 asset resolver 可以把 `mock://` URI 转换成可播放的本地音频源。生成出的声音必须清楚地是占位音频，例如短促中性 tone、noise bed，或带轻微信号的静音。它不能被呈现成真实 TTS / SFX 输出。

未来真实 bridge 可以返回对象存储 URL 或本地文件引用，UI 契约不需要改变。

## 用户流程

### 生成选中片段

1. 用户选中一个片段。
2. Inspector 或预览层在该片段没有资产时显示 `生成`。
3. 用户点击 `生成`。
4. 应用校验该片段是否可生成。
5. 运行时 job store 记录一个 queued job。
6. Mock bridge 持续发送进度更新。
7. Timeline、预览层、Inspector 通过合并状态显示 `生成中`。
8. 成功后，应用把 `asset_generated` 和 `clip.asset` 写入 `AsmrProject`。
9. 运行时 job 状态被清掉。
10. 该片段的 mock 资产预览控制变为可用。

### 重生成片段

1. 用户点击 `重生成`。
2. 运行时 job 以 `reason: "regenerate"` 开始。
3. 旧资产继续可见，直到新 job 成功，除非 UI 清楚表达它正在替换资产。
4. 成功后，旧资产 metadata 被新资产结果替换。
5. 如果失败或取消，之前可用的已生成资产仍然保留。

这条规则避免一次失败的重生成毁掉已有可用资产。

### 重试失败片段

1. 用户点击 `重试`。
2. 运行时 job 以 `reason: "retry"` 开始。
3. 旧错误在进度开始前仍可见，随后降级为次要信息。
4. 成功后，错误被清掉并保存资产 metadata。
5. 再次失败时，保存失败状态和最新短错误。

### 取消进行中任务

1. 用户点击 `取消`。
2. 运行时 job 进入 `canceling`。
3. Bridge 返回 `canceled`。
4. 运行时 job 被清掉。
5. 持久项目状态回到之前的终态：
   - 没有旧资产时回到待生成。
   - 重生成取消且已有旧资产时保持已生成。
   - 重试取消且之前失败时保持失败。

## 有效展示状态

预览和编辑组件不应该在很多地方直接读取 runtime jobs。应增加一个小的派生 helper，把项目数据和运行时 job 合并成展示状态。

推荐职责：

```ts
deriveGenerationView(project, runtimeJobs)
```

它应产出：

- clip 级有效状态。
- 选中片段的生成按钮文案。
- 轨道 / 项目生成槽摘要。
- 待生成、生成中、失败、已生成、可播放片段数量。
- 预览按钮是否可用。
- 播放时应该解析哪个 URI。

这样 `PreviewLayerPanel`、`TimelinePanel`、`StoryboardPanel` 和 `ClipInspector` 都能保持简单。

## UI 范围

### Inspector

第一版中，Inspector 是主要控制面。

它应显示：

- 选中片段状态。
- 资产槽。
- 根据有效状态显示 `生成`、`重生成`、`重试` 或 `取消`。
- 生成中进度。
- 失败时的短错误。
- 已生成时的基础资产信息。

### 预览层

右侧预览层显示项目准备度和选中片段的可播放状态。

它可以提供：

- 选中片段存在已生成资产时的预览播放控制。
- 项目级计数。
- 生成槽状态。
- 项目混音播放控制保持禁用，直到之后有项目混音步骤。

第一版不增加完整项目混音生成。

### Timeline 和 Storyboard

Timeline 和 Storyboard 继续显示紧凑的生成状态信号。如果有进度数据，可以轻量显示生成进度，但它们不应该成为主要 job 控制面。

## 校验规则

以下片段应禁用生成：

- voice clip 缺少文本或内容无效。
- 时长无效。
- 时间结构破损，无法通过项目校验。

详细校验继续由现有校验界面承载。生成按钮只显示短原因，例如 `先修正片段`。

## 错误处理

- Mock bridge 应支持确定性成功，以及至少一个可测试的失败路径。
- 生成失败写入 `asset_failed` 和短错误。
- 运行时详细消息不进入项目 JSON。
- 取消不视为失败。
- 重生成失败不能删除之前已生成的可用资产。
- 无效导入 JSON 的行为保持不变。

## 持久化和导入 / 导出

- Runtime jobs 不保存到 localStorage。
- Runtime jobs 不导出。
- 项目 JSON 可以包含 `asset_generated`、`asset_failed`、最终 `asset` metadata 和生成参数。
- 项目 JSON 不能包含进度、队列位置、job 消息或浏览器 object URL。
- 在 mock 阶段，项目可以导出 `mock://` asset URI。
- 导入包含 `mock://` asset 的项目时，应显示为 mock 资产，并尽可能在运行时解析为可播放源。

## 组件和文件边界

可能新增：

- `generation-bridge.ts`
  - Bridge 类型和接口。

- `mock-generation-bridge.ts`
  - 本地 mock 实现。

- `generation-runtime-store.ts` 或一个聚焦的 React hook
  - 运行时 job snapshots 和更新 helper。

- `generation-view.ts`
  - 纯派生 helper，合并 `AsmrProject` 和 runtime jobs。

- `mock-asset-resolver.ts`
  - 把 `mock://` asset 解析成可播放本地音频源。

可能更新：

- `studio-app.tsx`
  - 拥有 bridge、runtime job state 和持久项目提交逻辑。

- `generation-summary.ts`
  - 继续作为预览摘要 helper，或在实现计划中并入新的 generation view helper。

- `preview-layer-panel.tsx`
  - 显示有效预览 / 可播放状态。

- `generation-slot-list.tsx`
  - 显示有效槽位状态。

- `clip-inspector.tsx`
  - 增加选中片段生成控制。

- `timeline-panel.tsx` 和 `storyboard-panel.tsx`
  - 继续显示紧凑状态。

## 测试

单元测试：

- Mock bridge 发送 queued / generating / succeeded 更新。
- Mock bridge 支持取消。
- Mock bridge 提供确定性失败路径。
- Runtime job 更新不会序列化进项目 JSON。
- Generation view helper 优先显示 runtime generating，而不是持久 pending。
- 生成成功会提交 `asset_generated` 和最终 asset metadata。
- 生成失败会提交 `asset_failed`，并且不写入假 asset。
- 重生成失败会保留之前的已生成 asset。
- `mock://` asset URI 被识别为 mock generated asset。

浏览器验证：

- 选中片段并点击 `生成`。
- 进度出现，且不破坏折叠布局。
- 已生成片段可以通过 mock asset resolver 预览。
- Timeline、预览层和 Inspector 状态一致。
- `重生成`、`重试`、`取消` 状态可见且行为一致。
- 导入 / 导出 / 重置 / 自动保存仍然可用。
- 左右折叠和专注编辑仍能保证 Timeline 可用。

## 验收标准

- 在接真实模型前，有清晰的 generation bridge 设计。
- 选中片段可以通过 bridge 进入 mock 生成流程。
- 运行时 job 状态和持久项目数据分离。
- 完成后的 mock asset metadata 写入 `AsmrProject`。
- 浏览器 `blob:` URL 不会保存进项目 JSON。
- 预览层、Timeline、Storyboard、Inspector 使用合并后的有效生成状态。
- 失败和取消行为可预测。
- 第一版仍然本地优先、仅 mock。
- 设计保留未来替换成 API bridge 的直接路径。
