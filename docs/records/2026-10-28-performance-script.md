# 表演脚本、无台词时间与画面声音设计记录

日期：2026-10-28。状态：`deployed_local`。功能已完成实现、最终隔离验证并部署到本地 3001；实际 H3 成片、浏览器交互及表演语义质量仍有验收边界。2026-10-29用户要求保留当前版本并单独记录推送；Git实际结果以本QA `publication.json` 为准。

## 用户目标与范围

用户指出此前“文案＋分镜”更像配 TTS 的漫剧：若不手动添加空镜，进屋等过渡、介绍后的材质试听、近距离互动等待都没有时间。用户批准保持既有操作顺序，由系统在生成文本时自动安排表演时间，输出可删改的台词与无台词段，然后生成并采用人声，再设计画面与声音、后处理和批跑。

本轮属于现有 Audio Quality V1。其他 SFX 模型实验仍暂停，不新增顶层路线阶段，也未新增独立“传统 ASMR”模板。传统麦前/少说话/全程无对白的创意可使用新的段落结构。

代码基线为已单独推送的近距离互动模板提交 `87d3e493db02f1f370475fdd39fed60e8f030a2c`，简称 `87d3e49`。此前第一人称/逐镜 ASMR 是另一提交 `816d90a`。本轮本地部署不等于提交推送，不沿用历史 Git 发布结论。开始时已有 28 项范围外工作，保留并排除；`unrelated-work-before.json` 为快照，`service-verification.json` 确认最终 28 项未变、75 功能文件与发布副本一致。不要全量暂存脏工作区。

规格：[中文](../specs/2026-10-28-performance-script.zh.md) / [English](../specs/2026-10-28-performance-script.en.md)。固定路线仍见 [ROADMAP](../ROADMAP.md)。

## 已实现的合同

1. 新脚本用 `performanceVersion: 1`、`speech`/`silent` 段落及 `dialogue`/`asmr`/`transition`/`interaction` 用途。自动预算在生成脚本内部根据目标、主题、备注和模板先给表演留时，再写台词，不增加用户必须经过的预算页面。无台词段有描述与明确时长，不提交 TTS；纯无台词工程不依赖人声采用即可继续设计和导出。
2. 采用时保存稳定源段 ID、动作和声音意图。源文案修改、拆分合并与双工作区同步处理旧指令和已生成设计失效。新脚本不再额外叠加每句后的旧规划停顿；旧数据的字段缺省、模板快照和停顿语义保持。台词音频采用后仍用实际 WAV 时长，不为凑目标截断或填充。
3. 交易与近距离互动模板升级 v2，加入不同的 `performancePacing` 和混合示例。前者在介绍后留材质试听/换物，后者留回应等待、安静操作和无实物表演；未选模板按剧情安排动作过渡。旧工程不自动换模板快照。
4. 产品入口使用“设计画面与声音”。新表演提示强调稳定机位、可执行操作和前后道具状态，旧提示保留。无台词主视频声音可以包含实际触发音，不再只描述通用白噪音；每段同时设计独立 ASMR 及已有空间、移动、增益配置。
5. 无台词逻辑段支持大于 0、至多 600 秒。超过 5 秒时先设计至多 120 个连续块，每块不超过 5 秒、总时长等于逻辑段，余量均分，按最多 8 块的有限窗口请求模型。块继承状态，只有整段最后一块收尾；编辑器保留一段并提供逐块编辑、校对与撤回。导出不临时猜测缺失的块内容。
6. ZIP 展开连续块，稳定 ID 使用 `--part-001` 等，第一块沿原参考模式，之后连续参考。保留段/块元数据；逻辑段数与实际任务数分开，台词原 WAV 按逻辑段查找、按导出任务编号落盘。无效时长、缺项、空描述、重复 ID 或过多任务阻止导出。
7. 原版合片保留主视频原音。增强版对台词使用 `overlay` 保留 TTS，对新无台词使用 `replace` 避免两份触发音相叠；缺省旧数据仍为 overlay。独立音效用已有 ComfyUI 节点、D 引擎和 SOFA 后处理，无新增本机 FFmpeg 或服务。改声音 prompt 只重生成音效，改空间/增益/模式只重合增强版。
8. 三轮真实生成暴露预算问题后，新建生成改用独立 `performancePrompts`，既有改写仍用 `rewritePrompts`。新提示直接给语言/非语言预算、字符与段数建议、服务端相同估时方法及 80%–120% 总时长范围；必要取放、进屋、落座明确留独立过渡，避免旧的台词扩写/分句要求与表演时间竞争。结构修复返回具体问题，合法短动作描述门槛已由 6 降为 4 个实际文字，仍拒绝“继续”等占位词。137 项定向通过，第四轮真实复测结构与预算通过，质量限制见下表。

主要实现范围为 `apps/web/src/lib/asmr/` 的 planner、performance-segment、performance-storyboard、schema、voice/edit/workspace、设计与校对、video-package/local-video-package，以及 `apps/web/src/components/studio/` 的创意、脚本、无台词编辑、设计、校对、批量入口；批跑在 `tools/comfy-batch/runner.py` 和对应测试/说明。精确功能清单以 QA `source-manifest.json` 和最终发布清单为准。

## 证据位置与阶段结果

唯一主 QA 根：`I:/AI/asmr_director/qa/performance-script/2026-10-28/`。未向用户输入目录 `I:/temp` 写入产物。

最终综合回执为 `final-verification.json`，状态 `implemented_and_locally_deployed`，归集源码/测试/构建/API/包/部署及限制并完成 SHA 与数量断言。本文保留阶段失败，最终结论以该回执及对应原始日志为依据。

| 范围 | 已有结果与回执 |
| --- | --- |
| 核心定向测试 | `root-tests.log`：6 文件 171 项通过。后续独立审查修复为 `review-fixes-tests.log`：5 文件 78 项通过；测试重叠，不相加。 |
| 最后阶段定向修复 | `long-continuity-tests.log`：2 文件 56 项通过；`planner-clean-prompt-tests.log`：8 文件 137 项通过，配套 lint 无报错。它们分别覆盖长段连续性和独立生成提示，不与前述分组累计。 |
| UI 与采用链 | `ui-receipt.json` 记录最终首轮定向 6 文件 151 项，以及下载计数 2 文件 33 项、逐块校对 2 文件 52 项、ASMR 标签 2 项等后续验证；均为重叠分组。完整 studio 首轮执行被根任务取消，不记为通过。后续 6 文件集成 lint 通过。 |
| 导出 | `batch/verification.json`、`export-tests-final.log`：2 文件 22 项通过；4 文件 lint 通过。涵盖连续块、缺失描述拒绝、任务展开及实际 WAV 时长。 |
| Python 批跑 | `batch/runner-full-py311.log`：Python 3.11 下 136 项通过；涵盖 replace/overlay、提示和处理参数变更的恢复边界、连续块校验与兼容。 |
| 实际 ZIP 干跑 | `batch/exported-fixture/export-verification.json`、`dry-run-verification.json`：真实打包、解压并运行随包 runner；3 逻辑段展开为 5 主视频和 5 音效 payload，原 WAV 字节不变，SOFA 和处理器随包存在；0 网络/H3/TTS。 |
| 首轮全量 | `full-tests-first.log`：2241 通过、12 失败、5 跳过（171 文件）。主要是旧 fixture/旧界面断言需要适配；这是失败历史，不能写成最终全量通过。 |
| 第二轮全量及超时复测 | 文件名 `full-tests-final.log` 实际是中间源码快照：2263 通过、1 超时失败、5 跳过；失败为既有人声长停顿测试超过 5 秒时限。随后同文件 `voice-group-timeout-recheck.log` 46 项通过。后续仍有提示/长指纹改动，不能把两次结果拼成最终整站全绿；最终结果以单独的 full-tests-release 为准。 |
| 最终隔离全量 | `full-tests-release.log`：75 功能文件快照，包含独立新 prompt 和长指纹修复；168 文件通过/3 文件条件跳过，2266 项通过/5 项条件跳过，297.04 秒，无失败。此独立完整运行作为最终 Web 测试结果，不再加上前述历史或定向通过数。 |
| 真实文本 API 初轮 | `live/summary.json`：6 业务/9 上游请求，`deepseek-v4-pro`；4 种脚本及台词/15 秒无台词设计，0 TTS/ASR/H3。纯声音脚本为 5 个无台词段共 60 秒，但其他主题出现预算超量，且设计发现英文约束、占位描述和道具状态问题。已据此调整提示与校验，不把初轮记为导演质量全通过。 |
| 真实文本 API 第二轮 | `live-final/failure.json`：1 业务/2 上游，结构修复后仍失败。复核发现合法的简短动作描述被最小 6 字门槛拒绝，随后已改为最小 4 字并给修复请求清楚的字段原因。不删除本次失败记录。 |
| 真实文本 API 第三轮 | `live-verified/failure.json`：1 业务/2 上游，仍未通过。其修复请求明确首答台词估计 52 秒＋无台词 37 秒＝89 秒，超出 60 秒目标允许的 48–72 秒；修复后仍失败。目录名 verified 不代表通过。这轮之后拆出独立新生成提示。 |
| 真实文本 API 第四轮 | `live-clean/summary.json`：6 业务/7 上游，`deepseek-v4-pro`，门口脚本结构修复一次；四脚本及两个设计通过结构/预算。四脚本估时 52/56/50/60 秒；门口有接衣 10 秒、进屋 10 秒、落座 8 秒，交易有 18/16 秒 ASMR 操作，互动有等待和无实物表演，纯声音为 0 台词/6 无台词共 60 秒。台词设计用实测 WAV 6.25 秒覆盖假元数据 99 秒；无台词 18 秒为 4×4.5 秒英文连续块，replace，模型给静态 close、gain -18dB。概览“六次轻敲”与四块各一次动作仍不一致，不能记为语义/物理连续性质量全通过。 |
| 构建失败历史 | `build-turbopack-unavailable.log`：本机原生 SWC 绑定不可用，Turbopack 失败。后续 `build.log` 的 Webpack 编译与 TypeScript 已过，但页数据阶段找不到 Next runtime 模块而失败。失败日志保留，随后最终构建已恢复。 |
| 最终 lint/构建 | `lint-release.log`：72 文件、0 errors/1 既有 ensureSpeechWorkspaces 未使用 warning。`build-release.log`：显式正确 NODE_PATH、WASM fallback 下完整 Webpack 与 TypeScript 构建通过，build `rfG9d0aAGn_UKKsVC-xYL`；不是只完成编译阶段。 |
| 编译 HTTP 导出 | `http-export.json`：3040 已编译应用实际导出 ZIP，3,037,245 字节，SHA-256 `2c40d205b4a7225e50707ec2379ac8ad69757f9b70c1801291e41d4ba2b60572`；1 个18秒逻辑段展开4任务，0 TTS/H3。这是应用端HTTP验证，与先前 helper 生成的混合ZIP夹具分别留档。 |
| 预览及生产 HTTP | `preview-verification.json`、`service-verification.json`：3040/3001 相同build，8资源、7参考、2日语WAV核对通过，75功能文件一致、28范围外未变；目录与原音保持。浏览器交互及真实媒体生成标记均为 false。 |
| 浏览器 | 本轮 Computer Use 尝试被停止，未完成浏览器交互验收。UI 组件测试或后续 HTTP 验证各按自身范围记录，不能写成浏览器验收通过。 |

Planner 预算和提示定向证据另见 `planner-*.log`；本记录不累计不同时间、相互重叠的通过数。最终 lint 的已有未使用 import 警告保留，未将其误报为零警告。

真实文本 API 四轮累计为 **14 业务请求/20 上游请求**（6/9、1/2、1/2、6/7）；这是不同真实请求的累计，不是把重叠测试相加。前三轮失败及重试均保留；全轮没有实际 TTS/ASR/H3。最后一轮通过结构/预算不消除上述生成内容限制。

实际 ZIP 为 `batch/exported-fixture/performance-fixture.zip`，3,091,403 字节，SHA-256 `eb208109bb6468993b8c26fb68e1888d7872c57772b3b25e8f87390c698553ba`。内容为 1.625 秒台词、12 秒无台词（3×4 秒）及 1.625 秒台词；测试源元数据故意写 99 秒，证明实际 WAV 1.625 秒优先。合成零 WAV 和微型参考图只作为结构测试素材，不能代表音频或画面质量。

批跑首次默认 Python 3.8 跑 136 项产生 19 个错误，原因是既有测试辅助用了该版本不支持的 `str.removeprefix`；随后在 Python 3.11 全部通过。新增 UTF-8 fixture 首次使用系统 GBK 读取导致一错，已显式 UTF-8 修复。导出首轮暴露空块描述未阻止导出的真实遗漏，已补检查和回归。初次日志保留，不伪装首轮全绿。

## 独立审查与修复

审查重现见 `batch/review-findings.json`（修复前证据）。发现并已分别交由所有者修复：

- 下载端误把服务端展开后的任务数与 UI 逻辑段数比较，长段 ZIP 会被错误拒绝；现在按实际展开任务数校验，有 3 段/5 任务回归。
- 校对只修改声音提示、未返回可选 `mixMode` 时，浅合并会丢掉旧 `replace` 并回落 overlay；现在保留既有模式，避免重复声音。
- 校对可提交空的逐块描述，使原本可导出的工程变成不可导出；服务和应用边界增加非空验证。
- 校对界面增加实际逐块变化展示，防止顶层概要不变时用户看不到真正将导出的改动。

`review-fixes-tests.log` 和 UI followup 回执覆盖这些修复。历史重现文件不是当前仍失败的证明。

最后只读复核 `batch/final-review.json` 实证空白块拒绝、顶层和逐块声音模式省略时仍保留 replace、显式变更声音模式拒绝；`batch/final-review-tests.log` 2 文件 17 项通过。同时发现合法 600 秒/120 块设计的前镜指纹有 126,239 字符，超出 64,000 字符字段上限，导致后继镜头不能保存。根任务已改为仅对含 parts 的连续性内容使用固定 128 位摘要，旧无 parts 指纹不变；新增回归验证指纹小于 100 字符、后继仍有效、修改最后一块使后继失效，`long-continuity-tests.log` 2 文件 56 项通过。重现 JSON 保留修复前超限结果，不代表当前仍有此问题。

## 运行器更新包

产物：`I:/AI/asmr_director/artifacts/h3-asmr/ASMR-video-runner-performance-script-update-2026-10-28.zip`，2,841,624 字节，SHA-256 `e5155c3023a2893925ffaaeef82dbdbb1498b9cdccef987a41abd1de64b12950`。仅 14 个运行文件：`runner.py`、`workflow_api.json`、`README.zh.md`、`run.bat` 和 `custom_nodes/asmr_director_audio/**`；不含测试 `project.json`、角色图或台词音频。

由已验证的完整导出 ZIP 提取，替换最新 README；runner、工作流、启动器、节点及处理器逐字节对照当前源码，CRC、包内内容、源 ZIP 保持和未覆盖旧档校验通过，见 `batch/update-package.json`。runner SHA-256 为 `e991cc50d8e8557c49c32c8014cb0a1f15600742ad900563d6c5b0dd154e8fcb`。使用时保留用户已有工程、工作流、素材和 outputs；附带标准工作流仅用于补齐缺失文件，节点需按说明更新至目标 ComfyUI。本次打包不部署服务，不执行 ComfyUI 或模型。

## 本地部署与恢复

2026-10-28 23:46 HKT 完成切换，`activation.json` 记录端口 3001、服务 PID34800、父进程 PID40136、foreground session84893。活动源码 `D:/CodexWorkplace/asmr_director/.local/releases/performance-script/apps/web`，build `rfG9d0aAGn_UKKsVC-xYL`；预览 3040 已停止。常规启动入口 `I:/AI/asmr_director/service/2026-10-16/start-production.ps1`，切换前备份/回退依据 `I:/AI/asmr_director/qa/performance-script/2026-10-28/start-production-before.ps1`。恢复时先核对当前进程和脚本，不从有范围外改动的主工作区直接启动生产。

最终服务核验见 `service-verification.json`：首页与8个静态资源可用，7条参考目录和两条日语WAV内容保持；75功能文件与隔离发布副本相同，28范围外工作未动。HTTP编译导出已在同一build的3040验证，不能改写成已做浏览器按钮操作或真实H3批跑。

## 统一验证汇总

下表每项只登记覆盖最终源码的最新完整运行；旧轮次与定向结果保留在上文，不累计成一个总通过数。日志名称含 final/verified 不能替代结果判定。

| 汇总字段 | 最终可确认值与验收边界 |
| --- | --- |
| `sourceSnapshot` | 基线 `87d3e49`，75功能文件冻结快照；source-manifest记录范围，service-verification确认发布副本一致、28范围外未变。 |
| `webSuite` | `full-tests-release.log`，75 功能文件冻结快照；文件168 pass/0 fail/3 skip，测试2266 pass/0 fail/5 skip，297.04秒。不得再加历史或定向测试数。 |
| `targetedChecks` | 仅按回执列范围与修复目的；最新提示 137 项、长连续性 56 项是独立重叠分组。 |
| `runnerSuite` | Python 3.11 的 136 项通过，`batch/runner-full-py311.log`；包内 runner SHA 与该实现一致。 |
| `lintTypeBuild` | 72文件lint：0 errors/1既有warning；完整Webpack/TypeScript成功（WASM fallback），build `rfG9d0aAGn_UKKsVC-xYL`，见lint-release/build-release。 |
| `textApi` | 四轮累计 14 业务/20 上游；第四轮 `live-clean/summary.json` 为 6/7，deepseek-v4-pro，结构/预算通过。逐块动作数量等语义限制保留，不把重试算成独立业务。 |
| `browser` | Computer Use 停止，未验收；不能被组件测试或 HTTP 结果覆盖为通过。 |
| `httpDeployment` | 3001/PID34800，隔离performance-script源码；8资源、7参考、2WAV及75/28文件核验通过。3040编译HTTP导出1逻辑段→4任务、3,037,245字节；3040已停。启动/回退路径见activation和上节。 |
| `updatePackage` | 14 文件 ZIP 和 SHA 见上节、`batch/update-package.json`；包结构通过，目标机实际执行未验。 |
| `modelMedia` | 本轮实际 TTS/ASR/H3 均未执行；没有最终音视频试听结论。 |
| `gitPublication` | 2026-10-29按用户要求单独发布：75功能文件＋7份文档，基线`87d3e49`；提交与远端SHA、28项范围外保护见本QA `publication.json`。本地部署与Git发布明确分开。 |

## 尚未完成与限制

- Computer Use 已停止，本轮浏览器交互保持未验收；组件和HTTP核验不替代真实浏览器操作。服务已是本轮新build，旧模板build仅为历史。
- 用户已于2026-10-29要求单独Git发布；核对75功能文件、7文档及28项范围外保护，实际提交/远端回执见本QA `publication.json`，不把先前本地部署当成已推送。
- 没有实际 H3 视频/音效生成、目标机 ComfyUI 执行或最终听辨。无实物表演、道具连续性、长表演不重开场和声像听感仍需实际成片验收。
- 新无台词音效按规划时长，视频容器按 24fps 向上补齐；每任务小于一帧的尾部差异可以累计。不能声称整片容器时间精确等于目标或完全无累积偏差。
- 文本 API 可输出结构正确而动作不合理的内容；已知失败驱动了修复，预算和英文校验不替代人工表演判断。

## 2026-10-29 保留现状与Git发布

用户于2026-10-29决定暂时保留现状：当前主要使用基本固定在一个位置、变化较小的镜头，暂不追求参考中的闲聊、接话和小玩笑。先前提出的动作完成条件、额外语义校对、声位细化、时长不足时保留可编辑草稿等方案本轮均不实施；后续按新需求再恢复，不作为默认下一项任务。这是优先级与使用范围的决定，不代表已知问题已修复或视听质量已验收。

本次只更新决策/发布记录，并提交已经测试、构建、部署的75个功能文件及7份文档。源码与冻结清单逐文件核对，保留28项范围外工作；不重新执行模型、全量测试或构建，不重启当前3001服务。已有2266项Web测试、136项运行器测试、lint、构建及HTTP验证的范围和质量边界保持；后续爱哥比较的三次时长失败与39秒拒绝稿审查见[比较记录](2026-10-29-aige-template-comparison.md)。

发布基线`87d3e493db02f1f370475fdd39fed60e8f030a2c`，目标分支`codex/voxcpm2-product-generation`；实际提交、推送/远端SHA与文件保护回执为 `I:/AI/asmr_director/qa/performance-script/2026-10-28/publication.json`，避免自引用提交哈希。

## 2026-10-29 保留现状与Git发布

用户于2026-10-29决定暂时保留现状：当前主要使用基本固定在一个位置、变化较小的镜头，暂不追求参考中的闲聊、接话和小玩笑。先前提出的动作完成条件、额外语义校对、声位细化、时长不足时保留可编辑草稿等方案本轮均不实施；后续按新需求再恢复，不作为默认下一项任务。这是优先级与使用范围的决定，不代表已知问题已修复或视听质量已验收。

本次只更新决策/发布记录，并提交已经测试、构建、部署的75个功能文件及7份文档。源码与冻结清单逐文件核对，保留28项范围外工作；不重新执行模型、全量测试或构建，不重启当前3001服务。已有2266项Web测试、136项运行器测试、lint、构建及HTTP验证的范围和质量边界保持；后续爱哥比较的三次时长失败与39秒拒绝稿审查见[比较记录](2026-10-29-aige-template-comparison.md)。

发布基线`87d3e493db02f1f370475fdd39fed60e8f030a2c`，目标分支`codex/voxcpm2-product-generation`；实际提交、推送/远端SHA与文件保护回执为 `I:/AI/asmr_director/qa/performance-script/2026-10-28/publication.json`，避免自引用提交哈希。

## 文档同步

本轮使用 engineering-development-recorder 的证据与状态记录方法；项目用户规则指定既有 `docs/ROADMAP.md` 为唯一顶层路线，故不引入另一套 initializer 路线文件。中文/英文规格、此记录及 `AI_HANDOFF.md`、`ROADMAP.md`、`project-archive.md` 顶部同步为本地功能已部署，实际视听/语义质量待验，Git发布以本QA `publication.json`为准，进一步优化按用户决定暂缓。后续接手先读取本记录、activation、service-verification及最终综合回执，不用旧阶段状态覆盖已经验证的部署事实。
