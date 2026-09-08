import path from "node:path";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { loadVoicePack } from "./voice-pack";
import { loadVoxCpm2Profile } from "./voxcpm2-profile";

export type VoiceReferenceMode = "reference_only" | "with_reference_text";
export type VoiceProviderCatalog = {
  providers: {
    id: "gpt-sovits" | "voxcpm2";
    label: string;
    available: boolean;
    defaultReferenceId: string | null;
    references: { id: string; label: string; referenceModes: VoiceReferenceMode[] }[];
    unavailableReason?: string;
  }[];
};

export function resolveVoxCpm2ProfilePath(config: LocalRuntimeConfig) {
  return config.voxcpm2ProfilePath || path.join(config.runtimeRoot, "audio-quality-v1", "voxcpm2", "profile.json");
}

export async function getVoiceProviderCatalog(config: LocalRuntimeConfig): Promise<VoiceProviderCatalog> {
  const [gpt, vox] = await Promise.allSettled([loadVoicePack(config), loadVoxCpm2Profile(resolveVoxCpm2ProfilePath(config))]);
  return {
    providers: [
      gpt.status === "fulfilled" ? {
        id: "gpt-sovits", label: "GPT-SoVITS", available: true,
        defaultReferenceId: gpt.value.id,
        references: [{ id: gpt.value.id, label: gpt.value.displayName, referenceModes: ["with_reference_text"] }],
      } : {
        id: "gpt-sovits", label: "GPT-SoVITS", available: false, defaultReferenceId: null,
        references: [], unavailableReason: "请配置本机 GPT-SoVITS 声音。",
      },
      vox.status === "fulfilled" ? {
        id: "voxcpm2", label: "VoxCPM2", available: true,
        defaultReferenceId: vox.value.defaultReferenceId,
        references: vox.value.references.map((ref) => ({ id: ref.id, label: ref.displayName, referenceModes: ref.promptText ? ["reference_only", "with_reference_text"] : ["reference_only"] })),
      } : {
        id: "voxcpm2", label: "VoxCPM2", available: false, defaultReferenceId: null,
        references: [], unavailableReason: "请检查本机 VoxCPM2 模型与参考声音配置。",
      },
    ],
  };
}
