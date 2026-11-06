import { z } from "zod";
import { AudioPostProcessingAnchorSchema, AudioPostProcessingMovementSchema } from "./audio-post-processing-schema";

/** The source duration is measured by the server/exporter, never chosen by the model. */
export const AsmrSoundSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  // Explicit roles opt into purpose-specific prompts and measured loudness balancing.
  // Saved plans without a role retain their original rendering and mixing behavior.
  role: z.enum(["trigger", "ambience"]).optional(),
  // Explicitly authored continuation, resolved against timeline order at export.
  continuation: z.literal("previous-silent").optional(),
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

/** Structural eligibility only; the script/design must establish an unfinished shared action. */
export function getAsmrContinuationProblem(sound: AsmrSound | undefined, kind: string | undefined,
  previous?: { kind?: string; asmrSound?: AsmrSound; parts?: { asmrSound: AsmrSound }[] },
  allowUndesignedSource = false): string | undefined {
  if (!sound?.continuation) return undefined;
  if (kind !== undefined && kind !== "speech") return "只有有台词段可以延续上一无台词段的 ASMR 动作。";
  if (sound.role !== "trigger" || sound.mixMode === "replace") return "延续 ASMR 动作须使用 trigger 声音并保留台词。";
  if (previous?.kind !== "silent") return "延续 ASMR 动作需要紧邻的上一段为无台词段。";
  if (allowUndesignedSource && !previous.asmrSound && !previous.parts) return undefined;
  const source = previous.parts?.length ? previous.parts.at(-1)!.asmrSound : previous.asmrSound;
  if (source?.role !== "trigger") return "请先将上一无台词段末段的声音设计为实际 ASMR 触发音。";
  return undefined;
}

export const ASMR_ACTION_CONTINUITY_GUIDANCE = [
  "不要把有台词与ASMR动作机械拆成纯说话、纯操作。若本段speech的direction与soundIntent明确继续紧邻上一silent段尚未结束的同一持续触发，画面和声音同时承接该动作，填写asmrSound.continuation=\"previous-silent\"且role=trigger、mixMode=overlay。镜头referenceMode可为new，独立起镜也能延续动作与声源；音频延续不依赖尾帧。",
  "该标记只用于已有脚本明确的持续动作跨段，如轻敲、慢擦、轻扫。上一silent段应结束于仍在操作的状态，当前speech一边继续一边说话，不重新取物、举手开场或重演上一段全部过程；只在当前计划结束的段落收手。主声源材质、接触方法和相对位置一致，节奏可自然放缓以容纳说话。",
  "上一段动作已经结束、只保持物件或姿势、纯评论/邀请/等待、已经递出或拆完的一次性操作、换材料或换任务时省略continuation。不能仅凭手位、材质或机位相同就建立声音引用；不引用未来、隔段或另一个speech，也不把安静环境当成持续触发。无台词段及parts均不得带continuation。",
  "标记只是音色与持续操作的来源关系，不是复制上一段音频：新音效须按当前段实际时长重新演奏当前阶段，不照搬旧音轨、对白或上一段收尾；对应视频包选择动作延续试验时才使用该音频来源。普通导出仍按各段现有生成方式。",
].join("\n");

/** Applied to new scripts and repairs; silent-only requests and completed one-shot tasks remain intact. */
export const ASMR_ACTION_CONTINUITY_CREATION_CHECKLIST = "【边做边说必须落到实际段落】本稿有台词、且主题允许敲击/摩擦/轻扫等持续ASMR时，必须从现有材料或手势中选一个，输出至少一组紧邻的silent→speech。不能把全部试听都写成先收手、放下，再纯说话。silent结束时接触动作仍在进行，speech从同一手位持续同一操作并同时说话，操作和触发声贯穿该speech说话的主体时间；两个direction和soundSuggestions都写明连续的材质、接触节奏与位置，直到该speech说完或后续指定位置才收手。只保持持物不动、只评论声音、开头或末尾补两下、说话时换道具，都不算这一组。尤其不能direction写停着而soundSuggestions声称延续，两者必须匹配。用户明确要求全程无台词/说话停手或主题只有一次性动作时不强造；拆开、递出、取放完成一次即结束。保留其他合理的纯说话、纯试听和安静段，不让每句都配动作，不增加预算或修改局部改写范围外的段落。";

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

/** Repeat this conditional creation rule after the schema and during whole-draft repair. */
export const ASMR_SOUND_SPATIAL_CREATION_CHECKLIST = "【声音空间自检】若全稿至少3段ASMR触发试听，其中至少一种操作适合边发声边移动，且用户没有要求声源固定，至少1段必须在持续发声的同时完成一次明确的左到右或右到左单向移动；不要求3段都能持续移动。direction与soundSuggestions中同时写清相对听者的起点—移动中持续触发—终点。先把物件搬近、摆到另一边后原地发声，不算发声时移动。固定机位不等于声源固定；明确要求声源固定时遵循用户要求，不增加时长或强套orbit。";

/** Shared by script creation and rewrites, before individual sound tracks are designed. */
export const ASMR_SOUND_PALETTE_GUIDANCE = [
  "声音内容以ASMR放松、助眠的近录体验组织：微小触发清楚可听，起落柔和、节奏从容、停顿自然，不等于把所有声音写成几乎听不见的沙沙底噪，也不要求对白一律催睡。",
  "先对照全稿相邻soundSuggestions安排声音差异，再写每段：给实际触发写一个具体材质、可制作的接触方法、可辨的音色和节奏变化。区别短促圆润的点触、连续细腻的摩擦、柔软纤维的扫动、薄纸压折与松开的轻脆层次；这些只是辨别方法，不是每稿必须出现的道具清单。材料和动作必须服务当前主题，不随机新增道具、任务或剧情。",
  "持续试听时在同一材料或手势内改变接触部位、压力、疏密或分组，仍保留同一声源身份；不能只把soft/delicate/gentle或中文近义词互换就算新声音。相邻两段若手势、材质、音色和节奏都相同，通常合并或给出合理变化；但silent先试听→speech边做边说可保留同一持续动作，两段合起来是一次连贯操作，不能在边界收手重开。拆开、递交等一次性动作仍只完成一次。",
  ASMR_ACTION_CONTINUITY_CREATION_CHECKLIST,
  ASMR_SOUND_SPATIAL_CREATION_CHECKLIST,
  "声音的空间变化在创意阶段安排，不能等到后处理时才凭空加移动。另1段若适合可设计持续发声时逐渐靠近或远离，但不强求第二段移动。只用主题已有的操作和合理手势，不增加道具、重复动作或时长来满足空间变化。固定摆放、一次落杯、纯环境和安静留白仍保持静止。",
  "移动段必须在direction与soundSuggestions中同时写清相对听者的起点—移动中持续触发—终点，两个字段使用一致的左右/远近方向，结束停在路径终点，不默认又回到正中。只是先把物件搬近、摆到另一边后原地发声，不算发声时移动；手指在固定物件表面换接触点，也不等于整个声源横过听者。真实材料声或无实物表演的拟音都要有相应动作依据。只有声音意图确实支持绕听者一圈时才设计orbit，不为多样性强套环绕。局部改写只处理当前允许改写的段，不为整稿空间安排改动其他段或已确认的时长。",
  "每段声音后处理目前只有一条贯穿整段的连续轨迹，创意中的主要声音操作优先设计为一个声源的一次完整路径，或固定位置的节奏变化；不要依赖多次左右往返、精确时点换向或双耳同时独立声源才能成立。物件/拟音路径写在soundSuggestions并对应direction，人声group.position单独保持合理位置；不让角色为了物件声的移动而反复靠近或环绕。",
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

/** One source follows one whole-clip trajectory; camera and voice remain independent. */
export const ASMR_SOUND_SPATIAL_GUIDANCE = [
  "asmrSound.postProcessing规划这一个主声源相对听者的空间路径，必须与当前soundIntent/soundSuggestions、动作和声音描述相符。固定机位不等于固定声源；主画面的相机推近、手部特写、抬手或表情变化也不等于声音靠耳。无实物表演可让拟音位置跟随已确定的模拟手势，不需要新增真实物件；角色人声位置与拟音位置独立。",
  "start/end.pan使用听者左右坐标（-1左、0正前、1右），distance从远到近依次为far、mid、near、close、very_close。static必须start=end；left_to_right必须start.pan<end.pan，right_to_left必须start.pan>end.pan，通常保持相同距离；approach必须终点距离更近，recede必须终点距离更远，通常保持相同pan。不要用相同端点伪称横扫或靠近。",
  "orbit表示主声源真正绕听者头部一整圈，orbit_approach表示绕一整圈同时逐渐靠近。只在当前声音意图明确支持、且段内能从容完成时使用；完整一圈设置相同的start/end.pan，orbit保持相同distance，orbit_approach的end.distance更近。镜头前画小圆、在同一表面揉擦、左右手交替操作或摄影机环绕都不等于声源绕听者，不能因此填写orbit。",
  "当前每条声音只支持一条贯穿整段的平滑轨迹，不支持在指定时点停留或换向、多次左右往返、两个同时独立定位的声源。左右手轮流接触同一固定表面仍可static；不能把左右两处交替发声伪装成一次left_to_right，也不能把一次单向扫动填成正中static。已有脚本含复杂接触顺序时保留接触事件和节奏，不增删动作、不拆段或延长时间来迁就后处理；只选择整段确实成立的一条整体路径或固定声位，不宣称已实现逐次换向/双源定位。",
  "原始asmrSound.prompt仍以干净近收音的材质、接触动作、节奏和安静间隙为主，不要求生成器制作binaural、人工pan或循环环绕；空间位置由postProcessing实现，不能只在英文prompt写left/right或ear-to-ear而把对应postProcessing留成正中static。安静环境/留白通常保持static，不为了多样性移动整个房间底声。",
  "输出前核对声音意图、主动作、英文prompt与postProcessing的起点/方向/终点：静止与移动描述不矛盾，同一连续声源承接前段终点，不因每段开始而跳回正中。主触发的方向变化必须来自本段动作，不强制每段移动或环绕；声音保持在本段实际时长内，不添加段后等待。",
].join("\n");

export const ASMR_SOUND_PLANNING_GUIDANCE = [
  "每镜必须另给 asmrSound：它保存与本镜等长的 ASMR 声音意图和后处理，不改变已采用台词。对白镜头与无对白镜头都必须有，不能因为没有对白而省略；默认独立取音，动作延续试验中无台词主视频直接出声，紧接的持续动作台词段才引用该声音生成当前音效并混合台词。",
  "asmrSound.prompt 用一段具体英文描述本镜真实可成立的触发材料、接触动作、柔和音色和节奏/停顿；可说明动作在镜头前段、中段或后段发生，但不要编造秒数、总时长或次数。不复述对白、不写场景旁白、不引用 S1、Picture、Audio 或输入素材标签，不返回H3字段标题。只有当前剧情动作确实发生时才安排对应声响；不提前播放未来动作、不重演已完成事件，也不无缘由安排刷子、敲击、耳部护理或新道具。没有接触动作时保留符合场景的安静环境质感，不为了填满声音轨追加衣料摩擦或细小活动。",
  "ASMR 声音必须无对白、无低语、无人声、无歌声、无配乐；即使剧情台词要求说话，触发声音轨也不能复现它。该独立视频只用于提取触发声，可用材料和手部近景，不能替换主视频的画面设计。声音生成保持干净、近录和少混响，空间效果留给 postProcessing。",
  ASMR_SOUND_PRODUCTION_GUIDANCE,
  ASMR_SOUND_ROLE_GUIDANCE,
  ASMR_SOUND_SPATIAL_GUIDANCE,
  ASMR_ACTION_CONTINUITY_GUIDANCE,
].join("\n");
