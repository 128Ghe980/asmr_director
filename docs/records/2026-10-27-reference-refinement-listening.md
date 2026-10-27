# 参考调整、重音与齿音对照

日期：2026-10-27（Asia/Hong_Kong）。承接[日语输出与参考长度对照](2026-10-27-japanese-output-control.md)，仍属 Audio Quality V1；SFX 暂停、目标机 H3 实跑待办保持。

后续用户反馈：由比滨23秒质量上升但仍不像，与雪之下相似；换seed的重音好一些，降低参考音量对噪感有明显改善。用户随后要求调CFG／步数，已完成[下一轮参数对照](2026-10-27-cfg-timesteps-listening.md)。以下“待用户听”是本轮交付时历史状态，不代表尚未收到上述反馈。

## 用户反馈与本轮设计

用户听后认为雪之下25秒参考比短参考更像，但日语重音位置有问题；三档输出在说话、尤其「si／tsh」附近有底噪感，相比由比滨更明显。用户提供新的 `H:/comfyui/output/sd2素材/干音/由比滨25s.MP3`，要求生成，并先调整参考做几版试听。此反馈是相似度相对改善，不是重音／音质整体验收通过。

新由比滨文件名为25s，完整解码实际23.8236734694秒、44.1kHz双声道、1,050,624帧；没有按名称裁切或补齐。模型参考16k mono PCM16为381,179帧，全部重采样flush保留，时长仅舍入相差约14微秒；原品质预览44.1k stereo PCM24。两者固定增益均0dB、无削波。原MP3未修改。

四条新增TTS固定同一日文、combined、CFG2、10步及原稳定CLI／模型／profile：

| 新版本 | 参考／随机种子改变 | 输出时长 | 生成耗时 |
| --- | --- | --- | --- |
| 由比滨新完整干音 | 完整23.82367秒、配套日语原文、seed42 | 9.60秒 | 25.126秒 |
| 雪之下原25.10秒重抽 | 参考／原文不变，只改seed43 | 9.92秒 | 24.220秒 |
| 雪之下参考降低音量 | 25.10秒参考整体−6dB、seed42 | 10.72秒 | 21.680秒 |
| 雪之下参考轻减高频 | 25.10秒参考4kHz高架−3dB、Q0.707、seed42 | 10.08秒 | 20.802秒 |

雪之下两参考处理彼此独立，未叠加，未补偿音量、裁切、变速、变调、去静音或强降噪；模型参考保持401,600帧，44.1k预览保持1,106,910帧。高架处理后的瞬态峰值−0.87dBFS，虽略高于原−1dBFS，仍无削波，未额外限幅。原source／参考SHA保持。

新由比滨先做一次全段日语ASR，按原文恢复标点，前12.64秒沿用此前相同转写；雪之下沿用已记录25.10秒转写。两者仍为ASR辅助文本，未经用户逐字确认。生成后一次ASR批次检查四条，内容均对应目标日文，仅标点和「温かい／暖かい」同音写法差异；这不验证日语高低重音、齿音质量或相似度。

## 已测到什么，尚不能推断什么

轻量测量对比此前12条模型参考、原品质预览和原生输出：

- 雪之下25秒参考RMS约−13.74dBFS／−12.55LUFS，旧由比滨12.64秒约−24.75dBFS／−23.96LUFS，相差约11dB。native参考编码没有整体RMS归一化，故−6dB输入对照不会被自动抵消；但单纯减音量不改善输入信噪比。
- 讲话能量帧的4–7.5kHz能量占比：雪25秒3.52%，由比滨1.76%；雪原品质预览3.55%，未见16kHz转换明显抬高该比例。
- 数学统一到−23LUFS后，参考静段4–7.5kHz分别约−84.21／−84.17dBFS，几乎相同。因此不能据原音更响就判定雪之下有更大的持续高频底噪。
- 当前PCM没有削波；仍不能排除上游处理痕迹。讲话高频可能是正常擦音、声线特征、源处理痕迹或模型纹理，频谱指标不能识别其中的主因。
- 只换一次seed是重音随机变化的对照，不足以证明异常重音来自随机性；参考轻减高频也可能削弱正常齿音和角色辨识特征。尚未宣称任何版本更好。

原始测量、帧划分规则／阈值、全部FFmpeg命令、输入SHA及候选边界保存在本轮QA的 `diagnosis/diagnosis.json`、12份帧CSV和 `diagnosis/findings-and-candidates.json`。未以自动ASR或声学指标替代用户听感。

## 交付与恢复入口

试听页：`I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/japanese/reference-refinement/index.html`。包括旧由比滨12.64秒与新完整参考两条结果，以及雪之下旧25.10秒seed42、seed43和两处理参考共四条。原品质／处理后预览、实际16k模型输入及原文可折叠核对。生成结果保留原生WAV，试听副本只用固定增益对齐约−23LUFS；没有给生成结果加降噪或EQ来掩盖差异。

QA根：`I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27/reference-refinement/`。

- `new-yui-preparation.json`、`reference-variants.json`：全长转换与两个参考处理的来源／命令／帧数／哈希。
- `source-asr.json` 与 `source-asr-guard/receipt.json`；`generated-asr.json` 与 `generated-asr-guard/receipt.json`。
- `manifest.json` 是打包目录，每行有seed，禁止把顶层seed42套到seed43那行执行；模型只用对应的四份单条 `guarded-*.json`。
- `generation/audio/<id>/japanese-paragraph/take-001/receipt.json` 与四份 `guard-*/summary.json`。
- `generation-verification.json`、`package-receipt.json`、`delivery-verification.json` 为独立核对与交付证据。

四次真实GPU TTS均take001／exit0，48k mono PCM16、零削波、无步数封顶；无额外质量重抽或CPU TTS。沿用用户此前授权的 `--allow-low-start`，50ms／1.5GiB运行中保护保持，无保护中止。未修改系统设置、原始输入、生产profile或常驻应用；未打开浏览器、部署、提交或推送，其他工作树改动保持。下一步为用户试听六条结果，分别反馈重音、齿音噪声与音色，尚不自动采纳任一处理作为默认。

交付验证：四条新原生WAV与receipt SHA一致，试听实测−22.98／−23.00／−23.00／−23.00LUFS，逐样本静态增益误差≤0.501个PCM16量化单位；26个本地链接和45项旧交付资产SHA保持。四次TTS最低提交余量约2.125–2.343GiB，全部正常退出，最终无native进程／共享锁。
