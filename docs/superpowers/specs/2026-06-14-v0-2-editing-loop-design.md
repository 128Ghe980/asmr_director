# AI ASMR Studio V0.2 Editing Loop Design

## 背景

V0.1 已经完成 Studio Console 原型：固定 demo project 可以通过 Timeline DSL 渲染到 Storyboard、Timeline、Emotion Curve 和 Clip Inspector，并支持导出项目 JSON。

V0.2 的第一步是把这个原型从“漂亮预览台”推进成“可编辑工作台”。本轮只做编辑闭环前半段：用户能在 Inspector 中修改当前 clip，修改结果同步影响 Storyboard、Timeline、Inspector 和 JSON 导出，并且页面能显示当前项目是否通过 schema 校验。

## 范围

本轮实现：

- StudioApp 内维护当前 project 的本地状态，而不是只接收只读 demo 数据。
- Clip Inspector 支持编辑选中 clip 的常用字段。
- 修改后所有视图从同一份更新后的 project 渲染。
- Export JSON 导出当前编辑后的 project。
- 页面显示 schema 校验结果；校验失败时显示可读问题列表。
- 保留 V0.1 的专业 Studio Console 视觉方向。

## 非范围

本轮不做真实音频播放、波形、拖拽时间线、真实 TTS/SFX、局部重生成请求、后端持久化、导入 JSON、撤销/重做、多人协作。

## 可编辑字段

所有 clip 共同支持：

- `start`
- `duration`
- `volume_db`
- `position.pan`
- `position.distance`
- `position.movement`

按类型额外支持：

- voice：`text`、`emotion`、`style`、`pace`
- breath：`breath`
- sfx：`sfx`
- ambience：`ambience`、`loop`

## 数据流

```text
initial demoProject
  -> StudioApp local project state
  -> selected clip lookup
  -> editable Inspector form
  -> updateClipInProject(project, clipId, patch)
  -> safeParseAsmrProject(project)
  -> Storyboard / Timeline / Inspector / Validation panel / Export JSON
```

Storyboard、Timeline 和 Inspector 仍然只渲染 project，不拥有自己的业务数据副本。

## 错误处理

编辑允许用户暂时输入会导致 schema 失败的数据，例如 duration 超出项目总时长。页面不应崩溃，也不应偷偷回滚。

实现方式：

- 更新函数只做不可变数据更新，不负责阻止非法值。
- validation helper 使用 `safeParseAsmrProject` 生成问题列表。
- UI 在项目有效时显示 `Project valid`。
- UI 在项目无效时显示问题数量和每条问题的路径与 message。

## 测试要求

新增单元测试覆盖：

- 更新 voice clip 文本后，原 project 不变，新 project 有更新值。
- 更新嵌套 position 字段后，只有目标 clip 改变。
- 找不到 clip id 时返回原 project。
- 校验 helper 能报告超出项目 duration 的 clip 问题。

## 验收标准

- 在页面中选择 voice clip，修改台词后 Storyboard 和 Inspector 同步显示新台词。
- 修改 volume/pan/time 后 Inspector 显示新值，Timeline 位置或宽度随时间参数变化。
- 输入非法 duration 时页面显示校验错误，不崩溃。
- Export JSON 导出的是编辑后的 project。
- `npm.cmd run test --prefix apps/web` 通过。
- `npm.cmd run lint --prefix apps/web` 通过。
- `npm.cmd run build --prefix apps/web -- --webpack` 通过。
