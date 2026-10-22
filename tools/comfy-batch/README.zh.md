# ASMR 视频批跑器

使用 Python 标准库调用已运行的 ComfyUI，不需要安装 pip 包。双击 `run.bat` 打开窗口，选择**解压后的项目文件夹**、角色参考图、ComfyUI 地址和每镜候选数 N 后开始；窗口在后台执行任务。项目中已有角色图时可直接使用，也可在窗口替换。没有 Tk 的 Python 可使用下方命令行。

运行前需要：本机 Python 3.10+，以及已经运行、能手动执行这套 H3 工作流的目标 ComfyUI。**本机不需要 FFmpeg、ffprobe、PyAV 或 pip 包**；媒体处理都在目标 ComfyUI 内完成。目标主机须已安装你在 `asmr04` 使用的 CLF 尾帧节点，并有对应原生视频、图像节点；环境镜头还需 `TrimAudioDuration`。程序会预检所需节点，不安装节点、下载模型或启动 ComfyUI。默认地址是 `http://127.0.0.1:8188`。

## 更新已有项目包

先关闭旧批跑器，再将更新包中的 **`runner.py`、`run.bat`、`README.zh.md` 三个文件**覆盖到旧项目解压目录。保留 `project.json`、`workflow_api.json`、全部素材及整个 `outputs/`，尤其不要删除 `run-state.json`。更新包不含工作流，不覆盖你已经调整的工作流。

第一次继续运行时，旧 version 1 状态会自动备份为 `run-state.v1-backup-*.json`，再迁入候选 1；输入保持不变时，已有成功结果不会因升级重新生成，未确认任务先对账。继续同一批时将 N 设为原值；改成其他 N 时按补缺／保留规则处理。新导出的完整项目包仍携带运行器、启动器、说明和工作流四个运行文件。

本次更新保留工作流模板及旧任务输入指纹、状态版本；不为新的裁帧方式重新制作已成功的旧视频。旧成功结果缺少尾帧 PNG 时，程序会将旧视频交给 ComfyUI 单独补取尾帧，并保存独立任务回执；不重新运行 H3。

## 项目包

解压后的目录含 `project.json`、`workflow_api.json` 和片段素材；`runner.py` 与 `run.bat` 可以随包复制。最小清单：

```json
{
  "format": "asmr-video-package",
  "version": 1,
  "projectId": "example",
  "title": "我的视频",
  "characterReference": "references/character.jpg",
  "workflow": "workflow_api.json",
  "shots": [
    {"id": "shot_1", "order": 1, "kind": "speech", "referenceMode": "new", "prompt": "本镜完整 H3 提示词", "durationSeconds": 3.2, "audio": "shots/001/audio.wav"},
    {"id": "shot_2", "order": 2, "kind": "ambient", "referenceMode": "continuous", "prompt": "画面和环境底噪描述，无对白和配乐", "durationSeconds": 5}
  ]
}
```

所有素材路径均相对项目目录。`characterReference` 可省略，执行时另选角色图。对白使用实际 WAV 时长，`durationSeconds` 不裁掉原对白；相同输入 WAV 同时用于 H3 参考与最终视频音轨，画面向上取整到完整的 24 fps 帧。环境镜头没有输入音频，使用 H3 生成的环境音；ComfyUI 内同时限制画面帧数和环境音长度，最终最长 5 秒。原音作为音轨来源，不表示 WAV 与编码后视频音轨的字节相同。

`workflow_api.json` 是干净的 API 模板，源自 `asmr04`，保留 H3 模型、20 步和原加速链。默认 1216×672、24 fps。模板原文件不改，运行时增加裁帧、CLF 尾帧和 PNG 保存分支；尾帧来自最终 `CreateVideo` 输出。每镜直接注入最终提示词，角色图是 Picture 1；连续镜头的候选 k 使用相邻上一镜候选 k 成功输出的实际尾帧作为 Picture 2。该候选不存在或失败就用角色图继续，不跨镜借帧，也不改用其他候选。首帧延续仍属于 H3 的参考引导，不保证逐像素一致。

## 命令行

```bat
python runner.py "I:\我的项目" --comfy-url http://127.0.0.1:8188
python runner.py "I:\我的项目" --character-image "I:\角色.png"
python runner.py "I:\我的项目" --dry-run
python runner.py "I:\我的项目" --only shot_2,003
python runner.py "I:\我的项目" --rerun shot_2
python runner.py "I:\我的项目" --candidates 3
python runner.py "I:\我的项目" --candidates 3 --rerun-candidates "shot_2:2,003:1"
python runner.py "I:\我的项目" --candidates 3 --job-timeout 0 --concat
python runner.py "I:\我的项目" --concat
```

`--candidates` 是每镜候选数，默认 1，须为正整数。增加 N 只补缺少的候选，减少 N 保留已有文件；相同输入和候选号继续使用稳定种子。旧版单候选状态自动接入候选 1，不因此重新生成。`--only` 和 `--rerun` 接受逗号分隔的镜头 ID 或 `order` 编号；前者只处理指定镜头，后者重做指定镜头的本次候选。`--rerun-candidates` 只重做指定候选，例如 `shot_2:2,003:1`。镜头 ID 含冒号时按最后一个冒号分隔，例如 `scene:two:2` 表示镜头 `scene:two` 的候选 2。所有重做都先对账已有未确认任务。

`--dry-run` 只读取本地素材、计算时长并保存每镜候选 API payload，不连接 ComfyUI、不执行模型；未提供角色图时保留明确占位值。`--width`、`--height`、`--seed`、`--retries` 可覆盖默认值，详见 `--help`。生成数量约为镜头数 × N；原音文件保持每镜一份，不随候选数复制成多个声音版本。

成品视频、原字节下载缓存、原音快照、尾帧、提交 payload 和原子保存的 `run-state.json` 默认保存在**项目文件夹内的 `outputs/`**，可用 `--output-root` 指定其他目录；程序不依赖开发机的盘符。每个镜头的每个候选独立记录任务身份和结果。相同输入已成功的候选会跳过；修改单镜输入只更新该镜，不传播到后镜。连续参考只认相邻上一镜的同号候选，缺失时自动按独立镜头继续。整批继续执行，不进行质量审核或人工确认。

可在窗口勾选「由 ComfyUI 合并顺序预览」，或添加 `--concat`。每个候选号分别检查全部镜头，只有该号每一镜都有与当前输入一致、文件完整的成功结果才合片，不缺镜拼接、不套用工程时间线或等待。N=1 保持 `outputs/preview.mp4`；N>1 输出 `outputs/preview-c001.mp4`、`preview-c002.mp4` 等。同号中有缺镜时只跳过该条预览，其他完整候选号可以正常合片。

合片由目标 ComfyUI 的 `LoadVideo`、`ConcatenateVideo`、`SaveVideo` 等节点完成。每镜通过已有 `CLFLoadVideoTailFrames` 实测总帧数，按本包固定 24 fps 计算时长；原生 `LoadAudio`、`EmptyAudio`、`AudioMerge`、`AudioConcat` 将各镜声音补齐或裁到各自画面时长，再作为完整预览音轨，避免短音轨使后镜声音提前。预览会编码音轨，不承诺字节无损；已有单镜成品不变。合片另有独立提交与恢复回执，错误保留已有预览，不触发 H3 重做；结果未变化时跳过重复合片。

**可选合片需要目标 ComfyUI 已有对应原生节点，包括 `ComfyMathExpression`；不是所有版本都有。**缺少这些可选能力时，预览记为 `unavailable`，逐镜成品仍保留。某镜无可解码音轨或合片技术失败时，仅报告预览失败；程序不安装其他节点包作为替代。目标环境首次实际运行前，节点预检通过不等于已经验证其视频编码效果。

Windows 启动器优先使用环境变量 `COMFY_PYTHON` 指定的 Python，其次验证 `py -3` / `python` 的版本。若 ComfyUI 便携包自带 Python 不在 PATH，可直接执行 `"X:\ComfyUI_windows_portable\python_embeded\python.exe" runner.py`，或将 `COMFY_PYTHON` 设为该可执行文件完整路径。程序不会下载或安装 Python。

提交前先保存任务身份和 payload，获得 `prompt_id` 后立即落盘。断网、超时、提交响应丢失时，通过 `/history` 和 `/queue` 对账；无法确认的任务标记 `unknown`，继续下一镜，**不会盲目重复提交**。再次运行会先恢复这些任务。只有明确失败的任务才作有限技术重试，默认重试 1 次；已耗尽的失败任务可用 `--rerun` 重做。对仍无法确认的任务，`--rerun` 也不会绕过对账。

已确认生成成功时会保存远端输出位置和原片 SHA。原片已完整下载时，即使 ComfyUI 离线或已清除 history，也可直接继续按原字节保存成品；需要重新下载时沿用已确认的输出位置，不重新跑模型。尾帧缺失时需连接 ComfyUI 补取，独立对账且不重复生成视频。这里按视频任务恢复，不恢复模型采样到一半的计算；远端输出也丢失且本地原片不完整时会保留待恢复状态。

技术重试沿用该候选的 seed；明确重做会换 seed，并保留旧结果和回执历史。若本次先恢复了未确认任务，得到的同输入结果会先保留，不在恢复后立即再抽一次；需要另抽时再次明确重做即可。

提示词、基础 seed 等输入改动后再改回原值时，会校验并复用相同输入的完整历史结果；想重新抽取须明确重做。基础 seed 与历史任务碰撞时会自动分配稳定的新种子。已有成片被外部修改而无法复用时，恢复保存或新生成均另存，不覆盖保留的旧文件。

## 等待、进度与停止

窗口显示当前镜头／候选、远端阶段、完成数和用时。状态心跳默认每 15 秒一次；即使单次 HTTP 请求仍在等待，窗口自己的计时器也会继续刷新。后台事件队列有数量上限；日志跟随底部时保留最近约2000行，选取或向上查看期间暂缓裁去旧行。

日志可用「复制全部日志」「复制选中」、右键菜单或日志区的 Ctrl+A／Ctrl+C 复制；新日志不抢已有选区，手动向上查看时不强制滚回底部。

最长任务等待默认 **0，表示健康连接时不设总时限**，不会仅因生成超过一小时就重发。窗口单位为分钟，命令行 `--job-timeout` 单位为秒；设为正数表示只限制本地等待，到时保留任务身份，下次对账继续。单次 HTTP 请求超时用 `--request-timeout`，默认 30 秒；已提交任务等待／对账期间，持续断线达到 `--disconnect-timeout`（默认 300 秒）后记为待恢复并继续后续任务。提交前节点预检的网络错误则报告该候选输入错误并继续，不消耗这段断线等待。`--heartbeat-interval` 可调状态心跳间隔。网络超时、排队和模型技术失败分别记录，无法确认的提交不会作为失败任务自动重试。

「停止」按钮位于窗口上方、ComfyUI 地址下的「开始 / 继续整批」旁。运行中可点，点击后立即显示「正在停止…」，停止本地后续提交和等待，保留已提交任务身份；它不调用 ComfyUI 的全局 interrupt，远端已提交任务继续运行。当前网络请求结束或超时后退出等待，完成后可点「开始 / 继续整批」恢复；停止过程中到达的旧进度不会覆盖停止提示。关闭运行中的窗口会说明任务恢复规则；命令行按 Ctrl+C 也会给出恢复提示并返回退出码 130。

状态里的素材快照、payload 和输出路径相对于 `outputs` 保存。移动或复制项目时保留整个 `outputs/`，即可在新目录继续；使用外置 `--output-root` 时也应完整搬走该输出目录并指定它。临时缺少输入 WAV 会单独报告 `input_error`，保留已成功任务的回执；恢复文件后不会因此重复生成。

程序通过 `/object_info` 检查所需节点，并使用 `/upload/image` 的普通文件上传接口上传角色图、音频、尾帧及需要补尾帧／合片的旧视频；上传字段均叫 `image`。若远端反向代理限制上传大小或类型，需要先调整该服务配置。输出从 SaveVideo 节点 26 的结果读取，经 `/view` 下载并按原字节保存，本机不再进行媒体封装或编码。目标 ComfyUI 的 PyAV／编码库仍属于其自身环境，无需安装到运行器本机。

## 测试

以下命令在开发仓库根目录运行；三文件更新包不携带测试源码。

```bat
python -m unittest discover -s tools/comfy-batch -p "test_*.py" -v
```

测试使用本地模拟 HTTP 服务和合成的小 WAV，不调用模型。
