# 选段右侧内容、末段按钮与音频时长说明

日期：2026-10-25；状态：本项完成并更新3001。Audio Quality V1 继续进行，SFX 暂停，顶层路线不变。

## 修复

用户复现：插入无对白镜头自动打开分镜后，普通点击后续台词仍留在分镜；最后一段的更多按钮移到最左。

- 原因一：列表选段仅设置 clipId，保留上一项页签。现在普通选择台词打开声音，选择无对白打开分镜；短句、整段、时间线共用该选择处理。显式分镜按钮继续直接打开目标分镜。整段正文聚焦也可回声音，同时保留已选中的内部短句，不重置到首句。
- 原因二：末段没有下一段，`getVoiceGapAfter` 返回 null；底部 flex 仅剩更多菜单，`justify-between` 单子项靠左。菜单增加 `ml-auto`，有无等待输入都靠右。
- 仅修改三个组件和一个回归测试文件，不修改音频、视频包、工作流、批跑器或项目格式。

English: Ordinary clip selection now opens audio for speech and storyboards for silent shots. Explicit storyboard commands remain available, and focusing paragraph text preserves the selected inner speech unit. The final clip's More menu stays on the right even without a following-gap control. Audio and video timing behavior is unchanged.

## 本次核对的现有音频行为

| 场景 | 段后等待 |
| --- | --- |
| 单段原音/候选试听、原音或后处理逐段下载 | 不加入 WAV |
| 整批原音试听 | 在片段之间补对应时长的静音，最后一段不补 |
| 整批后处理试听 | 不加；明确 gapAfterSeconds=0 |
| 工程 WAV 混音 | 按 clip.start 放置素材；工程间隔保留，其他音轨仍可发声 |
| 视频包、批跑、最终合片 | 不携带 start/pause_after，直接按单镜实际音频长度及空镜时长连续制作 |

例如原音 5 秒、段后等待 2 秒，单段 WAV 仍为 5 秒；原音整批试听在第 7 秒接下一段，视频不会多出 2 秒画面。后处理自身混响尾音可能改变文件实际长度，与该等待设置无关。

空镜不运行本机 TTS、不附 WAV；本机音频批下载排除空镜，整批音频试听用其时长的静音占位。视频包以 kind=ambient、时长和 prompt 导出，不带 audio 字段。分镜 API 按全稿/前后剧情设计一句自然环境底噪，H3 prompt 要求无对白、无音乐的环境声。批跑接 H3 VAEDecodeAudio → TrimAudioDuration → CreateVideo，空镜画面和音频均裁至目标时长（≤5秒）；对白则把导出 WAV 直接接 CreateVideo。

原生合片保留各镜 MP4 音轨，并按真实帧长建立等长静音底后混入，防止音轨时长偏移。不存在“完全缺音轨时自动静音替代”的显式 fallback，不能把等长静音底描述为该能力；本轮未增加该功能。

源码证据：`voice-segments.ts` 的 get/setVoiceGapAfter、`accepted-voice-preview.ts`、`local-voice-preview.ts`、`local-batch-download.ts`、`project-mix-renderer.ts`、`local-video-package.ts`、`h3-prompt.ts`、`tools/comfy-batch/runner.py`。视频包已有测试断言清单没有 start/pause_after。以上是代码链路审计，不是本轮真实 H3 环境音质量认证。

## 验证与交付

选定快照原有相邻测试及三条新回归共 4 文件、38 通过/0 失败/0 跳过；完整类型检查、四文件 ESLint 通过。回归覆盖两工作区插空镜后编号/正文选台词回声音、普通选空镜、显式分镜和同段重选、整段内部短句保留。初轮测试错误假设 hidden panel 卸载的失败已单独保留，不冒充产品失败证据。

串行 Next 构建、隔离3107页面及7JS/1CSS字节核对通过。350/560左栏×末段无等待/普通段有等待共4张真实组件SSR+生产CSS截图通过，更多按钮右边与所在行右边差均0px，无横向溢出；属于合成数据静态布局验证，非用户工程或整站浏览器验收。21:04HKT部署3001 build X5v7do9VMxFCgxLxrIEdt、PID40512，来源 D:/CodexWorkplace/asmr_director_release_verify/2026-10-25-inspector-selection/apps/web，dist .next-inspector-selection，canonical启动配置同步并备份。生产页面200及7实际服务JS SHA通过，重启前新快照的425个生产文件metadata保持。没有真实模型调用或浏览器工程存储读写，未提交推送、重跑整站测试或真实远端视频。

修改文件为 studio-app.tsx、script-editor-panel.tsx、paragraph-script-list.tsx、studio-app.speech-workspaces.test.tsx；同步本记录与既有ROADMAP/AI_HANDOFF/project-archive，27另会话路径原字节排除保留。最终源码树、其余工作区字节、HEAD/空索引检查见 verification.json；source-verification.json、deployment-verification.json、visual/visual-qa-results.json 为分项证据。证据目录：`D:/CodexWorkplace/asmr_director_qa/inspector-selection-2026-10-25`。
