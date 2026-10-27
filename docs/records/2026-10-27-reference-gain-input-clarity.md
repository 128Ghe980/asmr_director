# 由比滨参考增益与雪之下输入清晰度

日期：2026-10-27（Asia/Hong_Kong）。承接 [CFG／步数对照](2026-10-27-cfg-timesteps-listening.md)，归属 Audio Quality V1；SFX 暂停、目标机 H3 待办保持。

## 本轮反馈与设计

用户已试听参数轮：雪之下 CFG2.5／10 与 CFG2／20 明显更好；由比滨 CFG2.5／10 稍好，但仍不够像。用户观察雪之下实际模型输入比降低音量后的原采样率预听版更糊，且由比滨实际输入更轻，要求提高由比滨参考音量并检查变糊原因；不能解决则明确说明，留给用户手工处理。

由比滨固定完整 23.82367 秒、combined／seed42／CFG2.5／10步及同一段日文原文、目标句，只改变参考增益。原电平基准直接复用上一轮 `yui-cfg2p5-step10`，不重新抽样。+3、+6 dB 都独立从原参考出发，无裁切、归一化、限制器、EQ 或补偿。用户 MP3 和基准原件哈希保持。

| 参考档位 | 实际输入 RMS | 峰值 | 新生成时长 | 进程耗时 |
| --- | --- | --- | --- | --- |
| 原电平 | −25.451 dBFS | −7.912 dBFS | 9.28 秒，复用 | 不重跑 |
| +3 dB | −22.451 dBFS | −4.912 dBFS | 9.44 秒 | 19.061 秒 |
| +6 dB | −19.451 dBFS | −1.912 dBFS | 9.44 秒 | 18.748 秒 |

雪之下减6dB参考 RMS 约 −19.74 dBFS，因此由比滨 +6 dB 已接近它的平均电平。这里的 RMS 是全段采样统计，不能直接当作听觉响度或相似度分数。两个增益版均完整保留 381179 个 16 kHz mono 采样点与 1050624 个原采样率 stereo 预听帧，零削波。

## 生成与内容检查

两次新增 GPU 生成均 take001／complete／exit0，48 kHz mono PCM16，零削波、未触及最大长度。沿用已获用户授权的低启动线，保留 50 ms／1.5 GiB 运行中保护；两次均未触发。使用既有低显存 CUDA Acoustic 配置，无 CPU TTS 回退或系统设置变化。

独立核验实际命令参数、参考两路149／149 patches、10步4462节点、CLI／模型／profile及请求、日志、输出哈希均通过。两次生成最低提交余量分别2.256／2.431GiB，ASR为2.209GiB；锁已释放，无残留Vox进程。

模型退出后另做一次串行受保护 ASR，两个结果均对应完整目标句，仅「温かい／暖かい」同音字写法差异。ASR 不能确认声线相似度、重音或噪感是否改善；本轮仍待用户试听。

## 雪之下变糊的可验证原因与边界

对同一连续 25.10 秒逐样本重现：原 16 kHz 输入能从保存的 float 解码源与记录的转换完全重现，减6dB版也完全重现。实际输入和预听版均只各衰减一次6dB，未混入高架滤波、额外降噪或错误文件；模型输入 RMS 反而比 stereo 预听高约0.297dB，没有额外被调轻。

L/R 相关系数约0.99587，算术平均转mono只损失约0.009dB能量，不支持严重相位抵消。补偿已知静态增益差后，0–7kHz各频段变化不足0.001dB；7–7.5kHz约−0.137dB，7.5–8kHz约−4.896dB，后者是抗混叠过渡带。原44.1kHz参考活跃帧约4.90%的频谱能量位于8kHz以上，转16kHz时必须舍弃。

官方 [VoxCPM2 模型卡](https://huggingface.co/openbmb/VoxCPM2#model-details) 标明 AudioVAE 是16kHz编码、48kHz解码。本地官方和原生源码与实际模型日志一致；已是16kHz mono时，原生编码入口不再重采样、额外低通、音量归一或降噪，只补零对齐后编码。上传44.1kHz文件也不能让该模型保留完整原始频带；原生高采样率输入还使用线性重采样，不能将直接送高采样率视为修复。

因此，本轮没有发现需要修复的转码错误，也没有真正解决模型输入丢失高频的限制。已确认的频带变化可以解释部分明亮度差异，不能据此断言全部“糊感”或相似度不足的根因。没有制作伪称“已恢复高清”的雪之下新生成。手动处理可以改变16kHz可容纳频带内的听感，但仍会受同一带宽限制，是否改善生成需要下一轮实测。

## 证据入口

交付页：`I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/japanese/input-clarity/index.html`。主区为由比滨原电平、+3、+6三条生成结果；分别保留实际参考原始音量和原生输出下载。生成试听只加整条固定增益到约−23LUFS，不加后处理；完整原基准直接复用。

折叠区为雪之下44.1kHz stereo→44.1kHz算术平均mono→现有16kHz mono三阶段，各自仅静态增益匹配响度。全长25.10秒及预期帧数保持，中间mono平均误差不超过0.5个PCM24量化单位，另附实际16kHz输入原音量下载。15个本地链接、77项旧资产哈希、生成试听和诊断试听的逐样本增益核验通过，无削波，未打开浏览器，不冒称已主观试听。

QA：`I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27/input-clarity/`。

- `yui-gain-preparation.json`、`yui-gain-design.json`：静态增益、完整帧数、源与参考身份、基准复用。
- `guarded-yui-gain-plus3.json`、`guarded-yui-gain-plus6.json`：真正执行的单条清单。
- `generation/audio/<id>/japanese-paragraph/take-001/receipt.json`、`guard-<id>/summary.json`：真实命令、模型、输出及内存保护。
- `generated-asr.json`、`generated-asr-guard/receipt.json`：日文内容与输入身份。
- `diagnosis.json`：逐样本复现、相位、频谱、重采样响应、本地官方／原生代码摘录。
- `generation-verification.json`：两新生成与复用基准的独立核验。
- `package-receipt.json`、`delivery-verification.json`：三档输出及三阶段诊断、固定增益、全长、全部链接和旧资产保持。

新脚本只用于本轮实验，不改产品默认设置或生产 profile，不部署、提交或推送。

## 2026-10-28 用户反馈与采样率澄清

用户听后认为由比滨只改善一点，语调更自然，但仍不像，可能重新制作参考。未指明+3或+6哪档获选，因此不擅自设定最终增益；保留已有结果，等新参考后继续。

再次核对官方当前源码：`_encode_wav` 通过 `librosa.load(wav_path, sr=self._encode_sample_rate, mono=True)` 在加载时自动转为编码采样率和mono；16kHz来自AudioVAE配置，并非仅建议用户预转换。我们的参考制作提前用FFmpeg做带抗混叠的16kHz转换，因此原生收到16kHz后走同采样率直通。原生高采样率输入路径也会内部转为模型采样率，两条转换算法不同，不保证逐采样一致；直接给44.1kHz不能绕过16kHz编码带宽。依据为[官方实现](https://github.com/OpenBMB/VoxCPM/blob/main/src/voxcpm/model/voxcpm2.py)及既有`diagnosis.json`的本地代码证据。本轮为代码核对和反馈留档，没有新增模型生成或修改参考。

实际EXE／CLI对象／修复版runtime SHA与既有构建回执一致。修复版`native-fixed/voxcpm2_runtime.cpp:1439`调用重采样，159–176行为线性插值与同采样率直通。标准44.1kHz PCM16 WAV可直接传入，不会仅因采样率报错；但本地CLI `voxcpm2_cli.cpp:250`只接受格式标记1、实际按int16读取。当前PCM24预听的标记65534会被拒绝，不能直接拿该预听文件证明44.1kHz不支持；浮点WAV也不支持。以上是代码与构建身份核对，未冒称完成44.1kHz真实模型试跑。
