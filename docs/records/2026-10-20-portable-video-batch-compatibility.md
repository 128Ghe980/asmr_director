# 2026-10-20 — 最近改动与另一主机视频批跑器兼容性复核

所属阶段：Audio Quality V1，父阶段继续进行中；SFX 暂停。用户要求检查最近语音可靠性、批量音频与短句分镜默认模式改动，是否影响另一主机使用的便携 ComfyUI 批跑器。整段识别切分按用户要求暂缓，本轮不处理。

## 结论与范围

本机源码、真实导出接入、模拟 ComfyUI 和真实 FFmpeg 验证未发现近期兼容回归，无需为这些改动另发运行器更新。当前 `tools/comfy-batch` 的四个分发文件与已发布 HEAD `a115b3fd5177181e2c1e16ee9543653c31522d62` 一致；本轮未改产品代码、部署或提交推送。

另一主机实际 H3、节点与模型安装、代理上传、长时间 GPU 执行及真实 Tk 窗口本轮未验证，不能据本地通过声称远端整链已验收。

## 兼容约定

- 包仍是 `asmr-video-package` version 1；镜头字段仍为 speech/ambient、new/continuous、提示词、实际时长和相对素材路径。无新增本机盘符、语音 CLI、Whisper、DeepSeek 密钥或服务依赖。
- VoxCPM2 修复仅影响本机如何产生音频；导出仍逐镜收集实际已采用的 PCM WAV，实际文件头决定时长，不把候选或全局音色配置塞入运行器。对白仍使用同一份原音作为 H3 参考及最终音轨；无对白使用 H3 环境声且不超过 5 秒。工作流模板和封装分支保持。
- 短句仅未初始化镜头首镜 new、后继 continuous；手选、已保存和旧分镜模式继续保留，整段默认不变。新生成分镜沿用已有字段导出，运行器原已支持。已下载的旧包是快照，不会因网页默认变化自动改写。
- 每镜 N 份、稳定种子、同号相邻尾帧及缺失时退角色图、长等待后台处理、未知任务对账、断点继续和离线原片封装保持。没有引入质量依赖链、级联重做或工程时序等待。
- 状态 schema 2 和用于输入身份的 `RUNNER_VERSION=1` 保持。旧状态 1 备份后迁入候选 1 仍有测试覆盖；迁移后的状态不用于反向兼容旧的 v1-only 程序，应保留迁移备份。

## 本轮验证

1. Python：50 核心、9 控件、3 停止边界，合计 **62 passed / 0 failed / 0 skipped**。覆盖长等待、断网和未确认任务恢复、停止后续提交、旧状态迁移、多候选数量增减、稳定种子及历史复用。
2. TypeScript：video-plan 46、video-package 8、local-video-package 9、真实 ZIP→运行器 integration 1，合计 **64 passed / 0 failed / 0 skipped**。显式使用 Python 3.11，integration 没有跳过；三镜包含对白、无对白与连续模式，解压后 N=1/2 干跑通过，6 个候选 payload 独立种子。单元测试只在内存中重定向旧硬编码 fixture 临时目录，测试逻辑及仓库源码未改，前后 SHA 一致。
3. 真实 FFmpeg：合成 raw 经本地模拟 ComfyUI 产生 **4 单镜、2 条候选号预览**，解码、时长与环境镜头上限通过；移除一份合成成片后由本地原片离线恢复，不查询远端、不新增提交。四次提交均是本机 mock，真实模型调用 0。
4. 当前 3001 HTTP：只使用四个合成无对白镜头和合成 PNG，实际 POST 导出→单次下载→ZIP CRC→解压→`runner.py --dry-run --candidates 2`，**8 payload** 通过。初始模式 `[new,continuous,continuous,continuous]`；保存手选独立和无 mode 元数据的旧独立分镜后，实际包为 `[new,continuous,new,new]`。时长为 0.5/1/2/4.5 秒；源工程故意设置很大 start/pause，包内没有等待字段。四个打包运行文件逐字节等于当前仓库版本，图像字节保持、manifest 无本机绝对路径或语音运行时配置。

早期 HTTP QA 脚本把 JSON 转义的 `definitions:\n` 误判成 Windows 盘符路径；改为检查解析后字段值，再完整通过。这是验收脚本修正，没有产品故障或产品源码修改。

## 保护与证据

证据根：`I:/AI/asmr-director-batch-compatibility/2026-10-20/`，新日志、临时素材、ZIP 和视频均在 I 盘。

- `runner-qa/runner-compatibility-verification.json`、三组测试日志及 `runner-qa/media-smoke/verification.json`。
- `export-qa/verification.json`、`export-qa/test-execution-receipt.json`、`export-qa/vitest-results.json`、`export-qa/export-tests.log`、`export-qa/integration/portable-smoke-*/smoke-evidence.json`。
- `live-http-verification.json`、`live-package-smoke.cjs`、`live-synthetic-package.zip`、`live-extracted-package/` 及干跑日志。
- `independent-audit/independent-audit.json`：独立核对导出接入/工作流/本机依赖，旧三文件更新 ZIP 与当前文件 SHA 一致；`final-verification.json` 汇总验收及 329 个文档引用检查。
- `protection-before.json` / `protection-after.json`：52 个既有非文档脏文件 SHA 保持，HEAD 和空索引保持，生产候选仍 134、manifest/profile SHA 不变；3001 监听 PID 21316 和 build `AkzV2cH7nm4ZoVuIHjttq` 保持。PID 仅为本轮快照，后续操作前重新检查。

本轮仅增加本记录并同步 ROADMAP、AI_HANDOFF、project-archive；无 TTS/ASR/DeepSeek/H3 调用，无用户工程或浏览器存储操作，无自动确认采用、系统清理或服务替换。后续若验证另一主机，应使用其实际已安装节点环境和新导出包，记录远端结果，不能把本轮 mock 当实跑。
