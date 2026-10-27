# CFG 与扩散步数试听对照

日期：2026-10-27（Asia/Hong_Kong）。承接[参考调整试听](2026-10-27-reference-refinement-listening.md)，归属 Audio Quality V1；SFX 暂停、目标机 H3 实跑待办不变。

同日后续反馈：用户确认雪之下 CFG2.5／10 与 CFG2／20 明显更好；由比滨 CFG2.5／10 稍好，仍不够像。下文“待试听”保留为当时交付状态，后续以[参考增益与输入清晰度记录](2026-10-27-reference-gain-input-clarity.md)为准；没有自动改变产品默认值。

## 用户反馈和固定条件

用户确认：由比滨完整23秒参考质量上升，但还不算很像，与雪之下相似；雪之下换一次生成的重音较好，降低参考音量对噪声感有明显改善。用户要求继续调CFG与步数。尚无高频处理版本获选，也不能把相似度记为验收通过。

本轮雪之下采用完整25.10秒、已衰减6dB的参考，配同段日语原文，固定seed43。由于此前减6dB版是seed42、seed43版用原电平，这个组合先新增一条CFG2／10步基准，不能复用两者之一冒充组合基准。由比滨固定完整23.82367秒参考、原文及seed42，复用已验证的9.60秒CFG2／10步结果。

两人物均combined、同一段日语目标、temperature1、low-vram和稳定CLI／权重／profile。每个人物四档：CFG2／10步基准、CFG1.5／10步、CFG2.5／10步、CFG2／20步。每档相对同角色基准只改变CFG或扩散步数；不同时调两项，也不换参考、原文或seed。

目标文案：少し座って休みましょう。お茶はまだ温かいので、ゆっくり飲んでください。今日のことは、明日また考えれば大丈夫です。

## 生成与内容检查

7条新GPU TTS均take001／exit0／complete，另1条由比滨旧基准直接复用；全部48k mono PCM16、零削波、未达到最大音频长度。没有失败后重抽、CPU回退或重新转码参考。

| 人物 | CFG | 扩散步数 | WAV时长 | 本次生成耗时 |
| --- | --- | --- | --- | --- |
| 雪之下 | 2 | 10 | 10.56秒 | 24.687秒 |
| 雪之下 | 1.5 | 10 | 12.96秒 | 25.544秒 |
| 雪之下 | 2.5 | 10 | 10.56秒 | 23.017秒 |
| 雪之下 | 2 | 20 | 9.92秒 | 22.476秒 |
| 由比滨 | 2 | 10 | 9.60秒 | 复用上轮，不重跑 |
| 由比滨 | 1.5 | 10 | 9.28秒 | 19.308秒 |
| 由比滨 | 2.5 | 10 | 9.28秒 | 19.414秒 |
| 由比滨 | 2 | 20 | 9.76秒 | 21.617秒 |

耗时是本次进程观测，不是控制缓存与系统负载后的速度基准。实际native日志确认20步进入 `decode_front_half` 计算图（雪之下20步为8962节点），不是仅改清单标签。

新增一次受保护的ASR批次检查7条新音频，识别内容均对应目标句，仅标点及「温かい／暖かい」同音汉字写法差异；雪CFG1.5较长，但ASR未发现漏字或重复。旧由比滨基准已在上一轮识别并保留哈希。ASR不评价重音、噪声质感或角色相似度，这些仍待用户试听。

## 参数入口与验证

`tools/voxcpm2-runtime/run_reference_listening.py` 新增可选manifest `timesteps`，缺省整数10，严格接受4–30整数，在文件哈希与native启动前校验。该值贯穿请求哈希、`run_take → build_command`、实际 `--timesteps` 及持久receipt；默认命令／旧请求哈希保持。`--steps 600` 始终保持，它是最大音频解码步数，不能与10／20扩散步数混用。该改动只影响实验运行器，未改产品设置或生产profile。

最终10项运行器回归及3项guard测试通过，包括旧默认哈希兼容、非法timesteps提前拒绝、非默认值影响请求身份，以及mock Popen下实际run_take传20并持久化正确命令。独立只读代码审阅通过。证据 `tests-observed.json` 明确记录来自本轮exec测试结果，未伪造额外重跑日志；`runner-parameter-review.json` 保存源码／测试／guard SHA及代码链审阅。

继续沿用此前用户授权 `--allow-low-start`，每条串行并保留50ms／1.5GiB运行中保护。7个native和ASR均无保护中止；未关闭应用、修改系统设置或切CPU。

## 交付与恢复入口

试听页：`I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/japanese/parameter-sweep/index.html`。两角色各4卡，原文／参考折叠，旧轮可返回。7新结果保留原生WAV及固定增益试听，实测−23.01～−22.98LUFS；未给生成结果做降噪、EQ或变速。旧由比滨基准直接链接已有文件，没有复制改写。23个本地链接、逐样本增益及62项全部旧资产SHA保持，未打开浏览器。

QA根：`I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27/parameter-sweep/`。

- `experiment-design.json`、`manifest.json`：用户反馈／固定参考身份／8档清单，旧Yui有明确reuseExisting与原receipt/raw/listen身份。
- 7份 `guarded-*.json` 才是执行输入；汇总manifest仅用于打包，不能用一个顶层参数执行整个目录。
- `generation/audio/<id>/japanese-paragraph/take-001/receipt.json` 与7份 `guard-*/summary.json`、原始samples。
- `generated-asr.json`、`generated-asr-guard/receipt.json`。
- `generation-verification.json`、`package-receipt.json`、`delivery-verification.json`。

本轮尚未选定新参数默认值，不自动应用到用户工程。未部署、提交或推送；输入、生产配置及其他工作树改动保持。
