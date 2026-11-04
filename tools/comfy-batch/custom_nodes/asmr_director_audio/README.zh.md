# ASMR Director 音效节点

把视频项目包中 `custom_nodes/asmr_director_audio` 整个文件夹复制到目标
`ComfyUI/custom_nodes/`，使用该 ComfyUI 的 Python 安装本目录 requirements.txt
中缺少的依赖，然后重启 ComfyUI。已有依赖无需重复安装。无需额外启动服务，
运行批跑器的电脑无需安装 FFmpeg、音频处理库或模型。

例如便携版在其根目录运行：

```bat
python_embeded\python.exe -m pip install -r ComfyUI\custom_nodes\asmr_director_audio\requirements.txt
```

导出的节点目录已经附有本项目现有 D 算法和 HRTF，无需另下载。
源码仓库中的目录是适配层，需通过网页导出生成完整可安装目录。

`AsmrDirectorSpatialAudio` 在音效视频生成后，将它的音轨作为单个物体声源，
转为单声道后应用既有 D 的耳位、距离、移动和房间效果，输出 48 kHz 立体声。
原生音效视频独立保留。API 选择的音量只应用一次。输出与本段目标音频时长
一致，房间尾声截在本镜内，末端 12 ms 平滑淡出，避免音效跨到下一段。

新导出中标记 `role: "trigger"` 或 `"ambience"` 的声音使用
`AsmrDirectorBalancedSpatialAudio`，先以中性增益做 D 定位，再测量最终空间声的响度。
独立触发段基准为 −27 LUFS；伴随对白的触发声不高于 −34 LUFS，且通常比当前人声低
10 dB；安静环境基准上限为 −48 LUFS，伴随人声时进一步让位。目标不是对每次敲击做
自动压缩，而是整段两耳共用一个增益，保留轻重、停顿、瞬态和空间运动。

新模式的 `gainDb` 是角色基准上的微调：trigger 的 −12、ambience 的 −30 对应界面
0 dB；触发微调限 ±6 dB，环境为 −6 至 +3 dB。因此不会再把原本已归一的声音机械地
额外压低18或30 dB。触发声相对实际输入最多提升12 dB，极低电平不提升；环境声最终
不高于原始底声电平。两耳共同保护真峰值至 −2.1 dB，不能达到目标时优先保留峰值余量。
这些是统一的起始电平，不保证不同材质的主观响度完全相同，仍可用微调校正。

没有 `role` 的旧工程继续走旧节点和旧增益语义，既有合片缓存不变。在导出包的
`project.json` 中只标记用途或更改音量/空间设置，且音效 prompt 和时长保持不变时，
只重合 ASMR 版，不重生主视频或独立音效。网页选择新的用途后重新导出会更新
该用途的取音 prompt，因此对应音效会重生成；不要修改音效 prompt 来调音量。
新模式要求目标 ComfyUI 更新整个节点目录并重启。找不到新节点时明确停止增强合片，
保留原版和全部已生成片段，不会悄悄退回旧音量处理。

`AsmrDirectorMixAudio` 按样本从本段起点叠加处理后的音效，输出长度取原视频
本段音轨；超长音效截断，短音效尾部留空。只在叠加超过真峰值 0.98 时对两声道
共同衰减，不移动后续段落。原版合片仍单独保留。

HRTF: Viking HRTF Dataset v2, Spagnol, Miccini, Unnthorsson (2020),
CC BY 4.0, https://doi.org/10.5281/zenodo.4160401 。随包文件为当前配置的
`subj_A.sofa` 副本；数据未修改。D 使用测量 HRIR、近场近似和合成房间反射。
许可链接：https://creativecommons.org/licenses/by/4.0/ 。
