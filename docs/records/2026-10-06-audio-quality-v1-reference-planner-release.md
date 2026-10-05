# 参考音频、原话识别与工程策划累计发布

日期：2026-10-06（Asia/Hong_Kong）。路线：既有 **人声导演与真实ASMR音效质量V1**，
父阶段仍进行中，沿用唯一 [ROADMAP](../ROADMAP.md)，不新增路线或文档框架。

用户明确要求“ok，记录一下，推一版”。本轮授权自 `6b04ddb` 后参考上传、原话识别、
GPU故障提示与工程策划修复的累计提交/推送；此前各功能“未提交/未推送”是历史验收
快照，由本轮授权覆盖。实际提交SHA、推送结果、远端一致性以Git和外部收据确认，
此随提交保存的记录不提前宣称尚未完成的推送。

## 已交付范围

- VoxCPM2网页MP3/WAV参考上传，名称/选段/试听、可选准确原话、原子追加配置，
  保存后更新目录并选中，刷新/取消/生成互斥。初次正太音导入只执行一次，原15秒
  参考保留。[导入记录](2026-10-05-user-reference-audio.md) /
  [中文](../superpowers/specs/2026-10-05-user-reference-audio.zh.md) /
  [English](../superpowers/specs/2026-10-05-user-reference-audio.md)。
- 选择中文/英语/日语/韩语后本地识别选段，在可编辑框中供人工校对，再由用户保存；
  新上传默认8秒并建议3–8秒。明确参考使用模式与当前范围/长文连续生成分别选择。
  复用既有Faster Whisper CPU/int8/离线模型，共享语音锁、180秒总期限及退出确认，
  不下载模型或自动发布参考。[识别与诊断记录](2026-10-05-audio-quality-v1-reference-asr-and-gpu-recovery.md) /
  [中文](../superpowers/specs/2026-10-05-reference-transcription-and-generation-recovery.zh.md) /
  [English](../superpowers/specs/2026-10-05-reference-transcription-and-generation-recovery.md)。
- 工程独立策划稿、切换前保存、保守旧全局稿迁移/显式恢复、切换取消与迟到保护。
  官方DeepSeek创意请求关闭思考并按时长分配有限输出预算，截断仍拒绝且共用时限。
  [策划修复记录](2026-10-05-audio-quality-v1-project-planner-repair.md) /
  [中文](../superpowers/specs/2026-10-05-project-planner-state-and-output.zh.md) /
  [English](../superpowers/specs/2026-10-05-project-planner-state-and-output.md)。
- cuBLAS初始化故障安全映射503并显示具体可操作提示；不自动重试、换seed、切CPU或
  裁短已保存参考。补齐本功能独立构建目录的Git/ESLint忽略。

## 验证与真实边界

历史功能验收分别为参考上传11文件168项、策划修复10文件149项、识别及GPU回归
11文件239项、Python标准库11项。它们有重叠，不能相加成一个全量测试数。
相关TypeScript/ESLint/正式构建日志均已保留。本次发布只重新验证隔离后的暂存源树
与文档/路径/保存状态，结果见下方收据；不重新执行模型或生产构建。

实际证据：原3001工程切换正确，3分钟末世机械表主题生成《末世归途的礼物》22条/
204字，用户后来已采用成工程；实际3分钟成片/创作质量不作验收声明。中文前8秒
识别得到“干嘛一直盯着我看有什么好看的”，手改成功；其他三种语言只有代码回归。
原15秒WAV读取后cuBLAS初始化失败，一次独立8秒参考短句13.922秒成功生成1.44秒，
**原15秒恢复与克隆听感仍未确认**，故障日志也不能单独证明显存耗尽。

用户在后续使用中又添加了带原话的8秒“正太音”和14秒“正太音2”，当前目录已为
5项，默认仍 `soft_zh`。本轮按发布前真实状态保护参考/profile和工程素材，不用旧
3项/138文件快照覆盖用户新增内容；也不读取或恢复浏览器localStorage。

## 提交范围与保存

提交具体参考/策划源代码、相关测试、README、三组双语契约及开发记录、共享路线/
交接/归档中的对应内容。另一会话独立 `/spatial-studio` 源代码、渲染改动、配置及
文档保持工作树未提交；共享文件只暂存本轮内容，原工作区字节保持。
音频、模型、运行profile、环境、缓存、构建和I盘证据均不纳入Git。

发布前fetch确认当前HEAD与远端分支同为 `6b04ddb76e55064168088d057ca3378e422fa689`，
初始暂存为空。分支 `codex/voxcpm2-product-generation`，远端 `origin` /
[128Ghe980/asmr_director](https://github.com/128Ghe980/asmr_director)。只做正常推送，
不force或改写已有历史。源树快照来自Git暂存索引，验证时使用现有依赖且不安装。

外部发布证据根：`I:/AI/asmr-director-reference-planner-release/2026-10-06`，
保存发布前动态基线、隔离暂存源树检查、提交范围/文档引用检查、最终素材与另项源文件
保护、服务状态和 `release-verification.json` 中的真实HEAD/远端SHA/推送结果。
历史证据根分别为 `asmr-director-reference-import`、`asmr-director-project-planner-repair`、
`asmr-director-reference-asr-repair` 下的 `2026-10-05`，不要重跑其首次快照或模型诊断。

服务地址保持 **http://127.0.0.1:3001/**；本轮不重启或清理用户运行锁。
重启方法见识别记录，PID/目录数量是当时检查结果，后续操作前仍须核对。
SFX模型工作继续按用户要求暂停；真实SFX、垂直运动、通用更柔表达仍是音质V1
未完成内容。唯一ROADMAP、HANDOFF及归档已同步，不改变顶层路线。

## English checkpoint

The user authorized publishing the cumulative reference upload, editable local transcription,
GPU initialization diagnostics and per-project Planner repair. Their implementations and
feature-specific verification are complete; Audio Quality V1 stays in progress. The isolated
8-second voice test succeeded, while recovery with the original 15-second reference and
listening quality remain unverified. SFX model work remains paused. Unrelated spatial edits,
user media and runtime configuration stay local; actual delivery is proven by Git and the
external publication receipt, without a self-referencing commit hash in this record.
