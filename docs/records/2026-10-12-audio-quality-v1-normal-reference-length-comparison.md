# 2026-10-12 — 普通女生同稿四档补测：生成完成，听感待对比

## 用户要求与当前状态

用户要求普通女生也按80、160、240、320汉字四档各生成3轮，文案和其余生成参数与已完成温柔参考组保持一样，用于对比原参考素材的影响。属于既有「人声导演与真实ASMR音效质量V1」，父阶段仍 `in_progress`，SFX暂停；没有新增顶层路线。

**普通女生27/27个真实原生调用全部exit0，12/12条完整试听已完成。** 两种参考现在共24条配对整篇试听，独立参数/原生日志/完整PCM/39WAV42条目ZIP核验通过。ASR0、切分API0、实际模型失败0、自动质量重试0；口述全文和听感待用户对比，不据时长宣称质量阈值或单一音色因果。

可提交内存在4.82GB门槛附近波动：session01实际5成功后第6任务被启动前guard阻止；fresh5.423GB通过后session02跳过旧5成功、再完成3成功，第9任务再次被阻止。session03实际fresh4.634GB未通过，0模型。session04再完成3成功后第12启动前fresh4.133GB被阻止。**共四条guard-only均无模型child，不能计为TTS或质量重试。** 已完成的成功任务始终跳过；原4,815,306,368字节门槛未降，未停止用户应用。

用户随后询问资源是否足够，根fresh5.148GB通过但余量偏小；新增独立编排控制器 `run_normal_sweep_cooldown.py`，只有记录 `interCallPauseSeconds=8` 与新任务启动前 `time.sleep(8)` 两行差异。原 `run_sweep.py`、原生监督器、27请求/参考/种子/所有生成参数/guard不改；8秒仅属调用间等待，完整音频没有加入等待或静音。语法和独立两行diff核对通过，证据 `testing/independent-normal/normal-orchestration-cooldown-audit.json`。首次创建命令引号解析失败没有生成文件或调用模型，随后正确复制/修改成功；不计作模型失败。

session05完成剩16个真实调用、自然exit0/complete，796.640秒；香港时间2026-10-12 19:45:02–19:58:18（UTC11:45:02–11:58:18）。五会话实际调用5/3/0/3/16，总27；会话wall合计1085.811秒，包含编排等待，不含会话之间的资源/用户交互空档，不能把15:09–19:58整个时间跨度说成连续模型计算。增加间隔后继续成功是执行事实，不证明此前内存波动的具体原因。

## 完成结果与交付

同一320汉字稿，列内顺序为配对seed7911 /7912 /7913；以下都是完整成片秒数：

| 汉字上限 | 实际切分 | 普通女生三轮（秒） | 温柔三轮（秒） |
| --- | --- | --- | --- |
| 80 | 80×4 | 76.96 /73.92 /75.52 | 60.32 /64.80 /63.68 |
| 160 | 160×2 | 64.96 /74.24 /73.44 | 57.28 /60.80 /54.40 |
| 240 | 240＋80 | 70.56 /75.84 /72.32 | 60.80 /62.88 /61.92 |
| 320 | 320整篇直出 | 75.20 /67.68 /65.28 | 57.92 /60.32 /61.76 |

普通240字段49.44 /55.84 /52.48秒，末80字段21.12 /20.00 /19.84秒。320每轮是单次连续原声，全部12成片均保留完整来源PCM；没有挑最好一次或覆盖既有失败/guard证据。

普通女生归档 `sweep-normal-audio.zip` 120,897,758字节（约121MB），39WAV（12整篇＋27分段）＋HTML/CSV/TXT共42唯一条目，全部CRC/解压SHA通过；ZIP SHA256 `ab34370f71a6da9a61e82ced060781e0ce5d2779ac1c411f553971e9c90d266b`。旧soft ZIP、音频与HTML保持原字节。

最终汇总 `sweep-normal-result.json`；独立完成审计 `testing/independent-normal/independent-generated-normal-sweep-complete-verification.json`；单声CSV `sweep-normal-table.csv`。新配对页和CSV现各含普通12/12与温柔12/12，共24播放器/24行，`normal-comparison-http-final.json`验证HTTP200、页面与320第3轮服务字节等于原文件。

## 配对控制与原参考

沿用温柔组原稿《雨夜回家》320汉字/359含标点字符/16句各20汉字，原稿及标点逐字保持。本地按 `。` 累加完整句子，四档实际为80×4 /160×2 /240＋80 /320，每档三轮，配对seed7911 /7912 /7913。

27组输入的全文/切分/种子/steps800/CFG2/temp1/timesteps10/GPU0/low-vram/模型GGUF/隔离EXE/300秒单次与1800秒会话上限/内存guard全部与soft一致；差异限普通女生参考WAV、对应自然标点prompt、`normal_zh`与输出/收据命名字段。根核对和独立逐27job配对审核均通过：`normal-plan-root-verification.json`、`testing/independent-normal/normal-plan-paired-audit.json`。

- 固定EXE仍为前轮b228…3347隔离长解码修复引擎，不替换原产品后端或重新构建。
- 普通女生固定原参考：`I:/AI/voxcpm2-evaluation/references/normal-16k-s16.wav`，SHA256 `ce44f60e241e03e2e565aca2c45478e109a3a5032147ba343dab591018c0ad18`；8.6秒、16k mono PCM16。
- 对应原prompt：「晚上好，欢迎回家。室温已根据您的喜好，提前三十分钟调至二十六摄氏度。」
- True Combined：`--prompt-wav`＋对应原prompt＋`-r`，每段均用原参考，不把已生成片段当新参考。

比较的是**原参考音频＋其对应参考文字**的整体条件；两原参考时长、音量、原说话节奏不同，不能把后续差异全归为孤立的音色变量。没有归一化/放大参考或生成音频。

每段完整保留，整篇按顺序精确PCM连接、新增等待0；不补后文、不裁首句、不调音高/速度/增益、不运行ASR或语义API、不导入平台或自动采用。240档尾段与80档最后一段同种子同文本，允许相同SHA；判断240档应听首段240汉字。技术文件成功不等于口述全文或音质通过。

## 产物与恢复入口

实验根继续使用 `I:/AI/asmr-director-length-sweep/2026-10-11-coarse`，普通女生文件独立 `normal-` / `sweep-normal-` 前缀；旧soft文件保持原样，目录日期是前轮建目录的日期，不是本轮客户端日期。

- 不可覆盖计划：`sweep-normal-manifest.json`＋27个canonical请求。
- 已完成：`normal-capNNN-takeNN-full.wav` 共12条、27个独立原始WAV/成功收据，普通女生单页 `试听目录-normal.html`现全部完成。
- 五会话：`sweep-normal-session01.json` 至05，实际调用5/3/0/3/16；第6、第9、第12guard-only和恢复attempt文件全部保留，不重跑成功任务。
- 新并排页 `compare-normal-soft.html`、对照CSV `compare-normal-soft.csv`；构建器 `build_normal_soft_comparison.py` 纯标准库，只原子更新这两个新增文件，不改旧soft/normal单页或原声。

配对页本机入口：`http://127.0.0.1:8781/compare-normal-soft.html`，普通女生/温柔按同cap、同take并排，共24个完成播放器，默认preload none/无自动播放，播放新条暂停其他条，移动端单列。可展开原文、下载整篇或各段。已验证HTTP200；`open_in_codex` 返回queued，不能声称可见窗口已打开。沿用原localhost8781/PID24912只读试听helper，没有操作3001服务。早期14完成/10待生成为部分检查点，现由24完成覆盖。

历史执行入口（本轮已完成，不需重新启动；新实验不得覆盖这些已完成结果）：

```powershell
python -S 'I:\AI\asmr-director-length-sweep\2026-10-11-coarse\run_normal_sweep_cooldown.py' 'I:\AI\asmr-director-length-sweep\2026-10-11-coarse\sweep-normal-manifest.json'
```

控制器验证已有成功配方、实际命令、SHA与完整PCM后跳过；只对无模型child的guard-only另存尝试收据，不重跑成功任务、不改种子。真实模型失败须调查，不自动质量重试。STOP/锁必须按owner及退出状态核对，不能直接删锁。最终ZIP与result之间中断的已知人工恢复边缘沿用前轮说明。

已运行新normal独立审核器 `testing/independent-normal/audit_generated_normal_sweep.py --complete`：27实际调用严格串行，CLI Combined模式/实际采样数/配方/EXE与参考SHA一致；12成片逐字节等于完整原声PCM，39WAV42条目ZIP/单声CSV/目录/结果绑定通过。重跑对比页构建器及24播放器HTTP/来源检查通过。**完成的是生成与文件验收，口述全文/听感及字数质量阈值仍待用户。**

## 保护与范围

开始保护收据 `normal-start-baseline.json` / `normal-start-original-backend-files.json` / `normal-start-runtime.json` 全通过：原96候选/224资产/782历史/10参考、旧试听/tea101/原17后端不变，温柔完整235个冻结文件（含27原声＋12整篇/原稿/manifest/请求/收据/CSV/HTML/ZIP/旧阶段证据）SHA保留。新normal增量、对比页与持续写入的只读server日志明确排除在旧文件冻结之外。

开始补注 `normal-start-status-note.json` 只绑定该时刻5成功＋1guard-only，不能代表后来累计状态；客户端日期香港2026-10-12，旧基线日期保持历史。后续暂停检查或完成后需另存独立收据。

最终保护 `normal-final-protection.json` / `normal-final-original-backend-files.json` / `normal-final-runtime.json` 全PASS：96/224/782/10、旧试听20/6/5/19、tea101、soft冻结235与原17后端全SHA未变，旧normal-start/partial收据SHA保持。15运行检查全true，31原生收据（27distinct成功＋4无child guard）/12full/5session绑定；0模型/原生监督/两种批次控制器/watch，三产品锁/两批次锁/STOP均无，HEAD/index保持，3001无listener。

2026-10-12 12:05:30 UTC终态8781仍所属PID24912、loopback/目录身份/HTTP200/24audio匹配，保留供试听。GMS可提交4,772,741,120字节、物理4,932,104,192字节，GPU600MiB已用/5395MiB空闲；该内存仅为完成后快照、低于新调用门槛，不作后续新生成放行。无需为已完成的本轮再运行模型。审计0TTS/ASR/停止进程或旧文件修改。

未改产品代码/参考/旧音频/生成策略/识别阈值/服务或共享dirty改动，HEAD仍 `e06f8ca`、分支 `codex/voxcpm2-product-generation`、index空。本轮没有提交或推送。所有三轮保留供用户对比，在听评前不判断参考音色影响或最佳字数上限。
