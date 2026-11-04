# 2026-11-04 人声滑动窗口与段尾留白

路线：Audio Quality V1，属于既有路线内的人声连续性与交付修复。任务于 2026-11-02 开始，额度中断后于 2026-11-04 恢复；沿用原 QA 目录，不改写此前证据的日期。实现、隔离验证、本地部署与实际批包导出已完成，真实新语音听感及 H3 成片仍待使用时检查。其他暂停任务与顶层路线保持。

合同：[中文](../specs/2026-11-04-voice-continuity.zh.md) / [English](../specs/2026-11-04-voice-continuity.en.md)。

## 用户意图与实现

用户发现无台词段让人声生成窗口提前结束，表现为生成时间变短、前后一致性变差，要求窗口跨过无台词段继续取后面的台词，不足时补足。另要求真正实施段间间隔，将停顿加到音频后，让视频按实际音频时长生成；用户明确选择默认 0.35 秒。

短句语义片段的新 context v2 按顺序跳过一个或多个无台词段，只收集真实后文台词；无台词动作描述不送入 TTS。窗口不足时使用已有固定续句，保持最多 16 子句、500 字符，目标正文不截断。无法容纳续句边界时要求先拆分。实际最后一条台词同样有续句，必须走 prefix 提取目标，不能将含续句的完整录音以 whole_recording 采用；完整原始录音另存。v1 历史数据仍按原方式解析，v2 进入请求与候选身份，旧未采用候选不会伪装为新窗口结果。已采用音频保持，不自动重生。

对后面还有片段的人声，交付留白依次使用显式 `tail_pause_seconds`、已有正数 `pause_after`、仅在 `pause_after` 缺失时推导的时间线空隙，否则默认 0.35 秒。显式 0 可以关闭；全篇最后一段不加。无台词表演不自动增加 0.35 秒，表演时长保持。

留白在最终选用的原音或 D 成品之后追加数字零，D 原有尾音完整保留。PCM16/24、单/双声道、源采样率及附加 WAV 元数据保持，原 PCM 样本逐字节不改；按源采样率量化，0.35 秒在 22050 Hz 为 7718 帧。整体试听使用相同量化，避免一份 WAV 加一次、串接时再加一次。原音、D 成品及后处理回执保留。

短句与整段页仅在选中的人声段显示“段间留白”，沿用各工作区独立设置。拆分仅最后子段继承末尾设置，合并继承最后一段设置；改留白不使原人声或 D 失效。整体试听缓存身份包含有效留白，调整后重新整理试听，不继续使用旧缓存。UI 不为未选中的每段增加额外展开高度。

音频 ZIP 新增“交付音频”，保留原有“无后处理”“后处理”备份。视频 ZIP 内 `audio.wav` 真正含留白，主视频与独立 ASMR 音效共用它的实际时长，manifest 另记源时长和留白时长。视频导出继续完整 D 批次优先、未完成则全部使用原音的既有选择规则。原音或 D 尾音加留白后的实际时长最多 15 秒，恰好 15 秒允许，多一个样本也拒绝，并提示调整留白或拆分，不裁音频。

主要生产改动涉及 `voice-generation-context.ts`、`voice-longtext-plan.ts`、新增的 `voice-delivery-timing.ts` / `wav-tail-padding.ts`，以及视频与音频导出、整体试听、schema、片段编辑、双工作区传播和相关 UI。没有更换模型、参考音频、中文 reference_only 方法、CFG、步数或人声 D 引擎。

## 验证与已修正的测试问题

QA 根：`I:/AI/asmr_director/qa/voice-continuity/2026-11-02-window-pause/`。本任务 0 新 DP/TTS/ASR/H3 调用，不据自动测试宣称实际音色、语调或成片听感已改善。

- 独立复验 8 个测试文件、91 项通过，覆盖跨无台词后文、末条固定续句、v1 兼容、留白优先级、PCM 与元数据保留、显式 0、默认留白、D 尾音只加一次、原音回退、主镜/音效时长一致和 15 秒加一个样本的拒绝边界。两份修改过的测试文件 lint 与 diff-check 通过。见 `audit-tests-2026-11-04.json`、`independent-audit-2026-11-04.json`。
- 对用户实际 39 段万圣节工程做旧/新实现的文本窗口对照：20 条台词中旧版有 18 条被无台词边界视为末段，新版 20 条全部走 prefix，前 19 条取得后续真实台词，最后一条补固定续句；目标正文完整，均在 16 子句、500 字符内，源工程 SHA 不变。此为实际工程输入探测，没有重新生成声音，见 `real-project-window-probe.json`。
- 早期 WAV 测试中，Vitest 逐元素深比较百万字节造成两项默认 5 秒超时；改用 `Buffer.equals` 做同等逐字节比较后通过，没有放宽超时或业务上限。0.35 秒与 22050 Hz 相乘的浮点半样本边界已由共用量化函数统一处理，试听和视频导出一致。
- 真实 Python 集成 2/2 通过：导出 ZIP 解包、runner 主镜与音效双候选 dry-run、包内真实 HRTF、D 与新响度平衡节点核心执行。既有 fixture 的 20/12 秒旧间隔显式设为关闭，保留其原先无间隔时长与原字节验证意图；新增留白由上述专门测试覆盖。没有 ComfyUI/GPU 提交，未执行 torch AUDIO 包装。见 `package-integration-2026-11-04.json` 与同名日志。
- 复用已存在的 Python 与 HRTF：通用 Python 为 `D:/CodexWorkplace/asmr_director_runtime/engines/gpt-sovits/env-comfyui-clone/python.exe`，音频 Python/HRTF 位于既有 `D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/`；没有安装或迁移依赖。源码与 HRTF 在集成期间 SHA 保持，输出均归本项目 QA。
- 隔离 release 从已验证的 `.local/releases/asmr-sound-quality/apps/web` 复制后精准覆盖 19 个生产文件和 23 个测试/fixture。最终 46 个文件中 637 项通过、2 条外部 Python 集成条件跳过（已另外真实执行并通过）；42 文件 lint、Webpack 与完整 TypeScript/21 静态页成功。回执 `release-verification.json` 和 `isolated-*-20261104c-result.json`。首轮 636 通过、1 失败的旧存储测试，在旧 release 同样失败：模拟只阻断 legacy key，而 backup 成功写入；修为两者同时失败，保留原错误文案及两份快照不变断言。产品存储逻辑未改，失败与 focused 日志保留。

## 部署与交付状态

2026-11-04 22:29 HKT 已启用 `.local/releases/voice-continuity/apps/web`，BUILD_ID `sXd34soKlctj7F4E1TWu0`，启动父 PID 21360。切换时 3001 无监听，没有停止其他进程；原入口 `I:/AI/asmr_director/service/2026-10-16/start-production.ps1` 仅改工作目录，旧配置备份在本 QA。`activation.json` ready=true；`service-verification.json` 核实首页、8 静态资产、7 参考项和 4 原音/D WAV 字节。

真实浏览器刷新当前用户所选《直播间里的助眠小时光》，16 段文本与刷新前完全相同，11 已采用/5 无台词/16 设计/11 D、“本地已保存”保持；首段“段间留白”显示 0.35。未导入测试工程或修改项目内容。见 `ui-verification.json`、`ui-default-pause.png`。

实际生产 HTTP 导出旧 39 段万圣节工程，仅传输副本去掉可重建的短句 workspace 元数据以满足 2 MiB 限额，时间线、全部设计、D 指纹/回执等价。旧 ZIP 未内嵌角色图，新包保持相同结构与竖屏选择。交付 `I:/AI/asmr_director/artifacts/h3-asmr/Halloween-new-2026-10-30/Halloween-new-ASMR-tail-pause-2026-11-04.zip`，42,437,421 bytes，113 项，SHA256 `100acb19c04a845a005244f5504cb84303efc0bf7254ccc18938e5969faf237c`。

20 条 D 的原 PCM 逐字节保持；前 19 条各追加 16800 个 48 kHz 零帧（0.35 秒），末条原 WAV 完全相同；19 无台词任务与旧 manifest 相同。主视频/ASMR 均使用实际 WAV 时长；78 禁网 payload 通过，13 独立镜头、最多两次尾帧接续、竖屏 672×1216。总音频 297.81 秒，按 24 fps 预计成片 298.1667 秒，没有实际提交 H3。`http-export.json`、`package-verification.json` 及交付旁 `tail-pause-delivery-2026-11-04.json` 为证据。对照交付 ZIP 后清理 114 个重复候选/展开文件，共 84,860,752 逻辑字节，HTTP 原始 ZIP、78 payload 和回执保留，见 `export-cleanup.json`。

旧包必须重新导出才能包含留白，仅更新 runner 不会改变既有 WAV。新窗口只在后续人声生成时生效；旧已采用录音继续使用。按镜头顺序的整体试听与视频交付实施本规则，绝对时间线混音仍遵守原来的时间位置。

## 范围保护与后续同步

开始时工作区已有上一轮 ASMR 质量实现的 27 个未提交文件及 28 个范围外文件；先记录 `dirty-before.json`，本轮仅覆盖授权的连续性/交付/UI 范围，与此前质量改动重叠的文件保留其既有实现。28 个范围外文件最终 SHA 全部保持，包括含其他工作改动的 `apps/web/README.md`；本轮新合同和 handoff 覆盖其历史窗口/5 秒说明，不将该文件混入 release。旧万圣节工程、原 ZIP、40 个原音/D 文件 SHA 保持。最新已发布基线仍为 `1afcc4753d3033b052434b7f276b8e060c44432d`，本轮未提交或推送。

本项目以 `docs/ROADMAP.md` 为唯一路线，沿用 engineering-development-recorder 的证据留档方法，不新建竞争性的 `CURRENT_ROADMAP.md` 或另一套路由文件。已同步本记录、handoff、既有 roadmap 当前状态和项目历史；Audio Quality V1 整体与其他暂停任务不因本子项自动结束。
