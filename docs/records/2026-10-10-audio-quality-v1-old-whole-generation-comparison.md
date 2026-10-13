# 旧整篇生成方法复测与文案恢复

Date: 2026-10-10
Route: 人声导演与真实 ASMR 音效质量 V1（in_progress）
Status: done（恢复两份旧稿，并完成一次较早夜雨稿的整篇原声生成）；听感待用户判断，最近320字同稿尚未整篇重跑。

用户听过本轮正式语义生成的两篇后，要求找回之前用过的文案，并用曾感觉有问题的方法再生成一版。本轮只做历史恢复、独立一次原生生成与留档，没有生产源码修改、构建、提交或推送。

## 恢复结果与选择范围

- 最近实际给普通女生、正太02试听的原稿仍在 `I:/AI/asmr-director-two-long-voices/2026-10-08/script.txt`，320字符，以「你回来啦。外面是不是又下雨了？」开头、「晚安，今晚安心休息。」结尾。当时交付的是各4段clip＋固定原始参考音频/文本，再连接完整原声；整篇单次尝试因最终AudioVAE CUDA解码grid长度断言失败，没有源WAV。这不是已证明的OOM。
- 更早166字符夜雨稿仍在 Aug12 `long-text-true-combined-whole-seed7801-cap420-gpu0/result.json`。对应的整篇实验与Aug14复测记录明确询问后半变尖/语速过快；该方法是VoxCPM2 True Combined＋参考音频/精确参考文本、自然标点、全文一次直出。
- 两份恢复副本分别为本次证据根的 `深夜回家-最近同稿.txt` 与 `夜雨陪伴-原稿.txt`。用户尚未回答两稿可选澄清，本轮按已说明的较早成功夜雨稿做一次比较；不能断言它就是用户最近试听的320字文案。

夜雨原稿：

> 夜已经很深了，窗外只剩下很轻的雨声，房间里的灯也慢慢暗了下来。把手机放到一旁，让肩膀安稳地靠在柔软的枕头上。今天没有处理完的事情，都可以先留到明天，不需要现在给出答案。那些还没有平静下来的念头，也可以暂时放在门外。接下来只要安静地听着我的声音，让身体一点一点变得轻松。我会一直陪在这里，不催促你，也不会突然离开，直到困意自然地靠近。

## 本次实际参数与完整原声

证据根：`I:/AI/asmr-director-old-method-compare/2026-10-10`。

| 项目 | 实际值 |
| --- | --- |
| 输出 | `旧方法-夜雨陪伴-整段连续.wav`，25.44秒 |
| 模型 | VoxCPM2-BaseLM-Q8_0.gguf＋VoxCPM2-Acoustic-F16.gguf |
| 声音参考 | `I:/AI/voxcpm2-evaluation/references/soft-16k-s16.wav`（温柔参考，两个参考入口使用同一文件） |
| 参考文字 | 欢迎光临。本店是预约制门店。请问您有预约吗？您需要喝点什么吗？ |
| 参数 | seed7801、CFG2、temperature1、timesteps10、steps上限420、GPU layers0 |
| 方法 | True Combined；166字自然标点全文单次原生调用；保留完整原声 |
| 历史差异 | 当前Aug25可执行文件；添加`--low-vram`内存参数，旧Aug12调用没有此参数 |
| 格式 | PCM16、48kHz、单声道、1221120帧、2442284字节 |
| SHA256 | `7e34920755361e87f9f53b749a60274f139777571bff444e63d63cc8cffbdb57` |

没有16子句补长、语义单元提取、裁第一句、拼接、变调、加速、响度归一化或裁掉尾部。本轮不调用ASR；WAV文件完整不等于逐字识别或听感通过。

## 验证与资源

- 原生PID3444于香港时间21:00–21:01实际运行，真实退出码0，监督耗时26.453秒。单次300秒总上限、产品生成锁、fresh提交内存guard均生效；没有自动再生。生成前可提交内存7,840,665,600字节，高于4,815,306,368字节门槛；GPU生成前716MiB占用、退出后689MiB。
- 独立只读审核核对旧记录的全文、31字参考文本、参考/Prompt WAV、权重路径及生成参数，并验证实际stderr Combined模式、CLI采样数与WAV header/长度/SHA吻合。日志中EOS73440是分词器元数据，不能当实际自然停止的证据。由帧数推导159音频patch，不冒充日志明确记录的生成steps。
- `night-rain-native-result.json` 保存实际完整参数、退出码与WAV检查；`night-rain-native.resources.jsonl` 保存采样；`night-rain-comparison-verification-reviewed.json` 的18项轻量检查全通过。首参数收据错误引用旧记录不存在的`cfg_value`，修正为`cfg`后复核，首收据保留；没有更改音频或参数。
- 新WAV与旧seed7801路径**当前存在的文件**逐字节一致。比较不能独立证明旧路径文件仍是Aug12当天原字节；本次新Popen调用/退出/日志可证明实际重新生成，没有把旧文件复制冒充新结果。
- 本轮开始时3001已经没有listener，未启动或停止服务。生成锁只由本次owner创建/释放；新原声没有导入平台候选、资产或项目。
- `source-decode-capability-audit.json` 核对现有CLI：`--cpu`会把自定义声学组件全部放CPU，没有仅AudioVAE用CPU/最终分块解码开关。True Combined先于stream分支，stream不能绕过此整篇解码限制；`--low-vram`不改变最终解码长度。全CPU的320字速度/内存与300秒能否完成仍未测，不宣称解决了容量问题。

## 保护与后续

此次保护基线重新采集为96候选/224资产/782历史文件/10参考，另保护前两篇20个已采用WAV、两个最终WAV、两项目JSON和两原稿。最终`watch-preservation-final.json`的7项保护、`runtime-final.json`的11项运行检查、`independent-comparison-final.json`的15项综合检查全部通过：所有保护文件组0增删改，manifest值/顺序/header保持，0语音/0watch进程、3锁无，3001保持初始无listener，HEAD未变/index空。父阶段音质V1仍in_progress、SFX暂停，用户听感决定后续；不把本轮独立整篇原声当正式安全裁片验收。

只同步本记录、`docs/ROADMAP.md`、`docs/AI_HANDOFF.md`、`docs/project-archive.md`；保持项目既有文档路由和其他会话未提交改动。若用户选最近320字稿，须沿用精确原稿并处理已知CUDA解码限制，不能偷偷拆段或把短版称整篇。
