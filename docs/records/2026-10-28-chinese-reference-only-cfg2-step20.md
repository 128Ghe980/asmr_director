# 两角色仅参考音频中文 CFG2／20 步对照

日期：2026-10-28（Asia/Hong_Kong）。归属Audio Quality V1；SFX暂停、目标机H3待办保持。

同日最终反馈：用户听后仍认为“不像”，本轮CFG2／20未通过相似度验收。用户决定暂时停止此实验，把最终两参考以日语／原文生成方式加入系统并发布交接；见[入库与交接记录](2026-10-28-japanese-reference-presets-handoff.md)。

## 用户反馈与固定条件

用户确认上一轮不加原文的CFG2.5／10“中文正常了”，但两角色“音色还是不太像”，要求都试CFG2／20，参考音量、seed和两句中文保持，仍然不加原文。中文可用与角色相似度分别记录，不能把识别匹配等同音色通过。

本轮仅将CFG2.5→2、扩散10→20步，沿用`reference_only`，无promptText／prompt-wav／prompt-text。雪之下完整25.10秒预转16k参考、参数轮减6dB分支、seed43；由比滨02完整20.2188秒预转16k、gain1、seed42。temperature1、最大解码600、low-vram等保持。旧reference ID可能含cfg2p5字样，只作历史标识；真实参数以新清单／request／命令／日志为准。

1. `chinese-rest`：先坐下来休息一下吧，我给你倒杯温水。
2. `chinese-comfort`：今天已经很努力了，剩下的事情明天再慢慢想，好吗？

每角色两句，共4条新生成。对照页复用上一轮4条原生及静态增益试听，按角色／句子并排CFG2.5／10与CFG2／20，共8条，旧音频不重新处理。

## 生成与内容核验

4个新目标均已成功生成，48kHz mono PCM16、零削波。雪之下第一句take001在4.051秒因提交余量低于1.5GiB保护线中止，最低约1.437GiB、无WAV，进程退出和锁释放核实。检查确认NVIDIA Overlay重启，按用户本会话既有临时退出授权，仅退出5个经路径核定的`NVIDIA Overlay.exe`（合计约683.5MiB私有内存），逐个确认退出；没有动驱动或其他应用。随后同配置take002成功；其余三条均take001，没有质量重抽，初失败完整保留。

| 角色／目标 | 旧CFG2.5／10时长 | 新CFG2／20时长 | 新成功take | native耗时 | 最低提交余量 |
| --- | --- | --- | --- | --- | --- |
| 雪之下／chinese-rest | 3.68秒 | 3.52秒 | 002 | 13.114秒 | 1.756GiB |
| 由比滨／chinese-rest | 3.36秒 | 3.36秒 | 001 | 14.384秒 | 1.893GiB |
| 雪之下／chinese-comfort | 5.76秒 | 5.76秒 | 001 | 13.071秒 | 1.709GiB |
| 由比滨／chinese-comfort | 5.28秒 | 4.80秒 | 001 | 15.056秒 | 2.127GiB |

独立准备比对确认仅CFG／timesteps两字段变化；真实request、argv与日志确认CFG2、扩散20步、reference_only、无prompt分支。4新日志均为20步8962图节点，与旧parameter-sweep两条20步真实证据一致（10步为4462）。参考、源、profile、CLI及模型身份保持；仅音频模式参考patch按完整PCM及native公式核定，目标token随文案而定，没有误套combined计数。

一次zh ASR批次识别4条，去标点后均精确匹配目标，`content_review_needed=false`；最低提交余量2.204GiB、无中止。不将ASR对应视为音色改善或主观自然度验收。审计初次只因历史报告的graph字段是对象而非数组报错，补兼容读取后同一真实8962证据核对通过，初报告另存；没有取消节点检查、重哈希模型或重跑音频。

## 交付与证据入口

QA：`I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27/chinese-reference-only-cfg2-step20/`。

试听页：`I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/chinese-reference-only-cfg2-step20/index.html`。4组每角色／同句旧新并排，共8个主播放器；完整参考默认折叠。旧4条source／raw／listen及receipt路径和SHA与上一包完全一致，直接引用、未重算。新4条只静态增益至约−23LUFS，原生与试听均零削波。22个本地链接、137个旧资产SHA、逐样本固定增益、页面参考及8卡真实路径均经包装和独立审计通过。

恢复入口：`design.json`／4份`guarded-*.json`／`preparation-verification.json`；`selection.json`明确雪rest take002与其余take001，失败保留；`resource-recovery.json`为Overlay准确进程及退出证据；`execution-summary.json`、各take的request／receipt及guard summary；`generated-asr.json`与保护回执；`generation-verification.json`、`package-receipt.json`、`delivery-verification.json`、`independent-delivery-verification.json`。初次历史字段解析审计保留在`generation-verification-initial.json`，最终报告包含`historical_graph_schema_recheck`说明。

串行GPU保持已授权allow-low-start及50ms／1.5GiB实时保护；没有降低保护。所有模型已退出，锁释放；无CPU TTS回退、浏览器重开、系统永久设置或生产profile改动、部署、提交或推送。4新生成与8卡对照交付完成，CFG2／20是否更像仍待用户试听。
