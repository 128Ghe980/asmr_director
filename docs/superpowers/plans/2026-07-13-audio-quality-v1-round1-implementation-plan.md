# 音频质量 V1 第一轮完整样片实施计划

日期：2026-07-13

对应设计：`docs/superpowers/specs/2026-07-13-audio-director-and-sfx-quality-v1-design.zh.md`

## 目标

第一轮只完成一条可以从界面走通、并且必须通过耳机试听的完整链路：

- 一句固定中文人声可以比较原版与“更柔”候选；
- 同一声音可以试听更近、更远、完整水平环绕、左—上—右—下垂直环绕；
- 衣物摩擦、指尖轻敲、雨声可以比较免费素材、本地 AI、基础合成三种来源；
- 每个新结果都先成为候选，不覆盖原声；
- 可以采用、撤回、重新生成和重混；
- 不把“成功写出 WAV”当作质量完成，必须实际听得出表演、距离、方向和材质差异。

## 第一轮不做

- 不一次扩展全部 8 类音效；第一轮只做衣物摩擦、指尖轻敲、雨声。
- 不实现全部单侧路径；第一轮只实现完整水平环绕与左—上—右—下垂直环绕。
- 不接付费 API、付费素材库、云账号或录音流程。
- 不在本地模型未通过试听前，把“更柔”或“本地 AI 高质量音效”显示为已支持。
- 不把第三方模型、权重、素材 WAV、空间数据或 Python 环境提交到 Git。

## 已锁定的技术选择

1. Web 产品继续使用 Next.js、React、TypeScript、Zod 与 Vitest。
2. 项目混音统一为 48 kHz、双声道；所有来源先转换，再做一次音量、淡入淡出和空间处理。
3. 动态空间处理使用独立的本地 Python 音频运行时。当前 FFmpeg 构建没有 `sofalizer`，不能承担第一轮动态环绕。
4. 空间数据首选 Viking HRTF 的 CC-BY 4.0 数据；默认方案固定为一个已试听通过的 profile，另保留两个备选 profile。
5. 本地音效首选 Stable Audio 3 Small-SFX；它必须先在本机完成衣物摩擦、轻敲、雨声固定提示词测试。
6. “更柔”先比较现有 GPT-SoVITS 和 Fun-CosyVoice3-0.5B-2512。只有通过盲听门槛的 provider 才接入产品。
7. 免费素材通过本地授权素材目录导入。第一轮不把 Freesound API 作为产品依赖，因为其免费 API 条款不适合作为未来商业产品的默认来源。
8. 现有程序合成保留并明确标注“基础合成”；它可以兜底，但不能冒充真实录音或高质量 AI。

## 本地目录约定

以下内容位于 `D:\CodexWorkplace\asmr_director_runtime`，不提交到仓库：

```text
audio-quality-v1/
  engines/
    stable-audio-3/
    cosyvoice3/
  models/
    stable-audio-3-small-sfx/
    cosyvoice3-0.5b/
  spatial/
    viking/
  licensed-assets/
    cloth/
    tapping/
    rain/
  candidates/
  evaluation/
```

仓库只提交运行时调用代码、配置结构、测试和授权记录。

## 完成门槛

自动检查全部通过后，还必须完成一次用户试听。第一轮只有同时满足以下条件才算完成：

- “更柔”不是只变小声，用户能听出说话方式更轻、更柔；
- 更近与更远不是只有音量差，能听出贴耳感和远离感变化；
- 戴耳机可以判断完整水平环绕的方向；
- 默认空间方案可以产生基本的左—上—右—下运动感；若默认方案不适合用户，可切换备选方案；
- 衣物摩擦和轻敲能辨认材质与动作，雨声连续播放没有明显接缝；
- 原版和候选可以立即切换，采用后可以撤回；
- 没有爆音、突然断音、明显音量跳变或重复应用音量与淡入淡出。

---

## Task 1：修复基线并建立统一验证命令

**修改文件**

- `apps/web/package.json`
- `apps/web/src/lib/asmr/director-presets.test.ts`
- `apps/web/src/lib/asmr/project-library.test.ts`

**步骤**

1. 先运行并保存现状证据：

```powershell
cd D:\CodexWorkplace\asmr_director\apps\web
npm.cmd run test
.\node_modules\.bin\tsc.cmd --noEmit
```

预期：184 个现有测试通过；TypeScript 报出 8 个仅位于测试代码的联合类型缩窄错误。

2. 修改两份测试，让查找 clip 的 helper 明确返回 voice clip，或在断言前使用 `clip.type === "voice"` 缩窄。不得用 `as any` 跳过检查。

3. 在 `apps/web/package.json` 增加：

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "verify": "npm run test && npm run typecheck && npm run lint && npm run build -- --webpack"
  }
}
```

4. 运行 `npm.cmd run verify`，确认测试、类型、lint、webpack build 全部通过。

5. 提交：

```powershell
git add apps/web/package.json apps/web/src/lib/asmr/director-presets.test.ts apps/web/src/lib/asmr/project-library.test.ts
git commit -m "test: establish audio quality verification baseline"
```

---

## Task 2：加入可重现的空间动作项目结构

**修改文件**

- `apps/web/src/lib/asmr/schema.ts`
- `apps/web/src/lib/asmr/schema.test.ts`
- `apps/web/src/lib/asmr/generation-fingerprint.ts`
- `apps/web/src/lib/asmr/generation-fingerprint.test.ts`
- `apps/web/src/lib/asmr/project-persistence.ts`
- `apps/web/src/lib/asmr/project-persistence.test.ts`
- `apps/web/src/lib/asmr/mock-project.ts`

**先写失败测试**

1. 在 `schema.test.ts` 增加以下行为测试：

- 旧项目没有 `spatial_motion` 和 `spatial_profile_id` 时仍可导入；
- clip 可以保存 `horizontal_orbit` 与 `left_right_vertical_orbit`；
- `direction` 只允许 `forward` / `reverse`；
- `start_offset >= 0`、`duration > 0`、`cycles > 0`；
- 空间动作不能超过 clip 时长；
- 项目可以保存默认 `spatial_profile_id`。

2. 在 fingerprint 测试中证明：改变路径、方向、时长、圈数或 profile 后，旧 mix 必须标记为需重混。

**实现结构**

在 `schema.ts` 增加：

```ts
export const SpatialPathSchema = z.enum([
  "horizontal_orbit",
  "front_back_vertical_orbit",
  "left_right_vertical_orbit",
  "left_horizontal",
  "right_horizontal",
  "left_vertical",
  "right_vertical",
]);

export const SpatialMotionSchema = z.object({
  path: SpatialPathSchema,
  direction: z.enum(["forward", "reverse"]),
  start_offset: z.number().nonnegative(),
  duration: z.number().positive(),
  cycles: z.number().positive(),
  profile_id: z.string().min(1),
});
```

给 `ClipBaseSchema` 增加可选的 `spatial_motion`，给 `timeline.mixing` 增加可选的 `spatial_profile_id`。第一轮 UI 只暴露两条路径，但项目结构一次支持已确认的全部路径，避免第二轮再迁移 JSON。

3. 在项目校验中检查 `start_offset + duration <= clip.duration`。

4. 运行目标测试，然后运行 `npm.cmd run verify`。

5. 提交：

```powershell
git add apps/web/src/lib/asmr/schema.ts apps/web/src/lib/asmr/schema.test.ts apps/web/src/lib/asmr/generation-fingerprint.ts apps/web/src/lib/asmr/generation-fingerprint.test.ts apps/web/src/lib/asmr/project-persistence.ts apps/web/src/lib/asmr/project-persistence.test.ts apps/web/src/lib/asmr/mock-project.ts
git commit -m "feat: persist reproducible spatial director actions"
```

---

## Task 3：建立候选、来源和授权记录

**新增文件**

- `apps/web/src/lib/asmr/audio-candidate.ts`
- `apps/web/src/lib/asmr/audio-candidate.test.ts`
- `apps/web/src/lib/asmr/local-candidate-store.ts`
- `apps/web/src/lib/asmr/local-candidate-store.test.ts`
- `apps/web/src/app/api/audio-candidates/route.ts`
- `apps/web/src/app/api/audio-candidates/route.test.ts`
- `apps/web/src/app/api/assets/candidate/[candidateId]/route.ts`

**修改文件**

- `apps/web/src/lib/asmr/local-runtime-config.ts`
- `apps/web/src/lib/asmr/local-runtime-config.test.ts`
- `.gitignore`

**先写失败测试**

覆盖以下规则：

- 候选来源只能是 `free_asset`、`local_ai`、`procedural`、`voice_regeneration`、`spatial_preview`；
- 每个候选记录 project ID、clip ID、原资产 ID、provider、版本、seed、真实 WAV 信息、动作、创建时间和状态；
- `free_asset` 缺少来源页面或许可证时不能进入 `ready` 状态；
- 候选文件写入候选目录，不能覆盖 `assets/clips/app` 中的原资产；
- 只允许读取安全 candidate ID，阻止目录穿越；
- 每个 clip 最多保留 12 个未采用候选，清理时不能删除已采用或仍被引用的文件。

**实现结构**

```ts
export type AudioCandidateSource =
  | "free_asset"
  | "local_ai"
  | "procedural"
  | "voice_regeneration"
  | "spatial_preview";

export type CandidateStatus =
  | "generating"
  | "ready"
  | "failed"
  | "accepted"
  | "rejected";
```

`AudioCandidate` 使用 Zod schema 持久化到 `audio-quality-v1/candidates/manifest.json`。API 第一轮只提供：

- `GET /api/audio-candidates?projectId=...&clipId=...`：读取当前 clip 候选；
- `POST /api/audio-candidates`：由已注册 provider 创建候选；
- `GET /api/assets/candidate/<id>`：播放候选 WAV。

采用动作在 Task 9 实现：人声/SFX 采用时复制为正式 `asset://clip/...`；空间候选采用时只写 `spatial_motion`。

3. 运行目标测试和 `npm.cmd run verify`。

4. 提交：

```powershell
git add .gitignore apps/web/src/lib/asmr/audio-candidate.ts apps/web/src/lib/asmr/audio-candidate.test.ts apps/web/src/lib/asmr/local-candidate-store.ts apps/web/src/lib/asmr/local-candidate-store.test.ts apps/web/src/lib/asmr/local-runtime-config.ts apps/web/src/lib/asmr/local-runtime-config.test.ts apps/web/src/app/api/audio-candidates/route.ts apps/web/src/app/api/audio-candidates/route.test.ts apps/web/src/app/api/assets/candidate/[candidateId]/route.ts
git commit -m "feat: add non-destructive audio candidate catalog"
```

---

## Task 4：统一 48 kHz 干声处理，修复重复音量与淡入淡出

**新增文件**

- `apps/web/src/lib/asmr/pcm-audio.ts`
- `apps/web/src/lib/asmr/pcm-audio.test.ts`

**修改文件**

- `apps/web/src/lib/asmr/procedural-audio.ts`
- `apps/web/src/lib/asmr/procedural-audio.test.ts`
- `apps/web/src/lib/asmr/project-mix-renderer.ts`
- `apps/web/src/lib/asmr/project-mix-renderer.test.ts`
- `apps/web/src/lib/asmr/local-clip-generation.ts`
- `apps/web/src/lib/asmr/local-clip-generation.test.ts`

**先写失败测试**

- 32 kHz mono、44.1 kHz stereo 和 48 kHz WAV 都能转为 48 kHz stereo float；
- 真实 stereo 输入不会被折叠成 mono；
- 程序合成生成的是干声，不预先应用 clip 的 `volume_db`、`fade_in`、`fade_out`、pan 或距离；
- 项目混音只应用一次 gain 和 fade；
- 输出真实时长来自 WAV，而不是盲信 clip 声明；
- NaN、空 WAV、不支持的声道数与严重削波被明确拒绝。

**实现**

1. 把 WAV 读取、线性重采样、mono 到 stereo 扩展、PCM16 stereo 写入集中到 `pcm-audio.ts`。
2. 将 `project-mix-renderer.ts` 的默认采样率从 32000 改为 48000。
3. 从 `procedural-audio.ts` 移除 clip gain 和 fade；这些参数只在预览/混音阶段应用。
4. `saveClipAsset` 前读取生成 WAV 的真实格式与时长，并将真实值写入 candidate/asset metadata。
5. 运行目标测试与 `npm.cmd run verify`。

6. 提交：

```powershell
git add apps/web/src/lib/asmr/pcm-audio.ts apps/web/src/lib/asmr/pcm-audio.test.ts apps/web/src/lib/asmr/procedural-audio.ts apps/web/src/lib/asmr/procedural-audio.test.ts apps/web/src/lib/asmr/project-mix-renderer.ts apps/web/src/lib/asmr/project-mix-renderer.test.ts apps/web/src/lib/asmr/local-clip-generation.ts apps/web/src/lib/asmr/local-clip-generation.test.ts
git commit -m "fix: normalize dry audio before spatial mixing"
```

---

## Task 5：搭建本地空间运行时并验证方向

**新增文件**

- `tools/audio-runtime/pyproject.toml`
- `tools/audio-runtime/src/asmr_audio_runtime/__init__.py`
- `tools/audio-runtime/src/asmr_audio_runtime/cli.py`
- `tools/audio-runtime/src/asmr_audio_runtime/spatial.py`
- `tools/audio-runtime/tests/test_spatial.py`
- `apps/web/src/lib/asmr/spatial-trajectory.ts`
- `apps/web/src/lib/asmr/spatial-trajectory.test.ts`
- `apps/web/src/lib/asmr/local-spatial-provider.ts`
- `apps/web/src/lib/asmr/local-spatial-provider.test.ts`
- `apps/web/src/app/api/audio-candidates/spatial/route.ts`
- `apps/web/src/app/api/audio-candidates/spatial/route.test.ts`

**修改文件**

- `apps/web/src/lib/asmr/local-runtime-config.ts`
- `docs/THIRD_PARTY_RUNTIMES.md`

**运行时安装与授权检查**

1. 在 D 盘独立建立 Python 3.11 环境，安装 `numpy`、`scipy`、`h5py`、`soundfile`。仓库的 `pyproject.toml` 锁定直接依赖版本；实际虚拟环境位于 runtime 目录。
2. 从 SOFA 官方 Viking 目录先下载 `subj_A`、`subj_J`、`subj_T` 3 个 profile 到 runtime，记录原始 URL、文件 hash、CC-BY 4.0、作者/数据集署名和下载日期。三者只是首轮试听集合，不预设哪个一定最好。
3. 默认 profile 不能只按编号拍脑袋决定。用同一个短测试音生成上、下、前、后、左、右六个方向，试听后在配置中固定默认 profile；另外两个作为备选。

**先写失败测试**

- `horizontal_orbit` 正向路径为前→右→后→左→前，反向顺序相反；
- `left_right_vertical_orbit` 正向路径为左→上→右→下→左；
- 路径在循环接缝处连续；
- `cycles / duration` 决定速度，不保存互相冲突的第三个速度值；
- 更近、更远同时改变直达声/反射声比例和高频，不只是统一 gain；
- 水平环绕合成测试中，左右耳到达时间和能量随路径改变；
- 垂直路径各段使用不同 HRTF，不退化为左右声像移动；
- 每个处理块交叉淡化，块边界不出现大于阈值的单样本跳变。

**实现**

1. `spatial-trajectory.ts` 只负责把产品路径、方向、时长和圈数转换为连续的方位角/仰角采样点。
2. Python `spatial.py` 负责：读取 SOFA、选择最近测量点并在相邻点间平滑、分块卷积、距离滤波、少量早期反射、48 kHz stereo 输出。
3. `local-spatial-provider.ts` 使用 `spawn` 参数数组调用 CLI，不拼接 shell 字符串；设置超时、退出码、stderr 限制和临时文件清理。
4. 空间预览写入 `spatial_preview` 候选，不修改项目。
5. 先运行 Python 测试，再运行 Web 目标测试和 `npm.cmd run verify`。

**人工门槛**

使用同一个干声，戴耳机依次试听：近、远、水平正向、水平反向、左—上—右—下。若水平路径无法判断方向或垂直路径只像左右摆动，Task 5 不得标为完成。

6. 提交：

```powershell
git add tools/audio-runtime apps/web/src/lib/asmr/spatial-trajectory.ts apps/web/src/lib/asmr/spatial-trajectory.test.ts apps/web/src/lib/asmr/local-spatial-provider.ts apps/web/src/lib/asmr/local-spatial-provider.test.ts apps/web/src/lib/asmr/local-runtime-config.ts apps/web/src/app/api/audio-candidates/spatial/route.ts apps/web/src/app/api/audio-candidates/spatial/route.test.ts docs/THIRD_PARTY_RUNTIMES.md
git commit -m "feat: render binaural director movement locally"
```

---

## Task 6：验证并接入本地 AI 音效候选

**新增文件**

- `tools/audio-runtime/src/asmr_audio_runtime/sfx.py`
- `tools/audio-runtime/tests/test_sfx_contract.py`
- `apps/web/src/lib/asmr/local-sfx-provider.ts`
- `apps/web/src/lib/asmr/local-sfx-provider.test.ts`
- `apps/web/src/app/api/audio-candidates/sfx/route.ts`
- `apps/web/src/app/api/audio-candidates/sfx/route.test.ts`
- `docs/audio-quality/round1-sfx-evaluation.zh.md`

**修改文件**

- `apps/web/src/lib/asmr/local-runtime-config.ts`
- `docs/THIRD_PARTY_RUNTIMES.md`

**安装前置条件**

Stable Audio 3 Small-SFX 的模型文件需要在 Hugging Face 页面接受模型条款，并受 Stability AI Community License 与所含组件条款约束。未接受条款时停止下载，不绕过门禁。

**固定测试提示词**

模型只使用英文提示词；界面中文类别映射到版本化 prompt：

```text
cloth: close-miked soft cotton cloth rubbing slowly, dry studio recording, gentle ASMR texture, no speech, no music
tapping: close-miked fingertip tapping slowly on unfinished wood, soft ASMR, dry studio recording, no speech, no music
rain: steady gentle rain outside a bedroom window at night, soft distant droplets, seamless ambience, no thunder, no speech, no music
```

每类固定生成 3 个 seed、8 秒候选，记录生成时间、峰值、采样率、声道、模型版本与 seed。

**先写失败测试**

- 中文类别只能映射到白名单英文 prompt，不允许任意 shell 参数；
- provider 输出必须是可读取 WAV，并转换到统一格式；
- 模型失败、超时或内存不足时返回明确错误，不自动把基础合成标成 AI；
- 同一 seed 与配置摘要可以重现调用记录；
- 三类输出都保存为候选，不直接替换 clip。

**本机质量门槛**

- 至少衣物摩擦或轻敲中的一类，3 个候选里有 1 个能清楚辨认材质和动作；
- 雨声至少有 1 个候选可以通过循环处理形成无明显接缝的 30 秒试听；
- 若三类全部未通过，provider 保留为实验记录但不进入产品来源选择，第一轮继续使用免费素材与基础合成，且“本地 AI”显示为不可用而不是伪成功。

3. 更新 `docs/THIRD_PARTY_RUNTIMES.md`，记录代码版本、模型 ID、模型/组件条款、runtime 路径和不随仓库分发的边界。
4. 运行 Python 测试、Web 目标测试和 `npm.cmd run verify`。

5. 提交：

```powershell
git add tools/audio-runtime/src/asmr_audio_runtime/sfx.py tools/audio-runtime/tests/test_sfx_contract.py apps/web/src/lib/asmr/local-sfx-provider.ts apps/web/src/lib/asmr/local-sfx-provider.test.ts apps/web/src/lib/asmr/local-runtime-config.ts apps/web/src/app/api/audio-candidates/sfx/route.ts apps/web/src/app/api/audio-candidates/sfx/route.test.ts docs/audio-quality/round1-sfx-evaluation.zh.md docs/THIRD_PARTY_RUNTIMES.md
git commit -m "feat: add evaluated local sfx candidates"
```

---

## Task 7：建立免费授权素材目录

**新增文件**

- `apps/web/src/lib/asmr/licensed-audio-asset.ts`
- `apps/web/src/lib/asmr/licensed-audio-asset.test.ts`
- `apps/web/src/lib/asmr/licensed-asset-store.ts`
- `apps/web/src/lib/asmr/licensed-asset-store.test.ts`
- `apps/web/src/app/api/audio-candidates/library/route.ts`
- `apps/web/src/app/api/audio-candidates/library/route.test.ts`
- `docs/audio-quality/FREE_ASSET_ACQUISITION.zh.md`

**先写失败测试**

- 导入项必须有 title、作者、原始页面、下载页面、license 名称、license URL、是否需署名、是否允许再分发和 SHA-256；
- 只接受第一轮白名单中的 CC0 或 CC-BY 资产；
- 缺许可证、来源链接或 hash 的文件不能出现在正式候选中；
- 不允许再分发的文件可以本机试听，但不能复制到仓库或导出包；
- 同一 hash 不重复导入；
- 导入后转换为统一格式，但保留原文件和原授权记录。

**素材取得流程**

1. 每类先取得 2 个可用资产：衣物摩擦 2 个、轻敲 2 个、雨声 2 个。
2. 只从明确显示单项许可证和作者的页面下载；逐项保存网页地址和授权信息。
3. 将文件放入 runtime 的 `licensed-assets/<category>`，不提交 WAV。
4. 在 `FREE_ASSET_ACQUISITION.zh.md` 记录可复查的取得步骤、筛选条件和署名输出格式，不记录登录 token。

**实现**

`GET /api/audio-candidates/library` 按 category 返回可用素材；选择某素材时创建 `free_asset` 候选。许可证不完整时 API 返回 422 和具体缺失字段。

5. 运行目标测试和 `npm.cmd run verify`。

6. 提交：

```powershell
git add apps/web/src/lib/asmr/licensed-audio-asset.ts apps/web/src/lib/asmr/licensed-audio-asset.test.ts apps/web/src/lib/asmr/licensed-asset-store.ts apps/web/src/lib/asmr/licensed-asset-store.test.ts apps/web/src/app/api/audio-candidates/library/route.ts apps/web/src/app/api/audio-candidates/library/route.test.ts docs/audio-quality/FREE_ASSET_ACQUISITION.zh.md
git commit -m "feat: add licensed local sfx library"
```

---

## Task 8：验证真正的“更柔”人声并接入通过者

**新增文件**

- `tools/audio-runtime/src/asmr_audio_runtime/voice.py`
- `tools/audio-runtime/tests/test_voice_contract.py`
- `apps/web/src/lib/asmr/voice-director-provider.ts`
- `apps/web/src/lib/asmr/voice-director-provider.test.ts`
- `apps/web/src/app/api/audio-candidates/voice/route.ts`
- `apps/web/src/app/api/audio-candidates/voice/route.test.ts`
- `docs/audio-quality/round1-voice-evaluation.zh.md`

**修改文件**

- `apps/web/src/lib/asmr/gpt-sovits-provider.ts`
- `apps/web/src/lib/asmr/gpt-sovits-provider.test.ts`
- `apps/web/src/lib/asmr/local-runtime-config.ts`
- `docs/THIRD_PARTY_RUNTIMES.md`

**固定测试文本**

```text
别着急，慢慢呼吸，我会一直在这里陪着你。
```

**比较方式**

1. 使用同一授权 voice pack 和固定文本，先生成 GPT-SoVITS 普通版与当前可控的柔和版。
2. 在 D 盘安装 Fun-CosyVoice3-0.5B-2512，使用同一参考音频，分别生成普通版与带柔和近讲指令的版本。
3. 每个 provider 至少生成 3 组配对候选；先把响度匹配到相近范围，再做随机顺序试听，避免把“小声”误判为“更柔”。
4. 记录自然度、是否更轻柔、咬字、杂音、耗时和显存情况。

**先写失败测试**

- `soft` 动作必须调用人声重生成 provider，不能退回仅修改 `volume_db`；
- 请求记录 provider、模型、seed、参考 voice pack、文本和动作；
- provider 未通过试听时返回 `unsupported_action`，界面不得显示成功；
- 输出候选不覆盖原 voice asset；
- 采用后可以恢复原 asset；
- 参考音频缺少授权元数据时拒绝生成。

**通过门槛**

在响度匹配的 A/B 对比中，至少一个 provider 的柔和版在 3 组里有 2 组被稳定判断为更轻、更柔，同时没有明显降低可懂度。GPT-SoVITS 若不通过，可以继续保留普通 TTS；CosyVoice 3 若通过则成为 `soft` 动作 provider。两者都不通过时，产品明确显示“当前声音不支持更柔”，Task 8 保持未完成并继续评估免费本地 provider，不能改回假动作。

5. 更新第三方运行时记录，运行 Python 测试、Web 目标测试和 `npm.cmd run verify`。

6. 提交：

```powershell
git add tools/audio-runtime/src/asmr_audio_runtime/voice.py tools/audio-runtime/tests/test_voice_contract.py apps/web/src/lib/asmr/voice-director-provider.ts apps/web/src/lib/asmr/voice-director-provider.test.ts apps/web/src/app/api/audio-candidates/voice/route.ts apps/web/src/app/api/audio-candidates/voice/route.test.ts apps/web/src/lib/asmr/gpt-sovits-provider.ts apps/web/src/lib/asmr/gpt-sovits-provider.test.ts apps/web/src/lib/asmr/local-runtime-config.ts docs/audio-quality/round1-voice-evaluation.zh.md docs/THIRD_PARTY_RUNTIMES.md
git commit -m "feat: regenerate audibly softer voice candidates"
```

---

## Task 9：实现 A/B 比较、采用、撤回和重混

**新增文件**

- `apps/web/src/lib/asmr/candidate-acceptance.ts`
- `apps/web/src/lib/asmr/candidate-acceptance.test.ts`
- `apps/web/src/app/api/audio-candidates/[candidateId]/accept/route.ts`
- `apps/web/src/app/api/audio-candidates/[candidateId]/accept/route.test.ts`
- `apps/web/src/components/studio/audio-candidate-panel.tsx`
- `apps/web/src/components/studio/audio-candidate-panel.test.tsx`
- `apps/web/src/components/studio/spatial-director-panel.tsx`
- `apps/web/src/components/studio/spatial-director-panel.test.tsx`

**修改文件**

- `apps/web/src/components/studio/clip-inspector.tsx`
- `apps/web/src/components/studio/studio-app.tsx`
- `apps/web/src/lib/asmr/project-library.ts`
- `apps/web/src/lib/asmr/project-library.test.ts`
- `apps/web/src/lib/asmr/playback-asset-resolver.ts`
- `apps/web/src/lib/asmr/playback-asset-resolver.test.ts`

**先写失败测试**

- 原版、多个候选只能有一个正在播放，切换时停止前一个；
- 候选显示来源标签：免费素材、本地 AI、基础合成、人声重生成、空间处理；
- 免费素材显示许可证/署名入口；
- 采用人声或 SFX 候选时，复制为新的正式 clip asset，并在采用前创建安全版本；
- 采用空间候选时不替换原 asset，只把 `spatial_motion` 写回 clip；
- 撤回恢复原 asset 或原空间设置；
- 采用或撤回后 mix 标为需重混；
- 界面显示由 `cycles / duration` 得出的速度；调整速度时只反算时长或圈数，不保存第三个互相冲突的值；
- 失败不会清空 clip，也不会写入半完成空间设置；
- 窄屏下候选卡可纵向排列且没有横向溢出。

**界面结构**

`ClipInspector` 只保留字段编辑和入口；复杂的新流程拆到两个独立面板：

- `AudioCandidatePanel`：来源选择、生成状态、原版/候选试听、采用、放弃；
- `SpatialDirectorPanel`：更近、更远、完整水平环绕、左—上—右—下，方向、开始时间、时长、圈数、默认/备选 profile。

“更柔”按钮只在 voice provider 通过并可用时生成候选；否则显示具体不可用原因。程序合成始终写成“基础合成”。

3. 运行组件测试、目标测试和 `npm.cmd run verify`。

4. 提交：

```powershell
git add apps/web/src/lib/asmr/candidate-acceptance.ts apps/web/src/lib/asmr/candidate-acceptance.test.ts apps/web/src/app/api/audio-candidates/[candidateId]/accept/route.ts apps/web/src/app/api/audio-candidates/[candidateId]/accept/route.test.ts apps/web/src/components/studio/audio-candidate-panel.tsx apps/web/src/components/studio/audio-candidate-panel.test.tsx apps/web/src/components/studio/spatial-director-panel.tsx apps/web/src/components/studio/spatial-director-panel.test.tsx apps/web/src/components/studio/clip-inspector.tsx apps/web/src/components/studio/studio-app.tsx apps/web/src/lib/asmr/project-library.ts apps/web/src/lib/asmr/project-library.test.ts apps/web/src/lib/asmr/playback-asset-resolver.ts apps/web/src/lib/asmr/playback-asset-resolver.test.ts
git commit -m "feat: compare and accept audio quality candidates"
```

---

## Task 10：把空间动作应用到真实项目混音

**修改文件**

- `apps/web/src/lib/asmr/project-mix-renderer.ts`
- `apps/web/src/lib/asmr/project-mix-renderer.test.ts`
- `apps/web/src/lib/asmr/local-project-mix-generation.ts`
- `apps/web/src/lib/asmr/local-project-mix-generation.test.ts`
- `apps/web/src/lib/asmr/product-quality.ts`
- `apps/web/src/lib/asmr/product-quality.test.ts`

**先写失败测试**

- 没有 `spatial_motion` 的旧 clip 继续使用现有静态 position 逻辑；
- 有 `spatial_motion` 的 clip 先取干声，再调用空间运行时，之后只应用一次 timeline gain/fade；
- 真实 stereo/binaural 源按保留策略处理，不无条件折叠 mono；
- 空间运行时失败时 mix 失败并说明 clip ID，不悄悄回退成普通 pan；
- 空间设置改变后旧 mix 一定过期；
- 质量检查显示 48 kHz、双声道、削波、空间动作数量与失败原因。

**实现**

1. 在单 clip 混入输出前增加可注入的 `renderSpatialAudio` 接口，测试使用内存 fake，生产使用 Task 5 provider。
2. 预览缓存与最终 mix 共用同一空间实现和 profile 版本，避免“预览一个效果、导出另一个效果”。
3. 不允许空间失败静默退回旧 pan；用户可以显式移除空间动作后再重混。
4. 运行目标测试和 `npm.cmd run verify`。

5. 提交：

```powershell
git add apps/web/src/lib/asmr/project-mix-renderer.ts apps/web/src/lib/asmr/project-mix-renderer.test.ts apps/web/src/lib/asmr/local-project-mix-generation.ts apps/web/src/lib/asmr/local-project-mix-generation.test.ts apps/web/src/lib/asmr/product-quality.ts apps/web/src/lib/asmr/product-quality.test.ts
git commit -m "feat: apply accepted spatial actions to project mix"
```

---

## Task 11：第一轮真实样片与浏览器验收

**新增文件**

- `docs/audio-quality/round1-acceptance.zh.md`

**修改文件**

- `docs/ROADMAP.md`
- `docs/AI_HANDOFF.md`
- `docs/STATUS.zh.md`

**自动验收**

```powershell
cd D:\CodexWorkplace\asmr_director\apps\web
npm.cmd run verify
```

再运行 Python 运行时测试：

```powershell
cd D:\CodexWorkplace\asmr_director
D:\CodexWorkplace\asmr_director_runtime\audio-quality-v1\.venv\Scripts\python.exe -m pytest tools\audio-runtime\tests
```

**浏览器验收**

1. 启动本地运行时与 Web 应用。
2. 桌面宽度和 390px 宽度各走一次：选择 clip、生成候选、原版/候选切换、采用、撤回、重混、播放项目 mix。
3. 检查浏览器 console 没有 error/warning，接口失败时界面保留原音频并显示原因。

**耳机试听清单**

固定保存以下可比较结果到 runtime 的 `evaluation` 目录：

- 人声：普通版、响度匹配后的“更柔”版；
- 同一干声：原版、更近、更远；
- 同一干声：水平正向、水平反向；
- 同一干声：左—上—右—下；
- 衣物摩擦：免费素材、本地 AI、基础合成；
- 轻敲：免费素材、本地 AI、基础合成；
- 雨声：免费素材、本地 AI、基础合成，并连续播放 30 秒检查接缝。

在 `round1-acceptance.zh.md` 逐项记录“通过 / 不通过 / 选择的默认结果”和具体听感。没有用户试听结论时，文档状态只能是“待试听”，不能写“第一轮完成”。

**最终提交**

```powershell
git add docs/audio-quality/round1-acceptance.zh.md docs/ROADMAP.md docs/AI_HANDOFF.md docs/STATUS.zh.md
git commit -m "docs: record round one audio quality acceptance"
```

## 实施时的停止条件

以下情况出现时，停止对应能力，不用假结果绕过：

- 模型许可证或参考声音授权不清楚；
- 模型必须付费才能继续；
- 本机持续内存不足且 CPU 路径也不可用；
- “更柔”只有音量差；
- 垂直环绕只剩左右摆动；
- 免费素材缺少可复查的单项许可证；
- 新处理覆盖了原始资产；
- 自动检查通过但实际试听不通过。

停止某个 provider 不等于停止整条主线：可以继续比较免费素材、另一个免费本地 provider、基础合成和已通过的空间处理，但界面必须诚实显示哪些来源当前不可用。

## 实施完成后的第二轮入口

第一轮实际试听通过后，另写第二轮计划，再扩展：停顿、左右耳、前后垂直环绕、左右单侧水平/垂直运动、全部正反向与速度控制、剩余 5 类音效、完整默认/备选空间方案。第一轮未通过的能力先修正，不进入数量扩张。

## 选型依据（实施时重新核对版本与条款）

- Stable Audio 3 官方代码与 Small-SFX 说明：`https://github.com/Stability-AI/stable-audio-3`
- Stable Audio 3 Small-SFX 模型页与条款入口：`https://huggingface.co/stabilityai/stable-audio-3-small-sfx`
- Stability AI Community License：`https://stability.ai/license`
- CosyVoice 官方代码与调用示例：`https://github.com/FunAudioLLM/CosyVoice`
- Fun-CosyVoice3-0.5B-2512 模型页：`https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512`
- Viking HRTF 官方 SOFA 数据目录：`https://sofacoustics.org/data/database/viking/`
- Freesound API 条款（说明为何第一轮不把其免费 API 当作产品默认依赖）：`https://freesound.org/docs/api/terms_of_use.html`
