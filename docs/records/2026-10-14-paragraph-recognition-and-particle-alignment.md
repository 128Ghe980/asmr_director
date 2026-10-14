# 整段识别对照、重新识别与短句语气词

日期：2026-10-14。属于 Audio Quality V1 的生成检查修复，父阶段仍进行中，SFX 暂停。未提交或推送；共享工作树的其他修改保留。

## 问题与实现

用户整段生成后，识别对照显示「未保存识别文本」；同时「回来啦。」被整段 ASR 识别为「回来了」，此前至少十字的拼音规则不覆盖三字目标。

整段检查现在显式启用 `allowShortSentenceParticle`，只处理 3–9 汉字、至少两字前缀逐字一致、明确自然句末的一处轻声「啦 / 了」。保留真实文字分数（三字为 2/3），不虚构 95% 拼音分数。完整字词端点、严格紧邻后文、有效正时长、真实静音及独立左右识别和最终裁后识别仍须通过。缺字、前缀替换、人工估时和普通模式绕过均拒绝。适配器最低解析分数修为 2/3，但只有验证完整的专门证据可以绕过原文字阈值。

独立左侧仅缺一个末尾轻声语气词时，可以在同一切点安全修剪两端静音，最多额外识别一次；没有足够安全静音则跳过。重识别必须得到完整句子和一致词级文本。分析输入处理不进入最终素材，发布仍按原始 PCM 帧连续切分并完全覆盖源音。

整段识别对照使用逐句证据，区分第一句的「整段原音识别」和后续「剩余原音识别」，显示真实差字与检查阶段。失败保存所属短句 ID 与完整识别检查点；旧失败日志可由原始录音列表恢复，严格绑定 plan 的成员、目标及剩余全文。不能把短句 expectedText 改成整段以伪造一致性。

新增整段「重新识别」：读取候选绑定的完整 sourceAsset，验证文件格式、时长、工程、工作区、成员、全文和容量，再使用原音检查。全部通过后一次原子发布同组新候选；失败保留完整新检查记录，不发布部分裁片。原候选不改、不自动采用、不调用 TTS。发布前在 manifest 锁内再次检查原候选，防止用户在识别途中放弃后仍发布。前端继续保护切页、切工程及改文后的迟到结果。

原 `clip / long_text` 短句＋后文生成取前部方式、原生参数、两页独立结果、同步源文和无对白分镜保持。

## 实际原音复查结论

源候选 `vox_05686e4dbe4241e28d03e4147dcd93b9`，工程 `asmr_planner_20261014_080645`。完整原音 15.36 秒，五句目标从「回来啦。」开始。原始记录根：`I:/AI/asmr-director-voice-work/long-text/f2da0424-e417-4cc0-9c9b-8c2814b3b48a`。原 WAV SHA256 `82ad9d03f0c2f01647351f494cc1dafe857363b1e12928fc82480e45acdae724`。

**该原音仍未通过全部切分，不能宣称五句实测成功。** 两次完整切分探针都停在第一句；两次逐调用诊断确认整段 ASR 为「回来了…」，独立 2.02 秒短窗则为「回来」，漏掉最后语气词。新规则已能越过原来的源字差定位问题，但不能将缺字当成等长啦/了差异接受。新探针失败为 `cut_text_mismatch`。

安全静音修剪检查的 start=0/end=96960，与原短窗相同：首帧有声学活动，末端不足保留 80ms 后再裁去，所以额外识别正确跳过。一次固定 1 秒纯零静音前置的隔离 QA 得到「好了」，且回转时间戳无效，被严格拒绝；**未纳入生产，也未扫描其他填充长度**。隔离脚本按阶段处理小于三秒输入，本次仅到左侧即失败，未运行右侧或最终阶段。

本次共两次完整原音切分探针、两次逐调用诊断及一次前置静音隔离试验，均使用已存在 WAV；0 TTS、0 自动采用、0 新生产候选。不得把 QA 诊断文件当成已发布的新检查候选。旧候选及旧失败诊断保持，用户可通过新入口重新识别。

## 验证与同址部署

- 最终常规全量：134 文件通过、2 文件跳过；1669 测试通过、4 跳过。真实 WAV 集成探针属于 opt-in，常规通过数不表示该原音切分成功。
- Python 最终 134 项通过，覆盖安全静音复查、缺字拒绝及完整识别门槛。
- 完整 TypeScript、源码 ESLint、diff 检查通过。独立只读审查确认原 PCM、时间戳、静音与双侧证明、候选锁和异步保护。
- WASM/Webpack 正式构建成功：`RMlwueYbO8rO5KLMbiENq`。`.next-particle-production` junction 到 `C:/Users/Yuki1/.codex/tmp/asmr-particle-production-20261014`。最后 Python 更新从文件系统加载，无 TS 变化；未清理用户模型、文件或缓存。
- 沿用用户明确的「允许更新3001」。继续时 3001 无监听、无语音原生任务和占用锁，未停止任何新进程。17:31 HKT 启动，17:33 完成核验；监听 PID9560、启动器4656为快照，续接操作前必须重新检查。
- 页面 HTTP200、实际 build ID、生成目录 HTTP200；旧工程短句 4 候选、整段 0 候选。用户新整段原始录音接口 HTTP200，恢复第一句 source_alignment 的完整识别文本及真实失败诊断。
- 当前全部 97 条生产候选逐条与本次基线完全一致；原四已采用 WAV SHA/HEAD200、整段源 WAV SHA/HEAD200及素材与 trace 字节对应均通过。

没有新截图。本次尊重此前浏览器 URL 安全策略拒绝，不改用其他界面绕过；组件测试与实际 API/页面可访问检查通过，不将历史截图标成此次视觉验收。

## 恢复与证据

本次基线、日志、各次失败探针和收据：`I:/AI/asmr-director-dual-workspace/2026-10-14/paragraph-recognition-fix`。

关键文件：`qa/full-tests.log`、`qa/python-final-particle-and-refinement.log`、`qa/build.log`、`qa/real-split-report2.json`、`qa/diagnostic-report2.json`、`qa/diagnostic-padded-report.json`、`qa/engine-source-final.json`、`qa/production-3001-deployment-final.json`、`qa/production-3001-protection-final.json`。第一次保护请求用了错误的 assets/clips 路径，404 日志保留；最终收据使用正确 assets/clip，全部 HEAD200。

当前启动：`qa/start-production.ps1 -Port 3001`。上次正式服务回退脚本仍为 `I:/AI/asmr-director-dual-workspace/2026-10-14/short-sentences/qa/start-production.ps1`，dist `.next-sentences-production`、build `ZI-_3omTFA6K3QZgxrD6F`。按进程身份和模型任务做服务范围回退，不能重置共享工作树。

本轮改变 Python 检查器、TS 分析适配及切分证据处理；旧「六个文件 SHA 都不变」只描述上一轮。当前原生 provider、profile 与 runtime 配置 SHA 与上一轮审计保持，见本次 `engine-source-final.json`。

双语契约：[中文](../specs/2026-10-14-speech-workspaces.zh.md) / [English](../specs/2026-10-14-speech-workspaces.en.md)。

## 21:09 重试与切点试听导出

用户于21:05要求重启，21:06同一构建的页面/目录/候选HTTP200、manifest保持核验后，21:09再次识别。最新候选 `vox_039ef5c01a374b4e95774aa68b4d2a86`，trace `I:/AI/asmr-director-voice-work/long-text/9f662760-6b5b-4ed0-a900-e40c50ebb1d1`。21:10写入的manifest、failure、analysis和result一致：首句 `boundary_check / cut_text_mismatch`，目标「回来啦。」、独立左侧 `targetTranscript`「回来」，尚未到最终 `target_validation`，segments为空；原完整15.36秒音频保持。此轮是用户发起的原音重识别，generationCalls=0。

用户随后要求听切点左侧并询问方案。失败记录没有直接保存试切WAV或具体cut，因此以保存的sourceWords、同一原PCM和当前检查器离线重放候选搜索。重建得到唯一候选：cut=2.02秒、原始帧0–96960，检测安静区1.57–2.47秒、阈值−54.076165dBFS。这只是候选及声学证据，不能据此宣称后句或整组检查已通过，也没有擅自判定听感完整。

试听文件位于本证据根 `qa/cut-listening-20261014-2109/`：`left-candidate-01.wav`（2.02秒）与`original-context-0-4s.wav`（4秒原音对照）。PCM切片逐字节与原始帧比较通过，无淡化、裁边、重采样、音量/速度/音高变化；0新ASR/TTS调用。`export-failed-left-listening.py`、`listening-report.json`与`served-listening.json`保留重建方法、SHA、候选数据和HTTP核验。

为方便直接播放，仅新增独立诊断音频文件到既有素材目录：`diagnostic_20261014_2109_left_51ceb132`、`diagnostic_20261014_2109_context_f48a16ff`。3001的 `/api/assets/clip/<assetId>` HTTP200，下载字节SHA与导出文件一致；生产候选manifest完全保持，未创建/采用任何候选。提供原文件链接和HTTP音频链接给用户试听，不绕过此前浏览器策略，也未声称自己听出尾词。

建议仍待用户决定、没有生产代码改动：先人工试听分清实际截断与短窗ASR漏字；将切点安全和文字差异拆为明确状态，在源对齐/原PCM静音/独立后文证明足够时，极短句字差可供试听确认，自动门槛维持。中文强制对齐是可选后续增强，当前未接入；其对齐分数/时间可辅助切点，但不能单独证明没漏字。真实截断应在下一真实安静区调整；完整原音确实缺字则重生成该整段。不要继续堆无限ASR重试或把所有缺字自动放行。
