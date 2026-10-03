# 分镜颜色标识与逐段 TXT 批量下载

日期：2026-10-03。父阶段：Audio Quality V1，整体仍进行中。本次未提交或推送。

用户要求在列表右侧给分镜增加颜色标识，并在批量下载中增加每段台词对应的 TXT。沿用项目既有 `ROADMAP` / `AI_HANDOFF` / 历史归档规则记录本次工作，不建立新的顶层阶段或文档框架。

## 实现

现有分镜入口右上角增加小色点与轻量底色：绿色表示完整且当前可用，灰色表示没有保存分镜，暖黄色表示已有分镜需要更新或补全。颜色附带可访问状态文字及提示，列表保持原列数，旁边的「连续镜头 / 新镜头」快捷按钮保留。列表和下载数量共用有序状态检查；台词、采用音频、背景或引用前镜变化会让依赖镜头自然失效，已保存字段仍保留。

顶部「批量下载」弹层增加「音频 / 分镜」标签。音频沿用无后处理和后处理 ZIP；分镜显示可下载、待生成、需更新数量和文件预览，导出一个工程文件夹中的逐段 UTF-8 TXT。每份 TXT 与该段现有 H3 提示词完全一致，文件名使用原人声段落编号和安全处理后的台词片段。跳过不可用段落时保留编号空缺，避免把原第 5 段重编号为第 4 段。没有可用分镜时前后端均拒绝空包，下载不会触发重新生成。

现有 `POST /api/assets/batch-download` 增加可选 `kind: "audio" | "storyboard"`，省略仍按音频处理；两类共用 JSON 准备结果与同源不透明 token 原生 GET 下载，兼容旧音频二进制 POST。分镜仅写提示词，不读取音频或调用 DSP，限制 2,000 段与 64 MiB，并保留取消、过期和临时目录安全清理。项目或内容变化会中止旧准备请求并忽略迟到结果。

主要改动：`video-plan.ts`、新增 `studio-storyboard-overview.ts` / `storyboard-batch-download.ts` / `local-storyboard-batch-download.ts` 及相应测试，批量下载 API / session、`batch-audio-download.tsx`、`script-editor-panel.tsx` 和现有 App 批量集成测试。旧音频下载、单段分镜编辑与模式偏好不改变。

## 已完成验证

证据根：`I:/AI/asmr-director-storyboard-export/2026-10-03`。

- **12 个不重复定向测试文件 / 211 项通过**：后端与旧音频回归 7 文件 / 101 项，批量下载界面 24 项，分段列表 11 项，真实 App 模拟 HTTP 集成 14 项，单段分镜服务及编辑器 2 文件 / 61 项。日志为 `backend-tests.log`、`backend-audio-regressions.log`、`ui-vitest.log`、`list-marker-verification.json`、`app-tests.log`、`manual-storyboard-regressions.log`。覆盖来源和前镜失效、状态计数、精确提示词字节、文件名及编号、空包/取消/限制、旧音频协议、切换标签与工程后迟到请求等；未重复此前 1,028 项全量套件。
- **16 个相关源 / 测试文件 ESLint、单独全量 TypeScript 和生产 Webpack 构建通过**：`backend-eslint.log`、`integration-eslint.log`、`typecheck.log`、`build.log`。既有 Windows SWC DLL 警告仍由 WASM 回退处理；构建自动改写的 `tsconfig.json` 已恢复本轮前内容及 CRLF，该文件没有差异。实际工程提示词预期生成的临时取证测试已移出源目录，不计入上述正式测试数量。
- 当前实际工程「深夜回家，小安陪你吃碗热汤面」共有 **22 条非空人声：8 可用 / 13 待生成 / 1 需更新**；第 4 段需要更新。通过实际浏览器下载并重读 `C:/Users/Yuki1/Downloads/深夜回家，小安陪你吃碗热汤面_分镜.zip`：**8 份 TXT / 10,645 字节**，原段号 `001/002/003/005/006/007/008/009` 保持，只有工程目录内 TXT，不增加清单或音频。全部 CRC、UTF-8 与现有 H3 提示词逐字节相等、当前台词恰好一次、`fully_copy` 恰好一次校验通过。ZIP SHA256 为 `8bbadf61c5e697aa3c1e6f9ff9df84ecf4c4b1e6c0d1b0915bc9a193b06825bc`，见 `browser-zip-verification.json`、`expected-storyboards.json`、`verify_browser_zip.py`。
- 实际浏览器 **1182×892、390×844、320×740** 均无整页横向溢出；390px 弹层左右边界 14–382、底部 607，320px 弹层边界 8–312、底部 647、内容宽度与滚动宽度均 302，下载按钮完整在视口。320px 列表分镜按钮仍为 32px、边界 211–243，没有增加列宽。默认 viewport 已恢复，console error / warn 均为零；22 个分镜状态标识为 8 / 13 / 1。**29 条可见文案（策划 7 + 工程 22）、标题及两个 timeline DOM 分组完全不变**。见 `browser-verification.json`；桌面截图为 `storyboard-status-export.jpg`。
- **138 个素材文件**数量、大小与 SHA256 均不变，包括候选 manifest，无增删；HTTP200、PID14196、下载临时目录为空、没有生成锁。见 `assets-before.json` 与 `final-runtime-assets-verification.json`。浏览器检查和实际下载没有调用模型，也没有采用 / 放弃候选或编辑用户来源。

## 运行与范围

当前生产 **127.0.0.1:3001 / PID14196 / `.next-batch-generation-production` / HTTP200**。本轮开始时旧 PID38384 已不存在且端口未监听，先恢复上一版 PID3192；最终构建前核对身份、没有活动生成后停止它，再隐藏启动新服务。继续使用 `ASMR_VOICE_WORK_ROOT=I:/AI/asmr-director-voice-work` 与 `ASMR_BATCH_DOWNLOAD_TEMP_ROOT=I:/AI/asmr-director-batch-download/2026-10-01/temp-downloads`；日志 / 临时取证放 I 盘，见 `runtime.json`、`server.log`、`server-error.log`。

没有实际 TTS、文字模型或 H3 视频请求，没有采用 / 放弃候选或修改用户文案。未进行新的成片、画质或听感验收，Audio Quality V1 未完成项保持。当前代码和文档留在共享工作树，本次没有新的提交 / 推送授权。

说明：[English spec](../superpowers/specs/2026-10-03-storyboard-status-and-batch-txt.md) / [中文说明](../superpowers/specs/2026-10-03-storyboard-status-and-batch-txt.zh.md)。恢复入口：[AI_HANDOFF](../AI_HANDOFF.md)，顶层路线：[ROADMAP](../ROADMAP.md)，历史：[项目留档](../project-archive.md)。
