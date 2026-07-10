import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { GeneratedAssetResult } from "./generation-bridge";
import type { LocalRuntimeConfig } from "./local-runtime-config";

export type SaveClipAssetInput = {
  config: LocalRuntimeConfig;
  clipId: string;
  wav: Uint8Array | ArrayBuffer;
  duration: number;
  now?: Date;
};

export type SaveMixAssetInput = {
  config: LocalRuntimeConfig;
  projectId: string;
  exportType: "wav";
  wav: Uint8Array | ArrayBuffer;
  duration: number;
  now?: Date;
};

function makeTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, "");
}

function assertSafeSegment(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function makeAssetId(clipId: string, now: Date): string {
  assertSafeSegment(clipId, "clip id");

  return `${clipId}_${makeTimestamp(now)}_${randomUUID()
    .replace(/-/g, "")
    .slice(0, 8)}`;
}

function makeMixAssetId(
  projectId: string,
  exportType: "wav",
  now: Date,
): string {
  assertSafeSegment(projectId, "project id");
  assertSafeSegment(exportType, "export type");

  return `${projectId}_${exportType}_${makeTimestamp(now)}_${randomUUID()
    .replace(/-/g, "")
    .slice(0, 8)}`;
}

export function resolveClipAssetPath(
  assetId: string,
  config: LocalRuntimeConfig,
): string {
  assertSafeSegment(assetId, "clip asset id");

  const root = path.resolve(config.clipAssetRoot);
  const assetPath = path.resolve(root, `${assetId}.wav`);

  if (!assetPath.startsWith(root + path.sep)) {
    throw new Error("Invalid clip asset id");
  }

  return assetPath;
}

export function resolveMixAssetPath(
  assetId: string,
  config: LocalRuntimeConfig,
): string {
  assertSafeSegment(assetId, "mix asset id");

  const root = path.resolve(config.mixAssetRoot);
  const assetPath = path.resolve(root, `${assetId}.wav`);

  if (!assetPath.startsWith(root + path.sep)) {
    throw new Error("Invalid mix asset id");
  }

  return assetPath;
}

export async function saveClipAsset({
  config,
  clipId,
  wav,
  duration,
  now = new Date(),
}: SaveClipAssetInput): Promise<GeneratedAssetResult> {
  const assetId = makeAssetId(clipId, now);
  const assetPath = resolveClipAssetPath(assetId, config);

  await mkdir(path.dirname(assetPath), { recursive: true });
  await writeFile(assetPath, wav instanceof ArrayBuffer ? new Uint8Array(wav) : wav);

  return {
    assetId,
    uri: `asset://clip/${assetId}`,
    duration,
  };
}

export async function saveMixAsset({
  config,
  projectId,
  exportType,
  wav,
  duration,
  now = new Date(),
}: SaveMixAssetInput): Promise<GeneratedAssetResult> {
  const assetId = makeMixAssetId(projectId, exportType, now);
  const assetPath = resolveMixAssetPath(assetId, config);

  await mkdir(path.dirname(assetPath), { recursive: true });
  await writeFile(assetPath, wav instanceof ArrayBuffer ? new Uint8Array(wav) : wav);

  return {
    assetId,
    uri: `asset://mix/${assetId}`,
    duration,
  };
}
