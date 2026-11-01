# 2026-10-30 新工程入库与保存容量修复

状态：完成。项目库存储修复已部署；新版通过真实 UI 导入，显示已保存，实际刷新后仍保留。

## 用户请求与实际问题

用户询问“39段是什么”以及项目列表中为什么没有新版。39是时间线中的20段台词和19段无台词表演，最终仍合成一个视频；每段另有同长独立音效任务，因此批跑为39主视频＋39效果音任务。它不是新增39个工程或要求39个不同场景。

上轮只交付完整JSON和批跑包，浏览器导入操作在执行前被中断，未入库。本轮通过真实页面“导入JSON→确认载入”载入同一完整交付文件，出现新版《万圣节夜游前的小小变装仪式》、20已采用/19无台词/20后处理；项目栏共有18项（17旧＋1新），但提示“本地保存不可用”。不能将内存载入当作持久保存成功。

代码核查：原项目库整体保存在localStorage；完整工程与设计/修订占用增长。旧同步载入还将读出旧库后的回写失败捕获成读取失败而返回示例。任务因此包括保存可靠性修复，保留全部旧工程，属于Audio Quality V1，无新顶层路线。合同见[中文](../specs/2026-10-30-project-library-storage.zh.md)和[English](../specs/2026-10-30-project-library-storage.en.md)。

## 范围与证据

源码变更仅项目库存储及相关界面调用、针对性测试。IndexedDB作为完整项目库主存储，旧localStorage来源保留，支持旧库迁移及无IndexedDB时的兼容路径；异步保存成功以事务提交为准。读取与回写失败分开处理，可读旧库不会因为配额不足回退成示例；串行写入并区分正在保存、已保存和保存失败。初次读取完成前不开放工程操作，等待保存期间的取消、切工程或新编辑不会被旧结果覆盖。

本次隔离发布叠加4个生产文件：`apps/web/src/lib/asmr/browser-project-storage.ts`、`project-library.ts`、`project-summary.ts`，以及`apps/web/src/components/studio/studio-app.tsx`。8个测试文件为同目录的`browser-project-storage.test.ts`、`browser-project-storage.idb.test.ts`、`project-library.test.ts`、`project-summary.test.ts`，以及`studio-app.batch.test.tsx`、`studio-app.readiness.test.tsx`、`studio-app.post-processing.test.tsx`、`studio-app.storyboard-review.test.tsx`。完整逐文件SHA见[release-overlay.json](I:/AI/asmr_director/qa/project-library/2026-10-30-storage/release-overlay.json)。

源码根为`D:/CodexWorkplace/asmr_director`，唯一外置数据根为`I:/AI/asmr_director`。隔离发布目录`.local/releases/project-library-storage/apps/web`复制原活动`performance-pacing`（build `R7R1RdTxRIJFu2Ught-nO`）的409个源文件，仅叠加本轮相关文件；排除原`.next`、`node_modules`及tsbuildinfo，依赖junction和`.env.local`沿用原配置。旧release、所有非overlay源文件和工作区其他未提交功能均未混入或修改。

QA为`I:/AI/asmr_director/qa/project-library/2026-10-30-storage/`。`import-before-fix.png`记录保存失败界面，`ui-before-projects.json`记录18项可见项目及39段核对；`release-prepare.json`和`service-before.json`记录源副本、文件哈希及服务身份。没有读取或注入浏览器隐藏存储，导入和刷新通过实际UI执行。

原万圣节交付JSON与ZIP保持，本轮不调用DP/TTS/ASR/H3，不重复生成任何内容；No-sleep暂停保持。

## 验证与部署

- 最终隔离回归18文件、216项全部通过，涵盖旧库读取、迁移、备份选择、串行写入、原生IDB事务完成/中止/打开失败，以及采用、后处理、校对和工程切换。12个overlay文件lint退出0、零警告；完整Webpack/TypeScript构建退出0。最终证据为`isolated-tests-final2-result.json`、`isolated-lint-final2-result.json`、`isolated-build-final2-result.json`及各自日志，[release-verification.json](I:/AI/asmr_director/qa/project-library/2026-10-30-storage/release-verification.json)核对源码哈希和构建来源。初轮异步测试时序失败、后续修复与警告清理记录保留，不伪称首次通过；未重跑整站所有测试。
- 2026-10-30 23:03 HKT完成3001切换，新build `OjWEvWXsfoGeJ_UBk30pg`、启动父PID39496。启动入口仍为`I:/AI/asmr_director/service/2026-10-16/start-production.ps1`，仅应用位置改为本次隔离release。旧服务身份按PID、创建时间和完整命令复核后停止；[activation.json](I:/AI/asmr_director/qa/project-library/2026-10-30-storage/activation.json)记录实际切换，原启动脚本保存在同QA的`start-production-before.ps1`。
- 新服务首页HTTP200，8个静态资产与构建字节/哈希一致，7个人声参考存在，抽查2条原始及其2条后处理WAV共4份与磁盘字节完全相等。见[service-verification.json](I:/AI/asmr_director/qa/project-library/2026-10-30-storage/service-verification.json)。均为只读请求，没有触发生成。
- 新版重新通过页面“导入JSON→确认载入”保存，随后真实刷新。23:05 HKT页面仍为《万圣节夜游前的小小变装仪式》并显示已保存；项目列表18项（17旧＋1新）、20/20已采用人声、19无台词、39设计、20/20后处理均在，39段可见文本逐项等于完整交付源。全部旧项目标题保留。见[ui-after-reload.json](I:/AI/asmr_director/qa/project-library/2026-10-30-storage/ui-after-reload.json)和[刷新后截图](I:/AI/asmr_director/qa/project-library/2026-10-30-storage/import-saved-after-reload.png)。

## 保留项与恢复

完整`Halloween-new-project.json`和`Halloween-new-ASMR-batch.zip`保持；本轮0DP/TTS/ASR/H3，无新内容、音频或批跑生成，无提交推送。此次证明工程已入库并跨刷新保留，不改变原交付中“夜游前”发音疑点和H3成片待用户目标机运行的边界。原内容证据见[万圣节生产记录](2026-10-30-halloween-pantomime-production.md)。

最终验收入口为[final-acceptance.json](I:/AI/asmr_director/qa/project-library/2026-10-30-storage/final-acceptance.json)，汇总实际部署、刷新保存、截图及原完整JSON/ZIP哈希保持。`release-verification.json`中的`built_not_deployed`是构建完成时的历史状态，最终部署状态以`activation.json`、`service-verification.json`、`ui-after-reload.json`和最终验收为准。

恢复优先读本记录及上述最终证据。当前服务应使用本次release；不要从脏工作区全量替换服务，也不要为重新入库重跑生成helper。旧启动脚本和旧release均保留，但旧版本只读旧存储，回退前应先通过UI导出需保留的当前工程，不能将服务回退等同于新存储迁移回旧版本。

同步`docs/ROADMAP.md`当前优先级进展、`docs/AI_HANDOFF.md`最新状态、`docs/project-archive.md`及原万圣节记录追加。沿用项目单一路线，Audio Quality V1继续，No-sleep和其他暂停状态不变；没有创建第二套路由文件。
