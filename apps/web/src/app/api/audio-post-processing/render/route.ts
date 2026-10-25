import { renderAudioPostProcessing, readAudioPostProcessingRenderRequest } from "../../../../lib/asmr/audio-post-processing-service";
import { PlannerError } from "../../../../lib/asmr/planner-provider";

export const runtime = "nodejs";
export const maxDuration = 600;
export async function POST(request: Request) {
  try {
    const input = await readAudioPostProcessingRenderRequest(request);
    return Response.json(await renderAudioPostProcessing(input, { signal: request.signal }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof PlannerError ? error.message : "声音后处理暂时失败，请重试。" }, {
      status: error instanceof PlannerError ? error.status : 500, headers: { "Cache-Control": "no-store" },
    });
  }
}
