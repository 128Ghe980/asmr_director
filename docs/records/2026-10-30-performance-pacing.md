# 2026-10-30 表演节奏、15秒任务与独立起镜

状态：实现、相关回归、本地部署及真实HTTP导出完成；真实DP节奏结构通过，细部导演一致性和H3成片质量未全面验收。属于现有 Audio Quality V1，不新增路线；其他暂停和 No-sleep 内存阻塞保持。未提交/推送。

## 用户问题与原始诊断

用户指出一次递糖被分成多个数秒任务、拆糖25秒和其他无台词过长；希望简单动作10秒内完整做完、每次视频不超过约15秒、所有模板适当独立起镜、台词说得完整些，并询问逐段白噪音生成方式。

原《女巫的出门前检查》是10台词+7无台词的17个逻辑段，导出35个主任务。无台词120秒、人声22.4秒：15/20/20/18/25/10/12秒动作被每5秒展开，运行器另有静默5秒截断。因此同时修改策划、画面声音设计、导出和运行器，单改提示词不能解决。

## 实现

- 新创作先分配合理动作/声音时间，再组织完整交流。一次性动作通常3–8秒、最多10秒；反应通常1–4秒、硬上限5；过渡上限10；真实持续触发通常6–12秒、硬上限15。禁止通过换成asmr标签、重复操作或超慢动作填补预算。
- 台词通常20–35字、预计6–12秒，允许一句段落包含多句自然口语；预计超过15秒进入现有一次修复。新生成仍检查总目标的80%–120%，不是自动拉伸动作。真实TTS之后以WAV为准。
- 策划提示区分speech正文与silent的第三人称动作说明。缺少silent时先补当前剧情必要动作，再算台词预算，不能按目标减0全部填对白。保留一生成、至多一次修复；没有新增常驻语义审核API。
- 近距离模板v4、禁令交易模板v3及示例时长同步；旧快照/旧长段schema继续读取，不自动改写用户工程。
- 新无台词≤15秒整段设计/导出；旧长逻辑段重新设计按≤15秒展开，旧已保存5秒parts不擅自合并。复制H3提示也接受10秒完整动作。实际采用/后处理WAV含尾音超过15秒明确拒绝，不能截断原人声。
- 批跑器取消5秒截断，文生/参考两路请求上限15秒。原帧对齐保留，15秒可量化为362帧约15.083秒。
- 全部模板默认首镜独立，最多接续两次尾帧再独立，既有new可提前重置。导出按展开后的实际任务执行，旧包升级runner也在内存中应用。独立使用角色图，保持机位，不要求换场景。模式及最近独立起点进入缓存身份，受影响的旧连续组不能误用旧结果；磁盘工程和成品历史保持。
- 补窄范围空手画面检查：近距离新设计的visual/action/camera若把invisible/imaginary或as-if-holding/opening等当可见目标，使用现有一次修复；材料拟音仍允许在声音字段。没有增加额外循环。

独立ASMR支路仍为H3文生视频，随后取音并执行既有D/SOFA处理；没有角色图、主视频或上一段尾帧引用。其内容是触发音/拟音/环境声，不一定是白噪音。台词overlay、无台词增强版replace和原版/增强版双合片保持。

主要代码：planner-provider、creative-templates、performance-segment/storyboard、clip-storyboard-service、camera-pantomime、video-plan、video-generation-policy、video-package/local-video-package、clip-storyboard-editor；runner.py和prepare_asmr_batch.py及对应测试/说明。11个生产TS文件覆盖到上一个干净发布基底；根工作区无关spatial等修改未带入。

## 验证与真实模型边界

QA根：`I:/AI/asmr_director/qa/performance-script/2026-10-30-pacing/`。

- 隔离27文件451 tests、24文件lint、完整Webpack/TypeScript通过，见`release-verification.json`、`isolated-tests-final.log`等回执。另独立duration/pantomime组合20条通过；测试集合不相加。
- 完整UTF-8 Python运行器/转换122条通过，`runner-complete-final.log`。之前GBK失败为日志JSON解码，初始失败日志保留；最终完整运行无失败。
- 本轮12次业务试验共18次真实DeepSeek上游，均deepseek-v4-pro；18份request/response/meta和唯一响应ID核对。失败、修复前稿均保留，没有手改模型字段伪装成功。0新TTS/ASR/H3。
- 旧稿仅API只读时长建议：15→8、20→12、20→12、18→10、25→10、10→5、12→4秒，共120→61秒；未写回原工程，也不是产品新增固定审查调用。
- 最终近距离`near-20261030T101854691Z`：6台词+5无台词，估105秒（74+31）；静音7/8/5/7/4秒。最终禁令`counter-20261030T101854705Z`：9台词+5无台词，估136秒（104+32）；静音8/5/9/4/6秒。目标均120秒，分别经一次修复；所有台词估10–14秒。最初两轮总时长不足、缺silent或正文写成评论等问题完整留证。
- 独立审查`independent-final-dp-review.json`确认原始响应与segments逐项一致、源hash匹配。核心节奏结构通过，不等于导演全语义通过：近距离静止摊掌仍配纸张摩擦，递糖伸手在台词段、随后无台词4秒等待并收手；禁令稿开场物件在桌上、后文从桌下取出，以及推/拿/滑动描述冲突仍在。没有把这些残留标成已修，沿用用户先前暂缓精细状态优化的边界。
- 两个独立真实画面设计：`design-handoff-20261030T100231968Z`5秒、`design-unwrap-20261030T100844618Z`10秒，均无parts；后者初次imaginary wrapper经现有一次修复变为纯空手可见动作。最终字段不手改。中间另一次as-if-opening薄包装结果未作为通过稿交付。

## 部署与交付

2026-10-30 18:23 HKT安全切换3001。活动源码`.local/releases/performance-pacing/apps/web`，build **`R7R1RdTxRIJFu2Ught-nO`**；只停止已核实的旧node36840/启动父30300，新的父PID5408（当前PID用端口核对）。入口仍`I:/AI/asmr_director/service/2026-10-16/start-production.ps1`，回退脚本本QA `start-production-before.ps1`。`activation.json`/`service-verification.json`核对首页8JS/CSS、7参考/2日语WAV、11功能hash、28范围外不变。旧发布保留。未做浏览器视觉操作。

真实HTTP分别导出新两动作和旧13parts工程。解压后验证30个禁网payload（15主+15ASMR），10秒主/声音均243生成帧、源时长10秒，旧parts保留但有效模式最多连续两次；新runner、模型画面字段、DSP参数及声音职责匹配，磁盘manifest不变。见`http-export-verification.json`。

交付在`I:/AI/asmr_director/artifacts/h3-asmr/`：

- `ASMR-whole-action-trial-2026-10-30.zip`，3,038,989bytes，SHA256 `55792095d484bdb31a4cd1d06208fbb33567034e60079ca1529abe7f2e92b9ea`。拆糖10秒+递糖5秒，2主+2ASMR，两者都独立起镜，无新TTS；是两个动作的模型试验组合，不是完整新剧。需选择角色图，画幅仍可在窗口选。
- `ASMR-video-runner-pacing-update-2026-10-30.zip`，44,707bytes，SHA256 `861557a5233f04a686c3f781c447a5eddd6bdf2495d84ecdc1ea8b8ec17251ac`。仅runner.py/run.bat/README.zh.md/更新说明；不含或覆盖workflow/project/assets/outputs/custom_nodes。

升级旧包只更新运行能力和独立周期，不自动缩短旧25秒动作或合并已保存5秒parts；要改变旧内容必须重新生成/修改相应无台词时长并重新设计导出。原万圣节、加长版、上轮空手试跑包均保留。H3实跑、最终声画观感仍由目标ComfyUI验证。

## 文档同步

同步ROADMAP当前验收进度、AI_HANDOFF与project-archive；[中文合同](../specs/2026-10-30-performance-pacing.zh.md) / [English](../specs/2026-10-30-performance-pacing.en.md)取代历史合同的5秒任务规则。路线/其他暂停保持，不运行初始化器新建竞争路线文件。
