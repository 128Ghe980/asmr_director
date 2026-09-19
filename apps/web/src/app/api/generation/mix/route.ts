import { generateLocalProjectMix } from "@/lib/asmr/local-project-mix-generation";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { AsmrProjectSchema } from "@/lib/asmr/schema";

export const runtime = "nodejs";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Project mix failed";
}

function getErrorStatus(error: unknown): number {
  if (
    error instanceof Error &&
    error.message.includes("Missing project mix clip assets")
  ) {
    return 409;
  }

  return 500;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const parsedBody =
      typeof body === "object" && body !== null
        ? (body as { project?: unknown; exportType?: unknown })
        : {};
    const project = AsmrProjectSchema.parse(parsedBody.project);
    const exportType = parsedBody.exportType ?? "wav";

    if (exportType !== "wav") {
      return Response.json(
        { error: "Unsupported project mix export type" },
        { status: 400 },
      );
    }

    const asset = await generateLocalProjectMix({
      project,
      exportType,
      config: getLocalRuntimeConfig(),
      signal: request.signal,
    });

    return Response.json({ asset });
  } catch (error) {
    return Response.json(
      { error: getErrorMessage(error) },
      { status: getErrorStatus(error) },
    );
  }
}
