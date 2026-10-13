# 2026-10-11 — 句号分段的字数上限粗测：生成完成，听感待对比

## 当前状态

用户要求写一篇文案，以递增字数上限分段，每档生成三次，先粗测再二分；本次切分不用 API，仅按句号。属于既有「人声导演与真实 ASMR 音效质量 V1」，父阶段仍 `in_progress`，SFX 暂停。

用户随后明确「开始生成」，fresh GlobalMemoryStatusEx 可提交内存 8,090,648,576 字节通过原门槛；无模型进程、STOP/批次锁/生成锁后，沿用已说明的温柔参考 `soft_zh` 启动。**真实 TTS 27 次全部 exit0、ASR 0、切分 API 0、自动重试0，已完成12条整篇试听。** session01 从香港时间 2026-10-11 20:14:41 至 20:27:12（UTC 12:14:41–12:27:12），总750.297秒。独立实际调用/参数/PCM/ZIP验收通过；口述全文与听感仍待用户试听，不宣布音质上限已找到。

准备阶段历史：10:35:26 UTC 根可提交内存仅3,598,942,208字节、独立六秒前4,332,183,552字节，均低于4,815,306,368字节，故当时0模型/0新音频并请求释放约1.5GB。该阶段收据保留；未绕过门槛或停止用户应用。后续恢复实际调用与准备阶段0调用不可混称。

## 已完成试听与下载

以下均为同320汉字文案的整篇时长；各列配对 seed 7911 / 7912 / 7913：

| 汉字上限 | 实际段长 | 第1轮（秒） | 第2轮（秒） | 第3轮（秒） |
| --- | --- | --- | --- | --- |
| 80 | 80 / 80 / 80 / 80 | 60.32 | 64.80 | 63.68 |
| 160 | 160 / 160 | 57.28 | 60.80 | 54.40 |
| 240 | 240 / 80 | 60.80 | 62.88 | 61.92 |
| 320 | 320 | 57.92 | 60.32 | 61.76 |

240档第一条长段分别45.76 / 48.96 / 47.04秒，末尾80字段15.04 / 13.92 / 14.88秒。320档每轮就是一次连续完整生成，没有内部拼接。

- 本机同页试听：`http://127.0.0.1:8781/试听目录-soft.html`，12播放器/逐条WAV下载/27各段链接/完整文案。隐藏只读Python服务只绑定127.0.0.1，PID24912，身份与日志为实验根 `listening-server.json` / stdout、stderr日志；3001产品服务没有操作。`listening-page-verification.json` 验证HTTP200、12播放器、页面与320第3轮音频服务字节保持。`open_in_codex` 返回 queued，不能写成已在可见窗口打开。
- 离线试听目录：`I:/AI/asmr-director-length-sweep/2026-10-11-coarse/试听目录-soft.html`；文案 `雨夜回家-原稿.txt`；表格 `sweep-soft-table.csv`。
- 完整下载包：`I:/AI/asmr-director-length-sweep/2026-10-11-coarse/sweep-soft-audio.zip`，85,496,432字节，39 WAV（12整篇＋27原声）＋HTML/CSV/TXT共42唯一条目；全部CRC、解压SHA通过。ZIP SHA256 `ede662b97ca0ebea6db734679dedc30415e14ce9a67684318ae241b731b0c14f`。
- 实际生成汇总 `sweep-soft-result.json`；独立最终验收 `testing/independent/independent-generated-sweep-complete-verification.json`。

## 固定的实验设计

新稿《雨夜回家》为 320 个汉字、359 个含标点字符，16 个句子，每句 20 个汉字。**字数只计汉字，标点不计数且原样送入模型。** 本地以 `。` 拆出完整句子，逐句累加到上限，不拆句、不补后文、不使用语义 API。

| 汉字上限 | 每轮实际段长（汉字） | 每轮段数 | 完整成片轮数 | 实际原生调用数 |
| --- | --- | --- | --- | --- |
| 80 | 80 / 80 / 80 / 80 | 4 | 3 | 12 |
| 160 | 160 / 160 | 2 | 3 | 6 |
| 240 | 240 / 80 | 2 | 3 | 6 |
| 320 | 320 | 1 | 3 | 3 |

单个参考声音共 **27 次实际原生生成、12 条完整试听**，与准备计划一致。不是每档只挑三个小片段，也不将模板文件计作实际调用。三轮配对 seed 为 7911 / 7912 / 7913，各档复用对应轮 seed，每段都使用同一原始参考；不把前段输出作为新参考。

240 档尾段与 80 档第四段文本/同轮种子一致，所以 27 次实际调用只有 24 种唯一文本＋种子配方；相同 SHA 是允许的，不为凑不同文件而改 seed。评价 240 档的长度稳定性应以第一条 240 汉字段为主，尾段 80 汉字不能证明 240 安全。

所有生成段保留完整 WAV，包括模型本来产生的停顿。整篇试听只是按顺序精确拼接各段 PCM，新增间隔为零。无滑动窗口 A+B+C、无只提取 A、无 ASR/裁切/变速/音高/响度处理、无自动质量重试、无平台导入或采用。

## 固定模型与参考

- VoxCPM2 原权重：`I:/AI/voxcpm2-evaluation/models/VoxCPM2-BaseLM-Q8_0.gguf` 与 `VoxCPM2-Acoustic-F16.gguf`。
- 本轮各档一致使用前轮隔离解码修复引擎：`I:/AI/asmr-director-whole-script-compare/2026-10-11-tea/decoder-fallback/voxcpm2-cli-copy-fallback.exe`；SHA256 `b2288e8b4e41b6d6ed97336e31aa9b36beddb561879d8207afc03a9d46073347`。与旧产品 EXE 不逐字节兼容，不能据此把前后引擎差异归为段长效果；产品原 EXE 没有替换。
- 温柔固定原参考：`I:/AI/voxcpm2-evaluation/references/soft-16k-s16.wav`；SHA256 `3c2a7a274ccf8732f888e5c1bbc4dcaed2c07c8e8811e760dd016efcd5bd27b1`；原参考文字为「欢迎光临。本店是预约制门店。请问您有预约吗？您需要喝点什么吗？」。
- True Combined：`--prompt-wav`＋精确原标点 `--prompt-text`＋`-r`，固定 CFG 2 / temperature 1 / timesteps 10 / GPU layers 0 / low-vram。
- 所有档均设置 max steps 800，即最多约 128 秒，不强制生成到该时长。真实输出若达到上限，停止并报告潜在截断，不当作完整可用音频。

## 可恢复执行与验证

实验根：`I:/AI/asmr-director-length-sweep/2026-10-11-coarse`。已保存 `雨夜回家-原稿.txt`、不可覆盖的 `sweep-soft-manifest.json` 和 27 个 canonical request。目录12项现全部完成；准备阶段版本的“尚未完成”不作为当前状态。

脚本 `prepare_sweep.py` / `run_single_native.py` / `run_sweep.py` / `sweep_media.py` 均语法检查通过。每次原生调用最多 300 秒，整批每次会话最多 1800 秒；串行执行、产品生成锁和实验批次锁都核对 owner/token/文件身份后释放。实验根 `STOP_REQUESTED` 可以取消本实验所属子进程；不按旧 PID 或进程名称停止其他任务。内存不足立即退出并保留断点，不循环等候。

恢复时跳过已通过配方、实际命令、EXE/参考 SHA、输出 SHA、退出状态与锁释放检查的成功任务。仅未启动模型的内存 guard 或启动前取消允许另存尝试收据、原配方恢复；已实际启动的失败须检查原因，不自动质量再生。完整试听恢复也复查全部来源、文本、PCM 字节，不仅相信旧 `success` 标记。

已产出 12 条 `soft-capNNN-takeNN-full.wav`、27 条独立原声、对照 CSV、带播放器的目录和 ZIP。独立审计逐段解析RIFF/PCM，与实际CLI保存采样数/收据/SHA/命令对应；27实际调用严格串行，EXE与参考SHA、配对种子和全部控制参数匹配。12条整篇逐字节等于完整来源PCM连接，所有首尾静音保留；CSV/目录/结果绑定一致，ZIP42条目完整CRC/SHA通过。**完成的是实际生成与文件验收；没有ASR、音高估计或听感通过声明。**

历史生成恢复命令（本轮已完成，不需再启动；仅保留可重现入口，后续新实验不能覆盖现有结果）：

```powershell
python -S 'I:\AI\asmr-director-length-sweep\2026-10-11-coarse\run_sweep.py' 'I:\AI\asmr-director-length-sweep\2026-10-11-coarse\sweep-soft-manifest.json'
```

如果 `STOP_REQUESTED` 存在，先读取取消原因与所属进程退出证据，并按用户恢复授权处理；不要直接删锁或清除另一任务的停止请求。普通女生若被选择，可用 `prepare_sweep.py normal` 建立独立命名空间，不能覆盖温柔计划；双声音计划相应为 54 次调用、24 条整篇试听。

已知恢复边缘：如果ZIP创建后、最终result写入前中断，既有ZIP会拒绝被覆盖，需核验现有归档后人工恢复；不宣称任意阶段均自动续跑。本轮没有触发，该限制未通过改代码绕过。

## 如何解释后续结果

用户试听重点为音色随段落上扬、后半电流杂音、整体语速与段间音色接续。文件核验只证明完整可读取与原声保持，不能证明音质或文字都正确。保留三轮全结果，不挑最好的一次掩盖随机差异。

粗测后先按三次听感找出可用/明显变差的区间，再在该区间按句号边界缩小。每句 20 汉字，本稿能测试的实际段长以 20 汉字为步长。若 320 档也都可用，结论仅是本稿与本参考在 320 汉字仍可用，上界未找到；需要扩展更长文案再测，不能把 320 宣称成模型全局上限。

## 已完成的无模型审计

独立配方核对通过：12组逐字重构原稿、27请求配方/计数/种子/固定参考一致。睡眠替身取消测试约0.687秒结束所属子进程，独立旁证进程保持存活、锁释放正确；没有载入任何语音模型。测试特设的内存与路径只属于 `testing` 命名空间，规范27请求与真实门槛没有改动。第二次启动前内存 guard 的纯阻止收据可恢复，真实启动后失败拒绝自动重试；批次期限状态静态检查通过。

PCM夹具逐字节完整拼接、首尾静音保留、额外gap为零；错误种子、参考绑定、缓存分组均被拒绝。测试是控制逻辑与字节完整性验证，不是27次真实声音实验或音质验收。独立收据：`testing/recipe_counts/independent-static-recipe-audit-20261011-sweep-recipe-counts.json` 与 `testing/independent/controls-fixture-result.json`。根终态计划/脚本SHA/内存：`preparation-status-final.json`。

## 保护与范围

初始、preparation-final、resume-start 与 generation-final 保护收据均独立留存，确认产品 96 候选 / 224 资产 / 782 历史文件 / 10 参考、既有采用原声/旧完整试听/前轮 tea 101 文件与原 17 后端文件均零增删改。最终 `watch-preservation-generation-final.json` / `original-backend-files-generation-final.json` / `runtime-generation-final.json` 全通过；14运行检查全true，27实际成功/12完整试听与收据绑定，0ASR/API/重试/生产写入。

最终12:33:19–20 UTC真实模型/原生监督/批次/watch进程均0，三产品锁/批次锁/STOP标记均无；3001无listener保持，8781为所属PID24912只读Python服务、loopback/目录身份/HTTP200/12播放器均匹配，保留运行供试听。fresh GMS可提交9,432,137,728字节、物理可用7,207,636,992字节，GPU611MiB已用/5384MiB空闲。准备阶段0原生结果/0WAV是历史快照，不代表当前27＋12成品数量。

最终运行审计首次因默认Python缺少 `str.removesuffix` 中止读取，修为兼容切片后仅恢复runtime检查、未重扫SHA或重复模型；独立错误记录 `generation-audit-compatibility-repair.json` 明确是审计脚本兼容问题、两次审计都0模型/旧收据SHA保持，不是生成失败。所有原生生成始终27次exit0。

未修改产品代码、生成策略、识别阈值、参考资料、3001 服务或既有录音；HEAD `e06f8ca`、分支 `codex/voxcpm2-product-generation`、共享 dirty 内容保留。本轮未提交或推送。
