# AI ASMR Studio V0.1 DSL-First Design

## 背景

`docs/asmr导演早期设计.md` 将产品定位为“AI ASMR 导演台”，而不是普通的“AI ASMR 生成器”。核心差异是：用户拿到的不是一段黑盒音频，而是一个可编辑、可重生成、可导出的音声工程。

V0.1 的目标不是一次性完成完整音频平台，也不是先训练或深度接入多个模型。V0.1 要先定义稳定的工程语言，让后续的前端、后端、TTS、音效、混音、质检和导出都围绕同一份数据结构工作。

## 目标

V0.1 先验证一件事：

> 输入一句 ASMR 创意，能否生成一个结构完整、可展示、可保存、可重新加载的双耳音声时间线工程。

这个版本的核心产物是 `ASMR Project JSON` 和 `Timeline DSL`。音频资源可以先是占位状态，但数据结构必须能表达后续真实生成链路需要的信息。

## 非目标

V0.1 不做完整 DAW。

V0.1 不要求接入真实 TTS、真实 SFX 生成、真实双耳混音或真实 MP3/WAV 导出。

V0.1 不支持全类型 ASMR。第一条 demo 以“雨夜睡前陪伴”为主，后续模板基于同一套 DSL 扩展。

V0.1 不设计复杂协作、付费、用户权限、审核后台或商业化系统。

## 推荐路线

项目下一步采用 `C -> A -> B` 的路线：

1. **核心资产设计**：先定义 `ASMR Project JSON`、`Timeline DSL` 和 clip schema。
2. **产品体验原型**：用 mock 数据做创意输入、导演分镜、轻量时间线和 JSON 导出。
3. **技术闭环原型**：再接入真实 LLM、TTS、SFX、混音、质检和音频导出。

这条路线的原因是：Timeline DSL 是导演台的中枢。如果先写前端或先接模型，很容易让各模块各自维护状态，后续重构成本会很高。

## V0.1 核心资产层

V0.1 的核心资产是一个稳定的 `ASMR Project JSON`。它至少需要表达以下信息：

- 项目设定：标题、语言、目标时长、场景模板、角色设定、情绪曲线。
- 时间线轨道：人声、呼吸/轻笑、ASMR 音效、环境底噪、后期处理。
- clip 单元：开始时间、时长、文本、情绪、语气、声像、距离、音量、淡入淡出、生成参数、资源引用。
- 生成记录：TTS/SFX/mixing 使用的模型、seed、状态、失败原因、重试次数。
- 导出信息：项目 JSON、SRT、MP3、WAV、分轨 WAV 的目标结构。

V0.1 先以 JSON Schema 或 TypeScript/Python schema 的形式固化字段。真实模型可以晚点接，但 schema 要先足够稳定。

## Project JSON 概念结构

```json
{
  "project_id": "asmr_demo_001",
  "status": "ready_for_preview",
  "title": "雨夜睡前陪伴",
  "language": "zh",
  "duration": 300,
  "scene": {
    "id": "rainy_night_bedroom",
    "name": "雨夜陪伴"
  },
  "character": {
    "id": "voice_card_001",
    "role": "older_sister",
    "personality": ["gentle", "mature", "comforting"],
    "speech_style": ["soft", "slow", "close"]
  },
  "emotion_curve": [
    {"start": 0, "end": 60, "emotion": "gentle_intro"},
    {"start": 60, "end": 180, "emotion": "comforting"},
    {"start": 180, "end": 260, "emotion": "sleepy_whisper"},
    {"start": 260, "end": 300, "emotion": "fade_out"}
  ],
  "timeline": {
    "tracks": [
      {"track_type": "voice", "clips": []},
      {"track_type": "breath", "clips": []},
      {"track_type": "sfx", "clips": []},
      {"track_type": "ambience", "clips": []},
      {"track_type": "post_processing", "clips": []}
    ],
    "mixing": {
      "target_lufs": -18,
      "binaural": true,
      "master_limiter": true
    }
  },
  "exports": []
}
```

## Timeline Track 类型

V0.1 使用固定轨道集合，避免一开始做成任意 DAW：

- `voice`：主要台词。
- `breath`：呼吸、轻笑、气声等贴耳人声细节。
- `sfx`：被子摩擦、衣物摩擦、翻书、指尖轻敲等 ASMR 音效。
- `ambience`：雨声、房间底噪等长循环环境声。
- `post_processing`：后期处理配置，不一定表现为可听 clip。

Storyboard View 和 Timeline View 必须从同一份 `timeline.tracks` 渲染，不各自维护数据副本。

## Clip 概念结构

```json
{
  "id": "voice_012",
  "track": "voice",
  "type": "voice",
  "start": 78.5,
  "duration": 6.2,
  "text": "我就在你旁边，不用担心。",
  "emotion": "comforting",
  "style": "whisper",
  "pace": "slow",
  "volume_db": -12,
  "fade_in": 0.05,
  "fade_out": 0.2,
  "position": {
    "pan": -0.75,
    "distance": "close",
    "movement": "static"
  },
  "generation": {
    "status": "asset_pending",
    "model": "mock_tts",
    "seed": 12345,
    "temperature": 0.7,
    "retry_count": 0,
    "error": null
  },
  "asset": {
    "asset_id": null,
    "uri": null,
    "duration": null
  }
}
```

SFX 和 ambience clip 使用同一套时间、位置、音量、淡入淡出和生成状态字段，但不包含台词字段：

```json
{
  "id": "sfx_004",
  "track": "sfx",
  "type": "sfx",
  "sfx": "blanket_rustle",
  "start": 34.2,
  "duration": 2.1,
  "volume_db": -26,
  "fade_in": 0.2,
  "fade_out": 0.6,
  "position": {
    "pan": 0.65,
    "distance": "near",
    "movement": "static"
  },
  "generation": {
    "status": "asset_pending",
    "model": "mock_sfx",
    "seed": 9382,
    "retry_count": 0,
    "error": null
  },
  "asset": {
    "asset_id": null,
    "uri": null,
    "duration": null
  }
}
```

## 生成状态

V0.1 必须显式表达错误和等待状态，避免后续接模型时被迫补状态机。

项目级状态：

- `draft`：项目已创建，但还没有生成 timeline。
- `planning_failed`：创意无法转成项目设定。
- `timeline_invalid`：Timeline DSL 校验失败。
- `ready_for_preview`：timeline 可展示，但音频资源未必存在。
- `export_failed`：导出失败。

资产级状态：

- `asset_pending`：资源还未生成。
- `asset_generating`：资源生成中。
- `asset_generated`：资源已生成并可引用。
- `asset_failed`：资源生成失败。

V0.1 前端可以先展示 `asset_pending`，不需要真的生成音频。

## V0.1 视觉方向

V0.1 的界面方向采用 **Studio Console 作为底盘，少量吸收 Ambient Director 的氛围**。

这意味着页面首先应该像一个专业创作者工具，而不是营销页、玩具 demo 或普通后台表格。视觉重点是让用户感觉自己正在“导演一条音声工程”：能清楚看到分镜、轨道、声像、片段状态和导出结构。

### Studio Console 底盘

界面骨架应偏专业工作台：

- 深色或近深色主界面，降低长时间编辑疲劳。
- 左侧或顶部用于项目上下文和导航，中间区域用于导演分镜和时间线。
- 信息密度要高，但分组清楚，避免大面积空洞 hero 或营销卡片。
- 时间、轨道、clip、状态、声像位置要形成明确视觉层级。
- 控件应像工具，而不是装饰按钮；常见操作使用图标、segmented control、slider、select、toggle 等熟悉模式。

### Ambient Director 氛围

氛围只能作为增强，不作为页面主体：

- 可以使用细腻的雨夜、声波、微光、玻璃感或空间感暗示 ASMR 题材。
- 氛围应服务于“雨夜睡前陪伴”的 demo 语境，不遮挡文字和轨道。
- 避免大面积纯紫、纯蓝、纯渐变背景，避免页面变成一张漂亮但不耐用的海报。
- 不使用漂浮装饰球、过重光效或模糊背景来制造高级感。

### 视觉验收标准

V0.1 UI 至少需要达到：

1. 第一屏就能看出这是 `AI ASMR Studio`，并能看到分镜或时间线，而不是 landing page。
2. 用户能快速理解当前项目、当前时间线、当前选中片段和生成状态。
3. Storyboard 和 Timeline 看起来属于同一个创作工具，不像两个拼起来的页面。
4. 字体、间距、颜色和组件状态要有完整层级，不能只是默认 Tailwind 拼装。
5. 移动端可以降级为分镜优先，但文字不能溢出、按钮不能拥挤、轨道不能互相遮挡。
6. 页面可以漂亮，但漂亮来自布局、层级、细节和素材克制，而不是堆装饰。

## V0.1 最小页面

### 创意输入页

用户输入一句创意，并选择少量参数：

- 场景模板，V0.1 默认 `rainy_night_bedroom`。
- 目标时长，V0.1 推荐 3-5 分钟，但 mock demo 可以更短。
- 语言，V0.1 默认中文。
- 声音风格，V0.1 可先使用固定角色。

提交后输出 `Project Spec` 和 `Timeline DSL`。

### 导演分镜页

导演分镜页是 V0.1 主界面。它按时间顺序展示每个片段：

- 时间范围。
- 台词或音效名。
- 情绪。
- 语速或风格。
- 左/中/右耳位置。
- 距离感。
- 前后音效。
- 停顿。
- 生成状态。

这个页面要让用户一眼看懂：每一句话在什么时候出现，用什么情绪，从哪个耳朵出现，周围配了什么音效。

### 轻量时间线 / 导出页

轻量时间线按轨道展示 clip。V0.1 只需要：

- 展示固定轨道。
- 选中某个 clip。
- 查看 clip 参数。
- 展示资源状态。
- 导出项目 JSON。

真实播放、波形、MP3、WAV 和分轨导出可以在后续版本接入。

## V0.1 数据流

V0.1 的数据流是：

```text
一句创意
  -> Project Spec
  -> Timeline DSL
  -> Schema Validator
  -> Storyboard View
  -> Timeline View
  -> Export JSON
```

其中 `Project Spec` 和 `Timeline DSL` 是持久化对象。Storyboard 和 Timeline 都只是渲染视图，不拥有独立业务状态。

## 模块边界

### Project Planner

职责：把一句创意转成项目设定。

输出：标题、语言、时长、场景、角色、情绪曲线。

V0.1 可以用 mock planner 或固定样例实现，接口形状要接近未来 LLM planner。

### Timeline DSL Generator

职责：把项目设定转成 tracks 和 clips。

不负责生成音频，不负责混音，不负责导出文件。

### Schema Validator

职责：校验 DSL 是否完整。

至少校验：

- 必填字段存在。
- clip 所属 track 存在。
- 时间范围合法。
- duration 为正数。
- pan 范围在 -1 到 1。
- status 是合法枚举值。

### Storyboard Renderer

职责：把 Timeline DSL 渲染成导演分镜列表。

不修改底层 DSL。

### Timeline Renderer

职责：把 Timeline DSL 渲染成轻量轨道视图。

不修改底层 DSL。

### Export Adapter

职责：把项目导出为 JSON。

后续可扩展 SRT、MP3、WAV 和分轨 WAV。

## 验证标准

V0.1 完成后应满足：

1. 同一个 demo 创意能稳定生成结构完整的 Project JSON。
2. 每个 voice clip 都有文本、情绪、位置、距离、时间范围。
3. 每个 sfx/ambience clip 都有资源类型、时间范围、音量和 fade。
4. Storyboard 和 Timeline 都从同一份 DSL 渲染。
5. 用户能看懂“每一句话在什么时候、用什么情绪、从哪个耳朵出现”。
6. 项目 JSON 能被保存、重新加载、再次渲染。
7. 无真实音频资源时，页面仍能清楚显示 `asset_pending` 状态。

## 后续版本衔接

V0.2 可以在 V0.1 基础上增加 clip 编辑、单句重生成入口、音效替换和左右耳位置修改。

V0.3 可以接入真实分段 TTS、ASR 回听、响度统一、音色一致性检查和自动重试。

V0.4 可以加入角色声音卡、参考音频上传、授权确认和角色偏好。

V0.5 可以扩展分轨 WAV、SRT、封面 prompt、标题简介和创作者发布包。

## 结论

V0.1 的重点是先把“导演台的工程语言”做稳。只要 `ASMR Project JSON` 和 `Timeline DSL` 成立，后续模型、混音、质检和导出都可以逐步替换或增强，而产品层不会摇晃。
