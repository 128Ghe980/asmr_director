# 视频项目包与独立批跑器发布记录

日期：2026-10-15（Asia/Hong_Kong）。父阶段：Audio Quality V1进行中，SFX暂停。用户明确要求“记录一下，推一版”。选定源码发布核验已完成；提交和推送身份以Git及仓库外release-verification.json为准，不预填提交自身SHA。

## 本次发布范围

发布本轮视频项目包导出、可替换参考图、原音封装、最长5秒的环境空镜、独立Python／FFmpeg运行器、断点对账恢复、单镜重做及可选顺序预览片，以及相应测试、双语规格和交接文档。为保持已有索引完整，一并发布已完成但此前仍仅本地保存的旧缓存清理及09:33会话交接两份记录。

共享README、ignore、ESLint和tsconfig仅暂存本轮内容；空间工作台入口、未发布spatial-studio目录、空间渲染／轨迹源码与测试、Qwen第三方说明继续留本地。暂存不覆盖工作文件，不使用reset／clean。发布基线为`1f0d6516d5347b70289d13343c387667172767ce`，分支`codex/voxcpm2-product-generation`。

## DeepSeek和提示词的准确边界

用户反馈DeepSeek API“好像崩了”，本轮没有实际在线调用或确认服务端故障。分镜准备时仅发送文字场景、当前台词／空镜描述、实测秒数和参考上下文，模型返回画面／动作／机位及空镜环境底噪；程序以固定H3模板加入原台词和素材规则。导出和批跑不再调用DeepSeek；连续尾帧说明由本地常量拼接。新空镜走已配置外部API，有对白沿用既有provider选择。失败保留旧分镜、报错，不自动换模型或重试；默认超时300秒、JSON输出、2048 tokens、关闭DeepSeek思考。已有完整项目包可独立执行，不带API密钥。

一镜一份音频是新视频包约定；原“音频”下载页签的已发布双目录导出不在本轮改动范围。运行器内部原音恢复快照不构成第二种声音版本。角色图可替换，爱哥图和测试WAV不提交仓库。

## 发布验证

原共享工作树1863项Vitest／4跳过、22项Python、类型／源码ESLint／正式构建及实际ZIP／HTTP／FFmpeg证据见[开发记录](2026-10-15-audio-quality-v1-comfy-video-batch.md)。该全树结果含未发布空间代码，不能代替本次选定提交树核验。

实际选定40文件、排除23个有内容变化的本地路径，按暂存树独立导出536个源码文件。共享4文件仅含视频包相关改动，所有导出blob与index相同，原工作文件在暂存时逐项SHA保持；未发布空间路由缺席。证据根为`I:/AI/asmr-director-video-batch/2026-10-15/release`。

- 全量Vitest：**136文件通过／2跳过，1827项通过／3项既有跳过**，`staged-tests.log`。显式启用真实ZIP→包内Python干跑，确认单份WAV、参考图、环境声与连续镜头API输入，无真实模型调用。
- Python运行器：**22项通过**，`staged-python-tests.log`；完整TypeScript和源码ESLint通过，`staged-typecheck.log`、`staged-eslint.log`。
- WASM／Webpack正式构建通过，`staged-build.log`；该构建不包含未发布的`/spatial-studio`。验证源码在`D:/CodexWorkplace/asmr_director_release_verify/2026-10-15-video-batch`，构建和较大证据在I，未替换生产服务。
- 选定运行器真实FFmpeg验证通过：完整原音相关0.999949、环境120帧／5.0秒、预览精确128帧且原单镜保持，`staged-media-smoke.log`。与原开发记录一样仅为合成媒体验证，不是H3听感验收。
- staged/source一致性、排除边界、314个本地Markdown引用和凭证模式扫描通过，无私人媒体、模型、输出包或密钥纳入版本；`export-audit.json`。最终只追加发布文档结果，应用及运行器subtree与已验证导出保持相同。

## 保持的运行边界

本次为记录与Git发布，不更新3001、不重启生产或生成主机、不调用TTS／ASR／DeepSeek／H3、不修改生产音频、候选或浏览器工程库。真实生成主机H3效果和浏览器视觉验收仍待完成。程序运行要求Python3.10+、FFmpeg及现有ComfyUI节点／模型，发布不含模型或私人媒体。
