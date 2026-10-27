# 由比滨重新处理参考02的试听

日期：2026-10-28（Asia/Hong_Kong）。承接[由比滨直接输入对照](2026-10-28-yui-direct-44100.md)，仍属Audio Quality V1；SFX暂停、目标机H3待办保持。

同日用户试听反馈：新02参考“稍微更像了一点”，要求沿用它再生成几个句子。此为小幅相似度改善，不能写成全面验收通过；下文“待用户”是当时交付状态。

## 用户反馈与本轮输入

用户确认由比滨直接44.1kHz输入也更差，选择继续提前转换16kHz。雪之下已有同样负面反馈，后续参考实验默认沿用已验证的FFmpeg提前转换路径；没有修改产品默认或运行程序。

用户提供新处理的`H:/comfyui/output/sd2素材/干音/由比滨25s-02.MP3`，要求保持CFG2.5／10和seed。文件323550字节，SHA `400429aa9f38d2447a4140531dfb8341de31807f2c9485a0802b5fba31ad0d14`；实际完整解码为891648帧／44100Hz stereo，20.2187755秒。文件名25s不代表需要裁切或补齐，完整输入全部使用。

新参考采用float-first解码，L/R平均，再用原来的`aresample=16000:filter_size=64:phase_shift=10:cutoff=0.97`提前转换，保留全部flush输出323501帧／20.2188125秒，标准mono PCM16。原采样率stereo预听保留PCM24。两分支静态增益均1.0，无需峰值保护衰减，不叠加上轮+3或+6dB，也没有EQ、降噪或动态归一。

新模型输入峰值−7.912dBFS、RMS−24.803dBFS，比旧原电平参考RMS高约0.648dB，来自新文件本身；不能描述为新旧输入响度相同。独立完整解码、重采样和PCM量化重建与模型输入逐样本一致，无削波、源哈希保持。

## 新原文与固定生成条件

重新运行一次受保护日文ASR识别新完整预听。后半对白已从旧版的组织生日会／分餐改为感谢大家及最开心的生日，因此没有沿用旧prompt。仅给新ASR添加标点，去标点空白后的词句严格相同，保留口语「かもしんない」；没有声称人工听写核准。

传入原文：私これ結構楽しいよ。今までお誕生日会とかって、あんまりしてもらったことなかったから、嬉しいな。いや、みんな本当ありがとう。今までで一番嬉しい誕生日かもしんない。そんなことないよ。本当に嬉しいもん。

固定seed42／CFG2.5／扩散10步／combined／temperature1／最大解码600／low-vram，以及既有CLI、权重、profile。目标文案精确保持：少し座って休みましょう。お茶はまだ温かいので、ゆっくり飲んでください。今日のことは、明日また考えれば大丈夫です。

对照复用旧原参考的`parameter-sweep/yui-cfg2p5-step10`（9.28秒），不重抽。新旧参考内容、长度和自身电平不同，本轮是新参考整体效果比较，不是单一增益或重采样变量实验。

## 生成与交付

新增一次受保护GPU TTS，take001／complete／exit0，耗时18.762秒。输出48kHz mono PCM16、414720帧／8.64秒，峰值−11.047dBFS，零削波、未触及长度上限。另做一次生成日文ASR，文本完整对应同一目标句，只有标点省略及「温かい／暖かい」同音字差异。与旧9.28秒相比变短不能直接判定漏字，ASR未发现遗漏；重音、音质和相似度仍待用户。

最终独立审计通过：实际16k输入323501帧、两路127个音频patches（旧参考为149）、text_tokens149、合计406序列项，CFG2.5／10步4462节点、seed42及固定CLI／权重／profile均正确。source ASR／TTS／generated ASR最低提交余量分别2.128／2.357／2.116GiB，3套原始guard样本极值复核通过，无保护中止；锁释放，无Vox残留。

交付页：`I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/japanese/yui-reference-02/index.html`。主区并列旧原参考与新02生成，试听仅固定增益匹配，实测−22.99／−23.00LUFS，零削波、量化误差≤0.501个PCM16单位。原生WAV保留，参考折叠区明确区分原44.1kHz stereo PCM24预听与实际16kHz mono输入，并显示各自对应原文。导航保留旧增益对照页，便于另听+3／+6旧结果。

10个本地链接、103项旧资产哈希和静态增益核验通过。没有向用户浏览器新开页面，不声称人工试听或“新参考更像”；没有重抽、CPU TTS回退、部署、提交或推送。

## 恢复入口

QA复用 `I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27/yui-reference-02/`，实际日期2026-10-28。

- `preparation.json`、`preparation-verification.json`：完整新输入、16k转换、增益、源与PCM独立核验。
- `source-asr.json`、`source-asr-guard/receipt.json`、`prompt-verification.json`：新原文及原始资源样本检查。
- `design.json`、`guarded-yui-reference-02.json`：参考整体变化、复用基准和实际单条生成清单。
- `generation/audio/yui-reference-02/japanese-paragraph/take-001/receipt.json`、`guard-yui-reference-02/summary.json`：真实生成参数、输入输出、日志与资源保护。
- `generated-asr.json`、`generated-asr-guard/receipt.json`：生成内容检查与资源保护。
- `generation-verification.json`：新prompt、完整127／127patches、参数和模型身份、3套guard及ASR输入身份的独立核验。
- `package-receipt.json`、`delivery-verification.json`：新旧试听、参考标注、固定增益及旧资产保持。

沿用用户已授权的低启动线及50ms／1.5GiB运行保护；模型串行，未改系统、生产profile、用户原文件或旧交付物。
