# 目标台词已匹配、后文语气词阻断定位

日期：2026-10-07。归属现有“人声导演与真实ASMR音效质量V1”，父阶段仍进行中，SFX模型工作保持暂停。

用户指出原句“今天是不是又加班了？眼睛都红红的。”识别为“今天是不是又加班了眼睛都红红的嗯面快好了”，并追问此前85%/最多2字容错为何失效。实际录音记录 `7e564226-9ac0-462c-a736-38016383a316` 的目标15字完全一致；故障是 `continuation_alignment/unrecognized_continuation`，定位期望“面快好了”前有独立“嗯”（4.7–5.2秒），不是目标比对未达到阈值。

目标内容的原90%替换路径及85%/至少10字/最多2次编辑的末尾锚点路径保持。追加严格有界的后文桥接：源目标、独立左侧和最终片段必须精确匹配，只允许后文前一个独立带时间戳的原音“嗯”；真实静音至少160ms，候选在目标末词结束+80ms至“嗯”开始−80ms之间。独立右侧改为完整剩余语境（仍受120秒输入及worker期限限制），从首词精确匹配完整给定后文，前面可有一个独立“嗯”；原音及静音证据齐全时允许独立识别省略该语气词。合词、重复、其他词、后文缺字/同音替换/错序、语音泄漏仍拒绝，不扫描后面巧合锚点、不按字数拆时间，不自动重新生成或采用。

仅最终成功保存 `continuationBridge` 原字词索引/时间及右侧独立识别；服务端验证schema及安静截取证明。衔接失败改为准确提示；旧候选的精确误导警告仅显示时替换，工程数据不变。界面区分完整原音、后续定位台词和未采用的试裁结果，原ASR文字不改写为台词。

修改范围：Python分析脚本/测试，识别schema/分析服务与测试，生成/录音提示与测试，候选/对照组件与测试，client-safe `voice-review-warning.ts`。协议同步至 [英文](../superpowers/specs/2026-09-24-ending-anchor-extraction.md) / [中文](../superpowers/specs/2026-09-24-ending-anchor-extraction.zh.md)。保留其他会话的空间工作台与Qwen改动。

验证：先复现旧故障再实施；Python首轮85项通过，完整右语境/省略首“嗯”先红后绿后最终88项通过；JS六文件172项通过，相关13文件ESLint、完整TypeScript及生产Webpack构建通过。保存的真实ASR及原波形复核：目标精确、结束字词索引11，桥接词索引12，搜索4.22–4.62秒内实测安静区4.27–4.62秒、候选4.445秒。此波形复核不是独立ASR复跑或最终裁剪验收。

初次真实复测受内存保护限制：入口约2.42GiB，低于2.75GiB门槛，未加载。构建释放内存后入口3.35GiB，8.3秒后余量降至约673MiB，ownedworker PID12092由768MiB保护终止并确认退出，停在source_transcription。没有更改系统内存/分页设置。

用户明确释放内存后，原音实测可完成，53.69秒、RSS峰值约3.33GiB，目标仍完全一致，但短右窗7.12秒识别“嗯面块好”而导致boundary_check失败。对同一静音裁点4.445秒独立诊断：左侧一直精确；原短右窗31.89秒得到“嗯面块好”，沿原正常路径+650ms至7.69秒的31.33秒诊断得到“麵塊好了”（漏“嗯”且同音误识），完整右侧至26.56秒的29.39秒诊断得到精确“面快好了我多煮了一小会儿软一点好消化…”（仍省略首语气词）。完整右側诊断明确复用前次真实left证据，未伪称再次识别left。这些反例促成完整右语境及仅省略首“嗯”的严格契约，不能靠放松后文阈值处理。所有诊断仅另存JSON，不生成模型语音，原音SHA保持。

最终完整worker真实复测通过：`real-original-check-final-receipt.json` 记录73.89秒、RSS峰值3,471,515,648字节、exit0、未触发保护，`stage=complete` / `coverage=1` / `substitutionCount=0`。独立原音/左/右/最终裁剪检查全部实际运行，最后识别“今天是不是又加班了?眼睛都红红的”；4.36秒输出终点落在4.27–4.62秒安静区内，距源“嗯”开始4.7秒仍有保护。右侧真实识别从“面快好了…”开始，没有补写识别器漏掉的“嗯”。标准48k单声道PCM16另存为 `real-original-check-final/output.wav`；原录音SHA前后都是 `227bfba23a4f45927874f1bff1cf3e92fec8c44de90195e05dd12b7ee8456547`。旧候选仍保持历史review记录，不自动修改工程或采用这个隔离重检结果。

真实worker JSON/WAV再通过现有TS schema及 `analyzeVoiceGroup` 服务端，外部1项fixture/6个case：成功输出字节SHA `6dfacdcee083adf24020338b0437139c96cfdea799bd1d202f0ff52da3f7a40a` 完全一致；缺quiet、quiet跨“嗯”、请求后文不一致、coverage不精确及源“嗯”时间错误5项均422拒绝。该层仅重放真实输出，不调用模型/API，临时目录清空，原工件SHA保持。证据 `service-final-real-worker.json`。

真实3001页面确认原候选和原录音都显示准确的衔接失败原因，完整原识别文字及定位后文仍可查看。33个DOM输入值（含台词/策划）、标题、时间线、声音normal_zh和选段10的快照完全一致；控制台无error/warn。390px DOM无横向溢出，临时视口已恢复；窄屏截图provider缩小显示，不能作为完整窄屏视觉验收。桌面截图 `recognition-context.jpg` 是本次展示证据。

新运行构建 `.next-reference-asr-repair-production` / BUILD_ID `mMBc94MV0dYU8X8CKteWT` 在同一 `http://127.0.0.1:3001/`，PID23976、可控终端session60216。替换前重新确认旧PID1828的身份及无模型/锁；Next配置仅新增构建include后恢复原完整字节，保留已有空间include。Next继续使用既有SWC/WASM回退；构建53.94秒、进程树RSS峰值1.63GiB，未触发保护。`.env.local`仍是其他会话的`.next-spatial`，后续重启必须显式指定本运行dist。

最终 `preservation-final-after-real-service.json` 通过：152素材、10参考/profile、11上传、3备份、25空间源、1111Qwen工件、475历史原音及原H盘MP3的SHA保持；59Qwen权重仅比对size/mtime，未重读权重。`runtime-final-after-real-service.json` 确认HTTP/BUILD_ID/catalog/参考原音字节及native/锁/ASR scratch清洁；7863–7866无监听，不恢复已经停止的独立Qwen服务。先前 `preservation-post-repair.json` 为真实复测前检查点。证据根 `I:/AI/asmr-director-continuation-repair/2026-10-07`；Python红/绿日志 `I:/AI/asmr-director-leading-hmm-continuation/2026-10-07`。当前修复未提交推送。
