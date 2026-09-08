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

人声可选择本地 GPT-SoVITS 或 VoxCPM2；其他声音目前仍是程序合成。VoxCPM2 为当前人声生成独立候选，试听后采用，之后重混导出；生成候选本身不会替换工程原声。已选长文分组/停顿方案和高质量真实音效仍是后续工作，实际验收进度见 `docs/AI_HANDOFF.md`。

使用入口：工程编辑 → 选中人声片段 → 人声引擎选择 `VoxCPM2` → 选择参考与模式 → 生成。候选可试听、采用或丢弃；最近一次采用可跨刷新撤回，采用后继续编辑则通过项目安全版本恢复。

人声资产读取实际 PCM WAV 时长；VoxCPM2 候选采用和 Planner 人声生成会延长过短片段并顺延时间线，较短音频保留计划留白。混音兼容现有 32 kHz、44.1 kHz 和 VoxCPM2 的 48 kHz 音频。

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

本轮生成当前片段，台词上限 500 字，每次一个候选。服务器固定 CFG 2、timesteps 10、temperature 1、GPU layers 0 并启用 low-VRAM；这个组合仍使用 GPU。步数按文案长度设为 120–600，默认超时 5 分钟。达到步数上限的音频返回错误，需要拆短台词；通过格式检查不代表发音或台词完整度已通过主观试听。候选来源记录实际 seed/参数、CLI SHA256、模型文件名/大小/修改时间和参考内容 SHA256。

产品临时文件使用外部 runtime 下 `voxcpm2-product/runs`，跨服务进程的排他锁为 `locks/voxcpm2-generation.lock`。取消/超时会终止 CLI，确认进程退出后释放锁。如果服务崩溃或进程终止无法确认，保留锁防止叠加 GPU 任务；维护时先核实锁中的服务 PID 和 CLI PID 都已退出，再移除这个具体锁文件。不要在仍有 CLI 运行时删除锁。旧试听实验目录不自动迁移或修改。

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
