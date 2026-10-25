# 无对白镜头卡片视觉区分

日期：2026-10-23；状态：本项完成。父阶段 Audio Quality V1 继续进行，SFX 暂停，顶层路线不变。

## 目的与实现

用户反馈无对白镜头与台词难以区分。短句、整段工作区现统一使用淡紫渐变卡片、左侧强调线、胶片图标、常驻「无对白镜头」标签和时长。选中状态加强边框，详情标为「画面与环境声」，避免把无对白误表达为静音。短句标签可换行，整段操作区也保留窄栏换行。

仅修改 `script-editor-panel.tsx`、`paragraph-script-list.tsx` 的展示；原选择、编辑、排序、分镜、镜头连续性、时长及删除处理保持。没有 API、工程格式、音频处理或视频批跑器变更。

English: Silent shots now have violet gradient cards, a left accent, film icon, persistent type and duration labels in both speech workspaces. Selection is visually stronger, and details describe visuals and ambience. This is a presentation change; existing editing and generation behavior remains unchanged.

## 验证与交付

- 选定源码快照运行原有 3 个编辑/工作区测试文件：32 通过，0 失败、0 跳过；完整类型检查、相关两文件 ESLint、串行 Next 构建通过。
- 用真实组件 SSR、实际生产 CSS、自有合成数据做隔离 headless Chromium 检查：560/350 像素左栏 × 短句/整段 × 无对白/对白选中，共 8 张截图；未发现横向滚动或控件越界。人工查看截图确认渐变、标签和选中样式生效。这不代表用户当前工程或整站浏览器流程验收。
- 隔离 3107 页面及 7 JS/1 CSS 与构建 SHA 一致；3001 更新后页面 200、7 个实际服务 JS 与构建一致，API 配置和既有路由检查通过。
- 16:17HKT 更新 3001，build `fpr53mPMdamym3uwQBPhs`，listener PID22456；启动脚本指向 `D:/CodexWorkplace/asmr_director_release_verify/2026-10-23-silent-card-style/apps/web`，dist `.next-silent-card-style`。旧配置备份保留于本轮 QA 目录。
- 重启前快照的 356 个生产文件 size/mtime 保持；27 项另会话改动排除且原字节保留。未调用真实模型、操作浏览器工程存储、提交或推送。

证据目录：`D:/CodexWorkplace/asmr_director_qa/silent-card-style-2026-10-23`。主要收据：`verification.json`、`source-verification.json`、`deployment-verification.json`、`visual/visual-qa-results.json`；8 张截图在 `visual/`。最终树/HEAD/索引/范围外字节检查见 verification.json。

## 文档同步与边界

同步 `docs/ROADMAP.md`、`docs/AI_HANDOFF.md`、`docs/project-archive.md`。没有新顶层阶段，不新增重要产品规格。没有重跑整站测试、真实音频生成或远端视频执行；本轮验证覆盖卡片显示及相邻编辑行为。
