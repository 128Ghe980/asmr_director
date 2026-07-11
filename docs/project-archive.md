# AI ASMR Studio 项目留档

记录日期：2026-06-14

AI/上下文压缩恢复入口：`docs/AI_HANDOFF.md`

当前本地工作区路径（Codex desktop）：`D:\CodexWorkplace\asmr_director`。这是本机恢复线索，不是跨环境要求；换机器或换环境时以 repo 根目录为准。

这份文档是当前项目的历史档案，用来保存我们已经聊好的产品判断、设计方向、实现进度和决策过程。

如果是新的 AI agent 接手，或者当前会话发生上下文压缩，应先读 `docs/AI_HANDOFF.md`。那份文件更短、更稳定，专门服务“快速恢复当前状态和下一步”。

## 2026-07-12 - Roadmap Step 9 真实项目混音与导出完成

本轮把第 9 步从“手动 runtime 整段试听实验”推进到产品内接线：工作台现在可以把已经生成的 `asset://clip/...` clip assets 按 Project Timeline DSL 混成真实 `asset://mix/...` WAV，并在 Preview Layer 提供整段试听和 WAV 下载入口。

已完成内容：

- 新增 mix asset 存储约定：`asset://mix/<id>`，默认落盘到 `D:\CodexWorkplace\asmr_director_runtime\assets\mixes\app`，通过 `/api/assets/mix/<assetId>` 读取。
- 新增 project mix readiness / export state / fingerprint helpers，只有所有现存 voice、breath、sfx、ambience clip 都已经生成且拥有本地 `asset://clip/...` 时，才允许生成整段 mix。
- 新增 `renderProjectMixWav`：读取本地 PCM WAV clip，按 start/end、gain、fade、pan、distance、movement、ambience loop、target LUFS 和 limiter 混成 stereo PCM16 WAV。
- 新增 `/api/generation/mix`，用于从完整 Project JSON 生成真实 WAV mix；缺少 clip asset 时返回 409 missing assets，而不是假装成功。
- 扩展 generation bridge / local bridge / mock bridge / runtime job store，让 full-project mix 与 selected clip generation 共用同一套 job snapshot、cancel、running/error/success 状态语义。
- Preview Layer 增加整段控制：`生成整段`、`重混`、`试听`、`WAV`、`取消`。编辑 timeline 或 director preset 时，会取消当前活跃的 project mix job，避免旧 mix 被误认为当前版本。
- `docs/ROADMAP.md` 已把 Step 9 标为 Completed，把 Step 10 标为 Current / Next；`docs/AI_HANDOFF.md` 已同步当前能力、验证证据和下一步协议。

验证证据：

- `npm.cmd run test --prefix apps/web`：25 个 test files、158 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过，0 warnings。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过；仍有已知 SWC native binding warning，但 exit code 为 0。
- 本地 dev server 已在 `http://localhost:3000/` 启动，`Invoke-WebRequest http://localhost:3000/` 返回 HTTP 200。
- API 级真实 mix 验证：用一个 schema-valid 的最小项目和一个已生成本地 clip WAV 调用 `POST /api/generation/mix`，得到 `asset://mix/step9_verify_project_wav_20260711T203915972Z_697118df`；随后 `GET /api/assets/mix/step9_verify_project_wav_20260711T203915972Z_697118df` 返回 `audio/wav`、`128,044` bytes、WAV header `RIFF`。

边界与后续：

- 这次 API 验证没有重新跑 GPT-SoVITS；它复用了一个最小本地 generated clip asset 来验证 Step 9 的 app 内混音和导出链路。
- Step 9 已经不是“Do Not Do Yet”或“未来要做”；后续工作必须基于现有 `asset://clip/...` 与 `asset://mix/...` 合约继续推进。
- 下一步应按 `docs/ROADMAP.md` 进入 Step 10：产品工作流硬化。Step 10 很大，正式编码前需要先拆成小 scope，例如 project library/local project list、真实 waveform rendering、quality/readiness checks、version/history、export workflow polish 等。

## 当前一句话定位

AI ASMR Studio 不是一个普通的“AI ASMR 生成器”，而是一个 **AI ASMR 导演台**。

它的核心价值不是给用户一段黑盒音频，而是给用户一个可编辑、可重生成、可导出、可逐步沉淀为创作者资产的音声工程。

## 已有档案

- `docs/asmr导演早期设计.md`：早期产品定位、MVP 假设、技术路线、风险、商业化方向。
- `docs/superpowers/specs/2026-06-13-v0-1-dsl-first-design.md`：V0.1 DSL-first 产品设计。
- `docs/superpowers/plans/2026-06-13-v0-1-dsl-first-app.md`：V0.1 实施计划与验收清单。

## 已达成的核心共识

### 1. 产品差异化

产品不拼底层模型数量，而是拼“导演层”：

- 时间线 DSL。
- ASMR 分镜。
- 情绪曲线。
- 双耳空间调度。
- 自动质检。
- 局部重生成。
- 创作者导出。

用户应该感觉自己是在导演 AI 声优和音效工程，而不是在抽卡生成音频。

### 2. V0.1 路线

V0.1 采用 `C -> A -> B` 的路线：

1. 先做核心资产设计：`ASMR Project JSON`、`Timeline DSL`、clip schema。
2. 再做产品体验原型：mock 数据、导演分镜、轻量时间线、JSON 导出。
3. 最后再接真实技术闭环：LLM、TTS、SFX、混音、质检、音频导出。

原因是 Timeline DSL 是导演台中枢。只要 DSL 稳，后续模型和音频链路可以替换，产品层不需要摇晃。

### 3. V0.1 非目标

V0.1 不做完整 DAW，不接真实 TTS/SFX，不做真实 MP3/WAV 导出，不做用户系统、付费、审核后台或复杂协作。

V0.1 的重点是验证：一个结构化 ASMR 工程是否能被清楚展示、保存、重新加载和导出。

### 4. 视觉方向

我们定下来的视觉方向是：

> **以 Studio Console 作为底盘，少量吸收 Ambient Director 的氛围。**

具体含义：

- 页面首先要像专业创作工具，不像营销页、玩具 demo 或普通后台表格。
- 第一屏要能看到 AI ASMR Studio、分镜、时间线和当前片段状态。
- 信息密度可以高，但层级要清楚。
- 氛围可以有雨夜、微光、声波、玻璃感或空间感，但只能服务内容，不能喧宾夺主。
- 避免大面积纯紫、纯蓝、纯渐变和装饰堆叠。
- 漂亮来自布局、层级、状态、细节和克制，不来自堆视觉特效。

## 当前 V0.1 已完成内容

### 工程结构

- 使用 Next.js App Router、TypeScript、Tailwind CSS、Zod、lucide-react、Vitest。
- 前端应用位于 `apps/web`。
- 当前页面运行入口是 `apps/web/src/app/page.tsx`。
- 当前主交互组件是 `apps/web/src/components/studio/studio-app.tsx`。

### 数据层

已完成 ASMR Project JSON / Timeline DSL 的 Zod schema：

- 项目状态：`draft`、`planning_failed`、`timeline_invalid`、`ready_for_preview`、`export_failed`。
- 资产状态：`asset_pending`、`asset_generating`、`asset_generated`、`asset_failed`。
- 固定轨道：`voice`、`breath`、`sfx`、`ambience`、`post_processing`。
- clip 字段：时间、时长、音量、淡入淡出、声像位置、生成状态、资源引用。
- voice clip 额外包含台词、情绪、风格、语速。
- sfx / ambience / breath clip 使用同一套时间线和空间参数。

额外校验已经加入：

- timeline 必须包含且只包含每种固定轨道各一个。
- emotion curve 的 `end` 必须大于 `start`。
- emotion curve 不能超出项目总时长。
- clip 的 `start` 和结束时间不能超出项目总时长。
- pan 必须在 `-1` 到 `1` 之间。

### Demo 数据

当前 mock 项目是“雨夜睡前陪伴”：

- 目标时长：210 秒。
- 场景：雨夜卧室。
- 角色：年上姐姐 / gentle / mature / comforting。
- 情绪曲线：`gentle_intro` -> `comforting` -> `sleepy_whisper` -> `fade_out`。
- 轨道包括人声、呼吸/轻笑、ASMR 音效、环境雨声和后期处理占位。
- 当前所有音频资产保持 `asset_pending`，明确表示 V0.1 只是工程预览，不假装已经生成真实音频。

### UI 页面

当前页面是一个 Studio Console：

- 顶部项目栏：项目名、状态、时长、语言、LUFS、JSON 导出。
- 左侧 Director Storyboard：按时间顺序展示所有可听事件。
- 中间 Timeline：按固定轨道展示 clip 块。
- 中间 Emotion Curve：展示情绪节奏分布。
- 右侧 Clip Inspector：展示当前选中片段的内容、时间、声像、音量、模型状态。

Storyboard、Timeline、Inspector 都从同一份 `demoProject` / Timeline DSL 渲染，不维护各自的数据副本。

### 交互

- 可以从 Storyboard 或 Timeline 选择 clip。
- 选中状态会同步更新到 Inspector。
- Export JSON 会导出当前项目 JSON，文件名使用 `project_id`。

### 浏览器验收

已在浏览器中检查：

- 桌面端第一屏能看到 AI ASMR Studio、storyboard、timeline、inspector。
- 页面没有文档级横向溢出。
- Storyboard 和 Timeline 的选中状态清楚。
- 移动端 header 能换行，storyboard 优先显示。
- 移动端长中文行能换行，timeline 和 emotion curve 使用内部横向滚动。
- Export JSON 按钮点击无控制台错误。

## 当前验证状态

最后一次验证通过：

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

结果：

- 测试通过：2 个 test files / 14 个 tests。
- lint 通过。
- build 通过。
- build 期间出现本地 `@next/swc-win32-x64-msvc` Win32 warning，但 webpack/WASM fallback 构建成功。
- git working tree 干净。

## 关键提交

- `a7caffb feat: define asmr project schema`
- `1854c4a feat: add demo project and timeline helpers`
- `4a5943f style: add studio visual foundation`
- `22a98e3 feat: build studio console components`
- `745350d feat: render v0 studio prototype`
- `0b169d4 polish: verify studio console layout`
- `11e96bc fix: validate timeline ranges`
- `7a97e73 docs: add v0 studio planning artifacts`

## 下一步方向

推荐下一步做 V0.2 的“编辑闭环”。

优先顺序：

1. 可编辑 Inspector：修改台词、情绪、语速、音量、声像、时间参数。
2. 本地状态管理：编辑后 storyboard、timeline、inspector 和 export JSON 同步更新。
3. 实时 schema 校验：错误直接显示在界面上。
4. JSON 导入/重置：支持把项目 JSON 重新载入页面。

这一步会把当前“漂亮的 DSL 预览台”推进成真正可用的“ASMR 时间线编辑台”。

## V0.2 编辑闭环进展

已启动 V0.2 的前半步：可编辑 Inspector + 本地项目状态同步 + 实时 schema 校验。

本轮新增设计与计划：

- `docs/superpowers/specs/2026-06-14-v0-2-editing-loop-design.md`
- `docs/superpowers/plans/2026-06-14-v0-2-editing-loop.md`

已实现内容：

- `StudioApp` 维护可编辑的本地 project state。
- `ClipInspector` 支持编辑当前 clip 的文本、时间、时长、音量、pan、距离和移动方式。
- voice / breath / sfx / ambience clip 都有对应的类型字段编辑入口。
- Storyboard、Timeline、Inspector、Validation Panel 和 Export JSON 都从同一份可编辑 project 渲染。
- `ValidationPanel` 实时显示项目是否通过 schema 校验；非法时间范围会显示具体路径和错误信息。
- `Export JSON` 会导出编辑后的 project，而不是初始 demo project。

浏览器交互验收覆盖：

- 选择 voice clip 后修改台词，Storyboard 和 Inspector 同步显示新台词。
- 输入非法 duration 后显示 `timeline.tracks.0.clips.0.duration` 校验错误。
- 恢复合法 duration 后重新显示 `Project valid`。
- 导出的 `asmr_demo_001.json` 包含编辑后的台词。
- 桌面和 390px 移动视口没有文档级横向溢出。

## V0.2 项目持久化进展

已补齐本地项目闭环：自动保存/恢复、粘贴 JSON 导入、Reset Demo、dirty/restored 状态。

本轮新增设计与计划：

- `docs/superpowers/specs/2026-06-14-v0-2-project-persistence-design.md`
- `docs/superpowers/plans/2026-06-14-v0-2-project-persistence.md`

已实现内容：

- `project-persistence.ts` 提供 project 序列化、导入解析、localStorage 读取/保存/清空 helper。
- `StudioApp` 页面加载后从 `localStorage` 恢复最近项目。
- 编辑 project 后自动保存到 `ai-asmr-studio:v0:project`。
- `ProjectControls` 支持粘贴 JSON、Load JSON、Reset Demo。
- 导入非法 JSON 时显示错误，并保留当前 project。
- Reset Demo 会恢复内置 demo，并清除本地保存影响。
- Project Controls 显示 `Demo`、`Edited` 或 `Restored from browser` 状态。

浏览器交互验收覆盖：

- 编辑台词后刷新页面，编辑内容仍保留。
- Reset Demo 后恢复原始台词，刷新后仍保持原始 demo。
- 导入合法 JSON 后标题和台词更新。
- 导入非法 JSON 后显示 `Import JSON could not be parsed.`，当前 project 不被覆盖。
- 导出 JSON 包含当前导入后的 project 内容。
- 桌面和 390px 移动视口没有文档级横向溢出。

## AI 交接文档结构

为了方便未来其他 AI 续写项目，也方便上下文压缩后快速恢复状态，项目新增双层记忆结构：

- `docs/AI_HANDOFF.md`：高信号接手入口。新的 AI agent 或压缩后的会话应先读它。
- `docs/project-archive.md`：历史档案。记录更完整的产品判断、阶段进展和决策过程。

这避免把所有信息都堆进一个越来越长的 archive。`AI_HANDOFF.md` 只保留当前状态、关键文件地图、验证命令、最近提交和下一步推荐；`project-archive.md` 继续保留上下文和演进历史。

## V0.3 Director Actions 进展

已完成一轮“导演意图按钮”能力，把 raw field editing 往更像导演台的交互推进了一步。

本轮新增设计与计划：

- `docs/superpowers/specs/2026-06-16-v0-3-director-action-presets-design.md`
- `docs/superpowers/plans/2026-06-16-v0-3-director-action-presets.md`

已实现内容：

- voice clip 的 Inspector 中显示 Director Actions：`Softer`、`Closer`、`Left`、`Right`、`Pause`、`Quiet`。
- `director-presets.ts` 用纯函数把按钮意图转成确定性的 Timeline DSL 修改。
- `Pause` 对已经以 ` ...` 结尾的文本保持幂等，避免重复点击导致不可见的 duration 漂移。
- 非 voice clip 不显示 Director Actions，避免把人声导演意图误套到 SFX / ambience / breath。
- 相关行为已补测试；当前 handoff 记录的最新验证为 5 个 test files / 34 个 tests。

## 字段级校验高亮进展

已完成当前路线中的第一项：把 schema validation issue 精确连回当前选中 clip 的 Inspector 字段。

本轮新增设计与计划：

- `docs/superpowers/specs/2026-06-16-field-level-validation-highlighting-design.md`
- `docs/superpowers/plans/2026-06-16-field-level-validation-highlighting.md`

已实现内容：

- `edit-project.ts` 新增 `getClipFieldValidationIssues`，把 `timeline.tracks.N.clips.M.duration` 这类路径映射为 Inspector field key。
- 支持映射当前可编辑字段，包括 `start`、`duration`、`volume_db`、`position.pan`、`position.distance`、`position.movement` 和各 clip 类型字段。
- `StudioApp` 从现有 `validationIssues` 派生当前选中 clip 的 field issue map。
- `ClipInspector` 对有问题的字段显示 amber 错误态、`aria-invalid`、`aria-describedby` 和紧凑 inline message。
- 全局 `ValidationPanel` 保留完整项目 issue 列表，字段级提示只负责就地定位。

实现中修正了一个 TypeScript build 问题：嵌套函数中直接读取 `selectedClip.id` 时，TypeScript 不接受 early return 后的闭包收窄；改为提前捕获 `selectedClipId` 后 build 恢复通过。

验证覆盖：

- `npm.cmd run test --prefix apps/web`：5 个 test files / 38 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过；本地 SWC warning 仍可能出现，但 webpack/WASM 构建完成。
- 浏览器验收：非法 duration 高亮 Duration 字段并显示 inline error；非法 pan 高亮 Pan 字段；恢复合法值后字段错误清空；Validation Panel 仍显示全局 issue；桌面和 390px 移动视口无文档级横向溢出。

## 当前初步路径（2026-06-16）

这条路线是当前共识；`docs/AI_HANDOFF.md` 保留更短、更适合上下文恢复的高信号版本。

1. 字段级校验高亮：已完成，当前选中 clip 的 Inspector 字段会显示对应错误态，同时保留全局 Validation Panel。
2. 轻量时间线编辑：下一步，支持 start/duration 微调、插入 pause 等小动作，但暂时不做完整 DAW 拖拽系统。
3. 项目结构升级：补更清楚的 project shell、元数据和未来项目列表空间，继续保持本地优先。
4. 真实音频前的预览层：先做占位播放状态、波形/状态位和生成槽位，让流程像音频产品，但不假装已经有真实音频。
5. 真实生成链路：等导演工作流和 Timeline DSL 稳定后，再接 TTS/SFX、回听、局部重生成和导出。

核心排序原则：先把“可编辑的 ASMR 工程”和“导演层”做扎实，再接昂贵且容易牵动架构的真实音频生成。

## 恢复工作指引

继续开发时建议先读：

1. `docs/AI_HANDOFF.md`
2. `docs/project-archive.md`
3. `docs/superpowers/specs/2026-06-13-v0-1-dsl-first-design.md`
4. `apps/web/src/lib/asmr/schema.ts`
5. `apps/web/src/lib/asmr/mock-project.ts`
6. `apps/web/src/components/studio/studio-app.tsx`

本地运行：

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000
```

本地验证：

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```
## Light Timeline Editing 进展（2026-06-16）

这一轮完成了当前初步路径里的第 2 项：轻量时间线编辑。我们没有进入完整 DAW 拖拽/resize 体系，而是先把最常用的小时间修改做成确定性的 Timeline DSL 操作。

新增设计与计划：

- `docs/superpowers/specs/2026-06-16-light-timeline-editing-design.md`
- `docs/superpowers/plans/2026-06-16-light-timeline-editing.md`

已实现内容：

- `edit-project.ts` 新增 `ClipTimingNudge` 与 `nudgeClipTiming`，支持对选中 clip 的 `start` / `duration` 做 delta 微调。
- timing helper 保持纯函数、不可变更新；找不到 clip 时返回原 project。
- `start` 最小值 clamp 到 `0`，`duration` 最小值 clamp 到 `0.1`，并按 0.1 秒步长取整。
- helper 不强行把 clip end clamp 回 project duration，越界继续交给现有 schema validation 与字段级校验高亮处理。
- `ClipInspector` 新增 Timing Actions：`Start -0.5s`、`Start +0.5s`、`Duration -0.5s`、`Duration +0.5s`。
- `StudioApp` 通过 `nudgeClipTiming` 更新当前 `AsmrProject`，因此 Storyboard、Timeline、Inspector、Validation Panel、Export JSON 与 localStorage 仍然共享同一份状态。

验证覆盖：

- `npm.cmd run test --prefix apps/web`：5 个 test files / 44 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过；本地 SWC Win32 warning 仍可能出现，但 webpack/WASM 构建成功。
- 浏览器验证因 in-app Browser 的 Node runtime 返回 `failed to write kernel assets`，本轮改用本机 Chrome CDP fallback 验证。
- 验证结果：`Duration +0.5s` 会更新 voice duration、Time row、Timeline label/width；`Start +0.5s` 会更新 voice start 与 Timeline left；ambience duration 越界后 Duration 字段显示 inline issue，global Validation Panel 同步显示，`Duration -0.5s` 恢复后错误清除；桌面 1440px 与移动 390px 均无文档级横向溢出。

路线状态更新：

1. 字段级校验高亮：已完成。
2. 轻量时间线编辑：已完成 start/duration nudge。
3. 项目结构升级：下一步，目标是让产品从“单个 demo 编辑页”更像一个本地优先的项目工作区，为后续项目列表、元数据、预览层留出结构。
## 中文界面文案进展（2026-06-16）

这一轮是路线外插队的小修正：用户发现页面整体仍偏英文，希望先把界面改成中文，并要求按钮名字简洁清晰。我们采用的口径是“中文为主，保留必要技术缩写”，也就是保留 `ASMR`、`JSON`、`dB`、`LUFS`、`seed`，其余可见操作文案尽量中文化。

新增设计：

- `docs/superpowers/specs/2026-06-16-chinese-ui-copy-design.md`

已实现内容：

- 新增 `apps/web/src/lib/asmr/ui-copy.ts`，集中管理中文状态、轨道、片段类型、空间位置、移动方式、常见 timeline 值和校验信息。
- 主要页面文案改为中文：`分镜`、`时间线`、`情绪曲线`、`项目校验`、`项目操作`、`片段检查`。
- 按钮名改为短中文：`导出 JSON`、`载入`、`重置`、`更柔`、`更近`、`左耳`、`右耳`、`停顿`、`降低`、`开始 -0.5秒`、`开始 +0.5秒`、`时长 -0.5秒`、`时长 +0.5秒`。
- 状态徽章从 raw enum 改成中文，例如 `可预览`、`待生成`、`生成中`、`已生成`。
- 常见 demo 值从英文枚举展示改为中文，例如 `comforting` -> `安抚`，`rain_room_tone` -> `雨夜房间`。
- 校验错误与导入错误展示为中文，例如 `片段结束不能超过项目总时长`、`JSON 解析失败。`

验证覆盖：

- `npm.cmd run test --prefix apps/web`：6 个 test files / 51 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过；本地 SWC Win32 warning 仍可能出现，但 webpack/WASM 构建成功。
- 浏览器验证：核心可见 UI 和按钮均为中文，旧英文按钮/面板词未出现在页面文本中；越界校验错误为中文；桌面 1440px 与移动 390px 均无文档级横向溢出。

路线状态：

- 这不是替换“项目结构升级”的路线项，只是进入下一步前的体验修正。
- 下一步仍然回到 `docs/AI_HANDOFF.md` 记录的 `project structure upgrade`。

## 2026-06-17 - C+ 项目工作区实现

这一轮完成了用户批准的 C+ 项目工作区结构，把原先偏单页编辑器的 Studio Console 推进成更清晰的本地优先项目工作区。实现对应了中英规格与 mock 的方向：左侧项目栏、顶部工作区状态/操作栏、中间编辑器、右侧项目详情栏，并保留中文为主、必要英文技术名词保留的界面口径。

已实现内容：

- 新增 `apps/web/src/lib/asmr/project-summary.ts` 与 `apps/web/src/lib/asmr/project-summary.test.ts`，用于从当前 `AsmrProject` 派生项目级摘要和工作区指标。
- 新增工作区组件：`project-workspace.tsx`、`project-workspace-header.tsx`、`project-rail.tsx`、`project-details-dock.tsx`、`project-workspace-badge.tsx`。
- 左侧项目栏和右侧项目详情栏可独立折叠；`专注编辑` 会同时折叠两侧，再次点击可恢复。
- 项目级操作已集中到 `ProjectWorkspaceHeader`：`导出`、`载入`、`重置`。
- 旧的 `project-header.tsx` 和 `project-controls.tsx` 已删除，避免继续维护两套项目级入口。
- `StudioApp` 仍然拥有单一 `AsmrProject` 状态，继续负责选择、验证、导入、导出、重置、本地保存和把编辑结果同步到各个视图。
- 本轮没有加入后端、真实音频生成、云端项目、多项目管理或真实播放能力。

浏览器验证覆盖：

- 默认桌面宽度约 1259px。
- `专注编辑`。
- 左右侧栏独立折叠。
- 无效导入与重置。
- 1024px 视口。
- 390px 移动端。
- 上述场景均未发现文档级水平溢出。
- `导出` 按钮已点击验证，页面无 console error；但 Codex in-app browser 不支持 download event，因此无法用下载事件确认文件落盘。

实现过程中验证通过：

- `npm.cmd run test --prefix apps/web`：7 个 test files / 55 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过；build 可能出现已知 SWC Win32 optional warning，但 webpack/WASM 构建完成。

路线更新：

- 当前初步路径第 3 项“项目结构升级”已完成。
- 下一步推荐改为 **preview layer before real audio**。
- 原因是 C+ shell 已经给预览层留出结构位置，但仍是占位；下一轮应先做播放状态、波形/状态界面和 generation slots，让流程像音频产品，但不假装已有真实音频。
- 真实 TTS/SFX、真实音频播放、真实 waveform 和导出仍应等导演工作流与 Timeline DSL 更稳定后再接入。

## 2026-06-26 - Roadmap governance reset

- User identified a project-management failure: the intended route existed only as scattered conversation/context, so repeated “what next?” answers drifted into newly invented bridge/mock steps.
- Added `docs/ROADMAP.md` as the single hard source for the 10-step product route.
- Added `docs/PROJECT_MANAGEMENT.md` with process rules for following the roadmap, checking current project reality, updating docs, and requiring verification evidence.
- Added root `AGENT.md` as the agent entrypoint that points to the roadmap, project-management rules, and handoff summary.
- Updated `docs/AI_HANDOFF.md` so it summarizes the roadmap instead of defining a competing one.
- Clarified that adapter/API/provider-wrapper work is an implementation detail only; it must not become a separate top-level gate that delays the current roadmap priority.

## 2026-06-22 - Generation Bridge

This round implemented the mock-first Generation Bridge described by:

- `docs/superpowers/specs/2026-06-22-generation-bridge-design.md`
- `docs/superpowers/specs/2026-06-22-generation-bridge-design.zh.md`
- `docs/superpowers/plans/2026-06-22-generation-bridge.md`

What changed:

- Added a backend-shaped `GenerationBridge` contract and a local mock implementation.
- Added runtime-only job state for queued/generating/progress/succeeded/failed/canceled behavior.
- Added pure durable project commits for generated mock assets and failed generation state.
- Kept runtime `jobId`, progress, queue/generating/canceling state, `blob:` URLs, and `data:audio` URLs out of `AsmrProject`, local saved project JSON, and exported JSON.
- Added `mock://asset/<clipId>/<jobId>` asset URIs and a runtime resolver that turns them into playable local mock WAV data URLs.
- Added selected clip generation controls in Inspector: `生成`, `重生成`, `重试`, and `取消`.
- Enabled selected clip mock preview playback in the right Preview Layer while keeping project-mix preview disabled/out of scope.
- Preserved import/export/reset/autosave, validation, Timeline status display, and the collapsible C+ project workspace.

Implementation notes:

- `StudioApp` owns the bridge instance, runtime generation state, session guards, callback handling, and mock playback.
- Generation view state is derived by `generation-view.ts`, which merges durable project data and runtime jobs before rendering UI.
- `generation-project-state.ts` is responsible for final project mutation only: success commits asset metadata; failure commits `asset_failed`; failed regeneration preserves previous generated assets.
- A TypeScript build failure surfaced in `generation-view.ts` because direct union-track `flatMap` bypassed the existing `flattenClips` helper. The fix uses `flattenClips(displayProject)` and is covered by build verification.

Verification:

- `npm.cmd run test --prefix apps/web`: 13 test files / 92 tests passed.
- `npm.cmd run lint --prefix apps/web`: passed.
- `npm.cmd run build --prefix apps/web`: passed.
- Browser verification used `http://localhost:3000/` plus Playwright with system Chrome because the in-app browser Node runtime returned `failed to write kernel assets`.
- Browser checks covered Chinese UI text, selected clip generation, progress and cancel state, success to `重生成`, enabled selected clip preview playback, local saved project containing `mock://asset/`, local saved project excluding runtime job state, focus/collapse controls, desktop overflow, collapsed desktop overflow, 390x900 mobile overflow, and no console/page errors.

Roadmap update (superseded by 2026-06-26 roadmap governance reset):

- The previous "real generation integration design" target has now been refined by implementation: the mock bridge boundary exists.
- Historical recommendation at the time was **API-backed generation bridge design**.
- This is no longer the current next-step instruction. Current top-level route is defined only in `docs/ROADMAP.md`.

## 2026-07-07 - Roadmap Step 7 Real Generation MVP 接入工作台

本轮把 2026-07-06 已经手动跑通的本地 GPT-SoVITS runtime 接入 checked-in Next.js 工作台，完成 roadmap 第 7 步“真实生成 MVP”的产品内接线。

实现内容：

- 新增 `local-runtime-config.ts`，默认指向 `D:\CodexWorkplace\asmr_director_runtime`，并支持 `ASMR_DIRECTOR_RUNTIME_ROOT`、`ASMR_GPT_SOVITS_URL`、`ASMR_VOICE_PACK_PATH`、`ASMR_CLIP_ASSET_ROOT` 覆盖。
- 新增 `voice-pack.ts`，读取本地 voice pack JSON、参考音频路径、日语 prompt transcript，并要求 `licenseStatus: "user_confirmed"` 和 `consentConfirmedAt`。
- 新增 `gpt-sovits-provider.ts`，把 voice clip 映射到 GPT-SoVITS `/tts` 请求，使用 `clip.text` 作为实际生成文本，使用 voice pack prompt text 作为参考音频转写。
- 新增 `local-asset-store.ts`，把生成的 WAV 写入 runtime asset store，并只向项目返回 `asset://clip/<assetId>`。
- 新增 `local-clip-generation.ts`，串起 clip 查找、voice pack 加载、provider 请求和资产保存。
- 新增 `POST /api/generation/clip`，用于 selected clip generation；本步骤只允许 voice clip。
- 新增 `GET /api/assets/clip/[assetId]`，用于把本地 generated WAV 作为 `audio/wav` 播放。
- 新增 `local-generation-bridge.ts`，浏览器侧默认调用本地 API，保留 queued / generating / succeeded / failed / canceled 的原有 update 形状。
- 新增 `playback-asset-resolver.ts`，让 Preview Layer 同时支持 `asset://clip/...` 与 `mock://asset/...`。
- `studio-app.tsx` 默认使用 local real bridge；只有 `NEXT_PUBLIC_ASMR_GENERATION_MODE=mock` 时才回到 mock bridge。
- `generation-view.ts` 允许 `asset://clip/...` 成为可播放的 selected clip preview asset。

关键设计边界：

- Project JSON 仍然只保存 final durable asset reference 和最终 asset metadata。
- runtime job、progress、callback state、local absolute path、`blob:`、`data:audio` 都不进入 Project JSON。
- 本地 GPT-SoVITS 请求是同步式 provider 调用；取消在 Step 7 中是客户端 best-effort：UI 可以取消本地提交并忽略晚到结果，但不能中断已经发出的 GPT-SoVITS 请求。
- 默认 bridge 已切到真实本地生成，mock 只是显式配置回退，不再是产品默认路径。

端到端验收：

- 启动 GPT-SoVITS API：`http://127.0.0.1:9880/docs` 返回 200。
- 启动 Next dev server：`http://localhost:3000/` 返回 200。
- Headless Chrome CDP 验收中，页面 hydrate 成功，选中 `voice_001` 后点击 `生成`。
- 生成结果写入 localStorage / Project JSON：`asset://clip/voice_001_20260706T211523064Z_d3b95513`。
- 播放接口 `GET /api/assets/clip/voice_001_20260706T211523064Z_d3b95513` 返回 `audio/wav`，`241,964` bytes，WAV header 为 `RIFF`。
- 页面 error/warning 日志为空。

自动化验证：

- `npm.cmd run test --prefix apps/web`：21 个 test files / 118 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过。
- `npm.cmd run build --prefix apps/web` 在当前 Windows 环境会触发 Turbopack native binding 不支持提示；这不是本轮代码失败，验证命令固定使用 `-- --webpack`。

对 roadmap 的影响：

- 第 7 步已完成。
- 下一步按 `docs/ROADMAP.md` 进入第 8 步：多类型真实 Clip 生成。
- 不要再把 adapter、API route、provider wrapper、bridge cleanup 提成新的顶层阶段；这些只能作为第 8 步或后续步骤的内部实现细节。

## 2026-07-07 - Roadmap Step 8 多类型真实 Clip 生成

本轮在第 7 步 voice clip 真实生成的基础上，把 selected clip generation flow 扩展到非 voice clip。实现策略是本地程序化 WAV renderer：不下载新模型，不引入素材库授权问题，不改变 Project JSON contract，先让 timeline 中的 breath、SFX、ambience 都能生成真实可播放 WAV。

实现内容：

- 新增 `apps/web/src/lib/asmr/procedural-audio.ts`：
  - 输出 32 kHz mono 16-bit PCM WAV。
  - 同一 clip id / type / seed 输出确定。
  - `breath` 使用柔和噪声和呼吸包络。
  - `sfx` 使用布料 / 被褥摩擦噪声，并预留敲击式短脉冲分支。
  - `ambience` 使用雨声底噪和稀疏雨滴颗粒。
- 新增 `apps/web/src/lib/asmr/procedural-audio.test.ts`，覆盖 WAV header、长度、确定性、seed / 类型差异、voice reject。
- `apps/web/src/lib/asmr/local-clip-generation.ts` 新增 `generateLocalClip`：
  - voice 继续走 GPT-SoVITS。
  - breath / SFX / ambience 走程序化 renderer。
  - 生成后仍通过 `saveClipAsset` 写入 `D:\CodexWorkplace\asmr_director_runtime\assets\clips\app`。
  - `generateLocalVoiceClip` 保留为兼容 wrapper。
- `POST /api/generation/clip` 改为调用通用 `generateLocalClip`。
- `generation-view.test.ts` 增加非 voice `asset://clip/...` selected preview 回归测试。
- 新增第 8 步设计与计划：
  - `docs/superpowers/specs/2026-07-07-multi-type-real-clip-generation-design.md`
  - `docs/superpowers/specs/2026-07-07-multi-type-real-clip-generation-design.zh.md`
  - `docs/superpowers/plans/2026-07-07-multi-type-real-clip-generation.md`

端到端验收：

- Next dev server：`http://localhost:3000/` 返回 200。
- GPT-SoVITS：`http://127.0.0.1:9880/docs` 返回 200，但本轮非 voice 验收不依赖 GPT。
- Headless Chrome CDP 验收中，从工作台 UI 选中并生成：
  - `breath_001` -> `asset://clip/breath_001_20260706T213815920Z_b55ae7b8`，播放接口返回 `audio/wav`，`153,644` bytes，WAV header `RIFF`。
  - `sfx_blanket_001` -> `asset://clip/sfx_blanket_001_20260706T213816276Z_0089677d`，播放接口返回 `audio/wav`，`217,644` bytes，WAV header `RIFF`。
- 页面 error/warning 日志为空。

自动化验证：

- `npm.cmd run test --prefix apps/web -- local-generation-bridge local-clip-generation generation-view playback-asset-resolver procedural-audio`：5 个 test files / 29 个 tests 通过。
- `npm.cmd run test --prefix apps/web`：22 个 test files / 124 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过。输出仍包含已知 SWC native binding warning，但 build 退出码为 0。

对 roadmap 的影响：

- 第 8 步验收要求“至少两类非 voice clip”已经由 breath + SFX 端到端验证满足；代码同时支持 ambience。
- 下一步进入第 9 步：真实项目混音与导出。
- Step 9 应消费现有 `asset://clip/...` 文件，按 timeline timing 混成真实 WAV；不要回退到继续做 mock bridge 或 provider spike。

## 2026-07-10 - 文档冲突清理：第 9 步混音优先级

本轮只清理项目记录和恢复文档，不改变产品路线。

- 确认 `docs/ROADMAP.md` 仍是唯一顶层路线源，第 9 步“真实项目混音与导出”是当前最高优先级。
- 修正 `docs/AI_HANDOFF.md` 的旧表述：`Real project-mix rendering` 不再属于 `Do Not Do Yet`，而是当前 Roadmap Step 9。
- 将“project-mix preview out of scope”的旧说法改成“当前 Step 9 目标”，避免后续 AI 或上下文压缩后误判下一步。
- 保留 Step 10 产品化能力为后续事项，不把 backend persistence、auth/cloud、real waveform、billing、publishing 等提前混入 Step 9。

## 2026-07-06 - GPT-SoVITS 本地真实生成实验

本轮没有修改 checked-in 前端代码，而是在项目外的本地 runtime 中打通了一条真实 TTS 生成链路，用于验证 roadmap 第 7 步“真实生成 MVP”的技术可行性和听感边界。

Runtime 位置：

- Runtime 根目录：`D:\CodexWorkplace\asmr_director_runtime`。
- GPT-SoVITS 仓库：`D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\GPT-SoVITS`。
- GPT-SoVITS 上游：`https://github.com/RVC-Boss/GPT-SoVITS.git`。
- 本地 GPT-SoVITS 提交：`bf81cdb`。
- 本地 `LICENSE` 显示 GPT-SoVITS 根代码许可证为 MIT License；模型权重、ASR 模型、参考音频、声音包和生成音频仍需按各自来源单独确认授权。统一边界见 `docs/THIRD_PARTY_RUNTIMES.md`。
- Python 环境：`D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\env-comfyui-clone`。
- GPT-SoVITS API 地址：`http://127.0.0.1:9880/tts`。
- 使用 GPT-SoVITS v2 pretrained weights，配置文件为 `GPT_SoVITS/configs/tts_infer.yaml`。

启动命令：

```powershell
D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\env-comfyui-clone\python.exe api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
```

Voice pack：

- `D:\CodexWorkplace\asmr_director_runtime\voice-packs\default\voice-pack.json`
- `D:\CodexWorkplace\asmr_director_runtime\voice-packs\default\reference.wav`
- `D:\CodexWorkplace\asmr_director_runtime\voice-packs\default\prompt.txt`

参考音频来自用户提供的 `D:\temp\音频.MP3`，转换为 `reference.wav` 后约 `6.3s`，32kHz mono PCM。

一开始误把 `prompt_text` 当成“生成提示词”，写了中文占位句，导致生成内容和节奏明显不稳定。后续确认 GPT-SoVITS 的 `prompt_text` 实际含义是“参考音频真实转写”，不是要生成的文本。真正要生成的内容是请求里的 `text`。

ASR 转写：

- 日语 / 英语走 `tools/asr/fasterwhisper_asr.py`。
- 中文 / 粤语偏 FunASR。
- Faster Whisper 模型下载在 D 盘项目 runtime 下，避免占用 C 盘。
- ASR 输入：`D:\CodexWorkplace\asmr_director_runtime\asr\reference-input\reference.wav`。
- ASR 输出：`D:\CodexWorkplace\asmr_director_runtime\asr\output\reference-input.list`。

识别结果：

```text
助けてくれたのかなあの時はありがとう今は財布持ってないから昼休みに非常階段に来てもらって
```

当前 voice pack 使用：

- `promptLanguage: "ja"`
- `textLanguage: "zh"`
- `prompt.txt` 写入上述日语 ASR 转写。

Faster Whisper 模型位置：

- `D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\GPT-SoVITS\tools\asr\models\faster-whisper-large-v3`

模型本地检查：

- `model.bin`: `3,087,284,237` bytes。
- `config.json`: `2,394` bytes。
- `preprocessor_config.json`: `340` bytes。
- `tokenizer.json`: `2,480,617` bytes。
- `vocabulary.json`: `1,068,114` bytes。
- 没有残留 `.incomplete` 或 `.lock` 文件。
- 虽然 Hugging Face 远端元数据查询因代理 SSL 问题失败，但该模型已经实际完成 ASR，说明本地可用。

单句 TTS 实验：

- 成功生成真实 WAV：`D:\CodexWorkplace\asmr_director_runtime\assets\clips\manual-test-prompt-transcribed-ja-serial.wav`
- 时长：`5.26s`
- 格式：32kHz mono PCM WAV。

关键参数：

- `prompt_text`: 日语 ASR 转写。
- `prompt_lang`: `ja`。
- `text_lang`: `zh` 或后续长段测试中的 `all_zh`。
- `batch_size`: `1`。
- `parallel_infer`: `false`。
- `split_bucket`: `false`。

连贯 ASMR 试听实验：

为了模拟工作台里的“多个 voice clip 组成整段试听”，手动生成 6 个 voice clip，然后拼接为一个完整 WAV。该实验没有接入前端 UI，也没有写入 Project JSON；它只是一个真实 provider 的运行时证明。

- Manifest：`D:\CodexWorkplace\asmr_director_runtime\assets\clips\workbench-asmr-test-2026-07-06\manifest.json`
- 整段输出：`D:\CodexWorkplace\asmr_director_runtime\assets\mixes\workbench-asmr-test-2026-07-06.wav`
- 时长：`59.53s`
- 格式：32kHz mono PCM WAV。

分段输出：

- `01_voice_001.wav`: `10.28s`
- `02_voice_002.wav`: `8.08s`
- `03_voice_003.wav`: `8.28s`
- `04_voice_004.wav`: `8.92s`
- `05_voice_005.wav`: `8.96s`
- `06_voice_006.wav`: `8.46s`

这条整段音频使用 GPT-SoVITS 逐段真实生成，再用静音间隔拼接。它接近未来 timeline/mix 的工作方式，但不能算 roadmap 第 9 步“真实项目混音与导出”完成，因为它没有使用 checked-in app 的 timeline DSL、asset reference、Preview Layer 或导出按钮。

关键问题与结论：

- `prompt_text` 必须尽量匹配参考音频的真实转写；它不是 ChatGPT 语境里的 prompt。
- 日语参考音频可以用于中文 zero-shot，但跨语言稳定性一般，声音、口音、节奏都可能不理想。
- 中文目标文本通过 PowerShell 管道发送时曾变成 `?`，导致 GPT-SoVITS 返回 `请输入有效文本`。后续请求应使用 Python UTF-8 JSON 或 Unicode escape。
- GPT-SoVITS 并行推理在 RTX 3060 Laptop 6GB 显存上可能触发 CUDNN / ONNX Runtime memory allocation failure。稳定测试路径是重启 API 后使用 `parallel_infer: false`、`split_bucket: false`、`batch_size: 1`。
- C 盘空间曾低至约 `0.12GB`，导致运行环境非常脆弱。清理了 C 盘 Hugging Face / Torch / pip cache，释放约 `5.3GB`。后续所有模型、缓存、临时目录和生成物都应继续放在 D 盘。

对 roadmap 的影响：

这轮证明了“真实本地 voice clip 生成”可行，但还没有完成产品集成。下一步仍属于 roadmap 第 7 步：

> 把已验证的本地 GPT-SoVITS runtime 接入现有 Generation Bridge / selected clip generation / Preview Layer flow。

不要把下一步重新发明成新的 mock bridge、provider spike 或架构 gate。Adapter/API/provider wrapper 只能作为第 7 步的内部实现细节。

## 2026-06-21 - Preview Layer Before Real Audio

这一轮实现了已批准的 C hybrid lightweight preview layer，对应设计文档：

- `docs/superpowers/specs/2026-06-21-preview-layer-before-real-audio-design.md`
- `docs/superpowers/specs/2026-06-21-preview-layer-before-real-audio-design.zh.md`

已实现内容：

- 在右侧项目详情栏添加项目预览 surface：禁用播放按钮、fake waveform/status strip、preview counts、generation slots。
- 新增 derived generation-summary 数据，从现有 `AsmrProject` 纯派生预览计数与素材槽，不修改 `AsmrProject` schema，也不改变导出 JSON。
- Inspector 新增 selected-clip asset slot，Timeline 新增 compact generation-status signals。
- 保留左侧项目栏与右侧详情栏的独立折叠；`专注编辑` 仍会给 Timeline 释放空间。
- 本轮仍未接入真实播放、真实 waveform、真实 TTS/SFX/ambience 生成或后端任务队列。

验证覆盖：

- `npm.cmd run test --prefix apps/web`：8 个 test files / 62 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web`：通过。
- 浏览器验证使用 production server `npm.cmd run start --prefix apps/web -- --port 3011`，避开异常关机后 stale dev-HMR websocket。
- 1440x1000 desktop、`专注编辑`、左右独立折叠、Inspector 素材槽、字段级校验、无效导入、重置、导出下载、390x900 mobile overflow 均通过。
