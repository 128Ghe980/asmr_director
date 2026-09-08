import { z } from "zod";
import { generateLocalClip } from "@/lib/asmr/local-clip-generation";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { AsmrProjectSchema } from "@/lib/asmr/schema";
import { VoiceGenerationOptionsSchema } from "@/lib/asmr/voice-generation-options";
import { getVoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";
import { flattenClips } from "@/lib/asmr/view-model";
import { VoxCpm2Error } from "@/lib/asmr/voxcpm2-provider";
import { CandidateCapacityError } from "@/lib/asmr/local-candidate-store";

export const runtime = "nodejs";

const RequestSchema = z.object({
  project: AsmrProjectSchema,
  clipId: z.string().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/),
  reason: z.enum(["generate", "regenerate", "retry"]).optional(),
  voiceOptions: VoiceGenerationOptionsSchema.optional(),
}).strict();

export async function GET() {
  return Response.json(await getVoiceProviderCatalog(getLocalRuntimeConfig()), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "生成参数有误，请检查片段内容。" }, { status: 400 });
  const { project, clipId, voiceOptions } = parsed.data;
  const clip = flattenClips(project).find((value) => value.id === clipId);
  if (!clip || (voiceOptions && clip.type !== "voice")) {
    return Response.json({ error: "请选择有效的人声片段。" }, { status: 400 });
  }
  try {
    const result = await generateLocalClip({ project, clipId, voiceOptions, config: getLocalRuntimeConfig(), signal: request.signal });
    return Response.json("candidate" in result ? result : { asset: result });
  } catch (error) {
    if (request.signal.aborted) return Response.json({ error: "已取消生成。" }, { status: 499 });
    if (error instanceof VoxCpm2Error || error instanceof CandidateCapacityError) return Response.json({ error: error.message }, { status: error.statusCode });
    return Response.json({ error: "生成失败，请检查人声服务后重试。" }, { status: 502 });
  }
}
