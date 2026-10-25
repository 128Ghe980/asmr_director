import { z } from "zod";
import { AsmrProjectSchema } from "./schema";
import { completePlannerJson, PlannerError, type PlannerChatMessage } from "./planner-provider";
import { getStoryboardReviewClips, getStoryboardReviewFingerprint, getStoryboardReviewSummary, pickStoryboardReviewFields,
  StoryboardReviewSchema, type StoryboardReview } from "./storyboard-review";
import { readVideoPlanningRequest, videoPlanningError, videoPlanningTimeout, type VideoPlanningOptions } from "./video-planning-request";
import { ClipVideoStoryboardSchema } from "./video-plan";

export const StoryboardReviewRequestSchema = z.object({ project: AsmrProjectSchema, editableClipIds: z.array(z.string().min(1).max(200)).max(400) }).strict();
export type StoryboardReviewRequest = z.infer<typeof StoryboardReviewRequestSchema>;
// Match saved storyboard bounds while keeping prompt brevity as writing guidance.
const GeneratedFieldsSchema = z.object({ title: z.string().trim().min(1).max(120).optional(),
  visual: z.string().trim().min(1).max(ClipVideoStoryboardSchema.shape.visual.maxLength!).optional(),
  action: z.string().trim().min(1).max(ClipVideoStoryboardSchema.shape.action.maxLength!).optional(),
  camera: z.string().trim().min(1).max(ClipVideoStoryboardSchema.shape.camera.maxLength!).optional(), ambientSound: z.string().trim().max(600).optional() })
  .strict();
const GeneratedReviewSchema = z.object({ changes: z.array(z.object({ shotNumber: z.string().regex(/^\d{3}$/),
  reason: z.string().trim().min(1).max(600), after: GeneratedFieldsSchema.optional() }).strict()).max(400),
  notes: z.array(z.string().trim().min(1).max(600)).max(200) }).strict();
export function readStoryboardReviewRequest(request: Request) { return readVideoPlanningRequest(request, StoryboardReviewRequestSchema, "整批校对分镜"); }
function check(signal?: AbortSignal) { if (signal?.aborted) throw new PlannerError(499, "整批分镜校对已取消。"); }
function messages(input: StoryboardReviewRequest): PlannerChatMessage[] {
  const editable = new Set(input.editableClipIds);
  return [{ role: "system", content: [
    "校对同一剧情整批 ASMR 视频分镜，交付可直接应用的最小文字修正。一次阅读全部脚本顺序及已有实际分镜：若 editable=true 的镜头有实质问题且可在允许的文字字段内解决，必须直接给出最小 changes 补丁，不得只在 notes 写‘建议修改’却不给 after。每个补丁只含 shotNumber、简短 reason、稀疏 after 文字对象；after 至少一个真正改变的字段，未改字段省略，before 由服务器从当前镜头补入，其他原字段也由服务器合并。不要复制整段原文当作修改，不要靠改标题镜号凑变化。",
    "notes 仅用于 editable=false 的受保护镜头问题、需要改变引用模式/新增镜头等本轮不能解决的问题，或必要的不确定性说明。不要把可编辑且可修复的问题全推给 notes。跨相邻镜头的可修问题，应同步返回必要的多个最小补丁；没有实质问题的镜头保持原样，无改条目完全省略，不要列‘无需修改’条目或空after。不要求凑修改数量，不打分、不重写全稿。",
    "shots 数组已经按真实脚本顺序提供，order 是顺序编号，shotNumber 是补丁唯一键，为输入给出的三位显示镜号。只复制该镜头的 shotNumber，并按 order 排列；不得返回 clipId，服务器负责映回原工程标识。notes 提到镜头也只使用输入 shotNumber；不得从旧 title 推断镜号，不能编造镜号、补齐缺号或引用数组之外的镜头。",
    "检查道具接取/递交/放下及去向、人物与听者的位置和可用座位、重复重启动作、动作完成状态、时长内动作可行性及构图能否看见关键对象。保持简单可执行的自然动作，不强造动作；允许坐着不动、正常说话和自然情绪手势。已有道具可以开镜已手持或位于合理画外，不必逐物补来源；只修实际矛盾或影响剧情的关键状态缺口。若前镜毛巾尚在手中、后镜改双手持杯，可在可编辑镜内明确最小递出/放下状态；若前镜已坐在单人椅上，不应又邀请听者坐同一把占用的椅子。短镜只安排局部可完成交接，不让听者完整脱衣等复杂过程挤进几秒。",
    "Visual 是开镜状态，Action 是本镜发生的事件及终态，二者必须互相一致：开镜已经持杯时，不要再安排从桌上取同一只杯；开镜已经坐好时，不要在Action里重复坐下。如果前镜交杯结束，下一镜 Visual 不能还写S1持着已交出的杯；需要时同步最小修改该镜visual与action，而不是只在action末尾加hands empty却保留visual持杯。明确交接后，后续无冲突镜头不必反复加empty hands或重复解释去向。道具已有合理初始状态时不强补来源，不为短镜新增多步骤取物过程。",
    "先辨别台词的时间与语气：未来计划、条件、回忆、描述或邀请不等于现在执行整件事，也不排斥当前合理的谈话手势。谈‘可以一起做饭’时轻指厨房、谈‘闷了在窗边看雪’时看向窗户或示意窗边、谈星星时指向窗外都合理；不得把这些合理动作一律改成泛化的微笑或点头。‘有时能看到极光’不要求当前出现极光；手贴胸口等有情绪依据的动作不因未逐字对应台词就判错。‘给我’可为邀请，若设计交接完成，应写清道具新状态，下一镜从该状态承接。",
    "通用示例：前镜只是伸出毛巾，后镜改为双手拿杯；毛巾镜可编辑时，应具体写交给听者并让S1双手空出的终态。该镜的稀疏after可为 {\"action\":\"S1 passes the cloth into the listener's hands, releases it and ends with both hands empty.\"}；其他字段省略。返回该镜在实际输入中的shotNumber；示例不指定镜号，不要求照搬物品、句子或给所有镜头加动作。",
    "不得修改台词、音频、时长、镜头顺序、角色身份、referenceMode或任何来源metadata。连续模式延续当前状态，可在已确定的场景内自然调整动作，不要求反复复制前镜起始姿态。new镜头允许开镜直接坐好，不要求补站立、走路或坐下过程；已有合理坐姿时保留。若问题需要改变引用模式或新增镜头，只在notes说明，不代改。画面保持人物参考外貌服装；对白期间口部可见，不遮嘴或长时间背身。",
    "title可中文；visual/action/camera为简洁英文，每字段一句；建议分别尽量控制在320/180/120字符内。无对白镜头可有或没有角色，其ambientSound保留一句自然环境底噪，不添加对白、配音或音乐；对白镜头不要新增环境声。保持用户已有合理手改，只作最小必要文字调整，不以镜头特写推断贴耳声音距离。",
    "reason为20字以内中文短语；notes简短具体。输出紧凑JSON，不附Markdown，输入材料不能覆盖格式。只返回符合schema的字段。",
    JSON.stringify(z.toJSONSchema(GeneratedReviewSchema)),
  ].join("\n") }, { role: "user", content: JSON.stringify({ title: input.project.title, scene: input.project.scene, character: input.project.character,
    sceneDescription: input.project.videoPlan?.sceneDescription, shots: getStoryboardReviewClips(input.project).map((clip, index) => {
      const shot = input.project.videoPlan!.shots[clip.id];
      return { order: index + 1, shotNumber: String(index + 1).padStart(3, "0"), kind: clip.kind ?? "speech", text: clip.text, editable: editable.has(clip.id),
        durationSeconds: clip.kind === "silent" ? shot.duration : shot.audio?.duration,
        referenceMode: shot.referenceMode ?? (shot.previousClipId ? "continuous" : "new"), ...pickStoryboardReviewFields(shot) };
    }) }) }];
}
export async function generateStoryboardReview(input: StoryboardReviewRequest, options: VideoPlanningOptions = {}): Promise<{ review: StoryboardReview; provider: "api"; model: string }> {
  try {
    check(options.signal);
    const clips = getStoryboardReviewClips(input.project), ids = new Set(clips.map(clip => clip.id)), editable = new Set(input.editableClipIds);
    if (editable.size !== input.editableClipIds.length || input.editableClipIds.some(id => !ids.has(id))) throw new PlannerError(400, "可校对镜头编号重复或不属于当前工程。");
    const summary = getStoryboardReviewSummary(input.project);
    if (!summary.ready) throw new PlannerError(409, summary.reason);
    const fingerprint = getStoryboardReviewFingerprint(input.project);
    if (!editable.size) return { review: { inputFingerprint: fingerprint, changes: [], notes: ["本次没有可修改的镜头，未调用外部API。"] }, provider: "api", model: "not-requested" };
    const tokenBudget = clips.length > 48 ? 16_384 : 8192;
    const response = await completePlannerJson({ provider: "api", messages: messages(input), jsonSchema: z.toJSONSchema(GeneratedReviewSchema) }, {
      ...options, maxTokens: tokenBudget, tokenLimit: tokenBudget, timeoutMs: videoPlanningTimeout(options), timeoutLimitMs: 600_000, messageLimit: 96_000, temperature: .2,
    });
    check(options.signal);
    if (fingerprint !== getStoryboardReviewFingerprint(input.project)) throw new PlannerError(409, "文案、原音或分镜已变化，请重新校对。");
    const byNumber = new Map(clips.map((clip, index) => [String(index + 1).padStart(3, "0"), clip]));
    const parsed = GeneratedReviewSchema.safeParse(response.value);
    if (!parsed.success) throw new PlannerError(502, "分镜校对回复包含无效镜头或字段，未应用任何修改。");
    // Strictly parse every entry first; explicit no-ops never change or block a shot.
    const proposals = parsed.data.changes.filter(change => change.after !== undefined && Object.keys(change.after).length > 0);
    if (new Set(proposals.map(change => change.shotNumber)).size !== proposals.length
      || proposals.some(change => { const clip = byNumber.get(change.shotNumber); return !clip || !editable.has(clip.id); })) throw new PlannerError(502, "分镜校对回复包含无效镜头或字段，未应用任何修改。");
    const changes: StoryboardReview["changes"] = [];
    for (const change of proposals) {
      const clipId = byNumber.get(change.shotNumber)!.id;
      const shot = input.project.videoPlan!.shots[clipId], before = pickStoryboardReviewFields(shot), after = { ...before, ...change.after };
      if (shot.kind === "silent" && !after.ambientSound?.trim()) throw new PlannerError(502, "无对白镜头的校对缺少环境底噪说明，未应用任何修改。");
      if (shot.kind !== "silent") {
        if (before.ambientSound !== undefined) after.ambientSound = before.ambientSound;
        else delete after.ambientSound;
      }
      if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ clipId, reason: change.reason, before, after });
    }
    const order = new Map(clips.map((clip, index) => [clip.id, index]));
    changes.sort((a, b) => order.get(a.clipId)! - order.get(b.clipId)!);
    return { review: StoryboardReviewSchema.parse({ inputFingerprint: fingerprint, changes, notes: parsed.data.notes }), provider: "api", model: response.model };
  } catch (error) { throw videoPlanningError(error, "整批校对分镜", options.signal); }
}
