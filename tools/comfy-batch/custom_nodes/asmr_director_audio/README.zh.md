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

`AsmrDirectorMixAudio` 按样本从本段起点叠加处理后的音效，输出长度取原视频
本段音轨；超长音效截断，短音效尾部留空。只在叠加超过真峰值 0.98 时对两声道
共同衰减，不移动后续段落。原版合片仍单独保留。

HRTF: Viking HRTF Dataset v2, Spagnol, Miccini, Unnthorsson (2020),
CC BY 4.0, https://doi.org/10.5281/zenodo.4160401 。随包文件为当前配置的
`subj_A.sofa` 副本；数据未修改。D 使用测量 HRIR、近场近似和合成房间反射。
