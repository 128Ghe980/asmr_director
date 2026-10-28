# 第一人称分镜与逐镜 ASMR 叠加

日期：2026-10-28（Asia/Hong_Kong）。用户要求继续交接，在保留旧 prompt 的基础上增加随剧情移动的第一人称分镜风格；每镜生成与当前音频等长的 ASMR 触发声音视频，包含无对白镜头；批跑器输出原版和音效叠加版，新增声音使用 API 选定的现有后处理效果。

所属固定路线 Audio Quality V1，阶段继续进行。本次授权的是 H3 剧情音效与视频产品链路；历史上暂停的其他 SFX 模型选型/质量实验不自动恢复，不新增顶层路线。

## 实现

- 创意与当前工程分镜区提供「角色展示（原风格）」及「第一人称 · 跟随剧情」。模板固定自己的风格；旧模板默认原风格。「禁令下的秘密交易」明确固定原风格。风格随 brief、采用、工程 JSON 和两个语音工作区保存。当前工程换风格保留原分镜及已采用人声，只使相关分镜需要更新。
- 原风格 H3 主提示词保持。第一人称相机属于听者，随其真实走动、转头和落座变化，承接前镜位置/眼高/朝向；S1 移动不会拖着听者一起走。移除新风格下始终拍到角色嘴部的矛盾要求，允许剧情需要时画外说话；S1 嘴部可见时仍同步原音。
- 每次有声/无对白分镜 API 同时生成 `asmrSound.prompt` 与 `postProcessing`，包括声源起终点、移动和增益。独立声音无对白、低语、人声或配乐；服务器包装 H3 文生三字段。主视频仍使用原人声/环境声。分镜侧可编辑声音和参数，校对预览/应用/撤回也覆盖声音对象。
- 视频包从实际导出 WAV 再测时长；整批已有有效人声后处理时，声音时长随真正导出的处理成品。空镜按自身时长及原视频帧对齐。旧分镜缺少声音规划仍可导出原版；界面显示声音规划齐备数，不伪造旧镜头音效。
- 运行器独立记录每镜/候选的 H3 音效任务，保留原视频指纹及旧成功结果。音效提示改变只重该音效；空间/音量改变只重新叠加合片。停止、未知提交对账、单镜失败及恢复沿用持久任务身份。
- 合片分别保存 `preview.mp4` 与 `preview-asmr.mp4`，多候选为 `preview-c001.mp4` 与 `preview-asmr-c001.mp4` 等。每段先处理/叠加再按原视频帧时长补齐并合并；不按段后等待移动声音，缺镜或缺同号音效不生成不完整叠加版。
- 随包附 `custom_nodes/asmr_director_audio`：复用已发布 `render-processed-voice.py` 与原 D 数学核心，附配置的 Viking SOFA。音效原生立体声作为单物体声源合为单声道后重新空间化，保留原生音效视频；处理结果截在段内并末端淡出，混音只超真峰时共同衰减。目标 ComfyUI 需安装该节点及缺少的 Python 依赖；运行器本机不用 FFmpeg、额外音频环境或新服务。

## 验证与证据

主 QA：`I:/AI/asmr_director/qa/storyboard/2026-10-28-pov-asmr/`。运行器与 ZIP QA：`I:/AI/asmr_director/qa/video-batch/2026-10-28/asmr-sound/`。D 节点测试临时目录在既有 `qa/native-video/audio-nodes/`。

- 后端 8 组 185 项通过；创意/UI 初组 87 项、后续 131 项、视频包 UI 7 项分别通过，分组有重叠，不相加。导出/编辑/校对定向首轮 70 通过、2 条新测试缺 jsdom 环境；补测试环境后相关 13 通过。未把测试基础设施错误记为产品故障。
- D 节点 7 项真实 CPU 测试通过，包括实际 SOFA 与原 D 数学一致、端点移动、时长、静音、混音帧对齐、重采样与真峰保护。没有 GPU/模型推理。
- 原/新网页 ZIP 两项实际解压与 Python 干跑通过：新案例 3 镜 × 2 候选得到 6 主视频及 6 纯声音 payload。包中引擎/HRTF 哈希一致；解压节点实际导入和真实 HRTF CPU 渲染通过。不是只构造 JSON 的单元测试。
- 真实文案 API 2 次业务/2 次上游调用，`deepseek-v4-pro`，无重试。6.25 秒合成 WAV 的门口→桌边镜，接 4 秒桌边俯视书页空镜；角色在画外、第一人称位置延续、两镜独立声音规划正确。伪声明 99 秒未覆盖实测时长。保存完整请求/响应、project、prompt、参数与审阅摘要；未上传用户音频。
- 隔离全量 Vitest 169 文件：2220 通过、1 旧 route fixture 未提供新增必填字段失败、4 条件跳过；补 fixture 后最终相关 3 文件 16 通过。未声称修后重跑整站。40 个变更 TS/TSX 文件 lint exit 0，保留一个旧 unused import warning。最终完整构建通过（含 TypeScript），build `uzuId3uS9hiHNo1x0nteD`。第一次构建仅在外置 `.next` 找不到依赖，设置既有 `NODE_PATH` 后成功，初次日志保留。
- 最终运行器 155 项完成，154 通过、1 条件跳过；新增单镜输入故障隔离、限定镜头恢复与 GUI 音效重跑均覆盖。既有后处理 Python 19 项通过；D 节点真实 CPU 7 项通过。
- 实际浏览器完成模板锁定、自由选择第一人称、有声/无对白音效编辑、静止端点同步及禁用、视频包 2/2 规划和双版说明；截图 `ui-template-lock.png`、`ui-asmr-speech.png`、`ui-asmr-silent.png`、`ui-dual-video-package.png`。测试仅使用独立 3037 origin 的合成工程，不修改用户 3001 工程。
- 编译后实际 HTTP 导出 POST `/api/assets/video-package` / GET token 均 200，20 文件 ZIP 3,119,903 字节；6.25 秒对白和 4 秒空镜，主轨/音效时长相同，原 WAV 字节保持；2 镜 × 2 候选得到 4 主/4 音效干跑 payload。解压后真实 SOFA CPU 渲染 14880 样本通过。包内 D 数学文件与隔离发布字节相同，与工作区及 HEAD 规范化文本相同（工作区 CRLF 差异）。证据 `http-export/verification.json`。

## 本地服务与交付

2026-10-28 05:43 HKT 已切换本地 `http://127.0.0.1:3001`。活动源码 `.local/releases/pov-asmr-overlay/apps/web`，build `uzuId3uS9hiHNo1x0nteD`，启动时 PID 25364（launcher 12848）。canonical `I:/AI/asmr_director/service/2026-10-16/start-production.ps1` 只更新发布目录，旧脚本保留在 QA `start-production.before.ps1`，旧隔离发布目录保留可回退。切换前无生成进程/运行锁；未改变模型、用户工程、参考或活动存储。

服务检查首页及全部 8 个 JS/CSS 资源 200，参考 catalogue 与切换前完全相同（VoxCPM2 7 参考），两条日语 WAV 实际读取通过。49 本次源文件与构建副本哈希相同，28 范围外路径哈希未变。`activation.json`、`service-verification.json` 保存回执，服务日志在 `service/2026-10-28/pov-asmr-overlay.*.log`。既有 Windows SWC 原生加载警告仍存在，WASM 回退构建/服务正常；未将其当作本轮修复。

更新包：`I:/AI/asmr_director/artifacts/h3-asmr/ASMR-video-runner-storyboard-sound-update-2026-10-28.zip`（2,838,733 字节，SHA-256 `eb68921076a133247be7ee3e331a5482156bd445a8b91a51e6cd97a0dc2e4d72`）。13 文件，包含运行器/说明/入口和完整节点、引擎、SOFA，不覆盖 `project.json`、工作流、素材或 outputs。已验证实际覆盖到旧测试包、保留原文件哈希并完成主/音效各 6 payload 干跑与解压节点 CPU 渲染。首次使用需把完整节点目录复制到目标 ComfyUI、安装缺少的 requirements 并重启；不是仅替换旧三文件的更新方式。要得到新音效规划，旧工程须重新生成对应分镜再下载视频包。

## 边界与恢复

本轮没有真实 H3/TTS/ASR，也未试听用户成片。API 将首镜脚步、衣料和落手组合成一条声轨并选择 approach；这是有效的可执行规划，不等于物理声位或声音品质已验收。最终 H3 画面、音效质量和目标 ComfyUI 节点兼容性仍需在用户目标主机实跑。

旧工程没有自动改写；用户需选择新风格并重新生成目标分镜，或保留旧风格后重做分镜以获得音效规划。批跑默认保留既有原版结果，完整新规划才能合并音效版。

28 个原有范围外路径（spatial-studio、旧空间修改、配置等）保持，见 `unrelated-work-before.json`。正式源码只取干净 HEAD 加本次明确文件的隔离副本，不把脏主工作区整体投入服务。用户于 2026-10-28 要求记录并推送本轮；发布范围限定为已验证的 49 个功能文件与 6 份文档，不混入范围外工作。实际 commit、推送、远端一致性及逐文件清单以同一 QA 下 `publication.json` 为准。复用上述构建/回归证据前再次逐文件比对源码、隔离发布与原 manifest，并检查原有 28 路径未变；不因发布重新运行 H3/TTS/ASR。

中英合同：[中文](../specs/2026-10-28-pov-asmr-overlay.zh.md) / [English](../specs/2026-10-28-pov-asmr-overlay.en.md)。
