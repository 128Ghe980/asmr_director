# 批跑器横竖画幅选择

用户要求在生成时自定义横屏/竖屏，并指出工作流已有控制节点。本轮属于 Audio Quality V1，不恢复暂停的其他 SFX 或模板质量优化。

## 完成

四个文件：`tools/comfy-batch/runner.py`、`test_runner_aspect_ratio.py`、`README.zh.md`、`ASMR_BATCH.zh.md`。窗口和CLI支持画幅，旧默认保持；有直连 `ResolutionSelector` 时更新比例、保留像素预算，无节点的标准模板按672×1216/1216×672生成。两路视频同步，改比例/切回/未知任务/双合片历史均验证。每项目GUI设置保存在 `runner-settings.json`，dry-run不写。

规格：[中文](../specs/2026-10-29-batch-aspect-ratio.zh.md) / [English](../specs/2026-10-29-batch-aspect-ratio.en.md)。节点标签依据 [ComfyUI 官方源码](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_resolution.py)。

## 验证与交付

QA：`I:/AI/asmr_director/qa/video-batch/2026-10-29-aspect/`。

- Python3.12.8 全部运行器回归146项通过，含10项新画幅测试；`runner-tests-final.log`、`verification.json`保存日志与4文件SHA。首次使用Anaconda3.8执行旧测试出现19个 `removeprefix` 环境错误，首日志保留；产品要求Python3.10+，未修改产品规避该环境问题。
- 独立审查未发现阻断问题。真实3001 HTTP导出一段15秒无台词内容为3块，包3,042,170bytes；核对4个运行器资源与当前源码一致。隔离解包、禁止联网，对项目默认竖屏/显式横屏/显式workflow分别检查主+ASMR共18个payload，全部通过，见`http-export*.json`。
- 原生Tk启动成功，但两次窗口截图超时，AX也未提供控件文字；未完成真实视觉/交互验收。临时测试进程已清理，见`gui-check.json`。没有把截图失败记为GUI验收通过。
- 更新包 `I:/AI/asmr_director/artifacts/h3-asmr/ASMR-video-runner-aspect-update-2026-10-29.zip`，46,612bytes，SHA256 `b5c0a95c813743a67d3a498789eb5c9e5c81eabfa3e3fca8645e7245e80b2c8f`。只含runner、两份说明、更新说明；不携带/覆盖工程、工作流、素材或outputs。CRC/逐文件字节核对通过，28项范围外工作哈希保持。

3001无需重启，build仍`6i9y2gc1uL9nGDjYlbvGT`，动态导出已包含新版运行器。没有实际H3、提交或推送；画幅成片需目标ComfyUI执行。用户同时请求的万圣节加长内容单独记录，不能把本轮dry-run称为已生成视频。
