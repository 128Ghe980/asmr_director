# 两角色仅参考音频 CFG2.5／10 中文试听

日期：2026-10-28（Asia/Hong_Kong）。归属Audio Quality V1；SFX暂停、目标机H3待办保持。

同日用户试听反馈：“中文正常了，但感觉音色还是不太像”，两角色均未通过相似度验收。用户要求保持参考音量、seed及这两句中文，继续不加原文，改试CFG2／20步；见[下一轮参数对照](2026-10-28-chinese-reference-only-cfg2-step20.md)。

## 用户纠正与控制变量

用户明确“肯定是不加原文的啊，刚才已经试过加原文肯定偏啊”。上一轮继续combined是agent的错误推断，不是用户选择；该批已标注为错误方法历史，原始证据保留。本轮纠正为仅参考音频，两个角色各生成相同两句中文，共4条。

mode为`reference_only`，删除`promptText`，实际命令不带`--prompt-wav`或`--prompt-text`。完整预转16k参考、参考音量、seed、目标文本及其他参数与上一批保持：雪之下25.10秒减6dB分支／seed43，由比滨02完整20.2188秒／gain1／seed42；CFG2.5、扩散10步、temperature1、最大解码600、low-vram保持。

1. `chinese-rest`：先坐下来休息一下吧，我给你倒杯温水。
2. `chinese-comfort`：今天已经很努力了，剩下的事情明天再慢慢想，好吗？

用户暂缓低声区专项诊断；后续中文生成沿用本轮仅参考音频方式，不能因日语实验使用combined就再次带入日语原文。

## 生成与内容核验

4条均首次take001生成成功，48kHz mono PCM16、无削波。实际清单删除promptText；legacy request省略mode／promptText相关键；argv完全没有`--prompt-wav`／`--prompt-text`，native日志没有Prompt加载、combined或continuation分支。独立审计确认与上轮对应清单只改变参考模式及移除原文，参考hash、seed和其余参数保持。

| 输出 | 时长 | native耗时 | 最低提交余量 |
| --- | --- | --- | --- |
| 雪之下／chinese-rest | 3.68秒 | 11.288秒 | 2.218GiB |
| 由比滨／chinese-rest | 3.36秒 | 11.592秒 | 2.347GiB |
| 雪之下／chinese-comfort | 5.76秒 | 11.262秒 | 2.474GiB |
| 由比滨／chinese-comfort | 5.28秒 | 13.669秒 | 2.263GiB |

真实日志和命令确认CFG2.5及10步；仅音频分支不打印combined的patch明细，雪157／由比滨127参考patch由完整PCM帧数及native构造公式核定，再用LocEnc总序列核对同句目标token在两角色一致，不冒称日志打印未打印的值。源、输入、profile、CLI及模型身份保持。

一次GPU中文ASR（zh／beam5／temperature0／VAD true）对4条识别均去标点后精确匹配目标，`content_review_needed=false`；最低提交余量2.275GiB。识别一致支持文本内容对应，不等于主观发音自然度或角色音色已通过。没有额外重识别、资源重试或质量重抽。

## 交付与证据

QA：`I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27/chinese-reference-only-cfg2p5-step10/`。

试听页：`I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/chinese-reference-only-cfg2p5-step10/index.html`。按句并排两角色，4主播放器；完整16k参考默认折叠，文案明确“仅参考音频”，不显示原文或ASR诊断。原生下载保持，试听只固定增益至约−23.01～−22.99LUFS、零削波。包装及独立交付校验通过：14个本地链接、4条native→raw身份／逐样本固定增益、两份实际参考及128个旧资产SHA保持，旧combined页面未改。

恢复入口：`design.json`／4份`guarded-*.json`／`preparation.json`／`preparation-verification.json`；`selection.json`（4条均take001）／`execution-summary.json`／各take request、receipt及guard summary；`generated-asr.json`及保护回执；`generation-verification.json`／`package-receipt.json`／`delivery-verification.json`／`independent-delivery-verification.json`。

串行GPU保持已授权allow-low-start及50ms／1.5GiB实时保护，全部无中止。运行锁已释放，无残留Vox；没有退出Overlay或其他应用、打开浏览器、CPU TTS回退、系统／生产profile改动、部署或提交推送。四条仅参考音频中文交付完成，音色由用户试听。
