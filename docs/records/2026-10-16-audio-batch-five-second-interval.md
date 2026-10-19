# 批量音频任务间隔 5 秒试用

日期：2026-10-16（Asia/Hong_Kong）。父阶段仍为 Audio Quality V1 进行中，SFX 暂停。

用户在真实批量生成出现部分失败后，要求“每个任务完成后等待5s试试”。在网页批量音频的串行队列项之间增加固定 5000ms 等待，从上一项成功／普通失败的终态开始计时；不是从请求开始计时。旧短句和整段页的批量音频入口共用此规则。等待期间显示“任务间隔中（5 秒）”，仍保持批量忙碌状态，取消会立即清定时器并停止后续派发。

跳过未实际生成的项、最后一项、存储错误导致整批停止时不等待。分镜批量、单项生成及一次请求内部的 ASR／分组阶段没有新增间隔；识别检查、真实得分、原音保存、人工确认和采用规则保持。这是验证任务间隔是否缓解资源失败的试用，尚无新增真实模型生成结果，不能宣称已解决 GPU OOM 或 cuBLAS 初始化失败。

代码：studio-batch-generation.ts、studio-app.tsx、studio-batch-actions.tsx 及两个定向测试文件。队列 30 项（新增 8 项时间／取消边界）、界面 7 项通过；完整 TypeScript、相关 ESLint、Webpack 正式构建通过。独立只读复核无必要修正。构建临时增加的 tsconfig／next-env 路径已核验后移除，原有空间工作台等未提交配置保持。

15:03 启动、15:05 只读核验 3001：dist `.next-batch-delay-production`，BUILD_ID `7M_AccyV6kPlieCgDJjWW`，服务 PID27128、启动器4220（恢复时重查）。页面、声音目录、真实工程候选查询及包含等待提示的新浏览器 bundle 均 HTTP200。110 条候选 manifest SHA 与改动前相同，HEAD a115b3f 保持，无自动重试生成、提交或推送。用户需刷新原 http://127.0.0.1:3001/ 页面加载新队列，再反馈实际效果。

证据位于 `I:/AI/asmr-director-service/2026-10-16/batch-delay`：before.json、queue-test-receipt.json、ui-tests.log、typecheck.log、eslint.log、build.log、start-receipt.json、verification.json 和服务日志。源码外的新构建在 I 盘，D 盘只有 junction。恢复入口 `I:/AI/asmr-director-service/2026-10-16/start-production.ps1` 已指向新 dist，并保留既有 I 盘素材／工作目录、paragraph decoder、exFAT helper 和当前视频批跑器来源。旧运行版本及原启动脚本保留在证据根，未删除素材或模型。
