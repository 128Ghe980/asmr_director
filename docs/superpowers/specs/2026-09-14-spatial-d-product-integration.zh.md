# 原 D 空间音频正式接入

日期：2026-09-14；收尾：2026-09-20。阶段：人声导演与真实 ASMR 音效质量 V1。对应 [English version](2026-09-14-spatial-d-product-integration.md)。

## 用户决定与完成边界

用户试听 8770 的新口语人声后表示“ok，我觉得还行”，并授权把该 D 效果接入正常生成、记录和推送。**本轮正式采用原 D 作为产品空间方案。** 此前 D 优于 E/F/G 的决定继续有效；本次不加入 E/F/G。

此次已完成获采用的 D 方案及四条基准轨迹的产品接入，验证见下文。不代表音质 V1 总体、真实 ASMR SFX、垂直环绕、个人 HRTF、声源朝向或所有既往导演动作完成。2026-09-20 恢复并完成最终收尾检查。

## 产品行为与素材归属

`timeline.mixing.binaural` 控制本地**单声道人声**的 D 处理，覆盖选中片段试听、当前／已采用人声试听、完整候选试听和整段混音。关闭后，片段与候选播放原素材，整段混音保留既有普通立体声路径。非人声素材保留现有处理。长文详情里的**单个语义组试听仍播放干声**，用于直接检查生成与截取结果。

TTS 继续保存原始 `asset://clip/<assetId>` WAV。候选采用、撤回、真实时长适配和生成来源均继续引用原干声。D 音频属于可重新生成的派生缓存，不替代 TTS 素材。更改距离或运动可复用已经生成的人声，只需重新空间处理／重混。既有编辑处理仍可能取消正在进行的 TTS 请求；本次不承诺一边编辑一边不中断生成。

完整候选试听使用候选的真实原声时长，不受采用前的时间线槽位截断；采用后的片段使用当前 clip 时长。房间尾声不计入人声资产时长，也不用于顺延后面的朗读内容。已有双声道素材通过 helper 时逐字节保留，返回 `spatialized: false`，不降成单声道或再次做 D；既有混音中的双声道保留逻辑继续有效。

## 采用轨迹与旧控制映射

以下距离均指**距头中心**，不是距耳廓表面。它们是通用声学模型里的创作控制，不是针对每位听者校准的实测距离。

| 8770 基准 | 产品参数 | 路径 |
| --- | --- | --- |
| 近距环绕 | `movement: orbit`、`distance: very_close` | 0.18 米定距水平一圈 |
| 中距环绕 | `movement: orbit`、`distance: mid` | 0.8 米定距水平一圈 |
| 远距环绕 | `movement: orbit`、`distance: far` | 1.75 米定距水平一圈 |
| 环绕靠近 | `movement: orbit_approach` | 水平一圈，同时从 1.75 米靠近到 0.18 米 |

固定距离锚点为 `very_close=.18`、`close=.35`、`near=.5`、`mid=.8`、`far=1.75` 米。环绕沿左→后→右→前→左，连续角度为 90°→450°。起点固定在左侧，pan 不改变这条路线；`orbit_approach` 的远近端点也由轨迹固定。

原声至少 12 秒时，角度在开头停留 1.5 秒、结尾停留 2.5 秒，运动区间前后各 10% 平滑加减速。靠近从第 2 秒开始，在原声时长的 78% 完成，最后 22% 保持近处；半径在对数距离上平滑变化。更短片段同比缩短停留并加密时间采样，不使用固定 35 秒的原声假设。

旧控制继续可用：`static` 将 pan 映射到 `-90 × pan` 度；`left_to_right`／`right_to_left` 在选定半径沿前半圈连接 ±90°。`approach` 在选定 pan 从 1.75 米靠近到当前距离，`recede` 反向；二者若选 `far`，起终距离相同。关闭双耳空间后，运动使用既有 pan／音量渲染；环绕降为普通立体声，不声称能表达前后定位。本次不包含垂直运动。

## 音频处理合同

产品在 `apps/web/scripts/spatial_d/` 持有独立提取的原 D 实现，运行时不依赖离线试听工具。保留 Viking A 实测 HRIR、正则化刚性球 DVF、原 6×6×2.7 米合成房间、(2,2,1.2) 听者位置、六个一阶墙面反射和确定性扩散尾声。反射系数 .55、反射低通 6.5 kHz、尾声 RT60 .28 秒、扩散系数 .72 均沿用原 D。这些参数是试听配方，不是实测墙体材料属性；没有加入 E/F/G、FDN、耳间视差修正或嘴部辐射模型。

处理顺序如下：

1. 读取干声 WAV 的不可变快照，接受 32／44.1／48 kHz 并转换到 48 kHz。指定时长时只截取对应原声，不循环或补长台词。
2. 沿用已采用的原声准备：最多 12 ms 正弦平方首尾淡化，再对原声整体施加一次以 −27 LUFS 为目标的增益。短片段可仅在响度测量时补零，播放内容不因此变长；静音保持静音。
3. 用户设置的淡入／淡出在**卷积前**作用于干声，使人声淡出后房间仍能自然衰减。
4. 按所选路径渲染原 D。运动采用完整卷积输出的连续交叉淡化，保留输入历史和反射尾声；不模拟多普勒。静态渲染保留原方向查找方式。
5. 保留完整额外 **0.65 秒**房间响应，包含基准末尾 15 ms 淡化，输出 48 kHz 双声道 PCM24。仅在需要时对双耳施加同一增益，使渲染器的 4 倍过采样真峰值估计不超过 −2.1 dBTP；四条基准回归均无需这种衰减。
6. 混音器使用明确的 `spatialized` 标记，跳过 D 输出上的旧 pan、距离增益及用户淡入淡出。clip 的 `volume_db` 只在混音中施加一次。尾声可与后续片段重叠，也可使最终 WAV 长于 `project.duration`；混音资产记录实际输出时长。整段导出保持请求采样率的双声道 PCM16，通常为 48 kHz。

只要混音包含 D，就跳过旧 `target_lufs` 向上归一。分别把近／远成品抬升到各自输出目标，会抹平甚至反转配方天然的响度差；产品保留该近远差异。仅在开启主限幅且整段超过 −2.1 dBFS 时，对整段双耳施加同一衰减，不提升更小声的 D 混音。此处是**采样峰值**阈值，与 Python 的过采样估计不同。非 D 混音保留既有归一／限幅行为。离线对照中的 −25 LUFS 整段匹配版本不是产品默认的空间原声。

双耳混音 fingerprint 增加 `d-room-v1`。此前的双耳导出仍可播放／下载，但变为“需重混”；位置、时间、淡化、音量、采用素材和双耳开关继续参与混音新鲜度判断。派生缓存另对原声、HRTF 和 Python 源码的实际字节计算哈希。HRTF／运行环境覆盖属于服务端配置，变更会使空间缓存失效；已有导出 WAV 是不可变成品，仍需显式重混。

## 服务、配置与运行边界

共享服务为 `renderSpatialClip({ assetId, position, durationSeconds?, fadeInSeconds?, fadeOutSeconds?, config, signal? })`，返回 `{ wav, spatialized }`，供试听和混音共同使用。`GET /api/assets/spatial/<assetId>` 只接受 `position` JSON 和可选的 `duration`、`fadeIn`、`fadeOut`，拒绝任意文件路径、未知或重复查询参数。成功返回可按字节 Range／If-Range 跳转的 WAV，失败返回结构化 JSON。原始 clip 与已保存 mix 路由保持原有素材归属。

下表默认路径均相对 `ASMR_DIRECTOR_RUNTIME_ROOT`，本机根目录默认是 `D:/CodexWorkplace/asmr_director_runtime`。

| 环境变量 | 默认值 |
| --- | --- |
| `ASMR_SPATIAL_PYTHON` | `audio-quality-v1/.venv/Scripts/python.exe` |
| `ASMR_SPATIAL_HRTF` | `audio-quality-v1/hrtf/viking/subj_A.sofa` |
| `ASMR_SPATIAL_CACHE_ROOT` | `assets/spatial` |

Python 依赖 NumPy、SciPy、SoundFile、h5py 和 pyloudnorm。可复用本机已安装环境与 HRTF；二进制、Python 包、SOFA、生成音频都留在仓库外。本机 D 盘空间紧张，新验证产物使用 I 盘；让工作台缓存使用 I 盘时必须在启动环境里明确配置。

`ASMR_NEXT_DIST_DIR` 可选地修改 Next 构建目录，默认 `.next`；应使用 `apps/web` 内仍能解析项目 `node_modules` 的目录。它与 `ASMR_SPATIAL_CACHE_ROOT` 不同，空间缓存可以直接放另一块盘。低磁盘场景如需迁移构建缓存，只迁移构建目录的 `cache` 子目录，编译后的 server／static／类型文件仍留项目内；不支持直接将整套构建产物指向无关的外盘目录。使用示例见 `apps/web/README.md` 和 `.env.example`。

CLI 通过服务端创建的 JSON 文件和参数数组调用，`shell: false`、隐藏窗口。子进程 `TEMP`、`TMP`、`TMPDIR` 指向配置缓存卷上的本次 render 目录，其余环境继承，父进程环境不变。单次最多 600 秒，并有输入／输出字节上限和 5 分钟进程超时。每个 Node 进程同时运行一个渲染，最多排队八个；这是进程内限制，不是跨主机或分布式锁。排队的重复请求在启动子进程前再次检查成功缓存。

缓存身份包括干声 SHA256、渲染版本、全部 Python 源码字节、HRTF SHA256、位置、截取时长、淡化和准备模式。只有声道／采样率／实际时长／报告均有效的完整输出才原子发布，发布前再次确认源码和 HRTF 未变。失败或取消的半成品不进入缓存，原 clip 从不覆写。若取消在原子发布后才到达，已完整产生的缓存可以保留。

取消信号从试听请求或整段混音 bridge／API 传入渲染器。取消排队任务不会杀掉另一任务；取消运行任务或超时会终止子进程。直到确认退出才释放槽位、清理临时目录，进程异常延迟退出时也不提前释放。浏览器只按暂停不保证网络请求中止；音源释放、工程／任务取消与服务端请求中止才是相关边界。既有迟到结果检查继续保护已采用素材和混音状态；不会因晚到结果被忽略而删除已完整生成的不可变文件。

## 来源与许可

HRTF 为 **Viking HRTF Dataset v2**，Spagnol、Miccini、Unnthorsson（2020），[DOI 10.5281/zenodo.4160401](https://doi.org/10.5281/zenodo.4160401)，按原实验记录和产品渲染器 README 为 **CC BY 4.0**。A 耳型包含 1,513 个方向×双耳×128 taps、48 kHz，实测距离为 1 米。再分发数据或其改编时需保留相应署名与许可说明；本次不把 SOFA 提交进仓库。

1 米以内的距离由 DVF 模型和该通用头部参数推算，不是新增实测近场 HRTF；房间也不是个人实测 BRIR。人声／参考声音授权独立于 HRTF 许可和既有 TTS 引擎／模型条款，本记录不增加新的模型许可结论。

## 验证记录

渲染器与组件检查点：

- **26 项 Python 测试通过**，覆盖提取后的渲染器、运动、原声与输出边界。日志：`I:/AI/asmr-director-distance-listening/product-d-verification/unit-tests.txt`。
- 与 8770 四条**自然模式完整 WAV** 的回归通过：原声准备误差为 0、七组静态 IR 误差为 0，四条 35.19 秒输出的 PCM 和 WAV SHA256 均与原文件完全一致，单条耗时 6.506–7.286 秒。报告：`I:/AI/asmr-director-distance-listening/product-d-verification/regression-01/verification.json`；采用基准：`I:/AI/asmr-director-distance-listening/2026-09-14-d-colloquial-motion`。
- **16 项服务／配置／API 定向测试通过**，包括缓存失效、重复请求复用、排队／运行取消、超时后重试、缺依赖错误、损坏／不完整输出拒绝和 HTTP Range。
- 后续子进程临时目录修复增加一项回归测试，更新后的 **11 项空间服务文件测试通过**。它与前述服务／配置／API 检查点重叠，不额外累加为 11 个独立用例。
- 去除 D 向上归一后，**20 项 PCM／混音定向测试通过**。用真实 TypeScript 混音器及解码器处理 8770 近／远 WAV 的探针保留天然 RMS 差：输入近声比远声大 7.367683 dB，PCM16 导出后为 7.367684 dB，两个输出均保留 35.19 秒。探针对工程校验／clip 收集使用直接测试 getter，不等同于工作台端到端验收。报告：`I:/AI/asmr-director-distance-listening/product-d-verification/mix-natural-distance-probe.json`。
- **1 项显式启用的真实 TypeScript→Python 集成测试通过**：0.75 秒原声经用户淡化后输出 1.4 秒 PCM24 双耳音频，尾声非零，第二次请求字节一致且原素材不变。该测试使用合成信号，只证明真实执行合同，不评价人声听感。以 `ASMR_SPATIAL_REAL_TEST=1` 启用，`ASMR_SPATIAL_TEST_ROOT` 指定仓库外临时目录；普通单元测试默认跳过它。
- 服务集成检查点的定向 ESLint 和 `tsc --noEmit --incremental false` 通过，不能替代最终全仓库检查。

从仓库根目录复现：

```powershell
& 'D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/.venv/Scripts/python.exe' -B -m unittest discover -s apps/web/scripts/spatial_d -p 'test_*.py' -v
& 'D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/.venv/Scripts/python.exe' -B apps/web/scripts/spatial_d/verify.py --reference 'I:/AI/asmr-director-distance-listening/2026-09-14-d-colloquial-motion' --output '<新的仓库外证据目录>'
npm.cmd test --prefix apps/web -- --run src/lib/asmr/spatial-audio.test.ts src/lib/asmr/local-runtime-config.test.ts 'src/app/api/assets/spatial/[assetId]/route.test.ts'
```

### 真实工作台结果

`I:/AI/asmr-director-spatial-integration/2026-09-14/browser-verification.json` 报告 **passed**。本次真实调用本地 VoxCPM2，生成新候选 `vox_e6a0c0f669c3490084374081dbcda150`，干声资产 `voice_spatial_qa_20260913T224039219Z_1a33113d`，时长 4.8 秒、48 kHz。`generation-response.json` 与 `native-1789339239605.log` 记录真实新生成；原生进程退出码为 0，输出 230,400 个采样。这是新的产品生成样片，不是复用 8770 原声。

浏览器验收分为**两个阶段**。首阶段成功生成新 TTS 后，自动化因距离选择器匹配过严而中断；`workbench-resume.cjs` 使用同一个刚生成的候选恢复检查。最终报告明确写入 `nativeGenerationVerifiedInPriorPhase: 1`，恢复阶段 `nativeCalls: 0`，不将其描述成一次不中断的连续自动化。

已验证候选实际空间播放、采用／刷新／撤回／再次采用、修改距离和环绕仍保留相同干声，以及双耳开关在 D／原声音源地址间切换；这些编辑没有额外调用 TTS。真实整段混音为 **5.45 秒**，完整保留 4.8 秒原声后的 0.65 秒房间尾声。浏览器实际下载 WAV 与混音接口字节一致，已保存混音刷新后仍存在；1400px／390px 无横向溢出，报告为 `errors: []`。同目录证据包括 `adopted-project.json`、`final-project.json`、`fresh-candidate-spatial.wav`、`fresh-project-mix.wav`、`downloaded-mix.wav` 和 `mix-response.json`。

恢复边界：早期一次自动化在声音目录未就绪时误走 GPT 服务并得到 502；另一次 VoxCPM2 因 GPU 显存不足失败。C 盘满时还出现过一次空间试听 500，具体原因未确认。用户关闭浏览器、资源恢复后，同一声音 profile 成功生成。此前失败的 20.57 秒候选另外在临时目录指向 I 盘时成功渲染为 21.22 秒，记录于 `candidate-failure-probe-01`。子进程临时目录跟随缓存卷是稳健性修复，**不等于已证实那次 500 的根因**；这证明本机流程可恢复，不代表不受资源约束。

**验证边界：**本轮没有重新执行真实浏览器取消，排队／运行取消和超时由自动测试覆盖。用户采用原 D 和真实工作台成功流程均已成立，不再列为待听决定。

### 2026-09-20 最终检查与恢复

额度中断后恢复，核对保留日志：**57 个 Vitest 文件／520 项测试全部通过**，包含显式启用的真实 Python 适配器（`2026-09-14/full-tests-final.log`）。包含 TypeScript 的 Webpack 生产构建通过（`2026-09-14/build.log`）；既有 Windows 原生 SWC 警告由 WASM 回退处理。以上检查之后未改动产品音频代码。

剩余 ESLint 失败来自误扫 `.next-spatial`、`.next-spatial-build` 自动生成文件，已将这两个构建目录加入 `eslint.config.mjs` 忽略项；9 月 20 日全量 ESLint 通过（`2026-09-20/lint.log`）。独立只读复核未发现接入阻塞项，`git diff --check` 通过。

启动 `http://127.0.0.1:3001/` 的生产构建，用 9 月 14 日已真实生成的同一候选再次完成浏览器验证，**没有新增 TTS 调用**。候选／当前原声实际播放与跳转、采用／撤回／再采用、参数编辑、双耳开关、真实重混、WAV 下载字节一致、刷新恢复和 1400px／390px 排版均通过，浏览器错误为空。声音目录加载完成后重新截取桌面／手机图片并已查看。原声仍为 4.8 秒，导出仍为 5.45 秒。证据：`I:/AI/asmr-director-spatial-integration/2026-09-20/browser-verification.json`、`desktop.png`、`mobile.png`、`production-check.cjs`。

新增验证产物与临时文件放在 `I:/AI/asmr-director-spatial-integration/2026-09-20`，空间缓存使用 `I:/AI/asmr-director-spatial-cache`。没有删除或批量迁移 C／D 盘既有资产。较大的 Next cache 子目录已指向 I 盘，编译产物仍位于项目依赖旁。交付分支为 `codex/voxcpm2-product-generation`；本记录随实现与实验复现工具留档。既有路线内的音质 V1 整体保持进行中。
