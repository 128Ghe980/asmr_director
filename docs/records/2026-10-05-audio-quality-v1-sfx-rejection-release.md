# Audio Quality V1 — 生成音效拒绝采用与发布收尾

日期：2026-10-05。现有路线：**Audio Quality V1 仍进行中**。本次模型测试：**用户暂停**；已生成样本：**听审失败 / 不可用**。

## 用户结论与范围

用户在询问生成音频的位置和声音类型、试听后明确反馈：**“相当烂，没法用，先这样吧，记录一下推一版”**。据此拒绝采用 3 条远端 AudioLDM2 刷耳候选，停止继续模型测试，并授权本轮记录、提交和推送。不同哈希、播放正常、检测无明显重复都不能覆盖这个实际听感结论。

实际产出为本机 **0**、远端 **3**；每条 8 秒 / 16 kHz / 单声道 PCM16，三个独立 seed 为 `104729 / 130363 / 155921`。声音目标是化妆刷轻刷硅胶耳；目标描述不证明声音实现了自然贴耳护理。后续按摩任务因免费演示额度耗尽失败，掏耳、喷雾、长段和全矩阵未完成。Stable Audio Open 只准备了适配器和单条命令，未执行；其他备选模型也没有可评价的新音频。

独立真实录音库的 13 个候选仍待听审；此次对生成样本的否定不扩大到录音库。真实 SFX 的产品选择、采用、撤回和来源追溯未接入，不宣布音质 V1 完成。5070 Ti 主机连接澄清不再是当前待办；用户再次要求继续前，不执行生成、下载、安装或付费调用。

## 保留与状态更新

- 生成样本原目录：`I:/AI/asmr-director-sfx-model-test/2026-10-04/remote/raw`；试听目录：同级 `listening`。
- 更新 `generation-manifest.json` 三条成功项的 `listeningAcceptance` 为 `rejected`，保留生成状态 `generated`；记录用户原话、日期与 `workflowStatus=paused`。无输出的按摩失败项不伪造听审结果。
- 同步根目录/试听目录 `analysis.json`、`catalog.json` 与 `index.html`，页面标为“听审失败 · 不可用”。原分析创建时间保留，新增听审记录；manifest 哈希引用更新，之前的引用另存。
- **9 份 raw/干声副本/增益试听 WAV 的 SHA256 全部保持**。修改前元数据副本与核查回执位于 `I:/AI/asmr-director-sfx-release/2026-10-05`；原权重、失败日志和历史回执保留。
- 录音试听库路径：`I:/AI/asmr-director-sfx-expansion/2026-10-04/listening`，本轮未修改。

源码工具的默认新样本状态仍是待听；不得重跑旧分析覆盖本次拒绝记录。未来新试验必须单独命名、保留这批失败样本及此次决定。

## 发布范围

本轮发布 `tools/sfx-library` 的素材来源与独立试听准备工具，`tools/sfx-model-test` 的 AudioLDM2 本地/远端生成、分析、外部超时/取消监督与未执行的 Stable Audio Open 适配器；同时发布双语取得/实验/备选说明、既有三份开发记录及本次拒绝结论，更新第三方运行时、固定路线、交接和归档。

不把另一会话的 `/spatial-studio` 应用、测试、配置、记录/spec 混入此次提交。共享交接/路线/归档仅暂存 SFX 内容，工作区保留空间工作台段落与全部源文件。音频、模型权重、环境、缓存和 I 盘回执不进入 Git。

分支：`codex/voxcpm2-product-generation`；远端：`origin`。本记录随提交保存，不能提前声称推送成功或自引用尚未产生的 SHA。实际提交、推送结果、远端 HEAD 一致性及最终保留检查由 Git 与 `I:/AI/asmr-director-sfx-release/2026-10-05/release-verification.json` 确认。此前记录里的“未提交/推送”是历史快照，由这次明确授权覆盖。

## 验证与实际限制

- 本轮只读审查：6 个 Python 工具 AST、2 个源 JSON 可解析；源文件目录没有音频、权重、环境或凭据。
- 沿用并复核历史 Windows 监督的 6 项合成生命周期回执，负责的父子进程清理有确认证据；Open 适配器此前 24 项标准库预检/保留检查，不是模型推理或音质验收。
- 本轮试听拒绝状态核查：3 条 `generated` 状态保留、3 条 `rejected`，无输出失败项保持，9 份 WAV 哈希保持。新鲜进程查询：匹配 SFX 生成的 Python 为 0。
- 提交前检查源文件解析、文档引用、暂存 diff 与确切路径范围；提交后核对远端 SHA，并复核另项 29 份工作区源文件及 9 份 WAV 保持。实际结果写入上述外部发布回执。
- 本轮无模型调用、下载、安装或应用构建。模型候选已被用户否定，不再标为“待听”；Windows 合成监督通过不代表修复了 Codex 对话取消。未实测 5070 Ti 或新模型。

已同步唯一 `docs/ROADMAP.md`、`docs/AI_HANDOFF.md`、`docs/project-archive.md` 和相关 SFX 文档。没有新增顶层路线或另建路线系统。

## English status

The user rejected all three remote AudioLDM2 8-second brush outputs as unusable and paused further model work on 2026-10-05. Local output remains zero. Stable Audio Open and other alternatives were not executed; the recorded-source library is separate and still pending listening acceptance. Source tools and records are authorized for publication, with audio/weights/logs preserved outside Git and unrelated spatial-workbench changes kept local. Audio Quality V1 remains in progress.
