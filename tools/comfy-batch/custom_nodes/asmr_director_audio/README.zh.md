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

新批跑器对材质触发音和安静环境使用 `AsmrDirectorBalancedSpatialAudioV2`。
它先做 D 空间定位，再调节音效。独立触发和伴随对白的触发共用 −32 LUFS 默认基准。
有已后处理的人声时，触发声以接近人声为目标，通常在其上下 4 LU 内，可以略高或略低。
为保持跨段听感，人声基准限制在 −42 至 −22 LUFS。安静环境使用较轻的 −48 LUFS 基准。
这些是节点的调音默认值。整段两耳共用一个增益，敲击之间的力度差别和停顿会保留。

连续动作接入上一段已处理的触发音 `previous_trigger_audio`。
节点比较前段末尾和后段开头各三秒内实际发声的短窗，匹配接续的敲击力度；
当前段与上一段的响度微调设置不同时，还会应用两段设置的差值。
如果按敲击匹配后与人声距离仍较远，最多修正 2 dB，以免刚开始说话时敲击突变。
两侧没有可测的接触声时使用本段的常规响度目标。无台词段也可以通过
`use_voice_reference` 使用下一段采用的人声来选择自身基准。

新模式的 `gainDb` 是角色基准上的微调：trigger 的 −12、ambience 的 −30 对应界面
0 dB；触发微调限 ±6 dB，环境为 −6 至 +3 dB。因此不会再把原本已归一的声音机械地
额外压低18或30 dB。触发声相对实际输入最多提升12 dB，极低电平不提升；环境声最终
不高于原始底声电平。两耳共同保护真峰值至 −2.1 dB，不能达到目标时优先保留峰值余量。
这些是统一的起始电平，不保证不同材质的主观响度完全相同，仍可用微调校正。

节点目录仍提供 `AsmrDirectorBalancedSpatialAudio` 和 `AsmrDirectorSpatialAudio` 供旧工作流使用。
在目标 ComfyUI 更新整个节点目录并重启，才可执行 V2 工作流。动作接续段的音效会送入
H3 作为动作时间参考，所以更改它的响度或空间设置时，批跑器也会更新使用该参考的画面。

`AsmrDirectorMixAudio` 按本段起点叠加音效，长度以主音轨为准。
新工作流启用 `preserve_base`。已后处理的人声按原增益混入，叠加可能超过真峰值 0.98 时，
仅为音效分配可用余量。这个保护也用于提供给 H3 的伴随音效参考。

HRTF: Viking HRTF Dataset v2, Spagnol, Miccini, Unnthorsson (2020),
CC BY 4.0, https://doi.org/10.5281/zenodo.4160401 。随包文件为当前配置的
`subj_A.sofa` 副本；数据未修改。D 使用测量 HRIR、近场近似和合成房间反射。
许可链接：https://creativecommons.org/licenses/by/4.0/ 。
