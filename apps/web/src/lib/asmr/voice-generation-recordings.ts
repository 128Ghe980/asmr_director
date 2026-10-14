import { lstat, open, opendir, readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { VoiceParagraphRecordingRecognitionSchema, type VoiceGenerationRecording, type VoiceParagraphRecordingRecognition } from "./voice-generation-recording";
import { VoiceRecognitionSchema, type VoiceRecognition } from "./voice-recognition";

const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_RECORDING_BYTES = 128 * 1024 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const runPattern = new RegExp(`^${UUID}$`, "i");
const recordingPattern = new RegExp(`^(current|legacy)_(${UUID})_([1-9][0-9]{0,2})_([1-9][0-9]?)$`, "i");
const sourcePattern = /^group-([1-9][0-9]{0,2})-take-([1-9][0-9]?)-source\.wav$/;
const RUNS_PER_PAGE = 100;
const RECORDINGS_PER_PAGE = 50;
const CursorSchema = z.object({
  version: z.literal(1), scope: z.string().length(32), kind: z.enum(["current", "legacy"]),
  runId: z.string().regex(runPattern), created: z.number().finite().nonnegative(),
  afterSource: z.number().int().min(0).max(50020).nullable(),
}).strict();
type RecordingCursor = z.infer<typeof CursorSchema>;
type RecordingRun = { kind: "current" | "legacy"; root: string; runId: string; created: number };
const compareRuns = (left: Pick<RecordingRun, "kind" | "runId" | "created">, right: Pick<RecordingRun, "kind" | "runId" | "created">) =>
  right.created - left.created || right.kind.localeCompare(left.kind) || right.runId.localeCompare(left.runId);
const PlanSchema = z.object({
  projectId: z.string().min(1).max(240).optional(),
  clipId: z.string().min(1).max(240).optional(),
  createdAt: z.string().optional(),
  generationMode: z.string().optional(),
  paragraph: z.object({ clips: z.array(z.object({ clipId: z.string().min(1).max(240), text: z.string().max(2000) })).min(1).max(32) }).optional(),
  plan: z.object({ clauses: z.array(z.string().max(2000)).min(1).max(500) }),
  targets: z.array(z.object({ expectedText: z.string().max(2000), text: z.string().max(2000).optional(), inputText: z.string().max(2000).optional() })
    .refine((target) => target.text !== undefined || target.inputText !== undefined)).min(1).max(500),
});

export function getVoiceGenerationRoot(config: Pick<LocalRuntimeConfig, "runtimeRoot">, env: { ASMR_VOICE_WORK_ROOT?: string } = { ASMR_VOICE_WORK_ROOT: process.env.ASMR_VOICE_WORK_ROOT }) {
  return path.resolve(env.ASMR_VOICE_WORK_ROOT?.trim() || path.join(config.runtimeRoot, "voxcpm2-product"));
}

function roots(config: Pick<LocalRuntimeConfig, "runtimeRoot">) {
  const current = path.join(getVoiceGenerationRoot(config), "long-text");
  const legacy = path.resolve(config.runtimeRoot, "voxcpm2-product", "long-text");
  return [{ kind: "current" as const, root: current }, ...(legacy.toLowerCase() === current.toLowerCase() ? [] : [{ kind: "legacy" as const, root: legacy }])];
}

async function regularFile(filePath: string, root: string, maximum: number) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw new Error("Recording unavailable");
  const relative = path.relative(await realpath(root), await realpath(filePath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Recording unavailable");
  return info;
}

async function readJson(filePath: string, root: string): Promise<unknown> {
  await regularFile(filePath, root, MAX_JSON_BYTES);
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function optionalJson(filePath: string, root: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value = await readJson(filePath, root);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

async function runDirectory(root: string, runId: string) {
  if (!runPattern.test(runId)) throw new Error("Invalid recording id");
  const directory = path.join(root, runId);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Recording unavailable");
  const relative = path.relative(await realpath(root), await realpath(directory));
  if (relative !== runId) throw new Error("Recording unavailable");
  return directory;
}

// Read only a bounded RIFF header; listening always serves the original bytes.
async function wavDuration(filePath: string, size: number): Promise<number | null> {
  const file = await open(filePath, "r");
  try {
    const header = Buffer.alloc(Math.min(size, 65536));
    await file.read(header, 0, header.length, 0);
    if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") return null;
    let byteRate = 0;
    for (let offset = 12; offset + 8 <= header.length;) {
      const length = header.readUInt32LE(offset + 4), kind = header.toString("ascii", offset, offset + 4);
      if (kind === "fmt " && length >= 16 && offset + 24 <= header.length) byteRate = header.readUInt32LE(offset + 16);
      if (kind === "data") return byteRate > 0 && offset + 8 + length <= size ? length / byteRate : null;
      offset += 8 + length + length % 2;
    }
    return null;
  } finally { await file.close(); }
}

function checkWarning(failure: Record<string, unknown> | undefined, checked: boolean, ended: boolean, analysis?: Record<string, unknown>, recognition?: VoiceRecognition) {
  if (failure) {
    const code = failure.code;
    if (code === "uncertain_word_alignment") return "识别文字未能定位目标句的结束位置；请展开识别对照，并试听完整原音。";
    if (code === "unrecognized_continuation") return "后续台词衔接未能定位，暂未采用裁剪；请展开识别对照，并试听完整原音。";
    if (["cut_text_mismatch", "missing_speech", "incomplete_or_unrelated_speech", "missing_or_extra_speech", "repeated_speech"].includes(String(code))) {
      return "台词核对有疑问，可能是识别差异或漏读、多读。请直接试听这条完整录音。";
    }
    if (["no_safe_quiet_cut", "no_verified_quiet_cut", "missing_internal_boundary", "uncertain_internal_pause", "uncertain_boundary_timestamps", "invalid_quiet_crop"].includes(String(code))) {
      return "未能确认自动分段的位置；完整原音仍可试听和下载。";
    }
    return "检查或后续处理未完成；完整原音仍可试听和下载。";
  }
  if (analysis?.checkStatus === "not_checked") {
    const message = typeof analysis.message === "string" ? analysis.message.trim().slice(0, 800) : "";
    return `当前片段原音（未做分组检查）。${message}`;
  }
  const comparison = recognition?.contentComparison;
  if (checked && comparison?.status === "different") {
    return `目标片段已通过截取检查，但识别结果与源文有差异（相似度 ${(comparison.similarity * 100).toFixed(1)}%），请试听确认。这里保留模型输出的完整原音。`;
  }
  if (checked) return "检查已完成。这里保留模型输出的全部声音。";
  return ended ? "这次生成已结束，尚无这条录音的检查结果；可以完整试听。" : "录音已生成，检查结果尚未保存；现在就可以完整试听。";
}

function readParagraphRecognition(plan: z.infer<typeof PlanSchema>, expectedText: string,
  analysis: Record<string, unknown> | undefined, failure: Record<string, unknown> | undefined,
  duration: number | null): VoiceParagraphRecordingRecognition | undefined {
  const clips = plan.paragraph?.clips;
  // Evidence belongs to the ordered canonical short sentences, rather than the
  // initiating clip or the top-level full-paragraph target.
  if (!clips?.length || new Set(clips.map((clip) => clip.clipId)).size !== clips.length
      || clips.some((clip) => !clip.text.trim() || clip.text.length > 500)
      || clips.map((clip) => clip.text).join("") !== expectedText || plan.plan.clauses.join("") !== expectedText) return undefined;
  const code = failure?.code ?? analysis?.diagnosticCode;
  const diagnosticCode = typeof code === "string" && /^[a-z0-9_]{1,120}$/.test(code) ? code : undefined;
  if (failure || analysis?.checkStatus === "review") {
    let failureRecognition: VoiceRecognition | undefined;
    let failedClipId: string | undefined;
    for (const [value, explicitClipId] of [[failure?.recognition, failure?.failedClipId],
      [analysis?.failureRecognition, analysis?.failedClipId]] as const) {
      const recognition = VoiceRecognitionSchema.safeParse(value);
      if (!recognition.success) continue;
      // Exact suffix binding also identifies repeated sentences without
      // relabelling a per-short transcript as a full-paragraph recognition.
      const matches = clips.filter((clip, index) => clip.text === recognition.data.expectedText
        && (recognition.data.followingText ?? "") === clips.slice(index + 1).map((later) => later.text).join("")
        && (explicitClipId === undefined || explicitClipId === clip.clipId));
      if (matches.length === 1) { failureRecognition = recognition.data; failedClipId = matches[0].clipId; break; }
    }
    return VoiceParagraphRecordingRecognitionSchema.parse({ checkStatus: "review", clipIds: clips.map((clip) => clip.clipId), segments: [],
      ...(diagnosticCode ? { diagnosticCode } : {}), ...(failureRecognition ? { failureRecognition, failedClipId } : {}) });
  }
  if (!["passed", "needs_confirmation"].includes(String(analysis?.checkStatus)) || !Array.isArray(analysis?.segments)) return undefined;
  const projected = analysis.segments.map((value) => {
    const segment = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return { clipId: segment.clipId, text: segment.text, cutStartSeconds: segment.cutStartSeconds,
      cutEndSeconds: segment.cutEndSeconds, ...(segment.recognition !== undefined ? { recognition: segment.recognition } : {}),
      ...(segment.textReview !== undefined ? { textReview: segment.textReview } : {}) };
  });
  const parsed = VoiceParagraphRecordingRecognitionSchema.safeParse({ checkStatus: analysis.checkStatus, clipIds: clips.map((clip) => clip.clipId), segments: projected });
  if (!parsed.success || duration === null || Math.abs((parsed.data.segments.at(-1)?.cutEndSeconds ?? 0) - duration) > 1 / 48_000) return undefined;
  if (parsed.data.segments.some((segment, index) => segment.text !== clips[index].text
      || (segment.recognition && (segment.recognition.stage !== "complete" || segment.recognition.expectedText !== clips[index].text
        || (segment.recognition.followingText ?? "") !== clips.slice(index + 1).map((clip) => clip.text).join(""))))) return undefined;
  return parsed.data;
}

function paragraphCheckWarning(evidence: VoiceParagraphRecordingRecognition, failure: Record<string, unknown> | undefined,
  ended: boolean, analysis?: Record<string, unknown>) {
  if (evidence.checkStatus === "review") return checkWarning(failure ?? { code: evidence.diagnosticCode }, false, ended, analysis, evidence.failureRecognition);
  if (evidence.checkStatus === "needs_confirmation") return "短句音频已安全切分，部分文字待试听确认；请在候选中逐句确认后采用。这里保留完整原音与实际识别。";
  const differences = evidence.segments.filter((segment) => segment.recognition?.contentComparison?.status === "different");
  if (differences.length) return `整段短句切分检查已完成；其中 ${differences.length} 句存在识别文字差异，请展开逐句对照并试听。这里保留完整原音。`;
  return `整段已通过 ${evidence.segments.length} 个短句的切分检查。这里保留模型输出的完整原音。`;
}

export async function listVoiceGenerationRecordings(input: {
  config: Pick<LocalRuntimeConfig, "runtimeRoot">; projectId: string; clipId: string; text: string; cursor?: string;
  workspaceMode?: "short" | "paragraph";
}) {
  const recordings: VoiceGenerationRecording[] = [];
  const locations = roots(input.config);
  const scope = createHash("sha256").update(JSON.stringify([locations, input.projectId, input.clipId, input.text.trim(),
    ...(input.workspaceMode ? [input.workspaceMode] : [])])).digest("hex").slice(0, 32);
  let cursor: RecordingCursor | undefined;
  if (input.cursor !== undefined) {
    try {
      if (input.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error();
      cursor = CursorSchema.parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")));
      if (cursor.scope !== scope) throw new Error();
    } catch { throw new Error("Invalid recording cursor"); }
  }
  const page = (next: RecordingCursor | null) => ({ recordings, truncated: next !== null,
    nextCursor: next ? Buffer.from(JSON.stringify(next)).toString("base64url") : null });
  const position = (run: RecordingRun, afterSource: number | null): RecordingCursor => ({
    version: 1, scope, kind: run.kind, runId: run.runId, created: run.created, afterSource,
  });
  const runs: RecordingRun[] = [];
  // Only direct directory metadata is indexed here. Plan/trace parsing and WAV
  // header reads are bounded per page; no old run is discarded from the index.
  for (const location of locations) {
    try {
      const directory = await opendir(location.root);
      for await (const entry of directory) {
        if (!entry.isDirectory() || !runPattern.test(entry.name)) continue;
        try {
          const info = await stat(path.join(location.root, entry.name));
          // birthtime is stable while new takes/analysis files update mtime.
          runs.push({ ...location, runId: entry.name, created: Math.max(0, info.birthtimeMs) });
        } catch { /* An unavailable run must not stop indexing other runs. */ }
      }
    } catch { /* New work directories may not exist yet. */ }
  }
  const eligible = runs.sort(compareRuns).filter((run) => !cursor || compareRuns(run, cursor) > 0 || (compareRuns(run, cursor) === 0 && cursor.afterSource !== null));
  let inspectedSources = 0;
  for (let runIndex = 0; runIndex < Math.min(eligible.length, RUNS_PER_PAGE); runIndex++) {
    const run = eligible[runIndex];
    try {
      const directory = await runDirectory(run.root, run.runId);
      const plan = PlanSchema.parse(await readJson(path.join(directory, "plan.json"), run.root));
      const mode = plan.generationMode === "paragraph" || plan.paragraph ? "paragraph" : "short";
      if (input.workspaceMode && input.workspaceMode !== mode) continue;
      const paragraphMember = plan.paragraph?.clips.some((clip) => clip.clipId === input.clipId && clip.text.trim() === input.text.trim());
      if (plan.plan.clauses.join("").trim() !== input.text.trim() && !paragraphMember) continue;
      const historicalMatch = plan.projectId === undefined && plan.clipId === undefined;
      if (!historicalMatch && (plan.projectId !== input.projectId || (plan.clipId !== input.clipId && !paragraphMember))) continue;
      const ended = Boolean(await optionalJson(path.join(directory, "failure.json"), run.root) || await optionalJson(path.join(directory, "result.json"), run.root));
      const entries = await opendir(directory);
      const sources: { name: string; group: number; take: number; order: number }[] = [];
      for await (const entry of entries) {
        const match = sourcePattern.exec(entry.name);
        if (!entry.isFile() || !match) continue;
        const group = Number(match[1]), take = Number(match[2]), order = group * 100 + take;
        if (!plan.targets[group - 1] || group > 500 || take > 20) continue;
        if (cursor && compareRuns(run, cursor) === 0 && cursor.afterSource !== null && order <= cursor.afterSource) continue;
        sources.push({ name: entry.name, group, take, order });
      }
      sources.sort((left, right) => left.order - right.order);
      for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
        const source = sources[sourceIndex];
        const { group, take } = source, target = plan.targets[group - 1];
        inspectedSources++;
        try {
          const filePath = path.join(directory, source.name);
          const info = await regularFile(filePath, run.root, MAX_RECORDING_BYTES);
          if (!info.size) throw new Error("Recording not yet published");
          const prefix = source.name.replace(/-source\.wav$/, "");
          const failure = await optionalJson(path.join(directory, `${prefix}-failure.json`), run.root);
          const analysis = await optionalJson(path.join(directory, `${prefix}-analysis.json`), run.root);
          const duration = await wavDuration(filePath, info.size);
          const paragraphRecognition = mode === "paragraph" ? readParagraphRecognition(plan, target.expectedText, analysis, failure, duration) : undefined;
          const recognition = mode === "paragraph" ? undefined : [analysis?.recognition, failure?.recognition].map((value) => VoiceRecognitionSchema.safeParse(value))
            .find((value) => value.success && value.data.expectedText === target.expectedText)?.data;
          const review = failure ?? (["review", "needs_confirmation"].includes(String(analysis?.checkStatus)) ? { code: analysis?.diagnosticCode } : undefined);
          const checked = !review && (mode === "paragraph" ? paragraphRecognition?.checkStatus === "passed"
            : typeof analysis?.transcript === "string" && typeof analysis?.cutEndSeconds === "number");
          const recordingId = `${run.kind}_${run.runId}_${group}_${take}`;
          recordings.push({ recordingId, runId: run.runId, group, take,
            createdAt: plan.createdAt && Number.isFinite(Date.parse(plan.createdAt)) ? plan.createdAt : info.mtime.toISOString(),
            expectedText: target.expectedText, inputText: target.text ?? target.inputText ?? "", duration,
            audioUrl: `/api/voice-generation-recordings/${recordingId}`,
            status: review ? "needs_review" : checked ? "checked" : analysis?.checkStatus === "not_checked" ? "not_checked" : "recorded",
            warning: paragraphRecognition ? paragraphCheckWarning(paragraphRecognition, review, ended, analysis)
              : checkWarning(review, Boolean(checked), ended, analysis, recognition), recognition, paragraphRecognition, historicalMatch,
          });
        } catch { /* A partial write or unavailable take must not hide other recordings. */ }
        if (recordings.length >= RECORDINGS_PER_PAGE || inspectedSources >= 100) {
          return page(sourceIndex + 1 < sources.length || runIndex + 1 < eligible.length ? position(run, source.order) : null);
        }
      }
    } catch { /* Ignore unrelated, incomplete or malformed traces. */ }
  }
  return page(eligible.length > RUNS_PER_PAGE ? position(eligible[RUNS_PER_PAGE - 1], null) : null);
}

export async function resolveVoiceGenerationRecording(config: Pick<LocalRuntimeConfig, "runtimeRoot">, recordingId: string) {
  const match = recordingPattern.exec(recordingId);
  if (!match || Number(match[3]) > 500 || Number(match[4]) > 20) throw new Error("Invalid recording id");
  const location = roots(config).find((entry) => entry.kind === match[1]);
  if (!location) throw new Error("Recording unavailable");
  const directory = await runDirectory(location.root, match[2]);
  const name = `group-${Number(match[3])}-take-${Number(match[4])}-source.wav`;
  const filePath = path.join(directory, name);
  const info = await regularFile(filePath, location.root, MAX_RECORDING_BYTES);
  if (!info.size) throw new Error("Recording unavailable");
  return { filePath, size: info.size, name };
}
