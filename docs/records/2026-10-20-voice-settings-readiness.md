# 2026-10-20 — 刷新后首次音频生成误报引擎未就绪

用户在“雪夜归家”项目刷新后，首次点击“生成未生成”看到“当前人声引擎尚未就绪”。本轮修复属于 Audio Quality V1，父阶段继续进行中，SFX 暂停；整段识别切分继续按用户要求暂缓。

## 原因与修复

候选列表、工程存储与声音目录分别异步加载。候选先返回时，批量音频按钮已启用，但 `voiceCatalog` 仍为 null，保存的引擎和参考音也尚未恢复；批处理把“配置仍在加载”当作“引擎实际不可用”。目录中的本机识别依赖就绪探测可能扩大这个时间窗口，但不进行模型推理。问题属于页面初始化竞态，无需用显存不足解释。

新增声音设置 loading / ready / error 状态：目录 JSON 校验、短句及整段偏好恢复完成之后才 ready。三个批量音频按钮与单条人声生成在加载时等待，并显示“正在读取声音设置…”；失败时显示读取错误。生成处理函数在创建批任务、快照默认选项之前也作防御。分镜操作不依赖该状态，实际不可用的已选引擎仍报告原错误，不自动切换引擎或参考音。保存选项恢复逻辑、音频文件、采用结果、串行五秒间隔及视频包协议保持。

## 验证与部署

新增真实 StudioApp effects 集成测试 5 项：候选先于目录、响应头先于 JSON、首次直接从分镜页批跑恢复非默认参考/长文选项、目录失败、已知不可用引擎不回退、StrictMode 已取消旧响应晚到等场景。五项修前 2 failed / 3 passed，修后全通过；另增批量组件 loading / error 两项。最终相关测试共 **89 passed / 0 skipped**：readiness + batch + workspaces 30、其余五套 StudioApp 48、批量操作组件 11。完整类型、相关 ESLint、正式构建通过。独立只读审查未发现阻断问题。

2026-10-20 **15:10 HKT** 更新同一 3001 为 **GGbun_rDvvQE04KRojhnb**；`.next-voice-readiness-production` junction 指向 I 盘本轮 build。更新前复核无生成锁、模型/识别进程，且原监听确为 PID20572 的本项目 Next 服务；仅停止该服务。新监听 PID5112 / 启动器24184 是当时快照，之后需重查。页面、目录、新静态 manifest HTTP200；canonical 启动脚本已同步新 dist，原启动入口原字节备份保留，可回退。部署脚本包含旧 PID 的单次保护，不可直接重复执行。

Next 自动改动的 tsconfig / next-env 均恢复原字节。原 134 候选 manifest SHA `0EDD0530C4BC30EC523ABAA9654D81C4CBBDEDBFAD79ACFFE942065499060C92`、profile SHA `37E9404AB3690207ECB83C38E7892347082B7B952C8680052CAFB1E1C05317DC` 保持；相关源码冻结、范围外共享工作与实际提供静态文件身份核对见最终收据。

没有读取或操作用户浏览器工程存储，没有替用户生成音频、识别、采用或改参考。测试使用合成工程和桥接 mock，不是对“雪夜归家”的真实生成/视觉验收。此前浏览器工具初始化失败，本轮通过代码竞态复现、集成测试与正式服务 HTTP 验证，不宣称截图或听感验收。无新模型/依赖安装，无提交推送。

## 证据

仓库外根：`I:/AI/asmr-director-voice-readiness/2026-10-20/`。

- `audit/voice-readiness-initialization-audit.json`、`audit/fix-review.json`：独立根因与修复审查。
- `tests/readiness-before-fix.log`、`batch-actions-before.log`：原竞态红灯；`tests/final-readiness-batch-workspaces.log`、`tests/root-regression.log`、`tests/other-studio-regression.log`：最终 89 项，重复运行不重复计数。
- `tests/typecheck.log`、`tests/eslint.log`、`build/build-result.json`、`build/build.log`：静态检查、构建及配置字节恢复。
- `protection-before.json`、`source-frozen.json`、`deployment-verification.json`、`final-verification.json`：资料/源码、部署和静态内容核验。
- `start-production.canonical-before-readiness.ps1`：前一已验收 UI build 启动备份；`start-production.ps1` 为本轮入口。
