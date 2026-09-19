import { resolveMockAssetUri } from "./mock-asset-resolver";
import type { TimelineClip } from "./schema";

const localClipAssetPrefix = "asset://clip/";
const localMixAssetPrefix = "asset://mix/";

export function resolveClipPlaybackUri(
  clip: TimelineClip, binaural: boolean,
  asset: { uri: string | null; duration: number | null } = clip.asset,
): string | undefined {
  if (!binaural || clip.type !== "voice" || !asset.uri?.startsWith(localClipAssetPrefix)) {
    return resolvePlayableAssetUri(asset.uri);
  }
  const params = new URLSearchParams({
    position: JSON.stringify(clip.position),
    duration: String(asset === clip.asset ? clip.duration : asset.duration ?? clip.duration),
    fadeIn: String(clip.fade_in), fadeOut: String(clip.fade_out),
  });
  return `/api/assets/spatial/${encodeURIComponent(asset.uri.slice(localClipAssetPrefix.length))}?${params}`;
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
