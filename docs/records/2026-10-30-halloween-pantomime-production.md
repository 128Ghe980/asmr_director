# 2026-10-30 万圣节空手互动新版本

状态：内容、真实人声后处理与竖屏批跑包已交付；H3 成片待目标机运行，1 句语音近音疑点保留试听提示。

## 用户目标与范围

用户要求重新生成万圣节 ASMR，并逐项检查 DeepSeek 输出，不合适就继续迭代。延续近距离互动模板、约五分钟、竖屏 9:16 的方向，完整走文案、真实人声采用、画面与声音设计、后处理及批跑导出。执行当前 Audio Quality V1 范围，不更改顶层路线，不恢复此前因内存保护中止的 No-sleep 内容任务。

源码根 `D:/CodexWorkplace/asmr_director`，外置根 `I:/AI/asmr_director`。本轮 QA 为 `qa/halloween/2026-10-30-new/`，交付目录为 `artifacts/h3-asmr/Halloween-new-2026-10-30/`。所有辅助脚本放源码 `.local/`，没有修改产品源码或重启部署。生产入口仍指向 `.local/releases/performance-pacing/apps/web`，build `R7R1RdTxRIJFu2Ught-nO`。

## 内容生成与人工审查

全部创意台词、动作描述和音效内容由真实 `deepseek-v4-pro` 返回。初次整体策划错误地把声音层“无人声”理解为全片无台词；修正后仍出现时长不足、实体道具和重复表演。整体编辑回合也未通过。之后分三章生成，保留模型原文，按独立审查结果定向修正并去掉四段重复示范；最后补充六段持续触发音表演。失败及修订前版本均保留，未将助手补写内容标为模型输出。

脚本阶段共 11 次上游请求。最终 39 段，20 台词、19 无台词；剧名为《万圣节夜游前的小小变装仪式》，工程 ID `asmr_planner_20261030_124255`。六段补充声音的原始 `text` 为空，明确记录将同一条模型 `direction` 原文复制到无台词 `text` 的确定性归一；没有伪称原始 schema 校验成功。原 33 段与 20 段台词保持，源见 `approved-segments-v2.json`、`additional-sounds-review.json`。冻结后补回编译辅助脚本漏传的原模板快照，见 `calibration-template-repair.json`。

按真实语音校准，台词合计 116.16 秒，无台词合计 162 秒，工程 278.16 秒。简单整理 6 秒、拆糖 7 秒、递糖 5 秒，持续触发最长 10 秒。准备和回位须包含在段内；台词阶段主要稳定手位、眼神与微表情，动作阶段对镜空手表演，材料词仅用于声音设计。

## 真实人声及资源保护

新生成并采用 20 条 VoxCPM2 `soft_zh`，完整 6.9 秒参考、`reference_only`、`clip`、CFG 2 / 10 步。保留真实候选、原始 WAV、请求、回执及哈希，未用零 PCM 或旧台词替代。50ms / 1.5GiB 运行保护监测 20 次 native，最低提交余量 2.106GiB，无保护终止；监控正常退出，无残留 native/ASR 和共享锁，没有关闭或杀死用户应用。

独立 ASR：20 条均有结果，17 条规范化精确、2 处严格同音字（滑/划、试听/视听）、1 处近音短语。第18段“夜游前”两次 ASR（含关闭 VAD）均识别为“也有钱”，前两字声调不同，不能标为内容完全通过；无额外漏字或重复证据，未主观试听。详见 `asr/final-review.json` 和 `guard/stop-receipt.json`。

## 画面声音迭代

使用活动发布版的 `generateClipStoryboard`，真实采用音频时长，固定 `new → continuous → continuous`。每个独立起镜请求不绑定上一组三段的旧提示词，连续两镜严格引用组内前镜。保存每次原始 DP 请求/响应及解析结果，不手工改写生成字段。

首轮发现 6 秒段错误返回 parts、触发动作做满 10 秒后再回位、双侧/往返手势被处理为全段单向声像，以及台词镜重复前段递糖/挥手。第二轮修正重复手势，但出现轻点镜误变静止、部分环境声与独立音效不一致、10 秒预算回归等；第三轮定向修正通过。见 `design-feedback-proposed*.json`、`designs/` 和修订前项目快照。第三轮有一条 action 609/600 字符，产品自动请求修复后通过，没有截断模型文本。

`independent-design-review.json` 对 39 段逐项核对原始响应、保存工程及核心语义，mustFix 为空。最终设计工程 SHA256 `6ede501ece9f20bf5a0d254602826d3c515a0a85522eb2060c7a498368202c30`；13 独立镜头、最多两次尾帧接续、全部无 parts。设计阶段 83 个真实上游响应，脚本 11、后处理规划 1，合计 95 个唯一 DP response ID，均 `deepseek-v4-pro`，见 `dp-call-inventory.json`。只称本稿核心设计通过，不把这些人工迭代推广为产品已自动解决全部生成质量问题。

## 后处理与交付验收

真实 API 规划人声 D 音场，20 条通过生产 HTTP 渲染并采用标准回执，全部为中央稳定声位，符合当前静止对话。原人声保留。完整工程超过 HTTP 的重复元数据体积上限，任务辅助脚本仅精简传输副本：人声渲染保留 39 画面但省略重复 workspace、无关后处理项及该人声渲染不用的 ASMR 字段；导出只省略重复 workspace。源/前镜/输入/参数指纹逐项相等，完整归档不精简。实际全部 20 次走 HTTP，无 413，也没有执行备用 direct renderer。见 `post-render-*-transport.json`、`export-transport.json`。

21:17 HKT 最终竖屏包独立验证通过：113 条 ZIP 文件、20 条原始/后处理 WAV 与回执、39 份最后 DP 设计、14 项资源和 78 份主/ASMR payload，验证器禁网且无网络尝试。主/声音两路 672×1216，39 主任务＋39 ASMR，无 5 秒截断，10 秒任务保留合法 243 生成帧并按目标时长裁切。台词 overlay 20、无台词 replace 19；原版和增强版合片设置保留。原 HTTP ZIP 不动，最终包只修改 manifest 的 `aspectRatio=portrait`，其他条目字节一致。

交付目录 `I:/AI/asmr_director/artifacts/h3-asmr/Halloween-new-2026-10-30/`：

- `Halloween-new-ASMR-batch.zip`：40,511,599 bytes；SHA256 `c0b21c5cf971f0ecb344e8c4e208f2ad5909a11b294009d5cc91074f1d64388e`。
- `Halloween-new-project.json`：完整工程，与已验证 `final-project.json` 字节一致，SHA256 `c627a4f44c16fce122ad594f42590bc5cbcaf1fedd409c2c71ecdcda5462e85e`。
- `Halloween-new-review.html`：39 卡片、20 个真实后处理音频播放器、可折叠画面/声音设计及下载链接。第18段保留“夜游前”发音试听提示；这里只做结构与文件可读验证，没有浏览器视觉验收。
- `generation-receipt.json`：验证摘要与来源。

包中时长含 20 条人声各 0.65 秒尾音，共 291.16 秒；24fps 目标帧对齐预计 6998 帧、291.5833 秒（约 4分52秒）。详见 `package-verification.json`、`review-page-verification.json`。

浏览器可读取到旧《女巫的出门前检查》，但后续导入入口操作在执行前被中断，未导入、未覆写旧页面工程，也不称已保存到用户 UI。完整 JSON 和试听页单独交付，可直接使用批跑包。H3 主视频、独立效果音视频及最终两版合片由用户目标机运行；本轮没有成片或生成效果音的听感验收。

## 记录与恢复

同步 `docs/ROADMAP.md` 当前进度、`docs/AI_HANDOFF.md` 和 `docs/project-archive.md`；沿用项目自己的单一路线，不创建第二套路由文件。无产品代码修改、部署重启、新提交或推送。旧万圣节包、旧工程及 No-sleep 暂停状态保持。

验证解压目录和 portrait-candidate.zip 共 81,009,108 重复逻辑字节，已逐文件与最终 ZIP 核对后尝试按限定绝对路径清理；自动审批仅返回 `blocked by policy`，未执行、未另换方式绕过。副本仍留在 QA，删除数/字节均为0，见 `duplicate-cleanup.json`。交付不受影响。最终文件/哈希、服务HTTP200与文档引用复核见 `delivery-finalization.json`。

恢复优先读本记录、`package-verification.json`、`independent-design-review.json`、`asr/final-review.json` 与 `finish-checkpoint.json`。完成 checkpoint 已 sealed，不重新运行生成/导出 helper，也不要将旧 No-sleep 无余额或内存中止当作本次状态。后续若用户发现成片问题，从本包具体任务定位，保留原候选和证据。

## 同日追加 — 工程入库与刷新验证完成

23:03–23:05 HKT后续任务补齐了上文当时未完成的浏览器入库。真实UI导入同一完整JSON时发现旧localStorage保存不可用，已单独修复项目库存储并部署3001 build `OjWEvWXsfoGeJ_UBk30pg`。重新导入、确认已保存后实际刷新，仍有《万圣节夜游前的小小变装仪式》及17个旧项目，20已采用人声、19无台词、39设计、20D和39段原文均保留。此追加仅更新入库状态，不改写上文内容生产时的历史事实。

详细实现、216测试/lint/构建、服务与真实UI证据见[项目库存储修复记录](2026-10-30-project-library-storage.md)，直接证据为[刷新回执](I:/AI/asmr_director/qa/project-library/2026-10-30-storage/ui-after-reload.json)及[截图](I:/AI/asmr_director/qa/project-library/2026-10-30-storage/import-saved-after-reload.png)。完整JSON和批跑ZIP保持，后续修复轮0DP/TTS/ASR/H3、无提交推送；第18段发音试听和目标机H3成片仍未验收，No-sleep暂停、Audio Quality V1路线不变。
