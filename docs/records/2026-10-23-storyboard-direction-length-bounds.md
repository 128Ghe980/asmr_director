# 分镜文字接收上限与保存边界统一

日期：2026-10-23。所属路线：Audio Quality V1；本修复完成，父阶段继续进行，SFX 暂停。未新增路线、提交或推送。

## 原因与范围

用户重做「雪夜归家」24 镜时报告成功 14、失败 10。上次新增的诊断日志本次保存了两份完整模型回复：voice_005 的 visual 为 337 字符，被生成层 320 拒绝；voice_022 的 action 为 198 字符，被 180 拒绝。它们均只有四个合法文字字段，且都在工程已有保存上限内。voice_022 实际是脚本第 21 镜，不能把旧 ID 后缀当镜号。

按旧包第 1、11 镜独立、其他连续的模式，两次直接失败可能分别连带后面 5、3 镜，合计 10；这是旧包模式与现有队列行为的推断，并未读取当前浏览器里的八条具体失败消息。不能把所有失败都称为日志直接观测，也不能由格式接受推断视频动作质量。

## 实现

- 单镜生成和整批校对的 visual/action/camera 接收上限直接复用 `ClipVideoStoryboardSchema` 的 800/600/400；title 120、ambientSound 600 保持一致。
- 320/180/120 改为简洁写作建议。回复不因超过建议而拒绝，不截断、不重写、不自动修复或重试。
- 保留 trim 后非空、真实存储上限、未知字段与 metadata 拒绝、来源/原音/引用保护、取消及单次 API 调用。校对稀疏补丁与镜号映射保持。
- H3 渲染、导出 prompt.txt 以及便携 runner 原本完整传递文字，没有这组旧短上限，无需修改包协议或运行器。

代码仅改两个 service 和各自测试；中文/英文分镜 spec 与现有三入口同步。相对上次部署树，其他 apps/web、tools 内容完全相同；另会话 27 项工作保留且不部署。

## 验证

- 选定独立快照的六文件测试：149 通过、0 失败、0 跳过，包含生成 47、校对 37、video-plan 46、校对领域 9、两个路由 7+3。先前单独 84 项包含在 149 内，不能相加。
- 完整 TypeScript、四文件 ESLint、2048 MiB 堆限制下独立串行生产构建均退出 0；未重跑整站测试。
- 原日志离线回放：两次单镜生成和一次整批校对，3 次本地模拟请求、0 真实 API。两份文字逐字段与原日志全文一致，元数据保持；校对应用到只读历史副本后 24 镜 current，工程/config/两份被读取 WAV 哈希不变。
- 编译产物隔离 HTTP：两份真实回复和整批校对均返回 200、原文不变；visual 801/800 与伪造 audio 字段返回 502。五次操作各只有一次本地模拟请求，保持 no-store；0 真实模型调用。
- 独立只读审查未发现阻断问题。未声称新一轮真实 24 镜批跑、模型动作质量、远端 H3 或浏览器视觉验证。

## 部署与保护

06:37 HKT 更新 3001：build **Ju3OhO7xM_P4a6GlQrMGQ**，监听 PID 37868，替换 19776；启动器 PID 34120，仅为部署时快照。源码 `D:/CodexWorkplace/asmr_director_release_verify/2026-10-23-storyboard-bounds/apps/web`，dist `.next-storyboard-bounds`。规范启动脚本 `I:/AI/asmr-director-service/2026-10-16/start-production.ps1` 已同步，原脚本在证据目录保留；音频引擎与素材路径不变。旧部署脚本 PID 保护已过期，不应直接复用。

页面 HTTP 200、7 个实际服务 JS 字节/SHA、API 已配置与三个 POST-only 路由 GET 405 验证通过。332 个生产素材文件 size/mtime 未变；没有浏览器工程写入、用户成功分镜重做、真实 TTS/ASR/H3 或真实 API 调用。HEAD 与实际暂存区保持。

证据根：`D:/CodexWorkplace/asmr_director_qa/storyboard-bounds-2026-10-23`。重点文件：`exact-rejected-replies.json`、`replay/verification.json`、`vitest-results.json`、`checks-result.json`、`build-final.json`、`preview-verification.json`、`deployment-verification.json`、`source-verification.json` 与最终 `verification.json`。最终文档刷新仅允许改变文档，apps/web 树固定为 `f060cb627cb9cefdc58b0a9ff7aa63e2b8fac113`。

刷新页面后可以使用原有补缺或单镜生成入口继续操作；不自动替用户重跑当前工程。格式错误、非空要求或真正超过保存上限仍可能正常报错。
