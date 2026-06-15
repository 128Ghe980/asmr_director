# AI ASMR Studio 项目留档

记录日期：2026-06-14

AI/上下文压缩恢复入口：`docs/AI_HANDOFF.md`

这份文档是当前项目的历史档案，用来保存我们已经聊好的产品判断、设计方向、实现进度和决策过程。

如果是新的 AI agent 接手，或者当前会话发生上下文压缩，应先读 `docs/AI_HANDOFF.md`。那份文件更短、更稳定，专门服务“快速恢复当前状态和下一步”。

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

## 后续版本衔接

- V0.2：可编辑时间线、clip 修改、局部重生成入口、音效替换、左右耳位置修改。
- V0.3：真实分段 TTS、ASR 回听、响度统一、音色一致性检查、自动重试。
- V0.4：角色声音卡、参考音频上传、授权确认、角色偏好。
- V0.5：分轨 WAV、SRT、封面 prompt、标题简介、创作者发布包。

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
