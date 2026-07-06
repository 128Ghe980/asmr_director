import { generateLocalClip } from "@/lib/asmr/local-clip-generation";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { AsmrProjectSchema } from "@/lib/asmr/schema";

export const runtime = "nodejs";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Generation failed";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const parsedBody =
      typeof body === "object" && body !== null
        ? (body as { project?: unknown; clipId?: unknown })
        : {};
    const project = AsmrProjectSchema.parse(parsedBody.project);

    if (typeof parsedBody.clipId !== "string" || !parsedBody.clipId) {
      return Response.json({ error: "Missing clip id" }, { status: 400 });
    }

    const asset = await generateLocalClip({
      project,
      clipId: parsedBody.clipId,
      config: getLocalRuntimeConfig(),
    });

    return Response.json({ asset });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
