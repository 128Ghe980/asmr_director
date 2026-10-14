import { z } from "zod";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { getLocalStorageError } from "@/lib/asmr/local-storage-error";
import { AsmrProjectSchema } from "@/lib/asmr/schema";
import { confirmVoiceParagraphText, VoiceParagraphConfirmationError } from "@/lib/asmr/voice-paragraph-confirmation";

export const runtime = "nodejs";
type Context = { params: Promise<{ candidateId: string }> };
const Id = z.string().min(1).max(240).regex(/^[A-Za-z0-9_-]+$/);
const RequestSchema = z.object({ project: AsmrProjectSchema, clipId: Id, confirmedClipIds: z.array(Id).min(1).max(32) }).strict();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, context: Context) {
  if (request.signal.aborted) return json({ error: "试听确认已取消。" }, 499);
  const id = Id.safeParse((await context.params).candidateId), body = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return json({ error: "试听确认参数有误，请刷新候选列表。" }, 400);
  try {
    return json(await confirmVoiceParagraphText({ ...body.data, candidateId: id.data, config: getLocalRuntimeConfig(), signal: request.signal }));
  } catch (error) {
    if (request.signal.aborted) return json({ error: "试听确认已取消。" }, 499);
    const storage = getLocalStorageError(error);
    if (storage) return json({ error: storage.message, code: storage.code }, storage.statusCode);
    if (error instanceof VoiceParagraphConfirmationError) return json({ error: error.message }, error.statusCode);
    return json({ error: "试听确认暂未保存，请稍后重试。" }, 500);
  }
}
