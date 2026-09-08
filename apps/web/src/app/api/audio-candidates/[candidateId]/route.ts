import { stat } from "node:fs/promises";
import { z } from "zod";
import { discardAudioCandidate, getAudioCandidate } from "@/lib/asmr/local-candidate-store";
import { resolveClipAssetPath } from "@/lib/asmr/local-asset-store";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";

export const runtime = "nodejs";
type Context = { params: Promise<{ candidateId: string }> };
const IdSchema = z.string().min(1).max(240).regex(/^[A-Za-z0-9_-]+$/);
const QuerySchema = z.object({ projectId: z.string().min(1).max(240), clipId: z.string().min(1).max(240) });

async function lookup(request: Request, context: Context) {
  const id = IdSchema.safeParse((await context.params).candidateId);
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!id.success || !query.success) return null;
  const config = getLocalRuntimeConfig();
  const candidate = await getAudioCandidate({ config, candidateId: id.data });
  if (!candidate || candidate.projectId !== query.data.projectId || candidate.clipId !== query.data.clipId || candidate.status !== "ready") return null;
  return { candidate, config };
}

export async function GET(request: Request, context: Context) {
  try {
    const result = await lookup(request, context);
    if (!result) return Response.json({ error: "候选已不可用，请刷新列表。" }, { status: 404 });
    await stat(resolveClipAssetPath(result.candidate.asset.assetId, result.config));
    return Response.json({ candidate: result.candidate }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "候选音频无法读取，请重新生成。" }, { status: 404 });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const result = await lookup(request, context);
    if (!result) return Response.json({ error: "候选已不可用，请刷新列表。" }, { status: 404 });
    const { candidate, config } = result;
    await discardAudioCandidate({ config, candidateId: candidate.candidateId, projectId: candidate.projectId, clipId: candidate.clipId });
    return Response.json({ discarded: true });
  } catch {
    return Response.json({ error: "未能放弃候选，请重试。" }, { status: 500 });
  }
}
