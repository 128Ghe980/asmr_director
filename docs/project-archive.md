# AI ASMR Studio 项目留档

记录日期：2026-06-14

最后更新：2026-10-13

AI/上下文压缩恢复入口：`docs/AI_HANDOFF.md`

## 2026-10-13 — 字数实验生成方式澄清与文档交接发布

用户确认生成方式后要求「记录清楚，推一版」并交接。明确近期40/80/100及之前80/160/240/320实验均每段直接生成完整A，带固定参考WAV和参考台词，不追加B/C后文、不ASR裁切/只取首句，整篇完整PCM连接；产品旧长文本窗口策略未改。保留80最均衡、40第1轮一处语气不一致、100第3轮一次末尾略尖及此前长档/温柔负面听评，均限本稿/参考条件。

发布范围为文档，包含主文档所引用的此前未跟踪记录与双语规格；共享预览/排序/识别/空间代码仍未提交，I盘音频/模型/JSON不入Git。20:44 HKT鲜读3001/8781/8782无监听、无匹配模型/扫档进程，旧HTTP/PID条目为历史，本轮不重启服务或生成。文档依赖和源码保护检查、实际Git/远端确认见 [本次交接记录](records/2026-10-13-audio-quality-v1-generation-method-handoff.md) 与发布收据；本段不提前声称推送成功。父阶段进行中、SFX暂停，未清理磁盘。

## 2026-10-13 — 普通女生40/80/100试听反馈：80最均衡

用户反馈40字切分太细，第1轮有一段前后语气不太一致，其余都不错；100字第3轮出现过一次末尾稍微变尖，其他都不错；80字很均衡。未指定问题的具体段号/秒点，不将100的问题定位到20字尾段。当前将约80汉字、按句号累加完整句子记为同《雨夜回家》文案/原普通女生参考/本次引擎参数下的优先选择，40和100有上述偶发问题；不是模型通用上限，产品默认策略未改。此前160/240/320变尖变快、温柔偏快偏小待换参考的听评保留。

仅同步用户听评与交接文档，新增TTS/ASR/API调用0；音频、冻结JSON/ZIP与旧证据保留，无提交推送。音质V1继续进行中、SFX暂停。详情见 [补测试听记录](records/2026-10-13-audio-quality-v1-40-100-and-disk-audit.md)。

## 2026-10-13 — 用户听评收窄、普通40/100补测及磁盘盘点

在此前80/160/240/320四档粗测中，用户确认普通仅80汉字档可用，160/240/320变尖变快；温柔整体快/小不可用，之后换参考。保留本稿/本条件反馈，原文件通过只证明完整、不设产品通用80硬上限。普通同稿同参考同seed/全部TTS参数40/100各3轮实际36calls全exit0/6full/42WAV，1086.750秒；40×8整篇79.52/80.32/76.96秒，100+100+100+20整篇75.20/75.36/75.84。独立配方/CLI/完整PCM/CSV无ZIP检查PASS，无API/ASR/guard/质量重试。新root约90.91MB逻辑，未复制模型/重复打包；8782新父目录只读服务九条40/原80/100同页原声直接下载，原8781保留。当时两新档听感待用户，后续反馈见上条。

只读统计D仅129MB余量、ASMR本地25.92GiB；I相关模型实验40.67逻辑/~56.87GiB分配，exFAT128KiB簇致约16.20GiB小文件浪费，近期扫档0.485GiB。I主要大根Steam584.85/game75.89/movie60.04GiB；D选根Pycharm57.22/Codex33.35/tmp11.68等。旧GPT环境＋Whisper被默认ASR引用不能整删；首批可审阅下载分片/安装/不完整下载约5.72GiB，未执行删除/移动/压缩/分区更改，CosyVoice旧实验处理须明确弃用授权，Nextjunction须先核。完整路径/数字/依赖及验收见 [记录](records/2026-10-13-audio-quality-v1-40-100-and-disk-audit.md)。无生产策略/旧音频/参考/提交推送，音质V1进行中、SFX暂停。

新根轻量终态70关键旧文件SHA/12运行检查PASS，模型/监督/批次/watch/锁/STOP均无，36成功/6full/42WAV无ZIP确认；8781与8782只读服务保留，D当时约123MiB余量、I约7.99GiB，原音频/旧证据保留。未为收尾重复大范围生产或模型扫描。

## 2026-10-12 — 普通女生四档三轮生成完成；两种参考24条配对试听

普通女生补测最终27实际原生调用全exit0/12完整成片，与温柔同320汉字稿/句号切分/seed7911–13/模型和全部生成参数，仅换原normal参考及对应原文字。普通80档76.96/73.92/75.52秒，160档64.96/74.24/73.44，240档70.56/75.84/72.32，320整篇75.20/67.68/65.28。独立Combined日志/命令/采样数/串行/完整PCM/39WAV42条目ZIP全部CRC/SHA通过；新8781对比页与CSV现普通12＋温柔12，共24完成播放器，服务原字节保持，旧soft音频/HTML/ZIP原样保留。

4次guard-only均载模型前拦截，无child、不计TTS/质量重试；五会话5/3/0/3/16成功。最后16调用使用仅增加8秒启动前编排等待的新独立controller，两行diff/语法通过，原controller/请求/guard与音频间隔不改，无实际模型失败/ASR/API/自动质量重试。session05香港19:45:02–19:58:18、796.640秒；会话wall总1085.811秒不含会话间资源/用户交互空档，不能把整段时间跨度称连续计算。普通ZIP120,897,758字节，路径/SHA/验收和恢复限制见 [补测记录](records/2026-10-12-audio-quality-v1-normal-reference-length-comparison.md)。口述全文、听感、参考条件因果与最佳字数仍待用户，音质V1进行中、SFX暂停，无产品策略/3001/提交推送。

Normal-final保护与15运行检查全通过：旧96/224/782/10/历史试听/tea101/soft235/原17后端SHA及旧start/partial收据不变，31原生收据/12full/五会话绑定、无模型/监督/批次/watch/锁/STOP残留，HEAD/index保持；8781所属只读服务保留，3001未操作。终态GMS4.773GB仅完成后快照、不作后续新生成放行；本轮已完成无需重新生成。

## 2026-10-12 — 普通女生同稿四档补测；内存波动断点保留

用户要求普通女生也按80/160/240/320汉字上限各3轮，与温柔保持同文案/参数。新normal27请求与soft逐项审核通过，320汉字/359字符、局部句号切分、固定b228引擎/steps800/配对seed7911/12/13等保持，仅换普通女生原参考及对应自然标点prompt。当前8/27真实成功全exit0，80档前两轮完整76.96/73.92秒，剩19段/10整篇未完成。3guard-only启动前内存阻止均无child，不计作TTS/质量重试；原4.82GB门槛不降，已请用户释放约1GB；恢复跳过成功任务、原收据保留，实际模型失败/ASR/API/自动质量重试均0。

新增8781 `compare-normal-soft.html` 与CSV，24播放器按同档/同轮并排，当前普通2/12、温柔12/12完整，未完成项待生成；无预加载/自动播放，单条播放暂停其他条，原文/整篇和各段下载保留。旧soft235文件/原生产96/224/782/10/tea101/后端17开始保护通过，无产品代码/参考/旧音频/3001服务或共享dirty变更、无提交推送。最终normal27调用/12成片/ZIP与听感尚未验收；参考条件含WAV时长/音量/节奏与对应文字，不能归因于单一音色变量。音质V1仍进行中、SFX暂停。恢复和证据见 [补测记录](records/2026-10-12-audio-quality-v1-normal-reference-length-comparison.md)。

## 2026-10-11 — 句号分段字数粗测完成；温柔参考四档各三次

用户后续要求开始生成，fresh可提交8.09GB通过原4.82GB门槛后串行完成27真实TTS全部exit0/12完整试听，香港时间20:14:41–20:27:12、750.297秒，无API/ASR/裁切/变速变调/自动重试或平台采用。沿用同320汉字稿、温柔原参考、b228隔离引擎与配对seed7911/12/13。80档三轮60.32/64.80/63.68秒，160档57.28/60.80/54.40，240档60.80/62.88/61.92，320档整篇直出57.92/60.32/61.76。独立实际配方/串行/EXE参考SHA/12完整PCM连接与39WAV42条目ZIP全部CRC/SHA通过，原稿/请求保持。生成及文件验收完成，口述全文/听感/字数质量上界仍待用户，不把320宣称通用上限。

本机8781只读试听页12播放器/27原声链接/逐条下载与完整文案HTTP200，隐藏Python helper PID24912只绑定127.0.0.1，服务页面与音频字节保持；产品3001未操作，浏览器打开返回queued。ZIP85,496,432字节及CSV/TXT/离线HTML在既有粗测根，SHA与独立收据见 [记录](records/2026-10-11-audio-quality-v1-sentence-length-coarse-sweep.md)。无生产代码/参考/旧音频变更或提交推送；音质V1仍进行中、SFX暂停。下方0生成/内存不足为准备阶段快照，实际状态由本次完成覆盖。

生成后96候选/224资产/782历史/10参考、旧采用/试听、tea101及原后端17最终SHA保护全通过，14运行检查通过：模型/监督/批次/watch均0、三产品锁/批次锁/STOP均无、HEAD/index保持、3001仍无listener，8781仅所属只读试听helper。Python审计脚本首次removesuffix兼容错误另存证据并仅恢复runtime检查，两审计均0模型、旧收据保持，不计作模型失败或重试。

## 2026-10-11 — 句号分段字数粗测准备；内存不足历史快照

用户要求同一文案递增段长、每档三次、先粗测后缩小区间，切分不用API。准备《雨夜回家》320汉字/359含标点字符，16句各20汉字；按句号累加80/160/240/320汉字上限，实际4/2/2/1段，每档三轮共计划27原生调用/12整篇试听。温柔原参考为已说明默认值，声音选择尚未回复；各档同b228隔离VoxCPM2引擎与原参考，配对seed7911/12/13，原标点保留、steps800。每段完整原声精确PCM拼接，新增间隔0，不调用API/ASR、补后文或裁首句，不改产品策略。

当前真实TTS/ASR/新音频均0；fresh GMS可提交约3.60GB低于4.82GB门槛，已请用户释放约1.5GB，未绕过或长时间循环等待。实验根 `I:/AI/asmr-director-length-sweep/2026-10-11-coarse` 已有原稿、27不可覆盖请求、manifest及12待生成试听目录；脚本语法通过，单次300秒/批次1800秒、所属子进程取消及保留断点准备完毕。独立配方/睡眠替身取消/完整PCM保留及错误缓存拒绝审计通过，原产品/旧资料/tea101/原后端17终态字节保护通过、无任务与锁残留。240档尾段80字同其他档配方可出现相同SHA，不用强制不同文件；上界尚未测试。保持原产品/参考/旧录音/后端与共享dirty，无服务操作或提交推送；音质V1仍进行中、SFX暂停。见 [记录](records/2026-10-11-audio-quality-v1-sentence-length-coarse-sweep.md)。

## 2026-10-11 — 整篇试听反馈与生成方式澄清

用户反馈本次茶稿整篇尾部轻微变尖、温柔更明显且渐有轻微电流杂音、整体略快，但远好于此前预判。记录后续方向：按大致字数与自然语义控制适中段长、优先使用每段完整原声，不再预设“两小短句必须切分”；尚未确定通用阈值或修改产品策略。澄清Oct8《深夜陪伴》四段clip完整拼接，Oct9/10《雨后清晨》正式目标＋后文长生成/ASR裁出目标/等待拼接，Oct11本次全文一次直出完整保留；此前说明轮次不清，不能把正式裁片说成纯分段直出。

隔离引擎是同VoxCPM2权重的独立本地EXE，解决最终长解码CUDA COPY维度限制，保留平台原EXE/provider；新EXE还链接Aug30组件、与旧Aug25输出非逐字节一致，不声称修复音色漂移或杂音。仅留档与说明，本次0TTS/0ASR、无代码/服务/音频修改/提交推送，音质V1仍进行中、SFX暂停。见 [记录](records/2026-10-11-audio-quality-v1-listening-feedback-and-generation-clarification.md)。

## 2026-10-11 — 字数/参考测量与两条茶稿整篇生成

用户比较六次夜雨后认为普通声音轻微上扬、温柔更明显，要求统计字数并各整篇生成《雨后清晨》。确认夜雨150汉字/166含标点字符、茶稿228/258；正式茶稿非末实际生成146–186字符，提取16–36字符目标，末段32，不是每次500。原参考RMS温柔比普通低约5.24dB，整片文本/时长3.91对3.49汉字/秒，包含停顿且非LUFS/因果或客观音高验收。

隔离复制一个CUDA COPY源码并链接实验EXE，超限网格走既有一维COPY、正常保留旧路径，6小探针逐位0差、4实际fallback；新EXE借用Aug30缓存组件，产品ECB为Aug25。2短录音兼容实际核对非bitexact，普通34.56→32.64秒、温柔26.72→25.92秒，不能单归COPY；已明确差异并保留新短基准。随后同引擎完整258字符True Combined/自然标点/固定原参考/seed7811各整篇一次，普通50.24、温柔46.40秒，真实exit0/完整48kmonoPCM16；两最终解码各3次超限COPY fallback成功，WAV/ZIP逐字节核验通过，无裁片拼接/音高语速响度调整/平台导入。内存不足时2guard-only阻止没有模型child，fresh GMS通过后实际4TTS/0ASR，300秒串行监督及锁释放全部通过，无质量自动重试。准备final与生成后final分开留存，不冒称ASR/音高或听感验收。无生产后端替换/服务操作/生产源码修改/提交推送，音质V1仍进行中、SFX暂停。证据根 `I:/AI/asmr-director-whole-script-compare/2026-10-11-tea`，见 [记录](records/2026-10-11-audio-quality-v1-tea-whole-compare.md)。

## 2026-10-11 — 温柔参考/普通女生各三次整篇夜雨试听

用户试听昨日25.44秒原声后反馈很快/有点变尖，要求再生成温柔参考3次，再普通女生3次。沿用同166字夜雨原稿与现有VoxCPM2 True Combined旧整篇配方，仅改变配对seed7811/12/13及对应参考声音/原标点参考文字。温柔26.72/26.72/27.84秒，普通女生34.56/32.32/32.32秒，六原声均真实exit0/完整48kmonoPCM16、六SHA不同，无裁切/拼接/音高速度响度调整/自动重试/ASR或平台导入。证据根 `I:/AI/asmr-director-old-method-compare/2026-10-11-six-takes`，六WAV的ZIP解压字节保持。

独立每条21＋汇总5项核对通过，实际参数/Combined/全文/自然标点参考/固定原参考/配对seed/完整RIFF/SHA/串行/锁释放吻合；没有客观音高测量或听感验收。向用户说明本次整篇原声与正式每目标＋后文长生成/非末省略号/参考标点转空格/ASR提取＋连接的区别，基础模型/带参考及参数相同。普通女生原参考8.6秒，正式归一文字与原WAV的保存identity亦核对精确匹配。fresh保护96/224/782/10、此前20adopted＋6交付证据＋昨日5比较资料；初始3001无listener，未重启或停止服务。只生成/核对/留档，无生产源码/构建/提交推送；音质V1进行中、SFX暂停。见 [记录](records/2026-10-11-audio-quality-v1-six-whole-voice-comparisons.md)。

## 2026-10-10 — 旧文案恢复与整篇直出对比

找到最近320字《你回来啦…》原稿（当时交付各4段clip）及更早166字夜雨实验稿（对应整篇后半变尖/加速的历史问题）。用户尚未选两稿，按已说明的较早成功稿，用VoxCPM2旧seed7801、温柔参考音频＋精确原标点参考文本True Combined、CFG2/temp1/timesteps10/max420/gpu0重跑一次，保留完整25.44秒原声，无语义裁片、拼接或音速处理。当前Aug25引擎/新增low-vram差异明确；真实native exit0、26.453秒，完整WAV与18项核对通过，新文件与旧路径当前文件逐字节一致。本轮没有ASR或听感验收，不宣称旧路径已独立证明Aug12原始字节。

证据根 `I:/AI/asmr-director-old-method-compare/2026-10-10`。单次300秒监督、fresh提交内存guard和产品生成锁生效，模型结束/所属锁释放，无自动再生或平台媒体写入。开始时3001无listener，未重启/停止服务；保护新的96候选/224assets/782历史/10参考及此前20adopted和6完整交付文件。最近320字整篇未重跑，CUDA grid限制仍存在；只读调研发现现成全CPU开关，无仅VAE CPU/最终分块解码，CPU速度容量未测。保留共享未提交改动，不改源码/构建/提交推送；音质V1进行中、SFX暂停。见 [记录](records/2026-10-10-audio-quality-v1-old-whole-generation-comparison.md)。

## 2026-10-10 — 两篇新文案的正式语义长生成试听

用户核实昨日两条是clip四段直接拼接后要求新文案试听。本轮原3001正式 VoxCPM2＋参考音频/文本＋语义单元long_text、16子句/500字符滑动后文，ASR安全提取目标再采用。普通女生新工程《雨后清晨喝茶》10段passed/已采用、完整62.280020833秒WAV原生下载及精确PCM/字节拼接验证通过。第8段两次review保留未采用；仅移动一句到第9段，全文/标点及其余8段context/fingerprint/采用精确保持，再生成两个目标均通过。第3/9/10段识别差异warning保留，听感待用户判断。

正太02《末世归家的生日礼物》10段正式passed/采用、74.22秒完整WAV亦完成；首单元3字差review后新seed正式通过，第6段短后文同音差仍review，仅移一句到第7段且全文/标点/其余context保持，两目标再生100%通过。识别贴→接不是同音，全部字差warning保留。两篇各13实际候选，共20最终采用/4review/2原目标passed失效历史均保留，无自动质量重试。合并210轻量绑定及两篇精确PCM/WAV拼接全通过，原tab刷新/切换两稿文字和采用保持；5项独立保护检查确认旧70候选/172资产/570历史/10参考保持，仅追加26候选/52WAV/212历史文件及候选manifest更新。

内存4.25GB不足时暂停，用户释放后7.402GBguard通过继续，正太批次前6.969GB及最后局部3目标6.636GB通过；三监测窗间约74秒缺口保留，不宣称全程连续。最终runtime9项检查通过：0模型/0watch进程/3锁无、Node8088唯一3001 listener/HTTP200、6旧空run目录保持、HEAD不变/index空；候选watcher自然exit0。原3001已不存在，只隐藏启动已验证最新build；历史PID2592已复用为svchost未停止。最终20条pipeline合计2605.810秒，其中CPU ASR1854.680秒为主要耗时，26实际候选pipeline合计3307.008秒是任务报告总和，非精确watch wall-clock。212新增历史文件为26trace×8及4review failure.json，不是未知自动重试。

严格 `watch-delta-final-reviewed.json` 19项全通过，26候选与26实际trace一一对应、seed唯一/同声音reference固定、20正式采用＋6未采用历史全留。首个delta false来自临时审计器包装plan与innerplan比较错误，保留首收据后修正字段及项目/clip/source/context核对，最终通过；没有音频或生产修改、不是模型失败。

证据目录冻结10-09而运行跨10-10。无生产源码、构建、提交推送；本轮制作完成但音质V1仍进行中、SFX暂停、旧dirty内容保持，听感和音高/速度一致性由用户判断。短后文同音在严格定位仍可能拒绝，本轮只有合法语义边界调整，无阈值放宽。见 [本轮记录](records/2026-10-10-audio-quality-v1-standard-two-scripts.md)。

## 2026-10-08 — 普通女生与正太02长语音试听

补充最终验证：修复临时校验脚本后离线ASR完整核对两WAV，99.49秒完成、SHA不变，两者都识别至「晚安今晚安心休息」，没有正文/结尾截断迹象。相似度99.096%/98.917%，少量字差保留，未绕过或修改产品短句识别阈值；首次46.97秒checkpoint替换失败收据仍保留。模型父子进程已退出、无运行锁。听感仍由用户试听判断。

使用原3001工程编辑界面，为普通女生 `normal_zh` 与「正太音2」创建独立工程，同一篇320字符深夜陪伴文案。整稿一次原生解码遭CUDA grid长度断言，并未产生WAV；随后沿用系统现有串行批量生成、采用和整体预览，四段一组、段后等待0，实际得到69.92秒及75.04秒完整原声WAV下载。8条均无长度警告，最终预览与各组四条原声精确拼接一致，原热汤面工程文字/采用保持、新工程刷新保留。长录音原生解码限制尚未修复；最终离线文字核对与首个临时校验器Windows写进度失败见 [记录](records/2026-10-08-audio-quality-v1-two-long-voices.md)。仅生成与记录、无生产源码或服务修改，音质V1进行中、SFX暂停、无提交推送。

## 2026-10-08 — 释放内存后的真实单次生成成功

用户授权再试，原3001已先停止，仅启动已验证的新build，无停止进程或绕过前轮审批。当前PID2592/build `jzycOB_1_hvvzeCLn6eiE`，显存错误提示修复已部署。原第10段normal_zh及参数不变，一次生成/ASR约93秒成功，无自动重试，新增3.9秒/90.9%候选与20.5秒完整原音；普通90%阈值通过，仅啦→了字差。旧候选/资料保持，不自动采用，刷新后新结果/50输入/标题/时间线不变。精确新增1候选/2WAV/8trace文件，原162素材/527历史/10参考profile字节保护与无残留检查通过。证据及监测口径见 [记录](records/2026-10-08-audio-quality-v1-generation-retry.md)。本次成功不证明此前fast-fail具体原因，听感待用户试听；音质V1进行中、SFX暂停、未提交推送。前轮“未部署”是历史快照，由本次实际启动覆盖。

## 2026-10-08 — 生成显存不足诊断；提示新build未部署

前一次真实生成在参考AudioVAE编码时申请757.27MiB显存失败，CUDA allocator明确报OOM；后一次3221226505原生崩溃没有OOM证据，不能归为同一原因。只补精确同一行cudaMalloc/Async错误分类及7项保护回归，54项provider/session、完整TypeScript/相关ESLint、42.92秒正式构建及独立11项字节审查通过。新dist `.next-generation-oom-production`/build `jzycOB_1_hvvzeCLn6eiE`未部署：自动审批阻止停止并重启3001命令，未执行或绕过。原3001仍PID24036/旧build，未进行真实模型复测、新候选/音频或自动采用。音质V1进行中、SFX暂停、无提交推送；显存恢复和最新崩溃原因仍待验证。见 [记录](records/2026-10-08-audio-quality-v1-generation-vram-diagnosis.md)。

## 2026-10-08 — 重新识别后端连接恢复与错误提示

原3001没有运行进程，用户缓存页面请求未送达，通用失败不是当次ASR文字判断；旧60候选/160素材/512原音及22.4秒source保持。恢复同原址到隐藏独立Node进程并落服务日志；共享前端仅两处阶段文案调整，明确网络未连接和无有效响应，合法具体错误/取消/原候选保护保持。20mock、完整TypeScript/相关ESLint/正式构建通过，随后原UI按内存提交余量真实重检保存原音成功，新增4.3秒、0.48–4.78范围、文字81.8%/拼音95.5%候选，补齐前轮样例实际ASR证明；原音/旧候选保留且不自动采用。刷新后新结果、标题/50输入/时间线/顺序保持，听感待用户判断。结果及精确保护见 [记录](records/2026-10-08-audio-quality-v1-recheck-connection.md)。当前3001/PID24036/`.next-recheck-connection-production`，无提交推送，音质V1进行中、SFX暂停。

## 2026-10-07 — 本地拼音容错与未完成的embedding准备

裁片内容核对追加少量同位字差的拼音规则，保留源90%定位、普通90%/有条件85%路径及真实静音/左右最终/子句护栏。UI分别显示文字相似度、拼音权重得分与逐字理由，旧候选不覆盖，仍需试听手动采用。本例回归字面81.8%、拼音95.45%为确定性规则结果，不是实际录音验收；数字/否定、增删移序重复及无源支持声调差保持拒绝。

Python110mock、初次TS172/最后兼容98（重复不累加）、独立29mock、TypeScript/最终相关ESLint/正式构建通过；原3001热汤面工程50输入/标题/时间线/顺序及旧22.4秒候选保持。实际ASR因空闲提交内存未达历史峰值＋768MiB余量未运行，真实新候选及听感待复测。官方MiniLM embedding模型准备下载超时、未加载、无余弦分数，未接入embedding/Flash API。最新3001/PID24328/`.next-phonetic-review-production`，原音/候选/参考/其他会话与前轮预览保护继续严格零新增检查；无提交推送，音质V1进行中、SFX暂停。见 [记录](records/2026-10-07-audio-quality-v1-phonetic-recognition.md) / [中文规格](superpowers/specs/2026-10-07-voice-recognition-phonetic-tolerance.zh.md)。

## 2026-10-07 — 已采用语音整体试听/下载与台词上下排序

文案批量操作下新增紧凑预览栏，仅按顺序合并完整已采用原声与段后等待，跳过未采用段落，提供同文件原生试听/WAV下载；不调模型或修改素材。每段上下箭头交换完整台词及等待，采用/素材/分镜ID/选中保持，自动保存、支持撤回。预览有取消/切换/迟到/过期/刷新清理、范围读取和租约保护；实测修复撤回复活已删除预览及StrictMode节点问题。

112项回归/17文件ESLint/完整TypeScript/正式构建通过。原热汤面20段中的10已采用合成67.65秒，完整播放及原生下载字节一致；实际上下移动撤回、刷新后50输入值/原标题/时间线保持，旧token404，390px无预览横向溢出、桌面恢复。3001/PID19636/`.next-accepted-preview-final-production`；全量保护和一份授权临时预览证据在I盘，原素材/候选/参考/空间/Qwen保持，本轮未提交推送。音质V1进行中、SFX暂停。见 [交付记录](records/2026-10-07-audio-quality-v1-accepted-preview-and-order.md) / [中文契约](superpowers/specs/2026-10-07-accepted-voice-preview-and-order.zh.md)。

## 2026-10-07 — 识别修复与重新识别累计发布

用户授权「记录一下推一版」，整理 `bdfd1cc` 后的后文独立语气词定位、自然停顿上限误判、诊断对照及候选重检。24个ASR源码/测试与记录/双语契约发布，共享文档/ignore仅纳入本次内容；空间/Qwen其他会话改动保持本地。真实原音4.36秒与5.05秒/100%及产品取消/新候选/刷新/桌面390px证据沿用，另检查隔离暂存源树。实际SHA/正常推送和远端一致由Git及新发布收据确认，未提前宣称成功。音质V1进行中、SFX暂停，不新增路线。见 [发布记录](records/2026-10-07-audio-quality-v1-recognition-release.md)。下方未提交为验收时快照。

## 2026-10-07 — 候选采用/放弃旁新增重新识别

已有长文候选可精确读取其保存的完整原音重新ASR/裁切，另存新候选，不调TTS、不自动采用；支持重复重检、reroll继承组跨trace查原音、300秒总时限、取消/切换/迟到保护与manifest锁内原候选状态核对。旧单句候选缺少稳定来源关联，明确禁用。

8文件136项、相关ESLint/完整TypeScript/正式构建通过。真实取消后57旧记录及所有素材完全保持；第二次点击成功得到5.05秒、100%目标及1420ms自然停顿的新候选，旧30.4秒保留。仅追加1候选/2WAV/7新trace文件，原音/source metadata逐字节复制，工程/参考/空间/Qwen不变；刷新与桌面/390px截图通过，viewport已恢复，无原生任务/锁。正式3001/PID25096/`.next-candidate-recheck-production`，音质V1进行中、SFX暂停，无提交推送。见 [交付记录](records/2026-10-07-audio-quality-v1-candidate-recheck.md) / [中文spec](superpowers/specs/2026-10-07-candidate-recognition-recheck.zh.md)。

## 2026-10-07 — 自然长停顿被拼接采样上限误拒绝

用户后文已改为“来~~，面来啦！”，新30.4秒录音源文字/试裁目标均精确，但 `uncertain_internal_pause` 将超1200ms自然句间停顿判整组失败。分开录制10000ms上限与原连接1200ms样本过滤，保留原浮点容差、语音/停顿及全部目标/裁切保护。真实原音52.58秒复验得到5.05秒、100%目标及1420ms停顿，服务重放保留数值/音频SHA，超限/错误数量仍拒绝。

Python92、TS51、相关ESLint/完整TypeScript通过；Python动态读取，无新增构建/重启。当前20段用户工程、历史候选及154素材/489原音、参考/空间/Qwen均保持；另25.76秒任务明确取消。正式3001仍PID23976，独立Qwen继续停止，SFX暂停、音质V1进行中，无提交推送。见 [记录](records/2026-10-07-audio-quality-v1-long-internal-pause.md)，真实模型helper与恢复浮点容差后helper的SHA区分留档，未重复或虚报模型验证。

## 2026-10-07 — 目标完全匹配后的后文语气词误判修复

热汤面目标15字完全一致，但后文“面快好了”前的独立“嗯”阻断严格衔接，原提示误称文字差异。目标90%/85%容错保持；新增源独立“嗯”时间、160ms真实静音及80ms保护、左/最终目标精确与右侧严格前缀的桥接。真实短窗识别同音错字，完整右侧可准确识别后文但省略语气词，故仅在源/边界证明齐全时允许省略此首“嗯”，其余缺字/合词/重复/同音错误仍拒绝。

用户释放内存后原音完整复测73.89秒通过，4.36秒裁剪目标100%匹配，原SHA保持；旧候选/项目未自动修改或采用。Python88项、JS172项、相关ESLint/完整TypeScript/正式构建及原3001桌面检查通过。当前3001/PID23976/`.next-reference-asr-repair-production`，未恢复停止的Qwen服务，空间/Qwen改动及参考/原音保持。音质V1仍进行中、SFX暂停，无提交推送。证据和运行限制见 [修复记录](records/2026-10-07-audio-quality-v1-continuation-recognition.md)。

## 2026-10-06 — Qwen角色固定指令与单句重生成

用户反馈指令有效但声音一致性过低，授权在独立7866页增加强一致与单句重生成。强模式默认关闭，按角色完整有效指令（首尾空白归一化、内部换行保留）取代逐句表达，关闭时草稿保留；旧结果兼容。单句仅允许目标文本/有效表达变化，角色/声音及有效全局设置保持，否则整段重生成。校验原文件后非目标WAV/JSON原样复制，目标用独立seed生成、另存新任务并重算字幕；失败只保留连续前缀和逐句种子计划。

强模式 `faeeb20182784bdbb2b62a91ae349431` 完整8句50.02秒，随后 `e39d7c9782f44d2881b9870c9c8e4333` 只重生`t04` seed46，7句原音频/JSON/实际seed保留，完整50.10秒；global seed45/gap300保持。同一模型worker连续完成，两次均释放模型。34mock与342项实测通过，非静音/无削波、精确PCM/SRT、37旧剧情及64既有文件SHA保持，收据 `logs/consistency-live-verification.json`。真实UI开关、旧结果、刷新、仅目标改文及边界空白兼容通过，新结果fresh，50.10秒完整播放/原生下载SHA/390px布局通过，证据 `logs/consistency-browser-verification.json` 与 `consistency-download-verification.json`；声音一致性听感尚未通过用户验收。正式provider保持、音质V1进行中、SFX暂停，无提交推送。见 [记录追加节](records/2026-10-06-qwen-dialogue-studio.md)。

## 2026-10-06 — I盘独立古风剧情与多角色配音页

用户对情绪样本反馈“还行吧”后，要求正常女声＋正太音2的古风对话，并把文案输入、API生成n个角色、分配声音和生成配音做成网页。已在 `I:/AI/qwen3-tts-dialogue` 建独立7866页，复用现有7864社区模型进程；密钥只由服务器读取现有配置。实际API生成3角色6句成功，支持1–8角色、可编辑对白/情绪、逐句串行配音、下载与部分结果恢复。正常女声使用 `normal_zh`，少年使用正太音2，未更换正式provider。

《雨渡送药》完整任务 `3fc32d9e69084d629efd1ec5a5090153` 实际生成8句48.26秒，seed45、句间300ms，保留逐句WAV/JSON、合并WAV、对白、SRT和manifest。初次与首次继续均在两句后遇到Windows提交内存不足，已完成句子保留；手工重启自属7864模型进程回收内存后继续完成。恢复仅接受同冻结剧情/声音/选项，校验原片段SHA后复制到新任务，原部分任务不覆盖；未加入自动重启或系统设置变更。客户端SSE死锁以4条传输线程解决，GPU工作仍串行。

`logs/unit-tests.txt` 24项mock、`logs/live-verification.json` 117项实测通过，64旧文件SHA保持；实际3人API收据、截图和启动幂等收据均存于独立页logs。真实UI完整播放48.26秒至结束、无媒体错误，原生WAV下载SHA与整段原文件一致；编辑/恢复台词的过期状态及刷新后完整任务/8句/声音绑定保持也通过，证据为 `logs/browser-verification.json` 与 `logs/download-verification.json`。表演效果与参考音色相似度待用户试听。音质V1进行中、SFX暂停，既有空间改动保持，无提交推送。见 [剧情配音记录](records/2026-10-06-qwen-dialogue-studio.md)。

## 2026-10-06 — 社区 Qwen3-TTS 声纹与指令适配试验

用户授权试社区方案后，在 `I:/AI/qwen3-tts-community` 独立适配xvector/TPAD/WOVR思路，复用原官方1.7B CustomVoice和既有环境；原C引擎未编译或测试。仅取得约51MiB的Base张量子集，完整Base未下载，来源整文件SHA只作为官方元数据。中文7864页面已启动，原7863暂时停止腾内存。`graft/soft_zh` 用相同台词、Chinese、seed42、cap512，普通/轻柔/耳语指令三段生成8.80/9.36/9.68秒，结果在 `outputs/comparison_20261006_091806_551356.json`。社区 `logs/verification.json` 技术核验通过，三WAV均24kHz单声道PCM16、非静音且无削波；`browser-verification.json` 确认三段原UI完整播放及模型释放，`runtime-check.json` 确认HTTP200、释放后整体GPU约870MiB、I盘余量约21.15GiB。`reference-preservation-after.json` 确认profile、5条参考和4份原话共10文件SHA保持，`original-customvoice-weight-check.json` 确认原CustomVoice完整权重重算SHA匹配，并保存 `community-three-comparison.png`。随后用户明确拒绝9.68秒耳语听感；旧样本保留，以seed43及英文全程气声耳语指令再生成10.72秒候选，其他参数保持。`outputs/adaptation_graft_soft_zh_20261006_114933_072753.wav` 及相邻JSON已保存，`logs/whisper-retry-verification.json` 文件核验通过、旧样本和10源文件SHA保持；新候选原UI完整播放/释放/HTTP200及 `logs/whisper-retry.png` 已补证据，听审与声音相似度待定，未确认耳语修复。正式provider未采用，音质V1进行中、SFX暂停，保留空间工作台脏改。见 [试用记录](records/2026-10-06-qwen3-tts-local-evaluation.md)。

追加9段情绪/饱满度候选（喜悦/悲伤/愤怒×克制/明显/饱满），同 `soft_zh/graft`、原台词、Chinese、seed44、cap512，仅指令不同，总82.32秒；各组低/中/高时长为喜悦10.40/8.00/7.92秒、悲伤9.28/10.40/11.84秒、愤怒8.88/7.60/8.00秒。`outputs/emotion_20261006035420Z.json` 已complete，`logs/emotion-verification.json` 技术通过，9段24kHz单声道PCM16、非静音、无削波、SHA各异；10源文件及此前4段社区WAV/JSON保持。9格试听页7865真实启动并显示9/9，`logs/emotion-gallery-verification.json` 确认HTTP200和所提供WAV/参考/HTML的SHA保持，音量/波形未处理；7864生成页仍开。峰值4.260GiB，释放后整体GPU约880MiB、I盘余量约21GiB。九段82.32秒真实UI顺序完整播放通过，证据 `logs/emotion-browser-verification.json` 与 `logs/emotion-grid.png`；目标档位未标定、用户听审待定，不覆盖前述耳语拒绝/重试待听决定。正式provider未采用，音质V1进行中、SFX暂停。

## 2026-10-06 — I盘独立 Qwen3-TTS 试听

用户要求试用 Qwen3-TTS 并放 I 盘。已在 `I:/AI/qwen3-tts` 建独立环境和中文7863试听页，0.6B/1.7B CustomVoice完整SHA校验、CUDA/BF16/依赖检查与初始Serena样本生成/完整播放/WAV+JSON保存/释放显存通过。随后授权参考音克隆和指令对照：0.6B Base新增14文件SHA校验，只读接入现有5条参考，`soft_zh` 6.32秒与正太音2 7.52秒真实生成成功；1.7B Serena保持相同文本、Chinese、seed42、tokens512，产出无指令6.8秒/温柔轻声耳语13.76秒。新证据归档至 `I:/AI/qwen3-tts/logs/clone-comparison-verification.json`。Windows分页不足由pread与禁用加载warmup修复，未改系统分页设置。克隆相似度与用户听感未验收。新运行文件均在I，既有Python基础解释器仍只读复用D盘；正式provider/profile和录音保持，音质V1进行中、SFX暂停，无提交推送。见 [试用记录](records/2026-10-06-qwen3-tts-local-evaluation.md)。

## 2026-10-06 — 参考栏发布与其他会话交接

用户要求记录、推送并交接。发布参考栏两轮布局和浏览器存储说明，保留实际76项回归、TypeScript/ESLint/正式构建、桌面/390px截图与14秒试听证据，再验证隔离暂存源树与动态素材/另项保护。旧3001服务已停止，离线基线后恢复同一构建到3001/PID9716；后台启动被策略拒绝，下一会话按记录核查会话终端服务。实际提交/远端一致性见Git与I盘发布收据；前述UI未提交由本次授权覆盖。空间工作台仍留本地，父阶段进行中、SFX暂停，沿用唯一路线。见 [交接记录](records/2026-10-06-audio-quality-v1-reference-toolbar-release.md)。

## 2026-10-06 — 单行参考栏与浏览器工程说明

首次缩窄后仍有三排，按用户反馈进一步把144×32px选择、240×32px参考试听及添加/刷新合为一行32px高的工具栏；390px窄屏改为选择/管理与试听两排72px，添加表单栏下展开。76项现有面板/导入回归、两文件ESLint、构建/TypeScript及原3001桌面/窄屏截图、14秒实际播放通过，文案/编排/声音选择和150素材/5参考保持。确认Chrome与内置浏览器各自localStorage，无工程自动同步；README说明当前工程JSON导出/导入边界。最新3001/PID10268/`.next-reference-audio-production`，无原生任务/锁。UI追加未提交，已发布基础5d01621；音质V1仍进行中、SFX暂停，空间另项保持。见 [追加记录](records/2026-10-05-audio-quality-v1-reference-asr-and-gpu-recovery.md)。

## 2026-10-06 — 参考与策划累计记录、发布授权

用户要求“ok，记录一下，推一版”，授权累计提交参考上传/本地原话识别/GPU初始化提示/工程策划切换与长度修复。保留此前真实识别、独立8秒生成及策划浏览器证据，并核对隔离暂存源树/文档/当前素材；当前用户新增后目录5项，默认soft_zh保持，不重复导入或覆盖旧快照。原15秒参考生成恢复与听感仍未确认，音质V1仍进行中，SFX模型暂停。另一会话独立空间工作台源代码/文档保留本地。实际SHA/推送与远端一致性由Git和I盘发布收据确认；历史“未提交/推送”被本次授权覆盖。见 [累计发布记录](records/2026-10-06-audio-quality-v1-reference-planner-release.md)。

## 2026-10-05 — 参考原话识别交付与显卡生成故障诊断

用户要求选择语言识别参考原话并允许修改，同时报告新参考VoxCPM2生成失败。已明确参考使用模式与生成范围分别选择，新增中文/英语/日语/韩语、本地选段识别、可编辑结果、取消/时限及共享运行锁，保存仍需用户主动操作。新上传默认8秒；实际原3001用正太音MP3前8秒识别得到“干嘛一直盯着我看有什么好看的”，验证手改后恢复原结果并保留待校对，未重复导入或保存参考。原15秒生成日志确认WAV读取后cuBLAS初始化失败，新增安全503提示；一次独立8秒参考生成成功13.922秒/输出1.44秒，原15秒恢复及克隆音质仍未确认。11个不重复JS文件239项、Python11项、TypeScript/本轮11文件ESLint/正式构建通过，138素材/6参考profile/25空间源文件及原MP3保持。最新3001/PID32132/`.next-reference-asr-repair-production`，无子进程/锁/ASR临时目录，原origin保持。用户此前已采用《末世归途的礼物》成22段工程，本轮未变动；SFX暂停、音质V1仍进行中，未提交推送。见 [交付记录](records/2026-10-05-audio-quality-v1-reference-asr-and-gpu-recovery.md) / [中文契约](superpowers/specs/2026-10-05-reference-transcription-and-generation-recovery.zh.md)。

## 2026-10-05 — 工程策划状态与回复长度故障修复

新项目策划区曾复用旧全局草稿，指定3分钟末世生日礼物主题又遇到长度上限。按工程保存、保守旧稿归属/显式恢复、切换前最新编辑捕捉及请求迟到保护已实现；官方DeepSeek创意请求关闭思考并按时长分配有限预算，截断/一次修复/取消/共用期限仍有边界。149项定向、TypeScript、本次代码ESLint和正式构建通过。实际原3001页面确认旧bug后，新项目空白与旧热汤面来源稿切换正确；一次真实生成《末世归途的礼物》22条/204字，刷新及往返保持，草稿未采用或合成音频，未宣称实际3分钟成片或创作质量验收。138素材、6参考/profile、25空间源文件及原MP3不变。最新3001/PID23144，原地址未改、浏览器已可检查，无生成子进程/锁，3000/3002未监听；旧运行记录为历史。本次未提交推送，另项空间改动和SFX暂停决定保持，音质V1仍进行中。见 [开发记录](records/2026-10-05-audio-quality-v1-project-planner-repair.md) / [双语契约](superpowers/specs/2026-10-05-project-planner-state-and-output.zh.md)。

## 2026-10-05 — 网页添加参考音频与正太音导入

后续入口修正：原工程使用127.0.0.1:3001浏览器localStorage；新功能最初误启3000，导致页面看不到旧项目库。现已在原地址启动同一新版，3001/PID36780与页面/目录/参考WAV回读通过，未迁移或覆盖浏览器数据。历史“深夜回家，小安陪你吃碗热汤面”单项目快照仍在I盘，但不导入旧快照替换最新库。实际浏览器当前显示未确认，恢复证据见同一开发记录。

用户要求加入H盘正太音MP3并开放用户添加入口。新增VoxCPM2参考上传/刷新列表、源试听/选段、可选准确文本、成功立即选择、失败重试/取消与生成互斥；32MiB上传及1–30秒片段（默认15秒），仓库外保留原上传、标准16kmonoPCM16与来源记录，备份并原子追加profile。实际接口成功加入正太音前15秒，仅参考音频；原MP3/完整副本、两条旧参考及默认、4参考文件、138工程素材与25空间源文件SHA保持。11定向文件168项、15本功能ESLint、TypeScript及正式构建通过；3000/PID46872/目录3项/音频HTTP200且SHA一致。初次UI并行OOM用单worker恢复，全dist跨盘junction构建错误用D原生dist/cache-only I恢复。实际浏览器布局/播放工具因OSerror3初始化失败，未验收，模型调用0；听感未测试。音质V1仍进行中，SFX模型暂停保持，本功能未提交推送、其他空间改动保留。见 [开发记录](records/2026-10-05-user-reference-audio.md) / [中文契约](superpowers/specs/2026-10-05-user-reference-audio.zh.md)。

## 2026-10-05 — 生成音效听审失败、暂停与发布收尾

用户试听生成音频后反馈“相当烂，没法用，先这样吧，记录一下推一版”。3 条远端 AudioLDM2 8 秒刷耳样本记为不可用、拒绝采用，模型方向按用户要求暂停；本机成功 0 条。未执行的 Stable Audio Open/其他模型不作听感结论，独立 13 份真实录音库仍待听审。更新外部 manifest、分析/目录及试听页面状态，9 份 WAV 哈希保持，当前无生成 Python。源代码与记录按明确授权整理提交/推送，权重、音频和失败日志保留在 I 盘，另一会话的空间工作台改动保留未提交。实际 SHA/远端结果以 Git 和发布回执为准；以前待听、恢复试验与未推送字样是当时快照。音质 V1 整体仍进行中，无可用模型 SFX 或产品接入结论。见 [收尾记录](records/2026-10-05-audio-quality-v1-sfx-rejection-release.md)。

## 2026-10-04 — 单条模型音效测试恢复准备

用户明确要求开始模型生成，覆盖此前仅调研的范围。当前硬件实际仍为 3060 6GB，另台 5070 Ti16GB 无现成连接配置；已询问目标及连接方式，同时准备离线 Stable Audio Open 适配器和独立超时/取消监督。先一条刷耳、300 秒强制时限、失败即停；尚未开始新模型推理，不能把工具检查当音频成功。已有远端 3 条样本保留，其他空间工作台改动不动。见 [恢复准备记录](records/2026-10-04-audio-quality-v1-stable-open-resume.md)。

工具准备完成：6 项 Windows 监督检查验证超时/取消及负责的父子进程终止，24 项 Open 标准库预检/保留规则检查通过。首条 24 秒/50 步/seed104729 的双语命令与无权重/音频的可移植测试包已备；当时待目标主机连接，此项随 2026-10-05 暂停收住，真实模型产出没有增加，也未修复 Codex 对话取消。

## 2026-10-04 — 独立空间音频工作台

新增 `/spatial-studio` 音场网页，支持类 3D 头部画线/拖点、整体/逐点距离方向时间、音频导入/现有素材、原 D 空间渲染、试听/取消、原生 WAV/轨迹 JSON 下载和草稿恢复。9 文件 / 49 项与 Python29 通过，真实环绕/自绘生成及 12.65 秒 stereo48k PCM24 下载、桌面/窄屏验收见 [记录](records/2026-10-04-spatial-audio-workbench.md)。当前水平运动，听感待用户确认；音质 V1 仍进行中，未提交推送，既有工程/素材不改写。

## 2026-10-04 — 模型护理音效尝试停止与备选调研

后续用户提出可用另一台 RTX 5070 Ti 16GB 主机，已只读扩展 Stable Audio Open 1.0、Stable Audio 3 Medium、TangoFlux、AudioGen 四条 GPU 路线；建议先用较简单的 Open/Diffusers 验证，再比较长段模型。H200 数值不能当作 5070 Ti 实测；TangoFlux 官方简易封装固定进入 seed=0，多变体须向底层传不同 seed。已补充 Blackwell/cu128/FA2 兼容资料，无连接、下载、安装或生成。见 [更新双语调研](audio-quality/MODEL_SFX_ALTERNATIVES.zh.md)。

用户强调不能循环复用同一条摩擦声，授权模型测试；随后报告约五小时且无法顺利中断，要求先调研其他方案。本机 AudioLDM2 权重 26 文件 / 4,480,952,551 字节校验完成，原生加载崩溃及 CUDA 内存错误后实际成功 0 条。远端公开演示独立生成 3 条 8 秒刷耳，下个按摩任务免费 GPU 额度耗尽即停；原定长段/全矩阵未完成，全部待试听。停止核查没有遗留生成 Python，保护记录 151 文件 / 改变 0；权重、音频和失败日志保留在 I 盘，无依赖修改或产品采用。

本轮收尾只读调研 Windows LiteRT CPU Small-SFX、Stable Audio 3 API、ElevenLabs SFX 与 AudioLDM small-v2。推荐未来优先小型 CPU 路线，先补外部强制时限/取消、单条失败即停；未安装或下载备选模型，未调用付费接口，未实现监督或修复 Codex 对话取消。优化版资产无门禁但仍受模型条款约束，不能与原版 gated Small-SFX 混称；实际内存/听感未测。音质 V1 仍进行中，无提交推送。见 [实验记录](records/2026-10-04-audio-quality-v1-sfx-model-test.md) / [双语调研](audio-quality/MODEL_SFX_ALTERNATIVES.zh.md)。

## 2026-10-04 — 真实 SFX 扩展与贴耳护理素材试听

用户要求开始增加音效并选择掏耳/刷耳/按摩/喷雾方向。复核既有 6 个真实录音，取得 7 个逐项 CC0 的 HQ MP3 预览（棉签清洁、揉耳、按摩动作两种、喷雾、普通刷擦两种），独立 I 盘目录共 13 个待试听项。原源文件与旧库清单保留；干声不额外调增益，另有公开增益的试听副本。26 个 WAV SHA/格式/frames、旧13文件保持及实际浏览器播放/筛选/1280与390/320px通过，无最终浏览器错误。真实刷耳及主工作台采用/撤回/来源接入未完成，本地模型未启用，听感全部待确认；无模型任务、用户候选操作或提交推送。见 [取得记录](records/2026-10-04-audio-quality-v1-sfx-acquisition.md) / [双语取得说明](audio-quality/FREE_ASSET_ACQUISITION.zh.md)。

## 2026-10-03 — 累计批量工作流发布与跨会话交接

用户明确授权“记录一下，推一版，我要交接给其他会话”。本地整理自 `8f22021` 后的工程串行批量生成、磁盘满恢复与原子保存、音频总览/颜色、原生 token 下载修复、分镜连续/新镜头偏好及快捷切换、分镜颜色和逐段 TXT ZIP。最新验证沿用 12 个不重复定向文件 / 211 项、16 相关文件 ESLint、全量 TypeScript/生产构建、浏览器 8 TXT / 10,645 字节逐字节与 CRC 校验、29 条文案/timeline及138素材保持证据；此前 1,028 全量套件属于历史恢复检查点，没有本轮重跑声明。本轮记录与 Git 收尾不生成模型任务或操作用户候选。

发布分支 `codex/voxcpm2-product-generation`，远端 `origin` / `128Ghe980/asmr_director`；实际 SHA、推送结果、上游一致性和新运行检查由发布任务完成后写入 `I:/AI/asmr-director-storyboard-export/2026-10-03/release-verification.json`，并由 Git 日志定位，本条不提前断言远端成功。旧“未提交/无授权”说明保留为各功能当时快照。下个会话从 `AGENT.md`、唯一 ROADMAP、PROJECT_MANAGEMENT、AI_HANDOFF 和 Git 状态恢复，保留当前用户工程/候选/采用/分镜编辑，沿用 I 盘工作根和 runtime junction。音质 V1 仍进行中，真实 SFX、垂直运动与通用更柔未完成；见 [发布交接记录](records/2026-10-03-audio-quality-v1-batch-workflow-release.md) / [当前交接](AI_HANDOFF.md)。

## 2026-10-03 — 分镜颜色标识与逐段 TXT 批量下载验收

列表现有分镜按钮右上角新增绿色可用 / 灰色待生成 / 暖黄色需更新标识及无障碍文字，不增加列数，保留旁边的连续 / 新镜头切换。共用当前来源和前镜有效性判断，保存的分镜字段始终保留。顶部批量下载增加音频 / 分镜标签，音频沿用原声与后处理目录；分镜仅导出现有有效完整 H3，每段一个 UTF-8 TXT，按原人声段号及台词命名，在统一工程目录内打 ZIP。批量 API 可选 kind 默认音频，两类共用 JSON 准备结果和原生 token GET 下载，取消 / 迟到及临时清理保护保留。

12 个不重复定向文件 / 211 项、16 个相关文件 ESLint、全量 TypeScript 与生产构建通过，未重复此前 1,028 项全量历史测试。实际 22 段分镜 8/13/1，真实浏览器成品 8 TXT / 10,645 字节，全 CRC / 精确 UTF-8 提示词 / 原段号及台词恰好一次通过，第 4 段跳过而原第 5 段仍 005。桌面 / 390 / 320px 无横溢出，弹层和 32px 列表按钮均在视口，viewport 恢复，console 空；29 条可见文案 / 标题 / timeline 和全部 138 素材（含 manifest）SHA 保持，0 实际模型调用，无候选或来源编辑。最新 3001/PID14196/`.next-batch-generation-production`/HTTP200，无生成锁、临时目录空，I 盘工作根沿用。开始时旧 38384 已不存在，临时恢复 3192 后经身份及无生成核对停止再构建；`tsconfig.json` 自动改动恢复。证据与截图在 `I:/AI/asmr-director-storyboard-export/2026-10-03`，见 [开发记录](records/2026-10-03-audio-quality-v1-storyboard-status-export.md) / [中文说明](superpowers/specs/2026-10-03-storyboard-status-and-batch-txt.zh.md)。本次未提交推送，音质 V1 父阶段仍进行中，无新成片 / 听感验收。

## 2026-10-02 — 分镜双模式与逐段快捷切换验收

新增「连续镜头/新镜头」二选一及分镜入口右侧链条/取景框32px按钮，按段保存偏好，列表/面板同步且切换不跳选段；首段固定新镜头，连续需要相邻完整有效前镜，新镜主要按背景剧情。手动与批量模式统一，串行批量引用刚保存的前镜，模式/音频/来源及前镜复核；旧工程、旧指纹及已有prompt兼容保留。9个定向文件181项、TypeScript/ESLint/生产构建通过；实际桌面/390/320px无横溢出，刷新同步通过，29条可见文案/timeline及138素材SHA保持，console空，0模型调用。最新3001/PID38384/HTTP200，默认viewport恢复，截图和证据在`I:/AI/asmr-director-storyboard-modes/2026-10-02`。未提交推送，音质V1父阶段仍进行中。见 [开发记录](records/2026-10-02-audio-quality-v1-storyboard-reference-modes.md)。

## 2026-10-02 — 批量下载传输故障修复验收

用户报告Failed to fetch；实际10段ZIP20,982,790B服务端完整准备/读取而前端二进制fetch失败，单独取消attachment声明未解决。改为小JSON准备结果及同源UUID原生GET下载，保留默认二进制POST；待下载链接5分钟过期、单次领取、最多2包，打开前校验/取消/过期/完成清理与64KiB字节背压已接。27项测试、TypeScript/ESLint/生产构建通过，实际浏览器下载文件10段21项CRC/原声字节/后处理PCM及完整时长全部通过；独立20段21,015,839B包亦通过。文案/timeline及138素材SHA保持，console空，临时包目录空，0模型调用，未采用/放弃候选或提交推送。生产3001/PID32092/HTTP200，旧进程保留为历史。见 [故障记录](records/2026-10-02-audio-quality-v1-batch-download-recovery.md)，证据根 `I:/AI/asmr-director-batch-download-recovery/2026-10-02`。音质V1整体仍进行中。

## 2026-10-02 — 分段音频颜色标识验收

用户要求下面分段文案有对应颜色。段号上方新增绿色/灰色/暖黄色小色点，分别对应已采用/待生成/已生成未采用；选中段落同时显示文字状态，保留生成中/失败提示。列表与总览共享一次分类，候选读取未知状态使用空心点和无障碍文字。5个定向文件45项测试、全量TypeScript、变更文件ESLint及生产构建通过。实际22段10/10/2，桌面/390/320px无整页横溢出，台词/timeline与114素材SHA不变，console为空，viewport恢复；没有实际模型调用或候选采用/放弃。生产3001/PID17804/HTTP200，旧6176确认无生成后停止。证据 `I:/AI/asmr-director-audio-markers/2026-10-02/marker-verification.json`，见 [开发记录](records/2026-10-02-audio-quality-v1-batch-generation.md)。未提交推送，音质V1整体仍进行中。

## 2026-10-02 — 音频段落总览新增项验收

用户要求音频X/X/X总览，按「已采用 / 待生成 / 已生成未采用」互斥统计非空voice。采用优先、同段多个当前ready候选只计1，忽略discarded/跨工程/删除clip/来源或long-text上下文stale，声音options不影响已生成状态。工程一次读取共享候选，选段面板本地filter，切段不N请求；生成/放弃刷新，采用/撤回/编辑派生，loading/error的候选依赖数显示—。原批量目标规则沿用。

本新增项验收完成：7个不重复定向文件/66项通过（UI35/domain12/API19），全量TypeScript、变更文件ESLint及生产Webpack构建通过；SWC/WASM既有警告沿用，未重复1028项历史全量测试。新3001/PID6176/`.next-batch-generation-production`/HTTP200，旧2212经身份及无生成核对停止。真实browser总览10/10/2=22段，切11段右侧8候选/9.6秒显示及总览保持；原audio_missing仍12未采用目标含2有候选，跟10pending不矛盾。全部22台词/timeline/采用及114素材（含manifest）SHA不变，无增删。1182×892/390×844/320×740无横溢出、四按钮在viewport，consoleerrorwarn空，viewportreset，截图仅查看无文件。0实际TTS/文本模型/H3，未对用户候选采用/放弃；相关采用撤回放弃/刷新用真实App模拟HTTP验证。证据根 `I:/AI/asmr-director-audio-overview/2026-10-02`，overview-verification.json/assets-before-overview.json。本次未提交推送，音质V1整体仍进行中，沿用 [双语既有 spec](superpowers/specs/2026-10-02-project-batch-generation.zh.md) / [English spec](superpowers/specs/2026-10-02-project-batch-generation.md) 及 [开发记录新增节](records/2026-10-02-audio-quality-v1-batch-generation.md)，不新建路线或记录框架。

## 2026-10-02 — 磁盘满保存失败与空锁恢复验收

实际D可用空间归零，批量音频留下9个零字节WAV及1截断文件，均未被有效manifest引用；此前两条成功候选完好，manifest36项/单clip最多7，非容量耗尽。完整原source仍I盘voice-work，没有重生成失败原音。运行assets112文件/84,795,530字节及tmp1,146文件/362,246,998字节先复制到`I:/AI/asmr-director-runtime-storage/{assets,tmp}`逐SHA核对，再把原D目录可恢复移到本轮`original-runtime-directories`并建立junction，公开路径/URL不变。故障文件和备份均保留。仅在Next停止且无audio children后迁出已确认的零字节generation lock取证，不批量删除其他所有者锁。

clip/mix原子保存、自身inode/prefix锁清理、provider/API/bridge507及队列storageFatal停止通过验收；普通failed继续，已完成候选保留。全量90文件/1028项通过，一既有opt-in跳过，全量ESLint/TypeScript/生产Webpack构建通过。新3001/PID2212/`.next-batch-generation-production`/HTTP200，旧28252已停。真实UI音频补缺12目标首项第11段成功产出1 ready候选vox_719209e4b91645eda32c7125b90b8932，再取消已开始的第二原生任务，成功1/失败0，无自动采用，不宣称全12项完成。候选9.56秒/917,804字节、完整原音26.24秒/2,519,084字节均RIFF+frames完整且在I盘；候选7→8刷新可用，保留88.9%文字差异试听警告，未宣称音质验收。111不可变素材SHA及36旧候选记录深度不变，22台词/timeline/采用保持；四按钮恢复12/22/2/10，consoleerrorwarn空，无横溢出，取消后无lock/audiochildren，截图只inspect未保存。迁移检查点D约428MiB/I约78GB，日志/临时检查都放I。证据根 `I:/AI/asmr-director-batch-generation-recovery/2026-10-02`，含`recovery-verification.json`（verify_recovery.py）、`existing-assets-preservation.json`及故障取证/检查日志。仍音质V1内部缺陷，父阶段进行中，本次未提交推送。见 [故障记录](records/2026-10-02-audio-quality-v1-storage-recovery.md) / [当前交接](AI_HANDOFF.md)。

## 2026-10-02 — 工程批量音频与分镜操作验收

用户新增工程编辑区四个批量入口：音频补缺/全部重生与分镜补缺/全部重生。VoxCPM2只生成候选，原采用音频留到手动采用；GPT-SoVITS沿用直接提交素材。音频补缺跳过asset_generated且ID/URI均非空的采用素材，分镜补缺保留任何已有镜头，包括过期手改；全部重生按符合条件的已采用本地人声逐项替换。串行队列提供进度、取消、单项失败继续；目标启动固定，派发/写入复核最新来源，工程切换/卸载/迟到响应与手动分镜互斥保护同步实现。

本轮实现与验收完成：89文件/990项全量Vitest通过，一个既有opt-in文件/测试跳过，全量ESLint/TypeScript/生产Webpack构建通过，既有SWC警告成功回退WASM。D写满中断文件已恢复重接；五个不用的旧build server目录可恢复移至本轮`unused-build-server-backups`，新D原生dist`.next-batch-generation-production`只有cache junction到I证据根`next-cache`。正式3001/PID28252/HTTP200；旧3001/20660及临时3002/624经身份核对停止。日志根 `I:/AI/asmr-director-batch-generation/2026-10-02`，含`full-tests.log`/`eslint.log`/`typecheck.log`/`build.log`与真实`browser-verification.json`。

浏览器实际分镜missing六目标，进度0/6→5/6后取消，提示成功5；第5–9段五条新镜已保存并保留，第10未保存。工程分镜[1,3,4]→[1,3,4,5,6,7,8,9]，计数13/22/6/9→13/22/1/9刷新保持。运行中四操作/单段编辑锁、取消恢复通过，Copy/TXT既有可用性由自动测试覆盖。第1镜原字段/prompt、全部22条台词/编排/采用标签及76个WAV SHA256不变；第5镜温暖归家881字符prompt含逐字台词/实测3.32秒，无summary。实际接受五个外部文字结果，第六项取消，上游内部请求/repair/token成本未采集；0TTS/0H3视频，未做真实音频批量或成片/新听感验收。1182×892桌面两组一行、390×844/320×740两组两行，无横向溢出/按钮裁切，console0、viewport已恢复；截图仅工具查看未保存。上一里程碑8f22021已推送，本次未提交/未要求推送。音质V1整体仍进行中，不新增路线/框架。见 [中文 spec](superpowers/specs/2026-10-02-project-batch-generation.zh.md) / [English spec](superpowers/specs/2026-10-02-project-batch-generation.md) / [开发记录](records/2026-10-02-audio-quality-v1-batch-generation.md)。

## 2026-10-02 — 批量下载与音频绑定分镜累计发布记录

用户明确授权“记录一下推一版”，本地已整理自 `6c43758` 后的批量已采用音频下载、Planner兼容与场景流程、工程逐段真实音频绑定分镜、精简H3提示词和中文剧情背景。实现验收完成，沿用最新86文件/956项全量测试、一个既有opt-in跳过、全量TypeScript/ESLint/生产构建与diff检查；907字符prompt/clipboard/刷新一致，七条策划与22条工程保持，76个WAV哈希不变。本次仅记录及Git收尾，不新增模型调用、音频或运行变更，音质V1顶层仍进行中。

发布分支 `codex/voxcpm2-product-generation`，提交主题 `feat: add batch audio downloads and audio-bound H3 storyboards`。具体SHA及远端核对由发布任务执行后写入证据根 `I:/AI/asmr-director-concise-h3/2026-10-02/release-verification.json`，并由Git日志/上游状态定位；不提前记已推送，不为把同一提交hash写进自身而递归提交。见 [里程碑发布记录](records/2026-10-02-audio-quality-v1-storyboard-release.md)、[恢复入口](AI_HANDOFF.md) 与唯一 [ROADMAP](ROADMAP.md)。以下未提交/未要求推送文字是各功能当时的历史快照，本次较新授权已明确累计发布范围。

## 2026-10-02 — 精简 H3 prompt 与中文剧情背景

用户指出 prompt 多处重复，背景应该是人看的简短中文，例如雪地木屋内；模型按背景为当前段选择壁炉 / 窗雪等具体画面，不复制背景全文。官方完整 Ref 结构有 summary，本轮采用用户要求的精简自定义产品模板，删除 summary 与完整六段包装、重复背景 / 前镜 / 声音块，共用 renderer 保留当前镜头、原台词、参考外貌及完整音轨规则。

本轮实现与验证完成：共用`h3-prompt.ts`为Planner/工程两种helper导出短模板；背景与前镜只给LLM派生当前方向，仍绑定前镜stale依赖，旧存储/手改内容不自动重写。背景新生成上限160字符，旧编辑/存储仍4000。全量86文件/956项通过（一个既有opt-in跳过），全量TypeScript/ESLint/生产Webpack构建通过。本轮两个浏览器外部DeepSeek文字生成请求均UI成功：47字符中文Planner背景及第一镜，未采集上游repair调用/token成本；工程背景明确手改48字符，保留公寓深夜夜宵哄睡剧情，其他3/4等旧镜因背景变动stale而字段保留。第一镜2921旧→1569仅renderer→907重生成，约69%缩短；新字段193/59/42字符，907clipboard与刷新精确保持，原asset/current台词/实测3.210秒不变。七条策划/22条工程/timeline/采用状态保持，76WAV前后SHA256全一致。1182×892桌面/390×844/320×740无横向溢出，console0，viewport已恢复；截图仅工具目视未保存，TXT内容由测试覆盖但未重读实际下载。正式3001/PID20660/`.next-concise-h3-production`/HTTP200，D原生dist/cache-only junction到本轮I证据根`next-cache`，preview3002/PID23072经身份核对已停。证据根 `I:/AI/asmr-director-concise-h3/2026-10-02`，含`full-tests.log`/`typecheck.log`/`eslint.log`/`build.log`、`browser-verification.json`及`audio-hashes-before.json`/`audio-hashes-after.json`。0TTS/0H3视频、未创建新工程、无成片/新听感验收、未提交推送；不新增路线，旧spec保持历史。见 [中文 spec](superpowers/specs/2026-10-02-concise-h3-story-backgrounds.zh.md) / [English spec](superpowers/specs/2026-10-02-concise-h3-story-backgrounds.md) / [开发记录](records/2026-10-02-audio-quality-v1-concise-h3.md)。

## 2026-10-01 — 统一基础场景与已采用音频逐段视频分镜

用户调整流程：第一步只准备文案和统一基础场景；逐段视频分镜放到工程对应已采用人声旁。「文案 / 场景」支持英文基础场景生成、重生成、手改、保存 / 撤回 / 下载，采用时随新工程写入 `videoPlan`；已有 Planner 分镜兼容保留，不自动转换。工程每条人声旁的小入口打开「声音 / 分镜」检查面板，共用原内部滚动区域。

逐段生成必须绑定唯一当前 `asset_generated` 本地采用 WAV，服务端验证路径并解码 PCM，保存完整实测时长，不使用时间线估计或模型编秒数。模型仅返回标题与英文画面 / 动作 / 镜头；helper 注入逐字工程中文台词，独立 `[Shot 1]`、参考图外貌优先与当前 `<Audio 1>` `fully_copy`，不新增音轨。默认独立，可选相邻前一条有效完整人声分镜作连续参考；前镜仅影响视觉连续性，不复制其台词或音频。

可选 Project JSON `videoPlan` 随复制与版本保留，坏 metadata 独立丢弃，不丢原音频 / 稿件。台词、asset、场景 / 角色及引用前镜变化保留说明并标记过期，复制 / TXT 禁用；依赖链迭代检查避免递归环。编辑中暂空字段允许保存。视频编辑不修改声音指纹、不取消音频任务；撤回声音候选采用保留当前视频元数据，让来源自然失效。取消、手改与来源变化有迟到覆盖保护。

实现及验证完成：最终86文件/953项全量Vitest通过，一个既有opt-in文件/测试跳过，全量TypeScript/ESLint/diff check/生产Webpack构建通过，既有Win32 SWC警告回退成功。正式3001/PID25824/`.next-clip-storyboard-production`/HTTP200，临时3002已停，仅cache junction到证据根`next-cache`。三次真实DeepSeek-v4-pro请求成功：基础场景、第三段独立分镜、第四段引用第三段；prompt使用当前工程原台词与实测3.24/8.59秒，第四段含前镜画面/动作/镜头而不含前镜台词，fresh第五段默认独立。clipboard逐字回读、前镜编辑导致后镜过期/保留说明/禁用复制及恢复、空场景禁用生成/复制、场景/分镜/参考/完整prompt刷新保留通过。Planner七条初稿逐字不变且刷新后场景/重生成入口保持，工程22条/title/台词/时间线标签和编排不变，76个WAV SHA256全一致。1768×1252桌面/390×844/320×740无整页宽高溢出，检查面板内部滚动，手机入口定位及可见标签焦点正确，console errors为零。TXT控件触发、Blob字节/文件名自动测试通过，未重读浏览器下载文件，截图只工具查看未保存。0TTS/0视频调用，无H3成片/画质/耳机听感验收。证据根 `I:/AI/asmr-director-clip-video/2026-10-01`，日志 `full-tests-final.log`、`typecheck-final.log`、`eslint-final.log`、`diff-check-final.log`、`build-final.log`，结构化证据`browser-verification.json`与`audio-hashes-before.json`/`audio-hashes-after.json`。见 [中文 spec](superpowers/specs/2026-10-01-adopted-clip-video-storyboards.zh.md) / [English spec](superpowers/specs/2026-10-01-adopted-clip-video-storyboards.md) / [开发记录](records/2026-10-01-audio-quality-v1-clip-video-storyboards.md)。属于既有音质V1内部工作流，不新增顶层路线；未提交/推送，旧历史保持完整。

## 2026-10-01 — 官方 H3 分镜提示词调整

用户批准按本会话已阅读的官方 H3 指南第四节与 Ref 格式修改分镜，使用角色参考图与每镜对应的现有 TTS。新画面 / 动作 / 镜头为英文，中文台词来自原 draft，模型不改写。统一 Subject1(S1)，Picture1 用于外貌衣服参考而非首帧；Audio1 选择 `fully_copy`，完整最终音轨保持原速原停顿，不新增对白 / 环境声 / 音效 / BGM，`non_diegetic_music: N/A`。嘴部可见时跟随音轨 timing，停顿及末尾闭嘴；简单连续动作、一镜轻运镜，不硬编秒数或假音频 duration。官方另一模式是 `partially_copy`，本轮不实现，不能误写 `partial_copy`。

新生成数据加 `promptFormat: 'minimax-h3'`，旧中文分镜保留、提示重新生成获得英文。每镜提供可展开的 H3 提示词和复制，工具栏下载全部 H3 TXT；来源过期禁用 H3 使用 / 导出，普通 Markdown 仍可保留。只产提示词供用户配对应素材，不接角色图上传、TTS 合成 / 音频连接或 H3 视频 API，实际音频 duration 绑定后续再做。

提示词策划 / 导出实现与验证完成，双语说明为 [中文 spec](superpowers/specs/2026-10-01-h3-storyboard-prompts.zh.md) / [English spec](superpowers/specs/2026-10-01-h3-storyboard-prompts.md)，证据根 `I:/AI/asmr-director-h3-storyboard/2026-10-01`。77 文件 / 829 项全量测试通过（1 个既有 opt-in 跳过），全量 TypeScript / ESLint / Webpack 构建通过。首轮与构建并行时既有录音分页测试五秒超时，构建结束后以四 workers 全套复跑通过，未修改该测试或生产代码。真实 DeepSeek-v4-pro 一次生成七个英文镜头，七段原台词和当前 22 条时间线 label/title 完全不变。模型仍推测外貌，经 UI 修正推测和复杂转身后，加强参考图优先规则并重建；新模型要求由合同测试验证，未重复付费调用。最终剪贴板回读原文和参考优先句、过期禁用 / 撤回、刷新及桌面 / 390 / 320px 无整页溢出通过；TXT 与复制失败回退由自动测试覆盖。3001 PID17600 / `.next-h3-storyboard-production` / HTTP200，临时 3002 已停，截图只工具查看未保存。无新 TTS、音频工程采用、图上传或 H3 视频输出。此前批量下载与文字分镜未提交改动保留。仍为音质 V1 内部策划功能，不新增顶层路线；未提交 / 推送。

## 2026-10-01 — 第一步策划文字分镜扩展

用户要求在第一步生成位置增加分镜部分，当前 prompt 保持简单，后续再补官方 skill。本轮范围为文字分镜：Planner 右栏「文案 / 分镜」标签共用内部滚动区，按场景和动作将相邻台词组织为通常 6–12 镜、最多 24 镜，每镜关联多条语义短句并可编辑标题、画面、动作及镜头。保持一屏布局，不把最多 200 条音频语义单元直接变成等量分镜。

约定 `POST /api/storyboard { provider, draft, instruction? }` 返回 version-1 分镜，包含标题、服务器附加文案指纹与镜头列表。指纹涵盖 title/scene/character/有序 section ID+text；文案变更保留手改分镜并提示过期，撤回可恢复关联。工作态兼容旧 V1 和编辑中暂空字段；可选 `PlannerSource.storyboard` 随采用、复制、版本及候选撤回保留，坏分镜单独丢弃，不丢有效文案，来源载入不串项目。首版 prompt 独立便于以后补充，音频 Project JSON 与原 D 处理不变。

实现、自动验证、真实模型与桌面 / 手机视觉检查完成，双语说明为 [中文 spec](superpowers/specs/2026-10-01-planner-storyboard.zh.md) / [English spec](superpowers/specs/2026-10-01-planner-storyboard.md)，证据 / 日志根 `I:/AI/asmr-director-storyboard/2026-10-01`。全量 Vitest 76 文件 / 809 项通过，1 个既有 opt-in 文件 / 测试跳过（`tests.log`）；全量 ESLint（`lint.log`）、最终 TypeScript（`types-final.log`）及生产 Webpack 构建（`build.log`）通过。最后的类型修复仅改新项目库测试 fixture；自动化证明旧 V1、坏分镜独立恢复、台词映射、取消迟到、编辑 / 撤回及来源采用 / 复制 / 版本保留。

真实浏览器用现有 DeepSeek-v4-pro 一次 POST，从未改的七条工作台词生成七镜 / 28 个编辑字段；画面编辑撤回、修改台词的过期提示及撤回消除、刷新七镜全部字段一致通过。原音频工程仍 15 句 / 9 条采用；没有创建或采用新工程，没有新音频。1768×1252 桌面、390×844 和 320×740 视觉通过，document 无溢出、内部滚动正确；恢复桌面再次刷新七镜仍完整。ArrowLeft / End 标签切换焦点正确，console errors / warnings 为空。截图只工具查看而未保存图片；结构化证据已保存为 `browser-verification.json`，`git diff --check` 通过，仅 CRLF 转换警告。

正式 3001 为 PID 19916 / `.next-storyboard-production` / HTTP 200，原 PID 4380 已停止；构建输出在 D 盘原生，仅 cache junction 到 I 盘本轮证据根下 `native-cache`。批量下载临时目录继续原 `I:/AI/asmr-director-batch-download/2026-10-01/temp-downloads`；临时 3002 / PID 18584 已停止，正式 3001 保留。此前批量下载未提交改动保留，本轮未要求提交 / 推送；属于现有音质 V1 内部扩展，不新增顶层路线或听感验收。

## 2026-10-01 — 已采用音频批量下载

用户要求工程增加美观的批量下载按钮，将已经生成并接受的音频统一放进一个文件夹，再分无后处理与环绕等后处理版本。共享工作树新增顶部绿色入口及紧凑弹层，显示采用数量、双文件夹预览、空间开关状态、空状态、准备中/取消/重试与已发起下载；沿用一屏布局，小屏弹层内部滚动。

下载仅收当前时间线已生成的本地采用素材，按开始时间配对编号，不混入未采用候选、完整生成窗口、历史或整段混音。ZIP 单工程目录含「无后处理」「后处理」及JSON清单。原声字节不变；后处理保留完整来源时长及当前片段音量/淡入淡出/适用空间设置，原D保留650ms尾响，不做逐片段主归一、时间线裁剪或循环。mono空间回退明确报错，原立体声不冒称新增环绕。后端预先完成临时ZIP再返回，逐片段处理，保留输入/素材错误、取消、单并发及安全清理边界；新临时文件沿用I盘缓存。

本轮72文件/755项全量Vitest（1个既有opt-in文件/测试跳过）、全量TypeScript/ESLint/生产Webpack构建通过；新增构建目录忽略后的最终lint复跑也通过。定向UI3文件/24项（下载组件新增6项）、后端5文件/35项（含既有mix DSP）通过，独立后端只读审查无必须修正项。构建为D盘`.next-batch-production`、cache junction到I盘；正式3001已更新至PID4380/HTTP200。证据根为 `I:/AI/asmr-director-batch-download/2026-10-01`，日志`tests.log`、`lint.log`、`build.log`。

真实复用首条已采用素材的单片段POST保存`live-api.zip`与`live-api-verification.json`：HTTP200/1,051,540字节，标准zipfile全部CRC通过、中文双目录/清单完整，raw3.21秒字节哈希不变，真实D后处理3.86秒/48kHz双声道含650ms尾响。正式浏览器点击9段批量下载显示成功发起；下载事件工具未提供路径，未重读其九段文件，因此不扩大独立单片段文件证据范围。刷新15段全文不变；1768×1252桌面视觉检查、390×844/320×740无溢出、弹层视口内、Escape焦点恢复与无console error/warn通过。工具截图已查看而未保存文件。双语spec、ROADMAP及AI_HANDOFF已同步当前dist/重启命令，保留历史恢复；未提交/推送、未改变用户工程/采用/新TTS，不新增路线阶段或听感验收。

## 2026-10-01 — 语义工作区与截取修正交接版本

用户明确要求记录、提交推送以交给其他会话。归档范围为上次 `378bab7` 后累计的语义短单元与选区编辑、工程单屏布局、滑动上下文生成、原生失败修正、识别对照、有界替字与末尾/API兜底。沿用当前已验证实现和734项应用／74项Python测试证据，本次只做文档和Git收尾，不重跑模型或改变用户工程。

新增 [开发交接记录](records/2026-10-01-audio-quality-v1-semantic-workspace-handoff.md)，同步恢复入口与固定路线当前状态，并提供明确的 `.next-semantic-build` 重启命令、I盘证据目录、旧候选上下文过期原因和音质V1剩余范围。分支为 `codex/voxcpm2-product-generation`；后续会话以该交接提交及其上游状态为准，下方未提交／未推送文字属于实现当时的历史快照。

## 2026-10-01 — 末尾词定位、少量漏字与外部 API 兜底

续完 9 月 24 日用户请求：特殊标点本来就在核对前忽略，实际「暖胃」例是 18 字目标被识别成 17 字，包含「啦→了」和漏「儿」，旧等长／90% 规则无法覆盖。保留旧匹配路径，新增至少 10 字、85% 相似度、最多两次编辑的末尾辅助回退；整个前缀、紧邻后文、真实词端点、唯一内部边界及双侧独立识别共同验证。末尾相同一字不足以认定，不能估算时间或跳到后文重复词。新增差异提示分别显示替字、未识别字和额外字。

用户明确批准复用已配置 API，仅在本地定位失败且有有界候选时发送台词和识别词索引，单次 15 秒；模型选择索引后仍重新做本地声音验证。修复提示缺少字面 JSON 导致的 HTTP 400，现有 DeepSeek 配置真实返回 HTTP 200／索引 13，耗时 644 ms；未更换模型或密钥、未上传音频。独立复核同时修复合法 noise_adapted 双侧结果被 TS 拒绝，以及 API 后第二轮空检查点覆盖已有 ASR 的问题。

真实旧录音本地重分析 78.898 秒成功截取 0–7.11 秒，88.8889%／一替一删，静音 7.00–7.55 秒，保留 110 ms 尾静音；本例无需 API 或新 TTS。22.56 秒原音与原候选保持不变，派生候选 `vox_8ea1c310dc5641f0ae1cee3b70824b8e` 已保存、未采用。用户现有 15 段工程后文已改，示例保留旧上下文来源及过期提示，不伪装成按新窗口生成。证据分布在 `I:/AI/asmr-director-ending-anchor/2026-09-24` 与 `2026-10-01`，新根含候选清单备份与原音哈希。

最终67文件／734项应用测试（既有opt-in一项跳过）、74项Python测试、全量lint/typecheck/Webpack构建/diff-check通过。3001此前未监听，现PID19500／`.next-semantic-build`，候选列表及音频HTTP200；刷新后15段文案逐字保留，第11段新候选1显示7.11秒／88.9%／85%及两处差异，原D空间试听含650ms尾响共7.76秒正常结束，无媒体错误及新增console error/warn。1768×1252整页无溢出，左右面板y127–907.984375对齐。截图及验证JSON在Oct-1证据目录，详见双语 `2026-09-24-ending-anchor-extraction` spec。未提交／推送，不新增路线阶段或听感验收。

## 2026-09-23 — 有界文字容错与独立截取核对

用户认可大部分文字正确时继续截取、明确标出识别与源文不同。现采用归一文字至少90%一致、最多两处等长替换；保留缺字、多字、重排、新重复拒绝。目标首尾锚点不再单独否决这类已达阈值差异，后文起始仍严格核对。有差异的非末片段必须具备≥160ms实测静音、切点两侧各80ms和双侧独立ASR；源识别完全一致而最后裁后才出现差异时也补做双侧检查。最终整句/词级转录归一一致，内部短子句按整段通过后的整词边界读取真实时间差，不估算音素时长。

`recognition.contentComparison` 将内容状态、相似度、阈值、替换数与两边归一文字持久化；TS校验其自洽且不同字非末片段必须有截取证据。成功裁剪保持passed，差异用警告和折叠识别对照呈现；review只用于保留原音回退。旧候选optional兼容，原音条目始终标明完整录音。另修正重生成警告继承：按最终各组状态重建，成功后不残留旧“完整原音”提示，未修复组和其他模型/策划警告保留。

真实旧录音仅重新分析84.665秒，成功得到原音0–2.45秒片段，静音2.37–2.63秒、two_sided证据、保留80ms尾部静音、内部间隔0ms；裁后识别「回来了外面是不是很冷」，相似度90%、一处「啦→了」。通过现有存储保存派生候选 `vox_e34bc7d50ffd440b95bff2828363aeaf`，旧候选 `vox_f33328cbe274426286a088606b03592b` 与原音字节未改，manifest已备份，无新TTS或自动采用。证据根 `I:/AI/asmr-director-tolerant-extraction/2026-09-23`，含新候选、音频、原音哈希与真实分析结果。

65文件/692项Vitest（1个既有opt-in跳过）、54项Python模拟测试、全量ESLint/TypeScript/Webpack构建通过。3001此前未监听，现启动PID25872/.next-semantic-build。浏览器刷新11段文案逐字保留，新候选1显示0.00–2.45秒、90%阈值与第3字差异，旧候选2仍23.36秒；原D空间试听3.10秒含650ms尾响，正常播放完成且无媒体错误，新console error/warn为空。1729×1280整页无溢出，左右y127..927.703125；候选/原音HTTP200。未提交推送、不新增听感验收。双语spec：`2026-09-23-tolerant-voice-extraction`。

## 2026-09-21 — 保存识别对照与核对截取失败原因

按用户要求，Python 在完整原音识别后立即保存有界文本/时间 checkpoint，持续保留阶段、裁后识别与失败对齐证据。TS 成功、失败、超时、取消路径及完整原音列表传递这些信息；候选和原音各有默认折叠「识别对照」，原音始终明确为完整录音，旧数据不冒充已保存 ASR。核对规则、完整原音交付和一次生成不变。

重识别现有 23.36 秒窗口确认：期望「回来啦」，实际 ASR「回来了」，严格开头三字一致规则在寻找切点之前失败。波形 2.37–2.63 秒有 260 ms 静音（ASR 时间戳仅表示 100 ms）；独立切点 2.5 秒左侧仍识别为「回来了外面是不是很冷」，右侧为「快进来」，故不能归为语速太快或没有静音，也未判定模型一定念错。当前 3.81 识别字/秒低于两条旧成品的 3.94/4.32，但文案与编排不同，仅作粗略比较。旧成品经过分组、停顿编排和筛选；未发现后处理变速，`pace=slow` 未传入模型。

省略号明确属于最优干声方案原有规则，但不承诺固定停顿。当前与 Sept14 的 CLI/参考音/归一参考文本一致；正文、seed、上下文长度与筛选不同。另纠正上一条记录：历史 16 是最少补句基线，最大 16 是本次原生解码失败修复引入的上限，不能声称遗漏了既有上限。

已有 candidate 与原音 trace 只回填识别元数据，备份和原 WAV 不变哈希在 `I:/AI/asmr-director-recognition-inspection/2026-09-21/metadata-backfill.json`。本轮没有新 TTS、采用候选、替换音频或改文案。64 文件/677 TS 测试（1 opt-in 跳过）、38 项 Python 诊断测试（含切点尝试间证据清理）、全量 ESLint、TypeScript、生产构建通过；第一次满并行出现既有分页用例 5 秒文件系统超时，4 workers/15 秒复跑全通过且不改断言。真实 TS/Python 传递、两 HTTP 列表和两个 UI 对照通过；浏览器刷新保留 11 段原文，1877×1280 整页无溢出、左右对齐，console 无 error/warn。正式 3001 PID 29948 / `.next-semantic-build`，未提交推送。双语 spec 为 `2026-09-21-voice-recognition-inspection`。

## 2026-09-21 — 首小段原生解码失败与滑动窗口上限

用户报告「回来啦？外面是不是很冷？」首小段出现通用 VoxCPM2 失败。两次现场长文记录均在约 53 秒时原生生成退出且无原音。相同 499 字／69 分句输入复现了 AudioVAE 最终解码 `GGML_ASSERT(grid_y < USHRT_MAX)`，退出码 3221226505，耗时 53.935 秒；不是 ASR 检查问题，也没有可被恢复的 WAV。

原因是新语义窗口仅按 500 字填入后文，未限制过长的上下文。已在上下文快照与输入构造同时新增目标＋后文最多 16 分句的稳定性限制，500 字独立校验；目标原文不截断，旧未标记多组模式和真实末句自然收尾保留。原先称「遗漏原配方 16 分句上限」不准确，历史 16 是补句下限。新增 69 分句及窗口外指纹回归。provider 对失败保留有界 stdout/stderr、退出码、信号及启动异常；诊断在运行目录清理后仍保留，前端仅显示安全分类，取消／超时／锁／迟到原音恢复保持原逻辑。

64 文件／663 项测试、全量 ESLint、TypeScript、Webpack 构建通过，既有 opt-in 一项跳过。正式服务调查开始时已不在监听，修正构建启动于 3001／PID 20008／`.next-semantic-build`。本次通过正式 UI 为用户第一段实际生成一次，未改文案或自动采用候选；新输入为 2 个目标＋14 个后文分句／122 字。证据：`I:/AI/asmr-director-generation-failure/2026-09-21`；运行追踪：`I:/AI/asmr-director-voice-work/long-text/57dfefdd-1e15-4f1f-b663-067919bb3a96`。未提交推送，也不代表新听感验收。

真实生成完成：TTS 33.679 秒，总流程 70.387 秒，23.36 秒候选 `vox_f33328cbe274426286a088606b03592b` 与原音均已保存。字词对齐仍为 `uncertain_word_alignment`，按既定规则保留完整原音，未成功截取首句，也未自动质量重试。候选／原音／原 D 空间试听 HTTP 200；浏览器媒体播放进度超过 17 秒，无媒体错误。原标签页在 UI 复核期间崩溃，新开同源标签恢复全部 11 段文字与候选后完成试听；未清空存储，候选仍待用户选择。运行锁释放，diff check 通过。

## 2026-09-20 — 初始语义短句、后文窗口与一屏工作台

用户进一步明确初次生成就提供语义短单元，创意和工程共用边界，每条操作只在选中时出现；VoxCPM2 用向后滑动的上下文窗口完成长输入取开头，编辑面板必须对齐且整页无需滚动。这覆盖上一条大段展示、内部再分组的过渡方案，不新增路线阶段。

新协议通过 `groups[].units` 共享导演信息，展开成每单元一条 section／voice clip。通常 2–3 个分句，同一动作至多 4 个，过大输出复用保字本地切分；不将多个复合长句误算成小单元。新单元使用 .18／.35／.6 秒默认等待，保留精确秒数。旧稿显式「文案设置 → 按语义整理短句」转换。手动拆分、插入和新的语义稿在选择 VoxCPM2 时默认长文模式。

每次语义生成以所选单元为唯一目标，真实后文和必要原配方补句提供上下文，500 字上限及原生生成参数不变；只有工程真实末句自然收尾。上下文参与候选与请求校验，编辑有效窗口内后文取消相关生成并防止采用过时结果。保留完整原音交付、检查提示化、每组一次且不自动质量重试、原 D 空间处理等既定规则。

创意页改为连续文案与紧凑设置，只对选中单元展示工具；工程左右同网格行、底部时间线及面板内部滚动。手机使用文案／声音切换和覆盖抽屉；修正全局表单字体规则压过紧凑字号的问题。真实浏览器 1280×720、1024×600、390×844 均无整页溢出；1280 视口左右均 y=127..533.328125，时间线 y=541.328125..682，焦点／Escape 通过，无 error/warn。

最终 64 文件／652 项 Vitest、全量 ESLint、TypeScript、Webpack 生产构建通过，原有 opt-in 一项跳过。真实 DeepSeek 生成《深夜温水》149 字／9 单元，采用到工程并刷新后保持逐字一致。真实 VoxCPM2 生成两个单元各一次：非末句带真实后文及 12 条补句，`uncertain_word_alignment` 后保留完整 37.28 秒原音；末句不补句，检查通过，1.69 秒。候选及原音均可 HTTP 200 读取，没有新增耳机听感验收。

正式 3001 升级至 PID 6168／`.next-semantic-build`，旧 PID 19292 与临时 3002 均停止；重启需显式覆盖 `.env.local` 中旧 dist 目录。缓存 junction 为 `I:/AI/asmr-director-build-cache/semantic-workspace`。所有修改性浏览器检查仅在 3002，正式用户原六段工程只读复核保持完整。证据、日志及 `verification.json`：`I:/AI/asmr-director-semantic-workspace/2026-09-20`；双语说明：[中文](superpowers/specs/2026-09-20-semantic-script-workspace.zh.md) / [English](superpowers/specs/2026-09-20-semantic-script-workspace.md)。用户未要求提交或推送，变更仍在共享工作树。

## 2026-09-20 — 用户指定文本范围与工程页重排

用户明确指出自动段落不应决定修改和生成范围，且整段生成使句间等待无法定制；要求生成途中能修改、工程左右块内部滚动、原中部时间线移至下方，右侧常用操作前置并减少重复。该请求属于现有策划/工程交互修正，不新增编号路线，也不代表音质 V1 获用户验收。

本轮实现包括策划与工程选区 AI 改写、手动编辑、增删拆合、受影响请求取消与迟到结果保护。选区改写保留前后文及未涉及的元数据。工程“生成选区音频”先把选区拆成独立 clips，再只请求目标片段；不把引擎内部长文组作为用户编辑范围。未涉及片段的音频保留，文字修改/拆合所涉及整段的旧绑定失效并待重生成；当前缺乏任意字符边界精确音频对齐，比例分配只是临时时间，旧工程历史版本与完整原音不删除。

新增可选 `pause_after`，以真实音频时长为边界保留下一段前等待；新音频变长或变短时都调整后续编排，修改等待不触发 TTS。左侧直接编辑并设置选区/等待，右侧摘要替代重复台词框，生成与候选前置、次要设置折叠，时间线移到下方。D 距离/定距环绕/环绕靠近、原音即时试听下载、取消及候选撤回均保留；原音历史默认收起，生成中有录音时展开，完成不收起正在试听的内容。

最终验证：62 个文件/629 项 Vitest 通过，1 个原有 opt-in 文件/测试跳过；全量 ESLint、`tsc --noEmit` 和最终 Webpack 生产构建通过，原 Windows SWC 警告仍使用 WASM 回退。独立 3002 origin 示例工程的真实浏览器操作验证了六字符“你还没睡吗？”准确拆段、其余文字保留、1.7 秒等待与时间线顺延、刷新恢复和准确改写目标。左右区域均内部滚动（client/scroll 高度 353/1231、420/635），390px 手机视口页面宽 380px，无横向溢出。

正式 3001 从 PID 14524 经中间 PID 30540 升级至 PID 19292，继续使用 `.next-spatial-build`；临时 3002 已停止。3001 只读复核确认新布局、温柔中文参考及用户原《深夜回家，小安陪你吃碗热汤面》六段/4:50 工程与文案保留，浏览器 error/warn 为空。所有修改性浏览器测试只发生在独立 3002 示例工程，没有测试改写/拆分正式工程或清空其浏览器存储。没有新的真实 TTS/LLM 调用或听感验收。证据目录 `I:/AI/asmr-director-range-editing/2026-09-20`，结构化结果为 `verification.json`，测试/检查日志为 `tests-final.log`、`lint.log`、`lint-planner-final.log`、`typecheck.log`、`build-final.log`；双语说明为 [中文](superpowers/specs/2026-09-20-user-controlled-script-ranges.zh.md) / [English](superpowers/specs/2026-09-20-user-controlled-script-ranges.md)。

用户本轮未要求提交推送；此时变更仍在共享工作树，不把此前 `df30bb9` 的已推送状态算到本轮。原 D 已通过的验收、完整原音必交付规则和新空间优先 I 盘的约束保持不变。

## 2026-09-20 — 会话交接与推送收尾

用户要求“记录一下推一版，我要交接给下一个会话”。交付修复实现 `df30bb9` 已推送到 `origin/codex/voxcpm2-product-generation`，收尾前 fetch 确认本地与远端一致、工作树干净。本次只整理文档：在 `AI_HANDOFF.md` 顶部补齐现行交付规则、已推送版本、运行/存储位置、证据入口、启动命令和未完成范围；同步 ROADMAP、双语 spec，修正旧段落中三次重试、静音/长度上限拒收、空间未接入、缓存仍放 D 等过时指令。沿用既有单一路线及归档体系，没有建立竞争 roadmap。

收尾只读复核：3001 返回 HTTP 200，监听 PID 14524，正式构建为 `.next-spatial-build`；本地 `.env.local` 默认值仍是 `.next-spatial`，重启必须显式设置前者。构建 cache junction 指向 I 盘；新生成工作目录为 `I:/AI/asmr-director-voice-work`，共享运行锁仍在旧 runtime，检查时不存在。C/D/I 空闲约 4.24/0.32/82.24 GiB，后续新增空间优先 I。没有停止服务、移动旧数据或改动用户工程。

保留并核对此前 579 项 Vitest、27 项 Python、构建及浏览器/真实双组证据，没有因纯文档收尾重跑全量测试或模型。真实样本证明检查失败仍能完整交付，不代表朗读准确或用户听感验收；完整待确认组可能含补句、后续正文或重复。该交付修复无遗留实现项，真实 SFX、垂直运动和通用更柔仍属音质 V1 未完成范围。后续先读取交接入口与用户新反馈，不自动重做已认可实验。

文档检查：`git diff --check` 通过，启动片段经 PowerShell 解析器检查无语法错误（未实际重启）；7 个证据/经验文件及 4 处 Markdown 文档链接存在。独立只读复核未发现阻断交接的现行规则冲突。

## 2026-09-20 — 完整原音必交付与有界并行

用户在提示修正后仍无法生成，明确要求检查不能阻止音频交付，每次完整原音可试听、下载；另确认保留正常分组提取与拼接。这覆盖此前核对失败三次后阻断的行为。新流程先发布完整原音，检查有疑问只提示并继续，每组只生成一次；模型长度上限、静音也保留 WAV 并警告。独立原音区在生成中即可访问，支持刷新、下载、Range、历史同文案恢复与稳定游标分页。取消/原生故障及迟到退出后已写出的原音仍保留。采用仍由用户主动选择，待试听完整组可能含后续正文、补句或重复，有明确提示。

分组与环境准备并行，环境探测同会话复用；支持单 TTS + 单 ASR、最多提前一组的有限流水线和单次任务 ASR 模型复用。默认按可用内存自动选择；真实 Whisper 加载峰值 RSS 3.455 GiB、最低空闲内存 0.483 GiB，本机保持串行/非驻留，避免分页争抢。新临时文件与原音放 `I:/AI/asmr-director-voice-work`，旧 D 盘文件未移动或删除。

真实验证：恢复用户同文案 9 条历史录音，指定失败 run 三条 SHA256 与原文件一致。固定分组计划、实际 TTS/ASR 的双组试验耗时 141.086 秒，两组均核对失败，仍返回 34.91 秒完整候选；TTS 2 次、ASR 2 次、自动重试 0。首条原音 32.593 秒即可查询，早于 ASR 完成；两组原音与组素材字节一致，拼接长度与统一增益校验通过，运行锁已释放。该试验不代表朗读正确或用户听感验收。

独立审查发现并修复首尾空白导致原音消失、全局限额遮蔽历史原音、进程晚退出未补发原音、无 PID 重复退出误释放并行占用四处问题。证据根 `I:/AI/asmr-director-audible-generation/2026-09-20`；双语设计与证据见 `docs/superpowers/specs/2026-09-20-audible-generation-and-performance`。

最终验收：58 个 Vitest 文件／579 项测试通过，1 项未修改的空间适配器集成测试按默认配置跳过；27 项 Python 测试、ESLint（最后一个未使用变量警告已清除）、TypeScript 和 Webpack 生产构建通过。已有 Windows SWC 警告仍使用 WASM 回退。确认没有运行任务后，将 3001 更新为 `.next-spatial-build`（PID 14524）；自动 tsconfig 改动已恢复。生产浏览器真实 API 找到 9 条历史原音和本轮 2 条新原音，播放、拖到结尾、Range、下载原字节一致、刷新恢复、1400px／390px 无横溢均通过，截图已查看，无浏览器错误。额外忙碌/后续失败状态使用拦截响应验证，期间原音仍可播放下载；列表和音频没有 mock，也未触发额外 TTS。

同时同步 `D:/CodexWorkplace/通用细节经验/VoxCPM2_当前最优干声生成方案_2026-09-20.md` 中过时的三次重试和长度上限拒收说明，模型生成参数与所选干声配方不变。

## 2026-09-20 — 长文失败原因与提示修正（行为已被后续用户决定覆盖）

用户在 3001 工作台遇到“第 1 组未能确认完整台词和安全边界，原声已保留”，并指出难以理解。检查最近运行 `d805c739-b7b3-49fe-85a7-cfef6501546c`：前两次记录为 `uncertain_word_alignment`，第三次原记录为 `no_verified_quiet_cut`。仅第三条录音做了独立真实复查：22.72 秒原声整段 ASR 为“回来啦”，3.225 秒开头截取后为“回来了”；首三字精确匹配因此拒绝。3.04–3.41 秒实有 370 ms 静音，原错误把内容核对失败误归为截取位置失败。

修复后，Python 保留 `cut_text_mismatch`；界面展示失败段的台词摘录、实际尝试次数，区分模型生成、台词核对、分段和保存故障，不再统一声称“原声已保留”。分组保存失败立即终止，无意义的 TTS 重试已去除；两层失败日志写入均不覆盖原始错误。存储错误回归包含源 WAV 写满且日志同时写失败、模型错误遇到日志权限故障、真实素材目录不可写。

真实离线 helper 复查返回 `cut_text_mismatch`；原 WAV 与 I 盘复查副本 SHA256 均为 `E0AB31FF34B83BC70380142ACB8BD702359C888DE7954C8671DE08D656E1A74C`。另在同一静音内尝试 3.12 和 3.33 秒截点，仍识别为“回来了”，所以没有将该实验加入产品。未改变任何 ASR 配置、文本匹配、静音阈值、80 ms 保护、重复/漏字/裁剪后核对规则；没有新 TTS，也没有宣称这条文案已生成成功。不能仅据这次识别分歧判定模型读错或 ASR 听错。

证据目录：`I:/AI/asmr-director-voice-failure/2026-09-20`。25 项 Python、29 项定向 TypeScript、全量 533 项 Vitest、全量 ESLint、TypeScript 和 Webpack 生产构建通过；1 项需显式开启的空间 Python 适配器集成测试本轮跳过（本次未改空间处理）。独立代码审查无阻塞发现。已有 Windows native SWC 警告仍走 WASM 回退，构建成功。

3001 工作台已切换为本次 `.next-spatial` 生产构建（启动 PID 2448），先确认无正在运行的 VoxCPM2 任务才停止原 PID 26040。临时文件、构建缓存、浏览器截图和日志均在 I 盘；构建自动改动的 tsconfig 已恢复。独立浏览器上下文通过拦截 NDJSON 失败响应检查实际错误显示，1400px／390px 均无横向溢出，截图已查看，浏览器无错误。这是模拟失败消息的 UI 检查，不是真实 TTS 成功验收；未修改用户本地工程或台词。

## 2026-09-20 — D 正式接入收尾与 I 盘验收

额度恢复后继续用户已授权的接入／记录／推送。核对前次最终证据：57 文件／520 项 Vitest（包含真实 Python 适配器）、26 项空间 Python 测试、TypeScript 和生产构建已通过。全量 ESLint 误扫自定义 Next 构建目录的问题已修复，最终 ESLint 通过；独立只读审查无阻塞项。

以现有生产构建及 9 月 14 日真实生成的 4.8 秒候选复核，未新增 TTS：候选与当前人声播放／跳转、采用／刷新／撤回再采用、距离和轨迹编辑、双耳开关、5.45 秒带完整尾声的重混、实际 WAV 下载一致性及桌面／390px 排版通过，浏览器无错误。目录加载完成后的截图已查看。证据保留在 `I:/AI/asmr-director-spatial-integration/2026-09-20`，完整双语结果见 `2026-09-14-spatial-d-product-integration` spec。

按用户新的空间要求，新增临时文件、缓存和验收产物优先使用 I 盘；没有删除或批量迁移 C／D 盘既有资产。D 接入里程碑完成，音质 V1 的真实 SFX、垂直空间和通用表演控制继续保持未完成；不新增路线阶段。

## 2026-09-14 — 原 D 房间与连续环绕正式接入

用户试听 8770 新口语文案后反馈“还行”，授权接入正式生成、记录并推送。正式采用原 D 的 HRTF＋刚性球 DVF＋原房间响应，保留其远处回声与混响；E/F/G 不采用。完整人声候选、当前人声、选中片段试听和整段导出共用 D 服务；长文单组试听仍为干声核对。增加定距环绕和环绕靠近，保留原声资产、候选来源与跨刷新采用/撤回链路，修改距离或运动可复用已完成 TTS。

派生缓存包含源、HRTF、程序与参数哈希；支持 PCM24 解码、完整 0.65 秒房间尾声、取消和失败清理。混音不重复空间处理或包络。复核发现旧向上响度归一会反转自然近远差，已对 D 混音移除，仅在开启主限制器且过载时双耳共同衰减。真实近远差由原 7.367683 dB 保持为导出 7.367684 dB；四条已认可自然 D 样片与产品渲染逐字节一致。

最终检查和工作台验证集中于双语 `docs/superpowers/specs/2026-09-14-spatial-d-product-integration`；本机证据根为 `I:/AI/asmr-director-spatial-integration/2026-09-14` 和 `I:/AI/asmr-director-distance-listening/product-d-verification`。本条更新此前实验记录中的待听/未接入状态，不宣称音质 V1 整体完成。

## 2026-09-14 — 新口语文案与实际人声重生成

用户要求重新生成一版，换新文案且不要文绉绉。新稿采用“你躺好了吗？枕头不舒服的话，就挪一挪”等日常口吻；实际运行本地 VoxCPM2 soft Combined，沿用产品长开头、独立结尾、安全截取和 class-local 停顿。六组拼为 34.54 秒，组间停顿 360／400／350／300／350 ms；截后 ASR 各覆盖率 1.0，最终 22/22 子句顺序覆盖、无新增重复（整段 ASR 有一处「露／落」差异）。13 次尝试及两次文案修订完整保留，包含 3 次无音频的原生技术失败、4 次 ASR／截取拒绝与 6 次采用；没有放宽产品检查或使用文本 API。

保留原 D 房间与四条同步环绕路线，新产物为 8 个 35.19 秒、48 kHz stereo PCM24 WAV；38 项数值测试、独立音频检查、原 D 静态端点回归和真实浏览器播放／同步切换／下载／file://／桌面手机检查通过。最高估计真峰值 −5.117646 dBTP，匹配误差 0.031593 LU，端点残差 <1.2×10⁻⁷；截图已查看。

源与生成证据：`I:/AI/asmr-director-distance-listening/2026-09-14-colloquial-source`。空间成品与验证：`I:/AI/asmr-director-distance-listening/2026-09-14-d-colloquial-motion`、`http://127.0.0.1:8770/`。旧 8767–8769 成品、工作台工程与产品代码保持；新声音与轨迹听感待用户判断。双语记录：`docs/superpowers/specs/2026-09-14-d-colloquial-motion.md` / `.zh.md`。

## 2026-09-14 — 保留 D，完成长文连续环绕

用户明确原 D 仍最好，认为 E 减少远处的回声／混响、空间感变弱。因此当前采用 D 作为听感基准，E/F/G 不采用；前一轮改进比较不再是待听项。随后用户要求更长文本，声音连续环绕，并比较保持不同距离与逐渐靠近。

复用此前已选 34.75 秒、16 句／6 语义组的完整温柔原声 `03_deepseek_class_local_rule.wav`，保留原 ASR、源哈希和停顿，不重复短句、不变速、不运行新 TTS。新增四条同步轨迹：距头中心 0.18／0.8／1.75 米定距环绕，及 1.75→0.18 米环绕靠近；全部使用原 D。方位 90→450°（左→后→右→前→左），首 1.5 秒与末 2.5 秒停留；靠近在 27.105 秒结束，最后 7.645 秒保持近距。每条输出 35.4 秒，含自然／整段响度匹配，共 8 个 48 kHz stereo PCM24 WAV。

37 项数值测试及独立验证通过；最大估计真峰值 −5.383748 dBTP、响度匹配误差 0.029475753 LU、ILD 变化 1.306728×10⁻⁷ dB。D 代码哈希未变，端点与完整原 D 静态卷积残差 <1.2×10⁻⁷。真实浏览器通过 8 文件元数据、实际播放、同时间方法／模式切换、预设方位与全文、下载哈希、file:// 和 1280px／390px 无溢出，最终错误为空。

成品与证据：`I:/AI/asmr-director-distance-listening/2026-09-14-d-long-motion`、`http://127.0.0.1:8769/`；重点查看 `verification.json`、`motion-verification.json`、`browser-verification.json`。原 8767 与 D/E/F/G 的 8768 成品均保留。新长运动听感仍待用户判断，工作台及工程没有修改，音质 V1 仍在进行。双语记录：`docs/superpowers/specs/2026-09-14-d-long-motion.md` / `.zh.md`。

## 2026-09-14 — 算法扩展调研与 D/E/F/G 试听

用户认可 D 的房间印象，并澄清想了解其他算法，同时授权房间和贴耳几何／声源朝向改进。完成 BRIR、ISM/FDN/SDN、Paraspax、几何传播、神经双耳、Ambisonics 原始资料调研。新离线实现保留 D，E 加二阶镜像反射／墙面滤波／FDN 短尾声，F 加逐耳视差／延时对齐插值／逐路径人声方向性，G 合并两项；新增左前方靠近与固定位置转头，刷声不套嘴模型。

27 项数值测试、96 个 PCM24 WAV 独立检查、旧 D 静态回归、反射朝向非标量验证通过；真实浏览器播放／切换／五章节／下载／元数据／file:// 及桌面手机检查通过。真峰值估计最高 −2.1000 dBTP，响度匹配误差最高 0.09761 LU。新成品与证据在 `I:/AI/asmr-director-distance-listening/2026-09-14`、8768；D 盘满后仅迁移本轮不完整输出再生成，旧 8767 成品保留。没有修改产品混音器、工程或旧工作树，没有新 TTS 或神经模型推理。当时听感待比较；随后用户明确 D 仍最好，E 的远处空间感变弱，当前不采用 E/F/G，最新决定见上条。技术报告：`docs/superpowers/specs/2026-09-14-distance-algorithm-refinements` 双语版本。

## 2026-09-13 — 距离感对比试听

用户接受固定温柔人声与刷声的距离实验。新增独立 `tools/distance-listening/`，生成 80 个 48 kHz stereo PCM24 WAV，比较等功率声像、实测 1m HRTF、刚性球 DVF 近场补偿、几何早期反射＋短扩散尾声；包含贴耳、面前、远处、靠近、串听以及整体响度匹配。源音频复用之前选过的人声，并取得明确 CC0 的真实刷声公开 MP3 预览，记录其非原 WAV 限制；刷声统一做 40 Hz 高通以去除超低频震动。

13 项数值测试及 80 文件独立音频验证通过，最大匹配误差约 0.059 LU、最大估计 true peak 约 −2 dBTP；真实浏览器播放、同位置切换、暂停、章节、下载哈希、file://、桌面/390px检查通过且最终 console 无错误。本地 byte-range 服务解决 WAV 跳转回头问题。

成品与证据：`D:/CodexWorkplace/asmr_director_runtime/distance-listening/2026-09-13`。复现及限制见双语 `docs/superpowers/specs/2026-09-13-distance-listening-experiment` 记录。当时听感待反馈；后续用户已评价加入房间“确实不错”、D“还行”。没有修改产品混音器、工程、旧工作树，没有新跑 TTS/付费 API，音质 V1 的空间正式接入与真实 SFX 扩展仍未完成。

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
