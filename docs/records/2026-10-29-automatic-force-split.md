# 自动执行可用的强制切分

日期：2026-10-29。所属路线：Audio Quality V1，其他 SFX 实验及模板质量优化仍暂停。

## 用户要求与行为

用户发现最后通常都会点击强制切分试听，因此要求出现可强制切分的候选时直接执行。

- 当前工程/语音工作区的候选加载后，自动处理符合原规则的长文或整段 `review` 候选。包括新生成、批量完成和重新打开时加载的历史候选，不要求选中该段。
- 串行复用现有强制切分接口，等待人声、批量、分镜、后处理和参考导入等操作空闲；只新增候选，不自动采用、不覆盖原音，也不自动删除候选以腾容量。
- 本次页面会话中同一源只自动尝试一次；列表中已有以它为源的强切结果时不重复生成。失败后继续其余候选，失败源可手动重试。
- 自动切分不因选择另一段中断；切换工程/短句整段模式会取消并拒绝迟到响应。原手动操作的选段取消语义保留。
- 新增全局自动切分状态与取消按钮。显式取消暂停当前工作区的自动队列，手动重试或新一轮生成产生候选后恢复；取消的原源不在同一次页面会话中自动重试。
- 尝试/暂停记录只存在当前页面实例内；重新加载页面后仍未成功的候选可再次自动尝试。原文案、上下文、结果归属和切分凭据校验保持。

English contract: Automatically and serially force-split eligible saved review candidates in the active project and speech workspace when other operations are idle. Preserve source audio and adopted audio; publish new candidates for listening only. Skip attempted sources within the page session and sources with an existing derived result. Explicit cancellation pauses the workspace queue until manual retry or a new generated candidate; project/workspace changes abort and reject late results. Selection changes do not abort automatic work. No alignment algorithm, TTS, adoption policy, or capacity cleanup change.

## 实现范围

- `apps/web/src/lib/asmr/voice-candidate-auto-split.ts`：共享可强切规则、当前文案检查和队列候选选择。
- `apps/web/src/components/studio/studio-app.tsx`：自动队列、去重、暂停/恢复、跨选段运行和全局取消状态。
- `apps/web/src/components/studio/voice-generation-panel.tsx`：手动入口复用同一资格判断，保留失败后重试。
- `studio-app.force-split.test.tsx`：自动短句/整段、串行、生成忙等待、刷新、取消、错误、过期回包等覆盖。
- `studio-app.recheck.test.tsx`、`studio-app.manual-confirmation.test.tsx`：更新旧的禁止任何 POST 断言，只允许符合条件的自动强切一次，继续禁止重新识别/TTS。

## 验证与发布

QA 根：`I:/AI/asmr_director/qa/force-split/2026-10-29-auto/`。隔离源码 `.local/releases/automatic-force-split`，干净 HEAD `0c6f8b1405543882088c464f4b93ea4e86fb040f` 加本轮六文件，28 项范围外工作哈希保持。

初次相关测试为 298 通过、3 失败、1 条件跳过；三失败是旧用例禁止所有 POST，与本轮自动行为冲突，首次日志 `related-tests.log` 保留。修正两份测试夹具后，同组最终 **18 文件、301 通过、1 条件跳过**，日志 `related-tests-final.log`。包括 StudioApp 全部相关交互、候选面板、候选/强切/确认 API 和强切实现测试。独立审查未发现阻断问题。

生产代码构建通过（Webpack / TypeScript），build `6i9y2gc1uL9nGDjYlbvGT`。六文件 ESLint 退出 0，只有原有 `ensureSpeechWorkspaces` 未使用导入警告。此轮不生成真实 TTS/ASR/H3，不声称切分音质改善；仅改变原强制切分的触发时机。

已切换本地 3001，活动源码 `.local/releases/automatic-force-split/apps/web`，Node PID 19492、启动父进程 37260。入口仍为 `I:/AI/asmr_director/service/2026-10-16/start-production.ps1`，仅工作目录切到新隔离版本，原入口在 QA `start-production-before.ps1` 可回退。首次 HTTP 早于服务 Ready 返回连接拒绝，Ready 后完整核验通过：页面 build、8 个 JS/CSS、7 个参考目录、2 条日语参考 WAV、6 文件源码一致和 28 项范围外哈希保持。见 `activation.json`、`service-verification.json`；3041 预览随后停止。

本轮未新增 Git 提交/推送，未重跑整站全量、真实模型或浏览器交互验收。行为证据来自真实 React 组件的 StrictMode 集成测试、接口测试以及生产 HTTP 核验。文档同步 `ROADMAP.md`、`AI_HANDOFF.md` 与 `project-archive.md`；顶层路线不变。
