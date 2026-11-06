# ASMR 视频批跑器

**表演脚本与双版本合片**：脚本中的台词、ASMR 操作、动作过渡和互动停留都会导出。新设计的无台词动作在 15 秒内一次完成，例如 10 秒递糖动作不会再拆成两次或截成 5 秒。旧工程已保存的小段保持原划分，较长逻辑段重新设计时按每次不超过 15 秒展开；拆任务不重演已经完成的取放。常规模式每段 `asmrSound` 独立生成声音，对白使用当前 WAV 的真实时长，新表演段使用其计划时长。下述「先动作，接着边做边说」试验改用无台词主视频原声，并可连续生成伴随台词的音效。勾选合片后，每个候选分别输出原版和 ASMR 后处理版。旧包没有该字段时保持原流程。

ASMR 叠加版需要将包内 `custom_nodes/asmr_director_audio/` 复制到目标 ComfyUI 的 `custom_nodes/`，按该目录说明安装缺少的 Python 依赖并重启 ComfyUI。它复用本项目现有 D 空间后处理；生成、后处理和合片都在同一 ComfyUI 内运行，运行器本机仍不需要 FFmpeg 或额外 Python 库。常规原版合片不依赖音效后处理节点；动作延续试验的混音台词主视频需要已有 D/响度平衡与混音节点。

**H3 原生 ASMR 试跑包**：新增显式文生视频模式，用原工作流直接生成触发音和画面，支持每类多个候选及断点继续。文生模式可在窗口「每条时长」或 CLI `--duration-seconds` 自定义不超过 15 秒的秒数，留空使用项目每镜时长；普通参考分镜包不接受此覆盖。该模式不需要角色图或输入音频、不取尾帧、不裁剪原生音轨，默认使用原工作流的分辨率。专用说明 `ASMR_BATCH.zh.md` 和提示词 `ASMR_PROMPTS.zh.md` 随 12 类原生试跑包提供，也保存在开发仓库 `tools/comfy-batch/`；普通网页导出的参考分镜包不附带这些实验材料。以下角色图与连续参考说明适用于参考分镜项目包。

使用 Python 标准库调用已运行的 ComfyUI，不需要安装 pip 包。双击 `run.bat`，选择**解压后的项目文件夹**、角色参考图和 ComfyUI 地址。项目中已有角色图时可直接使用，也可在窗口替换。没有 Tk 的 Python 可使用下方命令行。

## 继续上次，还是再生成一版

- **第一次跑**，把「每镜候选总数」留空，点「开始 / 断点继续」生成候选 1。
- **想再看一种效果**，直接点「再生成一版」。每点一次，所有镜头都用下一个候选号生成，画面和对应的 ASMR 音效使用该候选的新种子。旧成片可以复制或移走，请保留 `outputs/run-state.json` 以接着编号。追加时只处理新编号，即使旧 MP4 已移走也不会回头下载它。
- **想同时拿到合片**，运行前勾选「合并顺序预览」。从单版追加一版时，新普通预览是 `outputs/preview-c002.mp4`，有 ASMR 规划时另有 `outputs/preview-asmr-c002.mp4`。
- **中断后继续**，总数留空，点「开始 / 断点继续」。运行器会读取上次保存的候选范围。例如候选 2 中断后，继续处理候选 2；此时再点「再生成一版」会另开候选 3。

全新的输出目录会随机选择基础种子并在正式运行时保存。保留整个 `outputs/` 可按原种子断点继续。若连同恢复记录一起搬走，下一次正式运行会作为新批次从候选 1 开始。需要从同一基础种子复现时可显式传 `--seed`。

## 先动作，接着边做边说（试验）

网页选择此音频制作方式后导出 `"silentAudioMode": "action-first"`；窗口「无台词声音」可按项目运行或手动选择 **先动作，接着边做边说（试验）**。CLI：

```bat
python runner.py . --silent-audio-mode action-first --concat
python runner.py . --silent-audio-mode action-first --dry-run
```

无台词段直接生成角色表演及其原生 ASMR 声音。连续动作中的无台词段保留原始主视频供取音，两种合片都使用同一份经空间和响度处理的动作声。单独的无台词段在普通版保留原生声音，在增强版应用声音后处理。

脚本中可以有一组无台词段 X → 台词段 X+1：先安静轻敲/摩擦，再保持操作并自然加入台词。画面声音设计必须明确标记实际未结束的动作延续；导出后，台词段 `asmrSound.referenceShotId` 指向紧邻上一无台词触发段（两段 `role` 都是 `trigger`）。不自动按相邻位置猜测已结束的动作，不把拆完、递出等一次性动作重新演一遍。旧脚本只有纯说话时，需要先修改内容/重新设计，单纯切换批跑模式不会自动添加动作或引用关系。

完成无台词段 X 后，批跑器取同一候选的原声，让 H3 参考它的音色和节奏，为台词段 X+1 生成一段新音效。X+1 的画面接收两个独立音频参考：Audio 1 是已采用的后处理台词，用于口型；Audio 2 是经过空间和响度处理的本段纯音效，用于手部动作的接触、释放和停顿。成片使用这两轨在同一时间轴上的混音。

普通版与增强版都直接使用 X+1 主视频的混合音轨。处理 X 的动作声时会读取下一段已采用的人声，X+1 再参考 X 末尾实际发声的响度，与本段开头衔接。采用的人声保持自身电平；需要给混音留峰值余量时，优先调节音效。其余未标记接续的台词段在增强版中叠加自己的音效。

声音依赖核对候选号、源文件及已保存的任务记录。通过「开始 / 断点继续」升级历史试跑时，原始无台词主片和已成功的独立音效可复用。接续台词的参考方式已经改变，对应主画面和两条合片需要重做。更改接续前段的空间或响度设置也会更新后段的音效电平与画面参考。只在需要另一套完整候选时点「再生成一版」。

首次使用此版，请把项目包内的 custom_nodes/asmr_director_audio 整个目录复制到生成机 ComfyUI/custom_nodes/，覆盖同名文件并重启 ComfyUI。两个音频参考需要支持多个独立音频输入的 H3 节点。使用 --dry-run 可检查 X+1 的两个参考及最终混音连接。

## 无台词先声音后画面（试验）

这是上一版保留的独立选项。项目可显式写入 `"silentAudioMode": "asmr-first"`；旧包缺省与显式 `"native"` 都保留原生流程，不因更新运行器重做成功视频。窗口选择按项目记忆，CLI 省略参数按清单，不读取窗口偏好。

```bat
python runner.py . --silent-audio-mode asmr-first --concat
python runner.py . --silent-audio-mode native --concat
python runner.py . --silent-audio-mode asmr-first --dry-run
```

试验模式先生成本次所选镜头的独立 ASMR 音视频，再生成主画面。无台词镜头使用**本镜同候选号**的成功 ASMR 视频，由目标 ComfyUI 现有 `LoadAudio` 读取音轨并裁到本段时长；这条未做 D 的音轨同时成为 H3 的声音/节奏参考和主视频的最终声音。试验模式保留完整小数秒声音，画面向上对齐到 24 fps 整帧；原生旧包仍沿用旧时长规则。角色参考图、必要的上一镜尾帧和独立起镜周期仍有效；提示词明确声音不是对白，不配口型。标准导出提示词的原生拟音 retention 段会替换为 `fully_copy`，画面、动作和无实物表演描述保留。切回原生模式时标准 retention 同步恢复生成声音规则。自由编写的非标准 prompt 追加声音优先规则，仍建议清理其中互相冲突的说明。

主画面依赖 ASMR 输入身份和成功视频 SHA（包含实际音轨，视频内容变化也会保守失效）。修改该段声音 prompt、重抽其声音或换候选号会更新对应无台词主画面；不带动其他镜头。仅改 `postProcessing`、`role` 或 `mixMode` 不重跑声音和画面，只更新增强合片。缺少 `asmrSound`、声音失败、未确认或文件变化时，该候选无台词画面明确等待；不借别的候选、不自动退回原生声音，对白画面仍按已采用 WAV 生成。`--only` 限定先声音和主画面的同一范围；合片仍检查全部镜头依赖。恢复先对账已接受的任务，保留旧成品和历史。

原版合片保留这条独立 ASMR 的未处理原声；增强版对先声音的无台词段统一 **replace**，只对独立声音执行一次 D 与已选择的响度平衡，再替换主轨，避免同一音效叠两遍。对白仍 overlay。不会先对参考声音做 D，也不增加生成任务数量、本地 FFmpeg 或 Python 依赖。`--dry-run` 的依赖与占位音轨可检查，但实际主镜指纹要等前置声音成功后计算。此模式的画面节奏贴合度仍需在目标 H3 环境实跑、试听验证。

## 横屏与竖屏

窗口「生成画幅」可选 **按项目 / 原设置、竖屏 9:16、横屏 16:9**，主视频和对应 ASMR 音视频使用同一画幅。开始运行时记住本项目的窗口选择，保存在包内 `runner-settings.json`；重新打开或切换项目文件夹会恢复各自选择。「只检查项目」不修改这份设置。更换运行器时保留该文件即可。命令行不读取窗口偏好，省略画幅参数时使用 `project.json` 的可选字段 `"aspectRatio": "portrait"` 或 `"landscape"`；没有该字段就保留原行为。

```bat
python runner.py . --aspect-ratio portrait --concat
python runner.py . --aspect-ratio landscape --concat
python runner.py . --aspect-ratio workflow --dry-run
```

`workflow` 明确覆盖项目画幅并回到旧设置：普通参考包默认 1216×672，原生文生包使用工作流中的尺寸节点。旧包不会仅因升级自动改成竖屏。选横屏/竖屏时，若 H3 节点的宽高直连 `ResolutionSelector`（用户原文生工作流为节点 21），运行器只修改其 `aspect_ratio`，保留 `megapixels` 和 `multiple`；节点与取整规则见 [ComfyUI 官方实现](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_resolution.py)。普通参考包若没有此节点，则分别使用 1216×672 / 672×1216，无需新增 ComfyUI 节点。尺寸需对齐模型的 32 倍数，比例为近似值，不承诺成品像素严格等于 16:9 或 9:16。工作流源文件不会被修改。

切换画幅会按新输入生成主视频及 ASMR 候选，已有成品与状态历史保留；切回原画幅可复用输入相同且完整的历史。合片只使用本次画幅的匹配结果，不混用横竖片段。已有未确认任务仍先对账，不因换画幅重复提交。高级 `--width` / `--height` 保留；与画幅预设同时使用会报错，手填尺寸时先指定 `--aspect-ratio workflow`。

English contract: The GUI offers project/default, portrait, and landscape presets and remembers its choice per package, except during dry-run. CLI overrides the optional manifest `aspectRatio`; explicit `workflow` restores legacy defaults. Presets update a directly linked ResolutionSelector while preserving its pixel budget and alignment, or use 672×1216 / 1216×672 when no selector exists. Main and ASMR generation share dimensions. Existing default fingerprints stay compatible; orientation changes retain prior media and history, and a round trip reuses matching results.

本项目本机的交付包放在 `I:/AI/asmr_director/artifacts/`，验证文件放在 `I:/AI/asmr_director/qa/`；默认成品及状态仍保存在所选包内的 `outputs/`。所有项目输出均保存在 `I:/AI/asmr_director/` 目录内。复制到另一台主机时，包内相对路径保持可用。

运行前需要：本机 Python 3.10+，以及已经运行、能手动执行这套 H3 工作流的目标 ComfyUI。**本机不需要 FFmpeg、ffprobe、PyAV 或 pip 包**；媒体处理都在目标 ComfyUI 内完成。目标主机须已安装你在 `asmr04` 使用的 CLF 尾帧节点，并有对应原生视频、图像节点；环境镜头还需 `TrimAudioDuration`。程序会预检所需节点，不安装节点、下载模型或启动 ComfyUI。默认地址是 `http://127.0.0.1:8188`。

## 更新已有项目包

先关闭旧批跑器，再将更新包中的 **`runner.py`、`run.bat`、`README.zh.md` 三个文件**覆盖到旧项目解压目录，并补齐或更新 `custom_nodes/asmr_director_audio/`。保留 `project.json`、已有的 `workflow_api.json`、全部素材及整个 `outputs/`，尤其不要删除 `run-state.json`。若更新包附带标准 `workflow_api.json`，仅在旧包缺少该文件时补齐，不覆盖你已经调整的工作流；本次音效质量更新包不含工作流。使用 ASMR 后处理合片时，将更新后的节点目录也复制到目标 ComfyUI，按节点说明安装缺少的依赖并重启 ComfyUI。

第一次继续运行时，旧 version 1 状态会自动备份为 `run-state.v1-backup-*.json`，再迁入候选 1。旧批次沿用已知种子，同输入已成功的候选会复用，未确认任务先对账。要指定原来的目标总数，可继续填写 N。新导出的完整项目包仍携带运行器、启动器、说明和工作流四个运行文件。

本次更新保留工作流模板及状态版本。首镜独立起镜，随后最多接续两次；新导出将这个周期写入实际任务。旧包升级运行器也会在内存中执行同一规则，不改磁盘上的 `project.json`。独立起镜使用角色参考图，保持同一机位和构图，不表示切换场景。受新起镜方式影响的镜头及其后续连续组会重新生成；后续连续组的旧缓存可能发生一次更新，原成品和历史均保留。第一组输入相同的成功结果继续复用，之后普通单镜重生仍不自动重跑其后镜头。旧成功结果缺少尾帧 PNG 时，程序会将旧视频交给 ComfyUI 单独补取尾帧，并保存独立任务回执；不重新运行 H3。

## 项目包

解压后的目录含 `project.json`、`workflow_api.json` 和片段素材；`runner.py` 与 `run.bat` 可以随包复制。最小清单：

```json
{
  "format": "asmr-video-package",
  "version": 1,
  "projectId": "example",
  "title": "我的视频",
  "characterReference": "references/character.jpg",
  "workflow": "workflow_api.json",
  "shots": [
    {"id": "shot_1", "order": 1, "kind": "speech", "referenceMode": "new", "prompt": "本镜完整 H3 提示词", "durationSeconds": 3.2, "audio": "shots/001/audio.wav"},
    {"id": "shot_2", "order": 2, "kind": "ambient", "referenceMode": "continuous", "prompt": "画面和环境底噪描述，无对白和配乐", "durationSeconds": 5}
  ]
}
```

所有素材路径均相对项目目录。`characterReference` 可省略，执行时另选角色图。每次生成的源时长上限为 **15 秒**，这是本项目的实用上限。对白按实际 WAV 测量，包含采用的后处理尾音；超过上限会明确报错，`durationSeconds` 不裁掉原对白。相同输入 WAV 同时用于 H3 参考与最终视频音轨，画面向上取整到完整的 24 fps 帧。原生模式的环境镜头没有输入音频，使用 H3 生成的环境音，并按计划时长保留；先声音模式改用同候选独立声音，不再统一截为 5 秒。H3 的合法帧数对齐允许 15 秒生成到 362 帧（约 15.083 秒），主参考视频与对应 ASMR 触发音仍按需要的源时长裁取。原音作为音轨来源，不表示 WAV 与编码后视频音轨的字节相同。

需要分次生成的无台词表演附带 `segmentId`、`partIndex` 和 `partCount`，用于标识它属于哪段表演。各段动作和声音阶段由应用预先设计，运行器不自行编造；中途也遵守最多接续两次的独立起镜周期。一个逻辑段的任务必须完整、相邻、顺序正确，缺失时不会提交。新任务声音精确裁到计划秒数，画面向上对齐到 24 fps 整帧，因此每个任务的容器时长可能多不足一帧；旧包仍沿用原有帧数取整。两种合片均包含全部表演段，不会跳过无台词内容。

`workflow_api.json` 是干净的 API 模板，源自 `asmr04`，保留 H3 模型、20 步和原加速链。默认 1216×672、24 fps。模板原文件不改，运行时增加裁帧、CLF 尾帧和 PNG 保存分支；尾帧来自最终 `CreateVideo` 输出。每镜直接注入最终提示词，角色图是 Picture 1；连续镜头的候选 k 使用相邻上一镜候选 k 成功输出的实际尾帧作为 Picture 2。该候选不存在或失败就用角色图继续，不跨镜借帧，也不改用其他候选。首帧延续仍属于 H3 的参考引导，不保证逐像素一致。

## 命令行

```bat
python runner.py "I:\AI\asmr_director\artifacts\我的项目" --comfy-url http://127.0.0.1:8188
python runner.py "I:\AI\asmr_director\artifacts\我的项目" --character-image "I:\角色.png"
python runner.py "I:\AI\asmr_director\artifacts\我的项目" --dry-run
python runner.py "I:\AI\asmr_director\artifacts\我的项目" --only shot_2,003
python runner.py "I:\AI\asmr_director\artifacts\我的项目" --rerun shot_2
python runner.py "I:\AI\asmr_director\artifacts\我的项目" --candidates 3
python runner.py "I:\AI\asmr_director\artifacts\我的项目" --candidates 3 --rerun-candidates "shot_2:2,003:1"
python runner.py "I:\AI\asmr_director\artifacts\我的项目" --candidates 3 --job-timeout 0 --concat
python runner.py "I:\AI\asmr_director\artifacts\我的项目" --append-candidates 1 --concat
python runner.py "I:\AI\asmr_director\artifacts\我的项目" --concat
```

`--candidates N` 指定目标总数，处理候选 1 至 N，校验已有结果并补齐缺项。`--append-candidates N` 从历史最高编号之后追加 N 个完整版本。两种方式任选其一，N 均为正整数。省略这两个参数时，继续上次的范围，首次运行生成一版。追加前可用 `--append-candidates 1 --dry-run` 查看下一版的 payload，正式运行才会占用编号。

`--only` 和 `--rerun` 接受逗号分隔的镜头 ID 或 `order` 编号，分别限定运行范围和要重做的镜头。`--rerun-candidates` 只重做指定候选，例如 `--candidates 3 --rerun-candidates "shot_2:2,003:1"`。镜头 ID 含冒号时按最后一个冒号分隔，例如 `scene:two:2` 表示镜头 `scene:two` 的候选 2。指定镜头、重做画面或重做音效时请使用正常续跑或显式候选总数。所有重做都先对账已有未确认任务。

## 剧情 ASMR 触发音

新镜头的可选字段如下；`prompt` 是独立纯触发音音视频提示词，`durationSeconds` 由导出器写入，运行时仍以对应主镜的实际音频/有效画面时长为准。

```json
"asmrSound": {
  "role": "trigger",
  "prompt": "Close-up of slow fabric brushing. Soft, dry, detailed fabric friction; no voices or music.",
  "durationSeconds": 3.2,
  "mixMode": "overlay",
  "postProcessing": {
    "start": {"pan": -0.5, "distance": "near"},
    "end": {"pan": 0.25, "distance": "close"},
    "movement": "left_to_right",
    "gainDb": -12
  }
}
```

以下为常规与先声音模式；动作延续试验的无台词原声、两路音频参考和成片混音按上节执行。每镜每候选独立生成一条 ASMR 音视频，不输入角色图或对白音频。H3 内部仍按模型要求对齐帧数，输出画面裁至对应时长的完整 24 fps 帧，音轨裁至目标秒数；画面最多多出不足一帧。无对白镜头也生成触发音。原主视频及其音轨保持，ASMR 原生音视频与独立状态保存在 `outputs/asmr/outputs/`。

最终合片使用 API 规划的起点、终点、移动和增益，对生成音效先转单声道，再使用 D 算法重新定位；这一步在生成音视频后才执行。处理结果裁到该段音频长度，再补齐至对应视频帧时长。增益以 dB 控制，混音统一保护峰值，不把后镜声音提前。`mixMode: "overlay"`（旧包默认）将处理声叠加到原轨；`"replace"` 让它作为无台词段的完整声音来源，避免原视频与独立声音重复敲击或叠加底噪。对白段只允许 overlay，已采用人声始终保留。原版预览使用主视频的原生声音，无台词操作段自身就包含所设计的触发声。

有明确用途的声音使用 AsmrDirectorBalancedSpatialAudioV2。前景触发声与已采用的台词取相近的响度，依照材质、距离和响度微调可高于或低于人声。连续动作匹配前段结尾和本段开头的有效发声，整段两耳共用一个增益，保留轻重、停顿及声像变化。安静环境底声保持在背景，极低噪声和纯静音受保护。无用途标记的旧工程沿用其原有增益语义。

N=1 时原版为 `outputs/preview.mp4`，叠加版为 `outputs/preview-asmr.mp4`；N>1 时分别为 `preview-c001.mp4`、`preview-asmr-c001.mp4` 等。两种合片拥有各自的任务回执。常规模式中，缺少音效或 D 节点会阻止增强版合片。动作接续模式的两种合片均需安装新版节点。修复依赖后使用「开始 / 断点继续」恢复对应任务。原生 12 类实验包仍保持独立片段流程。

只改音效提示词会重做对应音效；先声音模式还会更新依赖该音效的无台词画面。在常规模式下，音效 prompt 和时长相同时，调整声音用途、空间设置、增益或 mixMode 会复用音效素材并重新合成 ASMR 版。接续动作的空间或响度变化也会更新相应的画面参考和两种合片。网页切换用途后重新导出会采用该用途的新取音 prompt，因此对应音效会重新生成。`--rerun-asmr 2` 或 `--rerun-asmr-candidates "2:1"` 可重抽 ASMR（原生模式保留主视频，先声音模式更新对应无台词画面），普通 `--rerun` 仍仅重做主视频。所有音效任务也遵守停止、技术重试、未知提交对账和完整历史复用规则。`--dry-run` 会同时生成主镜及音效 payload，不联网。

窗口高级设置也提供「重做 ASMR 镜头」和「重做 ASMR 候选」：分别填写 `2,4` 或 `2:1,4:2`；画面重做使用旁边的画面选项。进度会标明当前正在生成画面、ASMR 触发音、原版合片或 ASMR 叠加版。

更新旧包时，运行器三个文件之外，还需补齐新导出包中的 `custom_nodes/asmr_director_audio/` 才能使用 D 叠加版；无需覆盖旧 `project.json`、工作流或 `outputs/`。旧分镜没有 ASMR 规划时，先在应用生成新分镜并重新导出，而不是在批跑器中自动编造触发音。

## 运行与恢复

`--dry-run` 只读取本地素材、计算时长并保存每镜候选 API payload，不连接 ComfyUI、不执行模型；未提供角色图时保留明确占位值。`--width`、`--height`、`--seed`、`--retries` 可覆盖默认值，详见 `--help`。主视频生成数量约为镜头数 × N；常规模式有 ASMR 规划的镜头各增加 N 条音效视频，动作延续试验只有有台词段增加独立音效任务。原对白音频保持每镜一份，不随候选数复制。

成品视频、原字节下载缓存、原音快照、尾帧、提交 payload 和原子保存的 `run-state.json` 默认保存在**项目文件夹内的 `outputs/`**，可用 `--output-root` 指定其他目录；程序不依赖开发机的盘符。每个镜头的每个候选独立记录任务身份和结果。相同输入已成功的候选会跳过；普通画面连续参考不传播重做，但先声音及动作延续模式会更新明确依赖已变化声音的任务。画面尾帧只认相邻上一镜的同号候选，缺失时自动按独立镜头继续；动作延续的音频依赖则必须成功，不能回退。整批继续执行，不进行质量审核或人工确认。

可在窗口勾选「由 ComfyUI 合并顺序预览」，或添加 `--concat`。每个候选号分别检查全部镜头，只有该号每一镜都有与当前输入一致、文件完整的成功结果才合片，不缺镜拼接。段间留白由导演台直接写入每段交付 WAV 尾部，视频和独立 ASMR 使用同一实际时长，runner 不再额外插入等待；旧包须重新导出才能获得留白，仅升级 runner 不会修改其原 WAV。N=1 保持 `outputs/preview.mp4`；N>1 输出 `outputs/preview-c001.mp4`、`preview-c002.mp4` 等。同号中有缺镜时只跳过该条预览，其他完整候选号可以正常合片。

合片由目标 ComfyUI 的 `LoadVideo`、`ConcatenateVideo`、`SaveVideo` 等节点完成。每镜通过已有 `CLFLoadVideoTailFrames` 实测总帧数，按本包固定 24 fps 计算时长；原生 `LoadAudio`、`EmptyAudio`、`AudioMerge`、`AudioConcat` 将各镜声音补齐或裁到各自画面时长，再作为完整预览音轨，避免短音轨使后镜声音提前。预览会编码音轨，不承诺字节无损；已有单镜成品不变。合片另有独立提交与恢复回执，错误保留已有预览，不触发 H3 重做；结果未变化时跳过重复合片。

**可选合片需要目标 ComfyUI 已有对应原生节点，包括 `ComfyMathExpression`；不是所有版本都有。**缺少这些可选能力时，预览记为 `unavailable`，逐镜成品仍保留。某镜无可解码音轨或合片技术失败时，仅报告预览失败；程序不安装其他节点包作为替代。目标环境首次实际运行前，节点预检通过不等于已经验证其视频编码效果。

Windows 启动器优先使用环境变量 `COMFY_PYTHON` 指定的 Python，其次验证 `py -3` / `python` 的版本。若 ComfyUI 便携包自带 Python 不在 PATH，可直接执行 `"X:\ComfyUI_windows_portable\python_embeded\python.exe" runner.py`，或将 `COMFY_PYTHON` 设为该可执行文件完整路径。程序不会下载或安装 Python。

提交前先保存任务身份和 payload，获得 `prompt_id` 后立即落盘。断网、超时、提交响应丢失时，通过 `/history` 和 `/queue` 对账；无法确认的任务标记 `unknown`，继续下一镜，**不会盲目重复提交**。再次运行会先恢复这些任务。只有明确失败的任务才作有限技术重试，默认重试 1 次；已耗尽的失败任务可用 `--rerun` 重做。对仍无法确认的任务，`--rerun` 也不会绕过对账。

已确认生成成功时会保存远端输出位置和原片 SHA。原片已完整下载时，即使 ComfyUI 离线或已清除 history，也可直接继续按原字节保存成品；需要重新下载时沿用已确认的输出位置，不重新跑模型。尾帧缺失时需连接 ComfyUI 补取，独立对账且不重复生成视频。这里按视频任务恢复，不恢复模型采样到一半的计算；远端输出也丢失且本地原片不完整时会保留待恢复状态。

技术重试沿用该候选的 seed；明确重做会换 seed，并保留旧结果和回执历史。若本次先恢复了未确认任务，得到的同输入结果会先保留，不在恢复后立即再抽一次；需要另抽时再次明确重做即可。

提示词、基础 seed 等输入改回原值时，会校验并复用相同输入的完整历史结果。想给指定候选重抽某一镜，可使用对应的重做设置；想为全部镜头另抽一套，可直接追加新版本。基础 seed 与历史任务碰撞时会自动分配稳定的新种子。已有成片被外部修改而无法复用时，恢复保存或新生成均另存。

## 等待、进度与停止

窗口显示当前镜头／候选、远端阶段、完成数和用时。状态心跳默认每 15 秒一次；即使单次 HTTP 请求仍在等待，窗口自己的计时器也会继续刷新。后台事件队列有数量上限；日志跟随底部时保留最近约2000行，选取或向上查看期间暂缓裁去旧行。

日志可用「复制全部日志」「复制选中」、右键菜单或日志区的 Ctrl+A／Ctrl+C 复制；新日志不抢已有选区，手动向上查看时不强制滚回底部。

最长任务等待默认 **0，表示健康连接时不设总时限**，不会仅因生成超过一小时就重发。窗口单位为分钟，命令行 `--job-timeout` 单位为秒；设为正数表示只限制本地等待，到时保留任务身份，下次对账继续。单次 HTTP 请求超时用 `--request-timeout`，默认 30 秒；已提交任务等待／对账期间，持续断线达到 `--disconnect-timeout`（默认 300 秒）后记为待恢复并继续后续任务。提交前节点预检的网络错误则报告该候选输入错误并继续，不消耗这段断线等待。`--heartbeat-interval` 可调状态心跳间隔。网络超时、排队和模型技术失败分别记录，无法确认的提交不会作为失败任务自动重试。

「停止」位于窗口顶部「再生成一版」旁。点击后停止本地后续提交和等待，保留已提交任务身份，远端当前任务继续运行。下次把总数留空，点「开始 / 断点继续」即可恢复该批。关闭运行中的窗口会说明任务恢复规则，命令行按 Ctrl+C 会给出恢复提示并返回退出码 130。

状态里的素材快照、payload 和输出路径相对于 `outputs` 保存。移动或复制项目时保留整个 `outputs/`，即可在新目录继续；使用外置 `--output-root` 时也应完整搬走该输出目录并指定它。临时缺少输入 WAV 会单独报告 `input_error`，保留已成功任务的回执；恢复文件后不会因此重复生成。

程序通过 `/object_info` 检查所需节点，并使用 `/upload/image` 的普通文件上传接口上传角色图、音频、尾帧及需要补尾帧／合片的旧视频；上传字段均叫 `image`。若远端反向代理限制上传大小或类型，需要先调整该服务配置。输出从 SaveVideo 节点 26 的结果读取，经 `/view` 下载并按原字节保存，本机不再进行媒体封装或编码。目标 ComfyUI 的 PyAV／编码库仍属于其自身环境，无需安装到运行器本机。

## 测试

以下命令在开发仓库根目录运行；三文件更新包不携带测试源码。

```bat
python -m unittest discover -s tools/comfy-batch -p "test_*.py" -v
```

测试使用本地模拟 HTTP 服务和合成的小 WAV，不调用模型。
