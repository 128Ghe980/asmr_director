# 视频批跑器：多候选、长等待与断点恢复

Date: 2026-10-15（Asia/Hong_Kong）

Route ID: Audio Quality V1现有视频交付扩展；父阶段in_progress，SFX暂停。

Status: 实现及本地自动／媒体验证完成；另一台H3生成主机长跑及真实GUI视觉验收待完成。

## 用户确认与本轮行为

用户先要求核对长等待是否卡死、断点继续与每镜指定多个候选的复杂度；确认“行，那就按这个改一版”。本轮沿用已确认的同编号连续参考，不新增工程时序／质量审核链或全局声音限制，不调用DeepSeek／TTS／ASR／真实H3。

- GUI与CLI可设置每镜候选数N，默认1；一个有对白镜头仍只导出一份已采用WAV。增加N仅补缺，减少N保留已有候选文件和回执。窗口的N在继续同一批时应设为原值；修改数量按相同增补规则执行。
- 候选独立保存实际seed、提交ID、prompt_id、状态、输入指纹、输出及历史。技术重试沿用seed；明确重做换seed，保留旧结果。`--only`选镜头，`--rerun`重做所选镜头本次N个候选，`--rerun-candidates 2:1`只重做第二镜候选1；ID含冒号时从最后一个冒号分割。
- 连续镜头候选k仅取相邻上一镜候选k的实际成功输出尾帧；不可用就退回角色图，不借其他候选／更早镜，不等待人工挑选，不级联重做后镜。
- 默认健康任务无总等待上限（job-timeout=0），单HTTP30秒、持续断线300秒、心跳15秒独立配置；未知任务保留身份对账，不因超时自动重复提交。
- GUI后台线程执行，显示阶段／候选／完成数及本地实时计时，HTTP等待时窗口计时继续。事件队列上限500、单次pump最多100事件／20ms、可见日志约2000行。停止后续提交只设置本地事件，远端已提交任务继续；CLI Ctrl+C返回130并提示恢复。
- 每个候选号分别生成完整预览。N=1仍preview.mp4，N>1为preview-c001.mp4等；缺镜只跳过相应编号预览，不把不同候选拼成重复对白的长片。

## 恢复与旧版本兼容

run-state schema独立升级为2，项目包project.json仍version1；RUNNER_VERSION维持1以保留候选1／generation0的原始输入指纹。旧状态在锁内先备份为run-state.v1-backup-*.json，再迁为候选1，保留旧输出文件名／prompt_id／成功回执，不因升级重跑。移动包保留整个outputs，可继续相对路径快照与历史。

已确认成功的remote_output和完整raw SHA足够恢复下载／封装，不再强制先查history或/object_info；本地原片完整时可离线封装。远端节点预检仅在新模型提交前需要；缺节点仍全局清楚报错，网络预检错误按候选保留input_error继续。任务级恢复不恢复模型采样中途的计算；远端输出和本地原片同时丢失时保留待恢复状态，不盲目重发。

已有pending／unknown／downloading任务在本次恢复成功后，抑制同输入的额外质量重做；如果用户仍想换seed，可再次明确重做。输入确实改变时依旧按本镜指纹重新生成。停止在提交进度回调时必须落回preparing且不消耗尝试；上传错误与停止同时发生也保留可继续的准备状态。停止优先于同轮missing／断线／任务超时，不能把明确暂停写成新的失败。raw状态路径通过outputs边界校验。

提示词或基础seed改动再改回旧值时，按输入指纹与输出SHA复用历史成功结果，保留其余回执而不重复POST／封装。seed与其他历史任务碰撞时自动选择稳定替代值；恢复旧代后明确重做使用全部历史最大代数加一，避免重复旧seed。无法复用的旧成片（如被外部改写）保持原路径，新生成用持久化output_suffix另存。

## 验证

| 检查 | 结果／边界 |
|---|---|
| Python完整回归 | 62项通过，50批跑＋9控制＋3停止边界；覆盖真实旧v1成功fixture、不重发、N增减、seed、归档、同号尾帧、独立预览、离线raw恢复及输入／seed往返历史复用 |
| 虚拟长等待 | 时钟推进7201秒后健康排队仍正常完成，无旧一小时隐式截止；不是实际运行两小时的远端验收 |
| 网页项目包／接入 | 3文件18项通过，真实ZIP解包后默认干跑3镜，再N=2准备6份不同seed payload；含真实测试参考图及合成WAV，0模型调用 |
| 类型／ESLint | 完整TypeScript --noEmit --incremental false及改动接入测试ESLint通过 |
| 实际FFmpeg | 2镜×2候选共4视频、2同号预览真实FFmpeg完整解码通过；目标对白1.625秒、无对白5秒、预览6.625秒，容器探测约1.63／5／6.63秒，原音路径保持；不作为高精度帧数／编码格式验收 |
| 离线恢复媒体 | 删除一个合成最终视频并让模拟Comfy完全不可访问，本地raw成功重封装；模拟GPU POST总数仍4，0真实H3调用 |
| 独立审查 | 检查迁移／seed／恢复／停止安全和GUI消息边界；修正停止与POST／超时竞态、seed碰撞与输入往返覆盖旧结果，增加历史恢复／另存回归 |

本次未运行整站Next构建或历史1863测试；网页应用逻辑未改，只更新随包Python运行器及导出接入测试。未实际打开Tk窗口，未在另一台生成主机上进行真实小时级H3验收，不能把模拟时钟及合成媒体视作画面／口型质量验收。

## 更新包与证据

更新包：I:/AI/asmr-director-video-batch/2026-10-15/asmr-comfy-batch-runner-update.zip，只含runner.py、run.bat、README.zh.md。先关闭旧运行器，覆盖这三个文件；保留project.json、workflow_api.json、所有素材与整个outputs。更新包不覆盖已调工作流。新导出的完整项目包仍有工作流四运行文件。

证据根I:/AI/asmr-director-video-batch/2026-10-15/candidates-qa：all-python-tests.log、long-wait-boundaries.log、video-package-tests.log、typecheck.log、eslint.log、media-smoke/verification.json、verification.json。ZIP按CRC及逐文件SHA与源码核对，无密钥／模型／私人素材。

与D盘清理前753源文件基线比对，本轮与已记录维护文档之外的源码SHA保持；637个既有受保护音频／JSON文件SHA保持。收尾只读检查3001无监听、旧PID16004已不存在；磁盘生产BUILD_ID仍IuS6dk38Xq9OZB0CRWvbQ。本轮没有启动／停止／部署服务，不把之前的HTTP200快照当作当前在线状态。

## 文档同步

实现文件：tools/comfy-batch/runner.py；测试：test_runner.py、test_runner_controls.py、test_runner_stop.py、video-package-runner.integration.test.ts；说明README及中英文现有规格追加本轮设计。同步ROADMAP、AI_HANDOFF、project-archive；沿用既有单路线，不新增顶层阶段。

现有空间工作台／渲染／Qwen等共享改动和Git索引保持；HEAD6c90c3d未变，本轮未提交推送。
