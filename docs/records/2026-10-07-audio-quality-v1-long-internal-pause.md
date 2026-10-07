# 完整目标被内部停顿采样上限拒绝

日期：2026-10-07。归属现有“人声导演与真实ASMR音效质量V1”；父阶段进行中，SFX模型工作保持暂停，不新增路线。接续同日[后文语气词修复](2026-10-07-audio-quality-v1-continuation-recognition.md)。

用户再次报告“今天是不是又加班了？眼睛都红红的。”在完整原音及试裁后识别均一致却无法自动截取。当前20段热汤面工程已由用户修改后文为“来~~，面来啦！汤也喝一点，暖胃。”，不还原此前23段工程。

本次运行 `c6953f1e-bfd9-4c65-9569-0775e1537693` 的30.4秒原音确有完整目标；失败是 `target_validation/uncertain_internal_pause`，不是后文衔接或标点差异。源ASR“了?”结束2.38秒、下一句“眼”开始3.86秒，间隙1480ms。`waveform-diagnostic.json` 在严格约−56.55dBFS阈值下确认2.47–4.27秒的1800ms连续静音；早先2.47–4.11秒只是其保守子区间。生成输入将每句末尾转成“……”，这种较长的自然停顿正常存在。独立试裁的目标字词时间未保存，因此不把源1480ms冒充为当时试裁实测值。

原Python把 `>1200ms` 的内部停顿直接判整组失败，而既有TS服务端可记录0–10000ms，组间连接函数已单独筛选0–1200ms的有效样本。现仅分开记录与配方采样的上限：经过目标文字及词时间验证的自然间隔按1ms记录至10000ms，保留原音及原值；不把长停顿改短或塞进组间均值。NaN、无穷、真实负间隙及超过记录上限仍失败，原负向浮点误差容差保持。目标内容阈值、80ms安全裁切保护、同日“嗯”桥接及组间类别/默认值保持。

修改为Python分析脚本/测试、两项TS契约回归测试及[英文设计](../superpowers/specs/2026-09-08-voxcpm2-product-integration-design.md)/[中文设计](../superpowers/specs/2026-09-08-voxcpm2-product-integration-design.zh.md)。TS运行代码/协议shape/UI未变；3001动态读取仓库分析脚本，不需重新构建或重启。保留其他空间/Qwen会话改动，无提交推送。

验证：旧1200ms路径由完整两句+后文的mock先复现失败，录制及非法值测试先红后绿。首轮Python91项通过；根审查要求保持原−1e-6ms容差，零附近新用例先红后绿后最终92项通过。TS分析/拼接两文件51项通过，包含长停顿元数据通过、10001ms拒绝，以及长值保留但不进入原连接均值。两测试文件ESLint及完整TypeScript通过。

一次真实离线large-v3 CPU/int8对该原音完整复测通过：52.58秒、RSS峰值3,471,667,200字节、exit0、未触发240秒/768MiB保护。最终输出0.52–5.57秒、5.05秒，目标100%匹配、零替换；独立最终ASR测得1420ms内部停顿，原样记录而未钳制。它与源1480ms略有差异，均超过原1200ms限制。原完整录音SHA保持 `52e9ba12ce6e3e4eb58703713ffdc529a3f5f3957bd073bc567fe7bfc607dc79`；5.05秒WAV SHA为 `11c88a1261364c332160c7b80df3421dd7f5df35b9d0e8b832092ef13682c26a`。隔离输出仅供试听，未自动覆盖、采用或改写旧候选。

真实JSON/WAV重放进现有schema及 `analyzeVoiceGroup` 通过，返回音频及 `[1420]` 停顿与实际worker完全一致；10001ms及错误停顿数量均422拒绝。服务重放0模型/原生/API调用、scratch清空，输入/结果/音频SHA保持，见 `service-final-real-internal-pause.json`。

同时查明 `b0072f48-62ee-47e4-8ef1-b12b6afdf7bf` 的25.76秒原音属于明确取消，`cancelled:true`，停在source_transcription空白，不当作新的识别失败。两次新增原音纳入fresh保护baseline：154素材、489历史原音、10参考/profile、11上传、3备份、25空间源、1111Qwen工件、59模型文件size/mtime及原H盘MP3。最终 `preservation-final-after-internal-pause.json` / `runtime-final-after-internal-pause.json` 全部保持、HTTP/build/catalog/参考字节通过，无native/锁/scratch。`final-helper-attestation.json` 区分真实模型使用的helper与其后恢复原浮点容差的最终helper SHA：1420ms正值路径不变，只由mock覆盖新恢复的零附近分支，没有重复或虚报模型使用最终SHA。证据根 `I:/AI/asmr-director-internal-pause-repair/2026-10-07`，Python日志根 `I:/AI/asmr-director-internal-pause-observation/2026-10-07`。

正式入口保持 `http://127.0.0.1:3001/` / PID23976 / `.next-reference-asr-repair-production` / BUILD_ID `mMBc94MV0dYU8X8CKteWT`；`.env.local`仍指另项`.next-spatial`，重启须显式指定此dist。独立7863–7866服务继续停止，不恢复模型或改系统内存/分页设置。
