# 识别修复与候选重检发布

日期：2026-10-07（Asia/Hong_Kong）。路线标识：既有 **人声导演与真实 ASMR 音效质量 V1**，以 [ROADMAP](../ROADMAP.md) 为唯一来源；本次实现已验收，父阶段仍进行中，SFX 模型试验仍暂停。

用户明确授权「记录一下推一版」。本次发布自 `bdfd1cc` 之后累计的识别修复、诊断界面和候选重新识别功能。之前记录的「未提交/未授权推送」是当时快照，由本次授权覆盖；实际提交 SHA、推送结果及远端相等由 Git 与外部发布收据确认，不在提交前声称推送成功。

## 发布内容

- 修复目标完全匹配却被后文独立「嗯」阻断的衔接检查。保留既有文字容错阈值，严格验证源时间、静音与独立左右/最终识别；仅允许识别器省略已确认的首语气词。
- 修复自然内部停顿超过 1200ms 被误判：停顿记录上限按既有服务协议为10000ms，拼接配方仍仅采0–1200ms样本，不缩短语音和自然停顿。
- 识别对照显示完整原音、目标、后文、试裁/最终文字及准确失败阶段；历史警告按检查证据解释。
- 「重新识别」与采用/放弃同排，只检查可精确追溯的长文完整原音，另存新候选/trace，不调用TTS/文本API或自动采用。支持取消、300秒总上限、切换/迟到保护和manifest锁内原候选状态复核。
- 同步 [语气词修复记录](2026-10-07-audio-quality-v1-continuation-recognition.md)、[长停顿修复记录](2026-10-07-audio-quality-v1-long-internal-pause.md)、[重检记录](2026-10-07-audio-quality-v1-candidate-recheck.md)、对应双语契约及路线/交接/归档。

## 证据和边界

此前工作区验证：Python最终92项；语气词阶段172项JS和正式构建、长停顿阶段51项TS服务契约、重检阶段8文件136项、相关ESLint/完整TypeScript/最新正式生产构建通过。各阶段重叠测试不相加为一个总数。

真实原音语气词复测得到4.36秒/100%，新自然停顿原音复测得到5.05秒/100%及1420ms停顿。产品按钮实际取消后旧manifest原字节、原音/素材保持；再次点击成功追加1候选/2WAV/7个新trace文件，原音/source metadata逐字节复制，旧57候选/489原音及参考/profile/空间/Qwen/H盘输入保持。刷新、20段工程/50DOM输入/时间线及参考normal_zh保持，桌面与390px三按钮同排、无横溢出、console为空。未采用新候选，不把文字匹配当成克隆听感验收。

重检只支持有长文计划及唯一原音关联的候选；旧单句模式历史缺少稳定关联，明确禁用。无法确认边界/内容时仍可另存完整原音review结果，致命运行错误/取消不发布候选。SFX、克隆听感、通用更柔表达与其他音质事项继续按既有路线。

本次另从暂存索引构造隔离源树，复核源码/文档依赖并验证累计相关mock测试、TypeScript与ESLint；实际结果见外部收据。已验收的生产构建/浏览器/模型证据沿用，不重复模型或重启服务。证据根 `I:/AI/asmr-director-recognition-release/2026-10-07`，模型及按钮证据仍在各原10月7日目录。

## 发布与保留范围

24个累计ASR代码/测试文件、3份功能记录、相关双语spec与本记录发布；`.gitignore`仅暂存重检构建目录一行，ROADMAP/HANDOFF/归档仅暂存本次ASR与发布段。空间实现、header入口、README、eslint/tsconfig空间增量、THIRD_PARTY/Qwen文档及其共享记录保留在工作树。音频、模型、profile、环境、构建产物与I盘证据不入Git。

本地3001运行构建含另一会话未发布的空间功能；全新checkout不能期待该工作台入口。继续共享checkout时先检查Git状态，不能全量暂存、reset或用新checkout覆盖未提交工作。项目已有等价固定路线/协作/记录体系，沿用AGENT、ROADMAP、PROJECT_MANAGEMENT、AI_HANDOFF及archive，不新增竞争路线或初始化元数据。

分支 `codex/voxcpm2-product-generation`，远端 [128Ghe980/asmr_director](https://github.com/128Ghe980/asmr_director)。发布前fetch确认本地和远端均为 `bdfd1cc9e7a5cff43fb211f8a1e76c5434b8e2c9`；正常提交/推送，不force或改写历史。实际SHA及保护检查见 `release-verification.json` 与Git记录。

## 运行恢复

已验收正式入口 `http://127.0.0.1:3001/`，Node PID25096 / owned terminal88196，原生D盘 `.next-candidate-recheck-production`，BUILD_ID `fC1Y4z7etgCJEEIReA6ty`。这是验收快照，发布后实际存活由新运行收据确认；不启动Qwen或模型、不清除锁。

后续需要恢复时，先检查无活动任务及监听身份，在 `apps/web` 使用现有环境配置并显式设置 `ASMR_NEXT_DIST_DIR=.next-candidate-recheck-production`、`NODE_OPTIONS=--max-old-space-size=1536`、TEMP/TMP指向I盘证据tmp，然后执行已有 `next start --hostname 127.0.0.1 --port 3001`。`.env.local`仍有另一会话的`.next-spatial`设置，不能误用；服务存活时无需重复启动。

## English checkpoint

The user authorized publishing the continuation/interjection and natural-pause recognition repairs, diagnostics and saved-candidate recheck. Existing targeted tests/build and real ASR/UI cancel/success/reload evidence are retained; the staged source is independently checked before commit. Recheck preserves full originals and candidate/adoption history, uses a300s serial offline-ASR deadline and does not run TTS. Unsupported clip-mode history is disabled because its source linkage is insufficient. Actual commit/push equality is recorded in Git and the external release receipt. Unpublished spatial/Qwen work remains local; Audio Quality V1 is still in progress and SFX remains paused.
