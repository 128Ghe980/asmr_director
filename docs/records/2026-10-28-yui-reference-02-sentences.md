# 由比滨参考02的五组新日语短句

日期：2026-10-28（Asia/Hong_Kong）。承接[新参考02试听](2026-10-28-yui-reference-02.md)，归属Audio Quality V1；SFX暂停、目标机H3待办保持。

同日后续反馈：用户认为五句“还行吧，算是像了”，并明确剩余问题是“声音往下落、低声说话时不够像”。可记录基本声线相似，低声区还原尚未通过。只读测量未发现统一低频／低F0缺失，不能把问题归因于16kHz上限或直接整体降调；不同文案不能定位音色差异原因。详见[低声区诊断](2026-10-28-yui-low-register.md)。

## 用户反馈与固定条件

用户认为02参考“稍微更像了一点”，要求再生成几个句子。沿用完整20.2188秒、提前转换好的16kHz mono PCM16参考、该参考的新日语原文，以及seed42／CFG2.5／扩散10步／combined／temperature1／最大解码600／low-vram。参考输入SHA `a1440c9b9184286a683ed9612f9b2b34fcb171f2fda525e8505b37fe33609ecb`保持，不再转码、调整增益或重复识别参考。

本轮只更换目标文本。打招呼、邀约、关心、害羞回应、安慰只是文案分类，没有向模型额外加入情绪指令或风格标签，也不代表这些情绪已被主观验收。保持同一seed便于观察不同句子下的表现，不声称不同文本理应有相同时长或语调。

## 五组文案

| ID／分类 | 日语目标 | 中文含义 |
| --- | --- | --- |
| greeting／打招呼 | あ、来てくれたんだ。待ってたよ。隣、座ってもいい？ | 啊，你来了。我一直在等你。我可以坐你旁边吗？ |
| invitation／邀约 | ねえ、帰りに少し寄り道しない？駅前のお店に、新しいケーキがあるんだって。 | 回去时要不要顺路逛一下？听说车站前的店出了新蛋糕。 |
| concern／关心 | 今日、ちょっと元気ないね。無理して笑わなくてもいいんだよ。話したくなったら、私でよければ聞くから。 | 你今天有点没精神。不用勉强笑，想说的时候，我可以听你聊。 |
| shy／害羞回应 | そんなふうに言われると、ちょっと照れるよ。でも、ちゃんと伝えてくれて嬉しい。 | 被你这么说有点害羞，不过你愿意告诉我，我很开心。 |
| comfort／安慰 | 今日はもう、ゆっくり休もうよ。明日のことは、明日考えればいいって。眠くなるまで、もう少しだけ一緒にいよう。 | 今天就好好休息吧，明天的事明天再想。睡意来之前，再一起待一会儿。 |

## 生成、内容复核与交付

5条新GPU均take001／complete／exit0，48kHz mono PCM16，无削波、长度触顶或保护中止，无重抽／CPU TTS回退。逐条request将text恢复为旧目标后与原02 request整字典相同；两路参考均127patch，各句text_tokens不同，已按实际值核对总序列及10步4462节点。CLI／模型／profile及全部源、输入、输出、命令、日志哈希独立核验通过。

| ID | 音频时长 | 本次进程耗时 | 最低提交余量 |
| --- | --- | --- | --- |
| greeting | 5.12秒 | 15.741秒 | 2.287GiB |
| invitation | 6.72秒 | 20.078秒 | 2.300GiB |
| concern | 8.00秒 | 17.528秒 | 2.448GiB |
| shy | 6.24秒 | 15.509秒 | 2.191GiB |
| comfort | 8.16秒 | 19.203秒 | 2.297GiB |

一次受保护ASR批次识别5条，最低提交余量2.150GiB。invitation／comfort仅标点不同；concern「よければ／良ければ」、shy「ふう／風」为正字写法差异。greeting初轮识别缺少「あ」「待ってたよ」，初轮审计诚实保留`content_review_needed=true`，没有直接认定音频缺词或为通过修改目标。

随后对同一greeting WAV只关闭ASR的VAD过滤做一次受保护复核，beam5／temperature0／condition_on_previous_text=False／模型和音频不变。识别为「あ、来てくれたんだ。待ってたよ。隣座ってもいい?」，去标点后与目标全文一致；最低提交余量2.146GiB，无保护中止。诊断脚本与原脚本严格只有VAD开关及结果标记两处变化，输入SHA、原5条ASR及初审文件保持。独立补充核验通过，不覆盖初轮证据、不重新生成、不声称人工听过。

试听页：`I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/japanese/yui-reference-02-sentences/index.html`。5主卡附日文和中文含义，旧02段落8.64秒及两路参考默认折叠；原生WAV保留。生成试听仅固定增益匹配，约−23LUFS，无削波，最大量化误差0.500322个PCM16单位；16本地链接、108旧资产哈希保持。音色稳定性和相似度仍待用户主观试听，ASR不承担该评价。锁已释放，无残留Vox；未打开浏览器、部署、提交或推送。

## 准备与恢复入口

QA：`I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27/yui-reference-02-sentences/`，实际执行日期2026-10-28。

- `design.json`、`manifest.json`：文案、翻译和任务索引；master刻意没有可执行的references/texts，不用于运行模型。
- `guarded-<textid>.json`：5份单条执行清单；reference id仍为`yui-reference-02`，输出按textid区分。
- `preparation.json`、`preparation-verification.json`：除texts以外与既有02清单完全相同，五目标唯一、UTF8身份及参考／原源／profile保持。
- `generation/audio/yui-reference-02/<textid>/take-001/receipt.json`、`guard-<textid>/summary.json`：真实运行记录。
- `generated-asr.json`、`generated-asr-guard/receipt.json`、`generation-verification.json`：5条原始识别、技术核验及greeting初次待复核项。
- `greeting-content-check/{diagnostic-settings.json,generated-asr.json,generated-asr-guard/receipt.json,verification.json}`：同音频无VAD复核，全文匹配，原初轮证据不动。
- `package-receipt.json`、`delivery-verification.json`：5新＋1旧播放、固定增益、所有链接和旧资产保持。

按已授权低启动线串行运行，50ms／1.5GiB保护保持；不修改生产profile、系统设置、参考原文件或产品默认值。
