# H3 原生 ASMR：12 种触发音试跑

这个包用 H3 同时生成画面与声音。解压后双击 `run.bat`，确认项目文件夹、ComfyUI 地址、「每镜候选数 N」和「每条时长」，点击「开始 / 继续整批」。**角色图留空**；包中每一镜就是一种独立触发音。

本机当前包位于 `I:/AI/asmr_director/artifacts/h3-asmr/H3-ASMR-12-custom-duration`；项目的新交付、验证和临时文件统一放在 `I:/AI/asmr_director/` 下。原始 `I:/temp/文生视频.json` 继续作为只读输入文件，不在 `I:/temp` 创建输出。

- N=1：12 个视频；N=2：24 个；N=3：36 个。
- 默认保持你提供的工作流：竖屏 9:16、ResolutionSelector 1 MP、24 fps、20 步及原有模型和加速链。
- 「每条时长」填写秒数，可用小数；留空按项目里每条的 `durationSeconds`，本包默认 5 秒。填 8、10 或 15 即以该时长生成本次选中的触发音。提示词采用慢速重复动作和短暂收尾，不再限定 5 秒或固定敲击次数。
- 原工作流会将时长对齐到合法帧数，实际画面时长可能略有差异，例如设 5 秒得到约 **5.17 秒**，8 秒得到 **8 秒**，10 秒得到约 **10.13 秒**。批跑器直接保存 H3 的原生成声音和视频，不另做降噪、空间化、配音或裁尾。
- 成品和恢复状态在包内 `outputs/`。数字前缀对应 `project.json` 的 `order`，`c001` / `c002` 对应候选。
- 增加 N 只补缺少的候选；继续同一批会跳过输入相同、文件完整的成功结果。停止后再次开始会先恢复已提交任务。
- 改时长会生成对应时长的新结果并保留旧结果；改回原时长可复用完整历史结果。窗口里的时长只影响本次运行，不回写项目文件。

在能手动运行原工作流的 ComfyUI 主机上运行即可。本机运行器只需 Python 3.10+ 标准库；便携 Python 可通过 `COMFY_PYTHON` 指定。无需角色图、参考声音或本机 FFmpeg。这一试跑模式不要求旧分镜包的 CLF 尾帧节点；逐条独立试听即可，不开启合片。

## 提示词和试听

`ASMR_PROMPTS.zh.md` 列出 12 类触发音、完整提示词、各自试听重点与官方来源。`project.json` 中的 `prompt` 是批跑器实际使用的文本；修改某条后，仅那一条会被当作新输入。想给每类设置不同时长，可分别修改各镜的 `durationSeconds`，运行时将「每条时长」留空。运行器不会擅自改写你手填的提示词；自行加入秒数或固定次数后，请保持文字与所选时长一致。

`workflows/` 内的单条界面工作流可直接拖入 ComfyUI 手动调试，是打包时的快照。它们不随批跑窗口或 `project.json` 的后续编辑自动更新；手动运行时，在 ComfyUI 的时长输入节点调整秒数。

提示词使用 MiniMax 官方 T2VA 三段结构：`integrated_multimodal_description` 写可见动作及同步发声，`overall_soundscape` 写声音材质、节奏和近距离听感，`non_diegetic_music: N/A` 表示无配乐。没有参考素材时不编造 Picture/Audio 编号。模型文件仍采用原工作流的 Ref2VA 权重；这是对该工作流无参考输入能力的实验，不等同于换成官方 FL2VA 权重的评测。

试听时先保持相同音量，比较声音材质是否可辨、动作与声音是否同步、是否出现杂音或人声、听起来是否舒适。近距离或立体声写入提示词只是生成目标，不保证双耳定位或实际 ASMR 体验。

## 命令行

在解压目录打开终端：

```bat
python runner.py . --candidates 1 --comfy-url http://127.0.0.1:8188
python runner.py . --candidates 3
python runner.py . --candidates 2 --duration-seconds 10
python runner.py . --only 1,2,3
python runner.py . --candidates 3 --rerun-candidates "1:2,4:1"
python runner.py . --dry-run --candidates 2 --duration-seconds 8.5
```

`--duration-seconds` 与窗口的「每条时长」相同，只用于文生视频；省略则逐条读取项目。数值必须有限且大于零，并符合工作流的帧数上限；干跑回执显示请求时长及对齐后时长。`--only`、`--rerun` 和 `--rerun-candidates` 也可以填触发音 ID。运行器的通用停止、对账和恢复说明见 `README.zh.md`；其中角色图、连续镜头、尾帧及 5 秒裁切说明适用于旧的参考分镜包，本包采用上面的原生声音规则。

## 在开发仓库重新打包

```bat
python tools/comfy-batch/prepare_asmr_batch.py "I:\temp\文生视频.json" --output "I:\AI\asmr_director\artifacts\h3-asmr\H3-ASMR-12-custom-duration"
python tools/comfy-batch/prepare_asmr_batch.py "I:\temp\文生视频.json" --output "I:\AI\asmr_director\artifacts\h3-asmr\H3-ASMR-12-10s" --duration-seconds 10
```

打包时长优先级：`--duration-seconds` 覆盖全部镜头，其次为提示词数据每类的 `durationSeconds`，再其次为数据顶层默认时长（本组为 5 秒）。生成的项目、API 模板和各条手动工作流都使用所选时长。

输出目录须为空或尚不存在。生成包同时保留原工作流 `source_workflow.json` 和转换后的 `workflow_api.json`，便于核对模型与参数。打包和 `--dry-run` 均不调用模型；声音质量需要在目标 ComfyUI 实际生成后试听。
