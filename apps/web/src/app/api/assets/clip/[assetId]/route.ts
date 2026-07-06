import { readFile } from "node:fs/promises";

import { resolveClipAssetPath } from "@/lib/asmr/local-asset-store";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

function getErrorStatus(error: unknown): number {
  if (error instanceof Error && error.message.includes("Invalid clip asset id")) {
    return 400;
  }

  return 404;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { assetId } = await context.params;
    const assetPath = resolveClipAssetPath(assetId, getLocalRuntimeConfig());
    const file = await readFile(assetPath);

    return new Response(file, {
      headers: {
        "content-type": "audio/wav",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Asset not found" },
      { status: getErrorStatus(error) },
    );
  }
}
