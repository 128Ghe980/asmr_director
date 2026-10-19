# 新增“生成未生成”音频按钮

日期：2026-10-16（Asia/Hong_Kong）。Audio Quality V1 仍进行中，SFX 暂停。用户要求按钮放在原全部生成音频按钮旁边。

在原“生成音频”右侧新增“生成未生成”，显示当前可处理数量。原音频／分镜生成与更多菜单中的重做操作保持。新增 `audio_ungenerated` action，复用音频总览的当前文案判定，仅处理 pending／needs_update；已采用音频和当前可用待采用候选均跳过。不因只更换声音配方或 seed 而重跑已有当前候选。无对白／空文本不进入音频队列。

判定沿用工程 ID、短句／整段库、ready 状态、文案／表达及生成上下文指纹。已放弃／过期／异库候选不算当前结果。短句 long_text 已保留、可试听的完整原音沿用现有总览规则算生成过；整段 review 原音不能冒充可用分句结果，仍需通过分段或人工确认。整段逐成员判定缺结果，再映射组首去重，不能只看首句。

候选列表状态增加 workspaceMode，切库不会短暂沿用旧 ready。读取中或失败时新按钮禁用并显示“—”；handler 再检查状态。每项派发前重新 GET 当前工程＋工作区候选，成功解析后结合最新工程复核资格；读取失败不会启动该项模型。结束后刷新列表。沿用已有音频串行队列、5秒间隔、取消、原音保存和人工采用规则。

验证：队列 36 项、按钮 9 项、总览／编辑面板 28 项，共73项定向测试通过；完整 TypeScript、相关 ESLint 和 Webpack 正式构建通过。独立只读复核接线／切库／新候选复查无必要修正。没有运行真实 TTS／ASR，也未用浏览器操作用户工程或宣称新视觉验收。

19:01 启动、19:02 核验3001：dist `.next-audio-ungenerated-production`，BUILD_ID `u5Mvhqpkigpa29LHhohqY`，PID19308／启动器16796（恢复时重查）。页面、声音目录、当前工程短句／整段候选接口、新浏览器bundle HTTP200，新按钮在所服务bundle中。134条候选manifest SHA与操作前相同，HEAD a115b3f 未变；没有自动生成、确认、采用、提交或推送。需刷新原 http://127.0.0.1:3001/ 页面后由用户试用。

证据：`I:/AI/asmr-director-service/2026-10-16/audio-ungenerated` 下的 before.json、queue-tests.log、ui-tests.log、integration-tests.log、typecheck.log、eslint.log、build.log、start-receipt.json、verification.json 及服务日志。源码外构建和缓存留I盘，D仅junction；只补充两个实际新dist的ignore，既有空间等共享改动保持。构建自动添加的 tsconfig／next-env 路径经一致性核对后恢复原字节。恢复入口 `I:/AI/asmr-director-service/2026-10-16/start-production.ps1` 已指向新dist，其他运行环境不变；旧脚本在本证据根保留。
