# 左侧操作结果收拢与多句提示说明

日期：2026-10-23。路线 Audio Quality V1；本项完成，父阶段继续进行，SFX 暂停，无新顶层路线。未提交推送。

## 意图与改动

用户指出左侧卡片点击按钮后，批量、校对、后处理结果不断占据文案区域。改为单行结果摘要和「查看结果」入口，完整明细放入独立原生模态。生成进度和取消仍在工具栏；原音整体试听保持原处。

批量错误的镜号、台词和全文、校对差异/说明及应用撤回、逐镜及整体后处理试听下载全部保留。摘要视觉省略不截断原数据。详情仅打开时挂载，关闭清理后处理试听请求与临时资源，不取消主生成；切工程/工作区会关闭。支持原生 modal、Esc、背景点击、关闭返焦和单一内容滚动，长内容换行。零改动显示「校对完成：无修订」，不是质量认证。移除 StudioBatchActions 已无使用的内联结果接口，避免再次堆叠。

「还有长段未拆成短句」实际只检测短句页某个非无对白段是否由句界函数拆出多于一句，不按字数。句号、问号、感叹号、分号、换行等可触发，逗号、顿号不触发。它不阻止生成。只读历史雪夜副本唯一命中脚本第22镜 voice_023「你累了吧？先歇会儿，饭马上就好。」；未读取当前浏览器工程，不能断言当前也是该条。提示已改「有台词包含多句，可按需拆分」，按钮说明拆的是文案、不是已有音频，涉及音频需重生成并可撤回；算法、失焦自动拆分和两页同步未改。

## 验证

独立选定快照10文件 **115通过、0失败、0跳过**；含45集成、5弹窗、18文案卡片及其他47相关测试，各子集重叠不可累加。完整TypeScript、10文件ESLint和串行2048MiB堆限制生产构建均退出0。覆盖默认收起/运行不自动弹出、完整失败明细、查看不增API、进度取消、应用撤回、部分后处理结果试听、关闭清理、切工程/工作区清空。独立只读审查无阻断发现，未重跑整站测试。

编译HTTP检查页面200，7个JS和1个CSS字节/SHA匹配，实际包有新入口/提示与响应式换行样式、无旧「长段」文案。CUA初始化仍报kernel-assets系统找不到路径(os3)，没有实际浏览器截图；测试专用dialog shim不证明真实浏览器原生焦点隔离/inert或几何布局。不以测试替身声称视觉验收。

## 部署与数据保护

07:01HKT更新3001，build **f-R8bSLnL1Vxldyh1_V7-**，监听PID41536替换37868；PID是部署时快照。规范启动 I:/AI/asmr-director-service/2026-10-16/start-production.ps1 已改指 D:/CodexWorkplace/asmr_director_release_verify/2026-10-23-operation-results/apps/web + .next-operation-results，原脚本保存在QA目录。旧部署脚本的PID保护已过期。音频运行时/素材路径保持。

实际服务7个JS字节/SHA、API配置和三个POST-only路由GET405通过，356生产素材size/mtime保持；浏览器工程、成功分镜/音频及模型调用均未触碰。27项另会话文件保持并不部署，HEAD和实际空索引保持。相对上次部署仅10个apps/web组件/测试文件变化，后端和便携批跑器保持同一内容。文档刷新后apps/web树固定为 f3a41f00d40db92f443cf32ed2b7516458fb61ed。

证据：D:\CodexWorkplace\asmr_director_qa\operation-results-2026-10-23，包括 dialog/verification.json、sentence-hint/verification.json、integration/verification.json、vitest-results.json、checks-result.json、build-final.json、preview-verification.json、deployment-verification.json、source-verification.json、verification.json。中文/英文spec及现有ROADMAP/AI_HANDOFF/project-archive同步。
