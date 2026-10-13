# 2026-10-13 — 字数实验生成方式、听评与文档交接

所属固定路线：**人声导演与真实ASMR音效质量V1**，状态仍为 `in_progress`；真实SFX暂停。本记录按项目现有 `docs/ROADMAP.md` 单一路线和管理规则手工同步，不另建竞争路线文件。

## 意图与发布范围

用户要求「记录清楚，推一版，我准备交接给下一个会话」。本次提交只包含文档：`docs/AI_HANDOFF.md`、`docs/ROADMAP.md`、`docs/project-archive.md`，这些主文档引用的17份此前未跟踪记录、8份双语规格，以及本记录，共29个Markdown文件。记录本机历史工作不等于发布其代码。

本机仍有未提交的已采用语音预览/下载、台词排序、拼音容错、重新识别连接提示、生成内存提示和独立空间工作台等代码、测试及配置改动。它们留在 `D:/CodexWorkplace/asmr_director` 共享工作树；下一会话先检查 `git status`，不要覆盖或回退。这次不提交 `apps/web`、`.gitignore`、README/配置或 `docs/THIRD_PARTY_RUNTIMES.md`。提交前基线HEAD为 `e06f8ca75b6b60568ce0c882af8fb95d266ee7b7`，分支 `codex/voxcpm2-product-generation`，暂存区为空；fresh fetch后与远端为0 ahead / 0 behind。

I盘实验音频、参考、模型、生成脚本和冻结JSON/ZIP是本机材料，未纳入Git。新的远端checkout可阅读本次记录，但不会自动拥有这些材料或本机未提交功能。

## 实际生成方式：直接A，完整保留A

最近40/80/100字对比与此前普通女生、温柔参考80/160/240/320字粗测，先按句号拆成完整句子，再按汉字上限累加；汉字计数不含标点，送入模型的文字保留自然标点。每次VoxCPM2只生成当前段A，带固定参考音频与对应参考台词（True Combined），完整保留A的原声。参考台词属于参考录音，不是目标A的后文。

没有A+B+C滑动窗口、补后文或中性填充、ASR定位裁切、只提取首句、调速/音高/响度/交叉淡化。完整分段PCM按顺序连接，额外音频停顿为0。8秒模型调用间等待是编排等待，不插入音频。以前产品长文本使用后文窗口再提取目标的历史仍成立，本次实验没有修改产品默认生成方式。

原稿《雨夜回家》共320汉字/359含标点字符，每句20汉字：

| 汉字上限 | 每轮实际分段 | 普通女生 | 温柔参考 |
| --- | --- | --- | --- |
| 40 | 40×8 | 3轮 | 未测 |
| 80 | 80×4 | 3轮 | 3轮 |
| 100 | 100＋100＋100＋20 | 3轮 | 未测 |
| 160 | 160＋160 | 3轮 | 3轮 |
| 240 | 240＋80 | 3轮 | 3轮 |
| 320 | 全文一次 | 3轮 | 3轮 |

配对seed7911/7912/7913；同隔离引擎、GGUF、max_steps800、CFG2、temperature1、timesteps10、GPU layers0、low-vram。两种参考对比只更换原参考及其对应台词，包含参考时长/节奏/音量差异，未证明纯音色单因素因果。生成guard仍为4,815,306,368字节；后续新任务必须fresh检查，不沿用旧内存快照放行。

## 当前用户听评与保留结论

- **40字**：切分太细，第1轮有一段前后语气不太一致，其余都不错。
- **80字**：很均衡，是当前本稿/原普通女生参考/本引擎参数下的优先段长。
- **100字**：第3轮出现过一次末尾稍微变尖，其他都不错。
- **160/240/320字普通女生**：此前反馈变尖、变快，不可用。
- **温柔参考**：整体偏快、声音偏小，基本无法用；待用户提供新参考再测。

40/100的问题未指定具体段号或秒点，不能归因到拼接边界，也不能把100的问题定位到20字尾段。80是本次经验优选，不是通用模型硬上限，尚未改产品默认；40和100仍整体不错。冻结结果中的 `listening_pending` 保留为生成时历史状态，当前用户听评以文档为准，不重写旧JSON/ZIP。

## 本机材料与恢复入口

- 新40/100根：`I:/AI/asmr-director-length-sweep/2026-10-13-normal-40-100`。原稿 `雨夜回家-原稿.txt`，请求清单 `sweep-normal-manifest.json`，结果 `sweep-normal-result.json`，单段 `*-request.json` / `*-native-result.json`，完整及分段WAV全部保留。36次真实调用全exit0，6完整成片/42WAV；无新增ZIP。
- 旧80/160/240/320双参考根：`I:/AI/asmr-director-length-sweep/2026-10-11-coarse`。`sweep-normal-manifest.json` / `sweep-normal-result.json` 与 `sweep-soft-manifest.json` / `sweep-soft-result.json`，各27次原生调用/12完整成片。新页直接引用旧80，不复制或重生成。
- 当前对比页文件：`I:/AI/asmr-director-length-sweep/2026-10-13-normal-40-100/normal-40-80-100.html`。URL `http://127.0.0.1:8782/2026-10-13-normal-40-100/normal-40-80-100.html`。
- 旧双参考页：`I:/AI/asmr-director-length-sweep/2026-10-11-coarse/compare-normal-soft.html`，URL `http://127.0.0.1:8781/compare-normal-soft.html`。

2026-10-13 **20:44 HKT**鲜读快照：3001/8781/8782均无listener，无匹配模型或扫档进程，两个试听URL的HEAD请求均不可用；文件仍在原位置。不要沿用历史PID操作不明进程。若用户要求恢复当前页，核对8782未占用后，用现有Python从父目录启动只读服务即可，无需载入模型：

```powershell
python -m http.server 8782 --bind 127.0.0.1 --directory I:/AI/asmr-director-length-sweep
```

若后台启动，按Windows规则使用 `Start-Process -WindowStyle Hidden`，记录本次新PID和日志后核对页面HTTP状态。本次交接未启动服务或模型。

## 验证与后续边界

独立只读核对三份manifest、原生命令脚本及完整PCM连接代码：分段与全文字符逐字相等，命令将 `request.text` 直接传给 `-t`，`--prompt-wav` / `--prompt-text` / `-r`是原参考。该核对未运行模型或扫描音频/权重。原独立文件/参数核验详见下列实验记录。

提交前文档验证通过：白名单恰为29份Markdown、无产品代码；293个相对Markdown引用均存在且纳入Git，`git diff --cached --check`通过。独立只读复核确认生成方式、用户听评、发布边界及服务快照一致。58个共享文件（57个非文档文件和 `docs/THIRD_PARTY_RUNTIMES.md`）SHA保护检查无差异；不重复产品构建、TTS、ASR或API实验。实际提交SHA和远端一致以Git及 `I:/AI/asmr-director-length-sweep/2026-10-13-normal-40-100/documentation-release-2026-10-13.json` 收据为准，收据仅在检查及推送后落盘，不能将本段视为预先成功声明。

磁盘调查仍为只读，未删除/移动/压缩。20:44快照D余量129,388,544字节、I余量8,581,414,912字节；旧GPT Python/Whisper仍被默认ASR引用，不能整删。下载分片等约5.72GiB只是候选，尚未获清理指令。下一会话可继续音质V1内的段长/参考选择；本次交接未执行新的生成、产品代码发布或磁盘清理。

## 相关记录

- [40/100补测、当前听评与磁盘调查](2026-10-13-audio-quality-v1-40-100-and-disk-audit.md)
- [普通女生四档对照](2026-10-12-audio-quality-v1-normal-reference-length-comparison.md)
- [句号分段字数粗测](2026-10-11-audio-quality-v1-sentence-length-coarse-sweep.md)
- [此前生成方式与隔离引擎说明](2026-10-11-audio-quality-v1-listening-feedback-and-generation-clarification.md)
