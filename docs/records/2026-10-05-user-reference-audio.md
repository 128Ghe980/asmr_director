# 用户参考音频导入与“正太音”准备

日期：2026-10-05。属于现有音质 V1 工作流，父阶段仍进行中。

用户要求加入 `H:/comfyui/output/sd2素材/正太音/正太音.mp3`，并在平台不能自行
添加参考时补上该功能。原网页只有服务端预配置声音选择。现已增加 VoxCPM2 的
**添加参考音频 / 刷新参考列表**，不涉及此前暂停的模型 SFX 试验。

## 最新追加 — 原话识别与较短参考

后续已加入选择中文/英语/日语/韩语、识别选段、手工校对修改与主动保存，新上传
默认8秒并建议3–8秒。下方15秒默认/不识别/浏览器不可用是初次导入时的历史状态。
实际原3001已完成正太音前8秒中文识别，保留结果供用户核对，未重复保存已有参考；
原15秒WAV/profile保持。原生成失败定位到cuBLAS初始化，独立8秒参考生成成功，
原15秒恢复未验证。当前运行与证据以 [后续记录](2026-10-05-audio-quality-v1-reference-asr-and-gpu-recovery.md)
为准，仍不恢复SFX模型试验。

## 交付行为

- 工程 **声音 → 参考声音**，选择 VoxCPM2（可在更多生成设置中切换），上传
  MP3/WAV、填写名称、选择开始秒数和长度、试听片段并保存。默认前 15 秒，支持
  1–30 秒、源文件最多 32 MiB；短音频自动调整初始长度，后到元数据不覆盖手改长度。
- 准确参考文本可选；空白或仅标点时只开放“仅参考音频”。不自动识别或编写转录。
  成功后列表更新、立即选中并保存声音偏好；失败保留上传供重试，支持取消和 120 秒
  前端等待上限。取消恰在保存之后时可刷新目录找回，不能保证已提交项回滚。
- `POST /api/voice-references` 接收文件字节，不读取任意服务端路径。标准化为
  mono16k PCM16 WAV，核对非静音、有效 PCM 和实际完整片段时长。原上传与来源记录
  保留仓库外。`GET /api/voice-references/[referenceId]/audio` 提供试听且不暴露路径。
- FFmpeg 参数数组、隐藏窗口、固定输入格式和 file/pipe 协议、60 秒转换时限与
  5 秒退出确认边界；未确认进程退出不发布。配置跨进程串行追加、写前备份、原子替换，
  保留旧参考、默认及未知字段；已提交后的清理错误不误报保存失败。
- 导入与声音生成/混音互斥，成功及取消后的迟到响应保护有回归；导入不改工程、文案、
  已采用音频或候选。不新增 GPT-SoVITS 上传配置功能。

契约：[English](../superpowers/specs/2026-10-05-user-reference-audio.md) /
[中文](../superpowers/specs/2026-10-05-user-reference-audio.zh.md)。

## 本次真实导入

原 MP3 约 108.07 秒、1,729,147 字节、44.1k stereo。通过真实上传 API 加入
**正太音**，ID `user-c8c77e2d-0347-44bc-afcf-5a3381c848b9`，选取 **0–15 秒**，
不填转录，模式 `reference_only`。实际 WAV：16k mono PCM16、240,000 frames、
480,078 字节，峰值 0.390106201、RMS −31.744 dBFS；未额外提高音量。

- WAV：`I:/AI/asmr-director-voice-references/user-c8c77e2d-0347-44bc-afcf-5a3381c848b9/reference.wav`。
- WAV SHA256：`ec5375e88ffdaccc262771cf6ece19fe5a8ec5b73bb6f8ab0d7e45dc79dfea20`。
- 源 MP3 SHA256：`8692deea80707c90c9986a1dfe97c577394edee71bfc2baf8b78935f66bb43b2`；
  H 盘原件和完整 `source.mp3` 副本一致。
- 运行 profile：`D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/voxcpm2/profile.json`。
  旧 `soft_zh`、`normal_zh` 与默认 `soft_zh` 保持，只追加 1 条。前两条关联的
  4 份参考文件、138 份工程素材及另项 25 份空间源文件逐 SHA 保持。
- 本次 root 通过 API 导入，没有操作浏览器本地选择；用户刷新参考列表后选择
  “正太音”。网页自行添加成功后的自动选择已由 React 集成回归验证。

`apps/web/.env.local`（Git 忽略）增加 `ASMR_VOICE_REFERENCE_ROOT=I:/AI/asmr-director-voice-references`
与 `ASMR_VOICE_REFERENCE_FFMPEG=C:/Users/Yuki1/AppData/Local/Programs/Python/Python311/Scripts/ffmpeg.exe`。
保留原环境配置；原上传、标准参考、profile 及备份均不纳入 Git。

## 验证与限制

11 个不重复定向文件 / **168 项**通过：后端 5 文件49项（backend agent 最终输出），
界面 4 文件74项，既有人声生成回归2文件45项。15 个本功能文件 ESLint、全量
TypeScript 与正式 Webpack 构建通过。相关回归覆盖成功选中/刷新、失败重试/取消、
保存边界/并发、模式、生成互斥和既有批量行为；没有重复历史全量套件。

真实上传 HTTP201，生产主页/空间页/声音目录/参考 WAV 均 HTTP200，目录3项，
生产试听字节与本地标准 WAV SHA 一致。本次实际模型调用 **0**，未做参考驱动生成
或声音听感验收，不能将参考准备成功解释为克隆音质通过。1–30秒是平台资源规则，
不是模型硬上限；可选转录2000字亦不保证满足本机CLI1024-token prefill能力，
当前15秒空转录没有此长文本风险。

桌面/手机实际布局与浏览器播放**未验收**：computer-use / node runtime 初始化
失败，`failed to write kernel assets` / OS error3，重置后相同。已完成 HTTP 回读
及 React 回归，但不能替代人工浏览器检查。真实磁盘满、提交点取消、原生进程无法
停止的边界未做现场故障注入；相应失败/取消路径按测试覆盖范围处理。

首次并行界面检查发生 NativeZoneOOM；改为单 worker 的4文件74项通过。
首次把整个 build dist junction 到 I 盘导致 webpack-runtime.js 的 readlink EISDIR；
改为 **D 盘原生 dist，仅 cache junction 到 I** 后正式构建通过。旧失败日志/缓存保留。
既有 SWC Win32 警告成功使用 WASM；未更改依赖。构建自动添加的本次临时 tsconfig
include 已移除，原空间工作台的 include 保持。

证据根 `I:/AI/asmr-director-reference-import/2026-10-05`：`before.json`、
`actual-import-response.json`、`actual-import-verification.json`、`final-verification.json`、
`verify_final.mjs`、`production-process.json`，及 UI/生成回归、lint/typecheck/build 日志。
`import_actual.mjs` 是一次性导入，带旧 profile SHA 断言，**不要再次运行或重复添加**。

## 最新运行与恢复

本节以下为参考功能交付时的历史检查点。后续工程策划修复已更新到
**3001/PID23144/`.next-project-planner-repair-production`**，实际浏览器工具恢复并确认
原热汤面工程存在、项目策划切换正确；参考目录3项与试听SHA再次保持。当前重启
命令与回执见 [策划修复记录](2026-10-05-audio-quality-v1-project-planner-repair.md)。
3000/3002现无监听，以下旧PID和当时浏览器不可用状态不代表当前运行状态。

最新验证：**http://127.0.0.1:3001/ / PID36780 / `.next-reference-audio-production`**。
仅自己的临时 dev 服务在检查前停止，其他服务与用户工程未操作。完整 I 盘 dev/build
junction 留作取证，不用其作为正式生产 dist；当前 production/cache 单独指向
`I:/AI/asmr-director-reference-import/2026-10-05/production-cache`。

用户随后报告原工程“深夜回家，小安陪你吃碗热汤面”未显示。参考功能交付时主代理
误用3000，而历史正式地址是 `http://127.0.0.1:3001/`；浏览器localStorage按origin
隔离，3000不会读到3001的项目库。已把同一新版恢复至3001，主页/空间页/目录及
参考WAV均HTTP200、标准WAV哈希保持。3000/PID46872保留，正式工程应使用3001。
更新README固定入口与持久化说明。未复制、迁移或覆盖任何浏览器数据。

历史项目快照仍在 `I:/AI/asmr-director-storyboard-export/2026-10-03/current-project.json`，
名称一致，ID `asmr_planner_20260920_073729`，22人声/9分镜；这是10月3日单工程历史
备份，不替代当前浏览器最新库，未导入或回写。因浏览器工具仍OSerror3初始化失败，
只能验证原origin服务恢复，尚不能声明实际浏览器当前工程已显示。
恢复回执：`original-origin-verification.json` / `original-origin-process.json`（同一证据根）。

从 `apps/web` 的 PowerShell 启动（如端口占用，先识别所属进程，勿盲目结束）：

```powershell
$env:TEMP='I:/AI/asmr-director-reference-import/2026-10-05/tmp'
$env:TMP=$env:TEMP
$env:NODE_PATH='D:/CodexWorkplace/asmr_director/apps/web/node_modules'
$env:ASMR_NEXT_DIST_DIR='.next-reference-audio-production'
& 'D:/nodejs/node.exe' node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001
```

未提交/推送本次参考功能；已有其他会话空间工作台改动保持。音质 V1 仍进行中，
此前 SFX 模型测试暂停决定保持。

English handoff: VoxCPM2 now accepts MP3/WAV uploads with an editable 1–30s reference
interval, optional exact transcript, bounded conversion, atomic profile append and preview.
The authorized source was imported once as 正太音, first15s/reference_only. Existing
references/default/assets are preserved. 168 targeted checks, full TS, owned lint and
production build pass; actual browser layout/playback and voice synthesis acceptance remain
unverified. Production port3001/PID36780 uses a native D-drive dist with only cache on I.
An initial port3000 launch hid the existing port3001 browser project library; original origin
has been restored without copying or overwriting browser data. Historical project backup remains.
