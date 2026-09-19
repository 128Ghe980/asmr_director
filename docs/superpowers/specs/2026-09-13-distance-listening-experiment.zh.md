# ASMR 距离感试听实验

日期：2026-09-13。状态：离线对比样片与技术检查完成；等待用户耳机听感，不代表空间方案已获验收或已接入工作台。

## 授权与范围

用户讨论 Cetera、双耳时间差/声级差和距离感后，接受“固定一句温柔人声与刷声，比较贴耳、面前、远处、靠近，以及整体响度匹配版本”的建议，并回复“行，就按你的来”。本实验属于现有“人声导演与真实 ASMR 音效质量 V1”，不新增顶层路线阶段。

主线混音器仍使用原有声像与距离音量处理。本轮只新增 `tools/distance-listening/` 离线实验；没有更改工作台、工程存储、候选采用逻辑、旧脏工作树，也没有新跑 TTS 或付费 API。

## 试听成品

- 目录：`D:/CodexWorkplace/asmr_director_runtime/distance-listening/2026-09-13`。
- 页面：`index.html`；本机服务：`http://127.0.0.1:8767/`，仅绑定回环地址。也支持保留 `audio/` 相邻目录后直接打开本地页面。
- 共 80 个 48 kHz / stereo / PCM24 WAV：2 种素材 × 4 种处理 × 5 个场景（4 分段＋串听）× 2 种响度模式。
- 人声串听 29.5 秒，刷声串听 47.2 秒；顺序为左耳旁、面前、远处、逐渐靠近。分段之间有 0.6 秒间隔。
- 默认选择人声／完整串听／自然音量／D 房间版，不自动播放。切换处理或响度保留位置，切换素材或场景从头开始，任意时刻仅一段播放；章节可跳转，WAV 可下载。

## 固定素材与授权

人声复用 `I:/AI/voxcpm2-evaluation/runs/restricted-softer-g2-soft_refonly-seed7202-gpu0/output.wav`，48 kHz mono，4.96 秒。台词为“枕头的位置舒服吗？如果不合适，我再轻轻帮你调整。”这是用户于 2026-07-30 在该组中选过的温柔版本；生成参数及历史结果仍在原 `result.json` 和试听记录中。没有再生人声。

刷声为 BenDrain 的 [Paint_Brush_06.wav](https://freesound.org/people/BenDrain/sounds/488027/)，CC0 1.0。使用无需登录的公开 HQ MP3 预览，**不是原始 WAV**；8.5 秒，48 kHz，预览的左右通道逐样本完全相同，因此明确取一声道。原录音约 99.5% 的频谱能量落在 40 Hz 以下，会使峰值占用大量余量；本轮所有刷声版本共用一次 40 Hz 二阶高通预处理。未将合成噪声冒充真实刷声。原始文件和来源 JSON 在输出 `sources/` 中。

HRTF 使用 Viking Dataset v2 的 A 耳型：Spagnol、Miccini、Unnthorsson，2020，CC BY 4.0，[DOI 10.5281/zenodo.4160401](https://doi.org/10.5281/zenodo.4160401)。本地文件为 `audio-quality-v1/hrtf/viking/subj_A.sofa`；1513 方位 × 2 耳 × 128 taps，48 kHz，**仅实测 1 米**。SOFA 数据的左耳在 +y、右耳在 −y，耳位距头心 0.076 米，Data.Delay 为零。

所有版本共享相同源数组；只做共同的采样率归一、上述刷声高通、12 ms 首尾包络和源响度准备。源文件与准备后的 WAV 哈希均保存在 manifest，原文件保持不变。

## 四种算法与实验控制

| 版本 | 处理 |
| --- | --- |
| A | 等功率 pan＋距离增益，作为现有方式的基准 |
| B | 实测 1 米 HRIR，保留双耳时间与频谱线索；仍使用同一距离增益 |
| C | B＋刚性球头模型 DVF 幅度补偿，转换为 512 taps 最小相位 FIR |
| D | C＋按六面墙镜像声源计算的首阶反射＋短扩散尾声 |

方位采用 x 前、y 左、z 上。左耳旁距头心 0.14 米（球模型耳旁约 6.4 cm），面前 0.65 米，远处正前方 2.5 米。靠近段在左侧 90°固定方向，源重复两次并隔 0.3 秒，沿平滑距离轨迹从 2.5 米靠近到 0.14 米。

四种方法共用柔和的距离增益曲线，锚点沿用产品的 `1.12 / 1.0 / 0.82 / 0.62 / 0.35`，以对数距离插值。这是制作上的响度曲线，不是校准 SPL 或真实自由场 1/r。运动用 33 个位置的完整滤波输出交叉淡化，不做多普勒或公共传播延迟。

HRIR 只用一个跨方向、跨双耳的共同校准系数。DVF 根据 Duda & Martens（1998）刚性球解析声压方程 Eq.7–8 独立实现稳定 Hankel 递推，以目标距离和实测参考距离的归一化声压幅度比构造补偿；不重复 1/r 或增加左右起始延迟。实验正则化为 1/6 倍频程平滑和设计幅度 ±12 dB。最小相位 EQ 仍有频率相关群延时。

房间为 6×6×2.7 米，听者在 `[2,2,1.2]`。反射使用相应入射方向的 HRIR、相对传播延迟及 `r/L` 路径比，幅度反射系数 0.55，并加入 RT60 0.28 秒的确定性合成短尾。它不是实测 BRIR，也不是完整房间声学求解器。

自然模式对每种素材的整组输出施加一个共同余量系数，不使用 limiter。匹配模式对每个静态片段施加同一个左右声道共同增益：人声目标 −25 LUFS；刷声因保留瞬态及 −2 dBTP 余量，目标约 −27.79 LUFS。靠近段只匹配整段，保留段内响度运动；匹配串听直接拼接已匹配片段。因此它可以排除静态片段的整体响度差，不能独立证明靠近运动来自非响度线索。

## 技术验证

- 13 项数值测试通过：刚性球解与独立 SciPy 球 Bessel/Hankel 原式比较、零频闭式解、参考距离恒等、左右对称、近距低频 ILD 趋势、60 组参数有限/无尖峰、FIR 频响、运动连续性和完整尾部保留。
- 本次几何参数下，125 Hz 的额外 ILD 在 1 / 0.7 / 0.3 / 0.14 米约为 0 / 0.85 / 4.72 / 13.42 dB。这是模型输出，不是用户感知测量。
- 80 个文件的独立解码、格式、SHA256、有限数值和削波检查通过；4×过采样估计的最大 true peak 约 −2.00 dBTP，响度匹配最大误差 0.059 LU，匹配前后 ILD 变化小于 0.000001 dB。
- 房间脉冲响应的直达/反射能量比分别约 36.47 / 14.12 / 4.33 dB（耳旁／面前／远处），确认方向趋势正确。
- 浏览器验收覆盖真实播放、切换保时、暂停保留、单段播放、章节跳转、80 个资产元数据、下载哈希、本地 file://播放，以及 1280px／390px 无横向溢出；截图在输出目录。
- 普通 Python 文件服务不支持 WAV 跳转所需的 byte ranges，已增加本地专用 `serve.py`；HTTP 206 范围响应实测通过。

证据：输出目录中的 `manifest.json`、`verification.json`、`browser-verification.json`、`desktop.png`、`mobile.png`；复现命令见 `tools/distance-listening/README.md`。

## 边界与下一步

首轮未做个体 HRTF 选择、耳廓视差、声源嘴部指向性、头部跟踪或实测近场/房间采集。通用 A 耳型的外部化和距离感可能因人而异。后续用户评价加入房间“确实不错”、D“还行”，属于初步正面反馈，不能写成全部空间方案验收。获授权的新改进另见 `2026-09-14-distance-algorithm-refinements.zh.md` 及英文版；空间处理正式接入和真实 SFX 全类别扩展仍未完成。

建议反馈先聚焦：B/C 在“左耳旁＋匹配响度”下是否有自然的贴耳差异；C/D 在面前、远处是否更容易听出房间距离；靠近段有无不自然音色或过渡。

## 原始资料

- Duda & Martens（1998）：[Range dependence of the response of a spherical head model](https://doi.org/10.1121/1.423886)。
- Brungart & Rabinowitz（1999）：[Auditory localization of nearby sources. Head-related transfer functions](https://pubmed.ncbi.nlm.nih.gov/10489704/)。
- Spagnol 等（2017）：[Distance rendering and perception of nearby virtual sound sources with a near-field filter model](https://research.unipd.it/handle/11577/3199763)。
- Cuevas-Rodríguez 等（2019）：[3D Tune-In Toolkit](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0211899)。本轮未复制该项目源码。
