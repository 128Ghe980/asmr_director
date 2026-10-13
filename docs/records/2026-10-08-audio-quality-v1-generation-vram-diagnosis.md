# 人声音质 V1：生成显存不足诊断与提示修复

日期：2026-10-08（Asia/Hong_Kong）。父阶段「人声导演与真实 ASMR 音效质量 V1」保持 in_progress，SFX 暂停；未提交推送。

后续更新：用户再次授权复测时，原3001已停止；仅启动新build后单次生成成功。下方未部署/未复测是当时快照，最新状态见 [真实重试记录](2026-10-08-audio-quality-v1-generation-retry.md)。

## 实际失败证据

用户点击生成看到「VoxCPM2 生成失败，请稍后重试」。3001仍为PID24036、旧build `KCxT0NZBLvlLRQ-bSZXj1`，不是前轮服务退出。

- 16:40:00.951本地时间，诊断 `I:/AI/asmr-director-voice-work/diagnostics/voxcpm2-0fdc9b21-ea17-499a-8605-c871d4d2d01c.json`：进程360退出码1，明确记录 `ggml_backend_cuda_buffer_type_alloc_buffer: allocating 757.27 MiB on device 0: cudaMalloc failed: out of memory`，随后 `Combined cloning failed: failed to reserve AudioVAE encode graph memory`。这是参考音频AudioVAE编码图申请显存失败，尚未合成语音。
- 16:40:53.402，诊断 `voxcpm2-dd16e3ee-f32a-4cd9-ae5b-9cb887b650cf.json`：进程27700退出3221226505，日志停在LocDiT加载，没有明确OOM行。不能用前一次OOM或这个退出码证明本次具体原因。16:38–16:43 Windows Application窗口未查到匹配事件。
- 本机RTX3060 Laptop显存6GiB。生成退出后的只读快照为空闲5064MiB，不是失败时峰值，不能用它否定先前明确分配失败。查询时FreePhysicalMemory3987560KiB、FreeVirtualMemory4561480KiB；没有VoxCPM或ASR任务。其他项目进程不停止、不修改系统分页或模型/参考配置。

## 最小修复与验证

原分类只识别 `CUDA error: out of memory` 等形式，遗漏实际 `cudaMalloc failed: out of memory`。`voxcpm2-provider.ts`仅插入3行：限定cudaMalloc/cudaMallocAsync、同一CR/LF行、120字符范围和完整failed: out of memory形式，返回503及「语音模型可用显存不足，请关闭占用显卡的程序后重试。」。存储优先级、原ENOMEM/cuBLAS/上下文分类、取消/超时/锁/原音恢复/日志保持；不按Windows退出码猜测OOM，不自动重试或更换参考。

`voxcpm2-provider.test.ts`追加7项回归：真实757.27MiB日志、Async OOM、非OOM参数错误、LF/CRLF跨行及无OOM的Windows fast-fail，验证参考字节、一次调用、锁与临时目录清理、服务端诊断保留及公共错误不泄露细节。Provider/session共54项通过；最终完整非增量TypeScript及2文件ESLint通过。独立审查11项通过，删除新增3行后provider逐字节等于本轮备份。没有进行任何真实模型复测。

证据根 `I:/AI/asmr-director-generation-failure/2026-10-08`：`provider-tests.log`、`typecheck-final.log`、`lint.log`、`voxcpm2-provider-final-review.json`。正式构建42.92秒、exit0，新dist `.next-generation-oom-production`，BUILD_ID `jzycOB_1_hvvzeCLn6eiE`，`build-production-verification.json`；Next修改的共享配置恢复原字节，`.gitignore`只增加本轮dist。

## 运行状态与未完成事项

**新build未部署**：自动审批拒绝包含身份核对、停止PID24036及隐藏独立启动新build的命令，工具只给出“blocked by policy”，无更具体理由。命令未执行，没有换工具/方式绕过。3001仍运行旧PID24036/旧dist `.next-recheck-connection-production`/旧build `KCxT0NZBLvlLRQ-bSZXj1`，当前通用提示尚未切换。

浏览器只读保存了原标题和50输入值，未刷新、生成、采用或注入状态。现有候选/原音/参考保持；本轮没有新音频或候选。后续部署需在当前生成完全停止后正常停止原3001，再以新dist启动；保持既有ASMR_VOICE_WORK_ROOT及预览临时根。显存问题的实际再次生成成功未验证，最新fast-fail原因未确定，不能把提示修复当成模型运行修复。
