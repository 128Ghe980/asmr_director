import path from "node:path";

export type LocalRuntimeConfig = {
  runtimeRoot: string;
  gptSovitsBaseUrl: string;
  voicePackPath: string;
  clipAssetRoot: string;
  mixAssetRoot: string;
  voxcpm2ProfilePath?: string;
  voxcpm2ParagraphCliPath?: string;
  voiceReferenceRoot?: string;
  voiceReferenceFfmpegPath?: string;
  voiceAnalysisPythonPath?: string;
  voiceAnalysisModelPath?: string;
  spatialCacheRoot?: string;
  spatialPythonPath?: string;
  spatialHrtfPath?: string;
};

const defaultRuntimeRoot = "D:\\CodexWorkplace\\asmr_director_runtime";

type RuntimeEnv = Partial<
  Record<
    | "ASMR_DIRECTOR_RUNTIME_ROOT"
    | "ASMR_GPT_SOVITS_URL"
    | "ASMR_VOICE_PACK_PATH"
    | "ASMR_CLIP_ASSET_ROOT"
    | "ASMR_MIX_ASSET_ROOT"
    | "ASMR_VOXCPM2_PROFILE_PATH"
    | "ASMR_VOXCPM2_PARAGRAPH_CLI_PATH"
    | "ASMR_VOICE_REFERENCE_ROOT"
    | "ASMR_VOICE_REFERENCE_FFMPEG"
    | "ASMR_VOICE_ANALYSIS_PYTHON"
    | "ASMR_VOICE_ANALYSIS_MODEL"
    | "ASMR_SPATIAL_CACHE_ROOT"
    | "ASMR_SPATIAL_PYTHON"
    | "ASMR_SPATIAL_HRTF",
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
    voxcpm2ProfilePath:
      env.ASMR_VOXCPM2_PROFILE_PATH ||
      path.join(runtimeRoot, "audio-quality-v1", "voxcpm2", "profile.json"),
    ...(env.ASMR_VOXCPM2_PARAGRAPH_CLI_PATH ? { voxcpm2ParagraphCliPath: env.ASMR_VOXCPM2_PARAGRAPH_CLI_PATH } : {}),
    voiceAnalysisPythonPath: env.ASMR_VOICE_ANALYSIS_PYTHON || undefined,
    ...(env.ASMR_VOICE_REFERENCE_ROOT ? { voiceReferenceRoot: env.ASMR_VOICE_REFERENCE_ROOT } : {}),
    ...(env.ASMR_VOICE_REFERENCE_FFMPEG ? { voiceReferenceFfmpegPath: env.ASMR_VOICE_REFERENCE_FFMPEG } : {}),
    voiceAnalysisModelPath: env.ASMR_VOICE_ANALYSIS_MODEL || undefined,
    spatialCacheRoot: env.ASMR_SPATIAL_CACHE_ROOT || path.join(runtimeRoot, "assets", "spatial"),
    spatialPythonPath: env.ASMR_SPATIAL_PYTHON || path.join(runtimeRoot, "audio-quality-v1", ".venv", "Scripts", "python.exe"),
    spatialHrtfPath: env.ASMR_SPATIAL_HRTF || path.join(runtimeRoot, "audio-quality-v1", "hrtf", "viking", "subj_A.sofa"),
  };
}
