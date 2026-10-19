# 短句分镜初始化：首镜独立，后续连续

日期：2026-10-20（Asia/Hong_Kong）。用户明确暂缓整段识别切分问题，改为调整短句后的分镜初始模式。Audio Quality V1继续进行中，SFX暂停，不新增顶层路线或继续修改同音切分策略。

## 修改与兼容

只修改统一入口`getClipStoryboardReferenceMode`的新镜初始化回退：短句工作区（含无workspace的旧短句工程）首镜为`new`，后续有有效相邻前镜、且没有保存分镜/手选偏好的片段默认为`continuous`。整段工作区保留既有默认。静音空镜沿现有voice时间线顺序参与，不新增跳镜规则。

模式优先级保持：首镜仍强制new；手选referenceModes优先，其次已保存shot.referenceMode；已有legacy分镜按previousClipId有无保留原连续/独立推断。只有完全未设置的新分镜使用新默认，不迁移或覆盖旧分镜、不批量写用户JSON。旧独立分镜尤其保留new，防止导出项目包被默改连续。

列表按钮、单镜编辑器、批量分镜生成和视频包导出均共用该入口。连续镜头仍要求相邻前镜完整可用，缺失时保留既有等待/错误提示；手选新镜头仍可使用原流程。未改模型请求格式、生成参数、连续生成器的依赖/回退设计或任何音频切分逻辑。

产品代码仅`apps/web/src/lib/asmr/video-plan.ts`。调整既有video-plan、script-editor-panel、clip-storyboard-editor、studio-app.batch测试对初始化的预期，独立模式用例明确选择new，旧分镜fixture不整体硬塞模式。`.gitignore`增加本轮独立构建目录。

## 验证

证据根：`I:/AI/asmr-director-storyboard-defaults/2026-10-20`。

- 139项核心/工作区/列表测试、41项单镜编辑器测试、7项批量分镜测试，共187项定向通过。原核心初跑1项/组件8项依赖旧初始new的预期已按用例意图更新；修改后的独立/连续参数化分支均实际选择对应模式。
- 批量组件另7个音频用例按本次分镜范围过滤，不能称全文件/整站测试全过。初跑其中5个因既有音频任务间隔5秒而waitFor仅1秒超时，与本轮模式无关，未顺手修改产品或其等待测试；初跑及过滤回归日志保留在`I:/AI/asmr-director-service/2026-10-20/storyboard-reference-default`。
- 完整TypeScript、相关5文件ESLint、正式Webpack构建通过。真实应用函数只读scope probe确认：无workspace短句/显式short为new→continuous→continuous，paragraph维持new→new→new，手选new保留，读取不修改工程对象。
- 构建输出在I，本地`.next-storyboard-continuity-default-production`为junction；Next自动改动的tsconfig/next-env已恢复构建前原字节，保留共享配置和其它本地工作。

## 3001与数据保护

05:07 HKT正常更新3001成功，BUILD_ID`AkzV2cH7nm4ZoVuIHjttq`，监听PID21316/启动器27004（操作前重查），替换旧build`qikKsnc9iyniAim3_PRCC`。页面、声音目录、短句/整段候选和新build静态manifest共5路HTTP200。`deployment-verification.json`记录真实成功身份；没有新浏览器截图/视觉验收或浏览器存储操作。

独立只读验收`independent-deployment-verification.json`的checksPassed=true/issues=[]：实际HTML引用的page-846ba9eadd134eae.js HTTP字节SHA`D8AC151B45CA5D72FD8B0C5C828A0118F0AC67E6B060BBDBE7AE55C71A553640`与I盘构建一致，实际客户端包含新默认分支；profile/134候选/规范启动入口一致，无生成锁或残留模型进程。不是只改源码未更新客户端。

生产134候选manifest SHA保持`0EDD0530C4BC30EC523ABAA9654D81C4CBBDEDBFAD79ACFFE942065499060C92`，语音profile SHA保持`37E9404AB3690207ECB83C38E7892347082B7B952C8680052CAFB1E1C05317DC`；不换参考/语音运行时，不调用TTS/ASR/DeepSeek。规范恢复入口`I:/AI/asmr-director-service/2026-10-16/start-production.ps1`已更新新dist，其余I素材/voice-work/固定CLI/runner配置沿用；旧启动脚本保留在证据根供审阅回退。部署脚本已执行，旧PID守卫不可直接重跑。

本轮未提交推送。同步ROADMAP、AI_HANDOFF、project-archive；原有空间工作台/Qwen/音频等共享本地改动保留。识别切分遗留的两个后文锚点阻断仅保留测试证据，按用户要求暂缓处理。
