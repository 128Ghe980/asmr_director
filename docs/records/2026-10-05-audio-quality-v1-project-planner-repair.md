# 工程切换与策划输出长度修复

日期：2026-10-05。路线：既有「人声导演与真实 ASMR 音效质量 V1」。本次缺陷修复及
指定主题验证完成，父阶段仍进行中，不新增顶层阶段或另一套路线文档。

## 问题与结果

用户新建项目后，右侧仍显示此前的策划内容；3分钟主题「深夜，在外面收集了一天
资源回家，并带回来一个精致的机械表给家里的ai机器人作为生日礼物。末世题材」
报「模型回复达到长度上限，请缩短目标时长后重试」。网络中断后按用户要求继续。

策划工作区现在按工程保存、切换和初始化。实际旧页面选中「未命名项目」时仍显示
「深夜回家，有我在」7条/486字旧稿；更新并刷新后新项目为空白，切回
「深夜回家，小安陪你吃碗热汤面」恢复其来源文案6条/645字。一次真实外部API生成
成功返回《末世归途的礼物》22条/204字；新项目刷新及往返旧项目均恢复各自文案。
结果留在当前新项目对应的策划草稿，没有点击采用、修改工程时间线或生成音频。

## 状态与模型修复

- `planner-persistence.ts` 将草稿保存到
  `ai-asmr-studio:v1:planner-draft:project:<encodedProjectId>`。旧全局键原字节保留；
  仅已知归属或完整文案与生成brief吻合才自动迁入。同主题、相同通用unit ID不能
  证明归属；无归属的旧稿通过「恢复旧版草稿」显式恢复，并可撤回。
- `planner-panel.tsx` 每工程维护内存快照，切换前同步捕捉不足300ms的修改；
  scoped子工作区重挂载，取消文案/场景请求并拒绝迟到回复。保存失败时返回原工程
  仍有当前会话的编辑。来源原稿 `plannerSource` 保持不变。
- `studio-app.tsx` 等真实项目库加载后再挂载策划区，传入实际project ID；
  波形请求同样拒绝取消后的成功回复。Inspector选择重置有实际App集成回归。
- 官方 `api.deepseek.com` 的创意策划明确发送 `thinking: {type: "disabled"}`；
  整份1/3/5/10分钟生成预算为4096/8192/12288/16384 tokens，改写仍8192。
  提示词限制重复导演元数据，共用group并保留完整语义单元。其他兼容API/Ollama
  及短结构分析的原策略保持，不向其他接口发送DeepSeek专用参数。
- 原实现固定8192且未明确关闭官方默认思考；思考与输出共用completion预算是
  长度故障的合理机制，但旧失败的usage未采集，不能声称实测了思考token比例。
  见 [官方思考说明](https://api-docs.deepseek.com/guides/thinking_mode/) /
  [接口契约](https://api-docs.deepseek.com/api/create-chat-completion/)。
- 截断JSON仍失败，不接受残稿；最多一次无效JSON修复，两个上游请求共用300秒
  总期限和取消。错误提示不再要求用户缩短目标时长；未加入无限续写或重试。

新工程的音频编辑区仍采用既有示例模板；本次修复的空白状态指策划区。此变更覆盖
2026-10-01 spec原先允许切工程保留全局工作稿的规则，双语修订已交叉链接。

## 验证

10个不重复定向文件 / **149项**通过：后台3文件49项，界面7文件100项，单worker。
全量TypeScript、7个本次代码文件ESLint及正式Webpack构建通过。既有SWC Win32
加载警告成功回退WASM，未调整依赖；本次构建自动增加的两项tsconfig include
已移除，原空间工作台include保持。最终只读审查无阻塞问题。

回归覆盖真实App的项目切换/Inspector、300ms内编辑、刷新时已选新工程、无归属
旧稿显式恢复与撤回、相同brief/ID不同全文、保存失败内存恢复、原稿保持，以及旧
文案/场景/波形迟到回复。后台覆盖时长预算、精确用户主题、官方改写、思考/截断
fixture、有限修复与共用期限、非DeepSeek兼容及共享分析流程。

实际浏览器使用原地址 **http://127.0.0.1:3001/**，没有迁移或覆盖项目库，未导入
10月3日旧工程快照。真实生成开始于14:10:54 UTC，外部API界面显示deepseek-v4-pro；
界面完整收到新稿、保存并通过刷新/切换验证。这里只记录一次用户生成动作，未采集
上游usage、内部repair次数和成本，不能据此断言仅一个上游请求。准备的HTTP验证
脚本未运行，没有第二次模型生成。204字低于提示词的软估计297–455字；这次确认
输出与持久化，不宣称创作质量或实际180秒音频达标，尚未做TTS时长验证。

当前默认浏览器视口实际截图已保存，最终界面显示标题、22条/204字及已保存。
没有覆盖390/320px新一轮响应式测试，参考上传布局/播放也未在本轮补验。
138份工程素材、6份参考/profile文件、25份另项空间源文件及H盘原MP3逐SHA保持。
主页、策划目录、声音目录和正太音试听HTTP200；目录仍3项，480078字节试听WAV
SHA为 `ec5375e88ffdaccc262771cf6ece19fe5a8ec5b73bb6f8ab0d7e45dc79dfea20`。

## 当前运行与证据

**3001 / PID23144 / `.next-project-planner-repair-production`**，生产BUILD_ID
`zvjK9OjnJVHN-Sl5s6HPs`。本轮网络中断后旧3000/3001服务已无监听，未盲目杀进程；
3000/3002目前未启动。D盘原生dist，只有cache junction到I盘。更早服务/PID为历史。

从 `apps/web` 的PowerShell启动（端口占用先识别进程）：

```powershell
$env:TEMP='I:/AI/asmr-director-project-planner-repair/2026-10-05/tmp'
$env:TMP=$env:TEMP
$env:NODE_PATH='D:/CodexWorkplace/asmr_director/apps/web/node_modules'
$env:ASMR_NEXT_DIST_DIR='.next-project-planner-repair-production'
$env:NODE_OPTIONS='--max-old-space-size=2048'
& 'D:/nodejs/node.exe' node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001
```

证据根 `I:/AI/asmr-director-project-planner-repair/2026-10-05`：`before.json`、
`backend-tests.log`、`ui-tests.log`、`typecheck.log`、`lint.log`、`build.log`、
`browser-old-project.txt`、`browser-new-project-blank.txt`、
`browser-real-generation-start.json` / `browser-real-generation-result.json`、
`browser-old-project-after-generation.txt`、`browser-final-state.txt`、`planner-result.jpg`、
`preservation-receipt.json`、`runtime-receipt.json`。不要再次运行只允许首次快照的
`capture_before.py`，也不要误跑未使用的 `verify_real_planner.mjs` 重复生成。

已同步唯一ROADMAP、AI_HANDOFF、project-archive、README及
[English](../superpowers/specs/2026-10-05-project-planner-state-and-output.md) /
[中文](../superpowers/specs/2026-10-05-project-planner-state-and-output.zh.md) spec。
未提交/推送本次修复及此前参考功能；其他会话空间改动保持。SFX模型暂停决定保持。

English handoff: Planner drafts now belong to individual projects, with conservative legacy
migration, explicit recovery, flush-before-switch and cancellation/late-response guards.
Official DeepSeek creative requests disable thinking and use finite duration-based budgets;
truncated output remains an error and repair stays bounded. 149 targeted tests, full TS,
owned lint and production build pass. A real UI generation for the exact 3-minute apocalypse
theme returned 22 units/204 characters; reload and project switching preserve both drafts.
The generated draft is not adopted. Audio duration/creative quality are not accepted by this
check. Canonical origin remains127.0.0.1:3001, PID23144; protected files are unchanged.
