# 夜雨与雨后清晨：字数、参考音量和整篇生成准备

Date: 2026-10-11
Route: 人声导演与真实 ASMR 音效质量 V1（in_progress）
Status: done（本轮字数核对、隔离解码边界验证及两条茶稿整篇输出完成）；新引擎与旧输出不逐字节兼容。用户后续听感反馈已记录，客观文字/音高/噪声测量未执行。

后续用户反馈：长文字整篇末尾音色略尖，温柔更明显且渐有轻微电流杂音、整段通常略快，但整体远好于此前预判；建议控制适中段长并尽量保留整段生成原声，而非极短目标裁片。历史轮次/隔离引擎说明与后续方向见 [反馈记录](2026-10-11-audio-quality-v1-listening-feedback-and-generation-clarification.md)。下文实验过程及当时尚待试听的描述保留为历史。

用户试听六条夜雨后反馈：普通女声音色略上扬，温柔参考更明显；要求统计夜雨全文和雨后清晨单次生成字数，再分别用普通女生与温柔参考整篇生成《雨后清晨》。参考的语速、音量是否影响稳定性是待比较的假设，尚无客观音高测量或因果结论。

## 字数与实际生成输入

证据根：`I:/AI/asmr-director-whole-script-compare/2026-10-11-tea`。`text-count-audit.json` / `text-count-table.json` 将每条正式最终采用录音与真实 native 输入绑定；包含最终第8/9段边界调整后的版本。

| 文案 | 汉字 | 字符（含标点、不含文件末尾换行） |
| --- | ---: | ---: |
| 夜雨整篇 | 150 | 166 |
| 雨后清晨整篇 | 228 | 258 |

| 雨后清晨正式语义单元 | 最终保留目标字符 | 实际送入模型字符 | 实际送入模型汉字 |
| --- | ---: | ---: | ---: |
| 1 | 26 | 146 | 114 |
| 2 | 24 | 146 | 114 |
| 3 | 23 | 148 | 116 |
| 4 | 24 | 153 | 121 |
| 5 | 24 | 156 | 124 |
| 6 | 27 | 164 | 132 |
| 7 | 26 | 170 | 138 |
| 8 | 16 | 180 | 148 |
| 9 | 36 | 186 | 154 |
| 10 | 32 | 32 | 29 |

非末输入含目标、滑动后文、需要的中性补句和省略号，实际146–186字符，并没有每次填满500字符；最终只提取16–36字符目标。最后一段直接输入32字符。正式十目标连接后仍为完整258字符，没有删减。

## 原始参考的轻量测量

`reference-waveform-stats.json` / `reference_stats.py` 只读取两个原WAV，不加载模型、不调整波形。普通参考8.6秒、30汉字，整片RMS约−30.05dBFS；温柔6.9秒、27汉字，约−35.30dBFS，温柔低约5.24dB。文字汉字数/总时长分别3.49与3.91汉字/秒，包含停顿。

这不是LUFS或排除停顿后的发音速度。两参考的文本、说话者和停顿不同，不能证明参考音量/语速就是后半音色上扬的原因。此次计划保持两个原始参考的音量、语速和自然标点参考文字，先做整篇对比，不做增益、变速、音高或裁片处理。

## 整篇解码边界及隔离实验引擎

旧产品Aug25 `voxcpm2-cli.exe` SHA `ecb34b72a15d489ba333718082c784f9f8b0cc05161bb6525f15451d4f821c44` 的最终AudioVAE CUDA COPY转置优化使用ushort网格，`grid_y < 65535` 断言限制；当前48kHz解码时间轴约273 patches/43.68秒以内，274 patches/43.84秒开始超过这一条网格限制。限制来自张量维度，不能直接换算成固定字数，旧320字整篇失败也不能仅归为内存不足。True Combined与low-vram不会自动绕过最终整片解码。

在证据目录 `decoder-fallback/` 复制单个 `cpy.cu`，只给超限转置COPY切换既有一维generic kernel；原shape/strides与完整latent保留，正常尺寸保留原优化路径。单文件编译、库副本替换member和链接输出均在实验目录；没有替换生产源码/对象/库/引擎或产品provider。六个小COPY探针覆盖65534/65535/65536 tiles、非整齐边界、超限多batch、正常batch，全部逐位零差异；4个超限案例实际触发fallback。

实验EXE `decoder-fallback/voxcpm2-cli-copy-fallback.exe` SHA `b2288e8b4e41b6d6ed97336e31aa9b36beddb561879d8207afc03a9d46073347`，198380544字节。链接借用原build内Aug30静态组件，原产品是Aug25，所以不能宣称与产品只差COPY函数。`build-receipt.json` / `README.zh.md` 保留真实构建、首个rc.exe环境失败及修复重链接日志。COPY探针不等于音质验收，真实整篇解码结果见下文。

## 实际四次生成与兼容结论

`prepare_whole_requests.py` 冻结四份独立请求：

1. `compat-soft-request.json`、`compat-normal-request.json`：完整166字符夜雨、seed7811及旧配方，与六次对比各01原声做完整WAV/PCM比较。普通先实际生成32.64秒，再温柔25.92秒。
2. `tea-normal-request.json`、`tea-soft-request.json`：整篇258字符原稿；普通女生先、温柔参考后。固定各自原WAV＋精确参考文字True Combined、自然标点、配对seed7811、CFG2/temp1/timesteps10/maxsteps420/gpu0/low-vram，实际50.24/46.40秒。

四次调用沿用300秒单次监督、真实产品生成锁及fresh可提交内存门槛4,815,306,368字节，实际串行执行、全部exit0、所属锁释放，无自动质量重试或取消。`run_single_native.py` 是此前监督脚本的未改副本，只会停止本次新建且仍存活的所属child tree；本轮没有停止进程。全部完整原生48kmonoPCM16 WAV，不分段、不拼接、不缩短、不改变波形，也不自动导入或采用。监督耗时合计157.501秒是四调用报告之和，不是整个对话墙钟耗时。

曾因内存不足等待：`guard-after-build.json` 08:37:42 UTC实测可用虚拟内存2,792,255,488字节；随后准备终态回升5.457GB，实际启动前温柔兼容请求GMS仍4.653GB，被guard阻止，未加载模型。`memory-interface-audit.json` 193ms窗内GMS从4.665GB升到5.093GB、WMI在两者之间，不能据此认定固定接口偏差；实际guard始终按监督器两次fresh GMS `ullAvailPageFile`，不降低门槛或用WMI替代。之后只读fresh GMS5.499GB，普通兼容实际启动。温柔兼容使用`compat-soft-guard2-request.json`保留首blocked收据；茶稿普通首次启动前也仅4.778GB而阻止，稍后fresh5.072GB通过后使用`tea-normal-guard2-request.json`。共**4实际TTS＋2启动前guard-only阻止、ASR0**；两个blocked均`modelStarted=false`，不是音质重试。用户未回复释放，但后续实际资源数值通过支持继续，未把时间流逝当作回复或绕过guard。

`prepared-request-independent-audit.json` 8项汇总通过，四原请求全文/参考/seed/权重/参数一致性已独立核对；原稿text SHA`01adb0b355d9a7a242a1bc484f5304c9e772a9824b2806e6c8a2c0b621ddec78`，旧原文件仅多末尾换行。`short-compatibility-independent-comparison.json` 的4汇总及两条各24项文件/配方核验通过，**bitExactCompatibility=false**：普通旧34.56→新32.64秒，温柔旧26.72→新25.92秒，完整WAV及PCM都不同。不能将差异单归COPY，也不能以时长更短证明缺字、语速或音高变化。已向用户明确新引擎组件差异；两新短录音保留，作为与本次茶稿同引擎的基准。

| 茶稿参考 | 完整原声 | 秒 | 帧数/patches | SHA256 |
| --- | --- | ---: | --- | --- |
| 普通女生 | 普通女生-雨后清晨-整篇.wav | 50.24 | 2411520 / 314 | `22074f878b72b21806b21b065f82fe6cb081fbdb814607849b402b5b592fa0be` |
| 温柔参考 | 温柔参考-雨后清晨-整篇.wav | 46.40 | 2227200 / 290 | `be83fc5badb5e937d86bfe57eea9c2541d24f6c8a5344a68c3dd0d36241e14d5` |

两篇均单次258字符连续生成，patches低于420上限，完整RIFF/采样帧/PCM有限非静音/hash核验通过。普通/温柔实际最终解码各触发3次一维COPY fallback，grid_y分别75360/69600，均越过原ushort边界而正常exit0；这是真实整篇解码证据，尚不等于转录完整性或音色质量验收。未运行ASR或客观音高估计。

`whole-tea-compare-result.json` 绑定两完整文件、四实际调用/两个guard-only事件及`雨后清晨-两种参考整篇对比.zip`；ZIP只含两个原WAV、解压SHA一致，6431428字节，SHA`f2d0b6951da9a13fb6479de8c91fe43f3eec0eca83fd4d06ee172aae2a87c458`。正式工程此前62.280020833秒连接预览是提取目标＋等待，与本次整篇50.24秒方法不同，不把时长差视为客观语速/音质结论。

`independent-whole-tea-verification.json` 11项汇总及逐条输入/Combined/参数/完整RIFF/PCM统计/SHA/CLI采样/解码fallback/串行/自锁释放检查通过；ZIP仅两个原声且CRC32和解压文件SHA一致。两guard-only事件无child，四个真实调用完整保留；未把低于steps上限的patch数当作实际EOS停止原因。

`original-backend-files-after-build.json` 独立确认17个原源码/对象/库/四EXE SHA保持，包括产品ECB原件。生成后另写`watch-preservation-after-run-final.json`、`original-backend-files-after-run-final.json`、`runtime-after-run-final.json`，全部通过：96候选/224资产/782历史/10参考及20旧adopted、6正式交付/5昨日资料/19六夜雨与ZIP证据0增删改，原17文件SHA不变。runtime19项全true，0全部voxcpm2*.exe/0监督/0watch/3锁无、3001初终均无listener、HEAD同/index空，四真实成功/两guard-only/串行/释放一致。08:52:40 UTC fresh GMS可提交5,287,243,776字节，物理可用6,361,903,104；GPU648/5347MiB已用/剩余。保留准备终态收据，不用它们冒充后续运行核验。

留档仅更新本记录、`docs/ROADMAP.md`、`docs/AI_HANDOFF.md`、`docs/project-archive.md`，相关diff-check通过；保持共享源码与其他会话未提交工作。实验文件位于I盘，没有新增生产模型测试或全量应用构建。

本轮仅核对/隔离实验与留档，未启动/停止服务、未修改生产代码或候选、未提交/推送。仍属音质V1内部试听实验，父阶段in_progress、SFX暂停，无新增顶层路线。
