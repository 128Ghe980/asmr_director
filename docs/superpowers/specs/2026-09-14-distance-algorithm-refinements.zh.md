# 距离感算法调研与 D 改进对照

日期：2026-09-14。范围：已批准的音质 V1 离线试听，不新增顶层路线步骤。

## 用户方向

用户认为加入房间“确实不错”，D“还行”，属于初步正面反馈，不能扩写为全部空间方案验收。用户随后澄清想了解类似 Cetera／HRTF／DVF 之外的算法，并授权改进此前建议的房间与贴耳几何／声源朝向。本轮不做另一个建议中的耳型选择。

## 其他算法路线

这些方法处理的层次不同，可以组合，并非全部替换 HRTF。

| 路线 | 对 ASMR 的价值与限制 | 原始资料 |
| --- | --- | --- |
| 实测 BRIR 卷积 | 保留真实房间与双耳响应；任意移动需要多位置／朝向数据和插值。BRIR 已含直达声 HRTF，不能无区别再卷积一次 HRTF。 | [BRT 听者模型](https://grupodiana.github.io/BRT-Documentation/library/listener-models/) |
| ISM＋FDN／SDN | 镜像源计算早反射，FDN 产生密集尾响，SDN 把网络与房间几何关联。BRT SDN 支持长方体、方向声源和九频带墙面吸收；普通 FDN 不自动等于 SDN。 | [SDN 2015 论文](https://arxiv.org/abs/1502.05751)、[BRT SDN](https://grupodiana.github.io/BRT-Documentation/library/environment-models/sdn-environment-model/) |
| 参数化房间重建 | Paraspax 从一条实测单声道 RIR 提取直达／早反射并空间化，外推 BRIR；方向仍需几何、预设分布或额外输入，单声道 RIR 不能唯一恢复房间。实现以 MATLAB 为主。 | [Paraspax](https://github.com/facebookresearch/Paraspax)、[2021 论文](https://doi.org/10.17743/jaes.2021.0009) |
| 几何传播／绕射 | 适合隔门、拐角、遮挡与不规则房间；需要几何和材质，不能替代几厘米贴耳的近场耳部模型。 | [Steam Audio](https://github.com/ValveSoftware/steam-audio)、[RoomAcoustiCpp](https://github.com/IoSR-Surrey/RoomAcoustiCpp) |
| 神经双耳渲染 | 单声道＋说话者／听者位姿，学习生成双耳音频。WarpNet 使用时间变换与渲染，BinauralGrad 使用两阶段扩散，BinauralFlow 使用流匹配与因果流式模型。普通语音论文不证明耳语、刷子、厘米级贴耳适用。 | [Neural Binaural Speech Synthesis](https://github.com/facebookresearch/BinauralSpeechSynthesis)、[BinauralGrad 论文](https://arxiv.org/abs/2205.14807)、[BinauralFlow ICML 2025](https://proceedings.mlr.press/v267/liang25k.html) |
| Ambisonics＋双耳解码 | 多声源、头部跟踪和可旋转声场有用；不是从单声道找回真实距离的算法。 | [IEM 插件](https://plugins.iem.at/docs/plugindescriptions/) |

工程建议：保留近场直达声，以实测 BRIR 作参考，优先完善可控的几何房间层。神经模型独立试听。BinauralGrad 的[官方 README](https://raw.githubusercontent.com/microsoft/NeuralSpeech/master/BinauralGrad/README.md) 给出代码、两阶段权重和缩短片段减少显存的说明；原配对数据集与 Meta WarpNet 代码有非商业限制，公开代码不等于模型、数据、产品应用全部获许可。BinauralFlow 有[作者试听](https://liangsusan-git.github.io/project/binauralflow/)，本次未确认公开代码、可下载权重或模型许可；本轮未安装或运行神经模型。

## 已实现的对照结构

原 `2026-09-13` 成品及 8767 端口保留。新输出为 `I:/AI/asmr-director-distance-listening/2026-09-14`，端口 8768。最初生成遇到 D 盘空间耗尽，仅将本轮未完成的新目录转移至 I 盘重新生成，没有删除旧素材。

- D：原房间算法，按新场景重新渲染。
- E：D 的直达声，房间换成二阶 ISM（6 条一阶＋18 条二阶反射）、各墙不同的反射系数／低通预设，以及八延迟线 Householder FDN。反馈有高频阻尼，低频 RT60 设计值为 0.24 秒。它是合成混合模型，非 SDN、实测房间或精确波动求解器。
- F：保持 D 的房间结构，增加逐耳测量球视差、起始延时对齐的 HRIR 插值、头中心方向延时恢复及原方向 DVF。人声朝向分别作用于两耳的直达辐射角和每条反射的初始辐射角，并影响尾声能量；刷声不套嘴部模型。
- G：E 的房间＋F 的声源处理。

两种相同干声，五个场景加串听，两种响度模式，共 96 个 PCM24 双声道 WAV。耳旁／面前／远处保留原静态几何。靠近改为左前方 45°、2.5 米到 14 厘米；新增距离固定 35 厘米、转开 110°再转回的人声。刷声的转头段保持不变，作为控制。运动使用 41 个完整卷积输出交叉淡化关键点，不模拟多普勒。

全部方法及直达／早反射／尾响共用相同的插值保护延时。D 与旧静态 WAV 的区别仅为此延时、整组峰值余量增益及 PCM 舍入；跨成品检查验证这点。原始素材及处理后干声 SHA256 对照旧实验。响度匹配每个静态段只用一个双耳共同增益；靠近／转头按整段匹配，保留内部响度运动与左右差。

## 近似边界

视差与延时分离参考 [3D Tune-In 2019](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0211899) 结构，独立编写代码。起点按 HRIR 峰值的 15% 估计，按实测仰角环连续插值，非已验证的个体耳型。频谱相位仍可能改变波形峰值。Viking A 的最低实测仰角是 −45°，不伪造下半球数据；反射仍沿用最近实测方向查找。

人声指向性是明确的近似：低频近全向，高频使用向前的余弦辐射图，1 kHz 单极点过渡。FIR 系数非负且和为一，因此全频幅度不大于一。它不是当前说话人的实测嘴部／耳语方向性。墙面和 FDN 参数为试听预设，未经真实房间拟合；FDN 尾声随反射总能量变化，但详细空间纹理不按逐墙路径重建。

本轮不修改产品混音器、工程存储、Timeline DSL 或旧工作树，不新增 TTS／付费生成，不宣称头部跟踪、个体化、校准绝对距离或听感赢家。

## 验证

27 项数值测试、全部 96 个解码音频及哈希通过；4 倍过采样真峰值估计最高 −2.1000 dBTP，静态响度匹配最大误差 0.09761 LU，匹配后左右声级差变化低于 0.000001 dB。跨成品 D 回归通过：去除保护延时后人声逐样本相同，刷声仅有 0.988553 的共同增益及小于 1.2e−7 的 PCM 舍入残差。转头后早反射不能由单一音量缩放解释，旧／新房间的最佳标量拟合相对残差分别为 0.291／0.303；刷声转头控制逐样本相同。

真实 Edge 验收通过播放、方法／响度切换保时、暂停状态、全部五个章节跳转、96 个音频元数据、下载哈希及 file:// 播放。已查看 1280px 桌面和 390px 手机截图，无横向溢出或控制台错误。证据为新目录的 `verification.json`、`refinement-verification.json`、`browser-verification.json`、`desktop.png`、`mobile.png`；复现命令见工具 README。新版本的听感取舍仍待用户判断。
