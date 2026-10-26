# 参考模板版本发布与会话交接

日期：2026-10-26（Asia/Hong_Kong）。用户要求「记录一下推一版，我准备交接给下一个会话」。归属固定路线 Audio Quality V1；本轮功能与修复完成，该阶段仍进行中，其他 SFX 模型工作继续暂停。沿用项目既有 `ROADMAP.md`、`AI_HANDOFF.md` 和历史记录体系，不增加第二份路线。

## 版本范围

发布分支为 `codex/voxcpm2-product-generation`，上一远端提交 `05ebb290fb83102da1f0f81ee7bd5cebf7d5052d`。本版包含两次实现工作的代码、测试、中英规格及交接文档：

- 首个参考模板「禁令下的秘密交易」：可编辑 Prompt、场景、八个节拍、连续性与逐段导演说明。模板随策划草稿、工程采用、JSON、版本和双语音工作区保存，进入分镜生成与整批校对。当前主题和场景优先于模板原地点与道具；导演说明按可靠台词匹配，不按行号套用。
- 创作设定使用模板选择器；右侧模板、Prompt、场景/分镜、节拍全部默认折叠。前端与文案下载删除分析依据，前端不加入防御性文案或开发提醒，规则保存在 `AGENT.md`。
- 重复开场来自 `PLANNER_SEMANTIC_GUIDANCE` 每次注入的完整「回来啦。我还没睡，就猜你快到了。」示例。删除固定对白和家庭场景示例，开场按当前主题与角色生成。没有自动改写用户保存稿件。
- 参考声音工具栏可收缩并保持单排；参考试听使用 compactControls，静音在更多菜单。移除遮住自身关闭入口的文案设置浮层，文案操作改为正常布局内开关；背景/角色编辑归场景页，场景同步与 4000 字符合同统一。

功能来源清单为 `ui-fixes/source-manifest.json`：32 个代码/测试文件，其中 `planner-semantic.test.ts` 与上一提交相同，实际代码/测试差异为 31 文件。另显式加入 `AGENT.md`、三份路线/交接/归档文件、三份本轮记录及两份中英规格。完整暂存清单留在本次 QA `selected-files.json`；没有全量暂存工作区。

## 使用与分析边界

目前是整理好的内置模板目录，未实现任意视频上传自动分析。源视频 `I:/temp/asmr参考样例/助眠禁止.mp4` 只读且未上传；派生抽帧、测量和验证结果保存在本项目 QA。原片是香水禁令下的秘密推销，依据每两秒抽帧与片内字幕整理；ASR 因内存不足未完成，不视为完整听辨。源视频 SHA256 为 `05b25305de6fef20b2b89dc7d7073b18391ffcea98d6ae27a166dfe3289c8ba7`。

选择模板只更新创作设定并保留现有稿件。「载入中文示例稿」载入预写十四段《今晚的风替我们保密 · 中文示例》，可撤回，不调用模型；默认 180 秒是写作目标。「生成/重新生成策划稿」才调用选定模型，后续音频时长取真实生成结果。上述分析和实现边界仅用于开发交接，不加回前端。

## 验证证据

证据根：`I:/AI/asmr_director/qa/reference-templates/2026-10-26/`。

- 初版功能：17 文件、348 项相关测试通过，类型、23 文件 lint、独立构建及真实浏览器通过；详情见[初版记录](2026-10-26-reference-creative-templates.md)。
- 最终修复：策划 UI/场景/保存 7 套 97 项，最后文案调整 3 套 28 项，参考播放器/生成/导入 3 套 113 项，Provider 37 项，模板/工程采用/场景/分镜整合 5 套 135 项通过。分组有重叠，不相加；未执行最终整站全量测试。32 文件 lint、包含完整 TypeScript 校验的最终构建和 diff check 通过，见 `ui-fixes/verification.json` 与日志。
- 真实浏览器：1280×720 时声音工具栏宽 364px、进度条 70px；1768×1252 时工具栏 566.33px、进度条 123.64px，均无横向溢出。项目栏、试听更多菜单和文案操作开关已检查；11 个模板 details 初始全部关闭，分析依据未渲染。截图与尺寸在 `ui-fixes/`，本次发布复用这些证据，没有声称重新操作浏览器。
- 原用户寒潮/机器人管家设定真实请求一次 `deepseek-v4-pro`，首句「外面风声越来越大了。」，全稿不含旧首句。初版另有两次策划业务请求和八次分镜请求；分镜使用合成时长夹具。各自上游调用边界见原记录，不能把业务请求数当精确计费调用数。
- 全部上述工作未生成 TTS/H3，未验收真实视频或音质。本次发布仅做源码/暂存范围、服务 HTTP/静态资源及远端核对，新增模型调用为 0。

本机原生 SWC 绑定仍有已有警告，已验构建使用回退完成，不把警告称为已解决。主机内存紧张，后续大型测试和构建应串行执行；不要把初期 OOM 日志当通过结果。

## 当前服务与发布回执

- 页面：`http://127.0.0.1:3001/`；build `S5qsm3ifzUnsbyExv-lh_`。
- 已验源码：`D:/CodexWorkplace/asmr_director/.local/releases/reference-templates-ui/apps/web`，来自干净 `05ebb29` 加明确功能文件；仅隔离构建配置限制一个 worker。
- `.next` 指向 `I:/AI/asmr_director/cache/build-cache/reference-templates-ui`，依赖复用主工作区 node_modules。
- canonical 入口：`I:/AI/asmr_director/service/2026-10-16/start-production.ps1`。
- 本次交接检查发现 3001 没有监听进程，随后通过 canonical 脚本恢复同一构建，未重建、未修改启动配置。页面及 `/api/planner` 返回 200，页面实际引用的 8 个 JS/CSS 与已验构建逐字节 SHA256 匹配。停止原因未确定；PID 以实时查询为准。
- 恢复日志：`I:/AI/asmr_director/service/2026-10-26/reference-templates-handoff.stdout.log` 和 `.stderr.log`。
- 本次发布证据：`I:/AI/asmr_director/qa/reference-templates/2026-10-26/publication/`，含 `precommit-verification.json`、`selected-files.json` 和 `publication.json`。最后一份记录实际提交 SHA、远端 SHA、分支及发布后的服务/工作区核对。Git 和该回执为发布事实来源；此前记录的「未提交推送」均为当时状态。

## 留给下一会话

先读 `AGENT.md`、`docs/ROADMAP.md`、`docs/PROJECT_MANAGEMENT.md`、`docs/AI_HANDOFF.md`、`docs/STORAGE.md`，再查当前 Git 状态与最近提交。源码只用 `D:/CodexWorkplace/asmr_director`，外置数据统一在 `I:/AI/asmr_director` 的既有用途目录；不向用户输入目录 `I:/temp` 写生成物。

28 个范围外文件保留且不在本次提交：已有 spatial-studio/API/页面/组件/库、空间音频与 Python 渲染修改，以及 `.gitignore`、web README/eslint/tsconfig、`project-workspace-header.tsx`、`candidate-acceptance.test.ts`、`THIRD_PARTY_RUNTIMES.md`。精确路径及 SHA 在 `ui-fixes/unrelated-work-before.json`。它们属于此前未完工作，不要清理、顺带提交或复制进正式服务；此次发布后的工作区有意仍脏。

按用户下一步指令接续；固定路线仍为 Audio Quality V1。现有 H3 原生触发音包在 `I:/AI/asmr_director/artifacts/h3-asmr/H3-ASMR-12-custom-duration.zip`，目标 ComfyUI 机器真实批跑与试听仍待完成。任意视频自动分析及更多内置模板未在本版实现，不新增顶层路线关卡。没有重写用户当前工程、已采用音频或分镜。
