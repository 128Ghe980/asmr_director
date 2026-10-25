# 已有分镜重新生成与确认

日期：2026-10-23。所属路线：Audio Quality V1；父阶段进行中，SFX 暂停，不新增顶层步骤。本轮功能完成，06:02 HKT 已部署至 3001。

## 用户需求与修改

用户要求已有分镜仍可重新生成，点击后先提示，同意才执行。顶部主按钮此前只计算 `storyboard_missing`，全部已有分镜时为 0 而禁用；右侧单镜和更多菜单的重做入口原本可用，但没有确认。

顶部在有缺失时继续补齐缺失；无缺失且存在可生成镜头时显示「重新生成分镜」，数量改为全部可生成镜头，并使用既有 `storyboard_all` 流程。更多菜单的「重做全部分镜」和顶部重生成统一在批次入口确认，且只在目标确有已有分镜时提示。右侧「重做分镜」也在存在旧分镜时确认。首次生成不提示，拒绝确认不发请求、不进入 busy、不修改工程；生成成功后替换对应分镜，失败或取消保留原分镜。

只修改三个产品组件：`studio-batch-actions.tsx`、`studio-app.tsx`、`clip-storyboard-editor.tsx`，以及四个相关测试文件。复用已有 `window.confirm`，没有新增弹窗状态、服务接口、模型参数或运行器协议。原补缺、单镜请求保护、自动整批校对、原音与短句/整段工作区规则保留。

## 验证

- 四文件 97 项通过、0 失败/跳过：单镜 48、按钮 17、批次 App 17、已有整批校对 App 15。新增覆盖完整分镜仍可重生成、顶部/菜单拒绝零请求、同意后成功替换及失败保留、current/stale/silent 单镜确认、首次不提示；旧补缺、晚响应及取消回归保持。
- 独立选定源码另跑相邻后处理 App 与队列，两个文件 46 项通过、0 失败/跳过。与上面四文件不同，不重跑整站。
- 完整 TypeScript 通过；七个修改文件 ESLint 通过。全 src ESLint 首次进程以 `-1073740791` 原生退出且日志无诊断，保留记录，随后仅对本轮七文件检查通过，不声称本轮全 src lint 成功。
- 串行独立正式构建通过，Node heap 上限 2048 MiB，BUILD_ID `9qjXKJbCCq-mG1N_P1U2E`。隔离 3107 预览 HTTP200、七个实际 JS 字节/SHA 与构建匹配，主按钮/单镜确认文案、既有整批校对及后处理入口均在。
- 06:02 HKT 更新 3001：listener40900，替换40976；生产 HTTP200、七个实际 JS 字节/SHA、API 配置与三条 POST-only 路由 GET405 通过。332 个生产文件 size/mtime 保持。规范启动脚本仍为 `I:/AI/asmr-director-service/2026-10-16/start-production.ps1`，源码切至 `D:/CodexWorkplace/asmr_director_release_verify/2026-10-23-storyboard-regeneration/apps/web`，dist `.next-storyboard-regeneration`。

证据根：`I:/AI/asmr-director-storyboard-regeneration/2026-10-23`。本轮没有真实文本 API、TTS、ASR、DSP 或 H3 生成，不操作生产浏览器工程存储；未提交或推送。真实浏览器视觉不由 DOM 与静态资源检查认证。

## 同步

沿用现有 `docs/ROADMAP.md`、`docs/AI_HANDOFF.md`、`docs/project-archive.md` 三入口并同步状态和服务身份，先前分镜上下文、整批校对及显式后处理记录保留。文档收拢后刷新选定源码快照，产品 app 子树须与构建一致，HEAD 和真实空索引保持；范围外及此前工作按启动前 SHA 核对。最终证据见本轮证据根的 `verification.json`。
