# 人声音质 V1：重新识别连接失败恢复

日期：2026-10-08（Asia/Hong_Kong）。固定父阶段「人声导演与真实 ASMR 音效质量 V1」保持in_progress，SFX仍暂停。本轮不提交、推送或自动采用。

## 原因与恢复

用户点击「重新识别」看到`重新识别失败，原候选已保留，请重试。`。本轮检查发现3001无listener、上一轮Node24328及owned terminal66711均已不存在；用户页面仍显示缓存的工程。原候选manifest仍60条、SHA256 `b4d425c5f640659e7b1c95ebfaf306a73cf14da39371ff977ac69be736b64613`，完整录音历史最新仍是昨日trace31dc，无此次重检新trace、worker或模型失败证据。旧进程具体退出原因无法从已消失的PTY日志确认，不能推断为OOM或拼音误拒。

前端默认提示覆盖`fetch`连接拒绝以及`response.json()`/响应格式异常；合法服务端JSON的422/503等具体错误原本会透传。拼音相关实现SHA与前轮最终审查相同，本次没有证据要求放宽拼音或裁切护栏。

先以隐藏独立Node进程恢复原正式build、原3001，随后部署本次最小提示修复。`studio-app.tsx`只改重检handler的两处：请求失败显示「无法连接本地服务，请确认 3001 服务正在运行后重试；原候选已保留。」；收到响应后，读取/协议异常显示「重新识别服务未返回有效结果，请刷新页面后重试；原候选已保留。」。合法具体错误、取消/切换/迟到保护与候选采用流程保持。没有把服务未连接误写为台词核对失败。

## 代码验证

证据根目录`I:/AI/asmr-director-recheck-failure/2026-10-08`。源码仅`studio-app.tsx`与`studio-app.recheck.test.tsx`；`.gitignore`仅追加`.next-recheck-connection-production/`。前者是共享文件，`connection-authorized-delta-proof.json`用原字节做恰好两处替换，证明全文件其余字节（含既有1464个CRLF）保持，没有整体排除旧预览或其他会话改动。

| 检查 | 结果 |
| --- | --- |
| 重检回归 | 20/20，`recheck-tests.log`；网络失败保留候选/采用资产/工程/localStorage/声音设置，busy恢复可再试；取消后旧网络拒绝不误报或清新请求；无效JSON/null/502 HTML；422/503具体错误透传；无TTS |
| TypeScript / ESLint | 完整非增量TypeScript及2份本轮TSX的ESLint通过，`typecheck.log` / `lint.log` |
| 正式构建 | 42.27秒、exit0，`build-production-verification.json`；已知SWC警告仍回退通过，构建后Next配置恢复原字节 |
| 原3001页面 | 刷新并等待真实工程恢复后，热汤面标题、50输入值、时间线及第10段选择全部保持，原网络通用错误清除，旧候选及重检按钮可用；`browser-before.json` / `browser-after-restore.json` |

## 真实原音复测

部署/测试释放后提交内存达到历史ASR峰值＋768MiB余量。`memory-before-possible-recheck.json`及点击前复测记录区分初始不足与后续可运行状态；物理内存较紧，保留Windows既有分页设置。确认无其他ASR任务和新基线60候选/160素材/512原音后，仅在原UI对旧22.4秒候选`vox_4e1b84066347486ca3ed765154b4281b`点击一次重新识别，不调TTS、不自动采用、300秒总限。源SHA为`bc1c6621343b6f9dcf1b1a314f532c03c53a9467893b273f35db0d6db4348181`。

这次真实识别成功另存`vox_1d169d20af8a4221a5ee235ecd6933f4`，trace为`319dc09d-a835-4735-8dff-eac03fa7d202`。当前第10段候选1为4.3秒、实际截取0.48–4.78秒，检查complete/passed，`phonetic_substitutions`保留文字81.8%与拼音得分95.5%；`啦la5→了le5`为句末语气词，`汤tang1→糖tang2`具备完整原音对应“汤”的声调差证据。真实静音/左右独立识别/最终裁片及子句检查全部经正常服务通过，末尾静音区间4.68–5.46秒，前轮仅mock的样例现已补上实际ASR验收。新候选WAV经实际HTTP读取为200、audio/wav、412844字节，与存储字节完全相同，SHA256 `3bf2cfa23c08e39492b9a42c18c9b4b3b51d57b39254520eff672e9dbc9a9caa`，见`actual-new-top-audio-receipt.json`。没有再次TTS生成或听感验收。

旧22.4秒候选成为候选2，原始录音列表仍保留旧原音并增加本次22.4秒源副本。刷新后新候选、0.48–4.78范围、逐字理由及文字/拼音分数保持；用户工程标题、50输入值/时间线/第10段选中完全相同，10已采用/1待生成/9已生成未采用不变，采用按钮仍由用户决定。证据`actual-ui-recheck-start.json`、`browser-success.json`、`recheck-success.png`。未通过脚本注入浏览器状态或伪造模型响应。

watch启动晚于模型结束，`actual-user-ui-watchdog.json`必须标为not_observed，不能把未采到的0当作RSS峰值；本次不重跑模型补采峰值，也不宣称精确外部墙钟耗时。运行中根代理只读观察到ASR27328，模型已退出；实际分析时长若引用须来自新trace的analysis字段。

## 运行与保护

当前原址`http://127.0.0.1:3001/`，Node PID24036，`.next-recheck-connection-production`，BUILD_ID `KCxT0NZBLvlLRQ-bSZXj1`；隐藏独立进程，非owned PTY启动，stdout/stderr落地本轮证据目录。复原阶段PID28680已仅在身份核对后停止。可用外部`start-final-3001.ps1`重启，须先确认3001没有listener，不能并开另一原址。显式dist覆盖其他会话`.env.local`，heap1536MiB，TEMP/TMP为本轮tmp，预览临时根仍用前轮accepted-preview目录；不改系统设置/模型/其他服务。

用户当次连接失败之前未新增候选或录音。最终保护审计通过：本次实际成功重检精确新增1候选、2 WAV、7 trace文件，对应`vox_1d169d20af8a4221a5ee235ecd6933f4`；候选60→61、素材160→162、原音历史512→519。旧60候选的值与顺序、既有素材/原音、所有参考/H输入/空间/Qwen/前轮源码保持，原音源副本逐字节一致。`candidate-preservation-final.json`、`runtime-final.json`及`final-audit-summary.json`确认3001仍为本轮PID24036、无native任务/锁/ASR或scratch残留、HEAD未变、索引空。共享文档仅追加本轮状态，前轮ASR未实测描述保留为历史，由本次真实验收覆盖；embedding依旧未产生任何推理分数，不混为已实测。
