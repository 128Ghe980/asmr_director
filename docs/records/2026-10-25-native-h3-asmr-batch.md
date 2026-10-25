# 2026-10-25 — H3 原生 ASMR 12 类触发音批跑包

> 2026-10-26 存储修正：下文的 I:/temp 输出位置是历史记录，已迁移。当前自定义时长包位于 `I:/AI/asmr_director/artifacts/h3-asmr/H3-ASMR-12-custom-duration.zip`；证据位于项目 `qa/h3-asmr/`，旧版 ZIP 位于 `archive/h3-asmr/`。原始 `I:/temp/文生视频.json` 保持只读。详见[整理记录](2026-10-26-project-storage-cleanup.md)及数据根 `storage-map.json`。

用户希望先验证 H3 直接生成 ASMR 的质量，并明确选择 12 种常见触发音；另明确指出工作流原有 prompt 不是参考对象。使用用户提供的 `I:/temp/文生视频.json`，仅复用模型、节点、参数；全部生成提示词按 MiniMax 官方 T2VA 三字段重新编写。Audio Quality V1 内增加此独立实验，不新增顶层路线，其他 SFX 模型工作仍暂停。

## 交付

- `I:/temp/H3-ASMR-12.zip`，解压后双击 `run.bat`；同名目录已有完整展开包。默认 12 类×1 候选，可设 N=2/3 生成 24/36 条。
- 12 类：木盒、玻璃杯、软刷、翻页、揉纸、棉布、梳齿、键盘、倒水、喷雾、皂片、细沙。各条附中文试听重点和全新英文提示词，无对白、配乐或输入参考素材。
- 共 21 个分发文件：项目清单、API 模板、原工作流追溯副本、提示词数据、运行器/启动器、三份说明和 12 份手动导入用工作流。原 prompt 只存在未改写的 `source_workflow.json` 备份中，不进入实际 API 模板、候选 payload 或手动触发音工作流。
- 沿用原 Ref2VA 16G 权重、20 步、全部加速参数、9:16 / 1 MP / multiple 32 和 24 fps；5 秒按原公式得到 124 帧，画面约 5.167 秒。原生音轨直接连接 H3 音频解码，无裁切、后配音或音频后处理。此实验不等同于官方未优化权重的质量评测。

## 实现

`tools/comfy-batch/runner.py` 为现有包 version 1 增加显式 `generationMode: "text-to-video"`，无需角色图/音频上传/CLF 尾帧节点。默认保留源分辨率连线，复用候选、种子、恢复、重试、停止和未知提交对账。旧包仍使用原参考逻辑、默认宽高和历史指纹；文生模式独立保存触发音片段，合片明确记不可用。GUI 可自动选择旁边的项目清单。

`prepare_asmr_batch.py` 仅转换此已知工作流结构，按 input.name/link 校验，不猜测任意 JSON。将 SaveVideo 24 规范为 26，折叠提示词和时长辅助节点，生成 19 节点 API 图。源文件的 4 处 target slot 已陈旧，以实际输入绑定解析并在派生手动工作流修正；原备份字节保持。拒绝写入已有非空目录。

设计：[中文](../specs/2026-10-25-native-h3-asmr-batch.zh.md) / [English](../specs/2026-10-25-native-h3-asmr-batch.en.md)。使用说明：[ASMR_BATCH](../../tools/comfy-batch/ASMR_BATCH.zh.md)；[完整提示词及官方依据](../../tools/comfy-batch/ASMR_PROMPTS.zh.md)。

## 验证与边界

证据根 `I:/temp/H3-ASMR-12-qa/`：

- Python 3.11 原运行器回归及新文生模式 **108/108 通过、无跳过**（含 11 新测试）；独立转换器 **13/13 通过**。首轮误用 PATH 的 Python 3.8，19 个旧测试因 `str.removeprefix` 不可用失败；切换项目要求的 3.11 后完整通过，没有为此修改旧测试。108 项结果以工具转录回执保存在 `runner-review.json`，明确不是原始 stdout 日志。
- 原网页真实 ZIP 导出→解压→新运行器验证 **1/1 通过、无跳过**，原 speech/ambient/continuous 路径及 N=2 均通过。`legacy-export-results.json` 与 `legacy-export/` 保留证据。
- 最终分发包 12×2 干跑生成 **24 payload、24 唯一种子**，逐项核对源模型/加速配置、分辨率连线、124 帧与音轨直连，确认旧 prompt 不出现。`native-dry-run/` 保存 payload。
- 最终分发运行器对本地模拟 ComfyUI 提交 24 任务全部成功；再次运行 24 条均复用，不增加提交，上传素材 0。`native-mock.log` 与 `mock-outputs/` 是模拟字节证据，未放入交付 ZIP，不冒充真实视频。
- 独立重建 19 节点 API 逐字段相等，12 手动工作流 prompt 和每条 link target slot 核对通过，原 JSON SHA 一致。ZIP CRC 通过、21 文件，133815 字节；哈希及各文件 SHA 在 `verification.json`。`verify_package.py` 保留核验过程；`runner-review.json` 保留独立审查。

本机未发现 8188/8000 ComfyUI 监听，本轮真实 H3 调用 **0**，没有实际试听或音画同步质量结论。目标机器须能运行原工作流，用户批跑后再试听。本轮不安装模型/节点、不启动或替换生产服务、不操作浏览器用户工程、不提交推送；常驻网页 3001 保持。当前修改集中于批跑工具和本说明，不混入工作区已有空间音频等其他工作。

## 同日追加 — 自定义每条时长

用户要求时长可以自定义。新版交付为 `I:/temp/H3-ASMR-12-custom-duration.zip` 及同名展开目录，原包保留。窗口新增独立一行「每条时长」，支持小数秒，留空读取项目逐镜 `durationSeconds`（内置默认 5 秒）；CLI 使用 `--duration-seconds`。覆盖只作用于本次文生模式镜头副本，不写回项目、工作流或用户 prompt，旧参考包拒绝此覆盖。改变时长按新输入生成并保留旧结果，改回可复用完整历史。

12 条内置提示词同步改为可重复的缓慢动作、短暂停顿和相对收尾，去掉固定 5 秒和总动作次数。打包器新增同名参数，优先级为全局覆盖→单触发音→数据顶层默认；取消源工作流必须 5 秒的限制。派生 API 首镜帧数和全部手动工作流时长节点同步，源 JSON 及其转换元数据仍记录原始时长。数值有限/正数及 `17n+5` 对齐后不超过 3600 帧均在提交前检查；5/8/10.5 秒分别得到 124/192/260 帧，实际时长在日志和干跑回执中显示。

追加验证根 `I:/temp/H3-ASMR-12-duration-qa/`：

- 17 专项包含于完整 **114 运行器测试通过、无跳过**，另 **22 转换器测试通过**；原始 stdout 日志为 `runner-focused-tests.log`、`runner-all-tests.log`、`builder-tests.log`，命令和源码哈希见 `runner-tests-receipt.json`。
- 真实隐藏 Tk 验证输入框空默认和独立第二行布局，证据 `runner-duration-gui.json`；新增时长不与候选数量或最长等待字段重叠。
- 最终新版包分别按默认 5 / 覆盖 8 / 覆盖 10.5 秒进行 CLI 干跑，合计 **72 payload**，帧数和原生音轨、原提示保留检查通过。10.5 秒打包另核对 API 和 12 条手动工作流，源时长元数据仍为 5 秒、源字节不变。
- 新版包对本地 mock 先生成 24 条默认时长，再生成 24 条 8 秒；切回默认时长复用原 24 条，提交总数保持 **48**，项目 SHA 不变，无素材上传。独立审查另外覆盖未知任务在改时长时先对账、旧结果成功后再生成新时长，无重复未知提交。
- 原网页真实 ZIP 导出→新版运行器集成 **1/1 通过、无跳过**，证据 `legacy-export-results.json` / `legacy-export/`。本轮仅重复受新增运行参数影响的接入测试，没有整站重建或部署。
- 新 ZIP **21 文件、137598 字节**，CRC 通过，原包未覆盖；各文件/源文件/压缩包 SHA、默认与覆盖帧数、mock 恢复结果在 `verification.json`，过程保留为 `verify_duration_package.py`。真实 H3 调用仍为 **0**，不把 mock 结果当成实际视频或听感验收。
