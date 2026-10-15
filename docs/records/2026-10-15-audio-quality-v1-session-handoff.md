# 2026-10-15 会话交接

Date: 2026-10-15（Asia/Hong_Kong）；只读续接核查约09:33 HKT。

Route ID: 既有 Audio Quality V1；父阶段 in_progress，SFX paused。

Status: 本次交接整理完成；不代表父阶段全部完成。本记录及前一轮缓存清理文档保存在本地，尚未提交推送。

## 下一会话从哪里开始

工程：D:/CodexWorkplace/asmr_director。先读根 AGENT.md、[固定路线](../ROADMAP.md)、[项目管理规则](../PROJECT_MANAGEMENT.md)、[AI_HANDOFF 最新段](../AI_HANDOFF.md)。本记录为恢复快照，历史细节看 [项目留档](../project-archive.md)；不要另建竞争路线。

建议给下一会话的开场指令：先读 AGENT.md 和 docs/AI_HANDOFF.md 顶部最新交接及其会话记录，检查 Git 和3001当前身份，保留所有未提交改动，再接我的新要求。不要重复清理、重新生成或安装额外模型。

## 发布与工作树边界

| 项目 | 当前事实 |
|---|---|
| Branch | codex/voxcpm2-product-generation |
| 已推送 HEAD | 1f0d6516d5347b70289d13343c387667172767ce |
| Commit | feat: add parallel speech workspaces and safe paragraph confirmation |
| Remote | origin，https://github.com/128Ghe980/asmr_director.git |
| 发布范围 | 累计语音工作流及必要依赖，129文件；空间工作台未发布 |
| 暂存区 | 续接核查为空；本次不创建新提交/推送 |

[发布提交](https://github.com/128Ghe980/asmr_director/commit/1f0d6516d5347b70289d13343c387667172767ce) 的真实推送/远端一致收据：I:/AI/asmr-director-release/2026-10-15/release-verification.json。当前本地 HEAD 与其一致。

**不要还原或混入下一次语音提交的已有本地工作**：

- .gitignore、apps/web/README.md、apps/web/eslint.config.mjs、apps/web/tsconfig.json 的剩余空间工作台配置；
- apps/web/scripts/spatial_d/render.py、test_render.py；
- apps/web/src/components/studio/project-workspace-header.tsx；
- apps/web/src/lib/asmr/spatial-audio.ts 及两个测试文件；
- 未跟踪的 apps/web/src/app/api/spatial-studio/、app/spatial-studio/、components/spatial-studio/、lib/spatial-studio/；
- docs/THIRD_PARTY_RUNTIMES.md 的既有 Qwen 实验记录；
- apps/web/src/lib/asmr/candidate-acceptance.test.ts 显示 M，但当前 git diff 无内容变化，不能因此重置。

此外 docs/AI_HANDOFF.md、ROADMAP.md、project-archive.md 及两份2026-10-15清理/本次交接记录尚未提交。提交前需再次看 Git，不能 git add 全工作树。本次对上述既有文件做内容 SHA 保护核验，不修改其实现。

## 用户明确的产品约定

保留原来的短分句＋后文长生成取前部（long_text）及 clip，额外提供整段生成页签；曾经覆盖旧方式的原型已经撤销，不能恢复。AI 创意采用时同步创建 Short/Paragraph 两库，源文双向同步，但生成和采用结果、撤回、时序、分镜、混音相互独立。源文修改保留旧音频并标明失效；整段页重新生成受影响的整组。

短句页必须是真正的自然短句，整段切分采用同一组短句 ID。旧工程通过显式「切短句」保护修订后迁移，不在打开工程或切页时自动拆分。不能把旧完整录音冒充新第一句的录音。无对白镜头可插入左侧列表，有描述、时长、分镜，跳过TTS。时间线默认折叠、可展开。前端按钮应简洁一致。

双工作区最初实现有桌面/390px截图检查；之后时间线及识别跟进因既有浏览器URL安全限制，没有新增截图，不能借旧图声称这些跟进已视觉验收，不能绕过该限制。

## 当前3001如何恢复

本轮只读页面HTTP200，实际dist BUILD_ID为 IuS6dk38Xq9OZB0CRWvbQ；没有为写交接重启。启动脚本：

I:/AI/asmr-director-dual-workspace/2026-10-14/manual-text-confirmation/qa/start-production.ps1

该脚本的必要配置：

| 项目 | 值 |
|---|---|
| 服务来源 | http://127.0.0.1:3001/，保持此来源以保留 localStorage 工程库 |
| 主工程dist | D:/CodexWorkplace/asmr_director/apps/web/.next-confirmation-production |
| dist junction目标 | I:/AI/asmr-director-dual-workspace/2026-10-14/manual-text-confirmation/next-production |
| ASMR_CLIP_ASSET_ROOT | I:/AI/asmr-director-product-assets/clips/app |
| ASMR_VOICE_WORK_ROOT | I:/AI/asmr-director-voice-work |
| ASMR_VOXCPM2_PARAGRAPH_CLI_PATH | I:/AI/asmr-director-whole-script-compare/2026-10-11-tea/decoder-fallback/voxcpm2-cli-copy-fallback.exe |
| exFAT helper | I:/AI/asmr-director-dual-workspace/2026-10-14/manual-text-confirmation/qa/exfat-readlink-compat.cjs |
| NODE_PATH | D:/CodexWorkplace/asmr_director/apps/web/node_modules |

模型/配置/候选manifest/锁仍沿用原 D:/CodexWorkplace/asmr_director_runtime，部分资产/tmp已有链接至I，不要重复计数或声称这轮迁移了它们。helper 将 exFAT 对已核实普通非链接文件的 readlink EISDIR 规范为 EINVAL，不能省略；同内容源码已入库 apps/web/scripts/exfat-readlink-compat.cjs。旧实验根里的 decoder EXE仍在用，目录名旧不等于可删。

历史PID仅为当时快照；任何服务操作前重新核对监听、启动参数、任务和锁。旧runner若没有I素材根，将看不到5个新切片；回滚还须兼容新增manifest信息。不要仅因换会话而启动、停止或改端口，也不要覆盖浏览器库。

## 整段识别目前到底到哪一步

项目 asmr_planner_20261014_080645，原候选 vox_039ef5c01a374b4e95774aa68b4d2a86，原录音15.36s。trace：I:/AI/asmr-director-voice-work/long-text/9f662760-6b5b-4ed0-a900-e40c50ebb1d1。原音WAV SHA256：82ad9d03f0c2f01647351f494cc1dafe857363b1e12928fc82480e45acdae724。

| 原PCM范围 | 台词 / 当前证据 |
|---|---|
| 0–2.02s | 回来啦。实际最终ASR为「回来」，2/3；用户试听确认「啦」保留，人工文字确认仍待用户操作 |
| 2.02–5.17s | 我还没睡，就猜你快到了。字面匹配 |
| 5.17–8.97s | 先把外套脱了，雪都积在肩上了。保留既有雪/血内容警告，12/13 |
| 8.97–12.26s | 鞋也换了吧，别把寒气带进来。匹配；后侧整句坐/做的同音证据单独保存 |
| 12.26–15.36s | 过来坐，炉子边暖和。ASR「做/坐」差异，7/8；待试听确认 |

五片连续、无缺帧/重复，拼接PCM等于原PCM SHA256 5f9c0ba943fcec8c44a685257749e0f0b9e66ccaac664ec592ba88dde4168381。没有淡化、重采样、加速或增益处理发布原声。

按用户选的方案1，将已证明安全的切点与有限的3–9汉字粒子/单字同音同调差异分开；静音、双侧、词端点、时序和原PCM验证仍在。不能把漏字说成同音完全匹配，真实ASR与分数保留。POST /api/audio-candidates/[candidateId]/confirm-text 需要用户明确勾选，锁内核对同组全部候选、当前有序源文/演绎指纹、原音和切片PCM，原子保存独立 manualTextConfirmation receipt。仍显示 needs_confirmation，不伪造ASR全通过；采用需有效receipt。

新5条已保存，首候选 vox_b4021561c33e4e32bcbcbccdd9a7bada；文件候选status=ready，而整组checkStatus=needs_confirmation，这两个状态不可混同。09:36核查该候选仍无manualTextConfirmation，等待用户操作，没有生产自动确认或采用。旧99条完整，总104。09:33核查候选manifest SHA E2AE0CB74E0050A85453EC07F82935BBFE1AFA901CAB9189B5660D2B737EF047，与清理保护基线一致；I素材根210个WAV。原项目 asmr_20261008_134758 的原4段采用音频保持，原库核验 Short4/Paragraph0。下一会话不能替用户勾选或把隔离确认测试当生产结果。

首次真实probe在第四句右侧同音差处失败；修复后仅真实重查4/5，前三句按输入SHA复用同轮成功证据。两次probe合计6个分析请求，TTS为0；复用不是额外原生推理，复用placeholder analysis.wav也不是旧预处理音频字节。新候选发布journal已完成，不盲目重跑。整段「重新识别」使用绑定原完整WAV，不重新TTS，不覆盖原音，不自动采用；保存模式预算30分钟，旧long_text仍5分钟。

中文CTC/WhisperX对齐仅完成可行性评估：5800H/16GB/RTX3060 Laptop6GB可考虑有界串行试验，约1.28GB默认权重尚未安装，轻声精度、速度和峰值占用未实测。不能把评估当已部署或自动下载授权；新模型/缓存若以后获准放I。现有约4.82GB推理前内存门槛不降低。

## 清理结果与证据保留原则

用户授权的旧缓存清理已在01:19–01:21 HKT完成：49个精确叶目录、51,968文件、逻辑2.30GiB；I盘128KiB exFAT簇放大小文件开销，实测释放8.49GiB，结束可用13.91GiB。根目录和junction保留。planner-repair剩23份实际记录/脚本/截图133,626字节，原几百MiB主要为缓存，不是模型/MP3。

没有删除模型、EXE、原音、记录、完整build/tmp/实验根；当前生产和发布验证完整根均保护，3001及音频/manifest核验通过。执行journal已完成，**不要重跑清理脚本**；更多模型/WAV/ZIP/整目录清理不在本次范围。D盘当前只约75MB可用，大文件继续放I。旧全盘总占用是清理前快照，不能冒充当前数值。[完整清理记录](2026-10-15-audio-quality-v1-old-cache-cleanup.md)。

实验结论不是只存在零散目录：本仓库 docs/records 是集中结论/配方/听评记录，AI_HANDOFF和project-archive提供入口，原音/日志/构建等原始材料在I盘多个任务根。后续按精简方向组织：配方与参数、结论、少量已采用/问题样本和用户反馈即可；新版本多轮新生成用于验证当下质量，旧样本只支持精确复现旧问题。不要为留证再复制模型或所有生成结果，也不能因此擅自删除现存资产。

80汉字在本稿/普通女生原参考/当时引擎条件下最均衡，不是全局硬上限。40第一轮一段语气差，100第三轮一处尾部略尖；160/240/320有偏高快，温柔参考偏快/小待新参考。字数扫档为固定参考和prompt逐段直接生成完整A、原PCM连接，没有追加B/C或ASR取首句；这与仍保留的产品short long_text配方不同。[配方与交接](2026-10-13-audio-quality-v1-generation-method-handoff.md)、[40/80/100听评](2026-10-13-audio-quality-v1-40-100-and-disk-audit.md)。

## 证据索引、验证与剩余工作

| 位置 | 用途 |
|---|---|
| I:/AI/asmr-director-release/2026-10-15 | 实际发布树/commit/push/排除代码保护与测试日志 |
| 上述根的 cache-cleanup/ | 最终49项清单、operation-journal/cleanup-result complete、after-verification verified |
| 上述根的 session-handoff/ | 本次Git/文件SHA保护、页面/dist/manifest与文档链接检查；不复制模型/音频 |
| I:/AI/asmr-director-dual-workspace/2026-10-14/manual-text-confirmation/qa/ | 真实切分报告、原生切片、SHA复用、发布与部署收据；隔离确认模拟须与生产区分 |

发布树验证：Vitest1785 passed/3 skipped（130文件通过/2跳过）、Python152、完整TypeScript/源码ESLint/WASM Webpack构建通过；303处本地Markdown引用通过。Python用既有GPT/ASR环境的python.exe，最初系统Anaconda缺opencc的失败日志保留，不把它误读为最终失败。主工作树1821/4跳过包含未发布空间代码，不是发布树计数。发布源导出目录 D:/CodexWorkplace/asmr_director_release_verify/2026-10-15-speech-workspaces 共享node_modules；构建在I发布根 verify-build。

本次仅更新本记录、AI_HANDOFF、ROADMAP和project-archive；291处本地Markdown引用全部存在，git diff --check通过，既有29个本地文件SHA不变、索引为空/HEAD保持与3001只读检查通过。没有重跑模型或构建，没有新截图，没有额外删除或服务操作。独立只读交接审阅未发现发布/清理事实矛盾。

尚未做：用户对新候选的生产人工确认/采用；中文对齐真实试验；另一会话空间工作台发布；本地清理和交接文档提交推送。它们不是本次交接的自动续做任务。当前没有等待下一会话接管的后台发布/清理进程。下次先获取用户的新目标，沿固定Audio Quality V1路线继续。
