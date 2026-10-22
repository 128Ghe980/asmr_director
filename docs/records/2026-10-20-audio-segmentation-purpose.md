# 2026-10-20 — 识别只服务切分，内容由用户试听判断

所属阶段：Audio Quality V1继续进行中，SFX暂停。用户明确要求恢复切分改造，覆盖此前暂缓指令。本轮不新增顶层路线。

本轮实现、验证与3001部署完成；没有提交或推送，父阶段状态保持。

## 纠正的需求

之前把ASR文字一致性当作生成内容认证，导致“做/坐”“边/别”“回来/回来啦”阻止可定位切分，又在普通采用前增加文字确认。用户明确：识别只为切分提供位置，生成内容是否满意由用户试听后决定采用或重生成。强制对齐实验也应按切点质量评价，不能拿ASR文字有没有改善代替切分功能验收。

设计：[中文](../specs/2026-10-20-audio-segmentation-purpose.zh.md) / [English](../specs/2026-10-20-audio-segmentation-purpose.en.md)。工程经验写入 `D:/CodexWorkplace/工程经验/2026-10-20-辅助能力不得篡夺核心功能和用户判断权.txt`，同时更新该目录 `工程经验汇总-初始化加载版.md` 的最高规则11及来源索引。

## 实现

- 短句带后文、整段逐句切分、原音重新切分统一内部 `cuttingOnly: true`，成功/失败识别证据标记 `analysisMode: cutting_only`。每次定位只识别输入源音一次，去掉左右窗和成品文字认证；整段仍依次处理剩余原音。
- 通用顺序编辑映射只定位完整字词边界，允许识别字差，不用同音词表修文或按字数比例猜秒数。`boundaryOnly.contentVerified: false` 明确未认证生成内容；覆盖度仅测量，不设文字通过门槛。
- 切点使用相关字词时段与实测PCM静音。单字的粗时间吞掉静音时，允许在该字已分配时段内核对真实静音及两侧活动；相邻的多字词保留完整时段保护，不按字数拆秒数，不能向前借另一个短语停顿。无后文的 `whole_recording` 完整保留有效原音，即使识别不同或无文字。
- 前后端验证输入身份、音频格式、相关时间范围、静音及原PCM前缀；内部停顿未定位时缺测，不伪造零也不阻挡整片。整段发布的切片必须完整分割原PCM，无重复/丢失。达到TTS生成步数上限仅保留事实提示，不提前阻止尝试切分。
- 新旧已切好候选均普通采用，删除活跃的额外文字勾选/认证步骤；旧人工回执与旧严格证据仍可读。旧 `needs_confirmation` 已切片结果计入可用候选，避免“生成未生成”重复排队。真正无切片的整段仍保留原音，不冒充已切好。
- 界面改为“切分完成，待试听”“目标片段定位文本”“重新切分”。用户点击采用仍是必要操作；没有自动确认、采用、质量重试或改参考声音。历史兼容的确认API保留，当前普通采用不依赖它。

## 验证结果

Python最终180项全部通过，包括非对称回退的6项新增回归；先记录新增成功场景在旧规则下失败，再运行修改后的完整Python测试。此前148项UI/analysis定向验证、两套整段生成/重切39通过/1既有Windows符号链接跳过属于中间证据，不与最终Vitest数字相加。

Vitest执行一次全量扫描，结果1908通过、15失败、5条件跳过；15项失败都在已删除的逐句文字确认复选框流程测试。只迁移这一测试文件，保留取消、数据保护及普通采用等有意义断言，随后单独运行该文件16/16通过。按原全量结果替换这一文件后，149个文件汇总为1924通过、0失败、5条件跳过；没有再跑第二次全量扫描。5项跳过分别涉及实际Python适配器、原D运行时空间渲染、便携运行器接入、Windows符号链接与默认关闭的真实ASR整段测试；最后一项另以显式真实运行完成，仍保留原全量报告的跳过计数。

最终完整TypeScript类型检查、相关ESLint及正式Webpack构建通过，BUILD_ID为 `TLEqEjfqRjd_EpUyCtxxs`。构建写入I盘，主仓 `tsconfig.json` 与 `next-env.d.ts` 恢复原字节。

真实原音验证使用隔离I盘工作/输出、标准运行锁串行执行，累计10次真实源ASR、0次TTS，无生产候选发布或自动采用。原音来自既有长文trace：五句 `9f662760-6b5b-4ed0-a900-e40c50ebb1d1`，05段 `c700f631-d356-4685-b595-d7778a801bb8` 与 `f0eb3cd6-bbe0-44ae-b9f3-a266f694562f`，均在 `I:/AI/asmr-director-voice-work/long-text/`，未改原音。

05段c700的独立新ASR仍识别“边/别”差异，切到2.68秒，实测静音2.56–2.80秒，输出PCM精确等于原音前部。f0eb近目标边界候选静音为130ms，不满足切点双侧各80ms保护；不能向前借用“和”开始之前的停顿，因此保留原音待检查。这是切点证据不足，不是文字不一致拒绝。

五句整段首次真实验证抓到TS重复重算Python候选静音区间的多余门槛：同一原PCM/字词时间，Python末端1.88而TS浮点取整1.87，导致合法切点被拒。已简化为核验实际静音及相关时段，不再重复候选排序或要求静音区间扩展范围完全相同；补浮点边界和合法静音子区间回归。

第二次真实验证通过第一句后，第二句因粗词时再次停下：剩余原音中“到了”2.64–2.98秒、“先”2.98–3.76秒，后者吞入了实际句间静音。原先要求相邻两侧都是单字，误挡这处可定位切点。最终改为通用非对称回退：多字侧保持完整时段保护，单字侧允许在其已分配时段内寻找唯一实测静音，仍要求两侧真实活动、双80ms保护且不向前借另一短语停顿；两侧均多字且时序不够细时保留原音。没有为“到了”加词表例外，也没有按字数分配时间。该句同一阈值下查到唯一静音，切剩余原音3.49秒，即原音5.215秒；saved-ASR回放与后续真实链均验证通过，f0eb仍未借早停顿伪造成功。

最终五句从原始PCM重新执行完整真实ASR→顺序切分链，通过5句；操作收据耗时85.203秒，外层Vitest总wall为86.99秒，二者不混作模型推理耗时。原音累计终点为1.725 / 5.215 / 9.065 / 12.365 / 15.36秒，5片顺序精确复拼回完整原PCM，无重复或丢失。识别仍保留“啦/了”“雪/血”“坐/做”等差异，切分没有据此挡住；没有盲听、内容正确性认证或CTC产品接入。

## 部署结果

2026-10-20 16:35:48 HKT已更新3001至 `.next-cutting-purpose-production`，BUILD_ID `TLEqEjfqRjd_EpUyCtxxs`；该时点监听PID5072、启动器PID23972，恢复操作前须重新核对身份。页面、声音目录API和新build manifest均HTTP200，canonical启动脚本已同步至 `I:/AI/asmr-director-service/2026-10-16/start-production.ps1`。

部署前后生产138候选manifest SHA `1D0267C0AFBE09564A9F1CEEEA25D79BA99B223190A3F167D08348C9314752F8`、profile SHA `37E9404AB3690207ECB83C38E7892347082B7B952C8680052CAFB1E1C05317DC`保持。首次本地部署预检被自制脚本过宽的“所有Python进程”检查中止，实际命中另一工程的 `serve_preview.py`，尚未停服；改为检查本工程推理进程后正式部署成功，无关进程保留。本轮没有自动审批拒绝。

最终收据进一步核对页面实际引用的8个JS均HTTP200且字节匹配新build，三处新界面文案存在；68个冻结web文件与39个无关基线源码保持，HEAD与空索引保持，无关preview进程仍在。没有把静态资源检查称为浏览器视觉验收。

## 证据

根：`I:/AI/asmr-director-cutting-purpose/2026-10-20/`。大文件、模型运行临时目录及新构建均在I，D仅源码/文档和小junction。

- `python-qa/asymmetric-verification.json` / `asymmetric-red.log` / `asymmetric-final-180.log`：最终Python固定版本、先红后绿及180项测试；早期174项收据保留为过程记录。
- `qa/ui-analysis-implementation-receipt.json`：148定向测试及UI/lint；`tests/paragraph-contract-results.json`：两整段suite39通过/1条件跳过。
- `tests/full-vitest-results.json`、`manual-adoption-results.json`、`manual-adoption-receipt.json`、`final-test-verification.json`：一次全量扫描、唯一旧确认测试文件迁移复跑与最终汇总；`final-typecheck.log`及相关ESLint日志记录类型/静态检查。
- `build/build-result.json` / `build.log`：正式构建成功、BUILD_ID及主仓配置字节恢复。
- `real-samples/saved-asr-replay.json` / `asymmetric-saved-ASR-replay.json`：只重放既有识别、无模型的原PCM定位；`real-samples/initial-run/`：首次真实ASR与TS联测，包括05两原音结果及合法整段误拒的原始失败证据。
- `real-samples/quiet-and-word-timing.json`、`paragraph-boundary-parity-audit.json`：原PCM能量/字词时间及独立浮点复现；不是人工听感或音素标注。
- `real-samples/paragraph-run-2/`、`second-sentence-word-energy.json`：第二次真实重跑及多字/单字粗时间吞静音的离线定位。
- `real-samples/paragraph-final.log` / `verification.json` / `observations.json`：最终真实五句顺序切分、各切点、原音SHA及PCM精确复拼；操作85.203秒、外层测试总wall86.99秒。
- `deployment-verification.json`：实际部署时点、build/listener身份、三路HTTP200及生产manifest/profile保持。
- `final-verification.json`：最终测试/构建/部署汇总、8个实际JS字节与界面文案检查、68个冻结web文件/39个无关源码及生产数据保护、无提交推送。
- `test-eof-cleanup.json`：最终diff检查移除切分测试末尾额外的一个空行，仅删0D0A两字节，执行内容和生产源码保持；原字节/冻结清单另存，未为纯空行重复运行测试。最终冻结清单仅同步此测试SHA。

没有操作用户浏览器工程存储、重写生产旧候选或安装环境/模型。旧“CTC未观察字面识别改善”的实验事实保留，但不能推导该模型对切点质量无用；本轮没有把CTC接入产品，也没有借用该旧结论作切分拒绝依据。
