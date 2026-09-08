# VoxCPM2 正式生成接入设计

日期：2026-09-08。状态：接入准备完成，尚未实施或验收当前主线的 VoxCPM2 生成。

英文版：`2026-09-08-voxcpm2-product-integration-design.md`。

## 目标与范围

用户已接受本轮 Planner，要求记录推送后准备 VoxCPM2 正式接入。本设计细化已批准的“人声导演与真实 ASMR 音效质量 V1”，不新增顶层阶段。顶层路线仍以 `docs/ROADMAP.md` 为准；沿用 2026-07-13 音质设计和 2026-07-26 VoxCPM2 评估中的听感结论。

第一条可验收产品链路是：在当前工程选择 VoxCPM2、普通或温柔参考及参考模式 → 为当前人声生成候选 → 比较原声与候选 → 显式采用 → 可撤回 → 重混并导出 WAV。单次 CLI 输出 WAV 不等于这条链路完成，也不等于整个音质阶段完成。

保留 GPT-SoVITS 和现有非语音生成。VoxCPM2 作为可选引擎，不静默替换默认，也不在失败时偷偷切换模型。首个切片先覆盖当前片段的真实生成与安全采用；已选长文方案随后作为同一 Provider 的生成模式接入。

## 当前事实与可复用资产

本轮 Planner 里程碑为 `bd0d058`，已推送到 `origin/codex/step10-product-workflow`。当前主工作区的人声仍直接调用 GPT-SoVITS；没有正式候选库或采用/撤回闭环。混音当前默认 32 kHz，并拒绝不同采样率的素材；其 stereo 输入会被合成 mono。这些是 VoxCPM2 原生 48 kHz 音频正式进入工程时必须处理的兼容边界。

旧工作树 `D:\CodexWorkplace\asmr_director\.worktrees\audio-quality-v1-round1` 位于 `codex/audio-quality-v1-round1`，核查时 HEAD 为 `46d26d7`。其中候选、空间与 48 kHz 基础已有实现，但存在大量未提交改动，VoxCPM2 provider/profile 及测试还是未跟踪文件。后续须先重新检查状态，再选择性移植；不要整树合并、重置或覆盖它。

| 可复用模块（旧工作树） | 适配重点 |
| --- | --- |
| `audio-candidate.ts`、`local-candidate-store.ts` | 候选 schema、manifest、WAV 分离存储及数量限制；补请求指纹和当前项目归属 |
| `api/audio-candidates/...`、候选试听 API | 复用服务层逻辑；生成入口统一接现有 Generation Bridge，避免两套生成状态 |
| `candidate-acceptance.ts` | 采用前安全版本；适配 Planner 来源、实际时长及顺延 |
| `audio-candidate-panel.tsx`、旧 `studio-app.tsx` | 试听/采用/放弃交互；旧撤回只存在内存，需持久化并防止覆盖后续编辑 |
| `pcm-audio.ts`、`project-mix-renderer.ts` | 48 kHz 归一化、重采样与空间处理入口；补 stereo 保留策略 |
| `voxcpm2-provider.ts`、`voxcpm2-profile.ts` | 可复用进程/WAV 校验骨架，不能照搬参数和文本处理 |

`D:\CodexWorkplace\asmr_director_runtime\audio-quality-v1\voxcpm2\integration-result.json` 记录了 2026-07-29 原型真实生成 201、采用 200 以及干声/空间结果比对。这只是旧原型证据，不是当前主线已接入的证明。

## 本机运行配置

2026-09-08 只读核查确认以下材料存在；本次没有启动服务或生成音频：

- CLI：`I:\AI\voxcpm2-evaluation\src\build-cuda-vs2017\bin\Release\voxcpm2-cli.exe`，SHA256 `ECB34B72A15D489BA333718082C784F9F8B0CC05161BB6525F15451D4F821C44`，与接受样本记录一致。
- 模型：实验根目录下 `models\VoxCPM2-BaseLM-Q8_0.gguf` 与 `models\VoxCPM2-Acoustic-F16.gguf`。
- 参考：`references\soft-16k-s16.wav`、`normal-16k-s16.wav`；soft WAV 实际为 mono / 16 kHz / PCM16，接受输出为 mono / 48 kHz / PCM16。
- 配置：`D:\CodexWorkplace\asmr_director_runtime\audio-quality-v1\voxcpm2\profile.json` 已登记 CLI、模型、`soft_zh`/`normal_zh` 参考及授权记录。
- 实验封装：`I:\AI\voxcpm2-evaluation\tools\run-voxcpm2-monitored.ps1` 可用作参数和证据格式参考。正式服务直接以参数数组调用原生 CLI，使用 `shell: false`、隐藏窗口、独立运行目录、有界日志与超时。

服务器读取配置并暴露可用引擎/参考目录；浏览器只提交 ID 和受支持的模式，不提交可执行文件、任意音频路径或 endpoint。私有 CFG、timesteps、显存配置留在服务端，真实参数写入候选来源记录；不塞进 Timeline DSL 或前端主操作区。缺失配置显示简短可操作错误。

保留两种参考模式：“仅参考音频”与“参考音频＋文本”。后者对当前已选方案使用 Combined：同一参考同时传 `-r` 与 `--prompt-wav/--prompt-text`。准确转录的标点转为空格，末尾保留一个 ASCII 空格，之后不得再次 `.trim()`。仅参考音频模式不强制填写转录。普通和温柔参考的文本必须分别匹配各自录音。

旧实现必须修正：默认 60 步截断风险、缺少 `--low-vram`、带参考文本却未同时传 `-r`、转录尾空格被 trim、音频超过 clip 就拒绝、取消只依赖 timeout kill、模块变量锁和直接向用户拼接底层日志。步数上限应按生成模式验证，达到上限或疑似缺字的结果不得悄悄采用。

接受材料的配置是 `gpu_layers=0`、low-VRAM、CFG 2、timesteps 10、temperature 1；它仍使用 GPU，不能标成纯 CPU。结尾样本实测 GPU 峰值约 3626 MiB、进程 working set 3295.5 MiB。每次只运行一个音频候选，排他范围覆盖请求和工作进程；取消/超时需释放进程与锁。不要默认并发三个候选或同时运行 ASR/Ollama 抢资源。

## 请求、候选与项目状态

扩展现有 `GenerateClipRequest`，增加经过服务端校验的 `voiceOptions`：provider、voicePackId、referenceMode、generationMode。`generation-bridge.ts`、本地 bridge、clip API、`local-clip-generation.ts` 使用同一请求与可辨识结果；旧 GPT 与非 voice 调用保持兼容。Vox 成功返回候选，不能走当前成功回调的立即替换路径。

候选 manifest 放在外部 runtime，包含 project/clip ID、目标文本和请求指纹、稳定资产 URI、WAV 格式/实际时长、引擎与模型/权重标识、实际 seed/参数、参考与模式、质量检查和创建时间。候选复用 `asset://clip/...` 及播放能力；Project JSON 只记录已采用音频和必要的真实 generation 信息。完整候选来源、采用记录和项目版本位于各自元数据层。旧 DSL seed/model 不可冒充真实运行参数。

每次生成一个候选，“再生成”可以积累多个供比较；沿用每片段最多 12 个未采用候选的上限，到达上限提示放弃候选。首版不自动删除 WAV，避免误删当前工程和安全版本引用的音频。用户改变参考选择后仍能比较已有候选；文本改变则已有候选不能无提示地套用到新文本。

旧候选 schema/store 强制使用 `asset://candidate/...`。统一为现有 clip 资产时，须同步适配 schema、存储校验与播放映射；旧 manifest 单独做版本识别和兼容读取，不直接当作新格式载入，也不改写原型运行目录。

采用必须作为一致的状态操作完成：检查项目/clip 和内容指纹 → 建立安全版本 → 保存原资产与时间线变化的撤回记录 → 写入新资产、实际时长与真实引擎信息 → 标记需重混。保存失败不得提示采用成功。音频超过规划长度时延长人声并顺延后续时间线及相关情绪控制点；复用当前 Planner 时长处理，并覆盖非 Planner 人声的无截词行为。短音频首版保留原规划窗口，避免自动压缩用户的留白。

撤回恢复采用造成的资产、时长和时间线变化，同时恢复相应策划来源边界。记录需随项目库保存，刷新后仍能恢复。若采用后又编辑了项目，禁止用旧快照静默覆盖；停止快捷撤回并提供现有版本恢复入口。当前页面的候选状态以持久化的项目状态为准，不因单独 manifest 标志而误报已采用。

取消、失败、过期请求、生成中改文案或切工程均不能改变原音频和 mix 新鲜度。请求级取消接入 AbortSignal 与进程终止；客户端仍独立拦截晚到结果。成功生成但未采用的文件不等于工程内容已变。

## 混音与界面

内部混音统一到 48 kHz，兼容旧 32 kHz、44.1 kHz 和 Vox 48 kHz 输入，避免重采样后时长或时间线偏移。保留 stereo 两声道；单声道人声可交给现有空间层，已经空间化的 stereo 不再被平均成 mono 或重复空间化。保留原始干声，空间处理和缓存发生在重混阶段。

默认界面只显示引擎、参考、参考模式、生成/取消及已出现候选的试听/采用操作。候选列表显示必要时长与状态，技术参数和来源按需展开。采用前原声仍可试听，采用后提供撤回；真实错误、保存失败和需重混继续可见。不得恢复本轮刚删除的开发提醒、长说明或重复统计。

## 后续长文模式

以 `docs/AI_HANDOFF.md` 中当前已选配方为准：非末语义组置于剩余长文开头完整生成，再安全提取该开头组；最后一组生成真正结尾。只调整语义组间连接，组内天然停顿保留。DeepSeek 可选地给短/中/长类别，实际毫秒来自相邻组内部停顿的等权均值、同类有效样本，最后才用 180/350/600 ms 默认值；保留免费本地分组和默认停顿兜底。所有组选择后再做一次整体响度调整。

当前接受样本的人工 group5 替换、裁切 override、特定 seed/步数与固定补全文本不能直接包装成通用服务。安全提取、文本覆盖、首尾不截音、吸气/噪声与声音身份检查需用不同文本验证；不可安全裁切时保留候选并要求重生成，不静默截词。全短句 01/02 停顿比较仍未收到用户反馈，不阻塞基础接入，也不替换已选组间策略。

长文辅助工具需要另外核实 Python/ASR 环境。现成空间环境 `D:\CodexWorkplace\asmr_director_runtime\audio-quality-v1\.venv\Scripts\python.exe` 存在；旧 helper 指向的 `...\gpt-sovits\env-comfyui-clone\Scripts\python.exe` 不存在。ASR 权重在 GPT-SoVITS runtime 的 `tools\asr\models\faster-whisper-large-v3`，但权重存在不代表依赖可运行。CLI 基础接入不依赖这项修复。

## 实施顺序与验收

以下是音质 V1 内部实施顺序，不是新的路线关卡：

1. 对照旧工作树选择性移植 provider/profile 与候选 schema/store，补参考模式、真实参数、取消、串行排他和 WAV 校验。
2. 接入现有 Generation Bridge、候选试听及显式采用/撤回；保护 Planner 元数据、刷新恢复和实际时长。
3. 完成 48 kHz 混音兼容与精简 UI，跑真实 Vox 候选到重混导出的闭环。
4. 在此基础上产品化已选长文模式、安全提取和停顿；再继续已批准空间动作与真实 SFX 扩展。

基础接入的自动验证至少覆盖：GPT/非语音回归，两种参考模式，空/损坏 WAV，32/44.1/48 kHz 混音与 stereo 保留，长音频采用和撤回，取消/失败/晚到响应，生成中改文案或切工程，候选与撤回刷新恢复，采用后需重混及可播放导出。行为修改遵循现有 TDD 规则，完成全量测试、lint、TypeScript/生产构建。

浏览器以独立验收项目测试真实 Vox 生成，至少两个候选的试听/比较/采用/撤回，再重混下载；检查桌面和 390px 界面。保存真实运行配置、WAV 元数据及动作结果，保护用户已有草稿和工程。主观声音质量仍由用户耳机试听确认。实施时同步 `apps/web/README.md`、`.env.example`、`docs/THIRD_PARTY_RUNTIMES.md` 和路线/交接/留档；本设计没有宣称这些验证已完成。
