import { z } from "zod";
import { listAudioCandidates } from "@/lib/asmr/local-candidate-store";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";

export const runtime = "nodejs";
const QuerySchema = z.object({ projectId: z.string().min(1).max(240), clipId: z.string().min(1).max(240).optional() });

export async function GET(request: Request) {
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "缺少工程或片段信息。" }, { status: 400 });
  try {
    const candidates = await listAudioCandidates({ config: getLocalRuntimeConfig(), ...query.data });
    return Response.json({ candidates }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "候选记录暂时无法读取，请重试。" }, { status: 500 });
  }
}
