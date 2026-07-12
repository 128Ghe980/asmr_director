import { readFile } from "node:fs/promises";

import { analyzePcmWav } from "../../../../lib/asmr/audio-analysis";
import {
  resolveClipAssetPath,
  resolveMixAssetPath,
} from "../../../../lib/asmr/local-asset-store";
import { getLocalRuntimeConfig } from "../../../../lib/asmr/local-runtime-config";

export const runtime = "nodejs";

const CLIP_PREFIX = "asset://clip/";
const MIX_PREFIX = "asset://mix/";

function getBarCount(value: string | null): number {
  if (value === null) {
    return 64;
  }

  const count = Number(value);

  if (!Number.isInteger(count) || count < 16 || count > 160) {
    throw new Error("Waveform bars must be an integer from 16 to 160");
  }

  return count;
}

function resolveAssetPath(uri: string): string {
  const config = getLocalRuntimeConfig();

  if (uri.startsWith(CLIP_PREFIX)) {
    return resolveClipAssetPath(uri.slice(CLIP_PREFIX.length), config);
  }

  if (uri.startsWith(MIX_PREFIX)) {
    return resolveMixAssetPath(uri.slice(MIX_PREFIX.length), config);
  }

  throw new Error("Only local clip or mix assets can be analyzed");
}

function getErrorStatus(error: unknown): number {
  if (
    error instanceof Error &&
    (error.message.includes("Only local") ||
      error.message.includes("durable asset URI") ||
      error.message.includes("Invalid clip asset id") ||
      error.message.includes("Invalid mix asset id") ||
      error.message.includes("Waveform bars"))
  ) {
    return 400;
  }

  if (
    error instanceof Error &&
    (error.message.includes("WAV") || error.message.includes("wave"))
  ) {
    return 422;
  }

  return 404;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const uri = url.searchParams.get("uri");

    if (!uri) {
      throw new Error("A durable asset URI is required");
    }

    const bars = getBarCount(url.searchParams.get("bars"));
    const bytes = await readFile(resolveAssetPath(uri));
    const analysis = analyzePcmWav(bytes, bars);

    return Response.json(
      { analysis },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: getErrorStatus(error) },
    );
  }
}
