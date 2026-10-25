# 分镜完成后的显式音频后处理

日期：2026-10-23。所属路线：Audio Quality V1继续进行中，SFX暂停；沿用现有legacy三入口，不新增顶层阶段。状态：本功能完成并于04:25 HKT部署到3001；验证层级见下文，优化后没有再完成整站全量重跑。本轮未提交或推送。

用户要求候选试听保持纯原音，待剧情与分镜确定后，再整批规划每句的声音距离、移动及衔接。流程为「生成原音→试听并采用→完成分镜→生成后处理→试听/下载或导出」，顶部入口位于「生成分镜」右侧，只处理当前短句或整段工作区。

## 实现

候选、完整原音及已采用原音直接播放保存文件，播放和导出均不隐式调用空间渲染。后处理先一次调用已配置DeepSeek文本API，结合剧情、角色、脚本顺序与完整当前分镜规划起终点；不发送音频，不调用TTS/ASR。无动作保持静止，不把摄影特写等同贴耳。普通衔接继承前句落点；明确转场或中间无对白动作已经改变角色位置时可重新定位，并记录原因，空镜不生成假人声。

独立渲染器复用既有D空间算法和已安装环境，以原WAV实测时长推进动作，静止起终点一致；不依赖另一会话空间工作台改动，不新增FFmpeg。规划先保存，逐镜生成独立成品并保存回执，支持进度、取消和失败后继续。相同源与设置复用规划及缓存，手调距离/移动后显式更新，并将新落点传到后句。

原`clip.asset`保持原音，成品另存。紧凑输入指纹绑定剧情、脚本、音源、实际分镜和工作区；文件使用真实SHA256，回执另绑定设置与渲染器。音源、分镜或DSP参数变化会令结果过期，但保留原文件与旧结果。工程根及短句/整段两工作区均保存对应状态。整批较大规划使用受限16K输出预算，其余结构化调用默认8K不变；不按工程估时、段后等待安排移动。

处理结果试听只读取已有文件，可按脚本顺序整体拼接；音频包保留原音并附已有有效成品。视频包与工程混音仅在整批结果完整有效时使用成品，否则沿用原音，避免半批混用；成品已含gain/fade，不重复处理。后端在读取成品时核对源与输出文件SHA，导出不触发AI或DSP。主要改动位于音频后处理schema/helper/service及两API、独立Python/TS渲染器、工作台入口/面板、工作区保存与现有播放/导出读取路径；双语规格见[中文](../specs/2026-10-23-post-storyboard-audio-processing.zh.md) / [English](../specs/2026-10-23-post-storyboard-audio-processing.en.md)。

混音指纹新增人声交付版本标记：部分结果仍是整批原音身份，只有全部结果有效时才纳入实际成品URI、时长、源/输出SHA及设置。成品替换或过期会使旧混音失效，旧隐式空间混音也会提示「需重混」，不触发原音重生成；单镜生成指纹未改。批量查询有效回执只计算一次输入指纹，无规划时直接返回。`perf-comparison.json`在同8组、各3次预热/10次采样下，100镜每镜300字的mix指纹中位耗时由145.7485降至2.3781ms，无规划由137.3384降至0.1471ms；这是本机函数基准，不冒充浏览器试听延迟测量。

## 已有证据与边界

`I:/AI/asmr-director-explicit-postprocessing/2026-10-23/real/verification.json`已验证一次真实DeepSeek请求（`deepseek-v4-pro`）、两个实际CPU D渲染结果及重试复用保存规划/成品；`real/extra-cpu-verification.json`另验证两次CPU处理，包括关闭双耳的移动/距离变化、立体声源不重复空间化及只应用一次gain/fade。`real/dynamic-cpu-verification.json`补验一次真实HRTF动态D处理：2秒单声道变为2.65秒立体声，21个轨迹点准确覆盖36°→−27°、0.8→0.5m，保留650ms尾声，源SHA不变。本轮实际CPU后处理合计7次（最初2、补充2、HTTP初轮2、动态D补验1），后续HTTP验证命中缓存，没有新增渲染。测试源是合成波形，0真实TTS、0真实ASR、未触碰生产资产，不把字节/缓存验证写成人工试听或语音内容正确认证。

`http-verification.json`验证隔离QA服务23次HTTP请求，规划复用、两条成品GET、7.3秒整批试听的脚本顺序PCM精确一致（含2秒无对白镜头时长）、HEAD/Range/删除、原音与处理音ZIP原字节、视频包处理WAV及runner字节、一次性下载token与缓存重试均通过。QA服务禁用外部API，导出/试听不渲染，不能把这23请求重复计作23次模型调用。浏览器CUA因`failed to write kernel assets`（os error 3）未能初始化，没有真实浏览器视觉/交互或人工听感验收。

阶段mock/合成回归覆盖纯原音播放、批次前置条件、端点继承与空镜位置变化、静止归一、手调、取消/晚到结果、改源、缓存、独立保存和导出绑定。Domain、renderer、UI及导出阶段结果有交叠，不累加为最终整站数字。收据另在`I:/AI/asmr-director-audio-post-processing/2026-10-23/{domain-qa,renderer-qa,ui-qa}`及主证据根的delivery日志。

性能优化前独立selected树完整Vitest为2018通过、0失败、3条件跳过，156文件（`vitest-results-pre-perf.json`，树`6cf6f91…`）；跳过实际旧空间adapter、Windows符号链接保护、真实ASR整段集成，不能称全部验收。最终优化版48文件selected树`f10bb2e59f1c250a1e8d59498e7f98eb96f4858d`完成20文件207项定向测试，0失败/跳过（`final-targeted-results.json`），覆盖helper/mix指纹、三交付、原音UI/App/面板及runner ZIP，旧30ms取消用例也串行回归。两层测试不相加，最终优化版未完成整站全量重跑。独立Python渲染器19项合成测试通过。

优化后曾尝试2workers全量测试与构建并行，主机内存不足导致构建`ZoneAllocation` OOM/退出134、测试host stack overflow中断，未产生完整报告，原日志保留。最终采用上述串行定向验证、完整类型与ESLint通过，再单独串行构建，Node heap上限2048MiB；`build-final.json`记录exit0、BUILD_ID `Z0pV5XluzH0XapvZhehW9`。新build再次通过同23次HTTP复验，0新增外部API/CPU渲染，命中已有缓存。

`deployment-verification.json`记录04:25 HKT同址3001部署并核验，listener PID18348、launcher32936。7个实际页面JS与构建字节/SHA相同，新按钮命中已服务JS；页面200、API配置ready，两条新POST路由以GET访问返回预期405。332份原生产文件size/mtime保持，0生产生成、未操作浏览器工程存储；27份范围外working文件SHA、HEAD `03cd396`及空索引保持。选定源码核对624个blob，最终产品appTree为`5c0b85a7b068cd3e68e612aa4d9067e9033e4ce9`，不依赖另会话空间/Qwen改动。

规范启动脚本`I:/AI/asmr-director-service/2026-10-16/start-production.ps1`现指向`D:/CodexWorkplace/asmr_director_release_verify/2026-10-23-explicit-postprocessing/apps/web`，dist为`.next-explicit-postprocessing`并链接主证据根`build`；复制主环境配置，保留既有runtime roots。回退脚本为主证据根`start-production.before.ps1`。刷新3001后，试听采用原音、完成当前分镜，再点「生成后处理」；处理完成后试听成品或整体试听，旧混音提示需重混时再显式重混。

逐镜卷积只保证规划声位衔接，不等同房间尾声或速度已物理无缝；用户真实素材听感、真实浏览器视觉/交互及用户另一主机H3/完整原生合片仍未验收。未新增内容审核、人工确认或自动采用。主证据根为`I:/AI/asmr-director-explicit-postprocessing/2026-10-23`；最终文档/源码汇总由主代理在四文档冻结后写入`verification.json`，不在记录内自引文件SHA。

## 文档同步

当前项已同步到`docs/ROADMAP.md`、`docs/AI_HANDOFF.md`与`docs/project-archive.md`，旧记录保持历史。功能完成与父阶段仍进行中分开记录，不扩展路线。
