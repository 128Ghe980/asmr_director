# ASMR Director 固定 Roadmap

Last updated: 2026-10-06

本文件是项目顶层路线的唯一硬来源。`docs/AI_HANDOFF.md` 可以总结当前状态，`docs/project-archive.md` 可以记录历史，但它们都不能定义一套与本文件竞争的路线。

## 当前优先级

2026-10-06 用户授权参考栏发布并交接其他会话：提交两轮紧凑布局、浏览器localStorage/工程JSON边界及对应记录，沿用76项回归/构建/桌面窄屏播放证据并检查隔离暂存源树。新发布收据确认真实Git与远端结果，不提前写推送成功。旧3001服务已停止，按离线实态保护后恢复同一构建到3001/PID9716；下一会话需核查终端服务存活。空间工作台改动保留本地、音质V1进行中、SFX暂停，不新增路线。下方UI未提交是交付时快照，由本次授权覆盖。见 [发布交接记录](records/2026-10-06-audio-quality-v1-reference-toolbar-release.md)。

2026-10-06 参考栏进一步合为一行：144×32px声音选择、240×32px播放器、添加/刷新共用32px工具栏；390px窄屏选择/管理同排、试听下排，表单按需展开。76项现有回归、两文件ESLint、正式构建/TypeScript与原3001桌面/窄屏/14秒播放验收通过；22台词/标题/timeline/声音选择及150素材/5参考保持。Chrome与内置浏览器工程不同是各自localStorage，README补充当前工程JSON转移边界，未扩大到工程同步。最新 **3001/PID10268/`.next-reference-audio-production`**，替代下方旧运行状态。音质V1仍进行中，SFX暂停；UI追加未提交推送，发布基础5d01621，另项空间改动保持。见 [原参考记录追加节](records/2026-10-05-audio-quality-v1-reference-asr-and-gpu-recovery.md)。

2026-10-06 用户授权“记录一下，推一版”：累计发布参考音频上传/原话识别/GPU故障提示与工程策划状态/长度修复；沿用已保存功能验证与真实浏览器证据，额外核对隔离暂存源树、文档及当前用户新增参考/工程素材。实际提交SHA和远端结果由Git及I盘发布收据确认，不预写推送成功。原15秒生成恢复/克隆听感未确认，音质V1仍进行中，SFX模型暂停；另项空间工作台源码/文档保留本地。下方未提交/未推送为各功能当时快照，由本次明确授权覆盖。见 [累计发布记录](records/2026-10-06-audio-quality-v1-reference-planner-release.md)。

2026-10-05 参考原话识别已交付：新增中文/英语/日语/韩语、所选片段本地识别与可编辑校对，识别不自动保存；“仅参考音频/参考音频＋文本”为参考使用模式，与当前范围/长文连续生成分别选择。新上传默认8秒，既有正太音15秒保持。实际原3001用正太音前8秒中文识别得到“干嘛一直盯着我看有什么好看的”，手改验证后保留待用户校对，未保存重复参考。用户生成失败日志定位到cuBLAS初始化，已增加安全503提示；一次独立8秒参考生成13.922秒成功，原15秒恢复/克隆听感未确认。11个不重复JS文件239项、Python11项、全量TypeScript/本轮11文件ESLint/正式构建通过；138素材/6参考profile/25空间源文件及原MP3保持，无生成进程/锁/ASR临时目录。最新 **3001/PID32132/`.next-reference-asr-repair-production`**，覆盖下方历史运行状态。音质V1仍进行中，SFX模型暂停，未提交推送。见 [交付记录](records/2026-10-05-audio-quality-v1-reference-asr-and-gpu-recovery.md) / [中文契约](superpowers/specs/2026-10-05-reference-transcription-and-generation-recovery.zh.md)。

2026-10-05 工程切换及策划长度故障已修复：策划稿改为按工程保存，切换前捕捉最新修改、取消请求并拒绝迟到回复，旧全局稿保留且归属不明时显式恢复。官方DeepSeek创意策划关闭思考并按时长设置有限输出预算，截断仍拒绝、总时限及一次修复保持。10个定向文件149项、全量TypeScript、7本次文件ESLint与正式构建通过；原3001浏览器实测新项目空白、热汤面原稿恢复，指定3分钟末世主题生成《末世归途的礼物》22条/204字，刷新/往返保存正确，未采用或合成音频。138素材/6参考配置/25空间源文件及原MP3保持。最新 **3001/PID23144/`.next-project-planner-repair-production`**，无生成子进程/锁，3000/3002无监听，覆盖下方历史PID及浏览器不可用状态。父阶段仍进行中，SFX模型暂停，本次未提交推送。见 [修复记录](records/2026-10-05-audio-quality-v1-project-planner-repair.md) / [中文契约](superpowers/specs/2026-10-05-project-planner-state-and-output.zh.md)。

2026-10-05 参考功能交付后的入口修正：用户发现原“深夜回家，小安陪你吃碗热汤面”工程不见，原因是新服务误启3000，而已有项目库保存在浏览器原origin127.0.0.1:3001。已将同一新版恢复3001/PID36780，页面/目录/参考WAV HTTP200且SHA保持，未复制或覆盖浏览器数据；历史单项目快照仍保留。实际浏览器工程显示因工具初始化失败未确认。README/恢复说明固定原地址，见 [导入记录最新运行节](records/2026-10-05-user-reference-audio.md)。

2026-10-05 用户要求可直接添加参考音频。现已增加 VoxCPM2 的 MP3/WAV 上传、名称/选段/试听、可选准确转录、保存后立即选中及刷新目录；通过真实接口将 H 盘“正太音”前15秒加入为 reference_only，原文件/两份旧参考及默认/138工程素材保持。11个定向文件168项、15本功能文件ESLint、全量TypeScript/正式构建通过，生产3000目录3项与WAV回读一致；实际浏览器布局/播放因工具初始化失败未验收，未调用模型验证声音。音质V1仍进行中，SFX模型暂停不变，不新增路线。见 [导入记录](records/2026-10-05-user-reference-audio.md) / [中文说明](superpowers/specs/2026-10-05-user-reference-audio.zh.md)。本功能未提交推送，其他空间改动保留。

2026-10-05 用户试听后明确反馈“相当烂，没法用，先这样吧，记录一下推一版”：远端 AudioLDM2 的 3 条 8 秒刷耳样本听审失败、不可用、不采用；本机成功仍为 0 条。模型测试按用户要求暂停，不再追问主机连接或继续生成/下载/安装；Stable Audio Open 仅有工具准备，未实际运行，不能一并判定声音失败。独立 13 份真实录音库仍待听审。音质 V1 整体仍进行中，真实 SFX 扩展未完成，不新增路线。已更新外部试听状态并确认 9 份 WAV 哈希保持、无残留生成 Python；本轮授权仅发布 SFX 工具及记录，另一会话的空间工作台改动保留在本地。实际提交/推送以 Git 及 I 盘发布回执为准，历史“待听/恢复测试/未推送”状态由本条覆盖。见 [收尾发布记录](records/2026-10-05-audio-quality-v1-sfx-rejection-release.md)。

2026-10-04 历史准备：用户曾明确恢复模型音效测试，准备带外部时限/取消的单条 Stable Audio Open 刷耳试验；当时 3060 6GB 笔记本与 5070 Ti16GB 的连接方式待澄清，尚无新真实音频、下载或安装。该恢复任务现已暂停；音质 V1 继续进行中，不恢复旧 AudioLDM2 批量，不新增阶段。见 [恢复准备记录](records/2026-10-04-audio-quality-v1-stable-open-resume.md)。

当时工具准备已完成：外部监督的 6 项 Windows 进程生命周期检查及 Open 适配器 24 项标准库检查通过，双语单条命令/测试包已备。尚未执行真实模型，主机信息不再作为当前待办；不把超时监督验收当对话中断修复或声音验收。

2026-10-04 只读补充：用户提出可用另一台 5070 Ti 16GB 主机，已扩展本地模型调研为 Stable Audio Open 1.0、Stable Audio 3 Medium、TangoFlux 和 AudioGen。16GB 从公开资料看值得测试，但未连接或实测该主机；原 CPU 优先建议针对当前 6GB 笔记本。Blackwell 运行支持、可取消/超时和真实护理听感仍需未来核查；未下载或生成，音质 V1 仍进行中。见 [更新调研](audio-quality/MODEL_SFX_ALTERNATIVES.zh.md)。

2026-10-04 模型 SFX 尝试收住：用户要求不能循环一条摩擦声，随后报告长时间卡住，明确先调研其他方案。本机 AudioLDM2 下载 26 文件并校验完成，但原生加载/CUDA 内存错误后成功 0 条；远端公开演示完成 3 条 8 秒刷耳后耗尽额度，全部听感待确认。当前无遗留生成进程，151 个保护文件变更 0。已停止运行/安装/下载/付费调用，完成本地 LiteRT CPU 与专用云端音效接口调研；推荐以后先做有强制时限、可取消、失败即停的单条 CPU 试验，当前未实现该监督机制。内存错误不能据此全部归因于 6GB 显存；未采用音频、未修复对话中断、未提交推送。音质 V1 仍进行中，付费路线暂缓，不新增阶段。见 [实验记录](records/2026-10-04-audio-quality-v1-sfx-model-test.md) / [备选调研](audio-quality/MODEL_SFX_ALTERNATIVES.zh.md)。下条“本地模型未启用”为取得素材时的历史快照。

2026-10-04 开始真实 SFX 素材扩展，用户选择贴耳护理（掏耳/刷耳/按摩/喷雾）。复核旧 6 份录音，新增 7 份逐项 CC0 的 HQ MP3 预览，独立 I 盘试听目录现为 13 份候选；真实刷耳仍缺，普通刷擦保留准确标签。26 个干声/试听 WAV 的 SHA/格式/frames、13 个旧文件保持、实际浏览器播放/筛选及桌面/390/320px 检查通过。试听副本仅调增益，全部听感待确认。主工作台库选择/采用/撤回及 SFX 空间仍未接入，本地 AI 模型未启用；音质 V1 继续进行中，不新增顶层阶段。见 [取得记录](records/2026-10-04-audio-quality-v1-sfx-acquisition.md) / [中文取得说明](audio-quality/FREE_ASSET_ACQUISITION.zh.md)。未提交推送。

2026-10-03 累计发布与交接：用户明确要求“记录一下，推一版，我要交接给其他会话”，已整理自 `8f22021` 后的批量生成、磁盘故障恢复、音频总览/颜色、原生批量下载修复、连续/新镜头模式及分镜颜色/TXT ZIP。实现与验收完成；沿用最新 12 个定向文件 / 211 项、16 文件 ESLint、全量 TypeScript/生产构建和实际 8 份 TXT / 138 素材保持证据，未重跑此前 1,028 项历史全量套件。分支 `codex/voxcpm2-product-generation`，真实提交 SHA/推送结果由 Git 与 `I:/AI/asmr-director-storyboard-export/2026-10-03/release-verification.json` 确认，不提前宣称已推送。下面“未提交/未授权”仅为功能当时快照；本轮已授权累计发布。父阶段仍进行中，真实 SFX、垂直运动与通用“更柔”仍待完成，不新增路线。见 [发布交接记录](records/2026-10-03-audio-quality-v1-batch-workflow-release.md) / [恢复入口](AI_HANDOFF.md)。

2026-10-03 分镜颜色与逐段 TXT 批量下载已验收：列表现有分镜按钮右侧绿色可用、灰色待生成、暖黄色需更新，不增加列数，保留连续/新镜头切换；顶部批量下载含音频/分镜标签，分镜仅导出现有有效完整 H3，每段一个 UTF-8 TXT、保留原段号并统一 ZIP 文件夹。12 个不重复定向文件 / 211 项、16 个相关文件 ESLint、全量 TypeScript 与生产构建通过。实际 22 段为 8/13/1，浏览器下载 8 份 TXT / 10,645 字节，CRC / 精确提示词字节 / 原编号通过；桌面 / 390 / 320px 无横溢出，29 条文案 / 标题 / timeline 及 138 素材 SHA 保持，console 空，viewport 恢复，0 模型调用。最新 3001/PID14196/`.next-batch-generation-production`/HTTP200，临时包目录空、无生成锁；父阶段仍进行中，未提交推送。见 [开发记录](records/2026-10-03-audio-quality-v1-storyboard-status-export.md) / [中文说明](superpowers/specs/2026-10-03-storyboard-status-and-batch-txt.zh.md) / [恢复入口](AI_HANDOFF.md)。下方验收进程为历史快照。

2026-10-02 分镜「连续镜头/新镜头」双模式及列表右侧32px图标切换已验收：逐段偏好刷新保存、面板/列表同步且不跳选段，首段新镜头，连续需相邻可用前镜，新镜头主要按背景剧情且可无前镜；手动/批量复核模式来源音频，串行批量用刚存前镜。9文件181项、TypeScript/相关文件ESLint/生产构建通过；实际桌面/390/320px无横溢出，29条可见文案/timeline及138素材SHA保持，console空，0模型调用。最新3001/PID38384/HTTP200，父阶段仍进行中，未提交推送。见 [开发记录](records/2026-10-02-audio-quality-v1-storyboard-reference-modes.md) / [中文说明](superpowers/specs/2026-10-02-storyboard-reference-modes.zh.md)。下方验收进程为历史快照。

2026-10-02 批量下载传输故障已修复验收：旧10段20,982,790B ZIP服务端完整准备/读取，但内置浏览器二进制fetch失败；改为JSON准备结果→原生token GET下载，默认二进制POST兼容。27项定向测试、TypeScript/变更文件ESLint/生产构建通过；实际浏览器下载文件10段21项全CRC/原声SHA/后处理PCM及时长校验通过，独立20段21,015,839B包亦通过。可见文案/timeline及138素材SHA保持，0模型调用。最新3001/PID32092/HTTP200，父阶段仍进行中，未提交推送。见 [故障记录](records/2026-10-02-audio-quality-v1-batch-download-recovery.md) / [恢复入口](AI_HANDOFF.md)。下方运行状态均为历史快照。

2026-10-02 分段音频颜色标识已验收：段号上方绿色已采用、灰色待生成、暖黄色已生成未采用，与总览共用分类；选段显示文字状态，生成中/失败提示保留，候选读取未完成或失败用空心标识。5个定向文件45项、TypeScript/变更文件ESLint/生产构建通过；实际22段色点10/10/2，桌面/390/320px无整页横向溢出，台词/timeline及114素材哈希保持。最新3001/PID17804/HTTP200，证据 `I:/AI/asmr-director-audio-markers/2026-10-02/marker-verification.json`。未提交推送，父阶段仍进行中，见 [开发记录](records/2026-10-02-audio-quality-v1-batch-generation.md)。下方运行进程保留为历史快照。

2026-10-02 音频总览新增项验收完成：按非空voice段落互斥统计「已采用/待生成/已生成未采用」，采用优先、当前ready同段只1、来源及long-text stale过滤，声音options不失效；工程级候选共用、选段本地filter、加载/错误依赖值—。7个不重复定向文件/66项（UI35/domain12/API19）、全量TypeScript、变更文件ESLint及生产Webpack构建通过，未重复此前1028全量历史测试。浏览器10/10/2共22段，切11段仍8候选/9.6秒显示；原audio_missing仍12未采用含2有候选，规则不变。22台词/timeline/采用及114素材含manifest SHA均保持，无增删；1182×892/390×844/320×740无横溢出、四按钮在视口、consoleerrorwarn空，截图未保存。0实际TTS/文本模型/H3、未操作用户候选，采用撤回放弃/刷新由App模拟HTTP覆盖。最新3001/PID6176/`.next-batch-generation-production`/HTTP200，旧2212经无生成核对后停；证据根 `I:/AI/asmr-director-audio-overview/2026-10-02`，overview-verification.json/assets-before-overview.json。本次未提交推送，音质V1父阶段仍进行中。见 [中文 spec](superpowers/specs/2026-10-02-project-batch-generation.zh.md) / [English spec](superpowers/specs/2026-10-02-project-batch-generation.md) / [原开发记录新增节](records/2026-10-02-audio-quality-v1-batch-generation.md)。

2026-10-02 批量音频磁盘满故障修复验收完成：D剩余0导致保存失败及空runtime lock，非候选容量问题。assets112文件/84,795,530字节和tmp1,146文件/362,246,998字节逐SHA迁I，原目录副本/9零WAV+1截断/完整source均保留，junction维持URL；原子素材发布、自身锁保护与507存储错误致命停队列已接，普通失败仍继续。90文件/1028项全量测试、全量ESLint/TypeScript/生产构建通过，一既有opt-in跳过。真实UI音频补缺12目标首个第11段产生1 ready候选后取消第二原生任务，成功1/失败0，无自动采用，不宣称12全完成；候选9.56秒/917,804B、完整原音26.24秒/2,519,084B均RIFF/frames完整。候选7→8刷新保留，88.9%文字相似度警告仍提示试听，未作音质通过声明；111旧不可变素材哈希及36旧candidate records保持，22台词/编排/采用不变，四按钮恢复12/22/2/10，无横溢出/consoleerrorwarn。当前3001/PID2212/`.next-batch-generation-production`/HTTP200，取消后无lock/无audiochildren。证据根 `I:/AI/asmr-director-batch-generation-recovery/2026-10-02`，见recovery-verification.json及existing-assets-preservation.json。本次未提交推送，音质V1父阶段仍进行中。见 [故障记录](records/2026-10-02-audio-quality-v1-storage-recovery.md) / [恢复入口](AI_HANDOFF.md)。

2026-10-02 工程批量生成实现与验证完成：音频/分镜各含全部生成与全部重生成；VoxCPM2候选待人工采用，GPT-SoVITS沿用直接提交，补缺跳过已有音频/任何已有分镜（含过期手改）。串行进度/取消/失败继续、最新来源复核及手动互斥已接。89文件/990项全量测试通过，一个既有opt-in跳过，全量ESLint/TypeScript/生产Webpack构建通过。真实分镜补缺六目标取消前保存第5–9段五条新镜，第10未保存，新镜保留，工程分镜3→8，计数13/22/6/9→13/22/1/9刷新保持；原第1镜、22条台词/编排/采用及76个WAV哈希均不变。五个外部文字结果接受、第六项取消，上游repair/请求数/token成本未统计，0TTS/0H3视频；音频批量未做真实TTS。桌面/390/320px两组布局及锁恢复通过，无横溢出/按钮裁切，console0，截图未保存。正式3001/PID28252/`.next-batch-generation-production`/HTTP200，旧20660及preview3002/624经身份核对已停，cache仅junction到I；证据根 `I:/AI/asmr-director-batch-generation/2026-10-02`，见browser-verification.json。上一里程碑8f22021已推送，本次未提交/未要求推送；音质V1父阶段仍进行中，无成片/新听感验收。见 [中文 spec](superpowers/specs/2026-10-02-project-batch-generation.zh.md) / [English spec](superpowers/specs/2026-10-02-project-batch-generation.md) / [开发记录](records/2026-10-02-audio-quality-v1-batch-generation.md)。

2026-10-02 累计里程碑发布：用户明确授权“记录一下推一版”，已将批量已采用音频下载、策划及工程逐段音频绑定分镜、中文剧情背景与精简H3提示词整理为本地发布内容。实现与验收完成；沿用86文件/956项全量测试及全量TypeScript/ESLint/生产构建、907字符prompt与76个WAV哈希不变的真实证据，不重新调用模型或重启服务。分支 `codex/voxcpm2-product-generation`，提交主题 `feat: add batch audio downloads and audio-bound H3 storyboards`；实际SHA及远端结果以Git日志、上游比对及 `I:/AI/asmr-director-concise-h3/2026-10-02/release-verification.json` 为准，本条不提前宣称已推送，也不在提交内自引用hash。下方“未提交/未要求推送”保留为功能验收时历史快照。见 [里程碑发布记录](records/2026-10-02-audio-quality-v1-storyboard-release.md) 与 [恢复入口](AI_HANDOFF.md)。仍属现有音质V1，顶层路线继续进行中。

2026-10-02 最新优化已完成：剧情背景改为人看的简短中文，新生成上限160字符，旧编辑/存储仍4000；模型按背景派生当前具体画面，不复制全文。官方完整Ref有summary，本轮是用户要求的精简自定义模板，删除summary/完整六段包装、背景/前镜/声音重复，共用renderer保留当前字段、原台词、参考外貌与完整音轨。前镜仍给LLM作参考且stale依赖保留，旧metadata不自动重写。86文件/956项全量测试及全量TypeScript/ESLint/Webpack构建通过（一个既有opt-in跳过）。本轮两个浏览器外部DeepSeek文字生成请求均UI成功：47字背景与第一镜，未采集上游repair调用/token成本；工程背景明确手改48字，第一镜2921→1569仅格式器→907重生成，约69%缩短，907clipboard/刷新保持，原3.210秒asset与台词不变。七条策划/22条工程/编排和采用状态不变，76WAV哈希全一致；背景改动使其他旧镜stale但保留字段，按需regen。1182×892/390×844/320×740无横向溢出，console0，截图未保存，TXT字节自动验证但未重读下载。3001/PID20660/`.next-concise-h3-production`/HTTP200，preview3002已停，0TTS/0H3视频；证据根 `I:/AI/asmr-director-concise-h3/2026-10-02`，见`browser-verification.json`。不新增顶层阶段，无成片/听感验收，未提交推送。见 [中文 spec](superpowers/specs/2026-10-02-concise-h3-story-backgrounds.zh.md) / [English spec](superpowers/specs/2026-10-02-concise-h3-story-backgrounds.md) / [开发记录](records/2026-10-02-audio-quality-v1-concise-h3.md)。

2026-10-01 此前逐段音频绑定阶段（英文全局场景及六段导出已被上条精简背景流程覆盖；保留历史验收）：第一步改为「文案 / 场景」，统一英文基础场景随采用保存到可选 `project.videoPlan`，旧 Planner 分镜兼容保留。逐段分镜移至工程人声旁入口与「声音 / 分镜」面板，只绑定已采用本地 WAV 及服务端实测时长，输出英文画面 / 动作 / 镜头与独立 H3 prompt。默认独立，可选相邻前一条有效完整分镜；来源或前镜变化保留编辑并禁用复制 / TXT。视频元数据不改变声音指纹，声音采用撤回保留当前视频计划。最终86文件/953项全量测试通过，一个既有opt-in跳过，全量TypeScript/ESLint/diff check/生产Webpack构建通过。正式3001/PID25824/`.next-clip-storyboard-production`/HTTP200，临时3002已停。真实DeepSeek三次成功：场景、第三段独立及第四段引用第三段；clipboard确认工程原台词/实测3.24与8.59秒/fully_copy/N/A，前镜修改过期及恢复、空场景禁用、刷新保留通过。Planner七条/工程22条原文与编排不变，76个WAV哈希全一致；桌面1768×1252/390×844/320×740无整页溢出，手机入口及焦点正确，console errors为零。TXT触发与自动字节测试通过，未读取浏览器下载文件；截图只工具查看，0TTS/0视频调用，无H3成片验收。证据根 `I:/AI/asmr-director-clip-video/2026-10-01`，见 `browser-verification.json`；属于音质V1内部工作流，不新增顶层阶段，未提交/推送。见 [中文 spec](superpowers/specs/2026-10-01-adopted-clip-video-storyboards.zh.md) / [English spec](superpowers/specs/2026-10-01-adopted-clip-video-storyboards.md) / [开发记录](records/2026-10-01-audio-quality-v1-clip-video-storyboards.md)。

2026-10-01 此前 H3 提示词阶段（界面位置与音频时长待绑定已被上条逐段流程覆盖；保留当时验证）：按已阅读的官方 H3 指南第四节与 Ref 格式调整分镜，新增英文画面 / 动作 / 镜头及确定性 H3 提示词，原中文台词直接来自 draft。统一 Subject1(S1)，Picture1 作为外貌衣服参考而非首帧，Audio1 `fully_copy` 保留完整最终音轨原速原停顿，不新增声音、BGM 或虚构秒数；`non_diegetic_music: N/A`，口型跟随音轨，停顿 / 结束闭嘴。新结果 `promptFormat: 'minimax-h3'`，旧中文分镜兼容保留并提示重新生成；卡片展开复制、全部提示词 TXT，来源过期禁用 H3 而保留普通 Markdown。只产提示词，不接素材上传、TTS / 音频绑定或 H3 视频 API；实测 duration 绑定后续处理。实现与验证完成。77 文件 / 829 项全量测试通过（1 个既有 opt-in 跳过），全量 TypeScript / ESLint / Webpack 构建通过。首轮与构建并行时既有录音分页测试五秒超时，构建结束后以四 workers 全套复跑通过，未修改该测试或生产代码。真实 DeepSeek-v4-pro 一次生成七个英文镜头，七段原台词和当前 22 条时间线 label/title 完全不变。模型仍推测外貌，经 UI 修正推测和复杂转身后，加强参考图优先规则并重建；新模型要求由合同测试验证，未重复付费调用。最终剪贴板回读原文和参考优先句、过期禁用 / 撤回、刷新及桌面 / 390 / 320px 无整页溢出通过；TXT 与复制失败回退由自动测试覆盖。3001 PID17600 / `.next-h3-storyboard-production` / HTTP200，临时 3002 已停，截图只工具查看未保存。无新 TTS、音频工程采用、图上传或 H3 视频输出。证据根 `I:/AI/asmr-director-h3-storyboard/2026-10-01`。仍为音质 V1 内部策划扩展，不新增顶层路线；未要求提交推送。见 [中文 spec](superpowers/specs/2026-10-01-h3-storyboard-prompts.zh.md) / [English spec](superpowers/specs/2026-10-01-h3-storyboard-prompts.md)。

2026-10-01 此前第一步多镜阶段（已被顶部文案 / 场景及工程逐段流程替代；旧数据兼容保留）：第一步文字分镜已实现，Planner 右栏增加「文案 / 分镜」标签，相邻台词按情节组织为通常 6–12 镜、最多 24 镜，画面 / 动作 / 镜头可编辑、保存与撤回。可选 PlannerSource 分镜随采用、复制与版本保留，旧 V1 兼容，来源变更提示过期；首版 prompt 独立简单，等待用户以后补官方 skill。76 文件 / 809 项全量应用测试通过，1 个既有 opt-in 跳过；全量 lint / 最终 TypeScript / 生产 Webpack 构建及 diff-check 通过。真实 DeepSeek-v4-pro 一次返回七镜，28 个镜头编辑字段、画面撤回、台词过期撤回及刷新保留通过；桌面 / 390 / 320px 无整页溢出、内部滚动正确，键盘切换焦点正确，console errors / warnings 为空。采用 / 复制 / 版本保留由自动测试证明，本轮浏览器未创建或采用新工程，原音频工程 15 句 / 9 条采用不变。正式 3001 为 PID 19916 / `.next-storyboard-production` / HTTP 200，临时 3002 已停，证据根 `I:/AI/asmr-director-storyboard/2026-10-01` 含 `browser-verification.json`，截图仅工具查看。属于现有音质 V1 内部策划扩展，不新增顶层阶段；未提交推送或新增听感验收。见 [中文 spec](superpowers/specs/2026-10-01-planner-storyboard.zh.md) / [English spec](superpowers/specs/2026-10-01-planner-storyboard.md)。

2026-10-01 最新需求：已采用音频批量下载已实现，一个工程ZIP目录分为「无后处理」「后处理」，配对编号及导出清单；原声逐字节保留，完整音频与原D 650ms尾声保留。顶部绿色入口与紧凑弹层保持一屏，含数量、空状态、准备/取消/重试及空间开关说明。72文件/755项应用测试、全量lint/typecheck/生产Webpack构建通过，最终构建忽略配置的lint复跑也通过。真实单片段API ZIP/CRC/原声哈希与3.21→3.86秒D尾响通过；正式3001 PID4380/.next-batch-production/HTTP200。浏览器9段批量下载发起、15段刷新不变、桌面/390及320px/键盘检查通过；未重新读取浏览器9段成品，不扩大单片段文件证据范围。此项属于音质V1现有工程导出改进，不新增顶层阶段、未提交推送或新增听感验收。见 [中文 spec](superpowers/specs/2026-10-01-batch-adopted-audio-download.zh.md) / [English spec](superpowers/specs/2026-10-01-batch-adopted-audio-download.md)。

2026-10-01 本会话收尾：用户要求记录并提交推送，交接范围包含本会话累计的语义短单元、选区编辑、一屏工程布局、识别对照和末尾/API截取。实现与验证已完成；交接只同步记录与Git，不新增生成、采用或听感验收。恢复入口见 [AI_HANDOFF](AI_HANDOFF.md) 与 [开发交接记录](records/2026-10-01-audio-quality-v1-semantic-workspace-handoff.md)；当前分支 `codex/voxcpm2-product-generation`，后续按已有音质V1未完成项或用户新测试反馈继续，不新增路线阶段。

2026-10-01 续完 9 月 24 日末尾定位需求：标点核对前已忽略；新增末尾词辅助的至少 85%／最多两次编辑回退，兼容少量漏字并明确显示差异，原 90% 等长替字路径保留。至少 10 字目标、真实词端点、紧邻后文与双侧静音验证共同约束；不按字数估时。复用现有外部 API 仅在本地端点不确定时选词索引，再本地验证，不能让模型直接给秒数或跳过检查。用户“暖胃”原录音已实测截出 7.11 秒、88.8889%／啦→了及少儿，旧 22.56 秒原音保留，无新 TTS、未采用；当前后文已编辑，重分析示例保留旧上下文。真实 API 400 已修正并复验 HTTP 200。67文件／734项应用测试、74项Python测试、全量lint/typecheck/build及正式页面播放检查通过；3001 PID19500，15段文字刷新保留，一屏与左右对齐保持。此项仍属于现有音质 V1 的生成流程修正，不新增路线阶段。见 [中文 spec](superpowers/specs/2026-09-24-ending-anchor-extraction.zh.md) / [English spec](superpowers/specs/2026-09-24-ending-anchor-extraction.md)。

2026-09-23 用户批准小量识别差异仍截取并明确提示：归一后至少 90% 一致、最多两处等长替字，无增删/重排/重复；有差异的非末目标必须通过真实静音及双侧独立识别，目标文本核对与边界核对分开。可靠截取保持 passed 并显示相似度/差异字，边界不确定仍返回完整原音。已有录音真实重分析截出 2.45 秒、90%/「啦→了」，新候选已保存供试听，旧23.36秒候选及原音不变，无新TTS、未采用。65文件/692项应用测试、54项Python测试、全量lint/typecheck/build及正式页面播放验证通过；3001 PID25872/.next-semantic-build。此条覆盖Sept21目标前三字严格拒绝的行为，不新增路线阶段；音质V1仍按下文推进。见 [中文 spec](superpowers/specs/2026-09-23-tolerant-voice-extraction.zh.md) / [English spec](superpowers/specs/2026-09-23-tolerant-voice-extraction.md)。

2026-09-21 识别对照与截取调查：候选及完整原音均增加默认折叠「识别对照」，保存完整窗口/裁剪后 ASR、词时间与失败阶段，成功、失败、超时、取消均保留已有证据。真实复查确认「回来啦」被识别成「回来了」，开头三字严格规则使初始定位失败；实际有 260 ms 静音，但独立裁后 ASR 仍是「回来了」，本轮未放宽截取规则。省略号确属历史策略；历史 16 是补句下限，当前最大 16 是新增稳定性限制，不能混称。已有首段候选回填 ASR、原音字节不变；677 项 TS 测试、38 项 Python 诊断测试、全量 lint/typecheck/build、真实 ASR 传递与生产浏览器对照检查通过。正式 3001 为 PID 29948；未新生成/采用或变速，不新增路线阶段。见 [中文 spec](superpowers/specs/2026-09-21-voice-recognition-inspection.zh.md) / [English spec](superpowers/specs/2026-09-21-voice-recognition-inspection.md)。

2026-09-21 首小段失败修正：已复现滑动窗口只按 500 字截取、误送 69 分句／499 字，导致 AudioVAE 解码 `grid_y < USHRT_MAX` 原生断言退出。语义窗口现按目标＋后文最多 16 分句限制，500 字另作安全上限；窗口外改动不影响候选，失败后保留服务端有界原生日志与安全分类提示。64 文件／663 测试、全量 ESLint／TypeScript／生产构建通过；正式 3001 恢复至 PID 20008／`.next-semantic-build`。证据根 `I:/AI/asmr-director-generation-failure/2026-09-21`，双语说明沿用 semantic-script-workspace spec。本次为现有生成缺陷修复，不新增阶段。

首段真实复验已返回 23.36 秒候选／原音，122 字／16 分句窗口不再触发原生失败；字词对齐仍待确认，因此本次保留完整原音，不把首句精确截取或音质算作已验收。候选及空间试听／下载可用，无自动重试、未采用；浏览器重开后文案与候选保留。

2026-09-20 最新用户批准：最初出稿就使用语义短单元，创意与工程共用这些边界；只对选中单元显示操作，工程全部面板保持一屏可见。新生成协议用共享元信息的 `groups[].units`，展开为每条对应一个 voice clip 的 sections。VoxCPM2 采用工程后文滑动窗口，只提取目标开头，真实末句独立收尾；窗口内容参与候选校验与生成取消。此条进一步修正下条“内部组只属引擎细节”的过渡实现。64 文件／652 测试、全量 ESLint／TypeScript／生产构建通过；真实初始出稿 149 字／9 单元、采用刷新及桌面手机一屏验证通过。真实 TTS 非末句对齐需确认但完整原音可用，末句核对通过，各只生成一次。正式 3001 已切换 PID 6168／`.next-semantic-build`，临时 3002 已停止；未提交推送。实现与验证见 [中文 spec](superpowers/specs/2026-09-20-semantic-script-workspace.zh.md) / [English spec](superpowers/specs/2026-09-20-semantic-script-workspace.md)，新证据根为 `I:/AI/asmr-director-semantic-workspace/2026-09-20`。不新增编号路线，也不代表音质 V1 已完成。

2026-09-20 最新用户批准：修正策划与工程“分段替用户决定修改/生成范围、整段音频无法独立等待”的交互。当前实现覆盖用户选区改写、手改增删拆合、生成中取消与迟到保护；工程选区先成为独立 clips 再生成，`pause_after` 保持实际语音结束后的等待；上方左右块内滚动、下方时间线、右侧常用操作优先。未涉及片段保留音频，修改/拆合涉及的整段音频因缺少任意文字边界精确对齐而需重生成，旧版本与原音不删除。这是现有工作流修正，不新增编号路线，音质 V1 仍未完成。62 文件/629 项测试、全量 ESLint/TypeScript/生产构建、独立 3002 示例工程桌面/手机范围与等待验证通过；正式 3001 已更新至 PID 19292 并只读确认原六段/4:50 用户工程保留，无浏览器错误。没有新真实 TTS/LLM 或听感验收，也未提交推送。详见 [中文 spec](superpowers/specs/2026-09-20-user-controlled-script-ranges.zh.md) / [English spec](superpowers/specs/2026-09-20-user-controlled-script-ranges.md)，证据根为 `I:/AI/asmr-director-range-editing/2026-09-20`。

2026-09-20 较早会话交接（本轮范围修正前）：生成交付修复已在 `df30bb9` 提交并推送到 `origin/codex/voxcpm2-product-generation`，当时 3001 正式工作台已更新。该次收尾仅同步文档与运行快照，没有新增生成或听感验收；交付修复本身无遗留实现项。恢复入口以 `docs/AI_HANDOFF.md` 顶部最新段落为准；完整原音政策、I 盘优先和已完成的 D 接入不得按旧记录回退。

2026-09-20 最新用户决定：检查不能阻止音频交付，每次完整原音必须可试听、下载；正常分组提取和拼接保留。已改为原音先交付、检查提示化、每组一次生成、失败继续；历史失败原音可找回，支持分页。加入资源感知的有限 TTS/ASR 流水线和识别复用，本机内存不足时默认串行。真实双组检查均失败但仍完整返回 34.91 秒候选，首份原音 32.59 秒即可访问。此条覆盖此前“检查失败重试三次后拒绝交付”的规则，不改变音质 V1 顶层路线。详见双语 `2026-09-20-audible-generation-and-performance` spec。

当前固定 10 步 roadmap 已全部完成。用户于 2026-09-08 确认 Planner“暂时算是过了”，随后批准实施 VoxCPM2 正式生成接入。Planner 本轮按已验证的 DeepSeek 路径和精简界面验收通过；优先级已转回“人声导演与真实 ASMR 音效质量 V1”。VoxCPM2 单片段生成、候选试听/采用/撤回及 48 kHz 重混导出已通过技术验收。2026-09-09 已选长文分组/停顿方案也已完成工作台接入及真实技术验收，包括完整生成、单组重生成与候选到导出的闭环。既有听感结论和真实音质验收要求不变。

2026-09-14：用户试听 8770 新口语文案后认可效果，授权将原 D 接入正式生成并记录推送。D 的 HRTF、刚性球 DVF 与原房间响应现已用于人声完整候选、当前人声、片段试听和整段导出，增加定距环绕与环绕靠近；修改距离与轨迹复用已生成原声。最终实施与验证记录见双语 `2026-09-14-spatial-d-product-integration` spec。真实 SFX、垂直环绕和通用更柔仍属于音质 V1 未完成范围。

2026-09-20 额度恢复后收尾：D 正式接入已完成。57 文件／520 项 Vitest（含真实 Python 适配器）、26 项空间 Python 测试、TypeScript／生产构建和最终 ESLint 通过；新 TTS 至导出闭环及恢复后的生产构建播放／跳转／采用撤回／重混下载／桌面手机复核通过。四条获认可 D 自然样片与产品渲染字节完全一致。新缓存、临时文件和验收产物优先放 `I:/AI`；交付分支保持 `codex/voxcpm2-product-generation`。

2026-09-20 较早的长文失败提示修正（历史，交付行为已被 `df30bb9` 覆盖）：用户报告首组失败且“完整台词和安全边界”难以理解。第三条候选存在 370 ms 静音，但整段 ASR 的“回来啦”在截取后识别为“回来了”；修正后保留 `cut_text_mismatch` 诊断。该次只改提示，没有生成新音频或解决核对不一致。后续按用户决定将检查改为提示，保留全原音交付并取消检查触发的自动重试；不能恢复当时拒绝交付的规则。证据见同日 `docs/project-archive.md`。

## 本轮已通过：AI 创意策划 / LLM Planner V1

- Status: Accepted for this iteration by the user on 2026-09-08. Real external DeepSeek workflow and UI cleanup are accepted. Local Ollama memory recovery and broader script-quality evaluation remain non-blocking follow-ups, not claims of completed verification.
- 2026-09-07 初次实现与 DeepSeek 配置验收：34 个测试文件 / 260 项测试、全量 ESLint、TypeScript 与生产构建通过。用户配置 DeepSeek 后，真实出稿、单段改写、撤回、采用新工程、刷新恢复与策划来源载入通过；390px 长文案无横向溢出，浏览器无 error/warn。本地 Ollama 成功验收及更多主题的艺术质量评估仍待完成。
- 2026-09-07 界面整理：用户明确指出功能基本可用，但主界面堆积了无意义信息和开发注意事项。已按“默认只提供当前任务操作与创作内容，技术数据按需展开”精简策划、工程编辑与预览；这是当前 Planner/UI 体验整理，不新增阶段。本轮 260 项测试通过，最终排版调整后的 9 项 Planner 组件用例、全量 ESLint、TypeScript 与生产构建通过；桌面/390px、折叠与视图切换、刷新保稿检查通过，最终刷新后无新增浏览器错误。
- Design: `docs/superpowers/specs/2026-09-07-llm-planner-v1-design.zh.md`（附英文版）。
- 输入今日主题与可选时长、角色和风格，真实 LLM 生成完整可编辑中文文案。
- 支持单段改写、取消、撤回、草稿本地保存与文案下载；采用后创建新工程，保留原项目。
- 复用现有 Timeline DSL、项目库、编辑与音频链路；导演提示和音效建议独立于朗读台词，策划来源保存在项目库元数据中。
- 默认本地 Ollama，外部 API 可选且由服务器配置；不把模板当作模型输出。
- 读取真实语音时长，对策划工程延长过短的人声片段并顺延后续时间线，避免规划时长截断台词。
- 本阶段为用户批准的命名阶段，不新增编号 Step 11；原 D 房间/距离/水平运动已接入，音质 V1 的垂直运动、通用更柔及真实音效扩展仍未完成。

## 当前阶段：人声导演与真实 ASMR 音效质量 V1

- Status: In progress; base VoxCPM2 and the selected long-text workflow are technically verified. The user accepted the original-D colloquial motion sample on 2026-09-14 and authorized its product integration. Original D now supplies voice distance, room response and continuous horizontal motion; real SFX, vertical motion and general expressive control remain unfinished.
- Design: `docs/superpowers/specs/2026-07-13-audio-director-and-sfx-quality-v1-design.zh.md`
- Round 1 plan: `docs/superpowers/plans/2026-07-13-audio-quality-v1-round1-implementation-plan.md`
- VoxCPM2 接入设计与实施记录：`docs/superpowers/specs/2026-09-08-voxcpm2-product-integration-design.zh.md`（附英文版）。基础接入及长文模式均已通过技术验收；D 空间处理见 `docs/superpowers/specs/2026-09-14-spatial-d-product-integration.zh.md`（附英文版）。
- 主线 1：让“更柔”、近/远、左右、水平环绕与垂直环绕成为真实可听的导演动作，而不是只改文字字段、音量或普通声像。
- 主线 2：以免费授权素材、免费本地 AI 和明确标注的基础合成扩大 ASMR 音效质量与种类；付费方案暂缓，不要求用户录音。
- 第一轮固定样片：一句人声、衣物摩擦、指尖轻敲、雨声；完成更柔、近/远、完整水平环绕、左—上—右—下垂直环绕、三种来源比较、采用、撤回与重混。
- 第一轮必须通过用户耳机试听，才进入全部动作和 8 类音效扩展。

### 2026-09-13 距离感试听实验

2026-09-13 距离感实验：按用户授权完成固定温柔人声＋真实 CC0 画刷的离线对比，包含声像基准、HRTF、刚性球 DVF 近场补偿、房间反射四种处理，以及贴耳／面前／远处／靠近和整体响度匹配版本。80 个 WAV、13 项数值测试和浏览器播放／跳转／下载／桌面手机检查通过；复现工具在 `tools/distance-listening/`，证据在 `D:/CodexWorkplace/asmr_director_runtime/distance-listening/2026-09-13`。后续用户反馈加入房间“确实不错”、D“还行”，属于初步正面反馈，不代表全部空间方案获验收；主线混音器与工程数据没有变更。详见 `docs/superpowers/specs/2026-09-13-distance-listening-experiment.zh.md` 及英文版。

### 2026-09-14 算法扩展与 D 改进对照

用户澄清希望继续了解其他算法，并授权房间／贴耳几何与人声朝向改进。已完成 BRIR、ISM/FDN/SDN、Paraspax、几何传播、神经双耳和 Ambisonics 的原始资料调研，以及保留 D、房间 E、贴耳朝向 F、合并 G 的独立试听。27 项数值测试、96 个音频检查及真实浏览器播放／切换／章节／下载／桌面手机验证通过；原 D 静态片段回归通过。成品在 `I:/AI/asmr-director-distance-listening/2026-09-14`、`http://127.0.0.1:8768/`。D 盘写入中断后仅迁移本轮未完成产物到 I 盘重做，旧 8767 成品保留。随后用户明确 D 仍最好，认为 E 减少了远处的回声／混响，空间感变弱；当前保留原 D，不采用 E/F/G。这轮比较不再是待听项，未接入产品或运行神经模型。技术报告见双语 `2026-09-14-distance-algorithm-refinements` spec；最新听感决定见下条。

### 2026-09-14 保留 D 的长文连续环绕

按用户新要求，已完成同一段 34.75 秒、16 句已选温柔长文的四条连续轨迹：距头中心 0.18／0.8／1.75 米定距环绕，以及 1.75→0.18 米环绕靠近。全部沿用原 D 的 HRTF、DVF 和房间响应，左→后→右→前→左绕一圈；开头停留 1.5 秒、结尾停留 2.5 秒，靠近在 27.105 秒结束并保持近距 7.645 秒。输出 8 个 35.4 秒 / 48 kHz stereo PCM24 WAV，含自然与整段响度匹配版本。原声、原 ASR 和 D 代码哈希保留，没有新 TTS、变速、重复短句或工作台修改。

37 项数值测试、8 文件音频验证、原 D 静态卷积端点回归和真实浏览器检查通过；最大估计真峰值 −5.383748 dBTP、匹配误差 0.029476 LU、端点残差小于 1.2×10⁻⁷。成品与 JSON 证据在 `I:/AI/asmr-director-distance-listening/2026-09-14-d-long-motion`，试听 `http://127.0.0.1:8769/`。D 是当前听感基准；这四条新长运动的听感仍由用户判断，不等于空间正式接入或音质 V1 完成。双语记录：`docs/superpowers/specs/2026-09-14-d-long-motion.md` / `.zh.md`。

### 2026-09-14 新口语文案重生成

用户要求换新文案、不要文绉绉。已实际重新运行本地 VoxCPM2 soft Combined 六语义组生成，保留已选长开头／独立结尾及 class-local 停顿；新原声 34.54 秒，六组截后 ASR 覆盖率均 1.0，最终 22/22 子句顺序覆盖（整段识别有一处「露／落」差异）。完整尝试、两次口语修订与技术恢复记录保留在 `I:/AI/asmr-director-distance-listening/2026-09-14-colloquial-source`。

新原声沿用原 D 四条连续轨迹，产出 8 个 35.19 秒 WAV，页面 `http://127.0.0.1:8770/`，成品目录 `I:/AI/asmr-director-distance-listening/2026-09-14-d-colloquial-motion`。38 项数值测试、音频／原 D 端点回归和实际桌面手机播放／切换／下载检查通过。原 8767–8769 保留；实验当时没有修改工作台工程。用户随后反馈“还行”，授权正式接入，当前不再列为待听项。双语记录：`docs/superpowers/specs/2026-09-14-d-colloquial-motion.md` / `.zh.md`。

### 2026-09-14 原 D 正式接入

原声资产与候选来源保持可追溯；D 派生音频缓存独立，距离/移动编辑不要求重新生成已完成的人声。完整试听和导出沿用同一空间服务；支持 24 位 WAV 解码并保留 0.65 秒房间尾声。包含 D 的整段混音跳过旧的向上响度归一，只在开启主限制器且过载时共同衰减，以保留自然近远音量差。

四条已认可 35.19 秒自然 D WAV 与产品实现逐字节及 SHA256 一致；真实混音探针近远 RMS 差保持 7.367684 dB。最终全量检查、工作台闭环及提交信息统一记录于上述产品接入 spec，避免与实验历史混淆。音质 V1 整体仍在进行。

### 2026-09-07 进度记录

- 已完成多轮 GPT-SoVITS、CosyVoice3 与 VoxCPM2 人声试听。对当前温柔中文参考，VoxCPM2 的整体柔和表达明显优于现有 GPT-SoVITS 方案，因此保留为可选人声引擎；但自然语言 `soft` / `whisper` 指令本身仍不稳定，不能宣布通用“更柔”已经完成。
- 已确认当前温柔中文长文本首选：语义组最初由本地 Ollama `qwen3:1.7b` 划分，随后 DeepSeek V4 独立复核得到相同分组；每次把当前语义组放到长文本开头，后接剩余全文，完整生成后只截取开头语义组；最后一组单独生成真正结尾；组间使用 DeepSeek 给出的短/中/长分类与相邻组真实停顿计算。当前试听成品的五处组间停顿为 `350 / 350 / 350 / 440 / 290 ms`。
- 2026-09-08 用户确认保留固定补全文本，理由是此前整段生成后面会变快、变尖。长文接入默认保留“目标组＋剩余正文＋所需中性补句”的长输入，只提取目标开头；末组独立生成真正结尾，不补句。补句去留不再列为待实验或接入前置；此决定沿用成功组合，未新增独立因果验证。
- 已确认“更近”采用“贴耳说话姿态的重生成 + V2 空间处理”的组合；单独的人声方向提示“朝左耳说/朝右耳说”无法产生可辨认方向，左右与环绕仍必须由空间处理完成。
- 水平、垂直及左/右侧环绕已有可用实验结果，垂直闭环的过渡问题已修正；这些仍是独立试听实现，尚未接入工作台正式生成流程。
- 免费、本地优先的限制不变；DeepSeek 属于可选外部文本分析，必须保留免费本地分组和固定停顿兜底。程序噪声可以继续作为基础 SFX 兜底，但真实 ASMR 音效种类和质量仍未解决。
- 当前结论与证据见 `docs/superpowers/specs/2026-07-26-voxcpm2-evaluation-design.zh.md` 和 `I:\AI\voxcpm2-evaluation\evidence\LISTENING_RESULTS.zh.md`。

2026-09-08 已恢复音质 V1，先把已选的人声方案整理成现有 Generation Bridge 下的可选 Provider 和可配置生成模式。产品接入必须保留候选重生成、试听、采用、撤回和重混，不把单次好 seed 当成稳定能力。2026-09-08 收到全短句默认停顿对照的补充反馈：用户此前已试听“原停顿 vs 全部改成类别默认停顿”，感觉无明显差异，未选出新优胜版；实际试听日期未知。该对照不再列为待听，不改变 class-local 组间自适应停顿的当前首选；也不据此推断首尾无截音或两版完全等价。真实 SFX 扩展仍是同一阶段的未完成主线。

### 2026-09-08 产品接入首切片

- 已通过原生 CLI 接入可选 VoxCPM2，支持普通/温柔参考、Reference-only/Combined 两模式，保留 GPT-SoVITS；生成独立候选，试听后显式采用或丢弃。
- 候选与来源信息持久保存，采用前校验内容与素材，刷新后可撤回最近一次采用；保留安全版本、Planner 来源和实际人声时长，后续时间线自动顺延。取消会终止原生进程，失败/迟到结果不替换原声。
- 混音默认 48 kHz，兼容 32/44.1/48 kHz，保留 stereo 声道；界面只默认显示引擎/参考/生成/试听采用操作，技术来源折叠。旧工作树保持原状。
- 本轮全量 46 个测试文件 / 340 项测试、ESLint、TypeScript（生产构建内）及 Webpack 生产构建通过。原有 Windows native SWC 加载警告仍存在，WASM 回退构建成功。
- 真实本地 TTS 两模式产出 5.6 / 6.4 秒候选；独立浏览器上下文通过播放、显式采用、时间线延长、刷新撤回、8.6 秒 48 kHz stereo 重混和实际 WAV 下载。桌面/390px 界面无横溢，最终浏览器错误为空。另一次真实取消验证进程退出、锁释放、候选数不变。
- 证据目录：`D:\CodexWorkplace\asmr_director_runtime\voxcpm2-product-verification\2026-09-08`。自动检查不等同于用户耳机听感验收；当时长文分组/安全截取/自适应停顿、V2/HRTF 空间和真实 SFX 扩展尚未完成。长文随后于 2026-09-09 完成技术接入，记录如下。

### 2026-09-09 长文工作台接入

- VoxCPM2 增加“长文分组”：非末组沿用完整剩余正文及所需固定补句，末组独立结尾；逐组本地 ASR 核对并安全截取，只调整组间停顿。模型分析默认本地，可显式选已配置外部 API，失败使用标明来源的规则兜底。没有重开补句去留或已听停顿对照。
- 支持实际分组进度、取消、完整候选与分组试听、单组重生成；其他组复用原素材，原候选与工程保持。技术来源和各组操作按需展开，现有候选采用/撤回、时间线顺延、重混流程复用。
- 真实 DeepSeek V4 Pro 分成 5 组；本地 VoxCPM2/离线 ASR 产出 20.352 秒完整候选，5 组覆盖率均为 1，四处实测连接为 390 ms。实际首组重生成一次成功，新候选 20.57 秒，其他四组素材 ID 不变；既有采用与混音不变。
- 浏览器实际播放、采用、刷新撤回、再次采用、23.36 秒 / 48 kHz stereo 重混、WAV 与工程 JSON 下载通过。最终刷新保留两个候选、原采用状态和新鲜混音；桌面/390px 无横向溢出，最终浏览器 error/warn 为空。另一次真实 UI 取消确认锁释放、无新增候选、原声不变。
- 证据：`D:\CodexWorkplace\asmr_director_runtime\voxcpm2-longtext-verification\2026-09-09`；自动检查结果见双语接入设计和本轮留档。新产品样片听感由用户判断；V2/HRTF 与真实 SFX 继续属于本阶段未完成项。

第 7 步已经完成本地 voice clip 真实生成接入，第 8 步已经完成 breath / SFX / ambience 的本地半真实 clip 生成接入，第 9 步已经完成真实项目混音与 WAV 导出接入。后续不能再把 adapter、API route、provider wrapper、bridge cleanup、mock work 重新包装成新的顶层 roadmap 步骤；它们只能作为后续步骤的内部实现细节存在。

## 10 步路线

1. **字段级校验高亮**
   - Status: Completed.
   - Outcome: Clip Inspector 里的字段可以显示映射后的校验错误，Validation Panel 仍然保留完整问题列表。

2. **轻量 Timeline 编辑**
   - Status: Completed.
   - Outcome: 已支持选中 clip 的 start / duration 微调，不做完整 DAW。

3. **项目工作区结构升级**
   - Status: Completed.
   - Outcome: C+ 可折叠工作区结构，包括左侧项目栏、中间编辑区、顶部工作区操作与状态、右侧详情 / 预览 dock。

4. **真实音频前的预览层**
   - Status: Completed.
   - Outcome: 已完成早期 Preview Layer、状态概览、素材状态和 Timeline status dots。后续 Step 10 接入真实波形；2026-09-07 界面整理移除默认统计与占位波形，把非空轨道和素材详情改为按需展开。

5. **Clip 生成交互闭环**
   - Status: Completed.
   - Outcome: 已有选中 clip 生成、重新生成、重试、取消、运行时进度、durable asset commit、失败态、mock playback。

6. **稳定生成资产与项目混音骨架**
   - Status: Completed.
   - Outcome: 已有稳定的 `asset://clip/...` 与 `asset://mix/...` 引用、project mix control、full-project preview、WAV download、runtime-only job state、导入 / 导出边界保护。

7. **真实生成 MVP**
   - Status: Completed.
   - Outcome: 已打通本地 GPT-SoVITS voice clip 真实生成链路。工作台默认使用 local generation bridge，选中 voice clip 点击 `生成` 后会调用本地 Next API、请求 GPT-SoVITS、把真实 WAV 保存到 `D:\CodexWorkplace\asmr_director_runtime\assets\clips\app`，并把 `asset://clip/...` durable reference 写回 Project JSON。Preview Layer / selected clip preview 通过 `/api/assets/clip/<assetId>` 播放该真实 WAV。
   - Acceptance criteria:
     - 用户点击 voice clip 生成控制后，可以触发真实 provider 或真实本地生成服务。
     - 结果是可播放的真实音频文件，不再是 mock WAV synthesis。
     - Project JSON 只保存稳定 durable asset reference。
     - 生成出的 voice clip 可以通过现有 Preview Layer / selected clip preview flow 播放。
     - failure、retry、cancel 仍然可用。
     - adapter / API / provider wrapper 只能作为本步骤内部子任务实现，不能单独升级成新的 roadmap 步骤。
   - 2026-07-06 状态补充:
     - 已在 `D:\CodexWorkplace\asmr_director_runtime` 手动跑通本地 GPT-SoVITS API、参考音频 ASR、单句 TTS、以及一段约 59.53 秒的多 clip ASMR 测试混音。
     - 这证明真实生成链路本地可行，但还没有完成产品内接线：工作台的 voice clip 生成按钮尚未调用本地 provider，生成结果尚未通过稳定 durable asset reference 写回项目并进入现有 Preview Layer。
     - 下一步仍然属于第 7 步内部实现：把已验证的本地 GPT-SoVITS runtime 接入 Generation Bridge / selected voice clip generation flow，而不是新增顶层 roadmap 步骤。
   - 2026-07-07 完成记录:
     - 已新增 local runtime config、voice pack loader、GPT-SoVITS provider wrapper、local asset store、local generation bridge、clip generation API route、clip asset playback API route，以及 `asset://clip/...` playback resolver。
     - 默认 UI bridge 已从 mock 切到 local real generation；只有设置 `NEXT_PUBLIC_ASMR_GENERATION_MODE=mock` 时才使用 mock bridge。
     - Headless Chrome 端到端验收：页面 hydrate 后选中 `voice_001`，点击 `生成`，项目保存 `asset://clip/voice_001_20260706T211523064Z_d3b95513`，播放接口返回 `audio/wav`，`241,964` bytes，文件头 `RIFF`，页面无 error/warning。
     - cancel 对当前同步本地 provider 是客户端 best-effort：UI 会取消本地提交并忽略晚到结果，但已经发出的 GPT-SoVITS 请求不会被底层服务中断。

8. **多类型真实 Clip 生成**
   - Status: Completed.
   - Outcome: 在 voice 之外，已把本地半真实生成扩展到 breath、SFX、ambience。非 voice clip 使用本地程序化 WAV renderer，继续通过同一 selected clip generation flow、`asset://clip/...` durable reference、Preview Layer selected clip playback 进入项目。
   - Acceptance criteria:
     - 非 voice clip 也能通过同一 project contract 生成并预览。
     - Clip-level regeneration 仍然只影响当前选中 clip。
   - 2026-07-07 完成记录:
     - 新增程序化非 voice renderer：breath 使用柔和噪声呼吸包络，SFX 使用摩擦 / 敲击式包络，ambience 使用雨声底噪和稀疏雨滴颗粒。
     - `POST /api/generation/clip` 已从 voice-only helper 改为通用 local clip generation：voice 继续走 GPT-SoVITS，breath / SFX / ambience 走本地程序化 renderer。
     - Headless Chrome 端到端验收已生成 `breath_001` 和 `sfx_blanket_001`：播放接口均返回 `audio/wav`，文件头 `RIFF`，页面无 error/warning。

9. **真实项目混音与导出**
   - Status: Completed.
   - Outcome: 已按 Timeline DSL 把已生成 `asset://clip/...` assets 混成真实 `asset://mix/...` WAV，并接入 Preview Layer 的整段试听与 WAV 下载。
   - Acceptance criteria:
     - Project mix 使用真实生成的 clip assets 与 timeline timing。
     - Full-project preview 播放真实 mix。
     - WAV download 返回真实混音音频文件。
   - 2026-07-12 完成记录:
     - 新增 project mix readiness / export state / fingerprint helpers，用于判断素材是否齐全、旧 mix 是否过期，以及成功/失败时如何写入 `exports[type="wav"]`。
     - 新增 PCM WAV decoder / stereo WAV writer / project mix renderer，支持 timeline placement、clip gain、fade、pan、distance、movement、ambience loop、目标响度归一和 limiter。
     - 新增本地 project mix generation helper、`POST /api/generation/mix`、`GET /api/assets/mix/[assetId]`，并把 `asset://mix/...` 映射到可播放 API route。
     - Generation Bridge / runtime / summary / view model 已支持 `project_mix:wav` runtime job；Preview Layer 已接入 `生成整段`、`重混`、`试听`、`WAV` 和 `取消`。
     - 验证：`npm.cmd run test --prefix apps/web` 25 files / 158 tests 通过；`npm.cmd run lint --prefix apps/web` 通过；`npm.cmd run build --prefix apps/web -- --webpack` 通过；本地 API 验收生成 `asset://mix/step9_verify_project_wav_20260711T203915972Z_697118df`，播放接口返回 `audio/wav`、`RIFF`。

10. **产品工作流硬化**
    - Status: Completed.
    - Outcome: 已完成本地优先的产品工作流闭环：多项目库、旧单项目存储迁移、项目新建/切换/复制/删除、显式版本与破坏性操作前安全版本、真实 WAV waveform/技术分析、生成与导出质量检查，以及本地保存失败提示。云端持久化、账号、计费、发布、协作属于部署与商业化扩展，不冒充本地 MVP 已完成能力，也不自动构成新的顶层 roadmap。
    - Acceptance criteria:
      - 左侧项目栏显示真实本地项目列表并支持新建、切换、复制和安全删除。
      - 当前项目自动保存；用户可以留版本并恢复，覆盖/重置/切换前保留去重安全版本。
      - Preview Layer 对真实 `asset://clip/...` / `asset://mix/...` WAV 显示真实峰值波形，不再把伪波形当作真实结果。
      - 质量检查覆盖 schema、素材齐全度、mix 新鲜度、音频分析、声道和峰值余量；2026-09-07 起详情按需展开，实际失败与需处理的问题继续可见。
      - 项目 JSON 不混入项目库、版本、波形或运行时分析数据。
      - 本地保存失败时明确显示不可用，未知 mix fingerprint 保守标为需重混。
    - 2026-07-12 完成记录:
      - 新增版本化 `ai-asmr-studio:v1:project-library`，自动迁移旧 `v0` 单项目 key；每个项目最多保留 12 个版本，右栏显示最近 5 个。
      - 新增 `GET /api/assets/analysis` 与 PCM WAV 分析，返回 16-160 段真实 peak bars、duration、sample rate、channels、peak/RMS dBFS 和 clipped sample count。
      - 左侧占位项目栏升级为真实项目库；右侧新增质量检查与版本记录；Preview Layer 接入真实 waveform。
      - 独立代码审查后补齐本地保存失败态、持久化 mix fingerprint、非当前项目同 ID 导入安全版本、revision project ID 不变量、API 400 分类和精确 PCM 饱和判断。
      - 验证：`npm.cmd run test --prefix apps/web` 29 files / 184 tests 通过；`npm.cmd run lint --prefix apps/web` 通过；`npm.cmd run build --prefix apps/web -- --webpack` 通过；桌面和 390px 浏览器验收无横向溢出、无 console error/warning，真实 showcase WAV 显示 64 段波形并读出 32kHz stereo 技术指标。

## Roadmap 修改协议

只有用户可以批准顶层 roadmap 变更。如果 agent 认为某个步骤已经过时、不可行、或实际实现暴露了原设计不足，必须先说明冲突并提出 roadmap 修改建议，得到用户确认后才能改方向。
