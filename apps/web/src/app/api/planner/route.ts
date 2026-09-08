import {
  getPlannerProviderCatalog,
  PlannerError,
  readPlannerRequest,
  runPlanner,
} from "../../../lib/asmr/planner-provider";

export const runtime = "nodejs";
export const maxDuration = 600;

const responseHeaders = { "Cache-Control": "no-store" };

export async function GET() {
  return Response.json(getPlannerProviderCatalog(), { headers: responseHeaders });
}

export async function POST(request: Request) {
  try {
    const input = await readPlannerRequest(request);
    const result = await runPlanner(input, { signal: request.signal });
    return Response.json(result, { headers: responseHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof PlannerError ? error.message : "策划暂时失败，请重试。" }, {
      status: error instanceof PlannerError ? error.status : 500,
      headers: responseHeaders,
    });
  }
}
