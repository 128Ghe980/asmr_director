# H3 原生 ASMR 批跑与存储整理：发布交接

日期：2026-10-26（Asia/Hong_Kong）。归属现有 Audio Quality V1；不新增产品阶段，其他 SFX 模型工作仍暂停。用户要求记录当前成果、推送一版并交接下一会话。

## 接手入口与下一步

先读 [AI_HANDOFF](../AI_HANDOFF.md) 顶部、[ROADMAP](../ROADMAP.md) 和 [STORAGE](../STORAGE.md)。当前用户关注的是 **H3 直接生成 ASMR 的真实触发音质量**。已完成可运行的试跑包，尚未实际调用 H3，未形成听感或音画同步质量结论。

下一步是在具备原工作流模型和节点的 ComfyUI 机器上试跑，按 12 类触发音逐条试听并记录质量。每类候选数量和每条时长均可设置，默认 12 类 × 1 候选、5 秒请求时长；实际帧数按工作流规则对齐，5 秒对应 124 帧 / 24 fps。不要把模拟输出或干跑 payload 当成真实视频。原工作流自带 prompt 不是提示词参考，12 条 prompt 已依据官方 T2VA 写法重新编写。

- 当前包：`I:/AI/asmr_director/artifacts/h3-asmr/H3-ASMR-12-custom-duration.zip`；旁边保留展开目录，双击 `run.bat`。
- 包 SHA256：`fe02a7ff2bbb1b0121bfb63d4ce34fe4a8c18aff544cf926b45d7febdda22678`。
- [运行说明](../../tools/comfy-batch/ASMR_BATCH.zh.md)、[提示词与官方依据](../../tools/comfy-batch/ASMR_PROMPTS.zh.md)、[实现记录](2026-10-25-native-h3-asmr-batch.md)。
- 原始输入：`I:/temp/文生视频.json`，保持只读。它、生成 ZIP、模型、用户音频和本地服务配置均不提交到 Git。
- 本轮保留源工作流 Ref2VA 16G 权重、20 步和加速配置；结果不能直接解释为未优化官方权重的质量基准。

## 固定目录与服务

源码根 `D:/CodexWorkplace/asmr_director`；唯一外置数据根 `I:/AI/asmr_director`，内部按 artifacts、qa、runtime、service、cache、archive、tmp 组织。禁止重新向 `I:/temp` 写产物或在 `I:/AI` 新建本项目平级功能/日期目录。全局 AGENTS、项目 AGENT 和管理规则已同步。

迁移了原 I 盘 85 个项目目录、本轮 6 项 H3 产物及 1 个 D 盘专属 Node 缓存；`storage-map.json` 共 92 项映射。旧散根和旧 H3 输出均为 0。删除 25 个纯 webpack 缓存子树与 1 个经过逐文件核验的重复展开包，释放 3,546,007,567 逻辑字节；模型、用户输入、原音、参考音频和其他项目保留。[完整清理记录](2026-10-26-project-storage-cleanup.md)。

常驻网页仍是 `http://127.0.0.1:3001`，使用已验收的独立发布树 `D:/CodexWorkplace/asmr_director_release_verify/2026-10-25-inspector-selection/apps/web`，dist `.next-inspector-selection`、build `X5v7do9VMxFCgxLxrIEdt`。规范启动入口现为 `I:/AI/asmr_director/service/2026-10-16/start-production.ps1`。目录迁移时已更新运行配置、profile 和 26 个 junction，恢复同一构建；未来先实时查询监听和生成锁，不照历史 PID 直接停进程。不得直接将含未完成改动的主工作区构建替换常驻服务。

## 本次提交范围与遗留工作

分支 `codex/voxcpm2-product-generation`，基线提交 `88f03c4`。此次纳入 H3 无参考文生批跑、12 类提示词、可自定义时长、测试、目录规则、输出路径和当前使用文档；没有更改产品音频流程，也没有重部署网页功能。

工作区仍保留此前会话的 **27 个路径**，不纳入这次提交、不覆盖、不删除：空间音频工作台四个新目录的 16 个文件；空间 DSP 实现及测试、音场导航、eslint/tsconfig；以及 `.gitignore`、网页 README、第三方运行时文档和 `spatial_d/test_render.py` 的旧修改片段。后四个混合文件仅提交本轮目录/测试路径变更；Qwen 实验文档和 custom trajectory 功能保留未暂存。新 spatial-studio 测试中的路径修正也随该未完成工作保留在本地，不单独提交一个依赖缺失的测试文件。

精确选入/排除路径、工作文件 SHA、残余差异与发布结果在 `I:/AI/asmr_director/qa/handoff/2026-10-26/`。下一会话应检查 `git status`，不能把有意保留的工作区差异当成发布失败，也不能直接 `git add .`、reset 或清理这些文件。此记录沿用仓库既有路线和交接体系。

## 验证与发布核对

- H3 运行器 114 项、转换器 22 项 Python 测试通过；新包 21 个文件逐项哈希、ZIP 校验通过。最后仅改 README 后重新验包，未重复运行代码测试。
- 2 个网页测试文件共 19 项通过；另做 13 个 Python AST、15 个 TypeScript 静态语法检查和测试临时目录实核。既有网页 ZIP→运行器接入结果见 H3 开发记录；本轮没有重跑整站套件或重建生产网页。
- 最终目录迁移核验：17 项 HTTP 全 200，主页、静态文件、目录及音频内容 SHA 与迁移前一致；profile 路径、26 个 junction 及配置 SHA 校验通过，输入工作流 SHA 不变。
- 真实模型调用 0。远端 H3 生成、完整试听、触发音质量验收是待办，不能从测试通过推断完成。
- 便携性边界：部分既有网页测试仍直接采用本机 I 盘路径；其他主机应先配置相应测试根目录，不能把本机通过视为所有操作系统、无 I 盘环境已验证。

原始验证证据位于项目 `qa/h3-asmr/storage-migration/`、`qa/path-consolidation/` 和 `qa/storage-cleanup/2026-10-26/`。本次 Git 推送的实际 commit、远端分支 SHA 和剩余工作区清单以 `qa/handoff/2026-10-26/publication.json` 以及实时 Git 为准。历史记录中的“未提交”与旧绝对路径只描述当时状态；通过上述发布回执和 `storage-map.json` 恢复当前状态。
