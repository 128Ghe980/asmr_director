import { z } from "zod";
import { AudioPostProcessingAnchorSchema, AudioPostProcessingMovementSchema } from "./audio-post-processing-schema";

/** The source duration is measured by the server/exporter, never chosen by the model. */
export const AsmrSoundSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  // Explicit roles opt into purpose-specific prompts and measured loudness balancing.
  // Saved plans without a role retain their original rendering and mixing behavior.
  role: z.enum(["trigger", "ambience"]).optional(),
  // Missing means the original overlay behavior. Performance-only sound may replace
  // the main video's native track, avoiding two copies of the same contact sound.
  mixMode: z.enum(["overlay", "replace"]).optional(),
  postProcessing: z.object({
    start: AudioPostProcessingAnchorSchema,
    end: AudioPostProcessingAnchorSchema,
    movement: AudioPostProcessingMovementSchema,
    gainDb: z.number().finite().min(-36).max(6),
  }).strict(),
}).strict();
export type AsmrSound = z.infer<typeof AsmrSoundSchema>;

/** Reference-free H3 T2VA; only its generated sound is used in the main video's overlay. */
export function renderAsmrSoundH3Prompt(sound: AsmrSound): string {
  const { prompt, role } = AsmrSoundSchema.parse(sound);
  if (role === "ambience") return [
    "integrated_multimodal_description: [Shot 1] A quiet ASMR ambience recording for relaxation and sleep. One continuous static view of the specified setting, without a hand performance or staged object handling. " + prompt + " Preserve the described natural background texture and intentional stillness; do not introduce tapping, rubbing, brushing or other foreground actions.",
    "overall_soundscape: Only the specified soft, stable environmental ambience, with no added foreground foley. Keep its natural quietness and avoid sudden events, hiss effects or dramatic changes. No speech, whispering, vocal sounds, dialogue, voice-over, breathing, mouth sounds, singing or music. Do not add artificial panning or long reverb; spatial placement and level are applied after generation.",
    "non_diegetic_music: N/A",
  ].join("\n\n");
  if (role === "trigger") return [
    "integrated_multimodal_description: [Shot 1] A dedicated close-miked ASMR trigger recording for relaxation and sleep. One fixed live-action macro or close-up view shows only the specified sound-producing material and the hands or tool needed to operate it. " + prompt + " Show real physical contact and the small material response that produces each sound, in a calm, deliberate performance. Keep the contact clearly visible and synchronize each sound onset, texture change and release to that contact. Preserve the specified rhythm, quiet pauses and ending; do not add extra actions. The performer remains silent.",
    "overall_soundscape: The specified foreground ASMR texture is softly present and clearly audible, with its material-specific attack, fine detail and natural short decay. Preserve gentle differences within the action rather than replacing them with a uniform rustle or broadband hiss. Room tone stays below the trigger. No harsh impacts, exaggerated crackles, cinematic effects or added layers. No speech, whispering, vocal sounds, dialogue, voice-over, breathing, mouth sounds, singing or music. Record clean and close with little room reverberation; spatial movement and level are applied after generation, so do not add artificial panning or long reverb.",
    "non_diegetic_music: N/A",
  ].join("\n\n");
  return [
    `integrated_multimodal_description: [Shot 1] One continuous close view of the sound-producing material and its gentle action. ${prompt} Keep any person silent and frame only the relevant objects or hands. Match audible contacts to the visible action; allow natural quiet gaps and a gentle settling moment near the end. No speaking or lip performance.`,
    "overall_soundscape: Only the described quiet ASMR material sounds, recorded dry and clear with restrained peaks and minimal room tone. No speech, whispering, vocal sounds, dialogue, voice-over, singing or music. Do not imitate or reproduce a spoken line. Spatial movement and level will be applied after generation; do not add artificial panning or long reverb.",
    "non_diegetic_music: N/A",
  ].join("\n\n");
}

/** Shared by script creation and rewrites, before individual sound tracks are designed. */
export const ASMR_SOUND_PALETTE_GUIDANCE = [
  "声音内容以ASMR放松、助眠的近录体验组织：微小触发清楚可听，起落柔和、节奏从容、停顿自然，不等于把所有声音写成几乎听不见的沙沙底噪，也不要求对白一律催睡。",
  "先对照全稿相邻soundSuggestions安排声音差异，再写每段：给实际触发写一个具体材质、可制作的接触方法、可辨的音色和节奏变化。区别短促圆润的点触、连续细腻的摩擦、柔软纤维的扫动、薄纸压折与松开的轻脆层次；这些只是辨别方法，不是每稿必须出现的道具清单。材料和动作必须服务当前主题，不随机新增道具、任务或剧情。",
  "持续试听时在同一材料或手势内改变接触部位、压力、疏密或分组，仍保留同一声源身份；不能只把soft/delicate/gentle或中文近义词互换就算新声音。相邻两段若手势、材质、音色和节奏都相同，应合并或在合理动作内给出可听的变化，不靠重复一遍凑时长；拆开、递交等一次性动作仍只完成一次。",
  "主画面空手表演时，soundSuggestions写供独立取音的具体材料接触与可听效果，真实材料只在声音素材视频中出现；不把主画面的无实物限制写成声音也不能接触材料。纯凝视、等待和无触发过渡保持安静环境，不为了多样性强行加声。",
].join("\n");

export const ASMR_SOUND_PRODUCTION_GUIDANCE = [
  "独立取音以ASMR relaxation and sleep为录制目标，像专门的材料ASMR视频而非泛化电影拟音。trigger的英文prompt写清一个主声源：具体材料/表面、真实接触方法、微小形变或释放、可辨音色及起音—持续纹理—衰减、节奏与安静间隙。例子仅说明精度：软棉针织层间慢擦是低而细的shff，薄糖纸打开是轻脆褶皱逐渐展开；不能把所有动作都概括成soft dry fabric-like friction。只用当前声音意图支持的材料，不照搬例子。",
  "声音素材视频单独拍真实发声材料与必要手部/工具的稳定微距或近景，让声音有看得见的物理来源；空手规则只约束主视频。即使主画面模拟轻点，独立拟音也应实际点触合适表面；不在asmrSound.prompt写empty-handed、imaginary material或without actual contact来阻止发声，不把取音素材的物体带入主画面。",
  "soundIntent中的‘像/如/拟音’是音色目标，写asmrSound.prompt时必须落实成该材料的实际接触过程，而非重复brush-like/cloth-like。比如刷扫需要刷毛落到表面、接触弯曲、扫过后抬离，起音来自接触而不是抬手；不能沿用主角色hands rise、return to chest等无接触表演来解释发声。只将已定接触节奏映射给取音操作，不增加主画面动作。",
  "保持轻柔但清楚可辨的近录细节，不反复用barely audible/almost silent限制实际触发声；强弱来自自然接触，不使用夸张爆裂、电影冲击或持续白噪声替代材质。停手和抬离时停止相应声响，按当前已定段内动作时序安排起止，不自行增加总时长、次数或新事件。纯环境声保持自然低底，不能套手部接触画面。",
  "先确认本段主动作的接触事件数：一次向外扫后收手就是一轮接触，左右同时操作不是先后两轮；除非当前文案明确重复，不能写repeats once more/another pass来填充时长。剩余时间可以安静。真实取音工具数量要与同时接触的位置一致。",
  "对照scriptOrder中邻近段的performance.soundIntent和directorNotes.soundSuggestions，检查当前材质、触发方法、音色与节奏是否有实际区别。忠实细化当前意图，不把邻段音色移植过来；若同一任务连续发展，保持声源身份，只表现本段的接触阶段和变化。不要无原因复制每段同样的先抬手—持续沙沙—收手声音。",
].join("\n");

export const ASMR_SOUND_ROLE_GUIDANCE = [
  "每个新asmrSound及parts中的asmrSound都显式填写role：trigger表示要听清的材料/操作触发音，ambience表示环境底声或安静留白；不是按有无台词分类，台词期间真实发生的触发也可为trigger。",
  "当前performance.soundIntent或soundSuggestions明确安排安静室内、环境底声或留白时，用ambience并保留安静；不能仅因画面有抬手、微笑或收手就自行追加袖口摩擦、皮肤触碰等trigger。只有当前已安排了具体材料接触和可听触发意图，才设计对应的trigger。",
  "有role的声音会在实际生成后测量并按用途平衡响度。postProcessing.gainDb只表达有意的轻重微调：trigger通常-12为中性，ambience通常-30为中性；围绕该基准作小幅调整，不根据未听到的生成素材猜音量，不因换了材料就任意选相差很多的数值。自然停顿和近静音不需要抬高，也不把主触发写成极远极轻。",
].join("\n");

export const ASMR_SOUND_PLANNING_GUIDANCE = [
  "每镜必须另给 asmrSound：它是与本镜等长、独立生成后用于叠加的 ASMR 触发声音轨，不改变本镜原有 fully_copy/环境声音轨。对白镜头与无对白镜头都必须有，不能因为没有对白而省略。",
  "asmrSound.prompt 用一段具体英文描述本镜真实可成立的触发材料、接触动作、柔和音色和节奏/停顿；可说明动作在镜头前段、中段或后段发生，但不要编造秒数、总时长或次数。不复述对白、不写场景旁白、不引用 S1、Picture、Audio 或输入素材标签，不返回H3字段标题。只有当前剧情动作确实发生时才安排对应声响；不提前播放未来动作、不重演已完成事件，也不无缘由安排刷子、敲击、耳部护理或新道具。没有接触动作时保留符合场景的安静环境质感，不为了填满声音轨追加衣料摩擦或细小活动。",
  "ASMR 声音必须无对白、无低语、无人声、无歌声、无配乐；即使剧情台词要求说话，触发声音轨也不能复现它。该独立视频只用于提取触发声，可用材料和手部近景，不能替换主视频的画面设计。声音生成保持干净、近录和少混响，空间效果留给 postProcessing。",
  ASMR_SOUND_PRODUCTION_GUIDANCE,
  ASMR_SOUND_ROLE_GUIDANCE,
  "asmrSound.postProcessing 由你按声源物体相对听者的实际位置规划：start/end 的 pan 是听者左右（-1左、0中、1右），distance 用 far/mid/near/close/very_close；movement 使用给定枚举。相机放大、镜头推近或画面特写不等于声源靠耳。无真实位移时用static且start=end；approach/recede遵守远近变化，左右移动与pan端点一致。只在本镜动作支持时移动声源；连续同一触发物体应承接前镜终点。声音留在本镜实际时长内，不添加段后等待。",
].join("\n");
