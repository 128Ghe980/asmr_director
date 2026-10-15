# I盘项目清理盘点（13:39历史提案）

Date: 2026-10-15（Asia/Hong_Kong）

Route ID: Audio Quality V1维护；父阶段in_progress，SFX暂停。Status: 13:39只读提案的历史快照；后续已按用户确认完成I盘及D盘清理，见[最新完成记录](2026-10-15-audio-quality-v1-i-d-cleanup-completed.md)。下文“尚未删除／待确认／blocked”仅陈述提案当时状态。

用户准备清理I盘项目相关资料。单遍盘点项目及既有Qwen/Vox评测根，跳过reparse：98,633文件，39.511GiB逻辑／50.059GiB簇分配估计；其中asmr-director前缀及asmr-spatial-studio约17.326GiB分配估计，其余约32.733GiB。I盘为exFAT、128KiB簇，可用约12.9GiB；簇估计不等于实际可释放字节，不扩展到其他项目或私人资料。

## 已核验的首批提案

253个精确目标、18,659文件，共6,979,773,358逻辑字节／9,049,866,240簇估计字节（约8.43GiB）。目录仅提议清内容并保留根，incomplete只提议删精确文件；没有执行脚本或删除。

| 范围 | 簇分配估计GiB | 依据 |
|---|---:|---|
| SFX六组完成下载分片与两份incomplete | 4.287 | 正式26文件fresh SHA全部匹配完成回执，536.part和536sidecar已有正式副本 |
| Qwen两份incomplete | 0.819 | 0.6B CustomVoice的14正式文件fresh SHA通过 |
| Qwen非空pip安装暂存叶 | 0.848 | 236非空目标／1025文件；不涉及正式.venv，保留temp/gradio及reference-previews原音 |
| 三处Qwen Python编译缓存 | 2.060 | 16533个.pyc，无其他类型及链接 |
| 新旧发布验证的三个webpack叶及一个Node编译缓存 | 0.414 | 25文件；保留完整build、cache元数据、junction和发布收据 |

独立复核三个Qwen根的15个安装／启动元数据（.pth、editable finder、direct_url、pyvenv.cfg、启动脚本），对241个pip暂存路径引用0，读取错误0；安装暂存里有第三方源码副本，不能表述为全部没有源码。

其他可选重复资料约0.65GiB：两份备份侧Chrome profile逐文件SHA等于原侧；四个听评ZIP全部92条与旁边现存WAV／辅助文件一致。它们未纳入首批提案。两个不同profile含各自Local Storage/Session Storage，原侧及浏览器项目状态保留。完整Qwen模型/环境也未纳入，不因当前未运行就视为废弃。

## 运行保护与证据

3001仍HTTP200、build IuS6dk38Xq9OZB0CRWvbQ；保留manual-text-confirmation完整根、product-assets、voice-work、runtime-storage原件及原音。whole-script-compare旧目录中的decoder-fallback EXE实际仍被当前启动脚本引用；voxcpm2-evaluation内两个GGUF、CLI、参考仍被production profile引用，不能整删旧实验根。

13:39 HKT独立复核：650个保护文件SHA与552个工作文件SHA在写本记录前全保持，104候选不变，未调用模型／安装／下载／构建／重启。工具拒绝了生成含递归删除代码的清理脚本，返回blocked by policy、没有更具体原因；进程未创建，脚本和operation-journal均不存在，实际删除0。等待用户确认具体清单，不重跑旧清缓存脚本或绕过拒绝。

证据根：I:/AI/asmr-director-release/2026-10-15/disk-cleanup-review。project-footprint-inventory.json、model-download-audit.json、runtime-build-audit.json、qa-duplicate-audit.json、reviewed-cleanup-plan.json、before-protection.json、readonly-final-verification.json。清单为时点快照，未来执行前重新检查进程、精确路径、重解析点、文件元数据及模型副本完整性。

同步ROADMAP／AI_HANDOFF／project-archive维护入口；产品代码、路线状态和Git HEAD6c90c3d保持，未提交推送本次文档。
