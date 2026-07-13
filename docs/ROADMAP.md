# ASMR Director 固定 Roadmap

Last updated: 2026-07-13

本文件是项目顶层路线的唯一硬来源。`docs/AI_HANDOFF.md` 可以总结当前状态，`docs/project-archive.md` 可以记录历史，但它们都不能定义一套与本文件竞争的路线。

## 不可动摇的当前优先级

当前固定 10 步 roadmap 已全部完成。用户已于 2026-07-13 批准下一阶段优先解决音频实际听感，正式进入“人声导演与真实 ASMR 音效质量 V1”。本阶段不把新增 adapter、API route 或 provider wrapper 当成成果；只有实际试听能辨认表演、距离、方向和材质差异才算完成。

## 当前阶段：人声导演与真实 ASMR 音效质量 V1

- Status: Approved; Round 1 planned, implementation not started.
- Design: `docs/superpowers/specs/2026-07-13-audio-director-and-sfx-quality-v1-design.zh.md`
- Round 1 plan: `docs/superpowers/plans/2026-07-13-audio-quality-v1-round1-implementation-plan.md`
- 主线 1：让“更柔”、近/远、左右、水平环绕与垂直环绕成为真实可听的导演动作，而不是只改文字字段、音量或普通声像。
- 主线 2：以免费授权素材、免费本地 AI 和明确标注的基础合成扩大 ASMR 音效质量与种类；付费方案暂缓，不要求用户录音。
- 第一轮固定样片：一句人声、衣物摩擦、指尖轻敲、雨声；完成更柔、近/远、完整水平环绕、左—上—右—下垂直环绕、三种来源比较、采用、撤回与重混。
- 第一轮必须通过用户耳机试听，才进入全部动作和 8 类音效扩展。

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
   - Outcome: 已有 Preview Layer、fake waveform / status strip、preview counts、generation slots、Timeline status dots、Inspector asset slot。

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
      - 质量检查同时显示 schema、素材齐全度、mix 新鲜度、音频分析、声道和峰值余量。
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
