# 两篇新文案的正式语义长生成试听

Date: 2026-10-10
Route: 人声导演与真实 ASMR 音效质量 V1（in_progress）
Status: done（本轮两篇制作、采用、整体下载与验证）；音质V1父阶段仍in_progress，听感待用户判断。

用户核实昨日两条试听实际使用 `clip` 模式、手动四段拼接后，要求再来两篇新文案试听。本轮在原3001系统使用正式 VoxCPM2 语义长生成配方，不将昨日的短段试听改称为正式裁切验收。本轮只生成音频与留档，没有生产源码修改、构建、提交或推送。

证据目录在2026-10-09冻结，实际运行跨香港时间午夜至2026-10-10：`I:/AI/asmr-director-standard-two-scripts/2026-10-09`。本记录日期以实际交付日为准。

## 文案、工程与当前输出

| 声音 | 新文案与真实工程 | 当前结果 |
| --- | --- | --- |
| 普通女生 `normal_zh` | 《雨后清晨喝茶·普通女生》；`asmr_20261009_160227`；258字符/228汉字 | 10个语义单元全部 `passed` 并采用，完整WAV **62.280020833秒** |
| 正太02；catalog「正太音2」；`user-dd2a4e32-e72d-4e80-bf7d-96611831b52b` | 《末世归家的生日礼物·正太02》；`asmr_20261009_163920`；282字符/252汉字 | 10个语义单元全部 `passed` 并采用，完整WAV **74.22秒** |

交付永久副本：

- `I:/AI/asmr-director-standard-two-scripts/2026-10-09/普通女生-雨后清晨喝茶.wav`：11,957,808字节，SHA256 `219f6bb8c716a83614da23f544d67416952489909f9a1daccb81e5586aa48f3b`。
- `I:/AI/asmr-director-standard-two-scripts/2026-10-09/正太02-末世归家的生日礼物.wav`：14,250,284字节，SHA256 `0a615e4540b7d60a351278ecec7bfd6463530e78c3cd9a6f9ab6ca9b335e1dea`。

两WAV均为系统原生下载的48kHz、PCM16、双声道原声整体试听。完整文字分别在 `normal-script.txt`、`shota02-script.txt`，真实采用工程在 `normal-project.final.json`、`shota02-project.final.json`。

两篇使用独立新工程和clip ID，没有复用昨日的采用资产。初稿每单元3个自然子句，普通女生局部边界调整后第8/9单元为2/4子句，正太02第6/7单元为2/4子句；各单元10–50字符，完整动作或意思保留。预备planner的112.25/120.75秒只是编辑估计，实际时长从WAV读取。

## 正式生成配方

- 每段实际为 `provider=voxcpm2`、`generationMode=long_text`、`referenceMode=with_reference_text`；带同一声音的参考音频和参考文字。
- 每个clip均 `semantic_unit=true`，通过项目真实函数建立目标和后文窗口；`longText.analysisProvider` 与 `plan.provider` 均为 `project_segments`，以当前语义单元为唯一目标组，不让外部planner再次改变该边界。
- 目标＋后文最多16子句，转换后最多500字符。非末段各子句末标点转为“……”，后文不足时使用既有中性补句配方；正式ASR定位与安全检查后只保留开头目标单元，剔除后文和补句。
- 真正末单元无后文或补句，保留自然句末标点或补句号，仍完成ASR与首尾核对。
- 逐篇、逐单元串行生成。只有组 `checkStatus=passed`、识别 `stage=complete` 且trace/source/裁片身份一致的候选采用；`review` 与完整原音保留候选均不采用，不切换为 `clip` 模式交差。
- 系统「整体预览」按台词顺序连接已采用原声，保留正常段后等待和原音自然停顿；没有音高、语速或空间加工。

普通女生首单元真实实例：27.52秒完整原音提取为约5.540秒目标，文字100%一致，`two_sided` 实际静音区5.92–6.27秒，正式组字段通过。完整原音仍保留，未把后文原音当作目标采用。

## 局部异常与处理

普通女生第8单元首轮及一次局部重生成均为 `review`：后文「续」识别为「蓄」导致边界验证未通过。两条旧候选与完整原音保留，均未采用；没有降低识别或边界阈值。

仅将第8单元最后一句移到第9单元开头，精确保留整个文案字串和标点。`normal-boundary-proof-v2.json` 与 `normal-v2-ui-preservation.json` 核对全文SHA、clip顺序/ID及第1–7/10单元的context、输入、fingerprint和已采用资产一致，只有第8/9单元需要重生成。两个新目标正式生成均 `passed`，最终10段全部采用。

实际识别差异仍保留warning：第3单元杯「耳→儿」，文字95.0%；第9单元「续→蓄、轻→清」，93.75%；第10单元「轻→清」，96.5517%。这些满足现有文字90%路径并通过独立安全边界核验，不据此认定所有字差都是识别器错误或音色已合格。

正太02首单元原候选有「门外→弯弯、啦→了」3字差，正式检查为review，保留未采用；仅重新生成该单元，新seed通过，文字94.7368%，仍保留「啦→了」提示。第6单元因短后文「戴→带」造成衔接不确定而review；同音并不足以跳过严格后文边界守卫。

仅将第6单元最后一句「你一直都记得。」移到第7单元开头，精确保留整个文案字串、原逗号与句号。`shota02-boundary-proof-v2.json` 与 `shota02-v2-ui-preservation.json` 核对全文SHA、clip顺序/ID及第1–5/8–10单元context、输入、fingerprint保持；只重生第6/7单元，新目标各100%并passed，裁片4.33/10.42秒。原第7单元虽然此前passed，目标已变化，保留历史但不采用。

正太02最终第4单元「贴→接」文字96.2963%，第5单元「厂→场」96.1538%，连同首单元的啦→了均保留warning。贴→接不是同音，不能统一解释为同音识别误差；用户仍须听审。

两个工程各实际产生13条候选，共26条：20条最终采用、4条review保留未采用、2条原目标passed但边界变更后已失效的历史候选。每条实际native attempts1、automatic quality retries0；这些局部手动重生均计入历史，不宣称本轮只有20次模型生成。

## 已完成的验证

- `normal-gate-summary.json`：10/10正式候选安全通过、最终工程10/10已采用、pending0/review0；当前context/稿件、声音与参考、计划、ASR及裁切来源逐一绑定。
- `normal-final-preview-verification.json`：正式采用绑定与原生PCM精确拼接通过。完整WAV恰为2,989,441帧，字节与10段原声及标准等待组成的预期WAV完全相同；无额外音频、漏段或重复。各段后的等待保持原策略，最后一段之后的等待不写入整体试听。
- `shota02-gate-summary.json`：10/10正式passed且10/10已采用，pending0/review0；异常候选和原目标历史在candidateHistory内保留。
- `final-twenty-unit-gate.json`：20个最终目标全部正式生成/采用与来源检查通过，14个文字matched、6个文字different但满足既有阈值，26候选及所有WAV保留。两稿所有Unicode/标点不改，仅各自8/9或6/7边界移动，其余context/input/fingerprint精确不变；15个边界修改前已采用资产在最终工程中仍是同一asset/candidate。
- `two-final-previews-verification.json`：两篇各105项轻量绑定检查共210项全通过，并分别完成精确PCM/WAV拼接、字数/顺序/采用/等待核验；无模型调用、无修改项目或音频。正太整体恰为3,562,560帧/74.22秒；普通女生62.280020833秒及SHA与先前下载一致。
- `normal-preview.png`、`shota02-preview.png`、`final-workspace.png` 与两篇final工程JSON：真实页面已采用计数、整体音频与下载，以及系统导出的采用状态。最终原tab1回到正太02，整体预览74.2秒与下载链接可用。
- `browser-persistence.json`：在原tab1实际reload，切换普通女生再返回正太02；两稿文字精确、两个工程各10条采用均刷新后保留，四项检查true。
- `standard-preview-verifier-selftest.json`：临时独立验证器的无模型合成fixture通过，覆盖正式绑定、拒绝review/顺序变更、mono→stereo PCM复制、0.35秒精确静音、末尾0.6秒等待不写入、非零等待与额外frame拒绝。这些是临时验收工具检查，不是生产代码回归或构建。

正式组内ASR与裁切验证已逐条执行，整体试听另做完整顺序和精确拼接检查，没有额外加载模型重跑两篇整稿ASR，也没有用整稿文字相似度替代正式边界验收。生产源码未修改，因此未跑无关生产测试或构建。

最终20条候选所报告pipeline耗时合计2,605.810秒，其中native TTS749.894秒、CPU ASR1,854.680秒；全部26条实际候选pipeline合计3,307.008秒。这里是逐任务报告耗时之和，不是从有缺口的watch推断绝对wall-clock或峰值。CPU ASR是本轮主要耗时；6次额外生成均为明确的局部手动处理，有保留证据，没有自动盲循环或质量重试。

## 内存与服务

开始时3001服务已不存在，只隐藏独立启动已验证的 `.next-generation-oom-production`，build `jzycOB_1_hvvzeCLn6eiE`、Node PID8088；未停止旧PID。历史PID2592已复用为svchost，不能按旧收据停止。显式保持既有I盘工作根和整体预览临时根，没有更改生产配置文件。

内存guard按历史ASR峰值4.010GB＋768MiB余量，门槛4,815,306,368字节。首轮可提交内存余量5.116GB通过；后降至约4.25GB时暂停，保留已完成录音，待用户明确释放内存后，7.402GB guard通过继续普通女生受影响两段。正太02批次前6.969GB guard通过，最后三个局部目标前6.636GB guard通过。

首轮runtime窗最多1800秒，之后有两个续窗；首续窗之间约74秒缺口，不宣称全程连续采样。三窗采样最高worker RSS4,003,688,448字节、GPU已用5372MiB，最低freeVirtual1,975,980,032字节；均未观察到重型模型重叠。运行中余量下降与启动前guard判定是不同时间点，不据此宣称模型OOM或无风险。

`watch-runtime-final.json`：9项检查全部true，0speech workers、0watch workers、3把锁不存在，Node8088仍为3001唯一listener且HTTP200，6个历史空run目录保留，HEAD不变、Git index空。三个runtime采样器自然到时或收到stop marker后正常退出；`candidate-watch-stop-confirmation.json` 另确认两个只读候选watcher均自然exit0，没有停止模型或服务。

## 范围、保护与剩余事项

`watch-preservation-final.json` 保护收据已通过：基线70候选→96，旧70条候选值及相对顺序、manifest header保持；172资产文件→224，新增52个WAV，唯一改变为追加候选的manifest，既有音频文件无改变/丢失；570历史文件→782，新增212文件，旧历史无改变/丢失；10参考/profile文件无新增/改变/丢失。212新增历史文件来自26个longtext trace各8文件及4个review的 `failure.json`（22×8＋4×9），不是额外未知重试。审计不读取大模型权重。26条新增候选只属于本轮两个工程，旧录音和异常历史不删除。

`watch-delta-final-reviewed.json` 19项严格检查全部true，26候选恰为每声音13条，与26个真实trace一一对应；52新增WAV恰为26完整候选及26目标组文件。所有26个seed实际唯一，各声音全程固定同一reference identity；最终20采用passed/ASR complete，剩余4review＋2旧目标passed失效历史完整保留，最终manifest在保护收据后稳定。

首个 `watch-delta-final.json` 的唯一失败是临时审计器把trace `plan.json` 的包装对象直接与 `result.plan` 比较；包装实际含 `plan`、targets、project/clip、sourceFingerprint、context等字段。已修正为比较内部 `plan` 并独立绑定包装project/clip/source/context，最终reviewed收据全通过。原false收据保留且reviewed明确记录更正；没有修改音频、候选、生产源码或阈值，也不是模型生成失败。

共享checkout的空间/Qwen/预览/识别源码和旧dirty文档内容保持，没有reset、stage、提交或推送。浏览器持久化核验范围为这两个新工程；不将该四项收据扩大为原热汤面全部DOM字段核验。旧候选、原音/素材与参考的保护由上面的独立文件/manifest收据证明。

本次遵循 `AGENT.md` / `docs/PROJECT_MANAGEMENT.md` 的既有legacy路由。同步本记录、`docs/ROADMAP.md`、`docs/AI_HANDOFF.md`、`docs/project-archive.md`，不初始化新的 `.engineering-project.yml` / `CURRENT_ROADMAP.md` 路线。音质V1父阶段仍 `in_progress`，SFX暂停，不新增顶层路线。正式 `passed` 只证明本文所列文字/边界和交付合同；听感、音高/语速/音色稳定性待用户试听。

本轮两条完整试听已完成。后续根据用户实际听感决定是否局部调整；尚未声称长句音高/语速漂移已解决，也未修复历史单次长录音CUDA grid长度限制。短后文「续/蓄、戴/带」在严格90%定位下仍可能拒绝，本轮只合法移动语义目标边界；未来若优化该识别分支，须保持真实quiet、左右独立边界和最终目标核验，不能按同音直接放行或放宽生产阈值。

记录及三个协作文档的引用/存在与 `git diff --check` 检查通过；两WAV、两个final工程、gate/精确拼接/持久化/运行保护收据及真实截图均存在且非空。没有生产代码改动，不额外构建或跑无关生产测试。
