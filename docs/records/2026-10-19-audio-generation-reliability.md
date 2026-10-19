# 批量音频生成故障复核与低显存修复

日期：2026-10-19（Asia/Hong_Kong）。父阶段仍为 Audio Quality V1 进行中，SFX 暂停；没有新增顶层路线。本轮按用户要求，以多文案真实整批生成验证原生失败，修复并回归，结果质量与原生进程成败分开记录。

## 已确认的问题与修改

- 低显存模式的 BaseLM 实际上下文为4096，但 ResidualLM 仍固定预留32768个位置的 F32 K/V，即512MiB。最小补丁将容量匹配实际上下文，降至64MiB，减少448MiB；保留F32、权重、选定参考和生成参数，prefill/decode越界在建图前明确失败。生产使用的单次生成路径会传播该错误，不默默截短。既有stream分支不在修复范围，产品不使用它。
- 新CLI复用已验证Aug30缓存组件/COPY fallback，不等于只修改Aug25旧产品EXE的一行；与旧产品比较不能把所有差异归给缓存补丁。补丁、固定来源SHA、隔离构建脚本及双语说明在[运行时工具](../../tools/voxcpm2-runtime/README.zh.md)。只编译一份runtime C++对象、链接已有库，22保护输入SHA保持，未修改上游原源码/旧构建或安装环境。
- CUDA分配失败、主机ENOMEM/bad_alloc、cuBLAS初始化错误分别分类。CUDA OOM不再误入通用RAM错误；不再断言关闭其他GPU程序或裁短所选参考就能解决。原始stderr仍保留在服务端。
- 新增可选Windows轻量资源观测：标准库Python、GetPerformanceInfo全局commit/physical、GetProcessMemoryInfo原生进程private/RSS、nvidia-smi整设备数据。尾32样本加全程极值，缺失为null。无Torch/模型导入；只控制自己的观测/GPU查询进程，原生进程和原有锁机制保持。开始至结束总等待最多2.5秒，迟到观测器仍被结束，诊断故障不改变音频结果。
- 实机发现Windows venv启动器PID可能与实际Python不同，已解析小型pyvenv.cfg并直接用base Python的`-I -S -B`运行；核对父PID与原生/观测PID，GPU子进程放独立kill-on-close Job。强杀观测器后GPU子进程已确认退出，目标进程保持。
- 完整批次暴露观测器自身退出故障：12份摘要均完整，但5次随后以0xC0000005退出。使用实际Anaconda3.12复现，faulthandler明确为stdin daemon持有BufferedReader锁导致解释器退出失败；不是本次TTS失败或已证明的ctypes越界。移除stdin/GPU两个daemon线程，以主循环PeekNamedPipe与有界os.read轮询。修复后同生产Python40次＋base3.11二十次，60/60正常退出、完整摘要且stderr空；另验EOF、强杀、父/目标退出和真实Node接口。原始异常与首轮仅用3.11轻测的验证缺口保留，证据见批次根下observer-crash-qa/verification.json。

## 故障证据与因果边界

2026-10-16现存22份失败诊断：17次cuBLAS初始化、3次明确CUDA分配OOM（其中2次cudaMalloc，1次cuMemCreate）、2次LocEnc预填充计算附近异常退出。后两次exit为0xC0000409、seq255/273、nodes96136/102922；没有异常子码/堆栈或明确分配错误，不能称OOM，也不能归功于COPY修复。[Microsoft fast-fail说明](https://learn.microsoft.com/en-us/cpp/intrinsics/fastfail?view=msvc-170)。日志尾部32KiB有截断，不能用未保留下来的头部推算失败时瞬时资源。

上次一次监测在GPU仍空闲约2.14GiB时，当前采样进程可新增提交额度仅0.447GiB，监督器提前终止，并非原生OOM复现；C仅约604MiB，分页文件扩展受限。本日开始C已有约7.69GiB，pagefile6497MiB，未由本轮修改或清理；同原失败文本/参考/种子旧CLI已成功，支持资源条件相关的排查方向，不能证明历史所有cuBLAS错误由系统提交不足导致。

## 本轮真实验证

证据根：`I:/AI/asmr-director-generation-reliability/2026-10-19`。所有新音频、日志、构建在I；没有模型/用户音频进入Git。

1. 旧产品CLI六项基线全部exit0/有效48kHz单声道WAV，实际8/37/83/84/93/169汉字；含两项历史失败文本及原种子，93字项亦经过原seq255/96136nodes。PrivateUsage峰值约6.66GiB，整GPU峰值4458MiB，最低全局提交余量约2.05GiB；不能把这六项称完整识别验证。
2. 旧decoder同组件对照两项，加新CLI同六项，共14次原生调用全部成功，无监督器终止。两个严格同输入同种子对照的完整WAV SHA均相同；84字项private峰值减少约454MiB、全GPU峰值4296→3846MiB。169字项最终AudioVAE解码峰值近似，故不能声称所有整次峰值都降低448MiB。明细`native-comparison.json`、`baseline/`、`decoder-control/`、`fixed-native/`。
3. 独立12项完整产品队列完成：10 long_text＋2 clip，四个测试工程、真实后文/末句；复用runStudioBatchQueue和generateLocalClip，独立manifest/clip/voice-work，全程持生产全局reservation。12次TTS与10次ASR全部exit0，12项候选保存、0生成失败；TTS无重叠，11个任务间隔5.110–5.138秒。加前述14次原生测试，共26次真实生成均产出音频，没有根据质量改seed重试。
4. 长文检查9 passed、1 review，不等于逐字全部正确：其中5项passed仍有雪/血、坐/做、积/季、等/感、冻/动识别差异；warm-tea_1裁后识别“进来坐炉子别暖和”，边/别差异触发cut_text_mismatch，完整原音保留待确认。未放宽现有检查或自动采用。2项clip按既有流程不执行ASR；本轮没有盲听，不能把识别差异全部认定模型读错。
5. 独立fresh核对44个WAV均48kHz/mono/PCM16，24份已有WAV SHA回执均一致，22份候选/组音频时长一致；生产manifest仍134条，14个受保护来源/参考/配置文件在批次前后保持，无子进程、锁或临时文件残留。资源摘要12份完整，最低physical约0.387GiB、全局commit余量约2.210GiB、native private峰值约6.255GiB、GPU最低空闲2025MiB；采样不是历史OOM因果证明。

完整批次根：`product-20261019T080735054Z_fa2fe2ac`，内含summary/item-records/events、实际参数/种子、日志、音频及`independent-product-verification.json`。测试数据独立保存，未灌入用户工程或生产候选。

最终定向回归覆盖provider/session/observer/队列/profile/长文/整段，共173项通过；随后复核修正容量错误裸短语匹配，限定明确原生错误行前缀，避免正文/参考回显误报，provider/session最新70项通过。完整类型、相关ESLint通过；Python观测器15项、隔离构建工具5项通过。正式Webpack构建及部署收据见下节；没有将共享空间工作台等所有本地修改宣称为本次单独发布。

## 运行时位置与验收入口

- 稳定新CLI：`I:/AI/asmr-director-runtimes/voxcpm2/reliability-20261019/voxcpm2-cli.exe`，SHA256 `feba01044885d494bb428ec61d9db9626f728a482dc8fc51a84b6dbf5fec4c80`。已将唯一新EXE从实验构建目录移至此处，`runtime-location.json`记录；原构建收据保留当时路径。
- 3001在本轮开始时无监听，先恢复旧已验收build `u5Mvhqpkigpa29LHhohqY`，用户测试工程/134候选原manifest保持。
- 最终修复正式Webpack构建通过，BUILD_ID `qikKsnc9iyniAim3_PRCC`，dist `.next-generation-reliability-production` 指向本轮I盘build/next-production；构建自动修改的tsconfig/next-env已恢复构建前原字节，保留共享配置。provider最后容量前缀修正在此最终build内，Python观测器从源码外部读取。
- 16:48历史状态：更新3001并仅替换profile.cliPath的组合准备/执行命令先被自动审批拒绝；用户明确允许“更新3001和语音运行时”后再次拒绝，均返回`blocked by policy`、未给细因且命令未启动。旧PID2136/HTTP200、旧profile SHA及134候选SHA保持。随后保存逐项来源SHA/无任务/进程/build检查、profile备份、切换及失败回退草案，静态语法通过。`deployment-pending-verification.json`是16:50历史收据，不代表最终状态。
- 16:57沿用用户授权及“再修复”请求，重新核对同一部署脚本和实时身份，以正常执行工具运行该脚本，本次工具获准且exit0；未修改权限或系统策略，前次拒绝原因仍未知。部署成功收据`deployment-verification.json`与后检`deployment-postcheck.json`已保存，优先于旧pending快照。
- 当前3001为build `qikKsnc9iyniAim3_PRCC`，监听PID26936/启动器25880（操作前重查）；profile SHA `37E9404AB3690207ECB83C38E7892347082B7B952C8680052CAFB1E1C05317DC`，与备份逐字段比较仅cliPath改变。短句/long_text使用新profile，整段启动覆盖同一固定CLI，所选参考/所有配置其余字段保留；134候选manifest SHA仍`0EDD0530C4BC30EC523ABAA9654D81C4CBBDEDBFAD79ACFFE942065499060C92`。
- 页面、生成目录、short/paragraph候选与新BUILD_ID静态manifest共5路HTTP200；新EXE SHA、主/恢复启动脚本一致、目录可用、无生成锁/遗留模型进程，经独立只读复核通过。目录GET可能短暂触发Python依赖可用性探测，已结束，不是TTS/ASR。本次部署0新增推理、音频候选或浏览器存储操作，未新增视觉验收。
- `I:/AI/asmr-director-service/2026-10-16/start-production.ps1`已更新为同一新启动配置；证据根start-previous-build.ps1和profile-before-deploy.json保留供审阅回退。`deploy-production.ps1`本次已执行，旧PID/profile基线守卫现已过时，保留为历史，不能直接重跑或盲改守卫。
- 不修改分页文件或系统设置，不清C盘，不裁/替换参考，不自动重试改变种子，不放宽识别/切点或人工采用规则。历史异常不能保证永久消失；新诊断可用于下一次具体定因。

已同步ROADMAP/AI_HANDOFF/project-archive及第三方运行记录；共享空间工作台/Qwen/既有队列等本地改动保留，不提交或推送。
