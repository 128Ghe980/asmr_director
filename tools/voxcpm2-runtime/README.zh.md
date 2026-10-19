# VoxCPM2 隔离原生缓存修复

本目录只保存最小源码补丁与可复现构建脚本，不含上游完整源码、模型、对象、静态库或 EXE。脚本使用已有本机工具链和缓存构建资产，不安装依赖，不修改原始源码、旧构建或生产 CLI。

`residual-context-capacity.patch` 让 ResidualLM 的 F32 K/V 容量匹配实际 BaseLM 上下文。现有 `--low-vram` 使用 4096，缓存由 512MiB 降至 64MiB，减少 448MiB；未启用该参数时仍为 32768。未改变权重、参考 WAV、参考文字、CFG、步数、随机种子、采样或音频后处理。

补丁同时在 Runtime 与 ResidualLM 的 prefill/decode 建图前检查容量。token 数先以 `size_t` 比较再转 `int`；负序号、非正序列长度和越界返回错误。本轮单次生成路线先检查错误再进行 WAV 解码，CLI 返回 1，不截文本、不静默产出半段 WAV。实际生成前缀与所有生成位置仍必须装入 4096 容量。本次六条基线的 prefill 为 156–337 tokens；即使按 800 个生成步骤计算，最大为 1137，低于 4096。这不代表任意参考长度和任意正文都能通过。

## 当前机器上的复现

需要 Windows、Python 3 标准库，以及以下既有资产。它们在本仓库之外，脚本不会下载或复制大型库：

- 原生源码：`I:/AI/voxcpm2-evaluation/src/llama.cpp-omni-pinned`
- 缓存构建：`I:/AI/voxcpm2-evaluation/src/build-cuda-vs2017`
- COPY fallback 资产：`I:/AI/asmr-director-whole-script-compare/2026-10-11-tea/decoder-fallback`
- VS2017 Community 的 MSVC `14.16.27023`、`vcvars64.bat`，Windows SDK `10.0.17763.0` 的 `rc.exe`，CUDA `11.6` 库。

暂停模型任务后，在新的外部目录构建；以下路径是示例，已有完整构建目录不会被覆盖：

```powershell
py -3 -B tools/voxcpm2-runtime/build_native_fixed.py --output I:/AI/asmr-director-generation-reliability/2026-10-19/native-fixed-reproduce --prepare
py -3 -B tools/voxcpm2-runtime/build_native_fixed.py --output I:/AI/asmr-director-generation-reliability/2026-10-19/native-fixed-reproduce --build
```

`--prepare` 只写小型源码副本、diff 和收据。`--build` 重编一份 C++ runtime 对象，生成小型 runtime LIB，直接引用既有其他对象/库和已验证 COPY fallback，链接独立 `voxcpm2-cli-reliability.exe`，最后仅运行 `--help`。原 CLI 的 `--help` 返回 1 是既有行为；脚本同时验证 Usage 内容，不把它当作模型失败。构建不会运行模型或替换产品入口。

输出约 191MiB，加上工具临时文件需预留空间。2026-10-19 实测编译/建库/链接约 1.89/0.11/3.30 秒，根进程采样峰值工作集约 109/3.4/526MiB；不含子工具，不是模型运行预算。临时目录固定在指定输出目录的 `work`。

收据 `build-receipt.json` 保存原始/补丁 SHA、复用资产前后 SHA、精确编译与链接参数、退出码、采样资源与输出 SHA。原源码身份或补丁不匹配时拒绝构建。`--verify-existing` 只复核已有成功编译/链接与 Usage 日志及 SHA，不再次编译或运行模型。重复校验会与原收据中的 OBJ/LIB/EXE 身份逐项对照；产物改变时拒绝并保留旧收据，不把新文件重新登记为已验证。

## 验证边界

2026-10-19 首个隔离构建为：

- 构建原输出：`I:/AI/asmr-director-generation-reliability/2026-10-19/native-fixed/voxcpm2-cli-reliability.exe`；真实对照后已移至稳定运行目录 `I:/AI/asmr-director-runtimes/voxcpm2/reliability-20261019/voxcpm2-cli.exe`，移动收据为同实验根的 `runtime-location.json`。原构建收据保留当时路径；不要对已移动的原输出目录运行 `--verify-existing`。
- SHA256：`feba01044885d494bb428ec61d9db9626f728a482dc8fc51a84b6dbf5fec4c80`
- 本构建工具执行 0 次模型推理；真实多文案对照由外部统一串行运行。

它复用 Aug30 缓存对象与 COPY fallback；与产品 Aug25 默认 CLI 的差异不只有本次缓存补丁。检验补丁本身的数值兼容性应与旧 COPY fallback 同输入/同参数对照。减少固定缓存不证明历史 cuBLAS 初始化失败或提交内存压力已完全解决；以实际生成和资源记录为准。该容量修复不把参考 VAE 搬到 CPU，也不添加参考分块、音频裁短或自动重试。

本修复的完整错误传播范围是单次生成。既有 CLI 的 `--stream` 分支忽略流式函数的失败返回，极端失败后可能继续保存已累积 chunk；这里没有修改该分支。产品不使用该分支，原参数解析也拒绝 `--low-vram --stream` 组合，不能据本次验证宣称流式错误处理已修复。

上游源码和依赖仍适用各自许可；此目录只分发自有构建脚本及针对本机既有源码的差异补丁。
