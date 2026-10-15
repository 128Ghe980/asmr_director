# 多候选视频批跑器发布记录

日期：2026-10-16（Asia/Hong_Kong）。Route ID：Audio Quality V1现有视频交付扩展；父阶段进行中，SFX暂停。用户明确授权“记录一下，推一版”。

## 发布内容与边界

本次发布每镜N个视频候选、后台长等待状态与计时、停止后续提交、按候选断点对账、已下载原片离线封装，以及稳定seed、明确重做和历史结果保留。旧状态自动备份迁入候选1；增加N补缺、减少N保留。同号尾帧不可用时退回角色图，不增加质量审核链、工程等待或级联重做。详细设计与开发证据见[开发记录](2026-10-15-audio-quality-v1-video-candidates-and-resume.md)及[中文规格](../superpowers/specs/2026-10-15-comfy-video-batch.zh.md)／[英文规格](../superpowers/specs/2026-10-15-comfy-video-batch.md)。

保留此前已完成但尚未入库的[I盘清理盘点](2026-10-15-audio-quality-v1-i-drive-cleanup-review.md)和[I／D盘清理完成记录](2026-10-15-audio-quality-v1-i-d-cleanup-completed.md)，使现有入口引用完整。清理已完成，本次只发布记录，不重复删除、恢复或移动文件。

选定15个文件：运行器及说明2、Python测试3、网页包接入测试1、双语规格2、开发与清理记录3、三份项目入口3、本发布记录1。run.bat与workflow_api.json沿用已发布版本。空间工作台／渲染／Qwen、共享ignore／README／ESLint／tsconfig等现有本地修改不入本次提交，不使用reset／clean，不改变工作文件。

发布基线为6c90c3dd8107061e06adc5191cd2424da7996388，分支codex/voxcpm2-product-generation。实际提交、推送结果和远端身份由Git及I:/AI/asmr-director-video-batch/2026-10-16/release/release-verification.json记录，不预填提交自身SHA。

## 验证

开发工作树已通过62项Python、18项包／接入测试、完整类型检查、改动测试ESLint，以及实际FFmpeg四个视频／两份同号预览／离线raw恢复；虚拟健康排队推进7201秒后完成。证据在I:/AI/asmr-director-video-batch/2026-10-15/candidates-qa。开发工作树包含未发布空间代码，因此本次另对选定索引源码验证。

选定源码导出到D:/CodexWorkplace/asmr_director_release_verify/2026-10-16-video-candidates，复用现有node_modules，测试素材和日志放I盘，不复制模型、正式音频或私人参考图。发布证据根I:/AI/asmr-director-video-batch/2026-10-16/release。

- Python：62项通过（50运行器＋9控制＋3停止边界），48.403秒；staged-python-tests.log。包含旧状态、7201秒虚拟长等待、N增减、停止／断线、不重发、历史复用和成片另存。
- 包／接入：3文件18项全部通过，无跳过；staged-package-tests.log。显式指定Python，真实ZIP解包后准备默认及N=2共6份候选payload，参考图与WAV均为合成测试素材。
- 完整TypeScript --noEmit --incremental false与改动接入测试ESLint通过；staged-typecheck.log、staged-eslint.log。
- 选定运行器真实FFmpeg完整解码通过：4个视频、2份同号预览；原片在本地时完全离线重封装成功，模拟提交总数保持4。目标对白／空镜／预览为1.625／5／6.625秒，容器探测约1.63／5／6.63秒；staged-media-smoke.log、media-smoke/verification.json。未把探测包装器输出当作精确帧数或编码格式验收。
- 暂存范围、导出源码身份、Markdown引用、凭证模式、更新包与源码对应关系及范围外工作文件SHA由export-audit.json记录。Git导出沿用Windows换行转换，文本按LF归一化后与blob核对，二进制按原字节核对。最终补充仅涉及文档，已验证app／runner子树保持。

本轮网页产品逻辑未改，未重新运行整站Vitest或Next正式构建，不把上轮1827／1863测试与构建当作本轮发布验收。以上为当前选定代码的验证，真实生成主机和GUI验收仍保留。

## 交付与保留事项

既有三文件更新包位于I:/AI/asmr-director-video-batch/2026-10-15/asmr-comfy-batch-runner-update.zip；只覆盖runner.py、run.bat、README.zh.md，保留project.json、workflow_api.json、素材及整个outputs。ZIP SHA256为be112bca75384b935016ecdc9c4e734ed8b5b6ae9b0bccbc208686b6354fdc52，必须与实际选定运行器和说明核对。

真实Tk窗口视觉及另一台主机H3小时级长跑仍待验收；模拟时钟与合成媒体不等于画面／口型质量验收。恢复按视频任务进行，不能恢复模型采样到一半的计算。

本次仅记录与Git发布，不更新或重启3001，不启动ComfyUI，不调用DeepSeek／TTS／ASR／H3，不更改正式音频、候选或浏览器工程。10月15日22:33收尾的3001无监听与旧BUILD_ID为历史快照，本次不据此声称服务在线。沿用AGENT.md→ROADMAP／PROJECT_MANAGEMENT／AI_HANDOFF固定文档系统适配记录技能，不初始化竞争路线或新增顶层阶段。
