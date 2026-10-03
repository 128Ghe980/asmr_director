# 分镜双模式与逐段快捷切换验收

日期：2026-10-02。父阶段：Audio Quality V1，整体仍进行中。本次未提交推送。

用户要求将上一镜参考改为「延续上一镜」与「主要按背景剧情设计新镜」二选一，并在列表分镜入口右侧增加图标切换。

已实现「连续镜头 / 新镜头」：链条/取景框、紫色/青色轻量底色，列表按钮32px，面板互斥单选。每段偏好保存在可选`videoPlan.referenceModes`，生成结果另存`referenceMode`；兼容旧工程，切换偏好保留旧分镜及可复制提示词。首段固定新镜头；连续镜头要求相邻有效完整前镜，新镜头无前镜时可按背景生成。新模式只给模型上一镜标题/画面/动作/机位，不重复前镜完整H3或台词、音频规则。

手动及批量生成统一按模式、来源、当前采用音频和前镜指纹核验回包；批量串行读取刚保存的前镜，逐项成功保存后再派发下一段。列表点击不改变选段或打开面板，列表/面板双向同步，生成中锁定。背景编辑和保存新镜均保留模式偏好。

验证证据根：`I:/AI/asmr-director-storyboard-modes/2026-10-02`。

- **9个不重复定向文件 / 181项测试通过**：域/服务70，真实App模拟HTTP与bridge13，schema/项目导入保存/项目库/API55，面板及列表43。`integration-tests.log`包含7文件138项；`panel-tests-final.log`包含2文件43项。覆盖混合模式串行批量、当前前镜、缺失/过期/非相邻前镜、首段、错误mode/来源回包、取消及迟到结果、旧记录兼容和模式偏好刷新。
- 单独全量TypeScript、10个本次相关源/测试文件ESLint与生产Webpack构建通过；已有Windows SWC DLL警告由WASM回退处理。构建自动改写的`tsconfig.json`已恢复本轮前的内容与CRLF，文件无差异。
- 实际IAB22段列表有22个模式按钮（首段禁用），其余21个按钮均32px；第2段连续→新、面板同步、刷新保留、面板切回连续及列表同步通过。快捷切换保持第1段选择与声音标签，未触发模型调用。第2段最终恢复原有效模式「连续镜头」，保存其显式偏好。
- 1182×892、390×844、320×740均无整页横向溢出；320px列表按钮边界251–283，面板两选项边界38–151/159–272，均在视口。默认viewport已恢复。`browser-verification.json`记录页面29条台词（策划7+工程22）、标题和timeline文本不变，console error/warn为空。截图保存为`storyboard-modes.jpg`。
- 全部**138个素材文件**数量、大小和SHA256不变，`assets-verification.json`无差异，HTTP200，无生成锁。零实际TTS/文本模型/H3请求，未采用或放弃候选；未进行新的成片或听感验收。

最新生产：**127.0.0.1:3001 / PID38384 / `.next-batch-generation-production` / HTTP200**。旧PID32092经身份、无生成锁及无音频子进程核对后停止（只有Windows conhost）。同样使用`ASMR_VOICE_WORK_ROOT=I:/AI/asmr-director-voice-work`及`ASMR_BATCH_DOWNLOAD_TEMP_ROOT=I:/AI/asmr-director-batch-download/2026-10-01/temp-downloads`，隐藏启动；具体信息见`runtime.json`和`server.log`。

说明：[English spec](../superpowers/specs/2026-10-02-storyboard-reference-modes.md) / [中文说明](../superpowers/specs/2026-10-02-storyboard-reference-modes.zh.md)。恢复入口：[AI_HANDOFF](../AI_HANDOFF.md)，顶层路线：[ROADMAP](../ROADMAP.md)。
