# 基础场景与已采用音频逐段视频分镜

日期：2026-10-01

后续行为已覆盖本初版的英文全局场景及可选连续参考复选框：见 [精简剧情背景](2026-10-02-concise-h3-story-backgrounds.zh.md) 与 [逐段连续镜头/新镜头](2026-10-02-storyboard-reference-modes.zh.md)。下方原验收保留为历史记录。

状态：实现、自动检查、真实文字模型及正式浏览器验证完成。本项属于 [ROADMAP](../../ROADMAP.md) 已有的**人声导演与真实 ASMR 音效质量 V1**，不新增顶层阶段，也不代表 H3 成片质量验收。[English spec](2026-10-01-adopted-clip-video-storyboards.md)

## 用户流程

第一步策划改为**文案 / 场景**标签。用户生成或载入实际文案后，可生成、重新生成或编辑一份英文基础场景，描述环境、光线、材质与氛围。此处先确定全局环境，逐段画面等音频采用后再安排。场景偏好保持次要位置，下载、保存、撤回与取消沿用紧凑工作台。

采用文案时，非空基础场景随新工程保存到 `videoPlan`。Planner 界面省略被清空或仅空白的场景，新工程回退其场景名；数据 API 可以保留显式传入的空串。已有 Planner 分镜在工作态和 `PlannerSource` 中兼容保留，可随采用、复制和版本记录保存，不自动变成已绑定音频的逐段分镜；旧多镜编辑器不再是第一步主界面。载入没有场景的来源时清空工作场景，不串用另一工程内容。

工程编辑每条人声旁增加小型分镜按钮，打开该片段的**声音 / 分镜**检查面板，沿用原有内部滚动区域。面板显示当前台词、已采用音频下载、全工程场景、模型、可选偏好以及生成 / 重生成。结果标题、画面、动作与镜头可编辑，保存后提供 H3 预览、复制和本段 TXT 下载；自动复制失败会展开并选中预览，供手工复制。

## 真实音频与独立镜头

`POST /api/scene-description` 接受 `{ provider, draft, instruction? }`，复用现有 Planner 模型配置，返回 `{ sceneDescription, sourceFingerprint, provider, model }`。服务端指纹包含文案标题、场景、角色及有序 section ID / 台词，不含段落标题、声音导演设置或等待；前端核对文案来源关联后应用结果。生成场景非空、最多 4,000 字符；手动工作态允许保存空串或 null。

`POST /api/clip-storyboard` 接受 `{ provider, project, clipId, includePrevious?: boolean, instruction? }`，`includePrevious` 默认 `false`。只允许唯一的当前人声片段，状态为 `asset_generated`，且 `asset://clip/<assetId>` 与素材编号一致。不使用未采用候选、完整生成窗口、整段混音、mock 素材或 SFX。服务端在配置素材根目录内读取已采用 WAV，解码 PCM，实测完整音频时长。时间线 `clip.duration` 不是音频时长，模型不能选择素材或编造秒数。单文件上限 128 MiB，实测时长上限 10 分钟；素材不存在、格式无效、读取中变化等情况明确报错并保留已有画面说明。

模型只生成标题及英文画面 / 动作 / 镜头。确定性 helper 注入当前工程 `clip.text` 的逐字中文台词、实测时长与固定 H3 声音 / 参考规则。每段独立导出 `[Shot 1]`，使用 `<Subject 1> (S1)`、`<Picture 1>`、`<Audio 1>`。图片只提供外貌与衣服，不充当首帧；参考外貌优先于文字中推测的细节。当前完整音轨选择 `fully_copy`，保持原词、原声、时序与停顿，不新增对白、环境声、音效或配乐，`non_diegetic_music: N/A`。嘴部跟随音轨，停顿及结束闭嘴；动作简单连续、嘴部可见。

默认独立生成。可选连续参考只使用时间线顺序中相邻前一条人声，忽略 SFX 与环境音，并要求该分镜来源有效且字段完整。上一镜成品用于画面连续性；新镜仍使用当前片段自己的台词与完整音频，不复制上一镜音轨，也不拼成一个多镜 prompt。

## 保存与有效性

英文与外貌规则由模型提示约束，schema 不做语言语义过滤。来源指纹标识输入元数据，不是 WAV 字节哈希。切换片段 / 项目或离开该片段分镜检查面板会取消其请求；只切顶层策划 / 工程工作区时，隐藏面板仍挂载，本身不触发取消。

Project JSON 新增可选元数据：

```ts
videoPlan: {
  version: 1,
  sceneDescription: string,
  shots: Record<clipId, {
    version: 1,
    promptFormat: "minimax-h3",
    clipId: string,
    sourceFingerprint: string,
    audio: { assetId: string, uri: string, duration: number },
    title: string, visual: string, action: string, camera: string,
    previousClipId?: string,
    previousPromptFingerprint?: string
  }>
}
```

`audio.duration` 是实测秒数。可选前镜字段必须同时存在，绑定相邻前镜的来源、实测音频及可编辑内容。当前来源指纹包含原台词、已采用素材及声明时长、工程场景、角色和统一基础场景。没有 `videoPlan` 的旧工程以 `project.scene.name` 作为有效基础场景；显式清空仍为空。

台词、音频、场景或角色变化会让已有分镜过期。被引用前镜的字段修改或其来源 / 引用链失效，会使依赖镜头过期；关联检查采用迭代，避免递归环。等待、音量、淡入淡出、空间处理与估计片段时长不改变本段来源。重新编排导致相邻人声变化时，旧连续参考可能失效。

过期或暂不完整的分镜继续保留并可编辑；复制 / TXT 下载要求来源有效、标题 / 画面 / 动作 / 镜头完整且基础场景非空。取消、素材变化、项目 / 片段切换与手动编辑中止进行中的请求，指纹不符或迟到结果不能覆盖新内容。重生成报错保留旧说明。

策划工作态和 PlannerSource 兼容可选场景及旧 V1。Project JSON、工程复制和版本记录保留有效 `videoPlan`；坏元数据独立丢弃，不丢原音频工程或策划稿。编辑中暂空字段允许保存。视频编辑合并到最新工程，不取消音频任务或修改声音编排；混音与片段生成指纹不受视频元数据影响。候选采用撤回保护同样排除视频元数据；撤回恢复旧音频但保留当前视频计划，让绑定被换素材的分镜自然过期。

## 验证与恢复

证据根：`I:/AI/asmr-director-clip-video/2026-10-01`。当前四个数据 / helper 文件 **116 项测试通过**（`data-tests-final.log`），全量 TypeScript 与 owned 文件 ESLint 通过，覆盖元数据兼容、实测时长 prompt、独立 / 前镜关联、过期传播、保存 / 版本及声音撤回。

最终全量 Vitest **86 文件 / 953 项通过**，一个既有 opt-in 文件 / 测试跳过（`full-tests-final.log`）。全量 TypeScript、ESLint、diff check 与生产 Webpack 构建通过（`typecheck-final.log`、`eslint-final.log`、`diff-check-final.log`、`build-final.log`），既有 Win32 SWC 警告回退成功。正式服务为 **3001 / PID25824 / `.next-clip-storyboard-production` / HTTP200**，临时 3002 已停。构建输出在 D 盘原生，仅 cache junction 指向本轮证据根的 `next-cache`。重启命令见 [AI_HANDOFF](../../AI_HANDOFF.md)，证据范围见[本轮开发记录](../../records/2026-10-01-audio-quality-v1-clip-video-storyboards.md)。

`browser-verification.json` 记录 **三次成功的 DeepSeek-v4-pro 调用**：基础场景、第三段独立分镜、第四段参考第三段。剪贴板回读确认当前工程逐字台词而非 draft / 上段台词、实测 **3.24 / 8.59 秒**、`fully_copy` 与 `N/A`。第四段含前镜画面 / 动作 / 镜头连续参考而不含第三段台词；新选第五段默认未勾选参考。未采用的第二段不能生成。修改前镜镜头使依赖分镜过期、保留说明并禁用复制，恢复后重新可用；清空全局场景禁用生成 / 复制。场景、分镜、连续参考及复制 prompt 刷新后完整一致；Planner 原七条台词逐字不变，场景及可用的重生成入口刷新后保持。

原 **22 条人声 / 七条策划稿**、工程标题 / 台词及时间线 label / 时间全部保持不变。**76 个 WAV SHA-256 完全一致**（`audio-hashes-before.json`、`audio-hashes-after.json`）。**1768×1252** 桌面、**390×844** 与 **320×740** 无整页宽高溢出，检查面板内部滚动；手机每段入口准确打开对应面板并将焦点移至可见分镜标签。console error 为零，截图只工具查看而未保存。TXT 下载已触发，Blob 内容与文件名由自动测试证明；未重新读取浏览器下载文件。

本轮只准备文字提示词并提供现有已采用音频下载，**TTS 调用零次、视频生成调用零次**，不接图片上传。以上真实文字模型检查不代表 H3 成片、视频画质或耳机听感验收。本轮未要求提交 / 推送。
