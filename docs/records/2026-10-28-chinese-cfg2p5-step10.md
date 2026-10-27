# 两角色 CFG2.5／10 步中文试听

日期：2026-10-28（Asia/Hong_Kong）。归属Audio Quality V1；SFX暂停、目标机H3待办保持。

**用户纠正：本批错误沿用了combined。用户明确本来就要求不加原文，因为前面已确认加日语原文会跑偏。本批保留为错误方法的历史结果，不能当作用户所要求的中文测试已完成，也不能推断用户同意继续combined。纠正批见[仅参考音频中文试听](2026-10-28-chinese-reference-only-cfg2p5-step10.md)。**

## 请求与固定条件

用户决定暂时停在当前低声区表现，要求用新的CFG2.5／10直接生成中文，雪之下和由比滨都要、生成两句。本轮执行为两个角色各生成相同两句中文，共4条。此前低声区同句对照建议不再作为当前待执行任务。

本批错误执行为combined路径：完整预转16k参考音频＋对应日语原文，只更换目标为中文，没有把参考原文翻译为中文。雪之下沿用已选25.10秒参考／参数轮减6dB分支／seed43；由比滨沿用新02完整20.2188秒参考／gain1／seed42。两者CFG2.5、扩散10步、temperature1、最大解码600及low-vram保持。以上是执行历史，不是用户认可的中文生成方式。

| 目标ID | 中文文案 |
| --- | --- |
| chinese-rest | 先坐下来休息一下吧，我给你倒杯温水。 |
| chinese-comfort | 今天已经很努力了，剩下的事情明天再慢慢想，好吗？ |

沿用用户已授权的低启动线和50ms／1.5GiB运行保护，GPU串行；不自动关闭其他应用或打开浏览器。保留真实输出，不以中文ASR不符为由重抽。generated ASR使用zh，识别只辅助内容复核，不能代替发音或音色试听。

## 生成与内容检查结果

4个目标均已生成，技术核验通过；实际5次native尝试，其中雪之下第二句take001被实时内存保护中止、无WAV。该次最低提交余量约1.439GiB，低于1.5GiB保护线，持有的子进程handle被正确终止，进程退出和双锁释放均核实。资源恢复后以同配置执行take002成功；没有按质量重抽，也没有降低保护。其余均take001，成功运行最低提交余量1.900～2.452GiB；中文ASR最低2.241GiB。Overlay只读发现已重启，本轮未退出任何用户应用。

| 输出 | 成功take | 时长 | 进程耗时 | 中文ASR |
| --- | --- | --- | --- | --- |
| 雪之下／chinese-rest | 001 | 4.32秒 | 18.858秒 | 先坐下来休息一下吧,我给你倒杯温水。 |
| 由比滨／chinese-rest | 001 | 3.68秒 | 14.636秒 | 我先去吃早餐了我先去吃早餐了 |
| 雪之下／chinese-comfort | 002 | 6.08秒 | 16.960秒 | 看天一天的努力,勝者的氣象明天在滿滿手,好嗎? |
| 由比滨／chinese-comfort | 001 | 4.96秒 | 17.969秒 | 寒天一陣変動力啦勝者的氣勢就明天再滿滿手 吼嘛 |

雪之下第一句识别仅标点差异，其余3条明显偏离目标，`content_review_needed=true`。强制zh识别不能证明具体混合哪种语言，也不能代替实际听辨，但本批不支持“新的CFG已解决跨语言问题”的结论。不修改目标以迁就识别、不重复识别或生成直到匹配。

真实request、CLI命令与日志确认CFG2.5／10步4462图节点、雪双路157patch、由比滨双路127patch；源、参考、profile、CLI及模型身份保持。所有4条48kHz mono PCM16、无削波；GPU运行、参数和失败保留均独立核验。只改变目标文本，参考音频没有再处理。

## 交付与证据入口

按同一句并排展示两角色，共4条主播放器，中文明确标为目标文案；完整参考默认折叠，保留原生WAV下载。试听只静态增益，约−22.98～−23.00LUFS，无削波；逐样本量化误差≤0.502个PCM16单位。打包及独立核验通过：14个本地链接有效、119个旧资产SHA保持、raw与所选原生输出相同、页面参考与模型输入相同。ASR差异留在QA回执，未额外添加诊断界面。未打开浏览器。

- QA：`I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27/chinese-cfg2p5-step10/`。
- 试听页：`I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/chinese-cfg2p5-step10/index.html`。

主要文件：`design.json`／4份`guarded-*.json`／`preparation.json`／`preparation-verification.json`；`selection.json`明确4个成功take及失败保留，不按目录最新值选取；`execution-summary.json`／各take的request与receipt／各guard的summary；`generated-asr.json`及保护回执；`generation-verification.json`技术通过且3条内容待复核；`package-receipt.json`／`delivery-verification.json`／`independent-delivery-verification.json`。初次准备审计器字段兼容修正前报告另存`preparation-verification-initial.json`，未改清单或音频。

运行锁已释放，无残留Vox；无CPU TTS回退、生产profile／系统设置改变、应用部署、提交或推送。四条技术交付完成，中文发音与音色由用户试听，未宣称质量通过。
