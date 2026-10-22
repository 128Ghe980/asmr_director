# 2026-10-21 — 撤下旧候选重新切分入口

所属阶段：Audio Quality V1继续进行中，SFX暂停。本轮是现有阶段内的入口调整，不新增顶层路线。

状态：入口实现、影响范围验证、正式构建及3001启动验收完成。父阶段仍进行中；没有提交或推送。

## 用户要求与范围

用户拒绝“算法更新后再重试旧候选”的前端产品入口。撤下前端可见的重新切分按钮、对应取消操作和引导，后台API保留兼容。生成时自动切分、完整原音试听下载、普通采用保持，不自动采用或替用户重新生成。

“强制切分”尚未实现，本轮不自行定义其规则或实现，也不借撤入口修改当前定位及静音条件。双语规格同步：[中文](../specs/2026-10-20-audio-segmentation-purpose.zh.md) / [English](../specs/2026-10-20-audio-segmentation-purpose.en.md)。此前切分改造与真实原音验证见[10月20日记录](2026-10-20-audio-segmentation-purpose.md)，其测试与部署数字不作为本轮验证结果。

## 实现

本轮仅改一个生产组件及三个测试文件：`voice-generation-panel.tsx`、`voice-generation-panel.test.tsx`、`studio-app.recheck.test.tsx`、`studio-app.manual-confirmation.test.tsx`。前端不再呈现重切/重识别重试按钮、对应取消操作和操作引导，测试改为入口不存在及普通采用回归。

`studio-app.tsx`生产源码字节保持；可选回调属性及已有连接保留兼容。后台API、Python分析、ASR定位/静音条件没有修改。生成自动切分、试听下载、普通采用与撤回保持。撤下的20项UI重试流程测试由3项入口不存在/采用回归替换；已有后台重切契约不因UI入口撤除而删除，本轮没有据此声称重新跑过后台或真实音频验证。

## 当前自动切分失败条件的只读核对

以下仅依据 `apps/web/scripts/analyze-voice-group.py` 当前 `cutting_only` 路径，不混入保留兼容的旧严格文字核对规则。

1. 位置无法唯一确定。有后文时，用目标文案及后文前16个规范化字符作顺序近似映射。没有足够共同字符可作位置锚点、重复或漏识别造成多个同样合理的边界、映射点落在一个ASR合并词内部或后面没有可用的相邻识别词时，无法完成定位。字差没有独立通过门槛，但仍可能间接影响位置是否唯一；这不等于判定生成内容错误。依据：`cutting_positions` 1461行、`cutting_word_boundary` 1501行。
2. 相关词时异常。校验目标前缀及首个后文词的时间；非有限值、倒序、明显重叠、越出原音、词长为零等不能作为切点依据。远处丢弃后文的坏时间不阻挡当前切点。依据：`validate_words` 1116行、`_analyze_cutting_only` 1611行。
3. 局部实测静音不足。静音按10ms帧测量，候选至少160ms，切点取中点并要求两侧各80ms静音保护；可搜窗口另受相邻词时及80ms边缘保护约束，不是原音任意位置有160ms停顿就能切。正常词间窗口没有候选时才进入粗时间回退；明显过弱的录音也不能当作已有语音边界。依据：`frame_levels` 839行、`quiet_cut_candidates` 883行、`cutting_quiet_boundary` 1531行。
4. 粗词时回退仍不安全。仅允许进入相邻单字的已分配时段，多字词保留完整时段；需要唯一合格静音及两侧实际活动，不能向前借另一短语的停顿。两侧均为多字且正常词间窗口没有可用切点、回退没有活动或有多个合格候选时，保留原音。多个候选并非在所有分支都一律失败：常规词间窗口按既定顺序选取，回退分支才以多解报歧义。依据：`cutting_quiet_boundary` 1537行。
5. 输入或运行异常。无效音频格式、空或过长音频、参数不合法、ASR模型加载或执行异常、文件读写失败等也会导致未完成；这些与文字是否符合台词无关。依据：`process_request` 1743行及 `analyze` 1674行。

无后文的最后一句走 `whole_recording`，完整保留有效原PCM，不要求找到句尾静音；不同或空识别文本、不可用词时、有效静音录音不单独阻挡完整保留，但输入或ASR运行异常仍可能失败。内部逗号停顿无法测量时可记录缺测，不独立阻挡整片。依据：`_analyze_cutting_only` 1599行、`cutting_internal_pauses` 1575行。

## 验证与证据

证据根：`I:/AI/asmr-director-remove-recheck/2026-10-21/`。

影响范围Vitest84/84通过，组成是panel65、App无重试入口3、普通采用16；这是本轮三套定向验证，不是第二次全站扫描。四个改动源码/测试文件ESLint、diff检查和完整TypeScript类型检查均退出0。

正式构建成功，BUILD_ID为 `nJSfHj4aRJNZtETBwP_zJ`，dist `.next-remove-recheck-production` 指向I盘 `build/next-production`。构建后 `tsconfig.json` 与 `next-env.d.ts` 恢复原字节；构建收据的 `serviceOperation: false` 仅描述构建步骤，不冒充部署结果。

本轮没有运行模型或操作用户工程存储，没有提交或推送；本次文档工作本身未执行测试或服务操作。四个已验证改动文件的最终SHA与验收版本一致，65个范围外源码文件、`studio-app.tsx`、HEAD及空索引保持。

## 启动与部署验收

2026-10-21 03:45:10 HKT已启动3001，BUILD_ID `nJSfHj4aRJNZtETBwP_zJ`，dist `.next-remove-recheck-production`；该时点listener PID24032、launcher PID22568，恢复操作前须重新核对。开始时无既有监听，本轮未停止旧服务。页面、声音目录API及新build manifest均HTTP200，页面实际引用的8个JS也均HTTP200且字节匹配新构建；重切入口文案不再出现在页面产物，完整原音和“切分完成，待试听”相关UI保持。这是HTTP/构建产物验收，不冒充浏览器视觉验收。

canonical启动脚本 `I:/AI/asmr-director-service/2026-10-16/start-production.ps1` 已同步新dist，之前版本保存在本证据根 `start-before-removal.ps1`。生产138候选manifest SHA `1D0267C0AFBE09564A9F1CEEEA25D79BA99B223190A3F167D08348C9314752F8`、profile SHA `37E9404AB3690207ECB83C38E7892347082B7B952C8680052CAFB1E1C05317DC`保持。

首次启动时服务已Ready，但核验脚本固定10秒的HTTP等待超时；脚本只清理了该次自建Node，未改产品数据，当时canonical仍是之前版本。随后将冷启动目录核验允许等待增至45秒，再次启动及验收通过。第一次失败收据/log保留；这是启动核验脚本等待不足，不作为产品切分失败或自动审批拒绝。

- `source-after-and-tests.json`：四文件变更边界、`studio-app.tsx`保持、84项测试及ESLint/diff结果。
- `test-results.json` / `tests.log`、`eslint.log`、`typecheck.log`：定向测试及静态检查日志。
- `build/build-result.json` / `build.log`：实际构建标识、产物位置及主仓配置恢复。
- `start-attempt-1.json`及对应首次启动log：10秒HTTP核验超时、自建Node清理及之前canonical保持。
- `deployment-verification.json`：本轮实际启动时点、build/PID、三路HTTP200及生产数据保持。
- `final-verification.json`：84项定向验证、类型/lint/build、8个实际JS字节核对、入口撤除与原音UI保持、65个范围外源码及生产数据保护；自动切分和后台兼容保持、强制切分未实现、0模型/无提交推送。
