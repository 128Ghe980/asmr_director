# 参考原话识别与GPU初始化失败诊断

日期：2026-10-05。路线：既有「人声导演与真实ASMR音效质量V1」，父阶段仍进行中。
本次实现与识别验收完成；原15秒参考的生成恢复仍未确认。不恢复用户暂停的SFX
模型试验，不新增路线或提交推送。

## 2026-10-06 追加 — 单行参考栏与浏览器工程差异

后续用户已授权记录/推送及会话交接；以下“UI未提交”为当时验收快照，由
[参考栏发布记录](2026-10-06-audio-quality-v1-reference-toolbar-release.md)覆盖。
旧PID10268在发布前检查已停止，恢复与最新运行状态见该记录和外部发布收据。

用户指出缩窄后的选择、管理、试听仍各占一排，要求紧凑排布并截图自查。现将
144×32px选择框、240×32px播放器及添加/刷新置于单个工具栏，正常桌面仅32px高；
移除独占空间的片段时长标题，原生时间显示、悬浮说明及可访问文本保留。表单仍
在栏下展开，单个Importer实例、识别取消/响应保护、试听互斥和换源清理保持。
390px验收发现第三排后，追加按面板560px容器断点换序：选择/管理在上，试听在下，
最终330px栏宽仅72px高、页面无横向溢出。默认2025×1252桌面截图为一行，恢复了
临时视口；添加展开/关闭及最终14秒实际播放通过，结束已暂停。

工程差异由代码确认：工程库、独立策划草稿和声音选择存在各浏览器localStorage，
Chrome与内置浏览器同地址也各自保存；没有服务端工程自动同步。当前工程可导出
JSON，在另一浏览器导入；不包含整个项目库、独立草稿/版本库或音频文件。同服务
的素材引用可继续取用，同ID导入沿用既有安全版本。README已补充这个边界。

现有2文件76项回归、2文件ESLint与最终Webpack正式构建/TypeScript通过；没有新增
CSS镜像测试，也未导入工程、上传参考、调用识别/TTS或采用候选。标题、22台词、
timeline与参考选择保持，reload后的第四段已恢复。150素材、10参考/profile关联、
11上传文件、3备份、25另项空间源文件及原MP3全部保持，tsconfig完整字节恢复。
最终原origin **3001/PID10268/`.next-reference-audio-production`/BUILD_ID
`7kOAx2s2ugVKdKslbLLEY`**，旧39024及中间43924在无任务/锁核对后停止；无原生
任务/锁/ASR临时目录，3000/3002无监听。重启沿用下方参数与此dist。
证据根 `I:/AI/asmr-director-reference-toolbar/2026-10-06`：不可覆写before.json、
browser-before/final/mobile-refined、reference-toolbar-final.jpg和mobile-refined.jpg、
expanded截图、final-play-start/end、测试/lint/build-refined与preservation/runtime-post-change。
UI追加仍未提交推送，发布基础5d01621；音质V1进行中、SFX暂停与空间另项均保持。

## 较早的2026-10-06追加 — 参考预览收紧

用户反馈参考声音/参考片段预览占位太大。仅调整声音面板布局：选择框176×32px，
标签同行；已保存参考播放器从当前默认视口的629.36×36px缩为240×32px，时长与
播放器同行，可自然换行且无固定最小宽度。其他候选/当前人声/完整原音播放器仍为
原全宽36px；添加表单、参考内容、播放/重试逻辑、生成参数保持。

现有面板45项回归、单文件ESLint和正式Webpack构建（含TypeScript）通过，没有新增
映射CSS的单元测试。原3001实际查看/参考播放完成14秒、最终暂停；默认1768×1252
视口无页面横向溢出，声音选择/标题/22台词/timeline逐项保持。刷新重置选段后用UI
恢复用户原第四段，未采用/放弃候选或调用模型；本轮未覆盖新的窄屏/拖动进度验收。
构建自动加入的两条include已验证后恢复完整tsconfig字节，另项空间改动保持。

当时正式服务 **3001/PID39024/`.next-reference-audio-production`/BUILD_ID
`DWe9wtTIhIx0gtYdYllnY`**，旧PID32132已按身份与无任务/锁核对后停止；3000/3002
无监听、无原生任务/锁/ASR临时目录。150素材、10参考/profile关联、11上传存储、
3备份、25空间源文件与原MP3保持；5参考目录/defaultsoft_zh及原15秒预览HTTP200。
重启沿用下方环境参数，当前应设置 `ASMR_NEXT_DIST_DIR=.next-reference-audio-production`。

证据根 `I:/AI/asmr-director-reference-preview-compact/2026-10-06`：`before.json`、
`browser-before.json`/`browser-after.json`、`reference-preview-compact.jpg`、测试/lint/
build日志、`preservation-post-change.json`/`runtime-post-change.json`及最终核验。
本轮UI追加未提交推送，Git基础为已推送 `5d01621`；原ASR/TTS验收不重复执行，
原15秒恢复限制和SFX暂停保持。下方运行状态属于此前识别交付快照。

## 用户请求与已确认的故障

用户询问添加参考时“留空时使用仅参考音频”是否指生成方式，要求选择语言后直接
识别选段原话，显示供人工校对修改，并报告用新参考生成时“VoxCPM2生成失败”。
“仅参考音频”是参考使用模式，与“生成方式”中的当前范围/长文连续生成分别选择；
识别可选，保存仍由用户显式操作。

22:20实际日志确认正太音15秒16kmonoPCM16 WAV已成功读取，随后低显存参考编码
创建cuBLAS失败，`CUBLAS_STATUS_NOT_INITIALIZED`，退出3221226505。不是缺原话或
WAV格式错误；日志本身不能证明显存耗尽。provider新增503 GPU初始化分类和中文
可操作提示，不自动换seed、重试、切CPU或裁短已选参考。原生内部日志不传给UI。
CLI n-gpu-layers0仅控制BaseLM，自定义AudioVAE等仍可用GPU；只有--cpu切全部。

一次独立8秒参考+“你回来了。”原生诊断，外部180秒硬时限，13.922秒成功退出。
输出1.44秒/48kmonoPCM16/69120frames，SHA
`3646112b6a63e5622d5380134aee5521eebb6d2553ded8d9d34500c9923d6b64`。
原15秒标准WAV与profile SHA保持，没有工程候选发布/采用；原15秒恢复未验证。
新上传默认8秒，保留1–30秒选取与3–8秒建议，不能把导入上限解释为硬件可生成保证。

## 识别工作流

界面已增加中文/英语/日语/韩语、所选片段识别、可编辑结果、取消及超时；原话、
文件、语言或区间改变时取消旧请求并拒绝迟到覆盖。切片后保留文字且提示核对；
新文件沿用清空行为。失败/取消不清空人工文字，识别不自动保存参考。

后端已实现：`POST /api/voice-references/transcribe` 复用安全FFmpeg标准化及已有
faster-whisper-large-v3 CPU/int8。严格文件/字段/语言/选段校验，模型离线、仓库外
临时文件、与VoxCPM2共用运行锁、180秒转换/识别总期限及5秒退出确认。
存储错误安全映射507；未确认进程退出时保留锁与临时文件，迟到退出后才清理。
无依赖安装/模型下载/云端上传。现有ASR模型及Python在gpt-sovits环境中。

原3001浏览器实际上传用户H盘MP3，选择中文与0–8秒，识别得到
“干嘛一直盯着我看有什么好看的”。发起时间15:45:58.675Z、观察完成15:46:33.858Z，
观察上界35.183秒，不当作精确模型耗时。加句号验证可手改后恢复原识别文字；
保留表单供用户试听校对，未保存/重复导入或发布工程候选。识别期间生成/刷新/保存
被禁用，结束恢复。用户此前已将《末世归途的礼物》策划稿采用成22段工程；
本轮没有采用、改写或生成这些工程段落。

## 当前验证与恢复

- 已通过生成分类2文件47项及对应ESLint；实际旧日志回归包含503/安全提示与锁退出。
- 已通过界面4文件95项，包含真实App识别/生成互斥，未重复历史全量套件。
- 后端5文件97项与Python标准库11项通过。合计11个不重复JS文件239项；
  Python mock检查单独统计，不将其当实际ASR验收。
- 全量TypeScript、本轮11个不重复代码文件ESLint、正式构建通过。测试类型修复后
  最终TypeScript再次通过；该改动仅测试类型，不重跑模型/构建。
- 后端初次2项失败为I盘慢文件系统上的20/75ms时钟夹具，改为确定性总预算与
  先启动子进程再取消，最终97项通过；保留红/绿日志。最终TS初次mock kill函数
  类型错误已修正，红日志保留。构建自动增加的两条tsconfig include已移除，既有
  空间include保持，完整文件与本轮备份一致。
- 初始保护快照138素材/6参考profile/25另项空间源文件及原MP3保留核验见最终收据。

证据根 `I:/AI/asmr-director-reference-asr-repair/2026-10-05`：`before.json`、
`generation-original-diagnostic.json`、`generation-short-reference.json`及stdout/stderr、
`short-reference-output.wav`、各测试/ESLint/TypeScript/build日志、
`browser-asr-busy.txt`、`browser-asr-result.json`、`reference-asr-result.jpg`、
`preservation-receipt.json`及`runtime-receipt.json`。最新正式dist为
`.next-reference-asr-repair-production` / PID32132 / BUILD_ID `YJZx9Jfr-uExxaFCd1yr-`，
D原生目录、仅cache指向I；旧PID23144已按身份核对停止，新服务保持原origin。
最终138素材/6参考profile/25空间源文件及原MP3/GitHEAD全保持；首页/目录/原15秒
预览200，目录3参考/defaultsoft_zh、预览SHA保持。3000/3002无监听，无生成后代/
原生生成进程、三类锁或ASR临时目录。构建前 `tsconfig-before.json` 已备份。
不要重跑已完成的短参考诊断、实际识别或首次快照脚本。

重启须先核对3001进程身份与无活动生成/识别，沿用仓库既有环境配置；在
`D:/CodexWorkplace/asmr_director/apps/web` 中运行：

```powershell
$env:TEMP='I:/AI/asmr-director-reference-asr-repair/2026-10-05/tmp'
$env:TMP=$env:TEMP
$env:NODE_PATH='D:/CodexWorkplace/asmr_director/apps/web/node_modules'
$env:ASMR_NEXT_DIST_DIR='.next-reference-asr-repair-production'
$env:NODE_OPTIONS='--max-old-space-size=2048'
& 'D:/nodejs/node.exe' node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001
```

不将8秒独立生成成功解释为原15秒已经恢复或克隆音质通过。识别支持四种语言，
实际模型仅测试中文；本轮截图采用当前默认视口，未新增窄屏/播放听感验收。

契约：[中文](../superpowers/specs/2026-10-05-reference-transcription-and-generation-recovery.zh.md) /
[English](../superpowers/specs/2026-10-05-reference-transcription-and-generation-recovery.md)。
旧参考契约和README已同步识别/default8。Top-level路线仍使用唯一ROADMAP。
