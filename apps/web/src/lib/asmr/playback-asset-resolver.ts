import { resolveMockAssetUri } from "./mock-asset-resolver";
import type { TimelineClip } from "./schema";

const localClipAssetPrefix = "asset://clip/";
const localMixAssetPrefix = "asset://mix/";

export function resolveClipPlaybackUri(
  clip: TimelineClip, _binaural: boolean,
  asset: { uri: string | null; duration: number | null } = clip.asset,
): string | undefined {
  // Listening never starts rendering. Processed assets have their own explicit result.
  return resolvePlayableAssetUri(asset.uri);
}

export function isLocalClipAssetUri(uri: string | null | undefined): boolean {
  return Boolean(uri?.startsWith(localClipAssetPrefix));
}

export function isLocalMixAssetUri(uri: string | null | undefined): boolean {
  return Boolean(uri?.startsWith(localMixAssetPrefix));
}

export function resolvePlayableAssetUri(
  uri: string | null | undefined,
): string | undefined {
  if (!uri) {
    return undefined;
  }

  if (isLocalClipAssetUri(uri)) {
    return `/api/assets/clip/${encodeURIComponent(
      uri.slice(localClipAssetPrefix.length),
    )}`;
  }

  if (isLocalMixAssetUri(uri)) {
    return `/api/assets/mix/${encodeURIComponent(
      uri.slice(localMixAssetPrefix.length),
    )}`;
  }

  return resolveMockAssetUri(uri);
}
