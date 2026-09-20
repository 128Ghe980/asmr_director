import { z } from "zod";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { listVoiceGenerationRecordings } from "@/lib/asmr/voice-generation-recordings";

export const runtime = "nodejs";
const QuerySchema = z.object({ projectId: z.string().min(1).max(240), clipId: z.string().min(1).max(240), text: z.string().trim().min(1).max(500),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional() }).strict();

export async function GET(request: Request) {
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "请提供工程、片段和当前台词。" }, { status: 400 });
  try {
    const result = await listVoiceGenerationRecordings({ config: getLocalRuntimeConfig(), ...query.data });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid recording cursor") return Response.json({ error: "录音列表位置已失效，请刷新录音。" }, { status: 400 });
    return Response.json({ error: "原始录音列表暂时无法读取，请重试。" }, { status: 500 });
  }
}
