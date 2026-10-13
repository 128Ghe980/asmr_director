# 2026-10-04 — 独立空间音频工作台

用户要求把音频后处理独立成网页，以好看的类 3D 头部界面绘制运动轨迹并调整靠近/远离。已实现 `/spatial-studio`，属于现有音质 V1；旧导演台桌面顶栏提供「音场」入口，不修改顶层阶段。

浅色工作台提供导入/只读本地素材选择、四种预设、自由画线/拖点、整体及逐点方向距离时间、距离曲线、原声波形、原声/空间声对比、淡化、取消、WAV/JSON 原生下载、轨迹刷新恢复。Canvas 无新增依赖，当前为耳朵高度水平轨迹，显示半径采用压缩图示比例；处理米数不变。原声不会覆盖或采用到原工程。

复用原 D，引入连续水平角度/半径的 TS/Python 分段线性插值、严格源与节点校验、完整结果/报告验证。原生 HTTP 下载解决内置浏览器 Blob 导出没有下载事件的问题。画笔起笔的单节点瞬态曾导致页面异常，已改为合法双节点并加入回归；拖点保留显式时序、取消画线恢复旧路线。空间尾声暂停后续播不再误判为结束。

证据根 `I:/AI/asmr-spatial-studio/2026-10-04/evidence`：9 个 Vitest 文件 / 49 项通过（含 2 项真实 Python/SOFA 联调、13 项 hook 行为、3 项指针回归）；Python 空间套件 29 项通过。全量 TypeScript、ESLint 和最终生产 Webpack 构建结果见 `typecheck.log`、`lint.log`、`build.log`。Windows 原 SWC 警告沿用 WASM 回退。

实际浏览器完成默认环绕/自绘轨迹生成播放、取消、节点选择、WAV/JSON 原生下载。下载的自绘 9 点轨迹时间合法、首尾 0/1；WAV 为 3,643,244 B / 48 kHz / 双声道 PCM24 / 607,200 frames / 12.65 秒，峰值 0.24722445，SHA256 `4124e71b7aee57d83f240e379300b97c6c6e87b2016b5452b83164d0e40f9fb0`。见 `download-verification.json`。这是本机演示源，听感待用户确认。

1280×960、390×844、320×740 无整页横向溢出；轨迹刷新恢复及本地素材输入由浏览器复验。合同见 [中文](../superpowers/specs/2026-10-04-spatial-audio-workbench.zh.md) / [English](../superpowers/specs/2026-10-04-spatial-audio-workbench.md)。垂直运动、多轨混合、新 SFX 模型不在本次范围，音质 V1 仍进行中。未提交推送。

最终生产服务：`http://127.0.0.1:3000/spatial-studio` / PID27696 / `.next-spatial-studio-build`，生产页面再次原生下载通过，生产启动后的浏览器 error/warn 为空，见 `browser-verification.json`、`workbench-desktop.jpg`。临时 viewport 已恢复，页面保留供用户试听。重启：在 `apps/web` 设置 `ASMR_NEXT_DIST_DIR=.next-spatial-studio-build`，执行 `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000`；修改代码后需先 `build --webpack`。

本轮第二次增量构建曾遇已有 Webpack `WasmHash` 缓存异常；保留失败日志及本轮缓存，重新建立空的 webpack 缓存后最终生产构建退出 0。未删除其他构建目录。新 build 的 cache junction 指向 `I:/AI/asmr-spatial-studio/2026-10-04/build-cache`，编译产物留在项目内。
