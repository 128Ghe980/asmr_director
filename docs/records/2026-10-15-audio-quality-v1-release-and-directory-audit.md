# 语音工作流发布与目录盘点

Date: 2026-10-15（Asia/Hong_Kong）

Route ID: Audio Quality V1（现有命名阶段，不新增编号路线）

Status: 本轮语音功能实现/验收完成，父阶段in_progress；发布及目录盘点结果以本记录后续证据和Git为准。

## 原始要求与发布范围

用户要求「先记录一下，推一版」，并询问D/I盘为何有很多asmr_director前缀目录。沿用已有单一路线docs/ROADMAP.md、规则AGENT.md与docs/PROJECT_MANAGEMENT.md、恢复docs/AI_HANDOFF.md和档案docs/project-archive.md。开发记录技能按现有等价文档体系适配，不创建竞争的CURRENT_ROADMAP或新顶层阶段。

发布短句/整段并存、同步源文/独立结果、真正自然短句、无对白分镜、折叠时间线、原音重新识别、拼音及有限文字差异的试听确认。包括这些功能依赖的整体试听、排序和错误提示；另一会话的独立空间工作台、空间渲染实验及Qwen运行记录保持本地，不混入本次代码发布。配置/README采用分别暂存，保留共享文件上的其他工作区改动。

四份实现记录和四份中英文规格一并发布，后续从[双工作区记录](2026-10-14-audio-quality-v1-speech-workspaces.md)、[真实短句/时间线](2026-10-14-short-sentences-and-collapsible-timeline.md)、[识别修复](2026-10-14-paragraph-recognition-and-particle-alignment.md)、[安全切点/人工确认](2026-10-14-safe-cuts-and-manual-text-confirmation.md)恢复。

## 完成与验证

上一轮完整工作区1821测试/4跳过、Python152、全量类型/源码ESLint、正式WASM/Webpack构建、真实五切片PCM守恒、原99候选和205音频保护、新5pending发布与3001接口通过。记录区分首次第四句失败、修复后的真实4/5分析、SHA绑定复用前三条、人工试听与自动检查，未把复用或模拟receipt冒充真实新推理/生产确认。

此轮发布范围从HEAD8417ede开始，先审查代码依赖与混合hunk，再验证最终暂存树，不能把包含未提交空间代码的工作区验收当作发布树验收。文件清单、源快照和结果放I:/AI/asmr-director-release/2026-10-15。验证源码副本放既有D:/CodexWorkplace/asmr_director_release_verify下的新日期子目录，只复用node_modules链接；构建/测试临时输出放I，不触碰现有3001服务、模型或浏览器工程。

实际发布树Vitest1785 passed /3 skipped，130文件通过/2跳过；TypeScript和src/config ESLint通过，指定现用ASR Python后152单元测试通过。首次误用系统Anaconda Python缺opencc，日志保留，改用现识别环境后通过，无模型推理。303条本地Markdown引用检查全部存在。源码/内容审查确认129暂存路径，23排除文件SHA全部保持、真实暂存导入0缺失、未包含生产密钥/音频/模型/构建。最终正式构建与提交推送收据见同一release根。

最终暂存代码的WASM/Webpack正式构建已通过，staged-build.log；生成路由包含整体试听、整段重识别、人工确认，不包含未发布的空间工作台页面/API。现用3001仍为上一轮IuS6dk38Xq9OZB0CRWvbQ/PID16004快照、HTTP200，此次发布没有替换服务。

I盘exFAT的非链接readlink错误码辅助现也保存到apps/web/scripts/exfat-readlink-compat.cjs，与上一轮已验收辅助SHA完全相同。README同步外盘构建配置和人工确认使用步骤，不改产品算法。

## 未完成、边界与风险

Audio Quality V1整体仍进行中，真实SFX暂停，垂直运动/通用更柔等不因这次发布变成完成。中文强制对齐只做可行性评估，未下载或安装，轻声准确率/峰值资源/速度需实际试验。第一、五句试听确认与采用由用户操作；生产不自动确认或采用。没有新截图：既有浏览器限制不绕过。

这次仅盘点目录，没有授权或执行删除、移动、压缩、合并、停服务、清理模型或试听文件。链接入口和物理存储要分开计数；目录名多不等于重复安装多套系统。完整盘点附后。

## 同步与发布证据

更新docs/ROADMAP.md、docs/AI_HANDOFF.md、docs/project-archive.md的最新入口，保留历史记录。未改变既有顶层路线或父阶段状态。

真实提交SHA、远端分支、推送结果和剩余本地改动以Git及I:/AI/asmr-director-release/2026-10-15/release-verification.json为准，不预写虚构的成功或SHA。模型、参考音频、用户音频、API密钥、原始QA大文件及构建产物不进入Git。

## D/I目录用途与体积盘点

2026-10-15约00:05 HKT只读快照，跳过junction/reparse重计，不读取大模型内容。范围是D:/CodexWorkplace下四个asmr_director前缀根，以及I:/AI下58个既有asmr-director前缀根；加上本次发布QA为59。不是所有磁盘/所有AI模型的总量。

| D盘目录 | 自身逻辑大小 | 用途 |
|---|---:|---|
| asmr_director | 1.474GiB | 主工程、依赖、历史worktree和备份 |
| asmr_director_runtime | 24.487GiB | Python/识别环境及历史模型实验 |
| asmr_director_release_snapshot_20261006 | 4.47MiB | Oct6发布源码快照 |
| asmr_director_release_verify | 9.14MiB | Oct6/7验证源码树，快照在本次新验证子目录创建前 |

D四根自身合计25.975GiB。runtime主要是GPT/ASR环境18.558GiB及历史CosyVoice5.170GiB；GPT目录中的Python/Whisper仍由现识别代码引用。主工程旧.worktrees/audio-quality-v1-round1约0.753GiB，保留共享dirty；.superpowers约0.186GiB含旧CLI原文件备份。两个发布目录node_modules链接共用主工程，不是两份新模型环境。本次在既有release_verify父目录增加日期源码子目录做发布树验证，同样共享依赖。

D工程30个构建/缓存链接和runtime/assets、runtime/tmp链接均跳过。后两者当前已指向I:/AI/asmr-director-runtime-storage/{assets,tmp}，所以D路径名存在不等于内容仍占D空间；这个链接状态是本轮只读发现，不是本轮执行迁移。

I59个根有75,576文件，逻辑16.2949GiB。exFAT分配簇128KiB，逐文件向上取整估计24.8873GiB，多8.5924GiB；不含目录/文件系统元数据，不能当精确系统占用。没有枚举错误/reparse重复。

| I盘用途 | 根数 | 逻辑GiB |
|---|---:|---:|
| 功能QA、修复、备份/构建证据 | 44 | 4.2402 |
| 当前素材/运行依赖等混合目录 | 8 | 2.2763 |
| 原声实验、完整听评音频 | 5 | 1.3472 |
| SFX模型实验 | 1 | 8.4302 |
| 本轮发布QA | 1 | 此快照时仅小量盘点记录 |

最大I目录asmr-director-sfx-model-test约8.43GiB，正式safetensors4.1671GiB、下载.parts4.1627GiB及.incomplete0.0586GiB；模型实验已暂停，不把下载分片直接判定为可删除。所有前缀根中的Next .pack缓存合计2.82GiB，WAV合计2.49GiB。whole-script-compare约0.8385GiB主要是修解码器的EXE/.lib，当前整段生成EXE仍引用它；build-cache约0.9303GiB，distance-listening约0.6859GiB，length-sweep约0.5696GiB。

目录多的原因是此前每次功能、修复、实验都另开证据根，保存日志、源码保护、临时构建和原声，长期没有统一归档。多数并非完整模型/工程的重复安装；确有源码快照、缓存和下载中间文件。现用模型/参考/原声、当前构建与历史证据必须分别识别后再讨论归档/清理，此轮未执行。

盘点证据：I:/AI/asmr-director-release/2026-10-15/disk-audit/d-director-logical-sizes.json、d-director-detail-sizes.json、d-current-paths.json、directory-purpose-summary-20261015.json/.csv、inventory-asmr-prefix-20261015-valid.json。首次元数据脚本Split重载错误的无valid版本只作诊断，体积结论仅引用valid快照。
