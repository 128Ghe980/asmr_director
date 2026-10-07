# 候选「重新识别」

日期：2026-10-07

用户要求在采用、放弃旁加入重新识别。继前文语气词与内部自然停顿修复，重新检查历史原音应通过产品入口产生可比较的新候选，而不是重新生成语音或覆盖旧记录。

契约见 [中文 spec](../superpowers/specs/2026-10-07-candidate-recognition-recheck.zh.md) / [English spec](../superpowers/specs/2026-10-07-candidate-recognition-recheck.md)。证据目录：`I:/AI/asmr-director-candidate-recheck/2026-10-07`。

## 行为

- 同一按钮行增加重新识别、识别中进度及取消，另存结果供试听/采用，原候选与工程采用状态保留。
- 仅支持有长文计划与精确原音关联的候选；旧单句模式没有 candidate→trace 素材绑定，不能按同文或最近录音猜测来源。
- API 核对工程/片段/ready/台词与后文指纹，逐组精确定位已有完整源，串行离线 ASR 后按原停顿/响度配方组装，不调 TTS。
- 内容或边界仍无法确认可保留完整原音成为新 review 候选；运行致命错误、取消、超时不替换候选。旧参考、种子、声音选项及用户数据不变。
- 项目/片段切换与卸载会取消请求，忽略迟到结果；重检使用既有原生互斥。

## 验证

8 个定向文件共 136 项通过：后端/API/store 47 项，UI 与既有参考/切换/批量回归 89 项。测试夹具缺少 voice 类型收窄导致首轮 TypeScript 失败，添加真实 guard 后相关测试、最终完整 TypeScript 与相关 ESLint 通过。红绿及最终日志位于证据目录；重复测试不累计为新项。

生产构建 40.58 秒通过，峰值进程树 RSS 1,755,570,176 字节，未触发 240 秒/512MiB 守卫。仅 I 盘 cache junction，产物在原生 D 盘 `.next-candidate-recheck-production`，共享 `tsconfig.json` / `next-env.d.ts` 字节已恢复。核对旧服务无原生任务后，只替换正式 3001；当前 Node PID25096，BUILD_ID `fC1Y4z7etgCJEEIReA6ty`，owned terminal88196。已有 SWC Win32 加载警告继续走 WASM 回退，构建正常；未启动 Qwen。

真实页面先验证取消：候选仍是原 30.4 秒，显示「重新识别中… / 取消识别」；Python22300 已实际启动并观测到约3.57GB RSS，点击取消后进程及运行锁退出，页面恢复按钮并显示原候选保留。`cancelled-ui-asr-watchdog.json` 的 completed 仅表示观察到进程退出，不代表 ASR 检查通过。独立 `preservation-after-real-ui-cancel.json` / `after-cancel-manifest-attestation.json` 确认 57 条候选的 manifest 原字节与备份一致，154素材、489历史原音及参考/空间/Qwen 全部无增删改，原生进程、运行/manifest/import 锁与 scratch 均清空。

再次从同一原候选点击，真实离线 ASR 成功。新候选 `vox_1596288fdf3d4a0aacba093b50074519` 来自 `vox_7bdb2a8f903c4f27881210ca6f85a695`，新 trace `ccd9a388-052b-47eb-8724-b0da2c4a8ccd`；目标 5.05 秒（源0.52–5.57秒）、checkStatus passed、stage complete、100%文字一致、内部自然停顿1420ms，qualityWarnings为空。Python17168 峰值RSS3,861,262,336字节；外部观察77.3秒包含启动前等待和退出后8秒确认，不作为精确模型时长；浏览器约1分钟观察到结果，未触发守卫。实际运行仅ASR，无TTS/文本API。

`candidate-preservation-after-real-ui-success.json` 确认旧57候选深值/状态/顺序保持，仅追加1候选、2明确WAV及唯一新trace的7个文件；源WAV/JSON逐字节复制原c695，历史489原音和旧素材除允许改写manifest外SHA保持。现156素材、496原音文件、58候选，参考/profile、11uploads、3backups、25空间源、1111Qwen工件、59模型元数据及H盘MP3均保持。无原生任务、锁、ASR scratch或7863–7866监听。

实际页面候选5→6，新结果前置、旧30.4秒候选为2；未采用或放弃任何候选。刷新仍保留，手动重新选择第10段后标题、50项DOM输入值、20段时间线及参考声音normal_zh与基线完全相同；过期候选的重检禁用并给原因。桌面截图 `recheck-final.png`，390×844截图 `recheck-mobile.png`：三按钮同排、页面宽390无横溢出。此次窄屏截图正常，不沿用前次截图提供方缩放的限制结论。viewport恢复1768×1252，console error/warn为空；详见 `browser-verification.json`。

固定路线仍是音质 V1 进行中，SFX 暂停；用户本轮未要求提交或推送。其他会话的空间音场/Qwen 工作树改动保留。
