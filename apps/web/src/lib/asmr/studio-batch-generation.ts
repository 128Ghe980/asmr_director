import type { AsmrProject, VoiceClip } from "./schema";
import type { GenerateClipRequest, GenerationBridge, GenerationJobUpdate } from "./generation-bridge";
import type { AudioCandidate } from "./audio-candidate";
import { getLocalStorageError } from "./local-storage-error";
import { getParagraphGroup, getSpeechWorkspaceMode } from "./speech-workspace";
import { getStudioAudioProgress } from "./studio-audio-overview";

export type StudioBatchAction = "audio_missing" | "audio_ungenerated" | "audio_all" | "storyboard_missing" | "storyboard_all";

function hasAdoptedAudio(clip: VoiceClip): boolean {
  return !clip.audio_stale && clip.generation.status === "asset_generated"
    && Boolean(clip.asset.asset_id?.trim()) && Boolean(clip.asset.uri?.trim());
}

function hasAdoptedLocalAudio(clip: VoiceClip): boolean {
  const assetId = clip.asset.asset_id;
  return hasAdoptedAudio(clip) && typeof assetId === "string"
    && /^[A-Za-z0-9_-]{1,200}$/.test(assetId)
    && clip.asset.uri === `asset://clip/${assetId}`;
}

/** Missing audio considers adoption only; ungenerated audio also preserves usable candidates. */
export function getStudioBatchTargets(project: AsmrProject, action: StudioBatchAction, candidates?: readonly AudioCandidate[]): string[] {
  if (action === "audio_ungenerated" && candidates === undefined) return [];
  const audioStates = action === "audio_ungenerated" ? getStudioAudioProgress(project, candidates!).byClip : undefined;
  const targets = project.timeline.tracks.flatMap<VoiceClip>((track) => track.track_type === "voice" ? track.clips : [])
    .map((clip, originalIndex) => ({ clip, originalIndex }))
    .filter(({ clip }) => {
      if (!clip.text.trim()) return false;
      if (action === "audio_all") return clip.kind !== "silent";
      if (action === "audio_ungenerated") return audioStates?.[clip.id] === "pending" || audioStates?.[clip.id] === "needs_update";
      if (action === "audio_missing") return clip.kind !== "silent" && !hasAdoptedAudio(clip);
      if (clip.kind !== "silent" && !hasAdoptedLocalAudio(clip)) return false;
      // Preserve even stale or incomplete user notes when filling missing storyboards.
      return action === "storyboard_all"
        || !Object.prototype.hasOwnProperty.call(project.videoPlan?.shots ?? {}, clip.id);
    })
    .sort((a, b) => a.clip.start - b.clip.start || a.originalIndex - b.originalIndex)
    .map(({ clip }) => clip.id);
  if (!action.startsWith("audio") || getSpeechWorkspaceMode(project) !== "paragraph") return targets;
  return [...new Set(targets.map((clipId) => getParagraphGroup(project, clipId)[0]?.id ?? clipId))];
}

export type StudioBatchProgress = {
  total: number;
  /** Finished items, including failures and intentional skips. */
  completed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentClipId?: string;
  waitingBetweenItems?: boolean;
};

export type StudioBatchFailure = { clipId: string; message: string };
export type StudioBatchResult = Omit<StudioBatchProgress, "currentClipId" | "waitingBetweenItems"> & {
  state: "completed" | "cancelled" | "stopped";
  failures: StudioBatchFailure[];
};

export type StudioBatchQueueOptions = {
  clipIds: readonly string[];
  signal: AbortSignal;
  interItemDelayMs?: number;
  onItem: (clipId: string, signal: AbortSignal) => "completed" | "skipped" | Promise<"completed" | "skipped">;
  onProgress?: (progress: StudioBatchProgress) => void;
};

/** Runs serially; callers validate the latest project and own all network/persistence work. */
export async function runStudioBatchQueue({ clipIds, signal, interItemDelayMs = 0, onItem, onProgress }: StudioBatchQueueOptions): Promise<StudioBatchResult> {
  const targets = [...clipIds];
  const counts = { total: targets.length, completed: 0, succeeded: 0, failed: 0, skipped: 0 };
  const failures: StudioBatchFailure[] = [];
  let stopped = false;
  const report = (currentClipId?: string, waitingBetweenItems = false) => onProgress?.({ ...counts,
    ...(currentClipId === undefined ? {} : { currentClipId }), ...(waitingBetweenItems ? { waitingBetweenItems: true } : {}) });
  report();

  for (const [index, clipId] of targets.entries()) {
    if (signal.aborted) break;
    report(clipId);
    if (signal.aborted) break;
    let skipped = false;
    try {
      const outcome = await onItem(clipId, signal);
      if (signal.aborted) break;
      if (outcome === "skipped") { counts.skipped += 1; skipped = true; }
      else if (outcome === "completed") counts.succeeded += 1;
      else throw new Error("本段生成未返回有效结果。");
    } catch (error) {
      if (signal.aborted) break;
      const storageError = getLocalStorageError(error);
      counts.failed += 1;
      const message = storageError?.message ?? (error instanceof Error ? error.message : typeof error === "string" ? error : "本段生成失败。");
      failures.push({ clipId, message: message || "本段生成失败。" });
      stopped = Boolean(storageError);
    }
    counts.completed += 1;
    report();
    if (stopped) break;
    if (!signal.aborted && !skipped && index < targets.length - 1 && interItemDelayMs > 0) {
      report(undefined, true);
      await waitBetweenBatchItems(interItemDelayMs, signal);
    }
  }

  report();
  return { state: signal.aborted ? "cancelled" : stopped ? "stopped" : "completed", ...counts, failures };
}

/** Cancellation releases both the timer and listener without waiting for the interval. */
function waitBetweenBatchItems(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export type StudioVoiceGenerationOptions = {
  bridge: GenerationBridge;
  request: GenerateClipRequest;
  signal: AbortSignal;
  onUpdate: (update: GenerationJobUpdate) => void;
};

function abortError(): Error {
  const error = new Error("已取消批量生成。");
  error.name = "AbortError";
  return error;
}

/** A bridge's startup promise may resolve before audio generation has finished. */
export function waitForStudioVoiceGeneration({ bridge, request, signal, onUpdate }: StudioVoiceGenerationOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let cancellationRequested = false;
    let jobId: string | undefined;
    const cancelledJobIds = new Set<string>();
    const cancelJob = (id?: string) => {
      if (!id || cancelledJobIds.has(id)) return;
      cancelledJobIds.add(id);
      try { void bridge.cancelGeneration(id).catch(() => {}); } catch { /* Cancellation must still settle if the bridge throws. */ }
    };
    const finish = (error: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(getLocalStorageError(error) ?? error);
    };
    const onAbort = () => {
      cancellationRequested = true;
      finish(abortError());
      cancelJob(jobId);
    };
    const handleUpdate = (update: GenerationJobUpdate) => {
      if (settled) {
        if (cancellationRequested) cancelJob(update.job.jobId);
        return;
      }
      jobId = update.job.jobId;
      if (signal.aborted) { onAbort(); return; }
      if (update.type === "snapshot") {
        try { onUpdate(update); } catch (error) { finish(error); }
        return;
      }
      // Guard late/reentrant updates before delivering the terminal event, then settle.
      settled = true;
      signal.removeEventListener("abort", onAbort);
      try {
        onUpdate(update);
        if (update.type === "failed") reject(getLocalStorageError({ code: update.errorCode }) ?? new Error(update.error));
        else if (update.type === "canceled") reject(abortError());
        else resolve();
      } catch (error) { reject(error); }
    };

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    try {
      void bridge.generateClip(request, handleUpdate).then((started) => {
        jobId = started.jobId;
        if (cancellationRequested) cancelJob(jobId);
      }, (error: unknown) => finish(error));
    } catch (error) { finish(error); }
  });
}
