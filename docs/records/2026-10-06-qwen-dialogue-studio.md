# 2026-10-06 Qwen 多角色剧情配音台

用户在听完此前九格情绪样本后反馈“还行吧”，随后要求生成古风剧情双人对话，用正常女声和正太音2配音，并做成支持文案输入、API生成n个说话人对话、设声及合成的网页。

本次独立目录为 `I:/AI/qwen3-tts-dialogue`，网页7866，只读复用现有 `normal_zh` 与 `user-dd2a4e32-e72d-4e80-bf7d-96611831b52b`（正太音2）。轻量后端通过7864 Gradio API使用原有Qwen队列，不启动第二个显卡模型。文字API复用既有服务端配置，不复制密钥；只发送剧情文本要求。

契约：[中文](../superpowers/specs/2026-10-06-qwen-dialogue-studio.zh.md) / [English](../superpowers/specs/2026-10-06-qwen-dialogue-studio.md)。首个样例《雨渡送药》八句，女医师沈知微和少年药徒阿砚冒雨赶渡船送药；默认seed45、句间300ms、正常发声及克制/明显情绪。

## 验证记录

实现和实际验收已完成。网页支持输入剧情要求、1–8个说话人、2–24句对白，调用既有服务端文字API；角色、对白、情绪、强度、语速和参考声音可编辑。音频任务串行使用7864既有Qwen队列，生成后提供整段/逐句试听、WAV/对白/SRT/manifest下载和历史记录。刷新恢复草稿与结果；修改配音参数会标明旧结果需要重生成。

- 真实文字API通过：`deepseek-v4-pro`生成3个角色、6句对白，页面展示苏芷/阿青/陈伯。原始返回与截图保存在 `logs/text-api-job-6198e86e077242d1ac8d7beaf61387c2.json` 和 `logs/api-three-speakers.png`。八句交付样例另有冻结的人工脚本，不将它冒充API返回。
- 《雨渡送药》完整任务 `3fc32d9e69084d629efd1ec5a5090153`：8句、48.26秒、24kHz单声道PCM16，seed45、句间300ms。沈知微绑定 `normal_zh`，阿砚绑定正太音2。整段SHA256为 `3adf4765cd9a1d43960da316aa5188778e494be683549a91dda399b1ac0e204e`。产物目录为 `I:/AI/qwen3-tts-dialogue/outputs/3fc32d9e69084d629efd1ec5a5090153`。
- 技术验收117项通过、0失败：真实接口、八句声音/文本/指令绑定、逐句来源字节复制及SHA、精确PCM拼接/静音、字幕时间和文件路径。证据 `logs/live-verification.json`；后端24项模拟测试通过，实际完整输出为 `logs/unit-tests.txt`。
- 浏览器整段实际播放到48.26秒，`ended=true`、`played=[[0,48.26]]`、无媒体错误。实际编辑使旧结果stale，恢复后fresh；刷新后完整结果、8句和双声音绑定保留。证据 `logs/browser-verification.json`。桌面截图 `logs/dialogue-studio.png`；390px窄屏无横向溢出，截图 `logs/mobile-generation.png`。逐句音质和音色相似度仍由用户试听判断。
- 原生浏览器WAV下载成功到 `C:/Users/Yuki1/Downloads/combined.wav`，2316524字节，SHA与原产物相同。证据 `logs/download-verification.json`。运行时、缓存及原产物位于I盘；浏览器使用自己的默认下载目录。
- 保护基线 `logs/protected-before.json` 包含64个既有文件，其中profile、五条参考WAV和四份原话共10个源文件。`logs/protected-after.json`确认64项SHA全部不变。已有参考、模型、旧候选、社区bridge/app和情绪试听页未改。

## 实际故障处理与继续生成

首轮SDK的单线程池导致SSE读写等待，调整 `gradio_client.Client` 的I/O线程数为4；显卡队列仍串行。只调用`release_model`的真实连通验证通过，证据 `logs/client-transport-verification.json`。

随后第三句出现系统内存/分页提交不足。即使模型释放，旧7864自属进程私有提交仍约8.27GB；仅通过既有脚本停止并重启该自属进程，未关闭其他软件或修改分页/系统设置。新进程私有提交约0.61GB后继续成功，证据 `logs/worker-before-restart.json` / `worker-after-restart.json`。完整生成后模型已释放。

网页增加“继续未完成配音”：仅当前固定脚本、声音和参数与旧任务一致时可用；校验连续已完成前缀的WAV/JSON/SHA、参考SHA和真实参数后，复制原字节到新任务，再生成缺失后缀。旧任务不覆盖。本次完整任务从 `7a5d00b64be24e83a47bdac8af73f161` 复用前2句并生成后6句。初次失败/部分结果及诊断均保留；不得自动重启上游或循环重试内存失败。

## 使用入口

网页：[剧情配音台](http://127.0.0.1:7866/)。启动 `I:/AI/qwen3-tts-dialogue/start.cmd`，停止 `stop.cmd`；启动脚本仅在7864缺失时启动既有社区依赖，停止仅关闭本网页自属进程。说明见该目录的 `README.md` / `README.zh.md`。实际启动幂等/归属检查见 `logs/launcher-verification.json`。

未更换正式ASMR Studio provider/profile，未改顶层路线；音质V1仍进行中，SFX暂停。此前旧耳语拒绝和新耳语待听记录保留。未提交或推送；无关空间工作台改动保持。

## 后续请求 — 强一致与单句重生成

用户随后反馈指令控制有效，但声音一致性过低，要求增加强一致模式和单句重生成。新功能只减少指令条件变化，不把固定输入等同于听感一致性已改善。

强模式默认关闭，打开后按角色填写完整有效 1–250 字指令；首尾空白统一归一化一次、内部换行保留，同角色所有句子复用该字符串，不再叠加逐句情绪/程度/速度。关闭后草稿保留、恢复逐句表达；旧任务缺少新选项时按 false/空映射兼容，强模式下未使用的逐句表达不影响有效快照。

完整结果逐句提供“本句新种子”和“重新生成这句”。UI 默认在该句上次实际 seed 基础上加一并要求不同值，不改全局 seed；可仅改目标句台词/有效表达，其他句、声线及有效全局设置需保持。改变全局设置需重新生成整段。服务器验证完整源任务的音频/JSON/实际参数/参考 SHA，按顺序原样复制非目标句、只生成目标句，再按新时长重拼 WAV/SRT，并另存新任务。旧结果保留；失败/取消只保存完成前缀，逐句种子计划随继续任务保留。

已完成的扩展检查：后端34项模拟测试通过，完整输出 `I:/AI/qwen3-tts-dialogue/logs/consistency-unit-tests.txt`；前端 Node 检查通过。真实网页确认旧结果在强模式关闭时仍fresh，关闭状态编辑固定指令草稿不使结果过期，开启后24个逐句表达控件禁用、旧结果不能单句重生，刷新保留角色指令。新强模式结果fresh且`t04`默认seed46可提交；仅临时编辑`t04`时只该句可重生，同时编辑`t01`和`t04`时全部禁用，恢复后可用。固定指令只加首尾空白仍有效、可重生，恢复原文；这依据有效字符串归一化，不声称边界空白原样传入模型。

强模式完整任务 `faeeb20182784bdbb2b62a91ae349431` 实际8句、50.02秒，双声线仍为`normal_zh`/正太音2，global seed45/gap300ms。整段SHA256 `b9d6cbd5fcd3e320a94acdc84aafe9a41662debefbfc48d92d0848f915735964`。随后单句任务 `e39d7c9782f44d2881b9870c9c8e4333` complete、50.10秒，仅`t04`新生成seed46、7句复用；目标时长7.20→7.28秒，后续字幕随真实采样数重新计算，未改全局种子。重拼整段SHA256 `9f2a3c7cecdc02ec578dcab058e345ee2afc2f0bbbbc709d3d4387fbc2a0114c`。同一社区工作进程连续完成整段和单句，没有再次重启；两任务均确认model_release完成。

独立 `verify_consistency.py` 实测342项通过、0失败，收据 `logs/consistency-live-verification.json`。它确认同角色完整有效指令与提交输入一致，非目标7句WAV/JSON/实际seed/原生成metadata保持，目标seed/source/WAV改变，精确PCM/静音/SRT、非静音无削波。`logs/consistency-before.json` 的37个旧剧情文件与此前64受保护文件SHA全部保持，未覆盖首轮历史receipt。网页单句新结果fresh，`t04`实际seed46的下一建议为47，其余7句实际seed45的下一建议为46；页面无错误。50.10秒整段实际播放至结束、无媒体错误，原生WAV下载SHA一致；刷新保留强一致指令和下一种子，390px无横向溢出。证据 `logs/consistency-browser-verification.json`、`consistency-download-verification.json` 与 `consistency-studio.png` / `consistency-mobile.png`。 声音一致性的主观改善仍待试听；声音是否更一致仍由用户试听，不作通过声明。
