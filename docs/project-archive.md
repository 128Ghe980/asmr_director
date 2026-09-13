# AI ASMR Studio 项目留档

记录日期：2026-06-14

最后更新：2026-09-13

AI/上下文压缩恢复入口：`docs/AI_HANDOFF.md`

当前本地工作区路径（Codex desktop）：`D:\CodexWorkplace\asmr_director`。这是本机恢复线索，不是跨环境要求；换机器或换环境时以 repo 根目录为准。

这份文档是当前项目的历史档案，用来保存我们已经聊好的产品判断、设计方向、实现进度和决策过程。

如果是新的 AI agent 接手，或者当前会话发生上下文压缩，应先读 `docs/AI_HANDOFF.md`。那份文件更短、更稳定，专门服务“快速恢复当前状态和下一步”。

## 2026-09-13 - VoxCPM2 工作台接入收尾确认

用户要求确认是否完成，完成后先记录并推一版。检查代码、交接和原始验收记录，确认单片段及已选长文工作台接入均已完成技术验收。功能提交为 `4d5f8ab feat: integrate grouped VoxCPM2 long-text generation`；本日重新 fetch，确认该提交已在 `origin/codex/voxcpm2-product-generation`，收尾记录前主工作区干净、本地与远端一致。

沿用 2026-09-09 的验证：53 个 Vitest 文件 / 465 项测试、23 项 Python 测试、全量 ESLint、包含 TypeScript 的生产构建通过；真实五组生成、单组重生成、试听、采用/刷新撤回、取消及 48 kHz 重混下载均有证据。证据目录和运行 ID 见下条；本次只更新路线、交接和本档案，检查文档一致性及 diff，不重复声称发生了新的模型生成或用户听感验收。

按要求在接入里程碑收尾并保存记录。音质 V1 整体仍在进行中，新产品样片听感、V2/HRTF 空间接入和真实 SFX 扩展是后续边界；既定固定补句与已听停顿对照不再列为接入前置。

## 2026-09-09 - 已选长文策略接入工作台

用户要求“继续完成工作台接入”。本轮继续 `codex/voxcpm2-product-generation`，产品化已有听感定案；不重新选择补句或停顿方案，不新增顶层路线阶段，旧脏工作树保持原状。

工作台在 VoxCPM2 下增加“长文分组”和本地/外部文本分析。非末组保留目标组、剩余原文和所需固定中性补句，完整生成后只提取目标开头；末组独立生成自然结尾。仅连接处使用分类与实测内部词间隙计算，0 ms 参与组内均值；组内声音/停顿保持，最后一次性调整整体响度。原文最多 500 字符、12 组，超限提示拆分，绝不为凑旧样片长度删原文。

所有组的实际输入、seed、参数、独立干声音频、转写覆盖和截点、停顿来源保存到 runtime。单组重生成复用其他组的素材及原计划，只重跑所选组并形成新整条候选；原候选和工程保留。生成详情及分组试听按需展开，主操作区显示实际分组进度。候选继续显式采用、撤回及 48 kHz 重混。

真实验收暴露并修复：DeepSeek 默认思考耗尽短分析请求的 2048 token 输出额度，官方端点的结构分析单独关闭思考后约 2.2 秒返回有效五组 JSON，旧创意 Planner 行为不变。ASR 粗词时间戳把实际静音算入下一词时，新增有界邻近静音候选及左右独立转写验证；两侧各保留至少 80 ms 实测深静音，再核对最终裁切，不能直接用人工截点或放宽台词覆盖。

运行排他覆盖计划、全部 TTS 与 CPU/int8 离线 ASR；每组最多首次加两次自动重试。ASR 资源故障立即中止，取消等待实际进程退出，迟到退出仍释放自己拥有的锁。候选等待清单锁/原子提交前也检查取消，防止刷新后冒出已取消候选。

真实底噪导致严格深静音不足时，补充检测受绝对 −60 dBFS、低于峰值帧 30 dB 和局部底噪上 6 dB 的共同限制，最多三处候选，与严格检测共用预算。此前两条失败源音频均通过左右及裁后 ASR，完整覆盖率 1，保留尾静音 280 / 135 ms；实际首组重生成也一次成功。没有放宽台词完整度或两侧各 80 ms 保护。末轮检查同时修复首组重生成后顶层参数误用旧记录，并保守继承旧候选的质量提醒。

本轮技术验收完成：**53 个 Vitest 文件 / 465 项测试、23 项 Python 测试、全量 ESLint、包含 TypeScript 的 Webpack 生产构建通过**。原有 Windows native SWC 警告仍在，WASM 回退成功。

- 真实五组完整候选 20.352 秒（清单按 20.36 秒向上保留时间窗），每组 ASR 覆盖率 1；各组尝试次数 `3/2/2/1/1`，连接 `390/390/390/390 ms`。这是新文案的实际结果，不替换旧首选样片五处停顿。
- 首组重生成一次成功，新候选 20.57 秒，其他四组素材 ID 不变，沿用原计划，无额外 LLM 调用；原候选、已采用声音和混音保持。来源参数与警告修复在这些音频生成之后通过回归验证，历史证据未改写。
- 实际整条/单组播放、采用后人声 3 → 20.36 秒且后续呼吸顺延、刷新后撤回、再次采用、23.36 秒 / 48 kHz stereo PCM16 重混、WAV 与工程 JSON 下载通过。下载文件 SHA256 与源混音一致；最终刷新仍保留两个候选、原采用与新鲜混音，所有生成详情默认折叠。
- 桌面/390px 无横向溢出，最终浏览器 error/warn 为空。第一轮真实 UI 取消确认锁释放、候选数为 0、原声未变。截图在 CUA 工具输出中检查，未声称另有截图文件。
- 工作台保留“长文分组接入验收”项目。原五组候选已采用，较新的首组重生成候选保留供比较；未替用户判定新候选为听感优胜。已有书店项目、Planner 草稿与旧脏工作树保留。

证据汇总目录为 `D:\CodexWorkplace\asmr_director_runtime\voxcpm2-longtext-verification\2026-09-09`，入口是 `browser-result.json`、`reroll-result.json`、`cancel-result.json`、`mix-verification.json`、`accepted-project.json`、`downloaded-mix.wav` 和 `final-*.log`。完整/重生原始运行分别为 `voxcpm2-product/long-text/abf9b33d-b5f8-48b1-87e2-fc5b4b686788` 与 `7f500a66-0ec3-4a2c-99f2-a6736d2a1e2d`。本地 Ollama 成功未重新验收，真实成功结构分析使用已配置外部 API。

音质 V1 继续进行中：新工作台样片的主观听感、V2/HRTF 空间接入和真实 SFX 扩展并未由自动检查完成。

## 2026-09-08 - 确认长文接入保留固定补句

用户在了解补全文本的构造后明确表示有必要保留，回忆此前整段生成后面会变快、变尖。记录为长文产品默认条件：非末组采用“目标语义组＋剩余正文＋维持长输入所需的固定中性补句”，完整生成后仅保留开头目标组；末组独立生成真正结尾，不加补句。补句不进入最终文案或成品音频。

本次是保留已有成功组合的产品决策，没有新增音频实验或证明补句的独立因果效果。删除补句不再列为待办或接入前置；旧 16 句 / 177–196 字符是复现记录，不作为所有新文案的硬上限。已同步路线、交接、双语接入设计与试听结论。仅文档变更，按引用、双语一致性和 diff 格式检查验证。

## 2026-09-08 - 补录全短句默认停顿对照反馈

反馈收到日期为 2026-09-08；用户表示此前已听过 `longtext-clause16-opening-default-pauses-20260904` 的“原停顿 vs 全部改成类别默认停顿”，感觉无明显差异，只是忘记反馈。实际试听日期未知，本次未重新试听或运行实验。

该对照不再列为待听，用户未选出新优胜版，不改变 `03_deepseek_class_local_rule.wav` 的当前首选地位。此反馈不能扩写成首尾无截音确认或两版完全等价。仅同步路线、交接、双语接入设计与试听文字记录，未改 READY 或技术原始证据。

## 2026-09-08 - VoxCPM2 单片段正式生成接入

用户在接入设计完成后明确批准“好，开始实施”。本轮在 `codex/voxcpm2-product-generation`（基于准备提交 `a7ba13f`）完成音质 V1 的首个产品切片，没有新增顶层阶段；旧 `.worktrees/audio-quality-v1-round1` 的未提交内容保持原状。

已实现可选 VoxCPM2 原生生成、普通/温柔参考和 Reference-only/Combined 模式；候选独立生成、试听、采用、丢弃，刷新后可撤回最近一次采用。采用前检查内容、归属及真实素材，并先完成本地保存；安全版本保留原工程与 Planner 来源。采用实际人声时长会延长过短片段并顺延后续时间线。修复了无效中间输入引起的工程克隆崩溃，使编辑期间继续保留最后有效存档。

服务端记录实际 seed/参数、CLI/参考身份，限制文本和生成步数，跨进程串行运行；取消等待原生子进程退出再释放锁。候选清单独立保存到运行目录 `assets/candidates/voxcpm2-v1/manifest.json`，不迁移旧原型候选。新增目录锁、原子写入与 Windows 文件占用重试。混音默认 48 kHz，兼容既有 32/44.1 kHz 与原生 48 kHz，并保留 stereo 声道；这不是 V2/HRTF 空间升级。窄侧栏按单列显示引擎/参考/生成和候选操作，技术来源折叠。

验证与修复证据：

- 全量 46 个 Vitest 文件 / 340 项测试、全量 ESLint 和 Webpack 生产构建（含 TypeScript）通过。原有 Windows native SWC 加载警告保留，WASM 回退构建成功。
- 真实 CLI 首次验收暴露 198 MB 可执行文件超过旧 hash 读取上限，已改为流式 SHA256 并补大文件回归。全量测试暴露 Windows 锁文件临时 `EPERM`，已补有界重试和确定性用例；最终全量通过。
- 两种参考模式实际生成同一句中文，Combined 候选 5.6 秒、Reference-only 候选 6.4 秒。独立浏览器检查音频实际播放、生成不自动采用、显式采用后 3 秒规划片段延长、刷新和撤回还原整个时间线。
- 采用 5.6 秒候选并与程序化呼吸混音，得到 8.6 秒 / 48 kHz stereo WAV；浏览器实际下载文件并验证 WAV 格式。桌面和 390px 检查通过，最终浏览器 `errors: []`。最终浏览器复验复用了前面真实生成的候选，没有重复合成。
- 单独实际发起请求并观察原生进程后取消，确认子进程退出、生成锁释放、候选数量维持 2。取消和失败没有替换工程音频。

证据位于 `D:\CodexWorkplace\asmr_director_runtime\voxcpm2-product-verification\2026-09-08`：`browser-result.json`、`real-cancel-result.json`、两份可重跑脚本、`accepted-mix.wav`、`downloaded-mix.wav`、桌面与手机截图。验收使用独立浏览器上下文，未改用户浏览器工程/草稿；本轮未调用外部 Planner API，未读取密钥。开发服务保留在 `http://127.0.0.1:3000`。

首切片技术链路完成，不等于用户耳机听感验收或普遍更柔能力完成。尚未接入：语义长文分组、安全截取、自适应组间停顿、V2/HRTF 空间动作与真实 SFX 扩展；格式检查也不代表自动 ASR 完整度验证。下一切片继续既定长文方案。已同步 `docs/ROADMAP.md`、`docs/AI_HANDOFF.md`、双语接入设计、Web README 与运行依赖说明。

## 2026-09-08 - Planner 本轮验收与版本交接

里程碑已提交并推送：`bd0d058 feat: add ASMR planner and simplify creative workspace`，分支 `origin/codex/step10-product-workflow`。此次推送包含该分支此前尚未推送的本地音质设计/实验交接提交；密钥文件 `.env.local` 保持 Git 忽略，未进入提交。提交前暂存内容格式检查与凭据特征检查通过。

用户明确确认 Planner“暂时算是过了”，要求记录推送，再准备把 VoxCPM2 接入正式生成。当前代码、DeepSeek 真实生成/单段改写/采用链路与前端信息精简作为本轮验收成果；这不代表本地 Ollama 内存问题或通用文案艺术质量已经解决。相应事项转为后续跟进，不再阻挡音质主线。

本版包含 Planner 领域约束、Ollama/外部 API、独立草稿保存、单段改写与撤回、安全采用和策划来源版本恢复；人声实际 WAV 时长与 Planner 时间线顺延；以及策划/工程视图去杂。此前验证记录为 34 文件 / 260 测试通过，最终布局调整后 9 项 Planner 组件用例、全量 ESLint、TypeScript 和生产构建通过；DeepSeek 与桌面/手机验收见下方记录。2026-09-08 的留档整理未新增模型调用或生成人声。

优先级按用户指令转回 Audio Quality V1，准备把本机 VoxCPM2 作为现有 Generation Bridge 的可选人声引擎，保留 GPT-SoVITS、普通/温柔参考、参考音频/参考文本模式与候选试听、采用、撤回、重混。当时尚未收到反馈的全短句停顿对照不作为基础接入前置，也不冒充已采用方案；2026-09-08 后续已补录“无明显差异、无新优胜版”的反馈，见上文。尚未接入的 VoxCPM2、空间实验与真实 SFX 仍保持未完成。

### VoxCPM2 接入准备结果

已新增双语 `docs/superpowers/specs/2026-09-08-voxcpm2-product-integration-design.md` / `.zh.md`，并同步路线和交接。首个产品切片明确为可选引擎/参考模式、单个人声候选生成与比较、显式采用/持久化撤回、真实时长保护、48 kHz 兼容混音与导出；后续接已选长文方案和既有空间/真实音效主线。接入设计不构成新顶层阶段，也不宣称声音质量已经通用稳定。

两路只读核查覆盖主线接入点与本地运行材料。确认 VoxCPM2 原生 CLI、双 GGUF、普通/温柔参考及 profile 存在；CLI hash 与接受样本记录一致。旧 `codex/audio-quality-v1-round1` 工作树（HEAD `46d26d7`）已有候选与 48 kHz/空间基础，但包含大量未提交改动和未跟踪的 Vox provider/profile，后续须选择性移植。旧 2026-07-29 integration-result 是原型证据，不能当作当前主线接入成功。

准备中识别的必要适配：Combined 同时传参考与 prompt、转录尾空格、low-VRAM/步数上限、取消和串行排他；当前 Planner 的实际时长/来源保护；候选采用指纹和跨刷新撤回；32/48 kHz 兼容和 stereo 保留。长文固定实验仍含人工替换/裁切，辅助 ASR 环境的旧 Scripts/python 路径已失效；这些边界已写入设计。本次没有改动旧工作树、读取密钥、调用模型或启动音频服务。文档变更按文件存在、关键路径/引用、双语范围与 diff 格式检查验证；没有把此前测试当成本次新运行的结果。

## 2026-09-07 - 前端信息精简

用户在功能基本可用后明确指出：前端充斥无意义信息，很多内容更像团队内部设计注意事项。本轮依此整理当前 Planner 和工程界面，不新增功能阶段或改变音质路线。

采用的界面规则：默认主界面只提供当前任务的操作与创作内容；技术数据按需展开。删除营销式介绍、步骤号、实现解释、重复的成功/状态提示，保留实际错误、必要保存状态以及外部调用的数据发送/费用提示。

已调整：

- 策划视图使用独立的“创作工作台”头部，宽屏以主题/要求与正文两栏呈现；窄屏依次排列。右侧工程详情和工程导入/导出/重置仅在工程编辑中出现。
- 场景与角色、每段导演/音效/表演参数、项目原稿载入改为按需展开；正文、单段改写、撤回、下载和采用入口保留。
- 项目侧栏默认收起，手机上收起后通过头部“项目”按钮展开，避免首屏被项目列表占满；去掉当前工程重复卡片，工程头部去掉显眼 ID、语言、重复元数据与正常校验标签。
- 编辑器去掉开发说明和重复素材状态；技术生成字段及素材详情折叠。历史版本、工程信息和完整音频检查按需查看。
- 预览去掉统计卡、占位波形与空轨列表，保留生成/试听/WAV、实际进度和非空轨的展开入口；失败、需重混与真实音频问题继续可见。

范围与数据边界：仅调整展示与文案，没有领域或 Provider 逻辑变更；保留用户当前 5 段 / 203 字草稿和已有工程，本轮不为界面验收触发任何模型 API。

本轮验证：全量 260 项测试通过；最后排版调整后 9 项 Planner 组件用例、全量 ESLint、TypeScript 与 Webpack 生产构建通过。浏览器核对刷新前后稿件逐字段一致，策划视图没有右侧工程 dock，导演与声音/单段改写入口可正常展开；1280px 工程编辑与预览操作仍可见，390px 手机页面宽 380px 无横溢。14:47 编辑过程中的临时 JSX 错误已修复；14:56 UTC 后最终刷新与交互没有新增 error/warn。已恢复正常窗口尺寸并保留策划页。

## 2026-09-07 - DeepSeek V4 配置与真实浏览器验收

用户希望使用自己的 DeepSeek V4 API，并已在本机 `.env.local` 填入密钥。服务目录确认外部 API 配置齐全，模型为 `deepseek-v4-pro`；Next dev 自动加载配置，刷新页面即可，无需重启。密钥文件保持 Git 忽略，未读取或回显密钥内容。

本次两次浏览器 Planner 请求分别完成整稿生成与第 4 段改写（未记录服务器内部修复次数，不能据此推算精确上游调用量或费用）：

- 使用用户页面上的“深夜书店，店员陪伴刚下班的客人，温柔自然，多一点翻书动作，少一点说教。台词口语化”，目标 3 分钟，生成《深夜书店的翻书声》，6 段、380 字。
- 第 4 段按“保留调灯与靠垫、更自然口语、删除不自然指令”改写后，仅该段台词与导演提示变化；其他文本字段不变。撤回逐项恢复原稿，再通过手工编辑保留改写台词与导演提示，最终 367 字。
- 采用创建 `asmr_planner_20260907_142342`，6 段待生成人声、估算 02:55、项目校验通过；原雨夜项目保留并有 1 个安全版本。
- 刷新后工程、草稿与外部 Provider 恢复；载入工程策划来源与保存草稿逐字段一致。390px 长文案无横溢，桌面视图已恢复，浏览器 error/warn 为空。
- 导出按钮已触发，下载 JSON 内容未在本轮浏览器检查；相关结构边界仍依据自动测试。没有生成人声或音效。本轮无产品代码改动，沿用此前 260 项测试及 lint/typecheck/build 通过的记录。

外部 API 创作流程可用。本地 Ollama 成功验收仍受内存故障影响；双语设计仍要求本地成功，因此阶段保留 In progress。单个真实主题不代表普遍文案艺术质量已获用户认可。下方失败与审批记录是此前历史，不能再视为外部 API 的当前障碍。

## 2026-09-07 - AI 创意策划 V1 实施与验收（外部 API 接入前）

用户在项目状态评估后明确批准实施：主题输入 → 策划草稿 → 分段改写 → 采用工程。近期优先级切换到 Planner，音质 V1 保留进行中；没有新编号 Step 11。中英文设计见 `docs/superpowers/specs/2026-09-07-llm-planner-v1-design.zh.md` / `.md`。

已实现：

- 工作台策划/工程视图切换，完整中文文案草稿、手工修改、单段 AI 改写、取消、撤回和文案下载。
- 默认本地 Ollama，服务器配置的外部 JSON-mode API 可选；模型输出严格校验、最多一次结构修复、超时/取消、输入输出上限、安全错误信息。
- 独立工作草稿保存，区分表单设定和原稿来源；采用创建新工程并保留旧项目安全版本。
- 项目库与版本保存策划来源；重置/导入替换清除旧来源，恢复版本同时恢复对应来源。Project JSON 不混入这些元数据。
- 真正读取 voice WAV 时长，Planner 工程自动延长过短人声与后续时间线；并发 voice 生成只忽略起点变化，文本/时长/参数变更继续拒绝旧结果。
- 修正旧测试未收窄 voice 类型导致的 TypeScript 错误；修正生产 SSR 初始项目时间戳引发的 hydration 差异；本地 IPv4 开发预览配置允许精确的 127.0.0.1 来源。

验收状态：代码与自动验证已推进，真实 LLM 出稿尚未验收成功。现有 qwen3:1.7b 的 GPU 和最小 CPU 请求均发生内存分配失败，证据在 `D:\CodexWorkplace\asmr_director_runtime\planner-verification`。Ollama 重启与独立 fixture app 启动被自动审批拒绝，仅给出 `blocked by policy`，未绕过；已异步请用户手动重启 Ollama。真实模型、文案艺术质量与完整模型到浏览器成功链路仍需补验，不能把 fixture 或单元测试当作真实出稿。

浏览器已检查策划入口、表单编辑、空主题禁用、外部未配置提示、请求失败、取消和主题刷新恢复；1280px 桌面及 390px 手机无页面横向溢出。生成后的稿件交互另用进程内组件测试验证。用于验证的额外生产预览与 fixture 服务已按确切路径/命令行核实后清理，用户其他服务未停止。

最终自动检查：34 个 Vitest 文件 / 260 项测试通过，其中 9 项 React StrictMode 组件测试覆盖生成、单段改写、取消后迟到响应、失败保稿、人工编辑与采用、原稿主题、撤回和保存恢复。全量 ESLint、TypeScript、`npm.cmd run build --prefix apps/web -- --webpack` 与 `git diff --check` 通过。Windows native SWC 仍有既有加载警告，构建使用 WASM 并正常退出。组件测试只模拟 Provider HTTP 响应，不作为真实 LLM 或文案质量验收证据。

## 2026-09-07 - 音频质量 V1 独立实验交接

本轮对应已经批准的“人声导演与真实 ASMR 音效质量 V1”。状态为 `In progress`：独立试听已选出当前温柔中文长文本方案，但 VoxCPM2、语义分组、自适应停顿和改进空间方案都尚未接入 checked-in 产品；工作台目前仍使用 GPT-SoVITS 人声和程序合成非语音兜底。

用户确认的方向：

- 优先解决实际听感，不把 adapter、API route 或 UI 外壳当成音质成果。
- 免费、本地优先；付费方案暂缓；不要求用户重新录音。
- VoxCPM2 保留为可选人声引擎。对当前温柔中文参考，它整体明显优于现有 GPT-SoVITS 结果，但通用 `soft` / `whisper` 指令仍不稳定。
- 正常/温柔参考、Reference-only/参考文本模式应在未来生成界面中允许用户选择。
- “更近”采用贴耳说话姿态重生成与 V2 空间处理的组合；直接“朝左耳说/朝右耳说”的干声没有方向差异，左右与环绕必须由空间层完成。
- 程序噪声保留为明确标注的 SFX 兜底，真实 ASMR 音效的种类与质量仍是未完成主线。

当前温柔中文长文本首选：

`I:\AI\voxcpm2-evaluation\listening\longtext-deepseek-class-local-pause-20260904\03_deepseek_class_local_rule.wav`

方案要点：

1. 本地 VoxCPM2 GGUF、`gpu_layers=0` / low-VRAM、温柔中文参考；准确参考文本的标点全部换为空格，末尾保留一个 ASCII 空格。第 1–5 组来源使用 `seed=7901`、`max_steps=420`，真结尾来源使用 `seed=8201`、`max_steps=220`；其余核心参数均为 `cfg=2`、`timesteps=10`、`temperature=1`。这些值用于复现本次成品，不是产品固定默认。
2. 六组结构最初由本地 Ollama `qwen3:1.7b` 给出，DeepSeek V4 后来独立复核得到相同结果：`1–3 / 4–5 / 6–8 / 9–10 / 11–12 / 13–16`。
3. 每次把“当前语义组”放到剩余长文本开头，完整生成后只截取开头的当前组；不是把组作为孤立短文本生成。原实验还在剩余正文后补固定中性延续句，使每次输入都维持约 177–196 字的长上下文；该补齐是否必要尚未单独验证。最后一组单独生成真正结尾，实际文本为 `……我会一直陪在这里……不催促你，也不会突然离开，直到困意自然地靠近。`，仍包含句首省略号和“这里”后的连接省略号。
4. 当前成品第 1–5 组均来自 seed7901 的长开头生成，其中第 5 组因读音问题，改用从第 9 句开头的连续长生成中截取的中段；第 6 组使用已认可的 seed8201 结尾。这些 seed 只记录本次成品来源，不是建议锁定的全局默认值。
5. 当前 class-local 成品只重定时 5 个语义组间连接；组内 10 个短句停顿保持 VoxCPM2 原样，只用于测量和兜底。DeepSeek 给短/中/长停顿类别；实际毫秒优先由前后两组内部停顿计算，越界时才找同类样本，仍无样本才使用默认 `180 / 350 / 600 ms`。不得把这条方案自动扩大成重排全部 15 个短句边界。
6. 本次五处组间边界全为中停顿，最终为 `350 / 350 / 350 / 440 / 290 ms`。用户认为固定默认版与局部版都自然，综合选择局部版，因为更自适应。

技术证据：

- 试听包 READY、音频哈希、48 kHz mono PCM16、16/16 ASR、无削波均通过。
- 三个停顿版本使用完全相同的六组人声 PCM，只改变组间全零静音。
- 主要记录：`I:\AI\voxcpm2-evaluation\evidence\LISTENING_RESULTS.zh.md`、`longtext-deepseek-v4-pause-classes.json`、`longtext-deepseek-class-local-pause-measurement.json`、`longtext-clause16-long-openings-generation.json`、`longtext-api-semantic-hybrid-final-generation.json`。
- 中英文评估报告已同步：`docs/superpowers/specs/2026-07-26-voxcpm2-evaluation-design.md` 与 `.zh.md`。

当时尚未收到试听反馈（2026-09-08 已补录，见上文）：

`I:\AI\voxcpm2-evaluation\listening\longtext-clause16-opening-default-pauses-20260904`

- 01 是旧 `03_long_generation_first_clause_only.wav` 原样对照；02 是 15 个短句边界采用类型默认值的安全重定时版。
- 02 没有重新 TTS 或改增益；它安全裁除 1525 ms 已验证低能边缘、补入 700 ms 全零静音，并在保护区内做 10 ms 淡变。
- 自动检查覆盖 16/16、无削波、正文 PCM 不变；当时尚未收到用户反馈。2026-09-08 用户补充此前已听、感觉无明显差异，未选新优胜版，也未单独确认首尾无截音。

未完成与风险：

- 当前最佳是一个参考、一个文本和人工挑选候选下的结论，不是通用最优，也不是稳定的一键流程。
- 长文本仍会随机出现吸气、电流音、后半段变尖、语速或音色漂移；必须生成多个候选并做自动与人工质检。
- DeepSeek 是可选外部服务，可能产生费用；产品必须保留本地分组与固定停顿兜底。
- VoxCPM2 尚未注册进 Generation Bridge；实验私有参数不能直接扩散进 Timeline DSL。
- 空间实验仍是独立脚本，真实 SFX 扩展尚未完成。
- `longtext-local-tempo-pause` 及其 rejected 归档使用了用户未要求的语速/每字毫秒逻辑，已作废；其中一个归档 READY 仍写 `ready`，后续必须忽略，不能误当候选。

当时的下一会话计划是先记录上述 01/02 的用户试听结果，再为当前 VoxCPM2 方案写产品接入设计并实现实验选项；该反馈已于 2026-09-08 补录，不再作为后续问题。当时产品尚无多候选存储/面板和显式采用/撤回流程，需要落实已批准设计中的这些边界，并复用现有 Generation Bridge、稳定资产、播放预览、项目版本和重混基础设施。无需再次询问是否批准音频质量方向，也不得把整个阶段写成完成。

## 2026-07-12 - Roadmap Step 10 产品工作流硬化完成

本轮在第 7-9 步真实生成与真实混音成立后，完成了固定 roadmap 的最后一步。设计选择本地优先产品闭环，没有把云端、账号、计费、发布或协作伪装成已经完成的本地能力。

设计与计划：

- `docs/superpowers/specs/2026-07-12-product-workflow-hardening-design.md`
- `docs/superpowers/specs/2026-07-12-product-workflow-hardening-design.zh.md`
- `docs/superpowers/plans/2026-07-12-product-workflow-hardening.md`

已完成内容：

- 新增 `ai-asmr-studio:v1:project-library` 本地项目库，自动迁移旧 `ai-asmr-studio:v0:project` 单项目数据。
- 左侧项目栏从占位文案升级为真实项目列表，支持新建、切换、复制和删除；删除最后一个项目被禁止。
- 新增版本记录：手动 `留版本`，切换/覆盖/重置/恢复前安全版本，内容去重，每项目最多 12 个，右栏显示最近 5 个。
- 项目库元数据保持在 Project JSON 之外；导出的 Timeline DSL 不包含项目列表、revision、waveform、analysis 或 runtime job。
- 新增 `GET /api/assets/analysis`，只接受本地 `asset://clip/...` / `asset://mix/...`，解析 PCM16 WAV 并返回真实 peak bars、时长、采样率、声道、peak/RMS dBFS 和削波采样数。
- Preview Layer 在真实资产存在时显示真实波形；无资产时才显示待生成占位。
- 右侧详情新增质量检查，覆盖项目 schema、片段素材、mix 新鲜度、音频分析、声道和峰值余量。
- 本地保存失败会显示 `本地保存不可用`；不再把内存态误报成已经持久化。
- 成功 mix fingerprint 写入项目库元数据并随项目切换/重载恢复；未知 fingerprint 保守显示 `需重混`，但旧 WAV 仍可试听/下载。

独立代码审查与修复：

- 审查发现并修复本地保存失败误报、项目切换丢失 mix 新鲜度、同 ID 导入覆盖非当前项目无安全版本三项数据完整性问题。
- 同时补齐 revision parent project ID 不变量、analysis API 缺参数 400、精确 PCM 饱和判断和全范围 `git diff --check`。
- 每项行为先增加失败测试，再实现修复。

浏览器验收：

- 新建项目后项目数由 1 变 2，原项目自动产生“切换前”版本。
- 手动留版本后把选中 clip 音量从 `-31` 改为 `-20`，恢复后回到 `-31`，同时新增“恢复前”版本。
- 复制项目后项目数变为 3，副本使用独立 collision-safe ID。
- 真实 showcase mix `asset://mix/showcase_step9_mix_001_wav_20260711T210548715Z_c39775de` 显示 64 段真实波形，其中 19 段非零；分析为 32.0kHz、32.0 秒、stereo、peak `-6.1 dBFS`、RMS `-35.2 dBFS`。
- 未持久化 fingerprint 的导入 mix 会显示 `项目已修改，需重混`，同时真实 waveform/技术分析仍可用。
- 桌面专注模式折叠后布局为 56px / center / 56px；390px 窄屏左右区域按全宽顺序排列；均无横向溢出。
- 桌面与窄屏浏览器 console error/warning 均为空。

自动化验证：

- `npm.cmd run test --prefix apps/web`：29 个 test files、184 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过；已知 SWC native binding warning 仍存在，但 Webpack/WASM build exit code 为 0。
- `git diff --check 2e27aa3502148aee8006e7ba1d048f5e86f0d63b`：通过。

路线状态：

- `docs/ROADMAP.md` 的固定 10 步现已全部完成。
- 没有批准的 Step 11。下一阶段必须由用户选择并批准，agent 不能把候选方向自行写成新 roadmap。
- 云端持久化、账号、计费、发布、协作仍是未来可选产品化方向，不属于本轮已实现能力。

## 2026-07-12 - Roadmap Step 9 真实项目混音与导出完成

本轮把第 9 步从“手动 runtime 整段试听实验”推进到产品内接线：工作台现在可以把已经生成的 `asset://clip/...` clip assets 按 Project Timeline DSL 混成真实 `asset://mix/...` WAV，并在 Preview Layer 提供整段试听和 WAV 下载入口。

已完成内容：

- 新增 mix asset 存储约定：`asset://mix/<id>`，默认落盘到 `D:\CodexWorkplace\asmr_director_runtime\assets\mixes\app`，通过 `/api/assets/mix/<assetId>` 读取。
- 新增 project mix readiness / export state / fingerprint helpers，只有所有现存 voice、breath、sfx、ambience clip 都已经生成且拥有本地 `asset://clip/...` 时，才允许生成整段 mix。
- 新增 `renderProjectMixWav`：读取本地 PCM WAV clip，按 start/end、gain、fade、pan、distance、movement、ambience loop、target LUFS 和 limiter 混成 stereo PCM16 WAV。
- 新增 `/api/generation/mix`，用于从完整 Project JSON 生成真实 WAV mix；缺少 clip asset 时返回 409 missing assets，而不是假装成功。
- 扩展 generation bridge / local bridge / mock bridge / runtime job store，让 full-project mix 与 selected clip generation 共用同一套 job snapshot、cancel、running/error/success 状态语义。
- Preview Layer 增加整段控制：`生成整段`、`重混`、`试听`、`WAV`、`取消`。编辑 timeline 或 director preset 时，会取消当前活跃的 project mix job，避免旧 mix 被误认为当前版本。
- `docs/ROADMAP.md` 已把 Step 9 标为 Completed，把 Step 10 标为 Current / Next；`docs/AI_HANDOFF.md` 已同步当前能力、验证证据和下一步协议。

验证证据：

- `npm.cmd run test --prefix apps/web`：25 个 test files、158 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过，0 warnings。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过；仍有已知 SWC native binding warning，但 exit code 为 0。
- 本地 dev server 已在 `http://localhost:3000/` 启动，`Invoke-WebRequest http://localhost:3000/` 返回 HTTP 200。
- API 级真实 mix 验证：用一个 schema-valid 的最小项目和一个已生成本地 clip WAV 调用 `POST /api/generation/mix`，得到 `asset://mix/step9_verify_project_wav_20260711T203915972Z_697118df`；随后 `GET /api/assets/mix/step9_verify_project_wav_20260711T203915972Z_697118df` 返回 `audio/wav`、`128,044` bytes、WAV header `RIFF`。

边界与后续：

- 这次 API 验证没有重新跑 GPT-SoVITS；它复用了一个最小本地 generated clip asset 来验证 Step 9 的 app 内混音和导出链路。
- Step 9 已经不是“Do Not Do Yet”或“未来要做”；后续工作必须基于现有 `asset://clip/...` 与 `asset://mix/...` 合约继续推进。
- 下一步应按 `docs/ROADMAP.md` 进入 Step 10：产品工作流硬化。Step 10 很大，正式编码前需要先拆成小 scope，例如 project library/local project list、真实 waveform rendering、quality/readiness checks、version/history、export workflow polish 等。

## 2026-07-12 - Step 9 整段混音样例生成

用户要求“生成一个我看看”后，本轮没有新增代码，而是直接通过已经接好的本地 mix API 生成了一段可试听样例，证明 Step 9 的真实混音链路能被实际调用。

样例内容：

- 请求入口：`POST http://localhost:3000/api/generation/mix`。
- 项目 ID：`showcase_step9_mix_001`。
- 项目时长：`32s`。
- 复用的本地 clip assets：
  - `asset://clip/voice_001_20260706T211523064Z_d3b95513`
  - `asset://clip/breath_001_20260706T213815920Z_b55ae7b8`
  - `asset://clip/sfx_blanket_001_20260706T213816276Z_0089677d`
- 生成结果：`asset://mix/showcase_step9_mix_001_wav_20260711T210548715Z_c39775de`。
- 本地文件：`D:\CodexWorkplace\asmr_director_runtime\assets\mixes\app\showcase_step9_mix_001_wav_20260711T210548715Z_c39775de.wav`。
- 本地试听 URL：`http://localhost:3000/api/assets/mix/showcase_step9_mix_001_wav_20260711T210548715Z_c39775de`。

验证证据：

- `GET /api/assets/mix/showcase_step9_mix_001_wav_20260711T210548715Z_c39775de` 返回 `audio/wav`。
- 文件大小：`4,096,044` bytes。
- WAV 文件头：`RIFF`。
- `git status` 仍然干净，说明 runtime 生成物没有混入 repo。

边界：

- 这次样例没有重新调用 GPT-SoVITS；它复用了已有 voice / breath / sfx clip WAV 来生成整段 mix。
- 这次样例也没有写回当前浏览器页面里的 Project JSON，只是通过 API 验证和给用户试听。
- 如果后续要让用户在 UI 里看到同一段 mix，需要在工作台里对当前项目逐个生成素材后点击 `生成整段`，或实现 Step 10 的项目库 / 项目状态持久化能力。

## 当前一句话定位

AI ASMR Studio 不是一个普通的“AI ASMR 生成器”，而是一个 **AI ASMR 导演台**。

它的核心价值不是给用户一段黑盒音频，而是给用户一个可编辑、可重生成、可导出、可逐步沉淀为创作者资产的音声工程。

## 已有档案

- `docs/asmr导演早期设计.md`：早期产品定位、MVP 假设、技术路线、风险、商业化方向。
- `docs/superpowers/specs/2026-06-13-v0-1-dsl-first-design.md`：V0.1 DSL-first 产品设计。
- `docs/superpowers/plans/2026-06-13-v0-1-dsl-first-app.md`：V0.1 实施计划与验收清单。

## 已达成的核心共识

### 1. 产品差异化

产品不拼底层模型数量，而是拼“导演层”：

- 时间线 DSL。
- ASMR 分镜。
- 情绪曲线。
- 双耳空间调度。
- 自动质检。
- 局部重生成。
- 创作者导出。

用户应该感觉自己是在导演 AI 声优和音效工程，而不是在抽卡生成音频。

### 2. V0.1 路线

V0.1 采用 `C -> A -> B` 的路线：

1. 先做核心资产设计：`ASMR Project JSON`、`Timeline DSL`、clip schema。
2. 再做产品体验原型：mock 数据、导演分镜、轻量时间线、JSON 导出。
3. 最后再接真实技术闭环：LLM、TTS、SFX、混音、质检、音频导出。

原因是 Timeline DSL 是导演台中枢。只要 DSL 稳，后续模型和音频链路可以替换，产品层不需要摇晃。

### 3. V0.1 非目标

V0.1 不做完整 DAW，不接真实 TTS/SFX，不做真实 MP3/WAV 导出，不做用户系统、付费、审核后台或复杂协作。

V0.1 的重点是验证：一个结构化 ASMR 工程是否能被清楚展示、保存、重新加载和导出。

### 4. 视觉方向

我们定下来的视觉方向是：

> **以 Studio Console 作为底盘，少量吸收 Ambient Director 的氛围。**

具体含义：

- 页面首先要像专业创作工具，不像营销页、玩具 demo 或普通后台表格。
- 第一屏要能看到 AI ASMR Studio、分镜、时间线和当前片段状态。
- 信息密度可以高，但层级要清楚。
- 氛围可以有雨夜、微光、声波、玻璃感或空间感，但只能服务内容，不能喧宾夺主。
- 避免大面积纯紫、纯蓝、纯渐变和装饰堆叠。
- 漂亮来自布局、层级、状态、细节和克制，不来自堆视觉特效。

## 当前 V0.1 已完成内容

### 工程结构

- 使用 Next.js App Router、TypeScript、Tailwind CSS、Zod、lucide-react、Vitest。
- 前端应用位于 `apps/web`。
- 当前页面运行入口是 `apps/web/src/app/page.tsx`。
- 当前主交互组件是 `apps/web/src/components/studio/studio-app.tsx`。

### 数据层

已完成 ASMR Project JSON / Timeline DSL 的 Zod schema：

- 项目状态：`draft`、`planning_failed`、`timeline_invalid`、`ready_for_preview`、`export_failed`。
- 资产状态：`asset_pending`、`asset_generating`、`asset_generated`、`asset_failed`。
- 固定轨道：`voice`、`breath`、`sfx`、`ambience`、`post_processing`。
- clip 字段：时间、时长、音量、淡入淡出、声像位置、生成状态、资源引用。
- voice clip 额外包含台词、情绪、风格、语速。
- sfx / ambience / breath clip 使用同一套时间线和空间参数。

额外校验已经加入：

- timeline 必须包含且只包含每种固定轨道各一个。
- emotion curve 的 `end` 必须大于 `start`。
- emotion curve 不能超出项目总时长。
- clip 的 `start` 和结束时间不能超出项目总时长。
- pan 必须在 `-1` 到 `1` 之间。

### Demo 数据

当前 mock 项目是“雨夜睡前陪伴”：

- 目标时长：210 秒。
- 场景：雨夜卧室。
- 角色：年上姐姐 / gentle / mature / comforting。
- 情绪曲线：`gentle_intro` -> `comforting` -> `sleepy_whisper` -> `fade_out`。
- 轨道包括人声、呼吸/轻笑、ASMR 音效、环境雨声和后期处理占位。
- 当前所有音频资产保持 `asset_pending`，明确表示 V0.1 只是工程预览，不假装已经生成真实音频。

### UI 页面

当前页面是一个 Studio Console：

- 顶部项目栏：项目名、状态、时长、语言、LUFS、JSON 导出。
- 左侧 Director Storyboard：按时间顺序展示所有可听事件。
- 中间 Timeline：按固定轨道展示 clip 块。
- 中间 Emotion Curve：展示情绪节奏分布。
- 右侧 Clip Inspector：展示当前选中片段的内容、时间、声像、音量、模型状态。

Storyboard、Timeline、Inspector 都从同一份 `demoProject` / Timeline DSL 渲染，不维护各自的数据副本。

### 交互

- 可以从 Storyboard 或 Timeline 选择 clip。
- 选中状态会同步更新到 Inspector。
- Export JSON 会导出当前项目 JSON，文件名使用 `project_id`。

### 浏览器验收

已在浏览器中检查：

- 桌面端第一屏能看到 AI ASMR Studio、storyboard、timeline、inspector。
- 页面没有文档级横向溢出。
- Storyboard 和 Timeline 的选中状态清楚。
- 移动端 header 能换行，storyboard 优先显示。
- 移动端长中文行能换行，timeline 和 emotion curve 使用内部横向滚动。
- Export JSON 按钮点击无控制台错误。

## 当前验证状态

最后一次验证通过：

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

结果：

- 测试通过：2 个 test files / 14 个 tests。
- lint 通过。
- build 通过。
- build 期间出现本地 `@next/swc-win32-x64-msvc` Win32 warning，但 webpack/WASM fallback 构建成功。
- git working tree 干净。

## 关键提交

- `a7caffb feat: define asmr project schema`
- `1854c4a feat: add demo project and timeline helpers`
- `4a5943f style: add studio visual foundation`
- `22a98e3 feat: build studio console components`
- `745350d feat: render v0 studio prototype`
- `0b169d4 polish: verify studio console layout`
- `11e96bc fix: validate timeline ranges`
- `7a97e73 docs: add v0 studio planning artifacts`

## 下一步方向

推荐下一步做 V0.2 的“编辑闭环”。

优先顺序：

1. 可编辑 Inspector：修改台词、情绪、语速、音量、声像、时间参数。
2. 本地状态管理：编辑后 storyboard、timeline、inspector 和 export JSON 同步更新。
3. 实时 schema 校验：错误直接显示在界面上。
4. JSON 导入/重置：支持把项目 JSON 重新载入页面。

这一步会把当前“漂亮的 DSL 预览台”推进成真正可用的“ASMR 时间线编辑台”。

## V0.2 编辑闭环进展

已启动 V0.2 的前半步：可编辑 Inspector + 本地项目状态同步 + 实时 schema 校验。

本轮新增设计与计划：

- `docs/superpowers/specs/2026-06-14-v0-2-editing-loop-design.md`
- `docs/superpowers/plans/2026-06-14-v0-2-editing-loop.md`

已实现内容：

- `StudioApp` 维护可编辑的本地 project state。
- `ClipInspector` 支持编辑当前 clip 的文本、时间、时长、音量、pan、距离和移动方式。
- voice / breath / sfx / ambience clip 都有对应的类型字段编辑入口。
- Storyboard、Timeline、Inspector、Validation Panel 和 Export JSON 都从同一份可编辑 project 渲染。
- `ValidationPanel` 实时显示项目是否通过 schema 校验；非法时间范围会显示具体路径和错误信息。
- `Export JSON` 会导出编辑后的 project，而不是初始 demo project。

浏览器交互验收覆盖：

- 选择 voice clip 后修改台词，Storyboard 和 Inspector 同步显示新台词。
- 输入非法 duration 后显示 `timeline.tracks.0.clips.0.duration` 校验错误。
- 恢复合法 duration 后重新显示 `Project valid`。
- 导出的 `asmr_demo_001.json` 包含编辑后的台词。
- 桌面和 390px 移动视口没有文档级横向溢出。

## V0.2 项目持久化进展

已补齐本地项目闭环：自动保存/恢复、粘贴 JSON 导入、Reset Demo、dirty/restored 状态。

本轮新增设计与计划：

- `docs/superpowers/specs/2026-06-14-v0-2-project-persistence-design.md`
- `docs/superpowers/plans/2026-06-14-v0-2-project-persistence.md`

已实现内容：

- `project-persistence.ts` 提供 project 序列化、导入解析、localStorage 读取/保存/清空 helper。
- `StudioApp` 页面加载后从 `localStorage` 恢复最近项目。
- 编辑 project 后自动保存到 `ai-asmr-studio:v0:project`。
- `ProjectControls` 支持粘贴 JSON、Load JSON、Reset Demo。
- 导入非法 JSON 时显示错误，并保留当前 project。
- Reset Demo 会恢复内置 demo，并清除本地保存影响。
- Project Controls 显示 `Demo`、`Edited` 或 `Restored from browser` 状态。

浏览器交互验收覆盖：

- 编辑台词后刷新页面，编辑内容仍保留。
- Reset Demo 后恢复原始台词，刷新后仍保持原始 demo。
- 导入合法 JSON 后标题和台词更新。
- 导入非法 JSON 后显示 `Import JSON could not be parsed.`，当前 project 不被覆盖。
- 导出 JSON 包含当前导入后的 project 内容。
- 桌面和 390px 移动视口没有文档级横向溢出。

## AI 交接文档结构

为了方便未来其他 AI 续写项目，也方便上下文压缩后快速恢复状态，项目新增双层记忆结构：

- `docs/AI_HANDOFF.md`：高信号接手入口。新的 AI agent 或压缩后的会话应先读它。
- `docs/project-archive.md`：历史档案。记录更完整的产品判断、阶段进展和决策过程。

这避免把所有信息都堆进一个越来越长的 archive。`AI_HANDOFF.md` 只保留当前状态、关键文件地图、验证命令、最近提交和下一步推荐；`project-archive.md` 继续保留上下文和演进历史。

## V0.3 Director Actions 进展

已完成一轮“导演意图按钮”能力，把 raw field editing 往更像导演台的交互推进了一步。

本轮新增设计与计划：

- `docs/superpowers/specs/2026-06-16-v0-3-director-action-presets-design.md`
- `docs/superpowers/plans/2026-06-16-v0-3-director-action-presets.md`

已实现内容：

- voice clip 的 Inspector 中显示 Director Actions：`Softer`、`Closer`、`Left`、`Right`、`Pause`、`Quiet`。
- `director-presets.ts` 用纯函数把按钮意图转成确定性的 Timeline DSL 修改。
- `Pause` 对已经以 ` ...` 结尾的文本保持幂等，避免重复点击导致不可见的 duration 漂移。
- 非 voice clip 不显示 Director Actions，避免把人声导演意图误套到 SFX / ambience / breath。
- 相关行为已补测试；当前 handoff 记录的最新验证为 5 个 test files / 34 个 tests。

## 字段级校验高亮进展

已完成当前路线中的第一项：把 schema validation issue 精确连回当前选中 clip 的 Inspector 字段。

本轮新增设计与计划：

- `docs/superpowers/specs/2026-06-16-field-level-validation-highlighting-design.md`
- `docs/superpowers/plans/2026-06-16-field-level-validation-highlighting.md`

已实现内容：

- `edit-project.ts` 新增 `getClipFieldValidationIssues`，把 `timeline.tracks.N.clips.M.duration` 这类路径映射为 Inspector field key。
- 支持映射当前可编辑字段，包括 `start`、`duration`、`volume_db`、`position.pan`、`position.distance`、`position.movement` 和各 clip 类型字段。
- `StudioApp` 从现有 `validationIssues` 派生当前选中 clip 的 field issue map。
- `ClipInspector` 对有问题的字段显示 amber 错误态、`aria-invalid`、`aria-describedby` 和紧凑 inline message。
- 全局 `ValidationPanel` 保留完整项目 issue 列表，字段级提示只负责就地定位。

实现中修正了一个 TypeScript build 问题：嵌套函数中直接读取 `selectedClip.id` 时，TypeScript 不接受 early return 后的闭包收窄；改为提前捕获 `selectedClipId` 后 build 恢复通过。

验证覆盖：

- `npm.cmd run test --prefix apps/web`：5 个 test files / 38 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过；本地 SWC warning 仍可能出现，但 webpack/WASM 构建完成。
- 浏览器验收：非法 duration 高亮 Duration 字段并显示 inline error；非法 pan 高亮 Pan 字段；恢复合法值后字段错误清空；Validation Panel 仍显示全局 issue；桌面和 390px 移动视口无文档级横向溢出。

## 当前初步路径（2026-06-16）

这条路线是当前共识；`docs/AI_HANDOFF.md` 保留更短、更适合上下文恢复的高信号版本。

1. 字段级校验高亮：已完成，当前选中 clip 的 Inspector 字段会显示对应错误态，同时保留全局 Validation Panel。
2. 轻量时间线编辑：下一步，支持 start/duration 微调、插入 pause 等小动作，但暂时不做完整 DAW 拖拽系统。
3. 项目结构升级：补更清楚的 project shell、元数据和未来项目列表空间，继续保持本地优先。
4. 真实音频前的预览层：先做占位播放状态、波形/状态位和生成槽位，让流程像音频产品，但不假装已经有真实音频。
5. 真实生成链路：等导演工作流和 Timeline DSL 稳定后，再接 TTS/SFX、回听、局部重生成和导出。

核心排序原则：先把“可编辑的 ASMR 工程”和“导演层”做扎实，再接昂贵且容易牵动架构的真实音频生成。

## 恢复工作指引

继续开发时建议先读：

1. `docs/AI_HANDOFF.md`
2. `docs/project-archive.md`
3. `docs/superpowers/specs/2026-06-13-v0-1-dsl-first-design.md`
4. `apps/web/src/lib/asmr/schema.ts`
5. `apps/web/src/lib/asmr/mock-project.ts`
6. `apps/web/src/components/studio/studio-app.tsx`

本地运行：

```powershell
npm.cmd run dev --prefix apps/web -- --port 3000
```

本地验证：

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```
## Light Timeline Editing 进展（2026-06-16）

这一轮完成了当前初步路径里的第 2 项：轻量时间线编辑。我们没有进入完整 DAW 拖拽/resize 体系，而是先把最常用的小时间修改做成确定性的 Timeline DSL 操作。

新增设计与计划：

- `docs/superpowers/specs/2026-06-16-light-timeline-editing-design.md`
- `docs/superpowers/plans/2026-06-16-light-timeline-editing.md`

已实现内容：

- `edit-project.ts` 新增 `ClipTimingNudge` 与 `nudgeClipTiming`，支持对选中 clip 的 `start` / `duration` 做 delta 微调。
- timing helper 保持纯函数、不可变更新；找不到 clip 时返回原 project。
- `start` 最小值 clamp 到 `0`，`duration` 最小值 clamp 到 `0.1`，并按 0.1 秒步长取整。
- helper 不强行把 clip end clamp 回 project duration，越界继续交给现有 schema validation 与字段级校验高亮处理。
- `ClipInspector` 新增 Timing Actions：`Start -0.5s`、`Start +0.5s`、`Duration -0.5s`、`Duration +0.5s`。
- `StudioApp` 通过 `nudgeClipTiming` 更新当前 `AsmrProject`，因此 Storyboard、Timeline、Inspector、Validation Panel、Export JSON 与 localStorage 仍然共享同一份状态。

验证覆盖：

- `npm.cmd run test --prefix apps/web`：5 个 test files / 44 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过；本地 SWC Win32 warning 仍可能出现，但 webpack/WASM 构建成功。
- 浏览器验证因 in-app Browser 的 Node runtime 返回 `failed to write kernel assets`，本轮改用本机 Chrome CDP fallback 验证。
- 验证结果：`Duration +0.5s` 会更新 voice duration、Time row、Timeline label/width；`Start +0.5s` 会更新 voice start 与 Timeline left；ambience duration 越界后 Duration 字段显示 inline issue，global Validation Panel 同步显示，`Duration -0.5s` 恢复后错误清除；桌面 1440px 与移动 390px 均无文档级横向溢出。

路线状态更新：

1. 字段级校验高亮：已完成。
2. 轻量时间线编辑：已完成 start/duration nudge。
3. 项目结构升级：下一步，目标是让产品从“单个 demo 编辑页”更像一个本地优先的项目工作区，为后续项目列表、元数据、预览层留出结构。
## 中文界面文案进展（2026-06-16）

这一轮是路线外插队的小修正：用户发现页面整体仍偏英文，希望先把界面改成中文，并要求按钮名字简洁清晰。我们采用的口径是“中文为主，保留必要技术缩写”，也就是保留 `ASMR`、`JSON`、`dB`、`LUFS`、`seed`，其余可见操作文案尽量中文化。

新增设计：

- `docs/superpowers/specs/2026-06-16-chinese-ui-copy-design.md`

已实现内容：

- 新增 `apps/web/src/lib/asmr/ui-copy.ts`，集中管理中文状态、轨道、片段类型、空间位置、移动方式、常见 timeline 值和校验信息。
- 主要页面文案改为中文：`分镜`、`时间线`、`情绪曲线`、`项目校验`、`项目操作`、`片段检查`。
- 按钮名改为短中文：`导出 JSON`、`载入`、`重置`、`更柔`、`更近`、`左耳`、`右耳`、`停顿`、`降低`、`开始 -0.5秒`、`开始 +0.5秒`、`时长 -0.5秒`、`时长 +0.5秒`。
- 状态徽章从 raw enum 改成中文，例如 `可预览`、`待生成`、`生成中`、`已生成`。
- 常见 demo 值从英文枚举展示改为中文，例如 `comforting` -> `安抚`，`rain_room_tone` -> `雨夜房间`。
- 校验错误与导入错误展示为中文，例如 `片段结束不能超过项目总时长`、`JSON 解析失败。`

验证覆盖：

- `npm.cmd run test --prefix apps/web`：6 个 test files / 51 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过；本地 SWC Win32 warning 仍可能出现，但 webpack/WASM 构建成功。
- 浏览器验证：核心可见 UI 和按钮均为中文，旧英文按钮/面板词未出现在页面文本中；越界校验错误为中文；桌面 1440px 与移动 390px 均无文档级横向溢出。

路线状态：

- 这不是替换“项目结构升级”的路线项，只是进入下一步前的体验修正。
- 下一步仍然回到 `docs/AI_HANDOFF.md` 记录的 `project structure upgrade`。

## 2026-06-17 - C+ 项目工作区实现

这一轮完成了用户批准的 C+ 项目工作区结构，把原先偏单页编辑器的 Studio Console 推进成更清晰的本地优先项目工作区。实现对应了中英规格与 mock 的方向：左侧项目栏、顶部工作区状态/操作栏、中间编辑器、右侧项目详情栏，并保留中文为主、必要英文技术名词保留的界面口径。

已实现内容：

- 新增 `apps/web/src/lib/asmr/project-summary.ts` 与 `apps/web/src/lib/asmr/project-summary.test.ts`，用于从当前 `AsmrProject` 派生项目级摘要和工作区指标。
- 新增工作区组件：`project-workspace.tsx`、`project-workspace-header.tsx`、`project-rail.tsx`、`project-details-dock.tsx`、`project-workspace-badge.tsx`。
- 左侧项目栏和右侧项目详情栏可独立折叠；`专注编辑` 会同时折叠两侧，再次点击可恢复。
- 项目级操作已集中到 `ProjectWorkspaceHeader`：`导出`、`载入`、`重置`。
- 旧的 `project-header.tsx` 和 `project-controls.tsx` 已删除，避免继续维护两套项目级入口。
- `StudioApp` 仍然拥有单一 `AsmrProject` 状态，继续负责选择、验证、导入、导出、重置、本地保存和把编辑结果同步到各个视图。
- 本轮没有加入后端、真实音频生成、云端项目、多项目管理或真实播放能力。

浏览器验证覆盖：

- 默认桌面宽度约 1259px。
- `专注编辑`。
- 左右侧栏独立折叠。
- 无效导入与重置。
- 1024px 视口。
- 390px 移动端。
- 上述场景均未发现文档级水平溢出。
- `导出` 按钮已点击验证，页面无 console error；但 Codex in-app browser 不支持 download event，因此无法用下载事件确认文件落盘。

实现过程中验证通过：

- `npm.cmd run test --prefix apps/web`：7 个 test files / 55 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过；build 可能出现已知 SWC Win32 optional warning，但 webpack/WASM 构建完成。

路线更新：

- 当前初步路径第 3 项“项目结构升级”已完成。
- 下一步推荐改为 **preview layer before real audio**。
- 原因是 C+ shell 已经给预览层留出结构位置，但仍是占位；下一轮应先做播放状态、波形/状态界面和 generation slots，让流程像音频产品，但不假装已有真实音频。
- 真实 TTS/SFX、真实音频播放、真实 waveform 和导出仍应等导演工作流与 Timeline DSL 更稳定后再接入。

## 2026-06-26 - Roadmap governance reset

- User identified a project-management failure: the intended route existed only as scattered conversation/context, so repeated “what next?” answers drifted into newly invented bridge/mock steps.
- Added `docs/ROADMAP.md` as the single hard source for the 10-step product route.
- Added `docs/PROJECT_MANAGEMENT.md` with process rules for following the roadmap, checking current project reality, updating docs, and requiring verification evidence.
- Added root `AGENT.md` as the agent entrypoint that points to the roadmap, project-management rules, and handoff summary.
- Updated `docs/AI_HANDOFF.md` so it summarizes the roadmap instead of defining a competing one.
- Clarified that adapter/API/provider-wrapper work is an implementation detail only; it must not become a separate top-level gate that delays the current roadmap priority.

## 2026-06-22 - Generation Bridge

This round implemented the mock-first Generation Bridge described by:

- `docs/superpowers/specs/2026-06-22-generation-bridge-design.md`
- `docs/superpowers/specs/2026-06-22-generation-bridge-design.zh.md`
- `docs/superpowers/plans/2026-06-22-generation-bridge.md`

What changed:

- Added a backend-shaped `GenerationBridge` contract and a local mock implementation.
- Added runtime-only job state for queued/generating/progress/succeeded/failed/canceled behavior.
- Added pure durable project commits for generated mock assets and failed generation state.
- Kept runtime `jobId`, progress, queue/generating/canceling state, `blob:` URLs, and `data:audio` URLs out of `AsmrProject`, local saved project JSON, and exported JSON.
- Added `mock://asset/<clipId>/<jobId>` asset URIs and a runtime resolver that turns them into playable local mock WAV data URLs.
- Added selected clip generation controls in Inspector: `生成`, `重生成`, `重试`, and `取消`.
- Enabled selected clip mock preview playback in the right Preview Layer while keeping project-mix preview disabled/out of scope.
- Preserved import/export/reset/autosave, validation, Timeline status display, and the collapsible C+ project workspace.

Implementation notes:

- `StudioApp` owns the bridge instance, runtime generation state, session guards, callback handling, and mock playback.
- Generation view state is derived by `generation-view.ts`, which merges durable project data and runtime jobs before rendering UI.
- `generation-project-state.ts` is responsible for final project mutation only: success commits asset metadata; failure commits `asset_failed`; failed regeneration preserves previous generated assets.
- A TypeScript build failure surfaced in `generation-view.ts` because direct union-track `flatMap` bypassed the existing `flattenClips` helper. The fix uses `flattenClips(displayProject)` and is covered by build verification.

Verification:

- `npm.cmd run test --prefix apps/web`: 13 test files / 92 tests passed.
- `npm.cmd run lint --prefix apps/web`: passed.
- `npm.cmd run build --prefix apps/web`: passed.
- Browser verification used `http://localhost:3000/` plus Playwright with system Chrome because the in-app browser Node runtime returned `failed to write kernel assets`.
- Browser checks covered Chinese UI text, selected clip generation, progress and cancel state, success to `重生成`, enabled selected clip preview playback, local saved project containing `mock://asset/`, local saved project excluding runtime job state, focus/collapse controls, desktop overflow, collapsed desktop overflow, 390x900 mobile overflow, and no console/page errors.

Roadmap update (superseded by 2026-06-26 roadmap governance reset):

- The previous "real generation integration design" target has now been refined by implementation: the mock bridge boundary exists.
- Historical recommendation at the time was **API-backed generation bridge design**.
- This is no longer the current next-step instruction. Current top-level route is defined only in `docs/ROADMAP.md`.

## 2026-07-07 - Roadmap Step 7 Real Generation MVP 接入工作台

本轮把 2026-07-06 已经手动跑通的本地 GPT-SoVITS runtime 接入 checked-in Next.js 工作台，完成 roadmap 第 7 步“真实生成 MVP”的产品内接线。

实现内容：

- 新增 `local-runtime-config.ts`，默认指向 `D:\CodexWorkplace\asmr_director_runtime`，并支持 `ASMR_DIRECTOR_RUNTIME_ROOT`、`ASMR_GPT_SOVITS_URL`、`ASMR_VOICE_PACK_PATH`、`ASMR_CLIP_ASSET_ROOT` 覆盖。
- 新增 `voice-pack.ts`，读取本地 voice pack JSON、参考音频路径、日语 prompt transcript，并要求 `licenseStatus: "user_confirmed"` 和 `consentConfirmedAt`。
- 新增 `gpt-sovits-provider.ts`，把 voice clip 映射到 GPT-SoVITS `/tts` 请求，使用 `clip.text` 作为实际生成文本，使用 voice pack prompt text 作为参考音频转写。
- 新增 `local-asset-store.ts`，把生成的 WAV 写入 runtime asset store，并只向项目返回 `asset://clip/<assetId>`。
- 新增 `local-clip-generation.ts`，串起 clip 查找、voice pack 加载、provider 请求和资产保存。
- 新增 `POST /api/generation/clip`，用于 selected clip generation；本步骤只允许 voice clip。
- 新增 `GET /api/assets/clip/[assetId]`，用于把本地 generated WAV 作为 `audio/wav` 播放。
- 新增 `local-generation-bridge.ts`，浏览器侧默认调用本地 API，保留 queued / generating / succeeded / failed / canceled 的原有 update 形状。
- 新增 `playback-asset-resolver.ts`，让 Preview Layer 同时支持 `asset://clip/...` 与 `mock://asset/...`。
- `studio-app.tsx` 默认使用 local real bridge；只有 `NEXT_PUBLIC_ASMR_GENERATION_MODE=mock` 时才回到 mock bridge。
- `generation-view.ts` 允许 `asset://clip/...` 成为可播放的 selected clip preview asset。

关键设计边界：

- Project JSON 仍然只保存 final durable asset reference 和最终 asset metadata。
- runtime job、progress、callback state、local absolute path、`blob:`、`data:audio` 都不进入 Project JSON。
- 本地 GPT-SoVITS 请求是同步式 provider 调用；取消在 Step 7 中是客户端 best-effort：UI 可以取消本地提交并忽略晚到结果，但不能中断已经发出的 GPT-SoVITS 请求。
- 默认 bridge 已切到真实本地生成，mock 只是显式配置回退，不再是产品默认路径。

端到端验收：

- 启动 GPT-SoVITS API：`http://127.0.0.1:9880/docs` 返回 200。
- 启动 Next dev server：`http://localhost:3000/` 返回 200。
- Headless Chrome CDP 验收中，页面 hydrate 成功，选中 `voice_001` 后点击 `生成`。
- 生成结果写入 localStorage / Project JSON：`asset://clip/voice_001_20260706T211523064Z_d3b95513`。
- 播放接口 `GET /api/assets/clip/voice_001_20260706T211523064Z_d3b95513` 返回 `audio/wav`，`241,964` bytes，WAV header 为 `RIFF`。
- 页面 error/warning 日志为空。

自动化验证：

- `npm.cmd run test --prefix apps/web`：21 个 test files / 118 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过。
- `npm.cmd run build --prefix apps/web` 在当前 Windows 环境会触发 Turbopack native binding 不支持提示；这不是本轮代码失败，验证命令固定使用 `-- --webpack`。

对 roadmap 的影响：

- 第 7 步已完成。
- 下一步按 `docs/ROADMAP.md` 进入第 8 步：多类型真实 Clip 生成。
- 不要再把 adapter、API route、provider wrapper、bridge cleanup 提成新的顶层阶段；这些只能作为第 8 步或后续步骤的内部实现细节。

## 2026-07-07 - Roadmap Step 8 多类型真实 Clip 生成

本轮在第 7 步 voice clip 真实生成的基础上，把 selected clip generation flow 扩展到非 voice clip。实现策略是本地程序化 WAV renderer：不下载新模型，不引入素材库授权问题，不改变 Project JSON contract，先让 timeline 中的 breath、SFX、ambience 都能生成真实可播放 WAV。

实现内容：

- 新增 `apps/web/src/lib/asmr/procedural-audio.ts`：
  - 输出 32 kHz mono 16-bit PCM WAV。
  - 同一 clip id / type / seed 输出确定。
  - `breath` 使用柔和噪声和呼吸包络。
  - `sfx` 使用布料 / 被褥摩擦噪声，并预留敲击式短脉冲分支。
  - `ambience` 使用雨声底噪和稀疏雨滴颗粒。
- 新增 `apps/web/src/lib/asmr/procedural-audio.test.ts`，覆盖 WAV header、长度、确定性、seed / 类型差异、voice reject。
- `apps/web/src/lib/asmr/local-clip-generation.ts` 新增 `generateLocalClip`：
  - voice 继续走 GPT-SoVITS。
  - breath / SFX / ambience 走程序化 renderer。
  - 生成后仍通过 `saveClipAsset` 写入 `D:\CodexWorkplace\asmr_director_runtime\assets\clips\app`。
  - `generateLocalVoiceClip` 保留为兼容 wrapper。
- `POST /api/generation/clip` 改为调用通用 `generateLocalClip`。
- `generation-view.test.ts` 增加非 voice `asset://clip/...` selected preview 回归测试。
- 新增第 8 步设计与计划：
  - `docs/superpowers/specs/2026-07-07-multi-type-real-clip-generation-design.md`
  - `docs/superpowers/specs/2026-07-07-multi-type-real-clip-generation-design.zh.md`
  - `docs/superpowers/plans/2026-07-07-multi-type-real-clip-generation.md`

端到端验收：

- Next dev server：`http://localhost:3000/` 返回 200。
- GPT-SoVITS：`http://127.0.0.1:9880/docs` 返回 200，但本轮非 voice 验收不依赖 GPT。
- Headless Chrome CDP 验收中，从工作台 UI 选中并生成：
  - `breath_001` -> `asset://clip/breath_001_20260706T213815920Z_b55ae7b8`，播放接口返回 `audio/wav`，`153,644` bytes，WAV header `RIFF`。
  - `sfx_blanket_001` -> `asset://clip/sfx_blanket_001_20260706T213816276Z_0089677d`，播放接口返回 `audio/wav`，`217,644` bytes，WAV header `RIFF`。
- 页面 error/warning 日志为空。

自动化验证：

- `npm.cmd run test --prefix apps/web -- local-generation-bridge local-clip-generation generation-view playback-asset-resolver procedural-audio`：5 个 test files / 29 个 tests 通过。
- `npm.cmd run test --prefix apps/web`：22 个 test files / 124 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web -- --webpack`：通过。输出仍包含已知 SWC native binding warning，但 build 退出码为 0。

对 roadmap 的影响：

- 第 8 步验收要求“至少两类非 voice clip”已经由 breath + SFX 端到端验证满足；代码同时支持 ambience。
- 下一步进入第 9 步：真实项目混音与导出。
- Step 9 应消费现有 `asset://clip/...` 文件，按 timeline timing 混成真实 WAV；不要回退到继续做 mock bridge 或 provider spike。

## 2026-07-10 - 文档冲突清理：第 9 步混音优先级

本轮只清理项目记录和恢复文档，不改变产品路线。

- 确认 `docs/ROADMAP.md` 仍是唯一顶层路线源，第 9 步“真实项目混音与导出”是当前最高优先级。
- 修正 `docs/AI_HANDOFF.md` 的旧表述：`Real project-mix rendering` 不再属于 `Do Not Do Yet`，而是当前 Roadmap Step 9。
- 将“project-mix preview out of scope”的旧说法改成“当前 Step 9 目标”，避免后续 AI 或上下文压缩后误判下一步。
- 保留 Step 10 产品化能力为后续事项，不把 backend persistence、auth/cloud、real waveform、billing、publishing 等提前混入 Step 9。

## 2026-07-06 - GPT-SoVITS 本地真实生成实验

本轮没有修改 checked-in 前端代码，而是在项目外的本地 runtime 中打通了一条真实 TTS 生成链路，用于验证 roadmap 第 7 步“真实生成 MVP”的技术可行性和听感边界。

Runtime 位置：

- Runtime 根目录：`D:\CodexWorkplace\asmr_director_runtime`。
- GPT-SoVITS 仓库：`D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\GPT-SoVITS`。
- GPT-SoVITS 上游：`https://github.com/RVC-Boss/GPT-SoVITS.git`。
- 本地 GPT-SoVITS 提交：`bf81cdb`。
- 本地 `LICENSE` 显示 GPT-SoVITS 根代码许可证为 MIT License；模型权重、ASR 模型、参考音频、声音包和生成音频仍需按各自来源单独确认授权。统一边界见 `docs/THIRD_PARTY_RUNTIMES.md`。
- Python 环境：`D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\env-comfyui-clone`。
- GPT-SoVITS API 地址：`http://127.0.0.1:9880/tts`。
- 使用 GPT-SoVITS v2 pretrained weights，配置文件为 `GPT_SoVITS/configs/tts_infer.yaml`。

启动命令：

```powershell
D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\env-comfyui-clone\python.exe api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
```

Voice pack：

- `D:\CodexWorkplace\asmr_director_runtime\voice-packs\default\voice-pack.json`
- `D:\CodexWorkplace\asmr_director_runtime\voice-packs\default\reference.wav`
- `D:\CodexWorkplace\asmr_director_runtime\voice-packs\default\prompt.txt`

参考音频来自用户提供的 `D:\temp\音频.MP3`，转换为 `reference.wav` 后约 `6.3s`，32kHz mono PCM。

一开始误把 `prompt_text` 当成“生成提示词”，写了中文占位句，导致生成内容和节奏明显不稳定。后续确认 GPT-SoVITS 的 `prompt_text` 实际含义是“参考音频真实转写”，不是要生成的文本。真正要生成的内容是请求里的 `text`。

ASR 转写：

- 日语 / 英语走 `tools/asr/fasterwhisper_asr.py`。
- 中文 / 粤语偏 FunASR。
- Faster Whisper 模型下载在 D 盘项目 runtime 下，避免占用 C 盘。
- ASR 输入：`D:\CodexWorkplace\asmr_director_runtime\asr\reference-input\reference.wav`。
- ASR 输出：`D:\CodexWorkplace\asmr_director_runtime\asr\output\reference-input.list`。

识别结果：

```text
助けてくれたのかなあの時はありがとう今は財布持ってないから昼休みに非常階段に来てもらって
```

当前 voice pack 使用：

- `promptLanguage: "ja"`
- `textLanguage: "zh"`
- `prompt.txt` 写入上述日语 ASR 转写。

Faster Whisper 模型位置：

- `D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\GPT-SoVITS\tools\asr\models\faster-whisper-large-v3`

模型本地检查：

- `model.bin`: `3,087,284,237` bytes。
- `config.json`: `2,394` bytes。
- `preprocessor_config.json`: `340` bytes。
- `tokenizer.json`: `2,480,617` bytes。
- `vocabulary.json`: `1,068,114` bytes。
- 没有残留 `.incomplete` 或 `.lock` 文件。
- 虽然 Hugging Face 远端元数据查询因代理 SSL 问题失败，但该模型已经实际完成 ASR，说明本地可用。

单句 TTS 实验：

- 成功生成真实 WAV：`D:\CodexWorkplace\asmr_director_runtime\assets\clips\manual-test-prompt-transcribed-ja-serial.wav`
- 时长：`5.26s`
- 格式：32kHz mono PCM WAV。

关键参数：

- `prompt_text`: 日语 ASR 转写。
- `prompt_lang`: `ja`。
- `text_lang`: `zh` 或后续长段测试中的 `all_zh`。
- `batch_size`: `1`。
- `parallel_infer`: `false`。
- `split_bucket`: `false`。

连贯 ASMR 试听实验：

为了模拟工作台里的“多个 voice clip 组成整段试听”，手动生成 6 个 voice clip，然后拼接为一个完整 WAV。该实验没有接入前端 UI，也没有写入 Project JSON；它只是一个真实 provider 的运行时证明。

- Manifest：`D:\CodexWorkplace\asmr_director_runtime\assets\clips\workbench-asmr-test-2026-07-06\manifest.json`
- 整段输出：`D:\CodexWorkplace\asmr_director_runtime\assets\mixes\workbench-asmr-test-2026-07-06.wav`
- 时长：`59.53s`
- 格式：32kHz mono PCM WAV。

分段输出：

- `01_voice_001.wav`: `10.28s`
- `02_voice_002.wav`: `8.08s`
- `03_voice_003.wav`: `8.28s`
- `04_voice_004.wav`: `8.92s`
- `05_voice_005.wav`: `8.96s`
- `06_voice_006.wav`: `8.46s`

这条整段音频使用 GPT-SoVITS 逐段真实生成，再用静音间隔拼接。它接近未来 timeline/mix 的工作方式，但不能算 roadmap 第 9 步“真实项目混音与导出”完成，因为它没有使用 checked-in app 的 timeline DSL、asset reference、Preview Layer 或导出按钮。

关键问题与结论：

- `prompt_text` 必须尽量匹配参考音频的真实转写；它不是 ChatGPT 语境里的 prompt。
- 日语参考音频可以用于中文 zero-shot，但跨语言稳定性一般，声音、口音、节奏都可能不理想。
- 中文目标文本通过 PowerShell 管道发送时曾变成 `?`，导致 GPT-SoVITS 返回 `请输入有效文本`。后续请求应使用 Python UTF-8 JSON 或 Unicode escape。
- GPT-SoVITS 并行推理在 RTX 3060 Laptop 6GB 显存上可能触发 CUDNN / ONNX Runtime memory allocation failure。稳定测试路径是重启 API 后使用 `parallel_infer: false`、`split_bucket: false`、`batch_size: 1`。
- C 盘空间曾低至约 `0.12GB`，导致运行环境非常脆弱。清理了 C 盘 Hugging Face / Torch / pip cache，释放约 `5.3GB`。后续所有模型、缓存、临时目录和生成物都应继续放在 D 盘。

对 roadmap 的影响：

这轮证明了“真实本地 voice clip 生成”可行，但还没有完成产品集成。下一步仍属于 roadmap 第 7 步：

> 把已验证的本地 GPT-SoVITS runtime 接入现有 Generation Bridge / selected clip generation / Preview Layer flow。

不要把下一步重新发明成新的 mock bridge、provider spike 或架构 gate。Adapter/API/provider wrapper 只能作为第 7 步的内部实现细节。

## 2026-06-21 - Preview Layer Before Real Audio

这一轮实现了已批准的 C hybrid lightweight preview layer，对应设计文档：

- `docs/superpowers/specs/2026-06-21-preview-layer-before-real-audio-design.md`
- `docs/superpowers/specs/2026-06-21-preview-layer-before-real-audio-design.zh.md`

已实现内容：

- 在右侧项目详情栏添加项目预览 surface：禁用播放按钮、fake waveform/status strip、preview counts、generation slots。
- 新增 derived generation-summary 数据，从现有 `AsmrProject` 纯派生预览计数与素材槽，不修改 `AsmrProject` schema，也不改变导出 JSON。
- Inspector 新增 selected-clip asset slot，Timeline 新增 compact generation-status signals。
- 保留左侧项目栏与右侧详情栏的独立折叠；`专注编辑` 仍会给 Timeline 释放空间。
- 本轮仍未接入真实播放、真实 waveform、真实 TTS/SFX/ambience 生成或后端任务队列。

验证覆盖：

- `npm.cmd run test --prefix apps/web`：8 个 test files / 62 个 tests 通过。
- `npm.cmd run lint --prefix apps/web`：通过。
- `npm.cmd run build --prefix apps/web`：通过。
- 浏览器验证使用 production server `npm.cmd run start --prefix apps/web -- --port 3011`，避开异常关机后 stale dev-HMR websocket。
- 1440x1000 desktop、`专注编辑`、左右独立折叠、Inspector 素材槽、字段级校验、无效导入、重置、导出下载、390x900 mobile overflow 均通过。
