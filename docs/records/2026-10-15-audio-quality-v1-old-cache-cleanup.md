# 旧构建与Node缓存清理

Date: 2026-10-15（Asia/Hong_Kong）

Route ID: Audio Quality V1维护；父阶段in_progress，SFX暂停。

Status: 本轮授权的旧缓存清理与保护核验完成。

## 要求与执行范围

用户指出I:/AI/asmr-director-project-planner-repair异常占用，经只读核对，其实际记录/脚本/截图仅约0.13MiB，主要为125.26MiB Webpack缓存和11.66MiB/2335文件的Node编译缓存，I盘128KiB簇放大至约425MiB。用户随后明确授权「先清理一下这种」。

只清理I:/AI/asmr-director前缀历史任务下49个经过逐文件类型、路径、链接及使用状态审查的缓存叶目录内容。当前生产完整构建、最新发布验证根、运行依赖、音频、模型、源码、记录、脚本、锁和候选manifest保持。完整build-cache/泛tmp/实验根不递归删除；混合dev-cache只清webpack子目录，next-devtools-config.json保留。所有缓存根目录与旧junction保留，避免断链。

| 类型 | 目录数 | 删除文件数 | 内容字节 | 128KiB分配估计字节 |
|---|---:|---:|---:|---:|
| Next纯缓存 | 14 | 201 | 1,938,612,690 | 1,955,594,240 |
| 混合dev缓存的webpack叶目录 | 4 | 130 | 275,060,636 | 285,868,032 |
| Node编译缓存 | 31 | 51,637 | 255,131,092 | 6,860,832,768 |
| 合计 | 49 | 51,968 | 2,468,804,418 | 9,102,295,040 |

Node内五条旧8hex.6alnum原子写临时残留也属于同版本缓存，已单独核对；不是模型下载或语音任务临时文件。早期39项审查与最终49项对比额外旧缓存已独立审核，最终名单无重叠/reparse/非缓存文件/保护路径交集。

## 实际释放空间

执行时间01:19:29–01:21:10 HKT。全49目录清理成功，无跳过或错误，根目录仍存在且为空。

I盘可用空间从5,822,087,168字节（5.42GiB）增加到14,940,110,848字节（13.91GiB），实测增加9,118,023,680字节（8.49GiB）。与逐文件簇取整估计略有差别，实测包含删除的子目录元数据等；没有声称精确只由文件内容决定。D盘未做缓存删除，可用75,345,920字节为当时快照。

用户指定的project-planner-repair根剩23个记录/脚本/截图文件，共133,626字节（约0.13MiB/130.49KiB）；缓存根为空并保留，其I文件分配估计约2.6MiB。这里原本无音频或模型。

## 执行与保护

删除只使用原生PowerShell Remove-Item -LiteralPath。每个目标必须解析为I:/AI指定任务范围内的绝对路径；目标及祖先/后代均不能是reparse点，禁止保护路径祖孙重叠。先全清单预检，再执行前重新检查缓存文件名白名单、数量/字节及元数据签名；逐个删除经过验证的直接子项，保留目标根，不跨壳拼接命令。操作journal每目录记录成功结果；未知中断不能盲目重跑。

执行前核对当前3001 build IuS6dk38Xq9OZB0CRWvbQ/启动器与dist、无ASR/Vox/Next build/安装任务或生成锁。保护整个I:/AI/asmr-director-dual-workspace/2026-10-14/manual-text-confirmation、release、product-assets、runtime-storage、voice-work、whole-script-compare和SFX根，不触碰生成器EXE或参考模型。

结束核验49根全部为空且存在；104条候选manifest SHA不变，210个音频资产文件名/长度保持，原4已采用WAV及15.36秒整段原音SHA不变。3001页面/build、引擎目录、整段候选接口全部HTTP200。HEAD1f0d651及清理前共享源工作树保持，之后只追加本次文档。0模型调用、0服务停止/替换、0原声或实验结果删除，没有重新构建把缓存再生成出来。

## 证据与文档同步

小型清单/脚本/收据根：I:/AI/asmr-director-release/2026-10-15/cache-cleanup。

- cache-candidates-final-v2-readonly-20261015.json/.csv：最终49项名单；
- reviewed-cache-allowlist.json、d-cache-links-and-live-processes.json：独立审查与链接/运行保护；
- before-protection.json、execution-preflight.json：源/资产保护与路径预检；
- clear-reviewed-caches.ps1、cleanup-execution.log、operation-journal.json、cleanup-result.json：实际执行；
- after-verification.json：HTTP、manifest、音频、工作树、释放空间与例子目录核验。

缓存无备份包，删掉的是可再生成中间产物；实验结论和原始音频保留。更新ROADMAP、AI_HANDOFF和project-archive最新入口，现有单一路线不改。本轮文档尚未提交推送；上一轮语音版本1f0d651已推送，模型/压缩包/音频/完整构建是否进一步清理不属于此次范围。
