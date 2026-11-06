# 2026-11-05 无台词先声音与空间规划

本轮属于 **Audio Quality V1**，按用户要求试验先生成无台词段的独立助眠声音，再用音频参考生成画面，并检查 prompt 与空间后处理的关系。实现、导出和本地部署完成；真实 H3 音画贴合与听感仍待生成机试跑。未新增顶层路线，不恢复其他暂停项。

## 实现

- 视频包可选「无台词先生成声音（试验）」，默认原方式；只影响本次导出，不修改工程。严格校验各无台词段/part 的声音设计，含被历史 schema catch 吞掉的无效 videoPlan。包可选 `silentAudioMode: asmr-first`，CLI `native|asmr-first`，GUI 按项目/原生/先声音。
- 批跑先完成本次独立 ASMR 候选，再让同段同候选的视频进入已有 `LoadAudio → TrimAudioDuration`。该音轨同时进入 H3 参考与最终主视频原声；角色图、连续尾帧、独立镜头频率保持。无需新增本地 FFmpeg、服务或模型；实际 H3 手势同步不作保证。
- 无台词提示使用非人声 `<Audio 1>: fully_copy`，保留视觉/动作/空手约束，替换会要求原生拟音的标准 retention。原合片保留 raw，增强合片只执行一次既有 D 并 replace；对白原规则不变。
- 缺失/失败/过期的声音明确阻塞对应画面。缓存包含同候选声音身份与成功媒体 SHA；只改空间参数仅更新增强合片。修复原生回切有效 prompt 身份、空值、部分任务下读取既有声音依赖和小数秒保全；旧原生默认指纹保持。
- 新创意提前安排声源路径，设计与校对共用 7 种 movement 的语义及端点约束。创意最后核对/repair 再检查有条件的单向移动安排。固定声源、房间底声和杯口画圈不强套环绕。未扩展 schema 或 DSP；多次往返/定时停留/多独立源仍不能由整段单路径表达。

合同：[中文](../specs/2026-11-05-sound-first.zh.md) / [English](../specs/2026-11-05-sound-first.en.md)。

## 审计与真实 DP

主 QA：`I:/AI/asmr_director/qa/asmr-sound/2026-11-05-sound-first/`。

旧39段万圣节声音38 static、1 left_to_right；当前《直播间里的助眠小时光》16段全 static/pan0（4 trigger、12 ambience）。当前稿本身没有发声过程中的整体移动，静止基本相符。旧稿有文字左右与静止参数不符；D 会先 downmix 再做空间渲染，仅 prompt 写左右不能代替 post 参数。既有 orbit 为完整 HRTF 绕行，而非只有声像。

共 **9 个业务调用、10 次外部 fetch 尝试、9 个模型响应**，均 DeepSeek；1 次网络失败另存重试，1 次整稿在自动修复后仍因首段预计超过15秒被拒，均保留原始证据。0 新 TTS/ASR/H3。

- 四个明确动作案例：杯口摩擦 static、指尖单向横扫 left_to_right、靠近 approach、真实绕听者一圈 orbit，动作和端点语义通过。它们不是自由创作多样性的证明。
- 同一90秒自由 brief 首次3个声音段仍全静止；第一次加强后稿件仍没有移动且台词时长失败。最终把资格条件说清，并在末尾检查和 repair 中复用规则。
- 最终自由创作9段：5台词预计47秒、4无台词44秒，总91秒；包含8秒边敲木盘边左到右移动。将该段正常编译并以空 instruction 设计，真实结果 `left_to_right`、pan -0.8→0.8、near→near，中文动作/声音意图到英文画面及后处理链路相符。
- 这只验证限定样本与链路，不保证所有创作都符合，也未听任何新 H3 成片。用户旧16段与本轮试跑包保持已有静止声位，便于单独比较声音优先流程。

证据：`spatial-prompt-audit.json`、`dp-semantic-review.json`、`dp-final-review.json`、`dp-creation*`、`dp-chain/`。

## 验证与部署

- 最终隔离 **21文件375 Web测试**、16文件 lint、Webpack/完整 TypeScript 构建通过；运行器 **172/172**（含19项新模式），独立审查复测4个边界通过。
- 扩测发现旧 ambient-storyboards 第47行仍预期7秒必须拆块；旧已部署 release 复现同样失败，仅修断言为缺环境声描述，保留时长/旧元数据保护。首次测试日志输出受 GBK 编码中断，随后 UTF-8 重跑；失败证据保留。
- 先部署基础 sound-first build `tby7Xl6lcQW_sGcsbY9oG` 并完成实际 UI 下载；仅创意空间规则再改后，最终3001使用 `.local/releases/sound-first-spatial/apps/web`，build **`RcDxphISW5cJw4YWgXQnG`**，00:46HKT启动父7384。仅停止确认的原3001进程13044，其他服务不动。
- 最终服务8静态资产、7参考和4既有WAV读取核对通过。启动入口仍 `I:/AI/asmr_director/service/2026-10-16/start-production.ps1`；本轮最终回退脚本在 `spatial-refinement/start-production.before.ps1`（回第一版），主QA同名文件回 voice-continuity。
- 当前16段工程三次正常 UI JSON 导出完全同字节，SHA `23befbbd0627b770b50202fbc0914160ae7c92dee196430c925b8dc4d211c84d`；11采用/5无台词/16设计/11D、首段0.35秒、本地已保存保持。新选项可见并勾选。截图 `ui-download.png`、`ui-final.png`。
- 28历史范围外文件逐字保护，不叠加脏空间实验代码；隔离最终仅8生产+8测试覆盖，runner3项独立改动。最终冻结及文档校验见 `final-verification.json`。

## 交付

`I:/AI/asmr_director/artifacts/h3-asmr/ASMR-sound-first-trial-2026-11-05.zip`：22,998,653字节，58文件，SHA `ce2786a4d5aef9ff1b92f7c2463c300f0e7644905a7618063c220005b94b5651`。实际 UI 导出，原16段（11对白+5无台词）、另16独立ASMR，约108.848秒含D尾音与留白；未内置角色图，生成机选择自己的角色参考。打开run.bat按项目设置并勾选合并顺序预览。

11条包内人声逐 PCM 等于已采用的有效 D 成品加留白：前10条各0.35秒、末条0，总3.5秒。22个原声/D源文件保持；无台词均非人声fully_copy/replace；各段≤15秒。新默认与显式native各32份禁网payload共64份通过，音频来源、图/尾帧、角色与独立镜头节奏均核对。只有占位音源依赖图，没有冒充已经生成音源。详见 `delivery-package-verification.json`。

`I:/AI/asmr_director/artifacts/h3-asmr/ASMR-video-runner-sound-first-update-2026-11-05.zip`：2,852,742字节，14文件，SHA `e9ebd7b564f55729b5283f89e785c5f5e006da4b25d456ab2dbe66a536f9a626`。更新runner/README/run.bat/UTF-8更新说明，10个既有节点/引擎/SOFA文件与11-02包逐字相同。不覆盖工作流、用户工程或结果。详见 `runner-update-package-verification.json`。

本轮未提交推送，基线为已推送 `6ec3cb023f39eb484321fb7580412df60330d659`。已同步 ROADMAP、AI_HANDOFF、project-archive；后续先在目标机比较 raw 与增强版和画面跟随效果，不能把禁网图验证当作 H3 质量验收。
