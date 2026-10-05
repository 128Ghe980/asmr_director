# 参考原话识别与GPU初始化失败诊断

日期：2026-10-05。路线：既有「人声导演与真实ASMR音效质量V1」，父阶段仍进行中。
本次实现与识别验收完成；原15秒参考的生成恢复仍未确认。不恢复用户暂停的SFX
模型试验，不新增路线或提交推送。

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
