import { PlannerError } from "../../../lib/asmr/planner-provider";
import { generateStoryboard, readStoryboardRequest } from "../../../lib/asmr/storyboard-service";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: Request) {
  try {
    const input = await readStoryboardRequest(request);
    const result = await generateStoryboard(input, { signal: request.signal });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof PlannerError ? error.message : "分镜生成暂时失败，请重试。" }, {
      status: error instanceof PlannerError ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
