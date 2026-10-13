# 人声音质 V1：识别字差的本地拼音容错

日期：2026-10-07。固定父阶段：**人声导演与真实 ASMR 音效质量 V1 / in_progress**；真实 SFX 模型试验继续按用户要求暂停。本子项代码已部署，真实原音复测待内存充足；本轮没有提交、推送或自动采用。

## 用户意图与原因

用户授权采用本地文字对齐、同音/有限近音容错，并追问是否真正试过 embedding。此前 embedding 建议来自用途与文档，没有实测；本轮准备官方小模型对照但下载超时，仍未产生 embedding 分数，不能宣称其效果已被证明。

当前热汤面工程第10段为 `来~~，面来啦！汤也喝一点，暖胃。`。候选 `vox_4e1b84066347486ca3ed765154b4281b` 的源识别前缀是 `来面来了汤也喝一点暖胃`，一字差、90.9%，旧定位能够通过；尝试裁片识别为 `来面来了糖也喝一点暖胃`，两字差、81.8%，低于普通90%及有条件85%。`~~`和标点在比较前已经归一，非本次直接原因。`汤 tāng / 糖 táng`是声调差，不是同音同调；句尾`啦 la5 / 了 le5`采用单独的有限语气词规则。

22.4秒完整原音来源为 trace `31dc4f86-a66a-4266-88e8-bef671d71c0f`，raw SHA256 `bc1c6621343b6f9dcf1b1a314f532c03c53a9467893b273f35db0d6db4348181`。失败检查点没有记录当时实际试切范围，不能把fallback整段范围当作实际切点。用户已调整的第10/11段顺序保持，本轮未恢复历史快照。

## 代码与边界

- Python只在裁剪后的内容核对追加`phonetic_substitutions`，原音定位仍先过既有90%路径，普通90%与有条件85%分支保持。
- 目标至少10字，至多2处同位置替换；同音同调罚0，至多1处有原音对应目标字支持的声调差罚0.25，仅请求子句末的轻声`啦↔了`罚0.25。拼音得分`1-总罚分/字数`须≥95%。本例规则测试保留文字81.8%，拼音95.45%；这不是声学置信度，也不是实际录音已通过的声明。
- 增删、移序、重复、数字/否定字、无源支持的声调差及一般声母/韵母近音不放行。Python字典缺失/查词异常保守回到旧流程；使用既有ASR环境已安装的pypinyin，无安装或模型变更。
- 拼音不能替代真实至少160ms静音、两侧各80ms切点保护、左右独立识别、最终裁片整段/词一致、完整子句/时间戳/内部停顿及后文核对。无后文和首`嗯`桥接不启用新模式；桥接目标仍要求精确。
- TypeScript重算文字/罚分并绑定目标文本、原音整词前缀/整段转录、裁片转录与真实请求子句末；保留所有声学与输出校验。繁简归一不能对齐时保守拒绝新模式。独立审查发现并修复缺少源字段绑定与金融数字保护的一致性缺口。
- UI显示真实汉字相似度、独立的「拼音容错得分」及逐字拼音/放行理由，提示试听。生成与重新识别共用差异提醒，旧元数据及旧提醒兼容。旧候选不覆盖，新结果仍须手动采用。

源码/测试范围为两份Python文件，以及`voice-recognition.ts`、`voice-group-analysis.ts`与测试、`voice-phonetic.test.ts`、`voice-review-warning.ts`、`voice-longtext-generation.ts`、`voice-candidate-recheck.ts`、`voice-recognition-comparison.tsx`与测试，共11份。新双语规格见[中文](../superpowers/specs/2026-10-07-voice-recognition-phonetic-tolerance.zh.md) / [English](../superpowers/specs/2026-10-07-voice-recognition-phonetic-tolerance.md)。`.gitignore`仅增加本轮生产目录忽略，共享文档仅追加本轮记录。

## 已验证与未验证

证据根：`I:/AI/asmr-director-phonetic-review/2026-10-07`。

| 检查 | 结果与证据 |
| --- | --- |
| Python mock回归 | 110/110；`python-implementation-tests-final.log`、`python-implementation-final.json`；未加载ASR模型 |
| TS/界面/生成/重检回归 | 初次6文件172项通过；最后文案/数字保护修改后的两相关文件及三份历史存储/重检兼容共5文件98项通过，`phonetic-tests.log`、`phonetic-final-compatibility-tests.log`；两轮有重复，不相加计总数 |
| TypeScript / ESLint | 完整非增量TypeScript通过，`typecheck.log`；9份本轮TS/TSX最终ESLint通过，`lint-final.log` |
| 独立契约检查 | 29项纯mock全部通过；`phonetic-final-contract-review.json` / `phonetic-final-readonly-review.json`保存11源码/测试SHA；修复前red收据保留为历史，未覆盖成green |
| 正式构建 | 39.74秒，exit0；`build-production-verification.json`。原生SWC已知警告由Webpack/WASM回退通过；首次脚本把warning误作PowerShell错误，修正日志处理后构建成功，未修改第三方依赖 |
| 原3001浏览器 | 正常刷新后热汤面工程、第10段选择、50输入值/标题/时间线全部保持；10采用/1待生成/9已生成未采用，旧22.4秒候选和重新识别按钮仍在。`browser-verification.json`、`browser-before.json`、`browser-after.json`与`current-candidate-after-update.png`；未注入候选或点击采用 |
| 原音真实ASR | **未运行**。`actual-asr-not-run.json`记录可用提交内存3,965,165,568 bytes，低于历史CPU/int8峰值3,470,000,000＋768MiB余量即4,275,306,368 bytes。没有强行加载、重检请求、TTS或新增候选；新模式真实页面得分/裁切结果及听感仍待复测 |
| Embedding | **未实测**。官方`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`固定revision的int8 ONNX下载到300秒预算后停止，partial31,457,280 bytes未加载，28手写文字样例cosine全部null；无阈值/准确率结论、API调用或产品集成。见`embedding/embedding-attempt-verification.json`与说明 |

完成文档后的`preservation-final.json`、`runtime-final.json`及`final-audit-summary.json`再次通过严格保护，verificationPassed=true：160素材/512原音文件/60候选manifest原字节、5参考/profile、H盘输入、33其他会话文件/17共享段、4配置及前轮17预览源码/3文档/3共享段均保持。HTTP新build/参考目录/原WAV校验通过，无原生任务、3锁或ASR残留；HEAD仍e06f8ca75b6b60568ce0c882af8fb95d266ee7b7，索引为空。不沿用旧数量，也未宽泛放行新文件。

## 运行与续做

正式原址`http://127.0.0.1:3001/`，当前PID24328，owned terminal66711；dist `.next-phonetic-review-production`，BUILD_ID `Jye0tEJ_csWpN5S-HqM6I`。旧PID19636/terminal52142已在无原生任务/锁时停止。明确覆盖`.env.local`的其他会话dist，`NODE_OPTIONS=--max-old-space-size=1536`，TEMP/TMP为证据目录`tmp`；预览临时根仍为`I:/AI/asmr-director-accepted-preview/2026-10-07/previews`。构建后Next两配置恢复原字节，不改系统分页或其他服务。

内存充足时，只对第10段候选1点「重新识别」：利用已保存完整原音进行一次300秒总上限的串行ASR，另存新候选，不需重新生成。核验真实静音/左右/最终识别和界面文字/拼音得分；试听后由用户采用。若产生新增数据，使用本轮精确追加审计脚本证明旧60候选与原音保持，仅允许实际新候选对应资产/trace；本轮因未重检继续严格零新增保护。Embedding后续若继续，先完成并验证官方模型，再记录实际余弦对照，不能把本轮手写字差测试当作embedding实验。

按既有`AGENT.md`路线同步`docs/ROADMAP.md`、`docs/AI_HANDOFF.md`、`docs/project-archive.md`，父阶段保持in_progress、SFX暂停；不新增顶层路线或另造初始化文档。代码部署不等于真实原音/听感全部验收。
