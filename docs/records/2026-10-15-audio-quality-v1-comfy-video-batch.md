# 视频项目包与独立批跑器开发记录

日期：2026-10-15。父路线：Audio Quality V1（进行中；SFX 主线仍暂停）。当前状态：初版本地实现与验证完成，生成主机 H3 实测及真实浏览器视觉验收尚未完成。

## 用户确认与设计

用户确认导出便携项目包，在另一台主机的 ComfyUI 上自动完成整批视频。取消连续镜头质量依赖链、人工逐镜确认、级联作废和现有工程时序；保留顺序、尾帧参考及失败降级。每镜仅一份已选音频，无全局声音约束。角色图可替换，爱哥图只用于本轮测试。无对白镜头不超过 5 秒，DeepSeek 根据前后镜头准备简单环境底噪描述，最终使用 H3 生成的环境声。

基线为用户 `I:/temp/asmr04.json`，已核对有对白 CreateVideo 直接使用 LoadAudio，参考音频同时送入 H3。[中文设计](../superpowers/specs/2026-10-15-comfy-video-batch.zh.md) / [English](../superpowers/specs/2026-10-15-comfy-video-batch.md) / [实施计划](../superpowers/plans/2026-10-15-comfy-video-batch.md)。

## 工作区边界

基线 HEAD 为 `1f0d651`。已有未提交空间工作台、渲染、共享配置及上次清理／交接文档保留。本轮不提交或推送、不替换 3001 服务、不调用 TTS／ASR／付费 DeepSeek 或远端 H3；私人图片和音频不提交仓库。源码在 D，较大 QA 证据在 `I:/AI/asmr-director-video-batch/2026-10-15`。

## 实现及验证

### 已实现

- `video-package.ts`、`local-video-package.ts` 和 `/api/assets/video-package`：检查全部镜头各自来源，不沿前镜链阻断；一镜一份已采用PCM WAV、按真实文件时长生成提示词、无工程等待；可选可替换参考图、便携清单和运行程序。旧下载令牌负责流式下载和清理，预检错误不静默漏镜。
- “批量下载 → 视频包”：当前页项目快照、可选角色图、缺素材段号、取消与迟到结果保护；重开面板仍明确显示已选图片。无全局声音映射或双版本导出。
- `ambientSound` 可选字段及编辑、DeepSeek空镜分镜：看前后镜头文字，固定使用已配置外部API，无输入WAV，生成自然环境底噪描述，无对白／配音／BGM；新生成／导出限制≤5秒。旧工程保持可加载，不偷偷改时长或分镜。
- `tools/comfy-batch/`：单文件Python运行器、Tk窗口／CLI、清理过的04 API模板和Windows启动器。默认使用项目内outputs，无开发机盘符依赖；原音封装、环境音封装、尾帧提取、有限技术重试、已提交任务对账恢复、单镜重做。状态路径相对化，移动项目后可继续；临时缺失输入不抹掉成功回执。运行原音快照用于已提交任务恢复，不是第二种声音版本。可选`--concat`／窗口复选框仅在全部镜头有效成功后生成顺序预览片，单镜文件保持；预览逐镜按目标帧／样本数修整、重建PTS并统一编码，避免AAC段间padding造成额外帧。

### 验证证据

证据根：`I:/AI/asmr-director-video-batch/2026-10-15/qa`。

- `node node_modules/vitest/vitest.mjs run --maxWorkers=4`：**143文件通过／2文件跳过，1863项通过／4项既有跳过**；包含可选启用的真实ZIP→Python干跑测试。此数字来自当前共享工作树，含另一会话未发布空间代码，不是选定发布树验证。`full-tests-4workers.log`。
- 完整TypeScript `--noEmit --incremental false`、源码ESLint `eslint src`通过；日志为`typecheck.log`、`source-eslint.log`。
- WASM/Webpack正式构建通过，新build为`VBSBCGexY9eqEgRfcxnGX`，输出位于I盘、D仅junction。首次构建漏设跨盘`NODE_PATH`导致page-data找不到Next runtime，按现有运行约定补齐后通过；`build.log`保留失败，`build-2.log`为成功。不修改业务代码规避环境问题。
- 首次默认高并发全测与构建并行时，4项既有时间敏感测试失败；构建结束后按既有约定限制4workers全量通过，未放宽测试超时或业务保护。失败日志`full-tests.log`保留。
- Python运行器**22项**模拟HTTP／合片测试通过，覆盖原音／生成音频路由、5秒、相邻尾帧及失败降级、未知提交不重发、单镜变化不传播、移动目录和输入短暂缺失恢复，以及合片帧数／样本数／PTS重建；实际Windows `cmd run.bat --help`通过。详见`python-runner-tests.log`及源码测试。此前批处理换行错误产生的已确认0字节`(3`副产物已精确删除，最终启动器为CRLF。
- 实际导出ZIP→解压→包内Python `--dry-run`通过：2个人声合成测试WAV＋1个5秒环境镜头，原始WAV实长0.31／0.45秒，清单没有工程等待或机器路径。使用用户提供图片验证可替换参考，不调用H3；`portable-smoke-*/smoke-evidence.json`。
- 最终独立程序压缩包为`I:/AI/asmr-director-video-batch/2026-10-15/asmr-comfy-batch-runner.zip`，包含4个运行文件（无私人媒体、模型或密钥）；CRC及源码逐字节核对通过，SHA见`runner-package-evidence.json`。完整项目导出会把同样4文件连同镜头素材放在ZIP根。
- 临时3006正式服务真实POST multipart→token GET→CRC／原WAV与参考图字节→令牌不可复用通过，3镜／2份WAV／191553字节，`http-evidence.json`、`synthetic-http-package.zip`。该ZIP是合成测试包，不能当正式人声或H3成片。测试服务已核验PID后停止。
- 实际FFmpeg媒体验证通过：最终对白与输入原音相关系数0.999949，完整原音sample覆盖，拒用测试原视频中不同频率声音；环境输出解码120帧／5.0秒，短于2秒视频也能提取尾帧；8帧对白＋120帧环境的顺序预览默认解码精确128帧，单镜SHA保持。初始stream-copy拼接即使显式duration仍因AAC时基得到129帧，已改为仅预览filter重建PTS统一编码并实际复验通过。`media-smoke/evidence.json`。环境测试声是合成夹具，不是H3质量验收。
- 浏览器工具初始化报`failed to write kernel assets ... os error 3`，未取得截图；没有绕过既有浏览器限制或借旧截图宣称本次布局验证。界面以组件交互测试验证，桌面／390px真实视觉验收待补。

### 运行与发布边界

3001保持原build `IuS6dk38Xq9OZB0CRWvbQ`，本轮最后只读HTTP200；没有把含未发布空间工作的新完整工作树部署到3001。临时3006仅使用独立合成素材，不改生产候选、音频或浏览器工程库。本轮未提交／推送。生成主机的真实节点兼容、H3口型／参考效果／环境声音质仍需在那台机器运行小批次验证，不能由模拟服务或FFmpeg夹具推断。

### 文档同步

已同步双语规格、实施计划、本记录、ROADMAP当前进度、AI_HANDOFF顶部、project-archive和应用／运行器README。沿用现有AGENT/ROADMAP/PROJECT_MANAGEMENT路由系统，不引入并行顶层路线。下一步是生成主机小批次联调与正式版本部署安排；SFX主线保持暂停。

### 后续用户授权发布

用户随后明确要求“记录一下，推一版”，因此上文“未提交／推送”是实现阶段快照。另建[发布记录](2026-10-15-audio-quality-v1-video-batch-release.md)，选定40文件并排除23个本地内容变化路径；独立发布树1827项Vitest／3跳过、22项Python、类型／源码ESLint／正式构建及ZIP／FFmpeg检查通过。DeepSeek调用边界与用户报告API可能异常已补充记录，未在线调用或确认故障。真实Git提交及远端身份以Git及release-verification.json为准，3001仍不更新。
