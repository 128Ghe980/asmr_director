import { generateClipStoryboard, readClipStoryboardRequest } from "../../../lib/asmr/clip-storyboard-service";
import { PlannerError } from "../../../lib/asmr/planner-provider";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: Request) {
  try {
    const input = await readClipStoryboardRequest(request);
    return Response.json(await generateClipStoryboard(input, { signal: request.signal }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof PlannerError ? error.message : "片段分镜暂时失败，请重试。" }, {
      status: error instanceof PlannerError ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
