# 参考栏布局发布与会话交接

日期：2026-10-06（Asia/Hong_Kong）。路线标识：既有 **人声导演与真实ASMR音效质量V1**，
以 [ROADMAP](../ROADMAP.md) 为唯一来源。参考栏实现及验收完成；父阶段仍进行中，
不新增顶层路线或替换项目现有文档体系。

用户明确要求“记录一下推一版，我要交接给其他会话了”。本次发布自 `5d01621`
之后两轮参考栏布局和浏览器工程存储说明；此前“UI未提交”是功能验收时快照，
由本次授权覆盖。实际提交SHA、推送及远端一致性由Git与外部发布收据确认，
不在随提交保存的记录中提前声称尚未发生的推送。

## 完成范围

- 参考选择144×32px，参考试听240×32px；选择、试听、添加及刷新共用一条32px
  高工具栏。面板低于560px时，选择/管理在上，试听下排。添加表单按需展开。
- 单个Importer实例、识别取消/迟到保护、播放互斥和换源清理保留。时长在原生
  播放器、悬浮说明及可访问文本中保留；其他录音的尺寸和操作保持。
- README说明Chrome与内置浏览器各自localStorage，同地址也不自动同步工程。
  工程JSON只包含当前工程及素材引用，不包含整个项目库、独立策划草稿、版本库
  或音频字节。同ID导入新增“导入前”安全版本并保留已有版本。
- 双语契约、[功能记录](2026-10-05-audio-quality-v1-reference-asr-and-gpu-recovery.md)、
  ROADMAP、[恢复入口](../AI_HANDOFF.md)与[归档](../project-archive.md)同步。

## 修改与发布范围

完整发布两个参考UI组件、参考功能记录、双语契约及本记录。README、ROADMAP、
HANDOFF与归档只暂存本次内容，空间工作台段落仍留工作树。`.gitignore`、ESLint/
TypeScript配置、项目头部、空间渲染/测试与新增spatial-studio目录/三份文档均是
另一会话工作，保留未提交。音频、模型、profile、环境、构建与I盘证据不入Git。
当前本地构建含本地空间功能；该功能没有随本版发布，新checkout不能期待音场入口。

## 验证与证据

功能验收根 `I:/AI/asmr-director-reference-toolbar/2026-10-06`：两个现有组件76项
回归、两文件ESLint和正式Webpack构建/TypeScript通过。桌面2025×1252参考栏一排
32px，390×900窄屏两排72px，无横向溢出，临时视口已恢复。添加展开/关闭、14秒
原生试听通过，结束已暂停；标题、22台词、timeline和参考选择保持。

证据包括 `tests-refined.log`、`lint-refined.log`、`build-refined.log`、
`reference-toolbar-final.jpg`、`reference-toolbar-mobile-refined.jpg`、展开截图、
对应DOM和播放起止JSON。`completion-verification.json`包含182个文档引用及保护
核验。未上传/识别/生成/采用新音频，未验证拖动进度或原15秒生成恢复。

本次发布从暂存索引取隔离源树，重新验证76项组件回归、TypeScript/ESLint、文档
引用、提交范围及另项字节；截图/正式构建沿用已保存证据，不重复模型或正式构建。
新动态素材/config保护与真实Git发布收据根
`I:/AI/asmr-director-reference-toolbar-release/2026-10-06`，基线不可覆写。
发布前150素材/10参考关联/11上传/3备份/25空间文件及原MP3保持，5参考/defaultsoft_zh。
实际后续数量以新收据为准，不能用历史快照覆盖用户新增内容。

## Git与运行恢复

分支 `codex/voxcpm2-product-generation`，远端 `origin` /
[128Ghe980/asmr_director](https://github.com/128Ghe980/asmr_director)。发布前fetch确认
HEAD与远端同为 `5d01621b4be26687bb8e85a5b02c323e7954be8a`，初始暂存为空。
只正常提交/推送，不force或改写历史。真实SHA/远端相等与保护检查见该证据根的
`release-verification.json`以及Git记录，不依赖自引用提交哈希。

交接检查发现旧PID10268已停止，先留离线基线，再恢复同一已验收原生构建
`.next-reference-audio-production` / BUILD_ID `7kOAx2s2ugVKdKslbLLEY`。
隐藏后台启动被执行策略以“blocked by policy”拒绝，现由可停止会话终端运行
**127.0.0.1:3001 / PID9716**。最新HTTP/任务/锁状态以发布收据为准。
跨会话继续时先检查监听与进程身份；终端结束后可能需要按下列参数重新启动。
不要在活动生成/识别期间重启，不清锁、不换origin，不重建或重新导入用户参考。

在 `apps/web` 执行（沿用该工作区已有环境配置）：

```powershell
$env:TEMP='I:/AI/asmr-director-reference-toolbar/2026-10-06/tmp'
$env:TMP=$env:TEMP
$env:NODE_PATH='D:/CodexWorkplace/asmr_director/apps/web/node_modules'
$env:ASMR_NEXT_DIST_DIR='.next-reference-audio-production'
$env:NODE_OPTIONS='--max-old-space-size=2048'
& 'D:/nodejs/node.exe' node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001
```

## 下一会话边界

继续 `D:/CodexWorkplace/asmr_director` 当前checkout，先读AGENT、ROADMAP、
PROJECT_MANAGEMENT、AI_HANDOFF并检查Git状态。不要全量暂存、reset或覆盖共享
文档，另项空间源码/文档仍在本地；直接换新checkout会遗漏这些工作。

原内置浏览器《末世归途的礼物》已有22段，最近截图3段采用/19段待生成，选正太音2；
这是历史检查，继续工作以当前页面为准。Chrome库独立，需要转移时选择当前工程
JSON；不要恢复旧浏览器快照。原15秒参考恢复/克隆听感未确认，8秒短句成功不能
替代听感验收。SFX模型试验按用户要求暂停；真实SFX、垂直运动与通用更柔表达
仍未完成。按用户新指令与唯一ROADMAP继续，不自动恢复模型测试或扩大到工程同步。

## English checkpoint

The user authorized publishing the compact reference toolbar and handing this checkout to
another conversation. Existing76 regressions, lint, production build/TypeScript and actual
desktop/mobile/native playback evidence are recorded. Actual commit/push results are
recorded in Git and the external release receipt. Browser project stores remain
separate; project JSON is not a full library/Planner/media backup. Unpublished spatial work
stays local. Audio Quality V1 remains in progress and SFX model tests remain paused.
