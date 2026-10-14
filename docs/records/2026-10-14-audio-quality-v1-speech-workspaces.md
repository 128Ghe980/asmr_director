# 双生成工作区与无对白分镜

日期：2026-10-14（HKT）。固定路线：人声导演与真实 ASMR 音效质量 V1，仍进行中；真实 SFX 仍暂停。本项实现、独立预览验收与用户授权后的原址 3001 部署已完成。没有提交或推送。

## 用户契约

保留现有「短分句 + 长生成取前部」及原有 `clip` 方式，在采用 AI 创意时同步创建「短句 / 整段」两页。两页共享源文，音频、候选、采用、撤回、时序、分镜和混音结果分别保存。新模式只生成整段 A，再严格切成源文短句；单句改文后，下一次整段生成重做所属组并重新检查切点。新增没有语音但可生成分镜的镜头，并精简界面、截图验收。

曾经覆盖原工作流的全局切换原型已回滚。不要恢复 `prepareParagraphGroups` 或 `speech_group_id` 破坏性分组。开发前完整源码基线、已有未提交改动 patch 和 448 文件 SHA 清单位于 `I:/AI/asmr-director-dual-workspace/2026-10-14/baseline`；不得以 Git HEAD 广泛重置共享工作树。

契约见 [中文规格](../specs/2026-10-14-speech-workspaces.zh.md) 与 [English specification](../specs/2026-10-14-speech-workspaces.en.md)。

## 实现

- 可选 `speechWorkspace` 保持旧工程兼容。两套结果库与当前顶层视图互相投影；切页不切句、不调用模型、不清除已有结果。AI 文案采用时创建两套库，旧工程首次打开整段页才初始化。
- 文案双向同步，旧音频保留并显示待更新；短句只标记变动单位，整段标记所属组。自然句界处理局部改词、跨句重写、清空后逐字输入及缩短合句，避免按比例切开词语。被移除的旧 ID 可从受保护修订恢复。
- 候选容量、列表、原音分页和采用/撤回按模式独立。整段检查全通过后原子发布/采用全部短句；旧候选首次进入两页后仍可撤回。
- 后台语音与混音按启动模式归并；另一页的等待时间编辑和撤回不取消无关任务。源文撤回保留不规则旧间隔与后来生成的音频，布局撤回作用于发起页；旧混音仍保留试听，源文变化及静默类型进入必要的混音过期核对。
- 无对白镜头共享描述和时长，支持插入、移动、撤回与分镜，跳过所有语音入口。预览保留静默时间，H3 不绑定对白或语音素材。两页分镜结果分别保存，迟到响应不写入另一页。
- 左侧常用操作精简为分页、台词、无对白、生成音频、生成分镜；重生成和段落操作收进菜单。分镜说明默认折叠，整段音频面板隐藏重复的单句文本。

关键源码：`speech-workspace.ts`、`candidate-acceptance.ts`、`project-library.ts`、`studio-app.tsx`、`paragraph-script-list.tsx`、`script-editor-panel.tsx`、`voice-generation-panel.tsx`、整段生成/切分、候选存储与无对白分镜相关模块。开发前的预览、排序、拼音识别、网络/OOM 提示和空间工作台改动保留。

## 验证

最终稳定源码全量 `vitest run --maxWorkers=2 --testTimeout=10000`：130 文件通过、2 文件跳过，1573 测试通过、3 测试跳过。先前高并发时旧识别 fixture 超过测试框架 5 秒上限；限制测试并发和设置 10 秒测试框架上限后全量通过，没有放宽生产分析超时或安全阈值。最后的隔离/撤回/指纹关联检查另有 137 项通过，存在重复，不相加。

完整 TypeScript、全部 `src` ESLint、`git diff --check` 与 WASM/Webpack 正式构建通过。最终 build ID：`b7EJ1P7lo170x7hgEd20l`，输出 `.next-dual-production` 经 NTFS junction 指向 `C:/Users/Yuki1/.codex/tmp/asmr-dual-production-20261014`；没有在几乎满的 D 盘写构建缓存或清理用户文件。

浏览器实际核对两页改文同步、旧 `long_text` 选项保留、对话中间插入无对白镜头、分镜按钮不要求语音、原工程副本 4/4 → 整段 0/4 → 短句 4/4。桌面与真正 390px 视口截图已检查，页面宽度等于视口宽度，无页面横向溢出；时间线自身可横向滚动。

证据根目录：`I:/AI/asmr-director-dual-workspace/2026-10-14/qa`。日志：`vitest-final-stable.log`、`final-isolation-checks.log`、`eslint-final.log`、`build-final.log`。截图：`release-desktop-paragraph.jpg`、`release-original-short-preserved.jpg`、`release-mobile-paragraph.jpg`、`release-mobile-silent-storyboard.jpg`。最终保护与服务快照为 `final-receipt.json`。

原工程 `asmr_20261008_134758`（长语音试听·普通女生）通过产品导出备份，4 条已采用 WAV 逐字节 SHA 保持；预览副本 WAV 与原文件 SHA 一致，原候选 manifest 未改写。

本轮没有新增 TTS、ASR 推理或分镜模型调用，不宣称新的音质试听或实际视频生成验收。沿用已保存的 21.92 秒 / 80 汉字 / 4 句真实 WAV 切分证据：三个切点严格双侧检查通过，全部源 PCM 连续重拼一致。切分器、分析适配、Python 检查器、provider、profile 加载器和配置六文件与该成功探针逐字节相同，见 `paragraph-engine-source-audit.json`。较早失败探针仍保留。

## 服务、权限与续接

早先自动审批在创建命令进程前拒绝了停止 PID23520 的 3001 旧服务并启动新版的操作，仅返回 `blocked by policy`，没有给具体原因。该命令未执行，当时旧服务保持运行。用户随后明确回复「允许更新3001」；没有将时间经过或预选项视为同意，也没有绕过审批。

此前最终新版在隔离3005预览，快照 PID2248 / 父 PID23072。使用 `qa/start-isolated-preview.ps1`，运行数据单独位于 `preview-runtime`。仅复制选中原工程的 4 条 WAV、4 条候选和 profile；模型及参考音频仍引用原文件，预览上传修改自己的 profile，不改原 profile。这样新段落候选不写入旧版本的 manifest。3003 开发服务及早期测试服务均已停止，文件和日志保留。这些 PID 是历史快照；本次恢复时 3005 已无监听。

获准后于15:10 HKT鲜读进程、监听和模型任务：3001/3005均无监听，没有原生语音任务，因此未停止任何进程。通过 `qa/start-production.ps1 -Port 3001` 在 `http://127.0.0.1:3001/` 启动已验收正式构建，使用正式原运行数据及段落专用修正 CLI，原 `clip / long_text` 仍使用原 profile CLI；没有合并隔离预览数据。当前快照监听 PID17232，启动器15664，build `b7EJ1P7lo170x7hgEd20l`。HTTP200及HTML构建标识、GPT-SoVITS/VoxCPM2目录可用和原 `long_text` 可用通过；模式筛选接口返回原工程短句4条候选、整段0条，四份原WAV与原manifest SHA和备份完全一致。独立只读代理复核通过，0新增模型调用。部署与保护收据：`qa/production-3001-deployment.json`、`qa/production-3001-protection.json`，新服务日志由部署收据引用。未来操作先核对实际PID。

浏览器URL安全策略拒绝本轮重新绑定3001页面（错误声称协议不允许，尽管请求为HTTP）；没有改用其他浏览器或接口绕过。因此本轮没有刷新/再次导出浏览器工程，也没有重拍3001截图，界面验收沿用相同最终构建此前桌面及390px截图。用户可刷新已有3001页面加载新版。服务与数据接口验证通过不等于本轮重新执行浏览器端工程验收。

同步：新增双语契约与本记录，更新固定路线验收进度、交接和历史；父阶段继续进行中，SFX 暂停，不新增顶层路线，不提交或推送混合工作树。
