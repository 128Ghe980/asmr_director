# ASMR Director 固定 Roadmap

Last updated: 2026-07-06

本文件是项目顶层路线的唯一硬来源。`docs/AI_HANDOFF.md` 可以总结当前状态，`docs/project-archive.md` 可以记录历史，但它们都不能定义一套与本文件竞争的路线。

## 不可动摇的当前优先级

当前最高优先事务是 **第 7 步：真实生成 MVP**。

Adapter、API route、provider wrapper、bridge cleanup、mock work 只能作为完成第 7 步的内部实现细节存在。它们不能成为新的顶层 roadmap 步骤，也不能成为继续推迟真实生成的理由。

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
   - Status: Current / In progress.
   - Outcome: 至少打通一条真实生成链路，优先 voice clip。
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

8. **多类型真实 Clip 生成**
   - Status: Pending.
   - Outcome: 在 voice 之外，把真实或半真实生成扩展到 breath、SFX、ambience 中至少两类。
   - Acceptance criteria:
     - 非 voice clip 也能通过同一 project contract 生成并预览。
     - Clip-level regeneration 仍然只影响当前选中 clip。

9. **真实项目混音与导出**
   - Status: Pending.
   - Outcome: 按 Timeline DSL 把已生成 clip assets 混成真实 WAV。
   - Acceptance criteria:
     - Project mix 使用真实生成的 clip assets 与 timeline timing。
     - Full-project preview 播放真实 mix。
     - WAV download 返回真实混音音频文件。

10. **产品工作流硬化**
    - Status: Pending.
    - Outcome: 在真实生成和真实混音成立后，再推进 project library、真实 waveform rendering、quality checks、versioning、cloud persistence、account system、billing、publishing、collaboration 等产品化能力。

## Roadmap 修改协议

只有用户可以批准顶层 roadmap 变更。如果 agent 认为某个步骤已经过时、不可行、或实际实现暴露了原设计不足，必须先说明冲突并提出 roadmap 修改建议，得到用户确认后才能改方向。
