# Planner 分镜的 H3 提示词

日期：2026-10-01。属于现有音质 V1 内部策划功能扩展，不新增 roadmap 阶段。[English](2026-10-01-h3-storyboard-prompts.md)。

## 依据与范围

用户批准按本会话已经阅读的官方 H3 指南调整分镜：依据 [H3 指南](https://vrfi1sk8a0.feishu.cn/wiki/FIWjwgL33ipnkekzk30crmKUnIh)第四节及 [Ref 格式指南](https://vrfi1sk8a0.feishu.cn/wiki/Vztzwstuqi3MQKkxs8QcGmxinxe)。以下规则针对用户的素材工作流：一张角色参考图，每镜使用对应的现有 TTS 音频。

本轮只生成供用户配合素材使用的文字提示词，不上传角色图、不合成或附加 TTS、不连接实际音频文件或实测时长、不调用 H3 视频 API、不产出视频。现有已认可音频处理、音频资产及批量下载保持。音频实测 duration 的绑定留待后续实现。

## 提示词规则

新生成分镜的画面、动作、镜头说明使用英文。中文台词直接取自已经校验的原文案关联台词，保留来源顺序；文字模型不改写、不翻译、不新增或返回替换对白。

各镜统一 `Subject1 (S1)` 角色身份；导出参考标签使用带空格的 `<Subject 1>`、`<Picture 1>`、`<Audio 1>`，任务镜头段为 `[Shot 1]`。`Picture1` 用于确定角色外貌及衣服，是角色参考而不是必须复现的首帧；不能要求每镜开头都照搬参考图构图、姿势或背景。

`Audio1` 使用 `fully_copy`：提供的录音作为完整最终音轨，保留原速及原停顿。提示词不得新增对白、环境声、音效或 BGM，并明确 `non_diegetic_music: N/A`。官方另一模式拼写是 `partially_copy`，本轮不实现，也不能误写成 `partial_copy`。

嘴部可见时，口型跟随所提供音轨的真实 timing；停顿沿用原录音，静音时及说话结束后闭嘴。不按字数估算音频时长，不硬编秒数，不延长台词或新增独立生成声音。每镜采用简单连续动作及轻运镜，避免一镜描述多次切镜或互相争抢的动作。

规则分别写入独立分镜生成 prompt 和确定性导出格式器。用户偏好可指导画面，但不能改写对白或覆盖完整保留音轨。导出提示词说明如何配对应的 `Picture1` 和 `Audio1`，不宣称这些素材已经上传或连接。

模型不得从文案设定发明外貌、发型或服装。格式器在可编辑画面 / 动作 / 镜头之后明确角色参考图优先，忽略文字中推测的性别、年龄、脸、头发及服装。六段结构为 `subject_definitions`、`summary`、`retention_analysis`、`detailed_description`、`overall_soundscape` 和 `non_diegetic_music`。

## 数据与界面

`POST /api/storyboard` 保持现有请求与来源完整分组校验。新生成的 version-1 分镜增加 `promptFormat: 'minimax-h3'`。旧记录没有该标记仍可加载、编辑；不能把旧中文策划文字静默标为可用的英文 H3 提示词。

来源指纹与完整有序台词引用继续判断分镜是否对应当前文案。工作态和 `PlannerSource` 保存可选格式标记，随采用、复制、版本及恢复保留；提示词元数据不进入音频 Project JSON。

符合新格式的每镜提供紧凑的 H3 提示词展开区和复制操作，分镜工具栏可下载全部 H3 提示词 TXT。每个任务附 `Source lines`，标明原稿第 N–M 条台词序号，便于对应 TTS 素材，不虚构时间。格式器使用用户可编辑的英文化画面 / 动作 / 镜头字段及原文案台词，不在复制或导出时要求模型改写对白。

旧中文分镜保留原样，提示重新生成以获得英文 H3 格式。来源文字或映射过期时禁用 H3 复制 / 导出，直到重新生成或撤回恢复关联；普通分镜 Markdown 仍可下载，保留原有来源过期说明。沿用一屏工作台、内部滚动、小屏尺寸、保存 / 撤回和取消行为。

## 验证状态

提示词策划 / 导出实现与验证完成。证据 / 日志根：`I:/AI/asmr-director-h3-storyboard/2026-10-01`。最终全量 Vitest `--maxWorkers=4`：**77 文件 / 829 项通过**，1 个既有 opt-in 文件 / 用例跳过。全量 TypeScript、ESLint、生产 Webpack 构建通过（`types.log`、`lint.log`、`build.log`）。首轮与构建并行时，既有 205 条录音分页测试超过五秒限制，失败保存在 `tests-build-concurrent-first.log`；构建结束后全套复跑通过，没有修改该测试或对应生产代码。

浏览器证据为 `browser-verification.json`。真实 DeepSeek-v4-pro 一次生成七个英文分镜，七段原文案及当前 22 条音频时间线 label/title 完全不变。模型仍推测外貌并安排复杂转身，因此通过 UI 修正这些演示字段，加强参考图优先规则后重新构建；没有第二次付费请求。强化后的模型要求由请求合同测试验证，最终确定性参考图优先句由浏览器剪贴板回读验证。原文对白、`fully_copy`、参考标签、无新增音轨、过期复制 / TXT 禁用、撤回和刷新保存均通过。TXT 内容、剪贴板失败后选中回退、无效文案 / 映射及旧稿兼容由自动测试覆盖。

桌面、390×844、320×740 已检查，两种窄屏无整页溢出并保留 Planner 内部滚动，viewport 已恢复。截图仅在工具中查看，未保存文件。正式服务为 **3001 / PID 17600 / HTTP 200**，原生 `.next-h3-storyboard-production`，cache junction `I:/AI/asmr-director-h3-storyboard/2026-10-01/next-cache`；临时 3002 已停止。既有 native SWC 警告使用成功的 WASM 回退，构建自动改写的 `tsconfig.json` 已还原。本轮无新 TTS、音频工程采用、角色图上传或 H3 视频生成，未提交 / 推送。
