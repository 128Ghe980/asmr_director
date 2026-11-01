# 近距离互动：对镜空手表演开发记录

- 日期：2026-10-29 开发与真实 DP 实测；2026-10-30 完成部署及导出验收。
- 状态：`done`（本次空手对镜模板、文本语义及产品链路）；最终 H3 成片视听未验，不代表一般导演质量全部通过。
- 路线归属：[docs/ROADMAP.md](../ROADMAP.md) 的 Audio Quality V1；不新增路线 ID 或顶层阶段。
- 规格：[中文](../specs/2026-10-29-camera-pantomime.zh.md) / [English](../specs/2026-10-29-camera-pantomime.en.md)。
- QA 根：`I:/AI/asmr_director/qa/reference-templates/2026-10-29/pantomime/`。

## 用户意图与边界

用户确认“剧情说整理领子，画面是角色对镜头做整理动作，手里及目标位置实际没有东西”，要求修改并反复检查 DP 描述。触发问题是此前万圣节视频出现无头衣领、单个人脸等实体。此次只纠正该模板的演出合同及受其影响的生成、校对、导出链，不恢复此前暂缓的自然闲聊、所有物理状态连续性或一般生成质量优化。

无万圣节的 No-sleep/助眠禁止生产仍停在 RAM 条件不足、无成功新 TTS 的既有状态；本轮不重启、不重试或改变其资源保护。不改用户输入参考视频、已交付工程、旧音频及既有视频包。

## 已实施

1. 近距离互动模板 v3 显式保存 `visualPerformance: "pantomime"`。新能力按快照字段启用，不按 ID 猜测；旧快照和其他模板保留原行为。旧模板演示保留物理任务版本，新模板演示采用对镜空手任务。
2. 创意生成与改写将剧情任务转为 S1 空手手势，保留自动无台词时间。镜头固定、完整人物同框，以镜头上/下/左/右坐标定位；不生成听者身体、目标衣物、工具、透明或隐形实体，也不转为整理 S1 自己。
3. 画面声音设计覆盖有声段、短旧段与长无台词段。邻段原文及动作声音意图保留，邻段已生成 `storyboardContext` 从新模式输入移除；前镜只用于终态衔接，最终消息再次强调当前任务及声音意图。
4. 长段以全段索引明确起始、持续及收尾阶段，跨窗口不重启，只有最后一块完成整段收尾。既有分块数量、时长、音轨职责保持。
5. 拟音可模拟当前手势的材料触感；独立 ASMR 素材画面只供取音，不能向主画面补材料或目标。纯凝视保持安静；不编呼气、吹气、叹气或呼吸表演。
6. 整批校对增加同一模式分支，移除实体交接示例、强制听者移动和空手不应发声的冲突。修改保持来源、台词、时长、引用模式、parts 数量及声音用法。
7. H3 单段预览、批量可用提示与 ZIP 导出均传递能力；有声原轨 `fully_copy`、拟音 `overlay`，无台词增强版 `replace` 不变。安静段不因固定导出说明而被强制加入手势。
8. 保持既有时长阈值和一次修复；仅在允许 silent 的 pantomime 请求里增加精确剩余时间反馈。例如台词35秒、目标120秒，明确 silent 应合计85秒，允许61–109秒；逐项相加，不自动填充、机械缩放或新编支线。
9. 真实有声段设计曾在独立音 prompt 中写入 `focus on S1 voice`。随后只对 pantomime 增加约束：独立音描述不评述主轨、不引用 S1/Picture/Audio/台词，纯等待直接写 room tone；最终真实 DP 复验已生成只含极轻室内底声的描述，相关回归和增量构建通过。

## 文件范围

生产源码均位于 `apps/web/src/lib/asmr/`：

- `camera-pantomime.ts`：显式能力判断及共享表演约束。
- `reference-template.ts`、`creative-templates.ts`：schema、上下文、v3模板与示例兼容。
- `planner-provider.ts`：创意、改写与精确预算反馈。
- `performance-storyboard.ts`、`clip-storyboard-service.ts`：当前任务聚焦、阶段表、短段路由和模式专用修复。
- `storyboard-review-service.ts`：整批校对合同。
- `h3-prompt.ts`、`video-plan.ts`、`local-video-package.ts`：预览、批量提示及 ZIP 一致导出。

回归包括 `planner-pantomime.test.ts`、`performance-pantomime.test.ts`、`storyboard-review-pantomime.test.ts`、`h3-prompt.pantomime.test.ts`、`video-plan.pantomime.test.ts`，以及既有模板、planner、单段设计和 ZIP 测试的对应调整。最终精确文件清单与源码哈希以 QA 的 release overlay 回执为准；工作区还有其他任务修改，不应一并归入本轮。

## 已确认的验证与失败历史

下列定向测试组互有重叠，不能累加为唯一测试总数：

- 第一版 planner/performance 5文件75项通过。
- 当前任务聚焦及连续阶段修正后，相关5文件77项通过。
- 新整批校对及既有校对/performance 4文件62项通过。
- 精确预算反馈修正后，planner 3文件65项通过。
- 上述最后两次代码变更后分别运行 `tsc --noEmit`，通过。
- 隔离15文件273项通过、19文件 lint 通过、Webpack/TypeScript 完整构建通过。最终独立音措辞再改一处后，2相关文件15项、单文件 lint 和完整增量构建通过；重叠组不累加。初次4个导出测试因隔离目录缺 runner 依赖失败，补指向生产既有 runner 的 junction 后通过，未修改测试断言绕过问题。

真实 DP 开发过程已确认并保留以下问题，不能因后续通过而删去失败回执：

- 第一轮：空手固定人物构图已出现，但扫脸段复制整理领子动作及布料音；部分 parts 每块重做整段并收手；策划 direction 出现轻呼气。
- 第二轮：当前任务混淆与逐块重启得到针对性修正；仍出现 `in front of her forehead`、`near the sides of her face` 等锚定 S1 自身的描述，以及 `invisible strand`。策划时长74秒→修复94秒，低于120秒目标的96秒下限，拒绝结果保留。
- 后续策划仍有73秒（35台词+38无台词）→修复90秒（35+55）的失败；因此加入精确 silent 总额反馈，未放宽阈值、手填通过稿或无限重试。
- 精确预算提示后的最后策划已成功：首稿87秒，经过一次修复得到113秒（35台词+78无台词），12段，处于120秒目标允许区间。原始结果在 `trials/run-round5-planner-20261029T114430532/`，不抹去此前拒绝稿。
- 更早的参考模板120/120/60秒目标不足及39秒拒绝稿历史仍见[既有比较记录](2026-10-29-aige-template-comparison.md)，此次不能追记为已通过。

原始请求、上游返回、业务结果、H3文本和逐轮审查放在 QA `trials/run-*`。未在本文复制凭据或声称所有模型返回都正确。文本语义通过与最终 H3 画面/声音通过是独立结论。

## 最终验收

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 真实 DP 调用 | 20业务/24上游，均 deepseek-v4-pro | 9个 `trials/run-*` 目录的请求、原始上游返回、业务结果及逐轮审查；0新TTS/ASR/H3、0零PCM |
| 最终5段语义 | 当前任务对应、空手对镜、固定完整人物、无目标实体；原始生成字段未手改 | `trials/final-pass-20261029T114853792/source-results.json`、`validation.json` |
| 精确预算 | 120秒目标→113秒（35+78），首稿87秒后一次修复 | `trials/run-round5-planner-20261029T114430532/` |
| 整批校对 | 正确把旧扫脸段的领口动作/布料音修为扫空/刷扫音；未检出所有旧重复收尾 | `trials/run-round4-review-20261029T114240115/`，不能记为全缺陷召回通过 |
| 隔离测试、lint、构建 | 273项，最终一处措辞另复验15项；lint及Webpack/TS通过 | `isolated-*-final.*`、`isolated-*-sound-followup.*`、`release-verification.json` |
| 3001部署 | 2026-10-30启动 `d_ve0slMiD3J1OqoU2Mgq` | `activation.json`、`service-verification.json`；8资源/7参考/2日语WAV/10生产源/28范围外哈希通过 |
| 真实 HTTP 导出 | 5逻辑段54.2秒→13主视频+13ASMR任务，42 ZIP条目全部核对 | `http-export-receipt.json`、`http-export-verification.json`；生成字段、DSP、overlay/replace及原语音字节保持 |
| 最终 H3 视听 | 未生成、未验 | DP文本和批跑导出验证不替代最终视频及音效试听 |
| Git 发布 | 未提交/推送 | 分支 `codex/voxcpm2-product-generation`，当前 HEAD `0c6f8b1`；本轮没有新发布请求 |

最终案例来源：有声说明为 `run-round6-speech-20261029T114657038`；整理领子/扫脸为 `run-round4-designs-20261029T114320902`；拨头发/捏脸为 `run-round3-designs-20261029T113936083`。组合 QA 工程只更新 `sourceFingerprint` 与 `previousPromptFingerprint`，逐字段证明 visual/action/camera/声音/parts 未改，保留各自真实生成时的引用模式。它是验证工程，不覆盖旧万圣节交付或用户浏览器工程。

最终输出示例（中文概括，英文原文见上述证据）：整理领子在镜头下沿空气轻捏并向两侧理平；扫脸是空手在镜头前缓扫，不触碰表面；拨头发为双空手到画面上缘轻拢再向两侧展开；捏脸为画面两侧空指尖轻合两次。台词说明段仅观察、说话和等待，双手静止，独立声音只保留极轻室内底声。

独立复核仍记录：扫脸首块主要抬手时已经描述刷扫拟音；拨头发声位保持居中，未细分向两侧手势；整批校对漏掉旧领口/头发段的重复收尾。上述属于更细的音画时序/声位和校对召回，未宣称修复或恢复一般导演质量优化。

活动源码 `.local/releases/camera-pantomime/apps/web`，Node PID36840、启动父进程30300（仅当时快照）。继续时先检查监听进程；2026-10-30恢复前3001本来无监听，本次没有终止任何进程。入口 `I:/AI/asmr_director/service/2026-10-16/start-production.ps1`，仅切换隔离发布工作目录；原脚本在 QA `start-production-before.ps1` 可回退。最终 ZIP 3,422,473bytes，SHA256 `6b83dd7cc1b7b5de6c4b1bfe35e499e0bca1a2a3125f6e6ce3dbad94ffe33d4e`，仅作 QA 留证。

2026-10-30 用户随后要求实际试跑该包：已将上述 ZIP 原样复制并校验到 `I:/AI/asmr_director/artifacts/h3-asmr/ASMR-camera-pantomime-trial-2026-10-30.zip`，SHA不变。这是1台词+4动作共54.2秒的5段验证内容。解压后双击run.bat，选择角色参考图、ComfyUI地址及所需画幅；沿用用户此前偏好时选竖屏9:16。此次只交付既有包，没有新增模型调用或H3运行。

## 文档同步与恢复

本记录按 engineering-development-recorder 的证据与状态规则准备，但用户及项目 `AGENT.md` 已指定 `docs/ROADMAP.md` 为唯一路线，因此不创建 `CURRENT_ROADMAP.md`、新路由或初始化元数据。已同步 `ROADMAP.md`、`AI_HANDOFF.md` 与 `project-archive.md`；Audio Quality V1继续，只按最新授权重开本模板空手演出纠正，其他暂停状态保持。DP余额恢复不表示No-sleep的内存阻塞已解除。

恢复顺序：先读本记录最终验收表及 QA 汇总，再检查当前服务、最终源码哈希和真实 DP 证据；保留所有失败回执。不要恢复 No-sleep RAM 任务或借此扩大到其他暂停的质量实验。
