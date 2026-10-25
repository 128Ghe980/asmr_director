# 分镜、音频后处理与编辑体验发布交接

日期：2026-10-25。父阶段 Audio Quality V1 继续进行，SFX 暂停。状态：发布验证完成，提交及远端结果见本次Git历史和QA publication.json。顶层路线不变。

## 本次发布范围

本次整理 HEAD `03cd396` 之后本会话累计、已在3001验证的改动：

- 候选和已采用音频直接试听原音；采用后生成分镜，再显式「生成后处理」，按剧情/动作/前后镜头设计距离与移动。播放和导出不临时启动后处理，原音及两工作区结果保留；视频/混音仅整批有效时使用后处理结果，否则维持整批原音，不混用半批成品。
- 分镜使用全稿语义与动作状态，支持整批校对、预览/应用/撤回；自动校对仅处理本批未手改新镜，失败保留已有分镜，不设质量认证门槛。已有分镜重新生成前确认；批量失败显示镜号与具体字段。生成/校对接收边界与保存一致，建议长度不作拒绝门槛。
- 短句表示语义/语气单元，可含多个句号；撤下句号自动重切与长段提醒，保留合法 API 单元和两工作区音频。
- 新无对白镜头用中性待设计说明，分镜阶段再依据上下文安排画面/底噪；紫色卡片区分类型。普通选台词看声音、选空镜看分镜，显式分镜入口保留，整段内部短句选择不丢；末段更多按钮靠右。
- 左侧操作结果收成单行摘要及详情模态，完整错误、校对应用/撤回、试听下载和取消继续保留。

本次没有更改 `tools/comfy-batch` 运行器；无本地FFmpeg版本及停止按钮来自已提交版本。没有修改用户浏览器工程、旧镜头文本、参考音、候选或模型。

English: This release adds explicit audio finishing after storyboard planning, full-script storyboard generation and review, regeneration confirmation and actionable batch errors. Semantic speech units remain intact. Compact result dialogs, distinct silent-shot cards and inspector selection fixes improve editing. Originals, both speech workspaces and existing runner behavior are preserved.

## 发布边界

从已部署的选定源码树发布，应用子树为 `f8e4329afe373f978471198fcf23c198ba6d3968`。既有 manifest 的95个路径经只读审计：74应用文件、21文档；后续只加入本发布记录并同步已有三份入口文档。最终准确路径/树见发布收据。

27项另会话修改继续原字节保留、排除提交：空间渲染、spatial-studio、共享头部、README、eslint/tsconfig/ignore及相关运行时文档。精确路径使用 QA `selected-tree.json.excluded`，不要按笼统的工作区脏文件数字全量暂存。未纳入 .env、真实密钥、用户音频、参考图、运行时或 QA 大产物。

不新建工程路由体系，沿用 AGENT.md 和 PROJECT_MANAGEMENT.md 指定的 ROADMAP/AI_HANDOFF/project-archive；不新增顶层阶段。

## 验证

最终第二轮完整套件：2160通过、0失败、3条件跳过，共163文件（161通过、2跳过），没有修改应用或测试来绕过失败。首轮完整套件为2159通过、1失败、3跳过（163文件）；唯一失败在校对取消测试的首次POST等待，尚未执行取消，不能称取消流程回归。该文件隔离17/17通过、目标约232ms；保留首轮完整失败与独立复测，完整第二轮已通过；不能仅凭通过断言首次超时的具体根因，不把不同轮次数字累加。

实际后处理运行时 `D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/.venv/Scripts/python.exe` 的19项合成CPU测试通过，0模型。初次误用对齐环境因缺pyloudnorm，依赖检查即停、0测试，证据保留；未安装依赖或修改环境。

完整类型检查通过；完整src lint退出0，有一条已有未使用 ensureSpeechWorkspaces 导入警告，0错误。复用本应用子树已通过的串行Next构建 `X5v7do9VMxFCgxLxrIEdt`，文档更新不重建相同应用。已有38定向回归、4张350/560左栏SSR实际组件+生产CSS截图、编译HTTP7JS/1CSS与生产JS SHA验证不等同真实用户工程交互。发布阶段另核对当前服务与资产metadata。

3个条件跳过为：实际空间音频适配器集成、Windows符号链接逃逸测试、真实离线ASR整段切分集成。不得声称这些已在本轮执行，或将前轮真实模型调用算入本轮。

## 下个会话恢复

- 先读 `docs/AI_HANDOFF.md` 顶部本次发布摘要，再读 `docs/ROADMAP.md`；本文件及10/23、10/25记录包含具体实现与证据。
- 分支 `codex/voxcpm2-product-generation`；最终提交/远端以 git HEAD、origin跟踪分支及 QA `publication.json` 为准。未另合并默认分支、打tag或创建PR。
- 3001当前构建 `X5v7do9VMxFCgxLxrIEdt`；源码 `D:/CodexWorkplace/asmr_director_release_verify/2026-10-25-inspector-selection/apps/web`，dist `.next-inspector-selection`。规范启动为 `I:/AI/asmr-director-service/2026-10-16/start-production.ps1`。PID是运行时状态，须实时查监听，不从旧记录盲停进程。
- 常驻服务使用独立验证源码，主工作区仍有另会话未完成改动，不要直接对脏工作区全量构建并替换服务。
- 段后等待不进入单段WAV或视频包；原音整批试听补静音、后处理整批试听不补。空镜不跑本机TTS，网页整批试听静音占位，视频使用H3按环境声prompt生成并裁时的音轨。合片有等长静音底，尚无“缺失音轨自动静音替代”显式分支。
- 雪夜归家全24镜动作质量、用户素材后处理听感、另一主机H3及完整原生合片仍需用户实测；旧短句/旧水杯描述不迁移，寒潮前的归家旧第4镜未读取或自动改写。
- 不恢复按句号强拆/长段提醒、按字面匹配拦截切分、维护型重新切分、FFmpeg外部依赖、工程估时编排视频、强制固定角色图/音库/版本或自动改历史手工分镜。切分正确与内容正确分开，内容由用户听后决定。

证据根目录：`D:/CodexWorkplace/asmr_director_qa/release-2026-10-25`；本轮不清理旧QA、模型或用户资产。

发布后以 `release-verification.json`、`publication.json` 核对最终96路径/应用树、提交及远端一致性。发布阶段页面200、7JS/1CSS与既有构建一致，425个生产文件metadata保持；无服务重启或新增模型调用。
