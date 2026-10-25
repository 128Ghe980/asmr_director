# 项目存储整理与规则修正（2026-10-25—26）

状态：已完成；迁移、清理、路径修正、服务恢复及验证均有回执。归属既有 Audio Quality V1 的工程维护，不新增产品路线。

## 原因与用户约束

此前错误地把用户提供 `I:/temp/文生视频.json` 的位置当成交付输出目录，并在共享母目录 `I:/AI` 中不断按任务新增 `asmr-director-*` 平级目录。用户明确要求立刻整理、清理并记录规则。本轮对这两种目录使用方式作统一修正。

- 源码和文档：`D:/CodexWorkplace/asmr_director`。
- 唯一外置数据根：`I:/AI/asmr_director`，按 `artifacts/qa/runtime/service/cache/archive/tmp` 组织；功能和日期只在内部展开。
- `I:/temp` 输入只读；不在其旁生成包、日志、验证文件或缓存。
- 仅操作核实归属的项目文件；共享模型、其他项目、用户输入不移动、不清理。

完整规则：[STORAGE.md](../STORAGE.md)。已同步项目 `AGENT.md`、`PROJECT_MANAGEMENT.md` 与用户全局 `C:/Users/Yuki1/.codex/AGENTS.md`。

## 完成的迁移

1. 本轮 H3 的两个交付包、两个展开目录、两个验证目录从 `I:/temp` 迁到项目数据根，共 6 项；可自定义时长的新包位于 `artifacts/h3-asmr/`，旧包归 `archive/h3-asmr/`。
2. `I:/AI` 中 85 个已核实项目目录全部同卷迁入项目根，计 88,157 文件、16,506,397,342 逻辑字节。迁移不是释放磁盘空间，二者不能混计。
3. 模型、原始音频、405 个生产 WAV、参考音频、运行状态完整保留。名为 test、tmp 的目录不自动判定为可删除。
4. 旧路径到新路径记录在 `I:/AI/asmr_director/storage-map.json`。历史原始回执仍保留当时的路径和哈希；旧路径不是未来执行指令。
5. 启动脚本最后一处 D 盘旧 QA 输出 `node-cache` 迁入 `cache/node-compile/production`，2,852 个文件、13,860,736 字节逐文件 SHA256 一致。同步 NODE_COMPILE_CACHE 并隐藏重启原构建，旧缓存路径没有重建。完整映射合计 92 项。

## 防止再次散落

测试与工具的输出入口统一到项目 `qa/`；Vitest worker 的 TEMP/TMP/TMPDIR 指向项目测试临时目录；Python 测试使用专用目录，外置盘不可用时小型文件回退仓库 `.local/tmp/`，并加入 Git 忽略。当前 H3 使用说明、包及可重跑验证脚本同步新目录。

运行配置、启动脚本、VoxCPM2 profile 和 D 盘 junction 同步迁移，使用既有生产构建恢复服务。没有部署未验收的功能、调用真实 H3 或修改用户浏览器工程数据。

## 证据与验证

证据目录：`I:/AI/asmr_director/qa/storage-cleanup/2026-10-26/`。

- `migration-before.json`：完整迁移计划、其他项目根清单与输入文件 SHA256。
- `migration-moves.json`：85 项移动完成、旧目录剩余 0、用户工作流 SHA256 不变。
- `migration-verified.json`：逐目录文件数及逻辑字节核验。
- `runtime-stop-receipt.json`：精确停服进程与活动任务核验。
- `runtime-verification.json`：17 项 HTTP 均 200，主页、JS/CSS、目录、5 条参考音频及 2 条生产音频的内容 SHA256 与迁移前一致；13 个 profile 路径和 26 个 junction 可达。
- `cleanup-candidates.json`、`deletion-manifest.json`、`deletion-summary.json`：删除 25 个纯 webpack 缓存目录和 1 个逐文件核对的旧 H3 展开副本，共 268 个文件、3,546,007,567 逻辑字节（约 3.30 GiB）。保留 ZIP、编译代码、模型、音频及浏览器状态；删除后服务 HTTP 200。
- `inventory-before.json`、`runtime-audit-before.json`：原始盘点和配置审计，从源码 docs 临时位置迁入证据目录。
- `vitest-paths.log`：2 个文件的 19 项测试通过，验证包导出和音频后处理在新测试临时目录下工作。
- `node-compile-cache-move-receipt.json` 与 `final-verification.json`：最终服务复验通过，17 项 HTTP/哈希与迁移前一致，旧散根及旧 H3 输出均为 0，用户工作流未变，其他项目根无缺失。最后生产 Node PID 27232，使用原发布树和构建。

H3 最新包：`I:/AI/asmr_director/artifacts/h3-asmr/H3-ASMR-12-custom-duration.zip`。21 个文件逐项匹配 ZIP 与源码，SHA256 `fe02a7ff2bbb1b0121bfb63d4ce34fe4a8c18aff544cf926b45d7febdda22678`。本轮 136 项 Python 定向测试通过，随后仅改 README 时未重复运行测试，重新核验了 21 个包文件；日志与验包记录在 `qa/h3-asmr/storage-migration/`。原 ZIP 另存 `archive/h3-asmr/H3-ASMR-12-custom-duration-pre-storage-migration-20261026.zip`；旧初版只保留 ZIP，重验脚本改从 ZIP 解压到当次 QA 目录。

路径修改另通过 13 个 Python 文件 AST、15 个 TypeScript 文件静态语法检查，并单独实核 TEMP/TMP/TMPDIR 与 `os.tmpdir()`。没有为目录改动重跑整个网页测试套件或重建生产发布。真实模型调用 0，不能据此宣称 H3 音质已验证。

路径代码检查证据另见 `qa/path-consolidation/code-defaults.json`。原始配置备份仅保存在项目本地证据目录，不在报告中披露配置内容。

当前运行说明也同步了新路径：网页 README、VoxCPM2 中英文 README、距离试听和 SFX 工具 README、第三方运行环境文档及音效素材/模型文档。历史开发记录和原始回执不批量改写，避免篡改当时证据；顶部增加迁移说明并引用路径映射。

## 文档同步与范围

沿用仓库既有 `docs/ROADMAP.md` 唯一路线以及 `AI_HANDOFF.md`、`project-archive.md` 记录体系；不为本次维护另建竞争路线。其他项目、未确认独占的共享模型目录、独立 HTTP 服务不在此次清理范围。
