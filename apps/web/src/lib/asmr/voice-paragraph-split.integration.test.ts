import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { z } from "zod";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { analyzeVoiceGroup } from "./voice-group-analysis";
import { paragraphPcmFrames, splitVoiceParagraph } from "./voice-paragraph-split";
import { withVoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";

const sourcePath = process.env.ASMR_PARAGRAPH_SPLIT_WAV;
const targetsPath = process.env.ASMR_PARAGRAPH_SPLIT_TARGETS_PATH;
const reportPath = process.env.ASMR_PARAGRAPH_SPLIT_REPORT_PATH;

// Opt-in CPU ASR validation of an existing WAV. This test never synthesizes
// speech, changes a project, or writes a candidate into the production store.
it.skipIf(!sourcePath || !targetsPath)("splits an existing paragraph with real offline ASR and exact original PCM conservation", async () => {
  const wav = new Uint8Array(await readFile(sourcePath!));
  const targets = z.array(z.object({ clipId: z.string().min(1), text: z.string().min(1) }).strict()).min(1).max(32)
    .parse(JSON.parse(await readFile(targetsPath!, "utf8")));
  const config = getLocalRuntimeConfig();
  const startedAt = new Date().toISOString();
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const sourcePcm = paragraphPcmFrames(wav).pcm;
  let analysisIndex = 0;
  const analyze: typeof analyzeVoiceGroup = async (input, dependencies) => {
    const index = ++analysisIndex;
    const evidencePath = reportPath ? `${reportPath}.analysis-${index}.json` : undefined;
    const request = { expectedText: input.expectedText, followingText: input.followingText ?? "", clauses: input.clauses,
      wavSha256: sha(input.wav), pcmSha256: sha(paragraphPcmFrames(input.wav).pcm) };
    try {
      const result = await analyzeVoiceGroup(input, dependencies);
      const { wav: excerpt, ...evidence } = result;
      if (evidencePath) await writeFile(evidencePath, JSON.stringify({ index, request, result: evidence, excerptWavSha256: sha(excerpt) }, null, 2));
      return result;
    } catch (error) {
      if (evidencePath) await writeFile(evidencePath, JSON.stringify({ index, request,
        diagnosticCode: error && typeof error === "object" && "diagnosticCode" in error ? error.diagnosticCode : undefined,
        recognition: error && typeof error === "object" && "recognition" in error ? error.recognition : undefined,
        message: error instanceof Error ? error.message : String(error) }, null, 2));
      throw error;
    }
  };
  try {
    const segments = await withVoxCpm2RuntimeSession(config, undefined, (runtimeSession) => splitVoiceParagraph({ wav, targets, config }, { runtimeSession, analyze }));
    const joined = Buffer.concat(segments.map((segment) => Buffer.from(paragraphPcmFrames(segment.wav).pcm)));
    expect(joined).toEqual(Buffer.from(sourcePcm));
    expect(segments).toHaveLength(targets.length);
    if (reportPath) await writeFile(reportPath, JSON.stringify({ sourcePath, startedAt, completedAt: new Date().toISOString(),
      status: segments.some(segment => segment.textReview) ? "needs_confirmation" : "passed", ttsCalls: 0,
      sourceWavSha256: sha(wav), sourcePcmSha256: sha(sourcePcm), assembledPcmSha256: sha(joined),
      segments: segments.map(({ wav: part, ...segment }) => ({ ...segment, pcmSha256: sha(paragraphPcmFrames(part).pcm), wavSha256: sha(part) })) }, null, 2));
  } catch (error) {
    if (reportPath) await writeFile(reportPath, JSON.stringify({ sourcePath, startedAt, completedAt: new Date().toISOString(),
      status: "review", ttsCalls: 0, retainedOriginal: true, sourceWavSha256: sha(wav), sourcePcmSha256: sha(sourcePcm),
      diagnosticCode: error && typeof error === "object" && "diagnosticCode" in error ? error.diagnosticCode : undefined,
      recognition: error && typeof error === "object" && "recognition" in error ? error.recognition : undefined,
      message: error instanceof Error ? error.message : String(error) }, null, 2));
    throw error;
  }
}, 30 * 60 * 1000);
