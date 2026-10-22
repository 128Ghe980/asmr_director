# 音频工作台与原生 ComfyUI 批跑器版本发布

日期：2026-10-22。所属路线：Audio Quality V1继续进行中，SFX暂停；沿用现有legacy文档入口，不新增路线系统或阶段。状态：开发版本与默认分支README均已推送，仓库About已更新；本记录及三入口由后续纯文档提交同步，最终HEAD以Git和发布收据为准。

用户要求记录并推送当前版本，同时为仓库页面补充简短介绍。本次发布播放器与右侧滚动、声音设置就绪、识别只服务切分、用户试听后的独立强制切分、顿号边界及无本地FFmpeg的ComfyUI批跑器（含明确停止按钮）。采用与内容判断仍由用户决定。仓库公开由另一会话处理，本轮只实核公开状态并更新About为“本地优先的 AI ASMR 创作工作台：文案策划、语音生成与切分、分镜设计，以及支持断点继续的 ComfyUI 视频批量生成。”

开发分支`codex/voxcpm2-product-generation`已推送[385267c2d7e6101b4feb8b216fc32790d369a617](https://github.com/128Ghe980/asmr_director/commit/385267c2d7e6101b4feb8b216fc32790d369a617)。默认分支`codex/director-action-presets`另推送[42359fd04377aa58364752f7b13bd751ee2aa91b](https://github.com/128Ghe980/asmr_director/commit/42359fd04377aa58364752f7b13bd751ee2aa91b)，以原`d23546f`为parent，仅新增README.md，blob与开发分支README一致并链接最新开发分支；没有合并代码或更换默认分支。API和ls-remote均已核对。

选定84文件导出的独立发布树核对600个blob，Vitest为1941通过、0失败、3条件跳过，覆盖147文件；跳过项为实际空间Python适配器、Windows符号链接源保护、真实ASR整段切分，不算已验收。Python三套97+180+32共309通过、0失败/跳过。完整类型、lint、生产构建和实际ZIP导出集成通过，验收BUILD_ID为`HoD6CcteVbwhCRM5BjIx1`。发布前统一三份Python测试的默认临时目录，避免依赖开发机I盘；另5文件仅清理末尾空行，不改产品算法。

文档涵盖此前17份相关文档、本发布记录及根README。另一会话空间工作台/渲染/Qwen的26项范围外改动排除并保持原字节，旧记录历史不改写。本次没有重启或部署3001，PID27408未动，未运行新模型；一条历史原音缺失、用户远端真实H3和完整原生合片未验收，父阶段不标完成。

证据根`I:/AI/asmr-director-release/2026-10-22`：`precommit-verification.json`、`selected-python/verification.json`、`publication-verification.json`及`repository-after.json`；最终记录同步提交与远端HEAD看`release-verification.json`和Git。此前功能证据见[原生运行器记录](2026-10-21-native-comfy-video-runner.md)、[强制切分记录](2026-10-21-forced-audio-segmentation.md)。
