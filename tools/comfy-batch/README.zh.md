# ASMR 视频批跑器

使用 Python 标准库调用已运行的 ComfyUI，不需要安装 pip 包。双击 `run.bat` 打开窗口，选择**解压后的项目文件夹**、角色参考图、ComfyUI 地址和每镜候选数 N 后开始；窗口在后台执行任务。项目中已有角色图时可直接使用，也可在窗口替换。没有 Tk 的 Python 可使用下方命令行。

运行前需要：Python 3.10+、FFmpeg，以及能手动运行 H3 的 ComfyUI 环境。程序不会安装节点、下载模型或启动 ComfyUI。默认地址是 `http://127.0.0.1:8188`。FFmpeg 优先使用命令行/窗口指定路径，其次查找 PATH 和已有的 `imageio_ffmpeg`，不会自动安装。

## 更新已有项目包

先关闭旧批跑器，再将更新包中的 **`runner.py`、`run.bat`、`README.zh.md` 三个文件**覆盖到旧项目解压目录。保留 `project.json`、`workflow_api.json`、全部素材及整个 `outputs/`，尤其不要删除 `run-state.json`。更新包不含工作流，不覆盖你已经调整的工作流。

第一次继续运行时，旧 version 1 状态会自动备份为 `run-state.v1-backup-*.json`，再迁入候选 1；输入保持不变时，已有成功结果不会因升级重新生成，未确认任务先对账。继续同一批时将 N 设为原值；改成其他 N 时按补缺／保留规则处理。新导出的完整项目包仍携带运行器、启动器、说明和工作流四个运行文件。

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

所有素材路径均相对项目目录。`characterReference` 可省略，执行时另选角色图。对白使用实际 WAV 时长，`durationSeconds` 不裁掉原对白；相同输入 WAV 同时用于 H3 参考与最终视频音轨。环境镜头没有输入音频，使用 H3 生成的环境音，最终画面和声音同步裁到指定时长且最长 5 秒。

`workflow_api.json` 是干净的 API 模板，源自 `asmr04`，保留 H3 模型、20 步和原加速链。默认 1216×672、24 fps。每镜直接注入最终提示词，角色图是 Picture 1；连续镜头的候选 k 使用相邻上一镜候选 k 成功输出的实际尾帧作为 Picture 2。该候选不存在或失败就用角色图继续，不跨镜借帧，也不改用其他候选。尾帧提取由 FFmpeg 完成，不依赖 CLF、ttN 或 ResolutionSelector。首帧延续仍属于 H3 的参考引导，不保证逐像素一致。

## 命令行

```bat
python runner.py "I:\我的项目" --comfy-url http://127.0.0.1:8188
python runner.py "I:\我的项目" --character-image "I:\角色.png" --ffmpeg "C:\tools\ffmpeg.exe"
python runner.py "I:\我的项目" --dry-run
python runner.py "I:\我的项目" --only shot_2,003
python runner.py "I:\我的项目" --rerun shot_2
python runner.py "I:\我的项目" --candidates 3
python runner.py "I:\我的项目" --candidates 3 --rerun-candidates "shot_2:2,003:1"
python runner.py "I:\我的项目" --candidates 3 --job-timeout 0 --concat
python runner.py "I:\我的项目" --concat
```

`--candidates` 是每镜候选数，默认 1，须为正整数。增加 N 只补缺少的候选，减少 N 保留已有文件；相同输入和候选号继续使用稳定种子。旧版单候选状态自动接入候选 1，不因此重新生成。`--only` 和 `--rerun` 接受逗号分隔的镜头 ID 或 `order` 编号；前者只处理指定镜头，后者重做指定镜头的本次候选。`--rerun-candidates` 只重做指定候选，例如 `shot_2:2,003:1`。镜头 ID 含冒号时按最后一个冒号分隔，例如 `scene:two:2` 表示镜头 `scene:two` 的候选 2。所有重做都先对账已有未确认任务。

`--dry-run` 只读取本地素材、计算时长并保存每镜候选 API payload，不连接 ComfyUI、不执行模型，也不要求 FFmpeg；未提供角色图时保留明确占位值。`--width`、`--height`、`--seed`、`--retries` 可覆盖默认值，详见 `--help`。生成数量约为镜头数 × N；原音文件保持每镜一份，不随候选数复制成多个声音版本。

最终视频、原始视频、原音快照、尾帧、提交 payload 和原子保存的 `run-state.json` 默认保存在**项目文件夹内的 `outputs/`**，可用 `--output-root` 指定其他目录；程序不依赖开发机的盘符。每个镜头的每个候选独立记录任务身份和结果。相同输入已成功的候选会跳过；修改单镜输入只更新该镜，不传播到后镜。连续参考只认相邻上一镜的同号候选，缺失时自动按独立镜头继续。整批继续执行，不进行质量审核或人工确认。

可在窗口勾选生成顺序预览片，或添加 `--concat`。每个候选号分别检查全部镜头，只有该号每一镜都有与当前输入一致、文件完整的成功结果才合片，不缺镜拼接、不套用工程时间线或等待。N=1 保持 `outputs/preview.mp4`；N>1 输出 `outputs/preview-c001.mp4`、`preview-c002.mp4` 等。同号中有缺镜时只跳过该条预览，其他完整候选号可以正常合片。预览将每镜按目标帧数和音频样本数裁齐、重建从零开始的时间戳，再统一编码为 H.264 与 AAC 48 kHz 立体声，避免 AAC 编码填充造成镜头间额外等待或重复画面；已有单镜文件不变。合片错误保留已有预览，不触发模型重做；结果未变化时跳过重复合片。

Windows 启动器优先使用环境变量 `COMFY_PYTHON` 指定的 Python，其次验证 `py -3` / `python` 的版本。若 ComfyUI 便携包自带 Python 不在 PATH，可直接执行 `"X:\ComfyUI_windows_portable\python_embeded\python.exe" runner.py`，或将 `COMFY_PYTHON` 设为该可执行文件完整路径。程序不会下载或安装 Python。

提交前先保存任务身份和 payload，获得 `prompt_id` 后立即落盘。断网、超时、提交响应丢失时，通过 `/history` 和 `/queue` 对账；无法确认的任务标记 `unknown`，继续下一镜，**不会盲目重复提交**。再次运行会先恢复这些任务。只有明确失败的任务才作有限技术重试，默认重试 1 次；已耗尽的失败任务可用 `--rerun` 重做。对仍无法确认的任务，`--rerun` 也不会绕过对账。

已确认生成成功时会保存远端输出位置和原片 SHA。原片已完整下载时，即使 ComfyUI 离线或已清除 history，也可直接继续本地封装；需要重新下载时沿用已确认的输出位置，不重新跑模型。这里按视频任务恢复，不恢复模型采样到一半的计算；远端输出也丢失且本地原片不完整时会保留待恢复状态。

技术重试沿用该候选的 seed；明确重做会换 seed，并保留旧结果和回执历史。若本次先恢复了未确认任务，得到的同输入结果会先保留，不在恢复后立即再抽一次；需要另抽时再次明确重做即可。

提示词、基础 seed 等输入改动后再改回原值时，会校验并复用相同输入的完整历史结果；想重新抽取须明确重做。基础 seed 与历史任务碰撞时会自动分配稳定的新种子。已有成片被外部修改而无法复用时，恢复封装或新生成均另存，不覆盖保留的旧文件。

## 等待、进度与停止

窗口显示当前镜头／候选、远端阶段、完成数和用时。状态心跳默认每 15 秒一次；即使单次 HTTP 请求仍在等待，窗口自己的计时器也会继续刷新。后台队列和日志显示有数量上限，长批次不会无限积累界面日志。

最长任务等待默认 **0，表示健康连接时不设总时限**，不会仅因生成超过一小时就重发。窗口单位为分钟，命令行 `--job-timeout` 单位为秒；设为正数表示只限制本地等待，到时保留任务身份，下次对账继续。单次 HTTP 请求超时用 `--request-timeout`，默认 30 秒；已提交任务等待／对账期间，持续断线达到 `--disconnect-timeout`（默认 300 秒）后记为待恢复并继续后续任务。提交前节点预检的网络错误则报告该候选输入错误并继续，不消耗这段断线等待。`--heartbeat-interval` 可调状态心跳间隔。网络超时、排队和模型技术失败分别记录，无法确认的提交不会作为失败任务自动重试。

点击「停止后续提交」会停止本地后续提交和等待，保留已提交任务身份；它不调用 ComfyUI 的全局 interrupt，远端已提交任务继续运行。重新打开同一项目会先对账恢复。关闭运行中的窗口会说明这一点；命令行按 Ctrl+C 也会给出恢复提示并返回退出码 130。单次 HTTP 正在阻塞时，停止请求会在该请求结束或请求超时后生效。

状态里的素材快照、payload 和输出路径相对于 `outputs` 保存。移动或复制项目时保留整个 `outputs/`，即可在新目录继续；使用外置 `--output-root` 时也应完整搬走该输出目录并指定它。临时缺少输入 WAV 会单独报告 `input_error`，保留已成功任务的回执；恢复文件后不会因此重复生成。

程序通过 `/object_info` 检查所需节点，并使用 `/upload/image` 的普通文件上传接口上传角色图、音频和尾帧；音频上传字段同样叫 `image`。若远端反向代理限制上传大小或类型，需要先调整该服务配置。输出从 SaveVideo 节点 26 的结果读取，经 `/view` 下载，再使用 FFmpeg 对齐最终音画；对白完整保留，视频最多增加不足一帧的尾部空间，输出编码不承诺 WAV 字节不变。

## 测试

```bat
python -m unittest discover -s tools/comfy-batch -p "test_*.py" -v
```

测试使用本地模拟 HTTP 服务和合成的小 WAV，不调用模型。
