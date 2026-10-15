# ASMR 视频批跑器

使用 Python 标准库调用已运行的 ComfyUI，不需要安装 pip 包。双击 `run.bat` 打开简易窗口，选择**解压后的项目文件夹**、角色参考图和 ComfyUI 地址后开始；窗口在后台执行任务。项目中已有角色图时可直接使用，也可在窗口替换。没有 Tk 的 Python 可使用下方命令行。

运行前需要：Python 3.10+、FFmpeg，以及能手动运行 H3 的 ComfyUI 环境。程序不会安装节点、下载模型或启动 ComfyUI。默认地址是 `http://127.0.0.1:8188`。FFmpeg 优先使用命令行/窗口指定路径，其次查找 PATH 和已有的 `imageio_ffmpeg`，不会自动安装。

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

`workflow_api.json` 是干净的 API 模板，源自 `asmr04`，保留 H3 模型、20 步和原加速链。默认 1216×672、24 fps。每镜直接注入最终提示词，角色图是 Picture 1；连续镜头将相邻上一条成功输出的实际尾帧作为 Picture 2。尾帧提取由 FFmpeg 完成，不依赖 CLF、ttN 或 ResolutionSelector。首帧延续仍属于 H3 的参考引导，不保证逐像素一致。

## 命令行

```bat
python runner.py "I:\我的项目" --comfy-url http://127.0.0.1:8188
python runner.py "I:\我的项目" --character-image "I:\角色.png" --ffmpeg "C:\tools\ffmpeg.exe"
python runner.py "I:\我的项目" --dry-run
python runner.py "I:\我的项目" --only shot_2,003
python runner.py "I:\我的项目" --rerun shot_2
python runner.py "I:\我的项目" --concat
```

`--only` 和 `--rerun` 接受逗号分隔的镜头 ID 或 `order` 编号。`--dry-run` 只读取本地素材、计算时长并保存每镜 API payload，不连接 ComfyUI、不执行模型，也不要求 FFmpeg；未提供角色图时保留明确占位值。`--width`、`--height`、`--seed`、`--retries`、`--job-timeout` 可覆盖默认值，详见 `--help`。

最终视频、原始视频、原音快照、尾帧、提交 payload 和原子保存的 `run-state.json` 默认保存在**项目文件夹内的 `outputs/`**，可用 `--output-root` 指定其他目录；程序不依赖开发机的盘符。相同输入已成功的镜头会跳过；修改单镜输入只重跑该镜，不传播到后镜。连续镜头前一条失败或没有可用输出时，本镜自动按独立镜头生成，不跨过失败去借更早尾帧。整批逐镜继续，不进行质量审核或人工确认。

可在窗口勾选「全部镜头成功后生成顺序预览片」，或添加 `--concat`。只有全部镜头都有与当前输入一致、文件完整的成功结果，才按 `order` 直接拼成 `outputs/preview.mp4`；不套用工程时间线或等待，也不缺镜拼接。预览将每镜按目标帧数和音频样本数裁齐、重建从零开始的时间戳，再统一编码为 H.264 与 AAC 48 kHz 立体声，避免 AAC 编码填充造成镜头间额外等待或重复画面；已有单镜文件不变。合片错误保留已有预览，不触发模型重做；结果未变化时跳过重复合片。

Windows 启动器优先使用环境变量 `COMFY_PYTHON` 指定的 Python，其次验证 `py -3` / `python` 的版本。若 ComfyUI 便携包自带 Python 不在 PATH，可直接执行 `"X:\ComfyUI_windows_portable\python_embeded\python.exe" runner.py`，或将 `COMFY_PYTHON` 设为该可执行文件完整路径。程序不会下载或安装 Python。

提交前先保存任务身份和 payload，获得 `prompt_id` 后立即落盘。断网、超时、提交响应丢失时，通过 `/history` 和 `/queue` 对账；无法确认的任务标记 `unknown`，继续下一镜，**不会盲目重复提交**。再次运行会先恢复这些任务。只有明确失败的任务才作有限技术重试，默认重试 1 次；已耗尽的失败任务可用 `--rerun` 重做。对仍无法确认的任务，`--rerun` 也不会绕过对账。

状态里的素材快照、payload 和输出路径相对于 `outputs` 保存。移动或复制项目时保留整个 `outputs/`，即可在新目录继续；使用外置 `--output-root` 时也应完整搬走该输出目录并指定它。临时缺少输入 WAV 会单独报告 `input_error`，保留已成功任务的回执；恢复文件后不会因此重复生成。

程序通过 `/object_info` 检查所需节点，并使用 `/upload/image` 的普通文件上传接口上传角色图、音频和尾帧；音频上传字段同样叫 `image`。若远端反向代理限制上传大小或类型，需要先调整该服务配置。输出从 SaveVideo 节点 26 的结果读取，经 `/view` 下载，再使用 FFmpeg 对齐最终音画；对白完整保留，视频最多增加不足一帧的尾部空间，输出编码不承诺 WAV 字节不变。

## 测试

```bat
python -m unittest discover -s tools/comfy-batch -p "test_*.py" -v
```

测试使用本地模拟 HTTP 服务和合成的小 WAV，不调用模型。
