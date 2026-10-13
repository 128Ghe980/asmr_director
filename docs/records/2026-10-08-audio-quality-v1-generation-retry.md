# 人声音质 V1：释放内存后的单次生成复测

日期：2026-10-08（Asia/Hong_Kong）。用户授权「再试一下」。父阶段「人声导演与真实 ASMR 音效质量 V1」保持 in_progress，SFX暂停，未提交推送。

## 运行恢复

开始时3001无listener、无Vox/ASR任务或运行锁，FreePhysicalMemory6124108KiB、FreeVirtualMemory8868772KiB，RTX3060 Laptop 6GiB空闲5180MiB。前轮自动审批阻止的停止/重启命令仍未执行；本轮服务已先不存在，只启动已验证的新build，无停止进程或绕过操作。

原3001恢复为隐藏独立Node PID2592、dist `.next-generation-oom-production`、BUILD_ID `jzycOB_1_hvvzeCLn6eiE`，HTTP200和实际页面build标记确认。保留I盘voice work与已采用语音预览临时根，heap1536MiB、TEMP/TMP为本轮证据目录；未改模型、参考、系统分页或其他服务。前轮精确CUDA allocator OOM分类现在已部署，本轮没有OOM可用来再次触发该提示。

## 实际结果

原3001热汤面工程刷新后，原20段台词及采用资产保持。UI选择上次失败第10段，保持normal_zh、参考音频＋文本、长文连续生成及原后续上下文，只点击一次生成，不自动采用或修改台词。

- 新候选 `vox_c610ae7101a94c119b7035ad9bf8131e`，clip `voice_705043b8-7b9e-4594-b204-054bf2205bab`，trace `dbebef70-3859-4c34-848e-b1502e6af3c1`。
- 完整原音20.48秒，页面20.5秒；新候选3.9秒，裁片0.00–3.90秒。普通文字阈值90%通过，相似度90.9%，只存在「啦→了」同位字差，recognition complete/check passed；本次未使用新拼音容错分支。
- `performance.json`流水线92978ms、原生生成24768ms，automaticQualityRetries0；不是观察器99.4秒生命周期的精确推理耗时。实际Vox PID12572后正常退出，ASR PID15640后退出。
- 新顶WAV374444字节，SHA256 `6b750da2f809fe2ded38b1b3945c38468a2bea4d2b9ede4d07839d1d7d7aba53`。
- 生成后再刷新，候选1/90.9%/0.00–3.90仍在，旧4.3秒与22.4秒候选保留，原标题及第10段所对应全部50输入值相同，10采用/1待生成/9已生成未采用不变。未试听，不声称听感或声线验收。

## 监测与保护

观察器在点击前启动，每约2秒只读采样。采样RSS峰3518185472字节；Windows报告的ASR进程历史峰4010098688字节，口径不同，不把采样值当作全程绝对峰。最低FreeVirtualMemory2596052992字节、GPU占用采样峰4140MiB，无OOM或取消告警。

候选61→62，仅新增1候选、2WAV及唯一新trace的8文件（含performance.json），原162素材/527历史文件/10参考与profile文件的字节、旧候选值/顺序/manifest header保护通过。当前服务PID2592，无Vox/ASR任务，3个实际锁不存在；本次candidate-HXKA13/group-YRnNKM临时目录已清理，未清理任何既有scratch。工作树其他会话改动保持，没有再次构建或修改源码。

证据根 `I:/AI/asmr-director-generation-retry/2026-10-08`：`server-start.json`、`browser-pre-generate.json`、`ui-request.json`、`browser-success.json`、`browser-refresh.json`、`generation-success.png`、`watch-runtime.json`、`watch-preservation-final.json`、`watch-exact-delta-final.json`、`watch-tasks-and-locks-final.json`。

本次证明释放内存后当前设置可完成一次生成，不能据此推断前轮Windows fast-fail的具体原因或保证每次生成均成功。此前未部署状态由本次实际启动覆盖；仍需用户试听并手动采用。
