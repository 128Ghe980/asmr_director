# AI ASMR 导演台

本地 ASMR 创作工作台：AI 策划、分镜/时间线编辑、片段生成、版本恢复、混音与 WAV 导出。

路线和恢复上下文见仓库根目录 `docs/ROADMAP.md`、`docs/AI_HANDOFF.md`。Planner 设计见 `docs/superpowers/specs/2026-09-07-llm-planner-v1-design.zh.md`。

## 启动

在仓库根目录执行：

```powershell
npm.cmd install --prefix apps/web
npm.cmd run dev --prefix apps/web -- --port 3000 --hostname 127.0.0.1 --webpack
```

打开 [本地工作台](http://127.0.0.1:3000)。端口被其他项目使用时请换端口。Windows 本环境使用 Webpack；已有 SWC 原生绑定警告可由 WASM 回退处理，以命令退出状态为准。

构建目录默认是本项目内的 `.next`；可设置 `ASMR_NEXT_DIST_DIR=.next-spatial` 使用另一个项目内目录。编译产物应留在 `apps/web` 内能解析 `node_modules` 的位置，不要把整个构建目录直接指向无关的外盘路径。磁盘紧张时可将下文的空间音频缓存放到外盘；Next 构建目录如需迁移缓存，只迁移其 `cache` 子目录，保留项目内的 server／static／类型产物。

## AI 创意策划

1. 点击中央“AI 创意策划”，输入今日主题，选择目标时长，可补充角色、说话风格和避免的内容。
2. 点击“生成策划稿”。文案包含完整台词、导演提示和音效建议；支持直接编辑及“AI 改写第 N 段”。
3. “撤回 AI 修改”恢复最近一次 AI 更新或来源载入（当前页面最多 5 次）；“下载文案”保存独立稿件。
4. “采用并创建工程”创建新的人声项目，原项目保留；之后使用已有生成和混音流程制作音频。

当前仅中文，目标时长支持 1、3、5、10 分钟。目标是写作参考，不保证精确成片长度。导演说明不进入朗读台词，音效建议保存为待制作内容，采用时不生成任意音效。表演意图不能保证当前 TTS 完整执行。

草稿在当前浏览器自动保存。修改主题后旧稿仍使用生成时的设定，需重新生成才应用新要求。项目策划来源是采用时的快照，工程内后续台词编辑不反向更新它。Project JSON 仅导出工程；独立保存文案及导演提示请用“下载文案”。

## 文案模型配置

复制本目录 `.env.example` 为 `.env.local`，修改后重启 Next 服务。密钥只放服务器环境变量中，不使用 `NEXT_PUBLIC_` 前缀。

### 本地 Ollama（默认）

默认连接 `http://127.0.0.1:11434`，模型 `qwen3:1.7b`。本机需安装 Ollama 和对应模型，参考 [Ollama 官方文档](https://docs.ollama.com/quickstart)。

```powershell
ollama pull qwen3:1.7b
ollama serve
```

Ollama 已在后台运行时无需再次执行 `serve`。可配置 `ASMR_PLANNER_OLLAMA_URL`、`ASMR_PLANNER_OLLAMA_MODEL`。低内存环境可调整 `.env.example` 中的上下文与 GPU 参数；`ASMR_PLANNER_OLLAMA_NUM_GPU=0` 使用较慢的 CPU 模式，不保证内存不足时仍能加载。离线或模型加载失败会显示错误，不返回伪模板。

### 外部 API（可选）

支持具有 Chat Completions JSON mode 的兼容服务。配置 `ASMR_PLANNER_API_URL`（API base，按服务需要包含 `/v1`）、`ASMR_PLANNER_API_KEY`、`ASMR_PLANNER_API_MODEL` 后，在界面选择“外部 API”。`ASMR_PLANNER_DEFAULT_PROVIDER=api` 可设为新工作草稿默认项，已保存的选择优先。

目前前端只有模型来源选择，没有 API 地址/密钥配置表单。使用 DeepSeek 官方 API 时，在 `apps/web/.env.local` 中填写：

```dotenv
ASMR_PLANNER_DEFAULT_PROVIDER=api
ASMR_PLANNER_API_URL=https://api.deepseek.com
ASMR_PLANNER_API_KEY=在本机填写你的密钥
ASMR_PLANNER_API_MODEL=deepseek-v4-pro
```

保存后重启 Next 服务，刷新工作台，在“AI 创意策划 → 文案模型”手动选择“外部 API”。已有草稿会保留之前的 Ollama 选择，不会被默认值强制切换。官方地址和模型名见 [DeepSeek JSON Output 示例](https://api-docs.deepseek.com/guides/json_mode/)；使用第三方代理时，按代理实际提供的地址和模型名配置。

外部调用会发送主题、原稿和改写要求，可能产生费用。项目不自动选择付费服务。不要提交 `.env.local`。

协议参考：[Ollama JSON schema](https://docs.ollama.com/capabilities/structured-outputs)、[DeepSeek JSON mode](https://api-docs.deepseek.com/guides/json_mode)。模型名称以所配置服务实际支持的名称为准。

## 音频与保存

人声可选择本地 GPT-SoVITS 或 VoxCPM2；其他声音目前仍是程序合成。VoxCPM2 为当前人声生成独立候选，试听后采用，之后重混导出；生成候选本身不会替换工程原声。已选长文分组/停顿方案已于 2026-09-09 完成工作台接入及真实技术验收。2026-09-14 用户采用的原 D 双耳空间已接入人声试听和整段混音，支持距离、左右、水平定距环绕与环绕靠近；真实高质量音效、垂直环绕及音质 V1 其余工作仍待继续，最终验收进度见 `docs/AI_HANDOFF.md`。

使用入口：工程编辑 → 选中人声片段 → 人声引擎选择 `VoxCPM2` → 选择参考与模式 → 生成。候选可试听、采用或丢弃；最近一次采用可跨刷新撤回，采用后继续编辑则通过项目安全版本恢复。

长文入口：上述位置的“生成方式”选择“长文分组”，再选择“文本分析”。默认本地 Ollama，配置好的外部 API 可选；失败时明确提示采用本地标点分组与停顿规则。生成期间显示当前组的进度并可取消。候选可整段试听，也可展开分组试听并单独重生成某一组；这会保留原候选并创建新的完整候选，其他组复用原音频。技术参数、实际分组和停顿来源放在可展开详情中。

长文请求目前为 1–500 字符（含标点），最多 12 个语义组。500 字符是当前产品/CLI 请求限制，旧试听样片的 16 句、177–196 字符只是配方复现基线；系统不会为凑旧长度删除正文。每次生成保留目标组及全部剩余正文，并在有空间时添加固定中性补句以维持长输入，完整原音先保存并提供试听、下载；核对通过时另提取目标开头用于分组拼接。检查有疑问时保留完整原音并提示，继续生成后续组，不丢弃音频；这种候选可能含后续台词、补句或重复内容，由用户试听决定是否采用。最后一组独立生成真正结尾，不补句。添加生成用停顿标点后超过 500 字符时会报错，需拆分或缩短文案，不会静默截断。

组内停顿保持原音频。组间使用已选的短/中/长分类和实际 ASR 词间隙：0 ms 也是有效测量；先取相邻组内部停顿均值的等权平均，在对应类别范围内才使用，否则找同类有效样本，最后使用 180/350/600 ms 默认值。连接只补足扣除首尾已有安静时长后的差额，不为强求目标时长裁切人声；成品仅做一次整体响度调整。2026-09-20 用户明确要求检查不能阻止交付：每组只生成一次，不因检查失败自动换 seed 重跑；待试听组不伪造停顿测量，缺少测量时沿用类别默认停顿。单组重生成由用户主动选择。“完整原始录音”独立于候选，检查中、失败或取消后仍可试听和下载已有文件；支持历史同文案恢复和分页。独立原音不作裁剪或响度调整。

人声资产读取实际 PCM WAV 时长；VoxCPM2 候选采用和 Planner 人声生成会延长过短片段并顺延时间线，较短音频保留计划留白。混音兼容现有 32 kHz、44.1 kHz 和 VoxCPM2 的 48 kHz 音频。

### 原 D 双耳空间

在“试听与导出”开启“双耳空间”，选中人声片段，在“移动”选择“定距环绕”或“环绕靠近”，然后试听完整候选／当前人声，采用后生成整段。建议戴耳机判断方向与距离。定距环绕可选择“贴耳／中／远”，对应距头中心 0.18／0.8／1.75 米；环绕靠近固定从 1.75 米到 0.18 米。路线从左侧经过后方、右侧、前方回到左侧，首尾有平滑停留；左右、静止、靠近和远离也继续可用。

TTS 原声音频始终保留，更改距离或运动不需要重新合成已经生成的人声。首次空间试听按当前设置生成本地缓存，重复试听复用缓存；修改空间设置后只重算对应空间音频。完整候选按实际原声时长试听，长文详情中的单组试听保留干声。关闭“双耳空间”后候选／当前片段播放原声，整段恢复普通立体声处理；已有双声道素材保留左右声道，不重复做 D。已有旧双耳混音会显示“需重混”，原导出仍可播放和下载。

D 使用原 HRTF＋近场 DVF＋房间反射方案。单声道人声在 48 kHz 处理，原声首尾准备与整体 −27 LUFS 增益、用户淡入淡出都在房间卷积前施加，派生结果是 48 kHz 双声道 PCM24，并完整保留额外 0.65 秒房间尾声。尾声不改变 TTS 资产时长，但可与后续片段重叠，或使整段导出比工程时间线稍长。最终混音通常是 48 kHz 双声道 PCM16，clip 音量只施加一次。

包含 D 的混音不再使用旧 `target_lufs` 向上归一，保留原配方的天然近远响度差。主限幅开启时，仅对超过 −2.1 dBFS 采样峰值的整段施加双耳共同衰减；不单独抬升远处声音，也不重复 pan、距离增益和淡化。非 D 混音沿用旧行为。

无需另起空间 HTTP 服务；Next 调用本地 Python。默认路径相对 `ASMR_DIRECTOR_RUNTIME_ROOT`（本机默认 `D:/CodexWorkplace/asmr_director_runtime`）：

| 配置 | 默认位置 |
| --- | --- |
| `ASMR_SPATIAL_PYTHON` | `audio-quality-v1/.venv/Scripts/python.exe` |
| `ASMR_SPATIAL_HRTF` | `audio-quality-v1/hrtf/viking/subj_A.sofa` |
| `ASMR_SPATIAL_CACHE_ROOT` | `assets/spatial` |

Python 需要 `numpy`、`scipy`、`soundfile`、`h5py`、`pyloudnorm`。本机既有空间环境和 Viking A 文件可直接复用。SOFA、Python 环境和派生 WAV 保留在仓库外。磁盘紧张时，例如在 `apps/web/.env.local` 设置以下路径后重启服务：

```dotenv
ASMR_SPATIAL_CACHE_ROOT=I:/AI/asmr-director-runtime/assets/spatial
# 若复用默认 Python/HRTF，无需填写这两项。
# ASMR_SPATIAL_PYTHON=D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/.venv/Scripts/python.exe
# ASMR_SPATIAL_HRTF=D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/hrtf/viking/subj_A.sofa
```

空间请求最长 10 分钟，每个 Node 进程同时渲染一个任务、最多排队八个。缺少环境或 HRTF 会报错，可补齐后重试；空间试听失败也可关闭双耳空间检查原声。取消请求或混音任务会终止对应渲染进程，确认退出后才释放槽位；失败半成品不进入缓存。暂停播放本身不保证中止网络请求。缓存键包含原声、代码、HRTF 和处理参数，修改模型文件或参数不会误用旧空间 WAV。

HRTF 来自 Spagnol、Miccini、Unnthorsson（2020）的 [Viking HRTF Dataset v2](https://doi.org/10.5281/zenodo.4160401)，许可为 CC BY 4.0；再分发数据或改编时保留署名和许可说明。A 耳型只在 1 米实测，更近距离由模型近似，房间为合成响应。本次采用原 D，不加入 E/F/G，也不代表个人耳型或垂直环绕已完成。处理合同与本轮证据见 `docs/superpowers/specs/2026-09-14-spatial-d-product-integration.zh.md`，独立 CLI 用法见 `apps/web/scripts/spatial_d/README.md`。

### VoxCPM2 本机配置

不需要额外启动 Python TTS 服务。服务器直接调用本机原生 `voxcpm2-cli.exe`，默认 profile 位于 `D:\CodexWorkplace\asmr_director_runtime\audio-quality-v1\voxcpm2\profile.json`。其他安装位置可用服务器环境变量 `ASMR_VOXCPM2_PROFILE_PATH` 指定；浏览器只选择已配置的声音 ID，不接收任意文件路径。

profile 采用以下结构；相对路径以 profile 所在目录解析，CLI 需支持 `--low-vram` 和 Combined 克隆模式：

```json
{
  "version": 1,
  "provider": "voxcpm2",
  "cliPath": "bin/voxcpm2-cli.exe",
  "baseModelPath": "models/VoxCPM2-BaseLM-Q8_0.gguf",
  "acousticModelPath": "models/VoxCPM2-Acoustic-F16.gguf",
  "defaultReferenceId": "soft_zh",
  "references": [{
    "id": "soft_zh",
    "displayName": "温柔中文参考",
    "audioPath": "references/soft-16k-s16.wav",
    "promptTextPath": "references/soft.txt",
    "licenseStatus": "user_confirmed",
    "consentConfirmedAt": "2026-07-14T16:20:23.000+08:00"
  }]
}
```

参考音频使用 mono / 16 kHz / PCM16 WAV。普通、温柔等声音各自登记准确转录和真实授权信息；上例日期仅展示格式。没有转录时省略 `promptTextPath`，该声音仍可使用“仅参考音频”。“参考音频＋文本”会同时传参考音频与 prompt；适配器把转录标点转为空格并保留一个末尾 ASCII 空格。

直接生成和长文分组均为当前片段创建一个完整候选，台词上限 500 字符。服务器固定 CFG 2、timesteps 10、temperature 1、GPU layers 0 并启用 low-VRAM；这个组合仍使用 GPU。每次 CLI 的步数按输入长度设为 120–600，默认超时 5 分钟。达到步数上限或接近静音的有效 WAV 仍交付，提示可能未读完或接近静音。原始文件在格式/质量判断前发布；即使原生进程报错，有已完成文件也保留供试听或下载。无法解码的文件仍可下载检查，不伪装成可采用候选。长文另外逐组做本地 ASR，整体任务上限 30 分钟；技术检查通过也不代替用户听感验收。候选来源记录实际 seed/参数、CLI SHA256、模型文件名/大小/修改时间和参考内容 SHA256。

`ASMR_VOICE_WORK_ROOT` 可指定新原生临时文件 `runs`、ASR 临时文件 `analysis-runs`、完整原音及计划 `long-text/<运行ID>` 的根目录；未配置时使用外部 runtime 下 `voxcpm2-product`。本机配置为 `I:/AI/asmr-director-voice-work`，旧 D 盘原音仍可读取，不移动或删除。跨服务进程的排他锁为 `locks/voxcpm2-generation.lock`，一次长文任务持锁覆盖分组、所有 TTS 和 ASR，并登记所有活动子进程 PID，全部确认退出才释放。支持最多一个 TTS 与一个 ASR 的有限流水线，最多提前生成一组；迟到的真实退出也会补发已写出的原音。取消/超时会终止当前 CLI 或 ASR 进程，确认退出后才清理临时目录并释放锁。如果服务崩溃或进程终止无法确认，保留锁；维护时先核实锁中的服务 PID 和子进程 PID 都已退出，再移除这个具体锁文件。不要在仍有子进程运行时删除锁。旧试听实验目录不自动迁移或修改。


文本分组与语音检查环境准备并行，同一任务复用环境探测。`ASMR_VOICE_PIPELINE=auto|serial|overlap` 控制有限流水线，auto 要求至少 8 GiB 可用内存和 8 个可用逻辑 CPU。`ASMR_VOICE_ASR_REUSE=auto|off|always` 控制单任务内识别模型复用；auto 至少 8 GiB 空闲才驻留，组后低于 6 GiB 就释放。默认均为 auto；本机内存紧张时采用串行/非驻留。2026-09-20 真实复用验证加载峰值 RSS 3.46 GiB，最低剩余内存 0.48 GiB，不能承诺本机开启大模型并行会更快。

### 长文语音核对环境

长文自动检查使用本地 `faster-whisper`、`numpy`、`scipy`、`soundfile` 和可提供 `opencc.OpenCC` 的环境，以及已下载的 `faster-whisper-large-v3` 权重。ASR 固定 CPU/int8，禁止运行时下载模型，无需启动新的 HTTP 服务。2026-09-09 已检查：空间环境 `audio-quality-v1/.venv/Scripts/python.exe` 缺少 faster-whisper/OpenCC；可用环境是 `engines/gpt-sovits/env-comfyui-clone/python.exe`（不是其不存在的 `Scripts/python.exe`）。服务会依次检查这两个现有环境，也可用下列服务器配置覆盖：

```dotenv
ASMR_VOICE_ANALYSIS_PYTHON=D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\env-comfyui-clone\python.exe
ASMR_VOICE_ANALYSIS_MODEL=D:\CodexWorkplace\asmr_director_runtime\engines\gpt-sovits\GPT-SoVITS\tools\asr\models\faster-whisper-large-v3
```

ASR 逐组核对完整目标、重复和后文泄漏；裁切点必须位于有词边界保护的安静区，裁后再次核对台词。粗词时间戳与实际静音错位时，仅在边界附近检查最多 3 个静音候选，要求截点两侧各有至少 80 ms 实测安静，并分别核对左侧完整目标和右侧完整后文开头。不同底噪采用有绝对/相对上限的补充检测，严格检测优先；通过验证且仍保留在末尾的安静时长计入连接，避免重复补停顿。不使用固定样片的人工截点或按字数猜时长。无法判断时标注待试听，保留完整原音并继续，不再自动重生成或阻止交付。候选采用始终由用户主动决定，缺少检查环境也不禁止生成。分组模型仅收到文本；本地 ASR 不发送音频到外部服务。选择外部文本分析时会发送当前台词，可能产生费用，沿用前述 `ASMR_PLANNER_API_*` 配置。

候选清单在 runtime 下 `assets/candidates/voxcpm2-v1/manifest.json`，每个片段最多保留 12 个未采用候选；丢弃不会删除 WAV。采用/撤回信息随浏览器项目库保存，声音选项单独保存在 `ai-asmr-studio:v1:voice-options`，不进入工程 JSON。

项目库和版本保存在 `ai-asmr-studio:v1:project-library`，工作草稿保存在 `ai-asmr-studio:v1:planner-draft`。重置/导入替换清除旧策划来源，安全版本恢复同时恢复对应来源。保存失败会明确提示，请及时下载文案或工程 JSON。

## 验证

在仓库根目录执行：

```powershell
npm.cmd run test --prefix apps/web
npm.cmd run lint --prefix apps/web
npm.cmd run build --prefix apps/web -- --webpack
```

单元测试使用明确的 provider fixtures，无需真实模型。真实出稿和浏览器验收须另行记录，不能由测试通过推断文案质量。

长文 Python 安全测试可在已配置环境运行 `apps/web/scripts/test-analyze-voice-group.py`，不调用模型或合成音频。2026-09-09 长文接入通过 **53 个 Vitest 文件 / 465 项测试、23 项 Python 测试、全量 ESLint 和包含 TypeScript 的 Webpack 生产构建**。真实工作台完成五组生成、单组重生成、试听/采用/刷新撤回、取消、23.36 秒 / 48 kHz stereo 重混与 WAV/工程 JSON 下载；桌面/390px 无横向溢出，最终浏览器 error/warn 为空。原有 Windows native SWC 警告仍存在，WASM 回退构建成功。

证据位于 `D:\CodexWorkplace\asmr_director_runtime\voxcpm2-longtext-verification\2026-09-09`，详见 `browser-result.json`、`reroll-result.json`、`cancel-result.json`、`mix-verification.json` 与 `final-*.log`。工作台保留“长文分组接入验收”项目及两个真实候选。这段 2026-09-09 的历史验收没有包含空间接入或真实 SFX 扩展。

2026-09-20 原 D 接入收尾：26 项空间 Python 测试通过，四条获采用的自然 WAV 与 8770 逐字节一致；最终 57 文件／520 项 Vitest（含真实 TypeScript→Python 联调）、全量 ESLint、TypeScript 和生产构建通过。真实工作台生成、试听、采用／撤回、编辑空间设置后重混及下载闭环已验证，并完成生产构建的桌面／手机复核。可用 `ASMR_SPATIAL_REAL_TEST=1` 显式启用真实适配器测试，以 `ASMR_SPATIAL_TEST_ROOT` 指定仓库外临时目录；普通测试默认跳过它。完整证据和取消检查边界见本轮双语 spec 与 `docs/AI_HANDOFF.md`。
