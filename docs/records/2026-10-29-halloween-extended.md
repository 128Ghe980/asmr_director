# 万圣节 ASMR 加长版

用户认为上一版太短，要求再生成一版；本轮默认约5分钟，用户明确选择竖屏9:16。并行完成的批跑器横竖画幅功能见[独立记录](2026-10-29-batch-aspect-ratio.md)。本轮内容使用近距离互动小剧场模板，不恢复暂停的模板质量优化。

## 内容与素材来源

《万圣节女巫的温柔整理》，工程 `asmr_halloween_extended_20261029092426`。10条台词沿用上一版已采用的真实人声，文本、顺序、generation和源资产保持；16段无台词表演共275秒，包括领口两侧、斗篷、扣子、前额与脸颊刷扫、木盒轻敲/摩擦/开盒、糖纸与纸袋、递糖及短暂停留。人声实际22.4秒，工程总时长297.4秒。加长来自声音表演时长，不是拉慢已有录音。

最初另生成《万圣夜护身小礼》14台词/14表演段原稿，两次TTS均在参考编码时被现有50ms/1.5GiB资源保护终止，没有成功WAV。未降低阈值、关闭其他用户应用或改系统设置；守护正常停止，最初原稿和失败证据保留。随后已向用户说明改用旧人声继续完成加长版，并通过产品策划API生成新表演安排。没有把复用称作新TTS或新ASR。

新工程前16段设计由真实DeepSeek API成功生成，第17段两次产品接口502后停止；一次诊断上游返回HTTP402 `insufficient_balance_error`，确认余额不足，而非请求大小或本地内存问题。此后停止外部付费重试，剩余10段由助手直接创作，并与API结果分开留存来源。旧10条人声的D方案沿用，但新工程/clipId的有效后处理回执必须由本地渲染接口产生，不能直接改写旧receipt。

## 证据与边界

主QA：`I:/AI/asmr_director/qa/halloween/2026-10-29-extended/`。复用分支在`reused-voices/`，真实上游失败在`diagnostic-upstream-status.json`及对应响应。`reuse-receipt.json`记录旧/新clip映射和资产SHA；独立审查核对10条源WAV字节/时长/SHA及旧D来源全部一致，旧工程与旧ZIP历史SHA未变，未伪造candidate、ASR或质量通过字段。

原14句分支和保护证据留在主QA及`guard/`；当前交付以复用分支为准。`.local/halloween-extended-production.cjs`和`.local/halloween-reused-production.cjs`保留诊断用途，恢复前必须先读`reused-voices/resume-status.json`，不能盲目重启已失败的付费流程。

实际H3画面、触发音及两版合片仍由目标ComfyUI生成；本轮不把设计或dry-run称为成片。上一版ASR7条精确/3处短词差异的边界继续保留，未新增音质或表演质量验收。无源码服务重建、Git提交或推送。

## 最终交付与验证

交付目录 `I:/AI/asmr_director/artifacts/h3-asmr/Halloween-extended-2026-10-29/`：完整工程、批跑ZIP、使用说明、来源及最终回执、页面截图。最终ZIP为8,192,619bytes，SHA256 `b1aff4c0fba0b067f7f23f24e4a7ff574fb67b4392e9eaab59f3b5f2c958cc9d`。本地API原始ZIP SHA为`c30a8b306fd3bbd4b86116d3424c7c43cc85a378e4637d9e947c54994dd2645f`，原包备份在QA；root仅将manifest的`aspectRatio`设为`portrait`并重新压缩，其他成员内容逐字节保留。

26段导出69主任务及69声音任务；无台词拆为59个≤5秒连续块。10条后处理各加0.65秒尾音，包音频总303.9秒；24fps逐任务对齐7302帧，预计304.25秒，约5分4秒。默认实际尺寸672×1216，主/声音一致，用户可从新版批跑器窗口切换横屏。

10条D方案从旧真实方案继承，通过本地渲染API获得关联新工程的有效回执，输出SHA与原处理素材相同。首次完整D请求触发413，随后仅在请求快照省略重复的可选`speechWorkspace`，保持根active timeline/videoPlan/plan及输入指纹不变；完整保存工程仍有两个工作区。没有篡改回执或外部付费重试。

独立复核确认原16设计SHA保持、新10段画面与触发音对应、parts覆盖时长、D源/设置/工程关联合法。第20段概览“糖放纸上”与实际part“纸旁”有轻微措辞差异，实际执行parts一致，作为非阻塞项记录；未宣称表演质量改善。来源在`delivery-provenance.json`两处一致副本中。

`package-verification/receipt.json`验证163文件、10源WAV及处理WAV SHA/真实时长、连续块、提示词与处理器/SOFA资源，禁止socket/client联网运行正式runner，138个payload全部通过，H3/联网次数为0。首次验证脚本错误要求PCM16，核对实际渲染器明确输出PCM24，且旧/新文件均为48kHz双声道PCM24后修正断言，未改音频以适配检查。最终回执中如实保留该验证修正。

页面已通过正常JSON载入流程显示新标题、04:57、已采用10、无台词16、全部26设计和后处理10/10。页面显示“本地保存不可用”，原因未额外诊断，不称浏览器持久保存成功；完整JSON已存交付目录，可恢复。截图`completed-project.png`和QA `ui-completed.ax.txt`留证，旧交付文件未覆盖。

`delivery-finalization.json`保存最终portrait包SHA、UI边界及来源。checkpoint已封存，resume-status为delivered，并关联根最终回执；不要再次执行旧付费续跑或导出覆盖已完成包。28项范围外和4项批跑功能哈希保持，3001 HTTP200/build仍`6i9y2gc1uL9nGDjYlbvGT`，证据在`qa/video-batch/2026-10-29-aspect/final-source-check.json`。
