# 安全切点与人工文字确认

日期：2026-10-14。Audio Quality V1仍进行中，SFX暂停，不新增路线。保留共享工作树，无提交推送。

## 决定与实现

用户试听0–2.02秒原声后明确确认「啦」保留，选择方案1：区分切点安全与短句文字差异，安全切片经逐句试听确认后采用。另询问中文强制对齐原理及本机可行性，未要求安装模型。用户释放RAM并要求新增文件放I盘。

仅整段显式启用限定的3–9汉字文字复核；原短句clip/long_text配方保持。允许完整原音下独立左窗/最终窗仅缺末尾轻声啦/了；同轮实际复验又遇完整后句「坐/做」，补充完整短句恰一处同音同调替换。排除数字/否定字、增删、多处替换、错调和混合变体。源/左/最终只可原句或同一个完整变体；源有差而最终正确仍需确认。

独立右窗的完整短后句同音差保存followingPhoneticBoundary：实际转录、字差、带调拼音、立即相邻源词及真实词时间。静音、双侧时序、最终识别、原PCM验证不变。

全部安全切点且有限文字差异时保存所有切片，状态needs_confirmation；其他边界失败继续review，仅保留完整原音。人工确认后状态仍needs_confirmation，另存manualTextConfirmation服务器receipt，不修改ASR或分数。

确认接口复核工程/整段源文与表达指纹、精确有序待确认ID、全体authoritative ready候选、源和每片段原PCM；manifest锁内逐成员快照复核后原子确认，幂等，不调用模型或采用。前端返回全集/指纹/资产/receipt核验及迟到、改文、切页、取消、工程变化保护保持；先持久化再采用，两套结果库独立。

卡片提供每条待确认原声、原文、实际识别、差异所在窗口、默认未勾选确认；源定位有差、裁后正确明确解释。后句同音证据默认折叠；人工确认状态不冒充全部ASR通过。

双语契约：[中文](../specs/2026-10-14-manual-short-sentence-confirmation.zh.md) / [English](../specs/2026-10-14-manual-short-sentence-confirmation.en.md)。

## 真实音频证据

根目录：I:/AI/asmr-director-dual-workspace/2026-10-14/manual-text-confirmation。

原候选vox_039ef5c01a374b4e95774aa68b4d2a86，trace9f662760-6b5b-4ed0-a900-e40c50ebb1d1，15.36秒48kHz单声道16bit。WAV SHA256为82ad9d03f0c2f01647351f494cc1dafe857363b1e12928fc82480e45acdae724；PCM SHA256为5f9c0ba943fcec8c44a685257749e0f0b9e66ccaac664ec592ba88dde4168381。

首轮真实分析前三句成功，第四句因右窗完整后句「坐」识别「做」仍失败，未发布半组。修复后只重新实际分析第四、五句；前三条从本轮成功记录按输入WAV/PCM SHA、目标、后文、clauses绑定复用。首轮4个分析请求，后续2个；请求数不等于内部source/left/right/final ASR次数。没有TTS。

| 句 | 原音范围/秒 | 实际裁后ASR/分数 | 状态 |
|---|---|---|---|
| 1 | 0–2.02 | 回来，2/3 | 漏粒子待试听 |
| 2 | 2.02–5.17 | 完整，1 | 普通检查通过 |
| 3 | 5.17–8.97 | 雪识别为血，12/13 | 既有文字差异提示 |
| 4 | 8.97–12.26 | 完整，1 | 保存右窗坐/做边界证据 |
| 5 | 12.26–15.36 | 过来做炉子边暖和，7/8 | 同音字待试听 |

五片连续覆盖原始全部帧，拼接PCM逐字节等于原音，源文件不变。整组needs_confirmation，待确认第一、五句；第三句既有差异警告保留。分析WAV裁边/淡边不影响发布的原PCM。前三条重放的analysis.wav仅为时长正确占位，splitter不用其字节，不能声称是当时处理后音频SHA。

首轮失败qa/real-split-report.json；成功qa/resumed-real-split-report.json、五条analysis-N.json、第四/五处理WAV和verified-native-cut-N.wav。私有QA会话串行复用既有Whisper工作进程；原4,815,306,368字节内存门槛未降。一次准备检查误把自身pwsh命令当任务，0调用拒绝；正确检查无任务/锁、空闲提交9.23GB后运行，原收据保留。

qa/real-candidate-flow-isolated.json检查实际结果保存五成员、缺确认拒绝、模拟确认后保留识别、仅内存中采用、短句库不变，生产manifest未写。首个QA夹具缺必需辅助轨道，在采用验证前失败；第二次修复夹具后通过，失败日志/目录保留，不改产品逻辑。

发布脚本复用SHA绑定真实证据，不重复推理；仅保存五条pending候选，不confirm或adopt。wx排他journal在写候选前创建，中断后保留started，禁止盲重发。生产发布/部署实绩见下节追加。

## 验证、存储与构建

全量Vitest1821 passed /4 skipped，137文件通过/2跳过，qa/full-tests.log。Python152，分析/拼音/切分TS205，后端同音定向60/1跳过，UI四文件111；完整TypeScript/source ESLint与独立源码、真实证据审查通过。整段重识别总期限30分钟，由已保存模式决定；原long_text保持5分钟，显式期限不覆盖，各调用使用实际剩余时间。

旧205份生产音频187,433,012字节复制到I:/AI/asmr-director-product-assets/clips/app并逐SHA核验，D原文件保留。新runner指定I音频根，旧asset ID/URI不改；runtime/model/profile/manifest/锁仍原址，新语音工作目录/验证/build在I。部署前重新同步新增资产。

I盘exFAT普通文件/目录readlink返回EISDIR，Next/NFT期待EINVAL，前两次构建因此失败，旧服务未停。qa/exfat-readlink-compat.cjs仅在Windows且lstat证明确为非链接普通文件/目录时规范此错误，保留真实junction、缺失及其他错误；三种readlink API验证通过，无第三方代码或音频修改。正式构建/部署以真实收据为准。

本轮没有新截图：既有浏览器安全拒绝未绕过，组件/布局/接口检查不能冒充截图验收。此前短句、无对白和折叠时间线保持。

## 中文强制对齐可行性

核对完整转录→中文CTC逐字时间/置信度→句末附近真实静音→原48kHz PCM切片。分析可用16kHz输入；低分/未对齐字不能用插值秒数假称通过。对齐本身不证明台词完整。

只读机器核查：Ryzen7 5800H、16GB RAM、RTX3060 Laptop6GB，已有Torch2.8/torchaudio2.8/Transformers4.50，WhisperX未安装。默认中文wav2vec2 PyTorch权重约1.28GB，单一格式即可。硬件具备有界串行CPU/GPU试验条件，轻声准确率、峰值内存及速度未验证；TTS/Whisper/对齐分阶段加载释放，模型/缓存放I。本轮没有下载或安装。

来源：[WhisperX对齐代码](https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py)、[中文模型](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn)、[权重](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn/tree/main)。机器证据qa/alignment-feasibility.json。

## 正式部署与发布实绩

第三次WASM/Webpack正式构建成功，qa/production-build-3.log。22:48:48 HKT以原3001授权替换已经重新核对的旧PID9988，新build IuS6dk38Xq9OZB0CRWvbQ；22:53:07快照PID16004、启动器11708，无native任务或运行锁。qa/deployment-start.json、final-runtime.json，启动入口qa/start-production.ps1。

服务新schema生效后，按真实输入SHA绑定证据沿用正常recheck/save服务原子保存五个新待确认候选。源vox_039ef5c01a374b4e95774aa68b4d2a86，新首句vox_b4021561c33e4e32bcbcbccdd9a7bada。没有新ASR/TTS、确认或采用，隔离测试的模拟receipt不进入生产。qa/real-candidate-publication.json与completed的publish-execution-journal.json；发生未知中断不能删除journal后盲重发。

qa/production-verified.json证明旧99条逐项保持、恰新增5/总104；新5切片下载SHA等于真实probe，旧205份D/I音频SHA和HEAD200、页面/build/catalog/candidates/recordings HTTP200，新录音保留完整五句needs_confirmation证据，确认接口非法body400且manifest不改。原工程仍Short4/Paragraph0，无浏览器工程库写入。原四采用WAV与I副本已独立对照早先I:/AI/asmr-director-dual-workspace/2026-10-14/baseline/original-project-protection.json.assets四项，不使用旧空originalAdopted字段冒充证据。

用户刷新整段页后可试听第一、五句，勾选后「确认并采用」。旧第三句雪/血提示保留。本轮完成实现和同址部署，最终听感及采用由用户决定。旧构建/runner保留；回滚时要同时考虑I-only新资产和新manifest schema，不能只盲启动旧runner。
