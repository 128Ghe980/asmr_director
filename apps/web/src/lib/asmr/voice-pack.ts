import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { LocalRuntimeConfig } from "./local-runtime-config";

const VoicePackFileSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  provider: z.literal("gpt-sovits"),
  endpoint: z.string().url(),
  referenceAudio: z.string().min(1),
  promptTextPath: z.string().min(1),
  promptLanguage: z.string().min(1),
  textLanguage: z.string().min(1),
  licenseStatus: z.string().min(1),
  consentConfirmedAt: z.string().nullable(),
});

export type VoicePack = z.infer<typeof VoicePackFileSchema> & {
  promptText: string;
};

export async function loadVoicePack(
  config: LocalRuntimeConfig,
): Promise<VoicePack> {
  const raw = await readFile(config.voicePackPath, "utf8");
  const voicePack = VoicePackFileSchema.parse(JSON.parse(raw));

  if (
    voicePack.licenseStatus !== "user_confirmed" ||
    !voicePack.consentConfirmedAt
  ) {
    throw new Error("Voice pack consent is not confirmed");
  }

  const promptText = (await readFile(voicePack.promptTextPath, "utf8")).trim();

  if (!promptText) {
    throw new Error("Voice pack prompt text is empty");
  }

  return {
    ...voicePack,
    promptText,
  };
}
