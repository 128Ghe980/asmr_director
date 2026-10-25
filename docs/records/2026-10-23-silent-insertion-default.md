# 新增无对白镜头不再预设剧情动作

日期2026-10-23；Audio Quality V1继续进行，SFX暂停。本修复完成，未新增路线、提交或推送。

用户指出「寒潮前的归家」新增第4段无对白描述不合剧情。代码根因是addSilentClip在没有自填description时固定写“轻轻放下水杯，镜头停留在桌边。”，插入过程没有API调用或前后文分析。后续分镜API本已有全稿/位置/相邻语义，但会把这个错误具体动作当作本镜意图。没有读取用户当前浏览器工程，不能声称核对了其第4段实际全文。

默认改为“待设计：根据前后剧情安排自然衔接的无对白画面。”，不擅自安排道具、位置或动作。分镜silent提示区分待设计/一般衔接要求与用户具体意图：前者根据全稿上下文设计一个可完成动作或景物停留，不当成已发生事件；后者继续优先遵循。自然环境底噪、无对白/无WAV及不超过5秒规则保持。插入仍同步、没有新增API轮次、异步流程、按钮或schema。默认4秒及用户自填description优先逻辑不变。

只影响后续新增；旧项目描述不迁移。已有第4段若仍是旧水杯默认，可在原描述框改成上下文衔接要求或用户实际动作意图，再重新生成该镜。没有自动改旧文字或旧分镜。

## 验证

独立选定快照7文件153通过/0失败/0跳过，完整类型、5文件lint与2048MiB堆限制串行build通过。包含实际插入入口构造的寒潮门口第4镜合成场景、完整脚本/currentIndex与前后文入参、自填意图保留、mock输出传递、无WAV、单请求、两工作区同步与既有语音资产保留。子代理57项是重叠子集，不相加。初次选定过滤器误写ambient测试文件名，先过6文件145项，改正后完整重跑7文件153项；不声称首轮已覆盖ambient。独立只读审查无阻断发现。

编译HTTP200、7JS与1CSS字节/SHA匹配，服务包包含新默认与已有结果/校对/后处理入口，不含旧水杯默认。全部模型行为使用mock，0真实API/TTS/ASR/H3；不声称验证模型理解或当前真实第4镜质量。CUA既有os3故障未重试，无真实浏览器项目读写/视觉验收，未重跑整站。

## 部署与保护

15:25HKT更新3001 build **Czaj77uIbBZiiD2gleTT2**，PID28524替换36452（部署时快照）。规范启动 I:/AI/asmr-director-service/2026-10-16/start-production.ps1 同步指向 D:/CodexWorkplace/asmr_director_release_verify/2026-10-23-silent-insertion/apps/web 和.next-silent-insertion，旧脚本留QA，运行时/素材路径保持。实际服务7JS SHA/配置/三个POST-only405验证通过，356生产文件size/mtime保持；27项另会话改动不混入、HEAD及实际空索引保持。

相对上次部署仅5个apps/web源/测试文件改动：voice-segments、clip-storyboard-service、silent-shots测试、clip-storyboard-service测试、studio-app.speech-workspaces测试；便携批跑器/包协议不变。appTree b112fbf7d1b273835d2aec527ea2719f01b24eb3在文档刷新后保持。

证据根 D:\CodexWorkplace\asmr_director_qa\silent-insertion-2026-10-23，包括storyboard/verification.json、vitest-results.json、checks-result.json、build-final.json、preview-verification.json、deployment-verification.json、source-verification.json、verification.json。既有中文/英文分镜spec和三入口同步。
