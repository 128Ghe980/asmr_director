import { resolveMockAssetUri } from "./mock-asset-resolver";

const localClipAssetPrefix = "asset://clip/";

export function isLocalClipAssetUri(uri: string | null | undefined): boolean {
  return Boolean(uri?.startsWith(localClipAssetPrefix));
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

  return resolveMockAssetUri(uri);
}
