import type { CreativeTemplate } from "./reference-template";

/** Explicit snapshot capability: saved templates without it keep their original staging. */
export function usesCameraPantomime(template: CreativeTemplate | undefined): boolean {
  return template?.visualPerformance === "pantomime";
}

/** Even a negated imaginary target can become a visible object in downstream video generation. */
export function hasImaginedPantomimeTarget(shot: { visual: string; action: string; camera: string;
  parts?: { visual: string; action: string; camera: string }[] }): boolean {
  return [shot, ...(shot.parts ?? [])].some(part => [part.visual, part.action, part.camera]
    .some(text => /\b(?:invisible|imaginary)\b|\bas if (?:holding|opening|touching|grasping|handling)\b/iu.test(text)));
}

export const CAMERA_PANTOMIME_GUIDANCE = [
  "visualPerformance=pantomime：本模板必须采用对镜头的空手无实物表演。台词可以保留‘替你整理领子、扫脸、拨头发、捏脸’的剧情意图；scene、direction、visual、action、camera则写S1真实可拍的身体动作，不能把剧情中的被照顾对象变成可见实体。",
  "主画面唯一人物是S1，完整头脸、上半身和连接身体的双臂保持同框，双手空着；听者只由镜头位置代表，始终不出现听者身体局部、衣物、头脸、头发、手或替身。操作空间为空，不添加道具、真实工具、被持物、模特或透明/隐形实体。角色自己的外貌服装仍来自参考图。",
  "visual只正面描述S1、空手、姿态及简单稳定背景，不在visual/action中枚举或反复否定剧情目标名词。action必须写清空手的手指形状、移动轨迹、停顿和回位：例如在镜头前下方的空气中双手轻捏再向两侧舒展；用空指尖在镜头左前方缓划再换右侧；在镜头前上方轻拢后向侧面拨开；双手在镜头两侧轻合指尖。不能改成整理S1自身衣物、头发或脸，也不能写手实际触到镜头或某个隐藏表面。",
  "操作位置统一以镜头为坐标：双手向前伸到S1与镜头之间的空中，按任务位于镜头上沿、下沿或左右侧附近，同时与镜头保留空隙；不要用her forehead、her cheeks、beside her face等S1自己的身体部位定位操作。S1胸前只可作为开始或结束的休息手位。手指合拢后仍是空的，不写holding an invisible strand/object、imaginary face或as if touching等虚构实体；直接写指形、轨迹和镜头方位。",
  "机位固定为正面中近景，S1的表情和手势共同可读；小幅前倾或抬手由S1自己完成，相机不跟随、不低头找目标、不切局部特写或反打。双手靠近时仍有空气间隔，不遮满画面，S1的头脸保持可见。有台词时S1口型配合当前TTS，无台词时不做口型表演。",
  "声音是与模拟手势同步的后配拟音：soundSuggestions/ambientSound/asmrSound可描述柔和布料摩擦、刷扫或触碰质感及节奏，明确为配合空手表演的foley，不能为解释声音给主画面补实体接触。独立asmrSound视频只取音，所需发声材料不属于主画面道具。纯对视或等待仍可安静，不凭空加触发音；手势左右位置与声位相符，不加入人声、呼吸、口腔音或音乐。",
].join("\n");
