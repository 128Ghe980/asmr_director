import { z } from "zod";
import { AudioPostProcessingAnchorSchema, AudioPostProcessingMovementSchema } from "./audio-post-processing-schema";

/** The source duration is measured by the server/exporter, never chosen by the model. */
export const AsmrSoundSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
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
  const { prompt } = AsmrSoundSchema.parse(sound);
  return [
    `integrated_multimodal_description: [Shot 1] One continuous close view of the sound-producing material and its gentle action. ${prompt} Keep any person silent and frame only the relevant objects or hands. Match audible contacts to the visible action; allow natural quiet gaps and a gentle settling moment near the end. No speaking or lip performance.`,
    "overall_soundscape: Only the described quiet ASMR material sounds, recorded dry and clear with restrained peaks and minimal room tone. No speech, whispering, vocal sounds, dialogue, voice-over, singing or music. Do not imitate or reproduce a spoken line. Spatial movement and level will be applied after generation; do not add artificial panning or long reverb.",
    "non_diegetic_music: N/A",
  ].join("\n\n");
}

export const ASMR_SOUND_PLANNING_GUIDANCE = [
  "每镜必须另给 asmrSound：它是与本镜等长、独立生成后用于叠加的 ASMR 触发声音轨，不改变本镜原有 fully_copy/环境声音轨。对白镜头与无对白镜头都必须有，不能因为没有对白而省略。",
  "asmrSound.prompt 用一段具体英文描述本镜真实可成立的触发材料、接触动作、柔和音色和节奏/停顿；可说明动作在镜头前段、中段或后段发生，但不要编造秒数、总时长或次数。不复述对白、不写场景旁白、不引用 S1、Picture、Audio 或输入素材标签，不返回H3字段标题。只有当前剧情动作确实发生时才安排对应声响；不提前播放未来动作、不重演已完成事件，也不无缘由安排刷子、敲击、耳部护理或新道具。没有显著接触动作时，选符合场景的微弱衣料摩擦、细小自然活动或安静环境质感，避免密集强刺激。",
  "ASMR 声音必须无对白、无低语、无人声、无歌声、无配乐；即使剧情台词要求说话，触发声音轨也不能复现它。该独立视频只用于提取触发声，可用材料和手部近景，不能替换主视频的画面设计。声音生成保持干净、近录和少混响，空间效果留给 postProcessing。",
  "asmrSound.postProcessing 由你按声源物体相对听者的实际位置规划：start/end 的 pan 是听者左右（-1左、0中、1右），distance 用 far/mid/near/close/very_close；movement 使用给定枚举，gainDb 为叠加音量（通常 -18 到 -6 dB，按素材克制选择）。相机放大、镜头推近或画面特写不等于声源靠耳。无真实位移时用static且start=end；approach/recede遵守远近变化，左右移动与pan端点一致。只在本镜动作支持时移动声源；连续同一触发物体应承接前镜终点。声音留在本镜实际时长内，不添加段后等待。",
].join("\n");
