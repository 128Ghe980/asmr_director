import { PlannerError } from "../../../lib/asmr/planner-provider";
import { generateSceneDescription, readSceneDescriptionRequest } from "../../../lib/asmr/scene-description-service";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: Request) {
  try {
    const input = await readSceneDescriptionRequest(request);
    return Response.json(await generateSceneDescription(input, { signal: request.signal }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof PlannerError ? error.message : "场景描述暂时失败，请重试。" }, {
      status: error instanceof PlannerError ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
