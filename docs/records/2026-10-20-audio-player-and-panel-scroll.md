# 2026-10-20 — 统一音频播放器与右侧滚动

所属阶段：Audio Quality V1 继续进行中，SFX 暂停；整段切分问题按用户要求暂缓。用户要求先检查推一版，再优化全部前端音频播放及右侧嵌套滚动。

## 先完成的发布

已提交并推送 `90d4eb415a0fe3a57ee98b5e19bf70b9d72aa565` 到 `origin/codex/voxcpm2-product-generation`，远端同 SHA，索引为空。该提交是此前语音可靠性/批量音频/短句分镜及相关工具记录，不含本轮界面修改。发布独立树 1870 Vitest / 3 条件跳过、48 Python、类型/源码 ESLint/正式构建通过；详见[发布记录](2026-10-20-voice-reliability-release.md)和仓库外 `release/release-verification.json`。

## 界面改动

- 统一四处原生播放器调用点：候选/完整原音/参考声音、候选分组、参考录音导入、已采用整体试听。真实 audio 元素保留 ref/标签/preload/媒体事件，由深色紧凑控件提供暂停播放、真实进度/时长、静音及更多播放选项。下载、音量及倍速保留在收起的菜单中，不处理或重写音频。
- 页面播放协调覆盖共享播放器和单片/混音两个离屏 Audio。真实 play 事件才暂停上一已登记音频，失败的播放尝试不提前打断其他试听；换源、卸载、停止、结束、错误均清理相关生命周期。去掉候选面板旧的局部 audio 全量轮询，避免两套互斥重复暂停。
- 声音面板保留外层主滚动，去掉候选、原始录音、识别对照和识别文本六处内部高度/滚动限制；原有折叠及加载更多保留。声音/分镜外层预留稳定滚动条宽度；H3只读预览自动随内容/面板宽度增高，仍可选中复制。编辑输入框保留正常编辑语义。
- 空间工作台已有自定义 A/B/尾音播放引擎保留。生成/识别/切分/采用/工程数据/音频文件以及便携视频包/运行器协议均未修改。

设计：[中文](../specs/2026-10-20-audio-player-and-panel-scroll.zh.md) / [English](../specs/2026-10-20-audio-player-and-panel-scroll.en.md)。

## 验证与限制

初次整合两组主回归共 249 项通过：6 个音频/识别 suite 131 项、10 个工作台/分镜 suite 118 项；完整类型及相关源码 ESLint 通过。包括强化参考选段 33.49/33.5 秒停止边界、整体试听到期 9999/10000ms 和 StrictMode token 只释放一次，以及播放状态/加载重试/换源晚到事件。新增协调规则的旧测试调整为先触发真实播放，再验证仅暂停上一 active 音频，不再要求暂停从未播放的元素。

补齐菜单后的最终 6 主 suite **134 项**通过，另 10 工作台/分镜 suite **118 项**通过，合计 **252 passed / 0 skipped**；共享组件19项包含在134中，独立审查117项与布局76项均为重叠验证，不重复累计。完整类型/相关 ESLint 及最终正式构建通过。菜单曾采用向上浮层，源码复核发现可被顶部滚动祖先裁切，在部署前改成默认收起的内联展开区，没有浮层或内部滚动。生成忙碌用例限定检查生成设置，试听倍速独立可用。

首轮构建 `96OfiaY8GhFbmhglpPHqs` 没有部署；最终 **`3X49m7UFCwJwpnjPAPAyZ`** 于 **06:16 HKT** 更新同址 3001，dist `.next-audio-ui-production` 指向本轮 I 盘构建，监听 PID 23964/启动器27684为当时快照。页面/生成目录/两页候选/新静态manifest五路 HTTP200，原134候选manifest及profile SHA保持。启动入口 `I:/AI/asmr-director-service/2026-10-16/start-production.ps1` 同步新dist，保留固定Vox CLI/I盘素材与视频runner配置，旧启动脚本备份在本轮根。部署脚本含旧PID21316的单次保护，成功后不可直接重跑。

最终构建前后40个非文档工作文件SHA保持，Next自动生成的tsconfig/next-env字节恢复；新构建、日志与全部测试素材放 `I:/AI/asmr-director-ui-polish/2026-10-20/`。实际HTTP提供的JS/CSS与构建字节身份、25项范围外工作保护、文档引用及远端发布身份由 `final-verification.json` 集中核对。

内置浏览器和 computer-use 初始化均报 `failed to write kernel assets: 系统找不到指定的路径。 (os error 3)`，没有可用截图；未绕过旧浏览器安全限制，也未操作浏览器工程存储。不把源码/DOM测试当作真实桌面、250px、触屏或听感验收。最终部署保持同一 127.0.0.1:3001 来源，生产资料/运行器保持情况以保护和HTTP收据为准。

## 证据入口

- `release/`：真实提交/远端收据、选取树、1870项日志/48Python及构建，源码快照在 D 盘专用小目录。
- `audio-qa/`：共享播放器/协调器行为测试与定向类型/lint；`layout-qa/`：六处布局调整及原76项回归；`ui-audit/`：选段/令牌测试及独立源码审查。
- `ui-qa/core-tests-final-inline.log` / `integration-tests.log`：最终252项；`static-checks-final.json`及最终类型/lint日志。更早日志保留为开发快照。
- `build/`：正式构建、BUILD_ID、配置原字节恢复/40源码保护；`protection-before-ui.json`、`deployment-verification.json`及`final-verification.json`。

本轮界面与文档改动在首次发布之后留本地，未自动追加第二次提交推送；无新 TTS/ASR/DeepSeek/H3、模型安装或音频确认采用。父阶段不因界面优化改为完成。

## 14:37 HKT — 按用户要求重新启动导出服务

用户准备导出音频与分镜，要求先重启。检查时3001已无监听、无生成锁/模型或识别进程，因此未停止任何PID；直接运行现有canonical启动脚本，保持同一已验收build `3X49m7UFCwJwpnjPAPAyZ`，3.3秒Ready。当前监听PID20572/exec session88769为当时快照；页面、生成目录及新build静态manifest均HTTP200，原134候选manifest/profile SHA与上轮一致。未重建、修改启动配置、运行模型或操作浏览器工程，没有替用户实际导出工程。批下载/视频包编译路由、runner四文件及运行依赖只读预检齐全。

先前将启动和核验合成的命令被自动审批拦截，未执行且没有细因；随后仅执行现有已核验启动脚本获准，再单独做只读检查，没有改变权限或使用替代执行工具。收据：本轮I根 `restart-3001-1437.json`。原06:16部署PID为历史，不代表重启后的当前进程；父阶段/切分暂缓及未二次推送状态保持。
