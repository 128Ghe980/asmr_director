# 显存空闲时的模型分配失败与提交余量监测

日期：2026-10-16（Asia/Hong_Kong）。用户反馈两项反复失败、提示显存不足，但没有其他重负载占GPU。Audio Quality V1仍进行中，SFX暂停。

## 本次真实失败

19:06两次、20:04四次，共6次，仍为“我还没睡…”84汉字及“进来坐…”93汉字输入，各三次、seed均不同。4次在8.60秒reference／prompt编码时出现cuBLAS初始化失败；2次更早在LocDiT权重加载时，cudaMalloc申请404.48MiB／424132736bytes明确OOM。都未进入正文prefill；不能归因这两句特别长。日志开头5014MiB空闲发生于后续组件装载之前，不是失败瞬间峰值。6份诊断保留在I:/AI/asmr-director-voice-work/diagnostics，ID18ded9a9、01b9300a、3cbbf5bd、5e56cafd、1d75b575、7dd99823。

## 一次隔离监测

在I:/AI/asmr-director-service/2026-10-16/gpu-allocation-investigation保存profile-native.py／report.json、native日志、50ms主机内存采样和100ms全GPU nvidia-smi采样。使用该失败项原输入、seed1460776653、同normal参考／文本、默认CLI和600步等原参数；没有生产候选写入或ASR。默认CLI SHA256 ecb34b72a15d489ba333718082c784f9f8b0cc05161bb6525f15451d4f821c44，与paragraph override的copy-fallback不同。

开始GPU已用757MiB／空闲5238MiB。原生进程启动1.844秒，已到参考编码前的context suspended；采样GPU峰值已用3802MiB、最低空闲2193MiB，物理可用最低3,582,820,352bytes（约3.337GiB）。原生PrivateUsage峰值5,394,288,640bytes（约5.024GiB）；当前进程可新增提交余量降至480,018,432bytes（0.447GiB），低于预先设定512MiB预算，监督器主动停止该进程。

**这次不是复现到原生CUDA OOM，也不是一次成功生成**：只有一次已启动的模型调用、0最终音频；停止原因是监督器提交余量保护。指标来自GlobalMemoryStatusEx.ullAvailPageFile，是当前进程可新增提交额度，未另外采样全局CommitTotal；GPU为全设备采样，也不是每进程DXGI预算或瞬时峰值。结果提供提交压力的强线索，不能证明历史6次全由同一原因导致。

事后分页文件在C:/pagefile.sys，AllocatedBaseSize11843MiB（约11.57GiB）；该文件InitialSize／MaximumSize均0，不能误写成固定上限，系统全盘AutomaticManagedPagefile为false。C盘仅约604MiB空闲，分页文件进一步扩展空间受限；监测期间提交上限曾增长约354MiB。分页文件实际使用量与提交额度是不同指标，不能因CurrentUsage1184MiB就认定提交额度充足。依据[Microsoft提交上限说明](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/how-to-determine-the-appropriate-page-file-size-for-64-bit-versions-of-windows)和[内存状态指标说明](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex)。

## 原生实现核对与边界

只读GGUF头部统计声学权重约1740.506MiB，固定ResidualLM F32 KV512MiB，参考前底座约2.20GiB，不含临时图／CUDA/cuBLAS等。现用low-vram已将BaseLM context设4096，参考前释放其上下文；ResidualLM固定32768缓存不随之减少。--steps／正文长度不影响参考编码和初始化分配。现成--cpu会改变声学计算后端并增加CPU资源需求，未切换；也未裁短／更换参考声音或修改原生实现。两CLI只执行过--help，不算模型加载。

后续优先解决C盘空间／分页文件可扩展余量，再做同输入受监测对照，以验证提交额度因素；不得宣称已经修好或把CUDA OOM统一改称RAM不足。此轮没有清理C盘、改分页文件、重启系统或部署软件。原生进程已退出，临时Vox锁已按owner清除，3001保留build u5Mvhqpkigpa29LHhohqY。原始report与停止原因完整保留。
