# 日语参考入库、参数预设与发布交接

日期：2026-10-28（Asia/Hong_Kong）。Route ID：Audio Quality V1。参考入库与产品适配已完成；Audio Quality V1仍进行中，其他SFX工作暂停，目标机H3实跑待办保持。沿用本项目既有ROADMAP／AI_HANDOFF／project-archive记录体系。

## 用户决定与实验结论

用户听完中文CFG2／20后仍认为音色不像，决定暂时停止本轮相似度实验，要求把最终两份参考加入系统、标记日语、采用日语原文生成，并保存已试出的较优参数，记录推送后交给其他会话。

- 中文：仅参考音频时2.5／10和2／20均可正常读中文，但两角色相似度均未获认可；带日语原文的中文生成曾明显跑偏。不要把本轮入库理解成中文克隆质量通过，也不要继续自动试参。
- 日语：加原文优于仅音频，较长参考改善相似度；由比滨02基本像，低声区仍有不足。雪之下2.5／10和2／20都获“明显更好”反馈，由比滨2.5／10稍好。本次两者统一预设2.5／10，沿用后续日语验证的配置，未虚构雪2.5／10比2／20绝对更优。
- 使用已提前转成16kHz的完整参考。直接44.1k输入在两个角色上均被用户认为更差；降低雪参考电平改善噪感。正式文件按已测字节复制，不能再额外减6dB或将由比滨叠加旧+3／+6dB。

## 正式参考与参数

| 名称 | 系统ID | 长度 | 参考分支 | 固定Seed |
| --- | --- | --- | --- | --- |
| 雪之下 | user-fe1e360f-9ef2-4451-9272-d666c31f4936 | 25.10秒 | 已测试的完整16k、减6dB模型分支 | 43 |
| 由比滨 | user-fdd0148d-b85c-432c-b36e-fd926ffe3cae | 20.2188125秒 | 用户新02参考、16k、gain1 | 42 |

两条均为`language: "ja"`，`generationDefaults: { referenceMode: "with_reference_text", cfg: 2.5, timesteps: 10, seed: 43或42 }`。选择后默认“参考音频＋文本”，目录标“日语”，原文保持已测试的完整日文和标点。CFG／步数／固定Seed摘要放在现有更多设置内。全局默认仍为`soft_zh`，旧5条参考及23个旧资产保持；未重写用户工程或当前选择。

正式根：`I:/AI/asmr_director/runtime/voice-references/<系统ID>/`，包含`reference.wav`、`reference.txt`、`source-preview.wav`和导入／来源记录。新活动引用不依赖QA目录；旧源文件只读。两份模型输入SHA：

- 雪：`9819886cfaac52273dbf3aec2a4b008691b36c7af5e196df5139e1fcf863bd3f`。
- 由比滨：`a1440c9b9184286a683ed9612f9b2b34fcb171f2fda525e8505b37fe33609ecb`。

沿用现有活动配置`D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/voxcpm2/profile.json`（既有运行配置位置，不在本轮迁移），最终SHA `1f0194d6be07bf0dfc81ed5d6d79eb3111a7fc7df5513c140788851ec082c37c`。新增音频和证据均在项目I盘数据根。二进制、原音、模型和本机profile不提交Git。

## 产品实现与恢复

10个应用文件：profile／provider／catalog／longtext四组源码与测试，以及voice-generation-panel组件与测试。profile字段可选，旧参考继续CFG2／10和原随机Seed行为；日语原文不被中文式清洗去标点。实际combined命令同一参考同时用于`-r`和`--prompt-wav`，附完整`--prompt-text`；预设参数进入实际命令及生成记录，新参考的语言／参数进入参考身份哈希。

正常再次生成使用固定Seed，便于复现；明确长文分组重抽会选取不同于原组的新Seed。原有各模式的长度上限保持，未强行把实验脚本最大600步覆盖到产品整段等模式。没有增加客户端指纹握手或改全局参数。

`tools/voxcpm2-runtime/register_japanese_references.cjs`通过现有产品导入接口和profile锁完成入库，已验证PCM字节复制适配器不启动FFmpeg或改变音量；有profile不可变备份及恢复记录。两个参考已经在库中，正常接续无需再执行`--apply`。若需要恢复，先读registration回执、当前profile和导入脚本，不覆盖之后新增的库条目。

本版同时提交这段会话的实验脚本和历史记录（含错误沿用combined的中文批），供复现与追溯；历史文件不代表继续推荐该错误方法。

## 验证

QA根：`I:/AI/asmr_director/qa/handoff/2026-10-28/japanese-references/`。

- `registration/registration-receipt.json`：原有5条／23资产／默认保持；2新完整PCM、原文含标点、语言与参数通过产品loader及音频读取接口核验，新增12个正式文件读后保持。
- `verification/backend-verification.json`：4套121项后端测试、8文件ESLint通过；UI的`ui-verification.json`记录69项组件测试、2文件ESLint通过。涉及选择日语参考自动切combined、旧参考兼容、原文与真实参数、固定Seed及明确重抽。
- `listening-tool-tests.json`：实验运行器和提交内存保护共13个标准库测试通过。本轮没有新增TTS或ASR模型调用，复用先前真实GPU实验；没有声称重新试听或正式系统日语整段验收。
- `build-status.json`／`build.log`：隔离Webpack构建exit0，含完整TypeScript检查；Next原生SWC绑定已有警告继续通过WASM回退完成，未宣称修复此环境问题。
- `service-verification.json`：实际GET `/api/generation/clip`返回7条参考／默认soft_zh及两条正确日语预设；两音频HTTP响应与正式16k SHA相同；首页与7 JS＋1 CSS精确匹配隔离构建。仅GET，无生成或浏览器工程存储写入。
- `unrelated-work-before.json`／`product-assets-before.json`以及发布回执核对28个范围外文件和405个既有产品文件；范围外spatial工作不进入构建或提交。

## 当前服务与Git发布

服务：`http://127.0.0.1:3001/`，build `2p3tAp4OKdM1Lj_p3Z7_A`。本轮开始时3001未监听；已启动新构建，激活PID31964（实时PID以系统查询为准）。

隔离源码：`D:/CodexWorkplace/asmr_director/.local/releases/japanese-reference-presets/apps/web`，由干净HEAD `0460daff9a1ec25d794acd084f165b6c807548bd`加本版10个明确文件生成。`.next`连接`I:/AI/asmr_director/cache/build-cache/japanese-reference-presets`；复用既有依赖和生产环境，只在隔离配置限制一个构建worker。

canonical入口：`I:/AI/asmr_director/service/2026-10-16/start-production.ps1`，只更新源码目录。实际启动使用同环境的隐藏Node进程；日志在`I:/AI/asmr_director/service/2026-10-28/japanese-references.{stdout,stderr}.log`。记录见`activation.json`，未改变系统执行策略。

发布分支：`codex/voxcpm2-product-generation`。提交／推送的实际完成状态、commit与远端SHA以Git和QA根`publication.json`为准；该回执由发布后核对写入。以下历史记录的“未提交”只描述当时状态，不能覆盖发布回执。

## 留给下一会话

先读`AGENT.md`、`docs/ROADMAP.md`、`docs/PROJECT_MANAGEMENT.md`、`docs/AI_HANDOFF.md`、`docs/STORAGE.md`以及本记录，再查Git和publication回执。用户暂停相似度实验；当前日语库用combined，今后若另做中文实验应遵循用户明确的不加原文要求。中文相似度仍未解决，日语低声区仍可改进，不作质量通过结论。

现有长文／整段录音分析脚本仍有固定中文ASR流程，本版没有扩展日语自动切分／识别，也没有实际验证日语长文闭环；需要时另作定向工作，不能仅凭语言标签声称完整多语言自动分析已支持。默认短句生成及本轮预设调用链已覆盖验证。

本次专属`verification/backend-test-temp`递归清理被自动审批拒绝，仅返回`blocked by policy`，目录已保留，未换方法绕过；不影响交付。28个范围外修改应继续保留，禁止全量暂存／重置。Audio Quality V1继续，SFX暂停、目标机H3待办不变。

English handoff: Both references are registered as Japanese with their exact tested 16 kHz inputs, full Japanese transcripts, CFG 2.5 / 10 steps, and seeds 43 / 42. Existing voices keep their prior behavior. Explicit group rerolls use a new seed; ordinary preset calls are reproducible. Chinese pronunciation works without the transcript, but timbre similarity remains unaccepted. No new synthesis was run for this registration. Japanese long-form recognition/splitting is not claimed as verified. Use the local publication receipt and Git to confirm the pushed revision.
