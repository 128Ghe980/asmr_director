# 2026-11-02 独立 ASMR 制作与响度平衡

路线：Audio Quality V1。用户要求先记录并推送既有版本，再改进实际声音同质化、不像专门 ASMR、音量忽高忽低的问题。本轮功能、验证、本地部署及完整运行器更新包完成；真实 H3 视听质量尚未验收。新实现暂未提交推送，与先发布的旧版分开。其他暂停任务保持。

## 先发布的版本

既有 78 文件已提交并推送到 `codex/voxcpm2-product-generation`，commit `1afcc4753d3033b052434b7f276b8e060c44432d`，远端 SHA 相同。范围为此前已完成的自动强制切分、横竖画幅、空手表演、完整动作与独立起镜、项目库持久保存及记录，不含本轮新质量实现。历史 28 个范围外文件按 SHA 保护。详见 [发布记录](2026-11-02-asmr-quality-baseline-publication.md)。

## 本轮实现

新创意、改写、画面声音设计和校对共用材质与声音差异指导：明确 ASMR 放松助眠、真实接触、微小形变、可辨音色、接触起落和自然间隙。主画面继续空手对镜；独立取音视频可以拍实际材料、工具和手部。安静段不因抬手、微笑或收手被强加袖口摩擦，不能为填时长重复一次性接触。

声音新增可选 `role=trigger|ambience`。新生成明确用途，分别使用材料近录与安静环境 prompt；旧无 role 的完整 H3 prompt 保持原字节。编辑器可选择用途、显示相对响度微调，校对省略 role 时继承，撤销可回到原来的无 role 状态。用途随逐块编辑和 ZIP 导出保留。

旧链先把单声道归一到 −27 LUFS，再施加 D 距离和 API gain，合片仅防峰值，因此不是按最终用途等响。新 `AsmrDirectorBalancedSpatialAudio` 先以 gain=0 完成现有 D，再测最终声轨：主触发 replace 基准 −27 LUFS；对白 overlay 最高基准 −34，且参考主声减 10 dB；环境基准 −48，overlay 参考主声减 18 dB。模型 gain 只作有限微调，trigger −12 为中性、ambience −30 为中性。触发最高净提升 12 dB，低于 −60 LUFS 不提升；环境不高于原来源。整段左右共同乘单一增益，保留动态与空间运动，限制音效真峰值 −2.1 dBTP。

新节点名字独立，远端未更新时明确提示，不冒充成功。未修改共享人声 D 引擎，未安装新依赖或常驻服务。保留原版与增强版、历史输出和恢复状态。运行器中仅改用途/增益且 manifest prompt 和时长不变时，只重新合增强版；网页给旧声音选择新用途也会换用新版 prompt 包装，因此重导出会重新生成该音效。旧包只换程序不会自动启用新用途。早期 10 月 30 日试跑包还涉及此前独立起镜规则变化，不能笼统保证其所有主视频缓存复用。

合同：[中文](../specs/2026-11-02-asmr-sound-quality.zh.md) / [English](../specs/2026-11-02-asmr-sound-quality.en.md)。

## 实测与修正

QA 根：`I:/AI/asmr_director/qa/asmr-sound/2026-11-02-quality/`。共 15 次真实 DP 上游调用（12 次设计、3 次文案），0 新 TTS/ASR/H3，无生成音频试听，未覆盖用户工程。

- 初轮安静过场被加袖口摩擦并误判 trigger；补充“当前声音意图优先于可见手势”的规则后，后两轮都返回 ambience。刷扫初轮仍用主角色抬手/回胸解释发声；随后转为刷毛实际接触丝绸，并修正第二轮私加一遍动作的问题。
- 最终五段为棉布、刷毛与丝绸、薄纸折叠、糖纸和室内底声，role 为四 trigger、一 ambience。源响应及失败全部保留，未手改模型字段。仍有明确局限：04 双侧外扫被配置成单向声像、部分主动作措辞残留；33 材质有 cellophane/waxed-paper 二选一；不把这些标为完全音画同步通过。
- 原 90 秒 brief 首轮两响应正文相同、schema 合法，但预计 125 秒超出 72–108，系统正确拒绝。修复提示改为给出剩余台词预算、按超额删减，不再笼统要求扩写；最终纯时长失败会显示真实原因。相同 brief 重试一次成功：5 台词预计 54 秒 + 5 无台词 26 秒 = 80 秒。没有放宽时长守卫。新文案仍偏柔软接触音色、部分动作重复，多样性只能称方向改善。
- 39 项专门 Python 回归通过：23 runner + 16 音频。相同材质幅度相差 12.041 dB，在提升限额内输出均 −27 LUFS；环境 −36.91 降到 −48，−59.95 保持，−100 dB RMS 近静音保持。真实 HRTF 运动下整段单增益误差约 7.45e−9。首次等响夹具超出 12 dB 保护边界的失败保留，修夹具而非放宽上限。
- 导出到 Python 完整集成 2/2 通过：真实打包 engine/SOFA、新节点输入和方法签名绑定、D 平衡渲染、两候选禁网任务。修正过期 99 秒元数据 fixture 为 9 秒，仍验证实际 WAV 的 0.31/0.45 秒优先。既有测试 runtime 无 torch，未执行 ComfyUI 的 torch 包装；真实 DSP 核心已执行。
- 隔离候选从已验 storage release 复制，只叠加本轮 Web 范围。首轮 9 个失败来自缺候选 runner 路径及旧 50 秒单段 fixture；补 runner junction、将 fixture 改为合理独立单元，最终 385 通过、2 条完整集成在该命令条件跳过（已由上项单独实跑），lint 0 警告。

详细证据：`real-dp-review.json`、`planner-replay-review-after-fix.json`、`python-sound-tests.json`、`sound-balance-measurements.json`、`package-integration.json`、`isolated-tests-final2-result.json`。

## 部署与交付

- 完整运行器回归 153/153，通过且无跳过；与上面 23 项专门 runner 测试有重叠，不相加冒充独立数量。首次默认 GBK 读取 UTF-8 测试 payload 的两个失败留存，使用既有 Python 的 UTF-8 模式后通过，无产品改动。`runner-suite.json` 保存结果。
- 7 生产 + 8 测试 Web 文件精准叠加，15 文件 lint 零警告、完整 Webpack/TypeScript 构建通过；`release-verification.json` 核验旧 release、28 范围外文件与运行器执行依赖未变。构建后 runner README 的安装说明更新另记 SHA，不改执行代码。
- 2026-11-02 04:19 HKT，3001 启用 `.local/releases/asmr-sound-quality/apps/web`，build `62UR1pURBeVJ2uNUJxtY1`。端口原本无监听，无需停止进程；canonical startup 仅切工作目录，原脚本备份在 QA。首页、8 静态资产、7 参考目录和4条原音/处理音字节校验通过。
- 实际生产 HTTP 导出五段 DP 设计（35 秒、4 trigger +1 ambience），25 文件 ZIP 通过 CRC、源码、role/prompt 和禁网 5主+5音效 payload 核验；不向浏览器导入 QA 工程、不调用 H3。首轮检查脚本误将 inline prompt 当路径，修正检查脚本后完成，包未改写。证据 `http-export.json`、`http-package-verification.json`。
- 真实浏览器刷新保留原万圣节39段文本、20采用、39设计、20/20后处理和已保存状态。打开第2段声音用途选择，可见“沿用原音量/主要触发音 · 自动平衡/环境底声 · 保持轻柔”；旧段仍选原方式，未修改用途、内容或点模型生成。`ui-verification.json`、`ui-sound-options.png` 为实际页面证据。
- 完整更新包：`I:/AI/asmr_director/artifacts/h3-asmr/ASMR-video-runner-sound-quality-update-2026-11-02.zip`，14 项、2,848,995 字节，SHA-256 `924d89731647e3e2d06686807656a5835f3847c343d3fa4a1c70c700510ec5fa`。包含 runner、启动脚本、说明和完整音频节点（engine、SOFA、依赖与许可说明）；不含 workflow/project/settings/assets/outputs。`delivery.json` 保存逐文件 SHA 与 CRC。

目标机器关闭批跑器，将 runner.py/run.bat/README 放回项目包目录；将完整 `custom_nodes/asmr_director_audio` 更新到目标 ComfyUI 同名目录并重启，依包内 UPDATE 操作。旧工程需重新设计或显式选择用途后导出才用新方式，已有包和素材保留。不能从本轮数值测试或 DP 文本改善推定真实 H3 同质化/怪声已解决；后续重点是使用新包取音试听，双侧/多次轨迹与具体音色局限继续留档。
