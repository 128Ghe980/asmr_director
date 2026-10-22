# 视频批跑器改由 ComfyUI 完成媒体处理

日期：2026-10-21。Audio Quality V1进行中，SFX暂停，无新顶层路线。状态：实现、本机验证、实际导出及三文件更新包完成；未提交推送。用户远端H3及完整原生合片仍未实跑。

按用户要求，运行器本机只用Python标准库/Tk，不使用FFmpeg、ffprobe、PyAV或pip包。直接下载并保存SaveVideo成品原字节。工作流模板原文件及原指纹、RUNNER1/STATE2格式保持，运行时注入901`CLFSelectVideoTailFrames(video11,n1,x0)`、902`SaveImage`、903`ImageFromBatch`；新环境镜头加904`TrimAudioDuration(audio4,start0,duration=target_frames/24)`，在Comfy内同步限制画面及环境音≤5秒。对白仍将24原音直连11，仅将画面向上取整到24fps帧，不截原对白；原音来源不等于压缩音轨字节无损。

CLF运行在目标ComfyUI，沿用用户`I:/AI/comfy-lastframe`既有节点，不将该开发机路径写成便携运行要求。旧成功成品保持原样，不因新裁帧重跑GPU；缺PNG时提交独立`LoadVideo→CLF→SaveImage`补取任务并保存`tail_job`对账。已下载视频继续按原字节保存，N候选、种子、等待、未知提交不重发及移动目录恢复规则保留。

可选顺序合片改为目标Comfy原生视频图；用CLF路径入口实测总帧数/24，经`EmptyAudio`、`AudioMerge`、`AudioConcat`逐镜补齐音轨，再给`ConcatenateVideo.complete_audio`，只改变预览不改单镜。缺可选原生能力则预览`unavailable`，保留各镜成品；不安装其他自定义包替代。GUI撤下FF路径栏，新增日志复制全部/选中、右键与Ctrl+A/C，保留选择和滚动查看。目标主机真实H3、完整ConcatenateVideo联调及视觉交互未验收，不宣称所有版本可用。

最终97项Python全过、0跳过（主49/controls18/nativeconcat16/nativetail11/stop3）；web/package 31项、5文件全过，最后实际导出集成1项复跑不另累加，类型/lint/diff均exit0。初轮仅旧离线恢复`tail_error`断言失效，现强化为无get/download/submit后重跑97全过，旧日志保留。本机hidden Tk真实控件18项已包含在97中（剪贴板用stub，未碰用户系统剪贴板）。`native-media/verification.json`用用户真实CLF及原生方法、已有Torch/PyAV在CPU处理合成MP4：124帧裁成120，画面/音轨各5.0秒，尾帧对应裁后最后一帧，Path入口实解120帧；补轨48000/24000采样，串成72000，第二轨准确从48000开始。0外部编码exe、0H3调用、无新依赖安装；这不是远端完整合片测试。GUI独立收据在`I:/AI/asmr-director-runner-log-copy/2026-10-21/gui-verification.json`。

更新包为`I:/AI/asmr-director-native-video/2026-10-21/ASMR视频批跑器-无FFmpeg更新.zip`，32127字节，仅`runner.py`、`run.bat`、`README.zh.md`；关闭旧运行器后覆盖这三份，保留`project.json`、`workflow_api.json`、素材及整个`outputs/`。`distribution-verification.json`核对runner SHA`54cfb07…17cd`、README SHA`47e2ab3…d58ee`；原workflow SHA`2224488…f2f6`保持，不随更新包覆盖。`export-verification.json`核对实际ZIP解压后四运行文件与当前源码逐字节SHA一致，N1/N2 dry-run共9payload；新导出动态读runnerRoot，无需重建或重启3001，原PID27408未动。`final-verification.json`确认342范围外web源码保持，web仅授权集成测试变化，HEAD/index未改；无生产候选或浏览器工程存储写入、自动采用、远端H3调用、提交推送。使用说明见[README](../../tools/comfy-batch/README.zh.md)，上述收据均在本轮证据根。

## 追加停止按钮

用户追加要求界面加入“停止”按钮：将原“停止后续提交”明确改名为“停止”，操作栏移到地址下、候选设置上方常驻。点击立即显示“正在停止”并禁用按钮，停止状态优先于旧进度，worker结束后恢复。仍用原stop_event停止本机后续提交和等待，不调用Comfy全局interrupt；已提交远端任务继续，下次先对账恢复。

本次证据根`I:/AI/asmr-director-runner-stop/2026-10-21`，`final-verification.json`确认controls18+stop3共21通过、0失败/跳过，diff检查通过；未重跑上述全97/31。`tests/gui-stop-smoke.py`通过真实hidden Tk的`launch_gui`与BatchRunner stub完成两轮开始→停止→done→继续，核对row3位置、禁用与恢复，以及晚到running进度不能覆盖“正在停止”；`gui-stop-verification.json`已verified。这两轮是补充操作验证，不累计测试数量；0网络/素材文件/模型/系统剪贴板或远端interrupt操作。

最新更新包`I:/AI/asmr-director-runner-stop/2026-10-21/ASMR视频批跑器-停止按钮更新.zip`为32280字节，仅runner/run.bat/README三文件（runner SHA`228b04e…381d7`、README SHA`3001078…ba1c6c`）；关闭旧运行器后覆盖，继续保留项目/工作流/素材/outputs。原workflow SHA`2224488…f2f6`保持，新网页导出动态读最新文件，无需重启3001。上一节native-video更新包、97/31及收据保留为历史，不覆盖；本次无真实远端任务、服务重启或提交推送。
