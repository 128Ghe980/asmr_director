import { z } from "zod";
import { CandidateCapacityError } from "@/lib/asmr/local-candidate-store";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { getLocalStorageError } from "@/lib/asmr/local-storage-error";
import { AsmrProjectSchema } from "@/lib/asmr/schema";
import { recheckVoiceCandidate, VoiceCandidateRecheckError } from "@/lib/asmr/voice-candidate-recheck";
import { flattenClips } from "@/lib/asmr/view-model";
import { VoxCpm2Error } from "@/lib/asmr/voxcpm2-error";

export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ candidateId: string }> };
const IdSchema = z.string().min(1).max(240).regex(/^[A-Za-z0-9_-]+$/);
const RequestSchema = z.object({ project: AsmrProjectSchema, clipId: IdSchema }).strict();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, context: Context) {
  if (request.signal.aborted) return json({ error: "重新识别已取消，原候选仍保留。" }, 499);
  const id = IdSchema.safeParse((await context.params).candidateId);
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !parsed.success) return json({ error: "重新识别参数有误，请刷新候选列表。" }, 400);
  const clip = flattenClips(parsed.data.project).find((item) => item.id === parsed.data.clipId);
  if (clip?.type !== "voice") return json({ error: "请选择有效的人声片段。" }, 400);
  try {
    const result = await recheckVoiceCandidate({ ...parsed.data, candidateId: id.data,
      config: getLocalRuntimeConfig(), signal: request.signal });
    return json(result);
  } catch (error) {
    if (request.signal.aborted) return json({ error: "重新识别已取消，原候选仍保留。" }, 499);
    const storage = getLocalStorageError(error);
    if (storage) return json({ error: storage.message, code: storage.code }, storage.statusCode);
    if (error instanceof VoiceCandidateRecheckError || error instanceof VoxCpm2Error || error instanceof CandidateCapacityError) {
      return json({ error: error.message, ...(error instanceof VoiceCandidateRecheckError && error.recognition
        ? { recognition: error.recognition } : {}) }, error.statusCode);
    }
    return json({ error: "重新识别未完成，原候选仍保留，请稍后重试。" }, 500);
  }
}
