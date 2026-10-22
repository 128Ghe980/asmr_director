# 顿号列举不再拆成独立语义子句

日期：2026-10-21。Audio Quality V1进行中，SFX暂停，无新顶层路线。状态：最小修复、定向验证、正式构建及16:01 HKT部署完成；未提交或推送。

用户“雪夜归家”第14句“吃的也囤了不少，米面、腌菜、冻肉，还有你爱吃的果酱。”在导入语义单元时被拆开。`planner-semantic`误将顿号计为子句边界，得到5子句，超过4子句后按3+2分组，切在“腌菜、”后。`speech-sentences`原本保留整句，TTS语义模式也仍是1组，问题属于上游可编辑语义单元划分。

最终只改`planner-semantic.ts`的边界正则，移除顿号；`planner-semantic.test.ts`增加真实原句的直接拆分与draft规范化回归，并核对原ID保留。不改TTS splitter、音频切分、CTC或旧项目。已保存的两条不会自动合并，保留其音频和ID；修复作用于后续文本划分。初步扩大到`voice-longtext-plan.ts`及其测试的修改已按before SHA精确恢复，不进入最终变更。

如需修正旧项目两条，用户可在第一条的“本段更多操作”里点“合并下一段”，然后重新生成；入口见`script-editor-panel.tsx:163`。本轮未替用户操作已有工程或音频。

证据根：`I:/AI/asmr-director-enumeration-split/2026-10-21`。`red-results.json`有2项预期失败；最终`green-results.json`/`tests-verification.json`为169通过、0失败、0跳过，覆盖10文件；完整类型检查与相关ESLint均exit0，两份TTS规划文件与before SHA精确相等。本轮仅定向回归，未重跑完整整站，不累计已撤初步方案的重叠测试结果。

`build/build-result.json`确认构建exit0，BUILD_ID `EfV1V3LY3zzKsvsgiOS4N`，两份Next配置原字节恢复。`deployment-verification.json`确认16:01:28 HKT部署3001，dist`.next-enumeration-production`，listener27408/launcher28780（快照），三路HTTP200；canonical启动脚本已同步，旧脚本保留在`start-before-enumeration.ps1`。`final-verification.json`核对345冻结源码SHA、8实际JS构建字节、新planner正则及既有强制切分UI。部署前后150候选manifestSHA`9893ADB5…46DACC`/profileSHA`37E9404A…17DC`保持；用户期间自行生成使初始快照变化，不据此宣称整轮库存未变。刷新3001可使用新边界规则；本轮0模型调用、0旧片段合并、无浏览器工程存储操作或自动采用，HEAD保持，未提交推送。

同步入口：[Roadmap](../ROADMAP.md)、[AI交接](../AI_HANDOFF.md)、[项目留档](../project-archive.md)。本次为小范围边界修复，不新建规格或路线阶段。
