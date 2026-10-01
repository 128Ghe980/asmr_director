# ASMR Director 固定 Roadmap

Last updated: 2026-10-01

本文件是项目顶层路线的唯一硬来源。`docs/AI_HANDOFF.md` 可以总结当前状态，`docs/project-archive.md` 可以记录历史，但它们都不能定义一套与本文件竞争的路线。

## 当前优先级

2026-10-01 本会话收尾：用户要求记录并提交推送，交接范围包含本会话累计的语义短单元、选区编辑、一屏工程布局、识别对照和末尾/API截取。实现与验证已完成；交接只同步记录与Git，不新增生成、采用或听感验收。恢复入口见 [AI_HANDOFF](AI_HANDOFF.md) 与 [开发交接记录](records/2026-10-01-audio-quality-v1-semantic-workspace-handoff.md)；当前分支 `codex/voxcpm2-product-generation`，后续按已有音质V1未完成项或用户新测试反馈继续，不新增路线阶段。

2026-10-01 续完 9 月 24 日末尾定位需求：标点核对前已忽略；新增末尾词辅助的至少 85%／最多两次编辑回退，兼容少量漏字并明确显示差异，原 90% 等长替字路径保留。至少 10 字目标、真实词端点、紧邻后文与双侧静音验证共同约束；不按字数估时。复用现有外部 API 仅在本地端点不确定时选词索引，再本地验证，不能让模型直接给秒数或跳过检查。用户“暖胃”原录音已实测截出 7.11 秒、88.8889%／啦→了及少儿，旧 22.56 秒原音保留，无新 TTS、未采用；当前后文已编辑，重分析示例保留旧上下文。真实 API 400 已修正并复验 HTTP 200。67文件／734项应用测试、74项Python测试、全量lint/typecheck/build及正式页面播放检查通过；3001 PID19500，15段文字刷新保留，一屏与左右对齐保持。此项仍属于现有音质 V1 的生成流程修正，不新增路线阶段。见 [中文 spec](superpowers/specs/2026-09-24-ending-anchor-extraction.zh.md) / [English spec](superpowers/specs/2026-09-24-ending-anchor-extraction.md)。

2026-09-23 用户批准小量识别差异仍截取并明确提示：归一后至少 90% 一致、最多两处等长替字，无增删/重排/重复；有差异的非末目标必须通过真实静音及双侧独立识别，目标文本核对与边界核对分开。可靠截取保持 passed 并显示相似度/差异字，边界不确定仍返回完整原音。已有录音真实重分析截出 2.45 秒、90%/「啦→了」，新候选已保存供试听，旧23.36秒候选及原音不变，无新TTS、未采用。65文件/692项应用测试、54项Python测试、全量lint/typecheck/build及正式页面播放验证通过；3001 PID25872/.next-semantic-build。此条覆盖Sept21目标前三字严格拒绝的行为，不新增路线阶段；音质V1仍按下文推进。见 [中文 spec](superpowers/specs/2026-09-23-tolerant-voice-extraction.zh.md) / [English spec](superpowers/specs/2026-09-23-tolerant-voice-extraction.md)。

2026-09-21 识别对照与截取调查：候选及完整原音均增加默认折叠「识别对照」，保存完整窗口/裁剪后 ASR、词时间与失败阶段，成功、失败、超时、取消均保留已有证据。真实复查确认「回来啦」被识别成「回来了」，开头三字严格规则使初始定位失败；实际有 260 ms 静音，但独立裁后 ASR 仍是「回来了」，本轮未放宽截取规则。省略号确属历史策略；历史 16 是补句下限，当前最大 16 是新增稳定性限制，不能混称。已有首段候选回填 ASR、原音字节不变；677 项 TS 测试、38 项 Python 诊断测试、全量 lint/typecheck/build、真实 ASR 传递与生产浏览器对照检查通过。正式 3001 为 PID 29948；未新生成/采用或变速，不新增路线阶段。见 [中文 spec](superpowers/specs/2026-09-21-voice-recognition-inspection.zh.md) / [English spec](superpowers/specs/2026-09-21-voice-recognition-inspection.md)。

2026-09-21 首小段失败修正：已复现滑动窗口只按 500 字截取、误送 69 分句／499 字，导致 AudioVAE 解码 `grid_y < USHRT_MAX` 原生断言退出。语义窗口现按目标＋后文最多 16 分句限制，500 字另作安全上限；窗口外改动不影响候选，失败后保留服务端有界原生日志与安全分类提示。64 文件／663 测试、全量 ESLint／TypeScript／生产构建通过；正式 3001 恢复至 PID 20008／`.next-semantic-build`。证据根 `I:/AI/asmr-director-generation-failure/2026-09-21`，双语说明沿用 semantic-script-workspace spec。本次为现有生成缺陷修复，不新增阶段。

首段真实复验已返回 23.36 秒候选／原音，122 字／16 分句窗口不再触发原生失败；字词对齐仍待确认，因此本次保留完整原音，不把首句精确截取或音质算作已验收。候选及空间试听／下载可用，无自动重试、未采用；浏览器重开后文案与候选保留。

2026-09-20 最新用户批准：最初出稿就使用语义短单元，创意与工程共用这些边界；只对选中单元显示操作，工程全部面板保持一屏可见。新生成协议用共享元信息的 `groups[].units`，展开为每条对应一个 voice clip 的 sections。VoxCPM2 采用工程后文滑动窗口，只提取目标开头，真实末句独立收尾；窗口内容参与候选校验与生成取消。此条进一步修正下条“内部组只属引擎细节”的过渡实现。64 文件／652 测试、全量 ESLint／TypeScript／生产构建通过；真实初始出稿 149 字／9 单元、采用刷新及桌面手机一屏验证通过。真实 TTS 非末句对齐需确认但完整原音可用，末句核对通过，各只生成一次。正式 3001 已切换 PID 6168／`.next-semantic-build`，临时 3002 已停止；未提交推送。实现与验证见 [中文 spec](superpowers/specs/2026-09-20-semantic-script-workspace.zh.md) / [English spec](superpowers/specs/2026-09-20-semantic-script-workspace.md)，新证据根为 `I:/AI/asmr-director-semantic-workspace/2026-09-20`。不新增编号路线，也不代表音质 V1 已完成。

2026-09-20 最新用户批准：修正策划与工程“分段替用户决定修改/生成范围、整段音频无法独立等待”的交互。当前实现覆盖用户选区改写、手改增删拆合、生成中取消与迟到保护；工程选区先成为独立 clips 再生成，`pause_after` 保持实际语音结束后的等待；上方左右块内滚动、下方时间线、右侧常用操作优先。未涉及片段保留音频，修改/拆合涉及的整段音频因缺少任意文字边界精确对齐而需重生成，旧版本与原音不删除。这是现有工作流修正，不新增编号路线，音质 V1 仍未完成。62 文件/629 项测试、全量 ESLint/TypeScript/生产构建、独立 3002 示例工程桌面/手机范围与等待验证通过；正式 3001 已更新至 PID 19292 并只读确认原六段/4:50 用户工程保留，无浏览器错误。没有新真实 TTS/LLM 或听感验收，也未提交推送。详见 [中文 spec](superpowers/specs/2026-09-20-user-controlled-script-ranges.zh.md) / [English spec](superpowers/specs/2026-09-20-user-controlled-script-ranges.md)，证据根为 `I:/AI/asmr-director-range-editing/2026-09-20`。

2026-09-20 较早会话交接（本轮范围修正前）：生成交付修复已在 `df30bb9` 提交并推送到 `origin/codex/voxcpm2-product-generation`，当时 3001 正式工作台已更新。该次收尾仅同步文档与运行快照，没有新增生成或听感验收；交付修复本身无遗留实现项。恢复入口以 `docs/AI_HANDOFF.md` 顶部最新段落为准；完整原音政策、I 盘优先和已完成的 D 接入不得按旧记录回退。

2026-09-20 最新用户决定：检查不能阻止音频交付，每次完整原音必须可试听、下载；正常分组提取和拼接保留。已改为原音先交付、检查提示化、每组一次生成、失败继续；历史失败原音可找回，支持分页。加入资源感知的有限 TTS/ASR 流水线和识别复用，本机内存不足时默认串行。真实双组检查均失败但仍完整返回 34.91 秒候选，首份原音 32.59 秒即可访问。此条覆盖此前“检查失败重试三次后拒绝交付”的规则，不改变音质 V1 顶层路线。详见双语 `2026-09-20-audible-generation-and-performance` spec。

当前固定 10 步 roadmap 已全部完成。用户于 2026-09-08 确认 Planner“暂时算是过了”，随后批准实施 VoxCPM2 正式生成接入。Planner 本轮按已验证的 DeepSeek 路径和精简界面验收通过；优先级已转回“人声导演与真实 ASMR 音效质量 V1”。VoxCPM2 单片段生成、候选试听/采用/撤回及 48 kHz 重混导出已通过技术验收。2026-09-09 已选长文分组/停顿方案也已完成工作台接入及真实技术验收，包括完整生成、单组重生成与候选到导出的闭环。既有听感结论和真实音质验收要求不变。

2026-09-14：用户试听 8770 新口语文案后认可效果，授权将原 D 接入正式生成并记录推送。D 的 HRTF、刚性球 DVF 与原房间响应现已用于人声完整候选、当前人声、片段试听和整段导出，增加定距环绕与环绕靠近；修改距离与轨迹复用已生成原声。最终实施与验证记录见双语 `2026-09-14-spatial-d-product-integration` spec。真实 SFX、垂直环绕和通用更柔仍属于音质 V1 未完成范围。

2026-09-20 额度恢复后收尾：D 正式接入已完成。57 文件／520 项 Vitest（含真实 Python 适配器）、26 项空间 Python 测试、TypeScript／生产构建和最终 ESLint 通过；新 TTS 至导出闭环及恢复后的生产构建播放／跳转／采用撤回／重混下载／桌面手机复核通过。四条获认可 D 自然样片与产品渲染字节完全一致。新缓存、临时文件和验收产物优先放 `I:/AI`；交付分支保持 `codex/voxcpm2-product-generation`。

2026-09-20 较早的长文失败提示修正（历史，交付行为已被 `df30bb9` 覆盖）：用户报告首组失败且“完整台词和安全边界”难以理解。第三条候选存在 370 ms 静音，但整段 ASR 的“回来啦”在截取后识别为“回来了”；修正后保留 `cut_text_mismatch` 诊断。该次只改提示，没有生成新音频或解决核对不一致。后续按用户决定将检查改为提示，保留全原音交付并取消检查触发的自动重试；不能恢复当时拒绝交付的规则。证据见同日 `docs/project-archive.md`。

## 本轮已通过：AI 创意策划 / LLM Planner V1

- Status: Accepted for this iteration by the user on 2026-09-08. Real external DeepSeek workflow and UI cleanup are accepted. Local Ollama memory recovery and broader script-quality evaluation remain non-blocking follow-ups, not claims of completed verification.
- 2026-09-07 初次实现与 DeepSeek 配置验收：34 个测试文件 / 260 项测试、全量 ESLint、TypeScript 与生产构建通过。用户配置 DeepSeek 后，真实出稿、单段改写、撤回、采用新工程、刷新恢复与策划来源载入通过；390px 长文案无横向溢出，浏览器无 error/warn。本地 Ollama 成功验收及更多主题的艺术质量评估仍待完成。
- 2026-09-07 界面整理：用户明确指出功能基本可用，但主界面堆积了无意义信息和开发注意事项。已按“默认只提供当前任务操作与创作内容，技术数据按需展开”精简策划、工程编辑与预览；这是当前 Planner/UI 体验整理，不新增阶段。本轮 260 项测试通过，最终排版调整后的 9 项 Planner 组件用例、全量 ESLint、TypeScript 与生产构建通过；桌面/390px、折叠与视图切换、刷新保稿检查通过，最终刷新后无新增浏览器错误。
- Design: `docs/superpowers/specs/2026-09-07-llm-planner-v1-design.zh.md`（附英文版）。
- 输入今日主题与可选时长、角色和风格，真实 LLM 生成完整可编辑中文文案。
- 支持单段改写、取消、撤回、草稿本地保存与文案下载；采用后创建新工程，保留原项目。
- 复用现有 Timeline DSL、项目库、编辑与音频链路；导演提示和音效建议独立于朗读台词，策划来源保存在项目库元数据中。
- 默认本地 Ollama，外部 API 可选且由服务器配置；不把模板当作模型输出。
- 读取真实语音时长，对策划工程延长过短的人声片段并顺延后续时间线，避免规划时长截断台词。
- 本阶段为用户批准的命名阶段，不新增编号 Step 11；原 D 房间/距离/水平运动已接入，音质 V1 的垂直运动、通用更柔及真实音效扩展仍未完成。

## 当前阶段：人声导演与真实 ASMR 音效质量 V1

- Status: In progress; base VoxCPM2 and the selected long-text workflow are technically verified. The user accepted the original-D colloquial motion sample on 2026-09-14 and authorized its product integration. Original D now supplies voice distance, room response and continuous horizontal motion; real SFX, vertical motion and general expressive control remain unfinished.
- Design: `docs/superpowers/specs/2026-07-13-audio-director-and-sfx-quality-v1-design.zh.md`
- Round 1 plan: `docs/superpowers/plans/2026-07-13-audio-quality-v1-round1-implementation-plan.md`
- VoxCPM2 接入设计与实施记录：`docs/superpowers/specs/2026-09-08-voxcpm2-product-integration-design.zh.md`（附英文版）。基础接入及长文模式均已通过技术验收；D 空间处理见 `docs/superpowers/specs/2026-09-14-spatial-d-product-integration.zh.md`（附英文版）。
- 主线 1：让“更柔”、近/远、左右、水平环绕与垂直环绕成为真实可听的导演动作，而不是只改文字字段、音量或普通声像。
- 主线 2：以免费授权素材、免费本地 AI 和明确标注的基础合成扩大 ASMR 音效质量与种类；付费方案暂缓，不要求用户录音。
- 第一轮固定样片：一句人声、衣物摩擦、指尖轻敲、雨声；完成更柔、近/远、完整水平环绕、左—上—右—下垂直环绕、三种来源比较、采用、撤回与重混。
- 第一轮必须通过用户耳机试听，才进入全部动作和 8 类音效扩展。

### 2026-09-13 距离感试听实验

2026-09-13 距离感实验：按用户授权完成固定温柔人声＋真实 CC0 画刷的离线对比，包含声像基准、HRTF、刚性球 DVF 近场补偿、房间反射四种处理，以及贴耳／面前／远处／靠近和整体响度匹配版本。80 个 WAV、13 项数值测试和浏览器播放／跳转／下载／桌面手机检查通过；复现工具在 `tools/distance-listening/`，证据在 `D:/CodexWorkplace/asmr_director_runtime/distance-listening/2026-09-13`。后续用户反馈加入房间“确实不错”、D“还行”，属于初步正面反馈，不代表全部空间方案获验收；主线混音器与工程数据没有变更。详见 `docs/superpowers/specs/2026-09-13-distance-listening-experiment.zh.md` 及英文版。

### 2026-09-14 算法扩展与 D 改进对照

用户澄清希望继续了解其他算法，并授权房间／贴耳几何与人声朝向改进。已完成 BRIR、ISM/FDN/SDN、Paraspax、几何传播、神经双耳和 Ambisonics 的原始资料调研，以及保留 D、房间 E、贴耳朝向 F、合并 G 的独立试听。27 项数值测试、96 个音频检查及真实浏览器播放／切换／章节／下载／桌面手机验证通过；原 D 静态片段回归通过。成品在 `I:/AI/asmr-director-distance-listening/2026-09-14`、`http://127.0.0.1:8768/`。D 盘写入中断后仅迁移本轮未完成产物到 I 盘重做，旧 8767 成品保留。随后用户明确 D 仍最好，认为 E 减少了远处的回声／混响，空间感变弱；当前保留原 D，不采用 E/F/G。这轮比较不再是待听项，未接入产品或运行神经模型。技术报告见双语 `2026-09-14-distance-algorithm-refinements` spec；最新听感决定见下条。

### 2026-09-14 保留 D 的长文连续环绕

按用户新要求，已完成同一段 34.75 秒、16 句已选温柔长文的四条连续轨迹：距头中心 0.18／0.8／1.75 米定距环绕，以及 1.75→0.18 米环绕靠近。全部沿用原 D 的 HRTF、DVF 和房间响应，左→后→右→前→左绕一圈；开头停留 1.5 秒、结尾停留 2.5 秒，靠近在 27.105 秒结束并保持近距 7.645 秒。输出 8 个 35.4 秒 / 48 kHz stereo PCM24 WAV，含自然与整段响度匹配版本。原声、原 ASR 和 D 代码哈希保留，没有新 TTS、变速、重复短句或工作台修改。

37 项数值测试、8 文件音频验证、原 D 静态卷积端点回归和真实浏览器检查通过；最大估计真峰值 −5.383748 dBTP、匹配误差 0.029476 LU、端点残差小于 1.2×10⁻⁷。成品与 JSON 证据在 `I:/AI/asmr-director-distance-listening/2026-09-14-d-long-motion`，试听 `http://127.0.0.1:8769/`。D 是当前听感基准；这四条新长运动的听感仍由用户判断，不等于空间正式接入或音质 V1 完成。双语记录：`docs/superpowers/specs/2026-09-14-d-long-motion.md` / `.zh.md`。

### 2026-09-14 新口语文案重生成

用户要求换新文案、不要文绉绉。已实际重新运行本地 VoxCPM2 soft Combined 六语义组生成，保留已选长开头／独立结尾及 class-local 停顿；新原声 34.54 秒，六组截后 ASR 覆盖率均 1.0，最终 22/22 子句顺序覆盖（整段识别有一处「露／落」差异）。完整尝试、两次口语修订与技术恢复记录保留在 `I:/AI/asmr-director-distance-listening/2026-09-14-colloquial-source`。

新原声沿用原 D 四条连续轨迹，产出 8 个 35.19 秒 WAV，页面 `http://127.0.0.1:8770/`，成品目录 `I:/AI/asmr-director-distance-listening/2026-09-14-d-colloquial-motion`。38 项数值测试、音频／原 D 端点回归和实际桌面手机播放／切换／下载检查通过。原 8767–8769 保留；实验当时没有修改工作台工程。用户随后反馈“还行”，授权正式接入，当前不再列为待听项。双语记录：`docs/superpowers/specs/2026-09-14-d-colloquial-motion.md` / `.zh.md`。

### 2026-09-14 原 D 正式接入

原声资产与候选来源保持可追溯；D 派生音频缓存独立，距离/移动编辑不要求重新生成已完成的人声。完整试听和导出沿用同一空间服务；支持 24 位 WAV 解码并保留 0.65 秒房间尾声。包含 D 的整段混音跳过旧的向上响度归一，只在开启主限制器且过载时共同衰减，以保留自然近远音量差。

四条已认可 35.19 秒自然 D WAV 与产品实现逐字节及 SHA256 一致；真实混音探针近远 RMS 差保持 7.367684 dB。最终全量检查、工作台闭环及提交信息统一记录于上述产品接入 spec，避免与实验历史混淆。音质 V1 整体仍在进行。

### 2026-09-07 进度记录

- 已完成多轮 GPT-SoVITS、CosyVoice3 与 VoxCPM2 人声试听。对当前温柔中文参考，VoxCPM2 的整体柔和表达明显优于现有 GPT-SoVITS 方案，因此保留为可选人声引擎；但自然语言 `soft` / `whisper` 指令本身仍不稳定，不能宣布通用“更柔”已经完成。
- 已确认当前温柔中文长文本首选：语义组最初由本地 Ollama `qwen3:1.7b` 划分，随后 DeepSeek V4 独立复核得到相同分组；每次把当前语义组放到长文本开头，后接剩余全文，完整生成后只截取开头语义组；最后一组单独生成真正结尾；组间使用 DeepSeek 给出的短/中/长分类与相邻组真实停顿计算。当前试听成品的五处组间停顿为 `350 / 350 / 350 / 440 / 290 ms`。
- 2026-09-08 用户确认保留固定补全文本，理由是此前整段生成后面会变快、变尖。长文接入默认保留“目标组＋剩余正文＋所需中性补句”的长输入，只提取目标开头；末组独立生成真正结尾，不补句。补句去留不再列为待实验或接入前置；此决定沿用成功组合，未新增独立因果验证。
- 已确认“更近”采用“贴耳说话姿态的重生成 + V2 空间处理”的组合；单独的人声方向提示“朝左耳说/朝右耳说”无法产生可辨认方向，左右与环绕仍必须由空间处理完成。
- 水平、垂直及左/右侧环绕已有可用实验结果，垂直闭环的过渡问题已修正；这些仍是独立试听实现，尚未接入工作台正式生成流程。
- 免费、本地优先的限制不变；DeepSeek 属于可选外部文本分析，必须保留免费本地分组和固定停顿兜底。程序噪声可以继续作为基础 SFX 兜底，但真实 ASMR 音效种类和质量仍未解决。
- 当前结论与证据见 `docs/superpowers/specs/2026-07-26-voxcpm2-evaluation-design.zh.md` 和 `I:\AI\voxcpm2-evaluation\evidence\LISTENING_RESULTS.zh.md`。

2026-09-08 已恢复音质 V1，先把已选的人声方案整理成现有 Generation Bridge 下的可选 Provider 和可配置生成模式。产品接入必须保留候选重生成、试听、采用、撤回和重混，不把单次好 seed 当成稳定能力。2026-09-08 收到全短句默认停顿对照的补充反馈：用户此前已试听“原停顿 vs 全部改成类别默认停顿”，感觉无明显差异，未选出新优胜版；实际试听日期未知。该对照不再列为待听，不改变 class-local 组间自适应停顿的当前首选；也不据此推断首尾无截音或两版完全等价。真实 SFX 扩展仍是同一阶段的未完成主线。

### 2026-09-08 产品接入首切片

- 已通过原生 CLI 接入可选 VoxCPM2，支持普通/温柔参考、Reference-only/Combined 两模式，保留 GPT-SoVITS；生成独立候选，试听后显式采用或丢弃。
- 候选与来源信息持久保存，采用前校验内容与素材，刷新后可撤回最近一次采用；保留安全版本、Planner 来源和实际人声时长，后续时间线自动顺延。取消会终止原生进程，失败/迟到结果不替换原声。
- 混音默认 48 kHz，兼容 32/44.1/48 kHz，保留 stereo 声道；界面只默认显示引擎/参考/生成/试听采用操作，技术来源折叠。旧工作树保持原状。
- 本轮全量 46 个测试文件 / 340 项测试、ESLint、TypeScript（生产构建内）及 Webpack 生产构建通过。原有 Windows native SWC 加载警告仍存在，WASM 回退构建成功。
- 真实本地 TTS 两模式产出 5.6 / 6.4 秒候选；独立浏览器上下文通过播放、显式采用、时间线延长、刷新撤回、8.6 秒 48 kHz stereo 重混和实际 WAV 下载。桌面/390px 界面无横溢，最终浏览器错误为空。另一次真实取消验证进程退出、锁释放、候选数不变。
- 证据目录：`D:\CodexWorkplace\asmr_director_runtime\voxcpm2-product-verification\2026-09-08`。自动检查不等同于用户耳机听感验收；当时长文分组/安全截取/自适应停顿、V2/HRTF 空间和真实 SFX 扩展尚未完成。长文随后于 2026-09-09 完成技术接入，记录如下。

### 2026-09-09 长文工作台接入

- VoxCPM2 增加“长文分组”：非末组沿用完整剩余正文及所需固定补句，末组独立结尾；逐组本地 ASR 核对并安全截取，只调整组间停顿。模型分析默认本地，可显式选已配置外部 API，失败使用标明来源的规则兜底。没有重开补句去留或已听停顿对照。
- 支持实际分组进度、取消、完整候选与分组试听、单组重生成；其他组复用原素材，原候选与工程保持。技术来源和各组操作按需展开，现有候选采用/撤回、时间线顺延、重混流程复用。
- 真实 DeepSeek V4 Pro 分成 5 组；本地 VoxCPM2/离线 ASR 产出 20.352 秒完整候选，5 组覆盖率均为 1，四处实测连接为 390 ms。实际首组重生成一次成功，新候选 20.57 秒，其他四组素材 ID 不变；既有采用与混音不变。
- 浏览器实际播放、采用、刷新撤回、再次采用、23.36 秒 / 48 kHz stereo 重混、WAV 与工程 JSON 下载通过。最终刷新保留两个候选、原采用状态和新鲜混音；桌面/390px 无横向溢出，最终浏览器 error/warn 为空。另一次真实 UI 取消确认锁释放、无新增候选、原声不变。
- 证据：`D:\CodexWorkplace\asmr_director_runtime\voxcpm2-longtext-verification\2026-09-09`；自动检查结果见双语接入设计和本轮留档。新产品样片听感由用户判断；V2/HRTF 与真实 SFX 继续属于本阶段未完成项。

第 7 步已经完成本地 voice clip 真实生成接入，第 8 步已经完成 breath / SFX / ambience 的本地半真实 clip 生成接入，第 9 步已经完成真实项目混音与 WAV 导出接入。后续不能再把 adapter、API route、provider wrapper、bridge cleanup、mock work 重新包装成新的顶层 roadmap 步骤；它们只能作为后续步骤的内部实现细节存在。

## 10 步路线

1. **字段级校验高亮**
   - Status: Completed.
   - Outcome: Clip Inspector 里的字段可以显示映射后的校验错误，Validation Panel 仍然保留完整问题列表。

2. **轻量 Timeline 编辑**
   - Status: Completed.
   - Outcome: 已支持选中 clip 的 start / duration 微调，不做完整 DAW。

3. **项目工作区结构升级**
   - Status: Completed.
   - Outcome: C+ 可折叠工作区结构，包括左侧项目栏、中间编辑区、顶部工作区操作与状态、右侧详情 / 预览 dock。

4. **真实音频前的预览层**
   - Status: Completed.
   - Outcome: 已完成早期 Preview Layer、状态概览、素材状态和 Timeline status dots。后续 Step 10 接入真实波形；2026-09-07 界面整理移除默认统计与占位波形，把非空轨道和素材详情改为按需展开。

5. **Clip 生成交互闭环**
   - Status: Completed.
   - Outcome: 已有选中 clip 生成、重新生成、重试、取消、运行时进度、durable asset commit、失败态、mock playback。

6. **稳定生成资产与项目混音骨架**
   - Status: Completed.
   - Outcome: 已有稳定的 `asset://clip/...` 与 `asset://mix/...` 引用、project mix control、full-project preview、WAV download、runtime-only job state、导入 / 导出边界保护。

7. **真实生成 MVP**
   - Status: Completed.
   - Outcome: 已打通本地 GPT-SoVITS voice clip 真实生成链路。工作台默认使用 local generation bridge，选中 voice clip 点击 `生成` 后会调用本地 Next API、请求 GPT-SoVITS、把真实 WAV 保存到 `D:\CodexWorkplace\asmr_director_runtime\assets\clips\app`，并把 `asset://clip/...` durable reference 写回 Project JSON。Preview Layer / selected clip preview 通过 `/api/assets/clip/<assetId>` 播放该真实 WAV。
   - Acceptance criteria:
     - 用户点击 voice clip 生成控制后，可以触发真实 provider 或真实本地生成服务。
     - 结果是可播放的真实音频文件，不再是 mock WAV synthesis。
     - Project JSON 只保存稳定 durable asset reference。
     - 生成出的 voice clip 可以通过现有 Preview Layer / selected clip preview flow 播放。
     - failure、retry、cancel 仍然可用。
     - adapter / API / provider wrapper 只能作为本步骤内部子任务实现，不能单独升级成新的 roadmap 步骤。
   - 2026-07-06 状态补充:
     - 已在 `D:\CodexWorkplace\asmr_director_runtime` 手动跑通本地 GPT-SoVITS API、参考音频 ASR、单句 TTS、以及一段约 59.53 秒的多 clip ASMR 测试混音。
     - 这证明真实生成链路本地可行，但还没有完成产品内接线：工作台的 voice clip 生成按钮尚未调用本地 provider，生成结果尚未通过稳定 durable asset reference 写回项目并进入现有 Preview Layer。
     - 下一步仍然属于第 7 步内部实现：把已验证的本地 GPT-SoVITS runtime 接入 Generation Bridge / selected voice clip generation flow，而不是新增顶层 roadmap 步骤。
   - 2026-07-07 完成记录:
     - 已新增 local runtime config、voice pack loader、GPT-SoVITS provider wrapper、local asset store、local generation bridge、clip generation API route、clip asset playback API route，以及 `asset://clip/...` playback resolver。
     - 默认 UI bridge 已从 mock 切到 local real generation；只有设置 `NEXT_PUBLIC_ASMR_GENERATION_MODE=mock` 时才使用 mock bridge。
     - Headless Chrome 端到端验收：页面 hydrate 后选中 `voice_001`，点击 `生成`，项目保存 `asset://clip/voice_001_20260706T211523064Z_d3b95513`，播放接口返回 `audio/wav`，`241,964` bytes，文件头 `RIFF`，页面无 error/warning。
     - cancel 对当前同步本地 provider 是客户端 best-effort：UI 会取消本地提交并忽略晚到结果，但已经发出的 GPT-SoVITS 请求不会被底层服务中断。

8. **多类型真实 Clip 生成**
   - Status: Completed.
   - Outcome: 在 voice 之外，已把本地半真实生成扩展到 breath、SFX、ambience。非 voice clip 使用本地程序化 WAV renderer，继续通过同一 selected clip generation flow、`asset://clip/...` durable reference、Preview Layer selected clip playback 进入项目。
   - Acceptance criteria:
     - 非 voice clip 也能通过同一 project contract 生成并预览。
     - Clip-level regeneration 仍然只影响当前选中 clip。
   - 2026-07-07 完成记录:
     - 新增程序化非 voice renderer：breath 使用柔和噪声呼吸包络，SFX 使用摩擦 / 敲击式包络，ambience 使用雨声底噪和稀疏雨滴颗粒。
     - `POST /api/generation/clip` 已从 voice-only helper 改为通用 local clip generation：voice 继续走 GPT-SoVITS，breath / SFX / ambience 走本地程序化 renderer。
     - Headless Chrome 端到端验收已生成 `breath_001` 和 `sfx_blanket_001`：播放接口均返回 `audio/wav`，文件头 `RIFF`，页面无 error/warning。

9. **真实项目混音与导出**
   - Status: Completed.
   - Outcome: 已按 Timeline DSL 把已生成 `asset://clip/...` assets 混成真实 `asset://mix/...` WAV，并接入 Preview Layer 的整段试听与 WAV 下载。
   - Acceptance criteria:
     - Project mix 使用真实生成的 clip assets 与 timeline timing。
     - Full-project preview 播放真实 mix。
     - WAV download 返回真实混音音频文件。
   - 2026-07-12 完成记录:
     - 新增 project mix readiness / export state / fingerprint helpers，用于判断素材是否齐全、旧 mix 是否过期，以及成功/失败时如何写入 `exports[type="wav"]`。
     - 新增 PCM WAV decoder / stereo WAV writer / project mix renderer，支持 timeline placement、clip gain、fade、pan、distance、movement、ambience loop、目标响度归一和 limiter。
     - 新增本地 project mix generation helper、`POST /api/generation/mix`、`GET /api/assets/mix/[assetId]`，并把 `asset://mix/...` 映射到可播放 API route。
     - Generation Bridge / runtime / summary / view model 已支持 `project_mix:wav` runtime job；Preview Layer 已接入 `生成整段`、`重混`、`试听`、`WAV` 和 `取消`。
     - 验证：`npm.cmd run test --prefix apps/web` 25 files / 158 tests 通过；`npm.cmd run lint --prefix apps/web` 通过；`npm.cmd run build --prefix apps/web -- --webpack` 通过；本地 API 验收生成 `asset://mix/step9_verify_project_wav_20260711T203915972Z_697118df`，播放接口返回 `audio/wav`、`RIFF`。

10. **产品工作流硬化**
    - Status: Completed.
    - Outcome: 已完成本地优先的产品工作流闭环：多项目库、旧单项目存储迁移、项目新建/切换/复制/删除、显式版本与破坏性操作前安全版本、真实 WAV waveform/技术分析、生成与导出质量检查，以及本地保存失败提示。云端持久化、账号、计费、发布、协作属于部署与商业化扩展，不冒充本地 MVP 已完成能力，也不自动构成新的顶层 roadmap。
    - Acceptance criteria:
      - 左侧项目栏显示真实本地项目列表并支持新建、切换、复制和安全删除。
      - 当前项目自动保存；用户可以留版本并恢复，覆盖/重置/切换前保留去重安全版本。
      - Preview Layer 对真实 `asset://clip/...` / `asset://mix/...` WAV 显示真实峰值波形，不再把伪波形当作真实结果。
      - 质量检查覆盖 schema、素材齐全度、mix 新鲜度、音频分析、声道和峰值余量；2026-09-07 起详情按需展开，实际失败与需处理的问题继续可见。
      - 项目 JSON 不混入项目库、版本、波形或运行时分析数据。
      - 本地保存失败时明确显示不可用，未知 mix fingerprint 保守标为需重混。
    - 2026-07-12 完成记录:
      - 新增版本化 `ai-asmr-studio:v1:project-library`，自动迁移旧 `v0` 单项目 key；每个项目最多保留 12 个版本，右栏显示最近 5 个。
      - 新增 `GET /api/assets/analysis` 与 PCM WAV 分析，返回 16-160 段真实 peak bars、duration、sample rate、channels、peak/RMS dBFS 和 clipped sample count。
      - 左侧占位项目栏升级为真实项目库；右侧新增质量检查与版本记录；Preview Layer 接入真实 waveform。
      - 独立代码审查后补齐本地保存失败态、持久化 mix fingerprint、非当前项目同 ID 导入安全版本、revision project ID 不变量、API 400 分类和精确 PCM 饱和判断。
      - 验证：`npm.cmd run test --prefix apps/web` 29 files / 184 tests 通过；`npm.cmd run lint --prefix apps/web` 通过；`npm.cmd run build --prefix apps/web -- --webpack` 通过；桌面和 390px 浏览器验收无横向溢出、无 console error/warning，真实 showcase WAV 显示 64 段波形并读出 32kHz stereo 技术指标。

## Roadmap 修改协议

只有用户可以批准顶层 roadmap 变更。如果 agent 认为某个步骤已经过时、不可行、或实际实现暴露了原设计不足，必须先说明冲突并提出 roadmap 修改建议，得到用户确认后才能改方向。
