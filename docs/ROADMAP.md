# ASMR Director 固定 Roadmap

Last updated: 2026-09-08

本文件是项目顶层路线的唯一硬来源。`docs/AI_HANDOFF.md` 可以总结当前状态，`docs/project-archive.md` 可以记录历史，但它们都不能定义一套与本文件竞争的路线。

## 当前优先级

当前固定 10 步 roadmap 已全部完成。用户于 2026-09-08 确认 Planner“暂时算是过了”，随后批准实施 VoxCPM2 正式生成接入。Planner 本轮按已验证的 DeepSeek 路径和精简界面验收通过；优先级已转回“人声导演与真实 ASMR 音效质量 V1”。VoxCPM2 单片段生成、候选试听/采用/撤回及 48 kHz 重混导出已实施并通过技术验收，下一切片是已选长文分组/停顿方案。既有听感结论和真实音质验收要求不变。

## 本轮已通过：AI 创意策划 / LLM Planner V1

- Status: Accepted for this iteration by the user on 2026-09-08. Real external DeepSeek workflow and UI cleanup are accepted. Local Ollama memory recovery and broader script-quality evaluation remain non-blocking follow-ups, not claims of completed verification.
- 2026-09-07 初次实现与 DeepSeek 配置验收：34 个测试文件 / 260 项测试、全量 ESLint、TypeScript 与生产构建通过。用户配置 DeepSeek 后，真实出稿、单段改写、撤回、采用新工程、刷新恢复与策划来源载入通过；390px 长文案无横向溢出，浏览器无 error/warn。本地 Ollama 成功验收及更多主题的艺术质量评估仍待完成。
- 2026-09-07 界面整理：用户明确指出功能基本可用，但主界面堆积了无意义信息和开发注意事项。已按“默认只提供当前任务操作与创作内容，技术数据按需展开”精简策划、工程编辑与预览；这是当前 Planner/UI 体验整理，不新增阶段。本轮 260 项测试通过，最终排版调整后的 9 项 Planner 组件用例、全量 ESLint、TypeScript 与生产构建通过；桌面/390px、折叠与视图切换、刷新保稿检查通过，最终刷新后无新增浏览器错误。
- Design: `docs/superpowers/specs/2026-09-07-llm-planner-v1-design.zh.md`（附英文版）。
- 输入今日主题与可选时长、角色和风格，真实 LLM 生成完整可编辑中文文案。
- 支持单段改写、取消、撤回、草稿本地保存与文案下载；采用后创建新工程，保留原项目。
- 复用现有 Timeline DSL、项目库、编辑与音频链路；导演提示和音效建议独立于朗读台词，策划来源保存在项目库元数据中。
- 默认本地 Ollama，外部 API 可选且由服务器配置；不把模板当作模型输出。
- 读取真实语音时长，对策划工程延长过短的人声片段并顺延后续时间线，避免规划时长截断台词。
- 本阶段为用户批准的命名阶段，不新增编号 Step 11；音质 V1 的 VoxCPM2 和真实音效扩展仍未完成。

## 当前阶段：人声导演与真实 ASMR 音效质量 V1

- Status: In progress; base VoxCPM2 clip generation and candidate adoption/remix are implemented and technically verified. Selected long-text, improved spatial recipes and real SFX expansion remain unfinished; this slice's listening quality still needs user evaluation.
- Design: `docs/superpowers/specs/2026-07-13-audio-director-and-sfx-quality-v1-design.zh.md`
- Round 1 plan: `docs/superpowers/plans/2026-07-13-audio-quality-v1-round1-implementation-plan.md`
- VoxCPM2 接入设计与首切片实施记录：`docs/superpowers/specs/2026-09-08-voxcpm2-product-integration-design.zh.md`（附英文版）。基础接入已完成，长文和新空间处理尚未接入。
- 主线 1：让“更柔”、近/远、左右、水平环绕与垂直环绕成为真实可听的导演动作，而不是只改文字字段、音量或普通声像。
- 主线 2：以免费授权素材、免费本地 AI 和明确标注的基础合成扩大 ASMR 音效质量与种类；付费方案暂缓，不要求用户录音。
- 第一轮固定样片：一句人声、衣物摩擦、指尖轻敲、雨声；完成更柔、近/远、完整水平环绕、左—上—右—下垂直环绕、三种来源比较、采用、撤回与重混。
- 第一轮必须通过用户耳机试听，才进入全部动作和 8 类音效扩展。

### 2026-09-07 进度记录

- 已完成多轮 GPT-SoVITS、CosyVoice3 与 VoxCPM2 人声试听。对当前温柔中文参考，VoxCPM2 的整体柔和表达明显优于现有 GPT-SoVITS 方案，因此保留为可选人声引擎；但自然语言 `soft` / `whisper` 指令本身仍不稳定，不能宣布通用“更柔”已经完成。
- 已确认当前温柔中文长文本首选：语义组最初由本地 Ollama `qwen3:1.7b` 划分，随后 DeepSeek V4 独立复核得到相同分组；每次把当前语义组放到长文本开头，后接剩余全文，完整生成后只截取开头语义组；最后一组单独生成真正结尾；组间使用 DeepSeek 给出的短/中/长分类与相邻组真实停顿计算。当前试听成品的五处组间停顿为 `350 / 350 / 350 / 440 / 290 ms`。
- 已确认“更近”采用“贴耳说话姿态的重生成 + V2 空间处理”的组合；单独的人声方向提示“朝左耳说/朝右耳说”无法产生可辨认方向，左右与环绕仍必须由空间处理完成。
- 水平、垂直及左/右侧环绕已有可用实验结果，垂直闭环的过渡问题已修正；这些仍是独立试听实现，尚未接入工作台正式生成流程。
- 免费、本地优先的限制不变；DeepSeek 属于可选外部文本分析，必须保留免费本地分组和固定停顿兜底。程序噪声可以继续作为基础 SFX 兜底，但真实 ASMR 音效种类和质量仍未解决。
- 当前结论与证据见 `docs/superpowers/specs/2026-07-26-voxcpm2-evaluation-design.zh.md` 和 `I:\AI\voxcpm2-evaluation\evidence\LISTENING_RESULTS.zh.md`。

2026-09-08 已恢复音质 V1，先把已选的人声方案整理成现有 Generation Bridge 下的可选 Provider 和可配置生成模式。产品接入必须保留候选重生成、试听、采用、撤回和重混，不把单次好 seed 当成稳定能力。2026-09-08 收到全短句默认停顿对照的补充反馈：用户此前已试听“原停顿 vs 全部改成类别默认停顿”，感觉无明显差异，未选出新优胜版；实际试听日期未知。该对照不再列为待听，不改变 class-local 组间自适应停顿的当前首选；也不据此推断首尾无截音或两版完全等价。真实 SFX 扩展仍是同一阶段的未完成主线。

### 2026-09-08 产品接入首切片

- 已通过原生 CLI 接入可选 VoxCPM2，支持普通/温柔参考、Reference-only/Combined 两模式，保留 GPT-SoVITS；生成独立候选，试听后显式采用或丢弃。
- 候选与来源信息持久保存，采用前校验内容与素材，刷新后可撤回最近一次采用；保留安全版本、Planner 来源和实际人声时长，后续时间线自动顺延。取消会终止原生进程，失败/迟到结果不替换原声。
- 混音默认 48 kHz，兼容 32/44.1/48 kHz，保留 stereo 声道；界面只默认显示引擎/参考/生成/试听采用操作，技术来源折叠。旧工作树保持原状。
- 本轮全量 46 个测试文件 / 340 项测试、ESLint、TypeScript（生产构建内）及 Webpack 生产构建通过。原有 Windows native SWC 加载警告仍存在，WASM 回退构建成功。
- 真实本地 TTS 两模式产出 5.6 / 6.4 秒候选；独立浏览器上下文通过播放、显式采用、时间线延长、刷新撤回、8.6 秒 48 kHz stereo 重混和实际 WAV 下载。桌面/390px 界面无横溢，最终浏览器错误为空。另一次真实取消验证进程退出、锁释放、候选数不变。
- 证据目录：`D:\CodexWorkplace\asmr_director_runtime\voxcpm2-product-verification\2026-09-08`。自动检查不等同于用户耳机听感验收；长文分组/安全截取/自适应停顿、V2/HRTF 空间和真实 SFX 扩展继续属于本阶段未完成项。

第 7 步已经完成本地 voice clip 真实生成接入，第 8 步已经完成 breath / SFX / ambience 的本地半真实 clip 生成接入，第 9 步已经完成真实项目混音与 WAV 导出接入。后续不能再把 adapter、API route、provider wrapper、bridge cleanup、mock work 重新包装成新的顶层 roadmap 步骤；它们只能作为后续步骤的内部实现细节存在。

## 10 步路线

1. **字段级校验高亮**
   - Status: Completed.
   - Outcome: Clip Inspector 里的字段可以显示映射后的校验错误，Validation Panel 仍然保留完整问题列表。

2. **轻量 Timeline 编辑**
   - Status: Completed.
   - Outcome: 已支持选中 clip 的 start / duration 微调，不做完整 DAW。

3. **项目工作区结构升级**
   - Status: Completed.
   - Outcome: C+ 可折叠工作区结构，包括左侧项目栏、中间编辑区、顶部工作区操作与状态、右侧详情 / 预览 dock。

4. **真实音频前的预览层**
   - Status: Completed.
   - Outcome: 已完成早期 Preview Layer、状态概览、素材状态和 Timeline status dots。后续 Step 10 接入真实波形；2026-09-07 界面整理移除默认统计与占位波形，把非空轨道和素材详情改为按需展开。

5. **Clip 生成交互闭环**
   - Status: Completed.
   - Outcome: 已有选中 clip 生成、重新生成、重试、取消、运行时进度、durable asset commit、失败态、mock playback。

6. **稳定生成资产与项目混音骨架**
   - Status: Completed.
   - Outcome: 已有稳定的 `asset://clip/...` 与 `asset://mix/...` 引用、project mix control、full-project preview、WAV download、runtime-only job state、导入 / 导出边界保护。

7. **真实生成 MVP**
   - Status: Completed.
   - Outcome: 已打通本地 GPT-SoVITS voice clip 真实生成链路。工作台默认使用 local generation bridge，选中 voice clip 点击 `生成` 后会调用本地 Next API、请求 GPT-SoVITS、把真实 WAV 保存到 `D:\CodexWorkplace\asmr_director_runtime\assets\clips\app`，并把 `asset://clip/...` durable reference 写回 Project JSON。Preview Layer / selected clip preview 通过 `/api/assets/clip/<assetId>` 播放该真实 WAV。
   - Acceptance criteria:
     - 用户点击 voice clip 生成控制后，可以触发真实 provider 或真实本地生成服务。
     - 结果是可播放的真实音频文件，不再是 mock WAV synthesis。
     - Project JSON 只保存稳定 durable asset reference。
     - 生成出的 voice clip 可以通过现有 Preview Layer / selected clip preview flow 播放。
     - failure、retry、cancel 仍然可用。
     - adapter / API / provider wrapper 只能作为本步骤内部子任务实现，不能单独升级成新的 roadmap 步骤。
   - 2026-07-06 状态补充:
     - 已在 `D:\CodexWorkplace\asmr_director_runtime` 手动跑通本地 GPT-SoVITS API、参考音频 ASR、单句 TTS、以及一段约 59.53 秒的多 clip ASMR 测试混音。
     - 这证明真实生成链路本地可行，但还没有完成产品内接线：工作台的 voice clip 生成按钮尚未调用本地 provider，生成结果尚未通过稳定 durable asset reference 写回项目并进入现有 Preview Layer。
     - 下一步仍然属于第 7 步内部实现：把已验证的本地 GPT-SoVITS runtime 接入 Generation Bridge / selected voice clip generation flow，而不是新增顶层 roadmap 步骤。
   - 2026-07-07 完成记录:
     - 已新增 local runtime config、voice pack loader、GPT-SoVITS provider wrapper、local asset store、local generation bridge、clip generation API route、clip asset playback API route，以及 `asset://clip/...` playback resolver。
     - 默认 UI bridge 已从 mock 切到 local real generation；只有设置 `NEXT_PUBLIC_ASMR_GENERATION_MODE=mock` 时才使用 mock bridge。
     - Headless Chrome 端到端验收：页面 hydrate 后选中 `voice_001`，点击 `生成`，项目保存 `asset://clip/voice_001_20260706T211523064Z_d3b95513`，播放接口返回 `audio/wav`，`241,964` bytes，文件头 `RIFF`，页面无 error/warning。
     - cancel 对当前同步本地 provider 是客户端 best-effort：UI 会取消本地提交并忽略晚到结果，但已经发出的 GPT-SoVITS 请求不会被底层服务中断。

8. **多类型真实 Clip 生成**
   - Status: Completed.
   - Outcome: 在 voice 之外，已把本地半真实生成扩展到 breath、SFX、ambience。非 voice clip 使用本地程序化 WAV renderer，继续通过同一 selected clip generation flow、`asset://clip/...` durable reference、Preview Layer selected clip playback 进入项目。
   - Acceptance criteria:
     - 非 voice clip 也能通过同一 project contract 生成并预览。
     - Clip-level regeneration 仍然只影响当前选中 clip。
   - 2026-07-07 完成记录:
     - 新增程序化非 voice renderer：breath 使用柔和噪声呼吸包络，SFX 使用摩擦 / 敲击式包络，ambience 使用雨声底噪和稀疏雨滴颗粒。
     - `POST /api/generation/clip` 已从 voice-only helper 改为通用 local clip generation：voice 继续走 GPT-SoVITS，breath / SFX / ambience 走本地程序化 renderer。
     - Headless Chrome 端到端验收已生成 `breath_001` 和 `sfx_blanket_001`：播放接口均返回 `audio/wav`，文件头 `RIFF`，页面无 error/warning。

9. **真实项目混音与导出**
   - Status: Completed.
   - Outcome: 已按 Timeline DSL 把已生成 `asset://clip/...` assets 混成真实 `asset://mix/...` WAV，并接入 Preview Layer 的整段试听与 WAV 下载。
   - Acceptance criteria:
     - Project mix 使用真实生成的 clip assets 与 timeline timing。
     - Full-project preview 播放真实 mix。
     - WAV download 返回真实混音音频文件。
   - 2026-07-12 完成记录:
     - 新增 project mix readiness / export state / fingerprint helpers，用于判断素材是否齐全、旧 mix 是否过期，以及成功/失败时如何写入 `exports[type="wav"]`。
     - 新增 PCM WAV decoder / stereo WAV writer / project mix renderer，支持 timeline placement、clip gain、fade、pan、distance、movement、ambience loop、目标响度归一和 limiter。
     - 新增本地 project mix generation helper、`POST /api/generation/mix`、`GET /api/assets/mix/[assetId]`，并把 `asset://mix/...` 映射到可播放 API route。
     - Generation Bridge / runtime / summary / view model 已支持 `project_mix:wav` runtime job；Preview Layer 已接入 `生成整段`、`重混`、`试听`、`WAV` 和 `取消`。
     - 验证：`npm.cmd run test --prefix apps/web` 25 files / 158 tests 通过；`npm.cmd run lint --prefix apps/web` 通过；`npm.cmd run build --prefix apps/web -- --webpack` 通过；本地 API 验收生成 `asset://mix/step9_verify_project_wav_20260711T203915972Z_697118df`，播放接口返回 `audio/wav`、`RIFF`。

10. **产品工作流硬化**
    - Status: Completed.
    - Outcome: 已完成本地优先的产品工作流闭环：多项目库、旧单项目存储迁移、项目新建/切换/复制/删除、显式版本与破坏性操作前安全版本、真实 WAV waveform/技术分析、生成与导出质量检查，以及本地保存失败提示。云端持久化、账号、计费、发布、协作属于部署与商业化扩展，不冒充本地 MVP 已完成能力，也不自动构成新的顶层 roadmap。
    - Acceptance criteria:
      - 左侧项目栏显示真实本地项目列表并支持新建、切换、复制和安全删除。
      - 当前项目自动保存；用户可以留版本并恢复，覆盖/重置/切换前保留去重安全版本。
      - Preview Layer 对真实 `asset://clip/...` / `asset://mix/...` WAV 显示真实峰值波形，不再把伪波形当作真实结果。
      - 质量检查覆盖 schema、素材齐全度、mix 新鲜度、音频分析、声道和峰值余量；2026-09-07 起详情按需展开，实际失败与需处理的问题继续可见。
      - 项目 JSON 不混入项目库、版本、波形或运行时分析数据。
      - 本地保存失败时明确显示不可用，未知 mix fingerprint 保守标为需重混。
    - 2026-07-12 完成记录:
      - 新增版本化 `ai-asmr-studio:v1:project-library`，自动迁移旧 `v0` 单项目 key；每个项目最多保留 12 个版本，右栏显示最近 5 个。
      - 新增 `GET /api/assets/analysis` 与 PCM WAV 分析，返回 16-160 段真实 peak bars、duration、sample rate、channels、peak/RMS dBFS 和 clipped sample count。
      - 左侧占位项目栏升级为真实项目库；右侧新增质量检查与版本记录；Preview Layer 接入真实 waveform。
      - 独立代码审查后补齐本地保存失败态、持久化 mix fingerprint、非当前项目同 ID 导入安全版本、revision project ID 不变量、API 400 分类和精确 PCM 饱和判断。
      - 验证：`npm.cmd run test --prefix apps/web` 29 files / 184 tests 通过；`npm.cmd run lint --prefix apps/web` 通过；`npm.cmd run build --prefix apps/web -- --webpack` 通过；桌面和 390px 浏览器验收无横向溢出、无 console error/warning，真实 showcase WAV 显示 64 段波形并读出 32kHz stereo 技术指标。

## Roadmap 修改协议

只有用户可以批准顶层 roadmap 变更。如果 agent 认为某个步骤已经过时、不可行、或实际实现暴露了原设计不足，必须先说明冲突并提出 roadmap 修改建议，得到用户确认后才能改方向。
