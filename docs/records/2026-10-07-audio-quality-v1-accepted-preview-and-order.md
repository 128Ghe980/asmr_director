# 已采用语音整体预览与台词上下排序

日期：2026-10-07。路线：既有 **人声导演与真实 ASMR 音效质量 V1**，父阶段仍 `in_progress`；SFX 模型工作按用户要求暂停。唯一顶层路线保持 [ROADMAP](../ROADMAP.md)。本次功能已实现并通过下述产品验收，当前请求没有提交或推送指令。

用户希望把已接受语音合起来试听、下载，以及逐行上下调整台词。已有右侧“生成整段”要求全轨道素材齐备，本轮增加适用于部分完成工程的独立入口。

## 完成内容

- 文案批量操作下新增紧凑“已采用语音”栏：已采用/全部段数、整体预览、原生播放器及 WAV 下载。预览与下载读取同一份文件。
- 仅合并当前人声轨已采用、素材 ID 与 source 精确一致的本地 WAV，按台词顺序连接完整原音；保留本段等待，跳过未采用段落，末尾不追加等待。输出 PCM16/48kHz/双声道，保留原立体声或复制单声道；不调用模型、不加入其他轨道、空间效果或响度归一。
- POST `/api/assets/voice-preview` 整理音频；GET/HEAD 重复读取及 Range、原生附件下载，DELETE 释放。最多2,000段、单源128MiB/10分钟、总20分钟、整理120秒；串行准备、分块写出、三份会话/30分钟过期、流租约延迟文件清理。路径与文件类型/尺寸严格复核。
- 每条人声右侧增加48×32px上下箭头组。交换相邻完整台词，保留素材/采用/ID/分镜关联、等待及当前选择，重排受影响的人声时间，沿用保存和撤回；其他轨道/情绪保持。首末及模型/参考/分镜忙碌时禁用相应移动。
- 切换项目、采用或文案/顺序变化即停止并清空旧预览，取消、迟到回复、过期及 `pagehide` 均清理。实测发现并修复 StrictMode 重接音频节点丢失 src、刷新未卸载的清理，以及撤回原顺序使已删除 token 的旧状态再次显示。

契约：[中文](../superpowers/specs/2026-10-07-accepted-voice-preview-and-order.zh.md) / [English](../superpowers/specs/2026-10-07-accepted-voice-preview-and-order.md)。源码位于 `apps/web/src/lib/asmr/{accepted-voice-preview,local-voice-preview,voice-preview-session,voice-segments}.ts`、`src/app/api/assets/voice-preview/route.ts`、`src/components/studio/{accepted-voice-preview,script-editor-panel,studio-app}.tsx` 及对应测试。既有参考导入测试只增加等待加载完成，修复挂载准备状态的竞争；生产参考逻辑未改。

## 验证

外部证据根：`I:/AI/asmr-director-accepted-preview/2026-10-07`。

- `regression-tests-post-undo.log`：12文件112项通过，包括完整PCM尾部/重采样/路径、Range/会话/租约、取消/迟到、StrictMode/撤回、素材与选择保留、参考导入/批量/工程切换/重检。`typecheck-post-undo.log` 完整 TypeScript 和 `lint-post-undo.log` 本轮17文件 ESLint exit0。
- 真实浏览器先复现撤回旧预览，`undo-stale-preview-red.log` 为红回归，修复后 `undo-stale-preview-green.log` 七项通过；独立审查 `review-post-undo.json` 绑定最终17文件 SHA，另8项独立定向测试通过。
- `build-final-verification.json`：正式原生D盘新目录构建 exit0，38.94秒；BUILD_ID `SSXvbu_a_TttobAxNwNAt`。缓存在I盘，构建后共享 `tsconfig.json` / `next-env.d.ts` 原字节恢复。既有Windows native SWC加载警告仍由WASM回退，构建通过。
- 原3001用户热汤面工程，20段/10已采用/2待生成/8已生成未采用：实际合成67.65秒、完整播放至结束，无媒体错误。`playback-verification.json` 记录完整播放；最终修复版与初次播放版输出字节完全相同。
- `download-verification.json` 首次原生下载核对文件/重复GET/HEAD/首尾Range/attachment；`browser-final-verification.json` 再核对最终浏览器下载与最终预览同字节：12,988,844字节，3,247,200帧，SHA256 `33fb49150067e8a4b8d0fc2cd34f0d22bdb2c7bf6bc90edcaba5303ad26de797`。真实文件 `C:/Users/Yuki1/Downloads/深夜回家，小安陪你吃碗热汤面_已采用语音预览 (1).wav`。
- 实际上移/下移与两次撤回，台词/采用/选中第10段保持；最终修复撤回后无旧audio/下载链接，重新合并成功；刷新旧token返回404。原标题、50输入值与时间线文本精确保持，见 `browser-movement-verification.json`、`browser-undo-fixed.json`、`browser-final-verification.json`。
- `browser-mobile.json` / `preview-mobile.png`：390px宽，预览栏clientWidth=scrollWidth=372，无横向溢出。已恢复正常1768×1252桌面；最终 `preview-final.png` 显示有效播放器/下载及紧凑箭头。

## 运行与保护

最新正式入口仍为 `http://127.0.0.1:3001/`，Node PID19636，owned终端52142，输出 `apps/web/.next-accepted-preview-final-production`，替代第一次预览版PID22756和原重检版PID25096。重启须显式设置 `ASMR_NEXT_DIST_DIR=.next-accepted-preview-final-production`，避免 `.env.local` 中其他会话的 `.next-spatial`。`ASMR_VOICE_PREVIEW_TEMP_ROOT=I:/AI/asmr-director-accepted-preview/2026-10-07/previews`，保留一份当前可试听临时WAV，非持久项目素材。

原20段工程恢复原顺序并选中第10段；不自动采用、不调TTS/ASR，不写原音/候选/参考数据。`final-audit-summary.json` / `preservation-final.json` 全量通过：156素材、496原音文件、58候选及manifest原字节、10参考/profile文件、11上传、3备份、25空间源文件、1111Qwen产物、59模型元数据、33其他会话文件、17共享文档片段与4Next/env文件保持；H盘原MP3 SHA保持。只保留1个 `preview-FUxKR0/preview.wav`，`preview-temp-final.json` 确认其与原生下载字节相同。HTTP/新BUILD_ID/参考WAV通过，无原生模型任务、生成/manifest/导入锁或ASR临时目录。共享checkout的空间/Qwen代码和文档部分保持本地；索引为空，本轮未提交推送。

旧服务停止时观察过一次无堆栈 `Controller is already closed`；没有据此归因。独立只读100轮Node流取消/EOF竞态未复现，最终服务真实撤回/刷新/原生下载后无新增日志异常，未改无证据支持的流实现。

## 边界与后续

这份试听/下载包含已采用人声原声与段后等待，其他音轨及空间设置仍由原完整混音入口处理。若某段已采用完整长录音，该段完整原音会进入预览，不按占位时长截短。顺序/文案/采用变化需要重新点击整体预览。最大20分钟及30分钟临时有效期为明确产品边界。

同步本记录至 ROADMAP / AI_HANDOFF / project-archive 既有文档体系，不创建竞争路线或新顶层阶段。音质V1后续工作与真实SFX仍按原路线和用户暂停决定执行。
