import path from "node:path";

export type LocalRuntimeConfig = {
  runtimeRoot: string;
  gptSovitsBaseUrl: string;
  voicePackPath: string;
  clipAssetRoot: string;
  mixAssetRoot: string;
};

const defaultRuntimeRoot = "D:\\CodexWorkplace\\asmr_director_runtime";

type RuntimeEnv = Partial<
  Record<
    | "ASMR_DIRECTOR_RUNTIME_ROOT"
    | "ASMR_GPT_SOVITS_URL"
    | "ASMR_VOICE_PACK_PATH"
    | "ASMR_CLIP_ASSET_ROOT"
    | "ASMR_MIX_ASSET_ROOT",
    string
  >
>;

export function getLocalRuntimeConfig(
  env: RuntimeEnv = process.env as RuntimeEnv,
): LocalRuntimeConfig {
  const runtimeRoot = env.ASMR_DIRECTOR_RUNTIME_ROOT ?? defaultRuntimeRoot;

  return {
    runtimeRoot,
    gptSovitsBaseUrl: env.ASMR_GPT_SOVITS_URL ?? "http://127.0.0.1:9880",
    voicePackPath:
      env.ASMR_VOICE_PACK_PATH ??
      path.join(runtimeRoot, "voice-packs", "default", "voice-pack.json"),
    clipAssetRoot:
      env.ASMR_CLIP_ASSET_ROOT ??
      path.join(runtimeRoot, "assets", "clips", "app"),
    mixAssetRoot:
      env.ASMR_MIX_ASSET_ROOT ??
      path.join(runtimeRoot, "assets", "mixes", "app"),
  };
}
