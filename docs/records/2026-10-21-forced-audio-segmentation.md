# 2026-10-21 — 自动切分失败后的强制音频切分

所属阶段：Audio Quality V1进行中，SFX暂停。本轮属于现有阶段，不新增顶层路线。

状态：功能实现、修正版29条可运行记录验证、完整Vitest/类型/lint、正式构建、真实HTTP及3001部署完成。1条历史原音缺失仍未实测，父阶段保持进行中。本轮没有提交或推送。

## 用户要求

用户明确要求：自动切分失败后，试听完整原音觉得没有问题，再点击“强制切分”。此前撤下的是“算法更新后重试旧候选”的维护入口；本次授权独立CTC强制定位，不恢复相同自动算法的重试入口。用户仍试听并普通采用，不新增逐句文字勾选或内容认证。

规格：[中文](../specs/2026-10-21-forced-audio-segmentation.zh.md) / [English](../specs/2026-10-21-forced-audio-segmentation.en.md)。原自动切分职责和已撤入口分别见[10月20日记录](2026-10-20-audio-segmentation-purpose.md)、[10月21日早前记录](2026-10-21-remove-recheck-entry.md)，它们是历史状态，不代表本轮强制功能此前已实现。

## 已实现范围

- 只有未强制过的自动切分失败候选显示按钮，运行中可取消；成功新增“已强制切分，待试听”候选，保留原候选、完整原音及原识别失败记录。普通采用、下载、放弃及撤回保持，不自动采用或重新生成。
- 新 `force-align-voice.py` 与测试独立于自动helper和旧实验工具。固定本地中文Wav2Vec2模型，CUDA fp16发射、NumPy CPU CTC；原音仍为48kHz单声道PCM16、最多120秒，16kHz仅分析副本。没有160ms静音、80ms保护、文字相似度或声学分数门槛，不调用TTS或Whisper复识别。
- 整段用完整原音与有序全文一次对齐；短句用实际完整 `inputText`，所有T帧必须走已知文本token、wildcard或blank有序状态，末帧可在已完成正文及首个后文字符的任意文本前缀结束，不强迫未读padding尾文。移除脱离已知后文的自由声学sink，保留完整音频各帧对定位的约束。
- OOV保留原字并在CTC格中用每帧最大非blank发射的wildcard状态定位，不改固定模型词表、原稿或等分时间；相同未知字重复仍需blank，逐字证据标记 `wildcard: true`。旧实验的严格OOV拒绝不沿用为本次强制产品的文字门槛。
- 句界按两侧字符时间中点换算原PCM整数帧，不按字数比例猜秒数；整段连续分割并保留最后尾音，必须精确复拼。分数和字符时间仅作证据，不认证台词内容；保留 `contentVerified: false` 及独立 `forcedSegmentation` 来源信息。
- 后台绑定原候选、工作区/文案上下文、唯一原音、WAV/原稿SHA及模型版本；取消、来源变化、无效对齐或发布失败保留原结果，不发布半组候选。原自动切分条件、参考声音和视频包/便携运行器协议保持。

固定模型 `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn`，revision `99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd`，权重SHA256 `de031fd4b29e0c0667e5346450fadfe1326c89936b888b59c4ede608db763ee4`。沿用现有本地模型，不安装依赖或下载权重；不是完整WhisperX，也不把10月16日ASR字面未改善当作切点无用的证明。

## 验证结果

新Python脚本初版28项合成/协议测试通过，但真实反例证明原测试不足以验收切点；不能因此称初版算法正确。移除自由sink并加入wildcard后，32项测试通过，新增旧sink压缩目标反例、全T已知前缀约束、OOV原字/真实时间标记及同未知字重复blank；穷举小CTC路径、未读尾文、低分不设门槛、无静音中点、120秒边界、原PCM帧/原稿哈希及严格文件协议继续保留。测试数不是实际原音数，也不是沿用10月16日旧实验计数。

最终一次完整Vitest原始报告为1975通过、0失败、5条件跳过，154个文件；完整类型与相关ESLint退出0。此前UI104项、后续presenter85项、后台阶段24项及追加回归属于已纳入或重叠范围，不再相加。冻结web源码81文件。新Python为32项，不与自动helper既有180项历史结果混计。

正式Webpack构建退出0，BUILD_ID `tailcp5e6fQWpxKVDWMqe`，dist `.next-force-split-production` 指向本轮I盘 `build/next-production`；构建暂改的主仓 `tsconfig.json` / `next-env.d.ts` 已恢复原字节。构建收据 `serviceOperation: false` 仅描述构建步骤，实际部署另见下方收据。

## 真实失败库存与验证边界

本轮盘点30条失败候选记录：25条短句、5条整段；来源为28条生产记录及10月19日隔离实验的两条长篇。29条准备好串行真实CTC验证，剩余最老 `semantic_verify` 记录的候选WAV及对应group原音缺失，单独保留准备失败事实，无法实测。盘点条数、准备条数、实际声学调用/原音数和切分成功数不得混为一谈。

第一轮29条可运行记录实际为26条产生切片、3条因OOV失败（2长段、1短句），另有1条缺失原音准备失败。26条产出中，f0eb05的末字被初版CTC排进前1秒，切点仅约1.0008秒，明显早于既有原音目标边界约3秒；这是实际算法错误，不能把26条产出算成26条切点通过。

原因是自由max-emission声学sink虽给足同T帧分数，却可过早脱离已知后文，压缩目标后交给自由尾解释剩余音频。已改成全T已知文本前缀结束DP，并用合成反例固定旧错误：旧sink将目标末字放frame1、后文字frame2；修复后沿实际后文约束放到frame5、frame7。普通生僻字则保留原字、走wildcard时间状态，去掉实验沿用的直接OOV拒绝。

旧真实输出与失败保留在 `initial-attempt/` 及各case的同名目录，旧28项合成收据另存。修复后的4条真实回归已完成：f0eb切点3.332708秒，末“和”约3.14秒结束、首“擦”约3.52秒开始；原OOV短句切点3.853秒；149/190字两长段分别6/8句全部完成，原PCM精确复拼。生产manifest/profile保持。这是新核心的4条回归证据，不把旧初轮26产出改写成通过。

新核心全批29条可运行记录已完成：24条短句、5条整段全部产生新切分结果，0条执行失败，所有原PCM核对为true；另1条最老缺源记录仍为 `preparation_failed`，不算已测。生产manifest/profile保持。保留旧ASR错误、真实分数和切点，不以路径存在或PCM复拼相同证明发音正确；没有人工盲听或自动采用。原音缺失不能伪造替代音频后算通过。

独立只读复核通过29条结果及最终bridge验证重放：29次CTC对齐证据、48个字符中点切点、24条原PCM前缀及5段29片原PCM复拼，错误0；3份05历史边界参考诊断均未出现早于旧末目标词的切点。资产文件53次哈希核对对应51个唯一路径，trace文件62次核对对应42个唯一路径，存在共享来源，不能称作53份/62份不同原音。该复核没有新增模型调用，也不将旧词时当作音素真值或声称人工听感验收。

## 真实HTTP与部署

正式构建的隔离QA服务实际完成2个案例：Snow05短句组（内部 `generationMode: long_text`，不把它算成长篇整段）及190字整段8句。两者均经过真实CTC模型、真实强制切分POST且HTTP200，返回的源候选绑定匹配；新1+8个WAV资产实际GET均200并记录字节/SHA。测试不写生产候选或自动采用。首次隔离QA启动因缺少正式启动所用 `NODE_PATH` 而readiness失败，未进入案例执行；补齐同一启动配置后重跑通过，旧 `http-startup-attempt/` 保留。这是QA启动配置问题，没有据此改产品算法。

2026-10-21 04:38:39 HKT已部署同一3001，BUILD_ID `tailcp5e6fQWpxKVDWMqe`，dist `.next-force-split-production`；该时点listener PID7072、launcher PID30728，操作前须重新核对。页面、声音目录API及新build manifest均HTTP200，页面实际引用的8个JS也均200且字节匹配新构建，强制切分UI产物已核对。生产日志仅保留既有SWC win32加载警告，WASM回退正常，不作为产品新错误；未声称浏览器视觉或人工听感验收。

canonical恢复入口 `I:/AI/asmr-director-service/2026-10-16/start-production.ps1` 已同步，旧启动脚本保存在本轮根 `start-before-force-split.ps1`。正式启动包含本地模型与Python的 `ASMR_VOICE_ALIGNMENT_MODEL` / `ASMR_VOICE_ALIGNMENT_PYTHON` 配置，并保留 `NODE_PATH`、原音I盘位置、现有固定语音CLI和当前便携runner路径；不改生产profile或参考选择。

最终138候选manifest SHA `1D0267C0AFBE09564A9F1CEEEA25D79BA99B223190A3F167D08348C9314752F8`、profile SHA `37E9404AB3690207ECB83C38E7892347082B7B952C8680052CAFB1E1C05317DC`保持，81冻结web文件、59范围外源码、HEAD与空索引保持。没有浏览器工程存储操作、TTS生成、Whisper复识别、自动采用或提交推送；实际CTC验证及HTTP调用如上记录，不宣称0模型调用。

使用原3001入口刷新页面，在自动切分失败候选中试听完整原音；满意后点击“强制切分”，完成后试听新增候选并普通采用。取消只针对本次请求，原候选和原音保留。剩余边界仅为最老 `semantic_verify` 记录原WAV及group源音缺失，待真实原文件恢复后才可补测，不能用替代音频算该记录通过。

## 证据与剩余边界

证据根：`I:/AI/asmr-director-force-split/2026-10-21/`。

- `python-qa/verification.json` / `full-prefix-wildcard-red.log` / `full-prefix-wildcard-green.log`：当前32项先红后绿测试及固定文件SHA，该测试阶段0模型调用。
- `python-qa/initial-free-sink-verification.json`、`synthetic-final.log`、`prefix-sink-counterexample-before.json`：保留初版28项合成通过、旧算法及目标过早结束反例，不能将它们改写成最终成功证据。
- `ui-test-results.json` / `ui-tests.log` / `ui-eslint.log`：104项UI阶段验证；`ui-final-presenter-results.json` / 对应tests及eslint日志为后续85项重叠验证。
- `backend-qa/backend-core-tests.log`：阶段24项后台验证；最终全套包含相关后台/UI回归，不重复相加。
- `full-test-verification.json` / `full-test-results.json`、`frozen-web-source.json`、`final-typecheck.log`、`final-bridge-eslint.log`：完整1975/0/5、154文件、81冻结源码及类型/lint结果。
- `build/build-result.json` / `build/build.log`：正式构建 `tailcp5e6fQWpxKVDWMqe`、I盘产物及Next配置原字节恢复。
- `real-inventory.json`、`real-preparation.log`、`initial-attempt/real-results.json`及 `real/`：失败库存、准备失败与初轮真实26产出/3OOV失败及f0eb错切；先前fixture准备失败收据保留，不当作产品对齐失败或掩去失败后计成功。
- `regression-results.json`及 `regression-attempt/`：修复后4条真实回归完成、f0eb新切点、原OOV短句与6/8句长段PCM核对。
- `real-results.json`：修复后全量29条完成、0执行失败及1条缺源准备失败；`independent-real-verification.json`：29条来源/最终验证器/48中点/原PCM只读独立验收。
- `http-verification.json`：2模式真实模型+POST、9个实际WAV GET及源绑定；`http-startup-attempt/`保留首次QA环境readiness失败。
- `deployment-verification.json` / `final-verification.json`：04:38:39部署、build/PID、HTTP与8实际JS身份、81冻结/59范围外文件及生产138候选/profile保持，无提交推送。

可执行错误仍包括源音/文稿身份不明、CTC帧不足或非法路径/时间、越界/不递增整数切点、模型/资源不可用、取消和超时；普通OOV使用wildcard，不再作为直接文字拒绝。强制结果仍可能存在可听切点误差，用户应试听后决定采用。
