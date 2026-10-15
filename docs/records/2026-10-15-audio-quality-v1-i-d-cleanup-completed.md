# I／D盘项目缓存与旧CosyVoice模型清理完成

Date: 2026-10-15（Asia/Hong_Kong）

Route ID: Audio Quality V1维护；维护完成，父阶段in_progress，SFX暂停。

## 授权与结果

用户先确认“ok，清理一批，然后再看看d盘相关的有没有可以清理的”，完成I盘首批并只读盘点D盘；随后明确“cosyvoice也暂时清理一下。清理完记录一下这次清理”，据此执行D盘纯缓存与独立旧CosyVoice模型包清理。未扩展到其他项目、私人资料或整棵旧实验目录。

| 批次 | 精确范围 | 删除文件／逻辑字节 | 实测卷可用空间增加 | 完成时可用空间 |
|---|---|---:|---:|---:|
| I盘首批 | 253目标：完成下载分片、incomplete、pip暂存、3处pycache、4处Node／Webpack缓存 | 18,659／6,979,773,358 | 9,350,021,120字节，8.708GiB | 22,762,487,808字节，21.199GiB |
| D盘后续 | 5,350纯缓存目标＋1个CosyVoice模型包目标 | 38,328／6,244,248,549 | 6,300,758,016字节，5.868GiB | 6,300,758,016字节，5.868GiB（原为0） |

可用空间是各批操作时的卷快照；之后日志／文档和其他进程的写入会变化，不作为当前空闲的实时保证。I盘128KiB exFAT簇、D盘4KiB NTFS簇，文件逻辑大小、簇估计与实测释放量分开记录。本记录不重复计入当天01:21已完成的49旧缓存叶／8.49GiB清理。

## I盘已执行范围

按[13:39历史盘点](2026-10-15-audio-quality-v1-i-drive-cleanup-review.md)的253精确目标执行。SFX正式26文件与Qwen14文件fresh SHA通过后，删除已有正式副本的下载分片／incomplete；236个非空pip安装暂存叶中没有当前安装引用；16533个纯.pyc及4个精确Node／Webpack缓存叶清空。249目录根全部保留且无嵌套残留，4份精确incomplete文件删除。正式模型、完整环境、原音／参考、源码、构建与junction保留。

历史提案阶段曾被自动审批以blocked by policy拒绝创建脚本，当时没有执行删除。获得用户明确确认后才实际执行。执行中递归删pycache遇到directory-not-empty，保留完成journal、审核7个剩余精确缓存目标，再逐文件删除、逐空目录非递归删除；最终全部完成，未盲目重跑整批。

14:54 HKT核验：650个保护文件SHA、553个工作文件SHA全部保持；正式SFX26＋Qwen14共40文件再次全SHA通过；104候选、210音频资产、3001 HTTP200及build IuS6dk38Xq9OZB0CRWvbQ保持。0模型调用／构建／服务重启。

## D盘已执行范围

纯缓存38,314文件／817,219,397逻辑字节：

- 5,348个纯__pycache__叶中的38,275份.pyc，共634,995,503字节，对应源.py全部存在；7个含Numba等额外文件的混合cache根排除。
- 旧dirty worktree中唯一精确.next/cache/webpack叶的38个.pack／.pack.old，共172,968,959字节。
- 精确runtime/cache/tmp/jieba.cache，共9,254,935字节，源字典完整、可重建。

所有缓存均逐文件删除，保留5349个目录根和Webpack内部目录。未删除工作树／环境／node_modules／完整Next构建或链接。预检核准release_verify中2个原已审.pyc的路径边界，发生在删除前；执行journal5351目标全完成，无中断或跳过。

CosyVoice仅删除D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/cosyvoice/Fun-CosyVoice3-0.5B-2512内14个精确文件：6个权重＋8个配置／词表，共5,427,029,152字节（5.0543GiB），删除前fresh SHA与保留的官方下载etag一致。旧5.17GiB数值是包含外层环境与脚本的总根，不能当成本次模型包释放量。保留模型目录及19个README／git／下载来源元数据、外层.venv的源文件和二进制、实验脚本、原音及参考；其中纯.pyc可属于上述缓存清理。

当前产品源码、profile、voice-pack、启动脚本和3001构建无CosyVoice引用；旧evaluate_round1.py和voice-identity-comparison/generate_cosy_variants.py仍保留，但再次运行前须恢复模型。下载记录保留revision 29e01c4e8d000f4bcd70751be16fa94bf3d85a18及逐文件SHA，可用于日后校验重新获取的模型；本次不自动重新下载。

## 保护核验与限制

15:39 HKT在写本轮文档前核验：

- 143,141个D原生非候选文件的长度／mtime全部保持，40个跨盘／缓存等目录链接不变。
- 652个保护文件全SHA保持（包括当前Whisper model.bin、解释器／profile和既有音频资产），753个主仓及旧worktree工作文件全SHA保持。
- 38,328个删除候选全部不存在；5349缓存根、Cosy环境及19个来源记录保持，来源记录SHA一致。
- 两个worktree的Git状态在文档写入前均不变；当前3001 HTTP200、build仍IuS6dk38Xq9OZB0CRWvbQ，候选104、音频210保持。
- 0推理调用、0构建、0服务重启；没有为清缓存运行测试而重新生成缓存。缓存后续运行可重建，旧Cosy实验需先恢复模型。

GPT／Whisper仍用于产品识别，VoxCPM2 GGUF／CLI／whole-script-compare内decoder仍用于生成；空间Python／HRTF、全部参考与原音保留。.worktrees/audio-quality-v1-round1含未提交修改，.superpowers/tmp含原始CLI备份及音频，均未整根删除。旧历史发布源码快照和可选重复浏览器profile／听评ZIP保留。

本轮只做清理和文档；不宣称新增真实ASR／TTS／H3或浏览器视觉验收。产品父阶段与SFX暂停状态不变。

## 证据与文档同步

证据根I:/AI/asmr-director-release/2026-10-15/disk-cleanup-review：

- approved-i-execution/operation-journal.json、after-verification.json及中断／恢复审计保存I盘实际过程。
- d-cache-approved-audit.json、d-cosy-approved-audit.json保存D盘精确白名单、元数据、模型SHA、源码／生产引用检查。
- approved-d-execution/before-protection.json、fresh-preflight.json、operation-journal.json、target-results.jsonl、after-verification.json保存执行和保护证据。

两个one-shot journal均complete，不能盲目重跑已执行脚本。I盘临时cleanup-result.zh.md曾因D盘已满注明“待同步”，现以本记录为最新完成入口。

同步docs/ROADMAP.md、AI_HANDOFF.md、project-archive.md并将旧盘点标为历史；仅文档产生新的仓库内容变化，原有空间工作及其他会话改动保留，Git索引和HEAD6c90c3d不变。本轮记录未提交推送。
