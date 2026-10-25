import { generateStoryboardReview, readStoryboardReviewRequest } from "../../../lib/asmr/storyboard-review-service";
import { PlannerError } from "../../../lib/asmr/planner-provider";

export const runtime = "nodejs";
export const maxDuration = 600;
export async function POST(request: Request) {
  try {
    const input = await readStoryboardReviewRequest(request);
    return Response.json(await generateStoryboardReview(input, { signal: request.signal }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof PlannerError ? error.message : "整批分镜校对暂时失败，请重试。" }, {
      status: error instanceof PlannerError ? error.status : 500, headers: { "Cache-Control": "no-store" },
    });
  }
}
