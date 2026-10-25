# 纠正短句定义并停止按句号强拆

日期：2026-10-23。所属 Audio Quality V1；本项完成，父阶段继续进行，SFX 暂停。没有新增路线、提交或推送。

## 用户定义与实际错误

用户明确纠正：短句相对于“整篇文案切四大段”，指较短的语气、意思或动作台词单元，绝不要求一句号一段。拆短句提醒完全不需要。原 API 提示已按语义要求，甚至明确举例“回来啦。我还没睡，就猜你快到了。”可同单元；但后来增加的采用后 normalizeSpeechSentences、短句编辑失焦及整段编辑 splitSpeechSentences 把合法语义单元再拆，实际覆盖了 API 决定。这是实现错误，不能只更换提醒文案。

另有 API 返回后的>100字/4子句规则保底会改分组，也停止自动用于模型生成回复。显式旧稿整理的规则行为保留为手动工具，不描述为API；弃用句界工具只留兼容/实验并标注不得接回生产采用、编辑或切页。

## 改动

现代 groups[].units 与兼容flat输出均原样保留合法unit边界；停顿与导演属性、顺序标识、严格字段、既有500字能力/200单元边界保持。提示明确可含多个句号。现有无效模型输出修复重试机制未改，合法回放各一次请求。

撤下提醒/按句界拆短句按钮及失焦回调；采用策划一section一clip，不再二次normalize。普通编辑保留源unit ID与分段。整段单unit内改字保留旧take并标过期；跨unit改写只将受影响范围作为一个用户编辑unit，清除两bank合并范围的旧take，保留外围素材、各自span、末等待及撤回保护。paragraph容量分组仍可按完整units打包500/32，不切source。单个600字手工输入原文仍保留，既有生成能力检查继续适用。

不自动迁移/猜测合并已保存工程。TTS内部clause分析只用于停顿、上下文和目标定位，semantic目标仍是整条工程台词，不据此改变项目分段。便携批跑器与包协议未改。

## 验证

最终独立选定快照15文件 **210通过、0失败、0跳过**，包含API compact/flat多句与>100字保留、采用一对一、加载切页不改旧take、编辑失焦不增段、整段两bank同步/跨unit合并/撤回/paragraph容量，以及现有批量/校对/后处理集成和TTS目标规则。子代理44与34等为重叠子集，不相加。完整类型、13文件lint、2048MiB堆限制串行生产构建退出0，未重跑整站。

初次选定测试209项中新增库测试缺少lookup函数引用而失败1项，已改成当前库ID查找并完整重跑。独立审查另发现删除paragraph容量分组过宽，已恢复按完整units重打包，并加400+200仍2units、两个paragraph回归。初次日志/结果与capacity-before快照保留，不把前轮失败算通过。

编译HTTP回放compact与flat两份模拟模型回复：原文分别含多个句号且第二unit超过100字，均200/2units/顺序与停顿保留，每份仅1次本地模拟请求、共2次、0真实模型。静态JS/CSS字节SHA匹配、旧提醒/旧自动拆句成功文案未出现在服务包；结果窗口等已有入口保留。没有重试CUA已知os3初始化故障，不称真实浏览器视觉或实际听感/模型质量/远端H3验收。

## 部署与留存

14:22HKT更新3001：build **CAoGgXLFVz5Z6allgGTBY**，监听PID36452替换41536，均为部署时快照。规范启动 I:/AI/asmr-director-service/2026-10-16/start-production.ps1 同步为 D:/CodexWorkplace/asmr_director_release_verify/2026-10-23-semantic-units/apps/web + .next-semantic-units，原脚本留QA目录；音频引擎与素材路径保持，旧部署脚本PID保护已过期。

实际服务7个JS SHA/API配置/三POST-only路由GET405验证通过；356个生产文件size/mtime保持，27项另会话工作不混入部署。未读取或写入浏览器工程、修改用户当前音频/分镜、主动调用真实API/TTS/ASR/H3；HEAD/实际空索引保持。appTree eff4499f6b95345b91f67c8bd9f50bc01cef2e46 在最终文档刷新后保持。

证据根：D:\CodexWorkplace\asmr_director_qa\semantic-units-2026-10-23。重要收据：planner/verification.json、domain/verification.json、vitest-results.json、checks-result.json、build-final.json、preview-verification.json、deployment-verification.json、source-verification.json、verification.json。中英文semantic-unit spec、新旧UI spec及三文档入口已同步。
