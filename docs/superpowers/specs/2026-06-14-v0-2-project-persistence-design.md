# AI ASMR Studio V0.2 Project Persistence Design

## 背景

V0.2 已经支持在 Inspector 中编辑 clip，并让 Storyboard、Timeline、Inspector、Validation Panel 和 Export JSON 共享同一份本地 project state。

下一步要补齐项目闭环：用户刷新页面后不丢编辑，能从 JSON 载入项目，能回到原始 demo，并能看清当前项目是否有未保存到初始状态的修改。

## 范围

本轮实现：

- 自动把当前 project 保存到 `localStorage`。
- 页面加载时从 `localStorage` 恢复最近一次 project。
- 支持粘贴 JSON 并导入。
- 导入前使用 `AsmrProjectSchema` 校验。
- 导入失败时显示错误，不替换当前 project。
- 支持 Reset Demo，清空本地保存并恢复到内置 demo。
- 顶部或主界面显示 dirty / restored / valid 状态。

## 非范围

本轮不做文件上传、不做云端保存、不做多项目列表、不做版本历史、不做 undo/redo、不做协作、不做导入音频资产。

## 数据流

```text
initial demoProject
  -> loadSavedProject(storage)
  -> StudioApp local project state
  -> autosaveProject(storage, project)
  -> JSON paste/import
  -> parseImportedProject(text)
  -> valid project replaces current state
  -> invalid import returns errors and keeps current state
```

## UI 设计

新增一个 Project Controls 面板，放在中间栏的 Validation Panel 附近：

- 状态行：`Edited` / `Demo` / `Restored from browser`。
- `Import JSON` textarea，用于粘贴项目 JSON。
- `Load JSON` 按钮，校验成功后载入。
- `Reset Demo` 按钮，恢复内置 demo 并清除本地保存。
- 导入错误区域，显示 JSON parse 错误或 schema issue。

顶部仍保留 Export JSON。Export 导出的永远是当前 project state。

## 存储策略

- localStorage key: `ai-asmr-studio:v0:project`
- 只存 project JSON 字符串。
- 浏览器环境不可用时不报错，回退到 demo project。
- 如果 localStorage 中的 project 无法解析或 schema 失败，忽略它并显示 demo。

## 测试要求

新增单元测试覆盖：

- `parseImportedProject` 能解析合法 project JSON。
- `parseImportedProject` 对非法 JSON 返回错误。
- `parseImportedProject` 对 schema 不合法 JSON 返回 issue。
- `loadSavedProject` 能读取合法保存值。
- `loadSavedProject` 遇到无效保存值时返回 fallback project。
- `serializeProject` 输出可再次解析的 JSON。

## 验收标准

- 编辑台词后刷新页面，编辑内容仍在。
- 点击 Reset Demo 后恢复原始 demo，刷新后仍是原始 demo。
- 粘贴合法 project JSON 后页面载入该 project。
- 粘贴非法 JSON 后页面显示错误，并保留当前 project。
- Export JSON 仍导出当前 project。
- `npm.cmd run test --prefix apps/web` 通过。
- `npm.cmd run lint --prefix apps/web` 通过。
- `npm.cmd run build --prefix apps/web -- --webpack` 通过。
