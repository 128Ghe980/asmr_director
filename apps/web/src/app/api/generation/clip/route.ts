import { z } from "zod";
import { generateLocalClip } from "@/lib/asmr/local-clip-generation";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { AsmrProjectSchema } from "@/lib/asmr/schema";
import { VoiceGenerationOptionsSchema, LongTextRetrySchema } from "@/lib/asmr/voice-generation-options";
import { getVoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";
import { flattenClips } from "@/lib/asmr/view-model";
import { VoxCpm2Error } from "@/lib/asmr/voxcpm2-provider";
import { CandidateCapacityError } from "@/lib/asmr/local-candidate-store";
import { getLocalStorageError } from "@/lib/asmr/local-storage-error";

export const runtime = "nodejs";

const RequestSchema = z.object({
  project: AsmrProjectSchema,
  clipId: z.string().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/),
  reason: z.enum(["generate", "regenerate", "retry"]).optional(),
  voiceOptions: VoiceGenerationOptionsSchema.optional(),
  longTextRetry: LongTextRetrySchema.optional(),
}).strict();

export async function GET() {
  return Response.json(await getVoiceProviderCatalog(getLocalRuntimeConfig()), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "生成参数有误，请检查片段内容。" }, { status: 400 });
  const { project, clipId, voiceOptions, longTextRetry } = parsed.data;
  const clip = flattenClips(project).find((value) => value.id === clipId);
  if (!clip || (voiceOptions && clip.type !== "voice")) {
    return Response.json({ error: "请选择有效的人声片段。" }, { status: 400 });
  }
  if (voiceOptions?.generationMode === "long_text" && voiceOptions.provider !== "voxcpm2") return Response.json({ error: "长文分组需要选择 VoxCPM2。" }, { status: 400 });
  if (longTextRetry && voiceOptions?.generationMode !== "long_text") return Response.json({ error: "请选择长文候选进行分组重生成。" }, { status: 400 });
  if (voiceOptions?.generationMode === "long_text" && request.headers.get("accept")?.includes("application/x-ndjson")) {
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) => { if (!abortController.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
        const heartbeat = setInterval(() => send({ type: "heartbeat" }), 15_000);
        try {
          const result = await generateLocalClip({ project, clipId, voiceOptions, longTextRetry, config: getLocalRuntimeConfig(), signal: abortController.signal,
            onProgress: (progress) => send({ type: "progress", ...progress }) });
          send({ type: "result", result });
        } catch (error) {
          const storageError = getLocalStorageError(error);
          send({ type: "error", ...(storageError ? { error: storageError.message, code: storageError.code }
            : { error: error instanceof VoxCpm2Error || error instanceof CandidateCapacityError ? error.message : "生成未完成。已保存的完整原音仍可试听、下载。" }) });
        } finally {
          clearInterval(heartbeat);
          request.signal.removeEventListener("abort", abort);
          try { controller.close(); } catch { /* The client already canceled its reader. */ }
        }
      },
      cancel() { abort(); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  }
  try {
    const result = await generateLocalClip({ project, clipId, voiceOptions, longTextRetry, config: getLocalRuntimeConfig(), signal: request.signal });
    return Response.json("candidate" in result ? result : { asset: result });
  } catch (error) {
    if (request.signal.aborted) return Response.json({ error: "已取消生成。" }, { status: 499 });
    const storageError = getLocalStorageError(error);
    if (storageError) return Response.json({ error: storageError.message, code: storageError.code }, { status: storageError.statusCode });
    if (error instanceof VoxCpm2Error || error instanceof CandidateCapacityError) return Response.json({ error: error.message }, { status: error.statusCode });
    return Response.json({ error: "生成失败，请检查人声服务后重试。" }, { status: 502 });
  }
}
