import type { AsmrProject, VoiceClip } from "./schema";
import type { GenerateClipRequest, GenerationBridge, GenerationJobUpdate } from "./generation-bridge";
import { getLocalStorageError } from "./local-storage-error";

export type StudioBatchAction = "audio_missing" | "audio_all" | "storyboard_missing" | "storyboard_all";

function hasAdoptedAudio(clip: VoiceClip): boolean {
  return clip.generation.status === "asset_generated"
    && Boolean(clip.asset.asset_id?.trim()) && Boolean(clip.asset.uri?.trim());
}

function hasAdoptedLocalAudio(clip: VoiceClip): boolean {
  const assetId = clip.asset.asset_id;
  return hasAdoptedAudio(clip) && typeof assetId === "string"
    && /^[A-Za-z0-9_-]{1,200}$/.test(assetId)
    && clip.asset.uri === `asset://clip/${assetId}`;
}

/** Candidates are not adopted audio: only the current timeline asset is considered. */
export function getStudioBatchTargets(project: AsmrProject, action: StudioBatchAction): string[] {
  return project.timeline.tracks.flatMap<VoiceClip>((track) => track.track_type === "voice" ? track.clips : [])
    .map((clip, originalIndex) => ({ clip, originalIndex }))
    .filter(({ clip }) => {
      if (!clip.text.trim()) return false;
      if (action === "audio_all") return true;
      if (action === "audio_missing") return !hasAdoptedAudio(clip);
      if (!hasAdoptedLocalAudio(clip)) return false;
      // Preserve even stale or incomplete user notes when filling missing storyboards.
      return action === "storyboard_all"
        || !Object.prototype.hasOwnProperty.call(project.videoPlan?.shots ?? {}, clip.id);
    })
    .sort((a, b) => a.clip.start - b.clip.start || a.originalIndex - b.originalIndex)
    .map(({ clip }) => clip.id);
}

export type StudioBatchProgress = {
  total: number;
  /** Finished items, including failures and intentional skips. */
  completed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentClipId?: string;
};

export type StudioBatchFailure = { clipId: string; message: string };
export type StudioBatchResult = Omit<StudioBatchProgress, "currentClipId"> & {
  state: "completed" | "cancelled" | "stopped";
  failures: StudioBatchFailure[];
};

export type StudioBatchQueueOptions = {
  clipIds: readonly string[];
  signal: AbortSignal;
  onItem: (clipId: string, signal: AbortSignal) => "completed" | "skipped" | Promise<"completed" | "skipped">;
  onProgress?: (progress: StudioBatchProgress) => void;
};

/** Runs serially; callers validate the latest project and own all network/persistence work. */
export async function runStudioBatchQueue({ clipIds, signal, onItem, onProgress }: StudioBatchQueueOptions): Promise<StudioBatchResult> {
  const targets = [...clipIds];
  const counts = { total: targets.length, completed: 0, succeeded: 0, failed: 0, skipped: 0 };
  const failures: StudioBatchFailure[] = [];
  let stopped = false;
  const report = (currentClipId?: string) => onProgress?.({ ...counts, ...(currentClipId === undefined ? {} : { currentClipId }) });
  report();

  for (const clipId of targets) {
    if (signal.aborted) break;
    report(clipId);
    if (signal.aborted) break;
    try {
      const outcome = await onItem(clipId, signal);
      if (signal.aborted) break;
      if (outcome === "skipped") counts.skipped += 1;
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
  }

  report();
  return { state: signal.aborted ? "cancelled" : stopped ? "stopped" : "completed", ...counts, failures };
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
