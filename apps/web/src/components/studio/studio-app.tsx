"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  applyDirectorPreset,
  type DirectorPreset,
} from "@/lib/asmr/director-presets";
import {
  getClipFieldValidationIssues,
  getProjectValidationIssues,
  nudgeClipTiming,
  updateClipInProject,
  type ClipPatch,
  type ClipTimingNudge,
} from "@/lib/asmr/edit-project";
import type {
  GenerateClipReason,
  GenerationBridge,
  GenerationJobUpdate,
} from "@/lib/asmr/generation-bridge";
import {
  getClipGenerationFingerprint,
  isCurrentClipGenerationFingerprint,
} from "@/lib/asmr/generation-fingerprint";
import {
  commitGenerationFailure,
  commitGenerationSuccess,
} from "@/lib/asmr/generation-project-state";
import {
  clearGenerationJob,
  emptyGenerationRuntimeState,
  getGenerationJobForClip,
  isActiveGenerationJob,
  markGenerationJobCanceling,
  upsertGenerationJob,
} from "@/lib/asmr/generation-runtime";
import { getGenerationView } from "@/lib/asmr/generation-view";
import { createLocalGenerationBridge } from "@/lib/asmr/local-generation-bridge";
import { createMockGenerationBridge } from "@/lib/asmr/mock-generation-bridge";
import { resolvePlayableAssetUri } from "@/lib/asmr/playback-asset-resolver";
import {
  clearSavedProject,
  loadSavedProject,
  parseImportedProject,
  saveProject,
  serializeProject,
} from "@/lib/asmr/project-persistence";
import { getProjectWorkspaceSummary } from "@/lib/asmr/project-summary";
import type { AsmrProject } from "@/lib/asmr/schema";
import { getValueLabel } from "@/lib/asmr/ui-copy";
import { flattenClips, formatTimeRange } from "@/lib/asmr/view-model";

import { ClipInspector } from "./clip-inspector";
import { ProjectWorkspace } from "./project-workspace";
import { StoryboardPanel } from "./storyboard-panel";
import { TimelinePanel } from "./timeline-panel";
import { ValidationPanel } from "./validation-panel";

type StudioAppProps = {
  project: AsmrProject;
};

function exportProjectJson(project: AsmrProject) {
  const blob = new Blob([JSON.stringify(project, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `${project.project_id}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function EmotionCurve({ project }: { project: AsmrProject }) {
  return (
    <section className="rounded-lg border border-studio-line bg-studio-panel/88">
      <div className="flex h-12 items-center justify-between border-b border-studio-line px-4">
        <div>
          <h2 className="text-sm font-semibold text-studio-text">情绪曲线</h2>
          <p className="text-xs text-studio-muted">
            {project.emotion_curve.length} 个导演节拍
          </p>
        </div>
      </div>

      <div className="overflow-x-auto p-4">
        <div className="flex h-20 min-w-[680px] overflow-hidden rounded-lg border border-white/[0.06] bg-black/16 lg:min-w-0">
          {project.emotion_curve.map((point) => {
            const duration = point.end - point.start;
            const width = `${Math.max(6, (duration / project.duration) * 100)}%`;

            return (
              <div
                key={`${point.start}-${point.end}-${point.emotion}`}
                className="flex min-w-0 flex-col justify-between border-r border-white/[0.08] bg-white/[0.035] px-3 py-3 last:border-r-0"
                style={{ width }}
              >
                <span className="truncate text-sm font-semibold text-studio-text">
                  {getValueLabel(point.emotion)}
                </span>
                <span className="truncate text-xs text-studio-muted">
                  {formatTimeRange(point.start, duration)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function StudioApp({ project }: StudioAppProps) {
  const [editableProject, setEditableProject] = useState<AsmrProject>(() => project);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const [importError, setImportError] = useState<string>();
  const [restoreState, setRestoreState] = useState<"demo" | "restored">("demo");
  const skipNextSaveRef = useRef(false);
  const bridgeRef = useRef<GenerationBridge | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generationSessionRef = useRef(0);
  const generationReasonsRef = useRef<Record<string, GenerateClipReason>>({});
  const generationFingerprintsRef = useRef<Record<string, string>>({});
  const generationRuntimeStateRef = useRef(emptyGenerationRuntimeState);
  const [generationRuntimeState, setGenerationRuntimeState] = useState(
    emptyGenerationRuntimeState,
  );
  const clips = useMemo(() => flattenClips(editableProject), [editableProject]);
  const [selectedClipId, setSelectedClipId] = useState<string | undefined>(
    () => clips[0]?.id,
  );
  const selectedClip =
    clips.find((clip) => clip.id === selectedClipId) ?? clips[0];
  const activeClipId = selectedClip?.id;
  const validationIssues = useMemo(
    () => getProjectValidationIssues(editableProject),
    [editableProject],
  );
  const selectedClipValidationIssues = useMemo(
    () =>
      activeClipId
        ? getClipFieldValidationIssues(
            editableProject,
            activeClipId,
            validationIssues,
          )
        : {},
    [activeClipId, editableProject, validationIssues],
  );
  const selectedClipHasValidationIssues =
    Object.keys(selectedClipValidationIssues).length > 0;
  const isDirty = useMemo(
    () => serializeProject(editableProject) !== serializeProject(project),
    [editableProject, project],
  );
  const workspaceSummary = useMemo(
    () =>
      getProjectWorkspaceSummary({
        project: editableProject,
        isDirty,
        restoreState,
        validationIssueCount: validationIssues.length,
      }),
    [editableProject, isDirty, restoreState, validationIssues.length],
  );
  const generationView = useMemo(
    () =>
      getGenerationView({
        project: editableProject,
        selectedClip,
        runtimeState: generationRuntimeState,
        selectedClipHasValidationIssues,
      }),
    [
      editableProject,
      generationRuntimeState,
      selectedClip,
      selectedClipHasValidationIssues,
    ],
  );
  const previewSummary = generationView.preview;
  const displayProject = generationView.displayProject;
  const displaySelectedClip = generationView.displaySelectedClip ?? selectedClip;

  function getGenerationBridge() {
    if (bridgeRef.current === null) {
      bridgeRef.current =
        process.env.NEXT_PUBLIC_ASMR_GENERATION_MODE === "mock"
          ? createMockGenerationBridge()
          : createLocalGenerationBridge();
    }

    return bridgeRef.current;
  }

  useEffect(() => {
    let isCancelled = false;

    queueMicrotask(() => {
      if (isCancelled) {
        return;
      }

      try {
        const loadedProject = loadSavedProject(window.localStorage, {
          fallbackProject: project,
        });

        setEditableProject(loadedProject.project);
        setRestoreState(loadedProject.restored ? "restored" : "demo");
        setSelectedClipId(flattenClips(loadedProject.project)[0]?.id);
      } catch {
        setEditableProject(project);
        setRestoreState("demo");
        setSelectedClipId(flattenClips(project)[0]?.id);
      } finally {
        setHasLoadedStorage(true);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [project]);

  useEffect(() => {
    if (!hasLoadedStorage) {
      return;
    }

    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }

    try {
      saveProject(window.localStorage, editableProject);
    } catch {
      // Browser storage can be unavailable in restrictive contexts.
    }
  }, [editableProject, hasLoadedStorage]);

  useEffect(() => {
    generationRuntimeStateRef.current = generationRuntimeState;
  }, [generationRuntimeState]);

  useEffect(() => {
    return () => {
      generationSessionRef.current += 1;
      const jobIds = new Set([
        ...Object.keys(generationReasonsRef.current),
        ...Object.keys(generationRuntimeStateRef.current.jobsById),
      ]);
      const bridge = bridgeRef.current;

      if (bridge) {
        for (const jobId of jobIds) {
          void bridge.cancelGeneration(jobId);
        }
      }

      generationReasonsRef.current = {};
      generationFingerprintsRef.current = {};
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  function clearGenerationSession() {
    generationSessionRef.current += 1;
    const jobIds = new Set([
      ...Object.keys(generationReasonsRef.current),
      ...Object.keys(generationRuntimeStateRef.current.jobsById),
    ]);
    const bridge = bridgeRef.current;

    if (bridge) {
      for (const jobId of jobIds) {
        void bridge.cancelGeneration(jobId);
      }
    }

    generationReasonsRef.current = {};
    generationFingerprintsRef.current = {};
    generationRuntimeStateRef.current = emptyGenerationRuntimeState;
    setGenerationRuntimeState(emptyGenerationRuntimeState);
    audioRef.current?.pause();
    audioRef.current = null;
  }

  function setRuntimeState(nextState: typeof generationRuntimeStateRef.current) {
    generationRuntimeStateRef.current = nextState;
    setGenerationRuntimeState(nextState);
  }

  function cancelGenerationForClip(clipId: string) {
    const job = getGenerationJobForClip(
      generationRuntimeStateRef.current,
      clipId,
    );

    if (!job || !isActiveGenerationJob(job)) {
      return;
    }

    const next = clearGenerationJob(
      generationRuntimeStateRef.current,
      job.jobId,
    );

    delete generationReasonsRef.current[job.jobId];
    delete generationFingerprintsRef.current[job.jobId];
    setRuntimeState(next);
    void bridgeRef.current?.cancelGeneration(job.jobId);
  }

  function handleGenerationUpdate(
    update: GenerationJobUpdate,
    generationSession: number,
  ) {
    if (generationSession !== generationSessionRef.current) {
      return;
    }

    if (update.type === "snapshot") {
      setGenerationRuntimeState((current) => {
        const next = upsertGenerationJob(current, update.job);
        generationRuntimeStateRef.current = next;

        return next;
      });
      return;
    }

    if (update.type === "succeeded") {
      const fingerprint = generationFingerprintsRef.current[update.job.jobId];

      setEditableProject((currentProject) =>
        fingerprint &&
        isCurrentClipGenerationFingerprint(
          currentProject,
          update.job.clipId,
          fingerprint,
        )
          ? commitGenerationSuccess(
              currentProject,
              update.job.clipId,
              update.asset,
            )
          : currentProject,
      );
      setGenerationRuntimeState((current) => {
        const next = clearGenerationJob(current, update.job.jobId);
        generationRuntimeStateRef.current = next;

        return next;
      });
      delete generationReasonsRef.current[update.job.jobId];
      delete generationFingerprintsRef.current[update.job.jobId];
      return;
    }

    if (update.type === "failed") {
      const reason =
        generationReasonsRef.current[update.job.jobId] ?? "generate";
      const fingerprint = generationFingerprintsRef.current[update.job.jobId];

      setEditableProject((currentProject) =>
        fingerprint &&
        isCurrentClipGenerationFingerprint(
          currentProject,
          update.job.clipId,
          fingerprint,
        )
          ? commitGenerationFailure(currentProject, update.job.clipId, {
              reason,
              error: update.error,
            })
          : currentProject,
      );
      setGenerationRuntimeState((current) => {
        const next = clearGenerationJob(current, update.job.jobId);
        generationRuntimeStateRef.current = next;

        return next;
      });
      delete generationReasonsRef.current[update.job.jobId];
      delete generationFingerprintsRef.current[update.job.jobId];
      return;
    }

    setGenerationRuntimeState((current) => {
      const next = clearGenerationJob(current, update.job.jobId);
      generationRuntimeStateRef.current = next;

      return next;
    });
    delete generationReasonsRef.current[update.job.jobId];
    delete generationFingerprintsRef.current[update.job.jobId];
  }

  function handleGenerateSelectedClip() {
    if (!selectedClip || generationView.selectedClipControl.disabled) {
      return;
    }

    const action = generationView.selectedClipControl.action;
    const reason: GenerateClipReason =
      action === "retry"
        ? "retry"
        : action === "regenerate"
          ? "regenerate"
          : "generate";
    let didFinishBeforeStart = false;
    const generationSession = generationSessionRef.current;
    const fingerprint = getClipGenerationFingerprint(selectedClip);

    void getGenerationBridge()
      .generateClip(
        {
          project: editableProject,
          clipId: selectedClip.id,
          reason,
        },
        (update) => {
          if (generationSession !== generationSessionRef.current) {
            return;
          }

          generationReasonsRef.current[update.job.jobId] = reason;
          generationFingerprintsRef.current[update.job.jobId] = fingerprint;
          handleGenerationUpdate(update, generationSession);

          if (update.type !== "snapshot") {
            didFinishBeforeStart = true;
          }
        },
      )
      .then((started) => {
        if (generationSession !== generationSessionRef.current) {
          return;
        }

        if (!didFinishBeforeStart) {
          generationReasonsRef.current[started.jobId] = reason;
          generationFingerprintsRef.current[started.jobId] = fingerprint;
        }
      })
      .catch(() => undefined);
  }

  function handleCancelSelectedGeneration() {
    const jobId = generationView.selectedClipControl.jobId;

    if (!jobId) {
      return;
    }

    setGenerationRuntimeState((current) => {
      const next = markGenerationJobCanceling(current, jobId);
      generationRuntimeStateRef.current = next;

      return next;
    });
    void bridgeRef.current?.cancelGeneration(jobId);
  }

  function handlePlaySelectedClip() {
    if (!generationView.selectedClipPreview.canPlay) {
      return;
    }

    const resolvedUri = resolvePlayableAssetUri(
      generationView.selectedClipPreview.uri,
    );

    if (!resolvedUri) {
      return;
    }

    audioRef.current?.pause();
    const audio = new Audio(resolvedUri);
    audioRef.current = audio;
    void audio.play().catch(() => {
      audio.pause();

      if (audioRef.current === audio) {
        audioRef.current = null;
      }
    });
  }

  function handleUpdateClip(clipId: string, patch: ClipPatch) {
    cancelGenerationForClip(clipId);
    setEditableProject((currentProject) =>
      updateClipInProject(currentProject, clipId, patch),
    );
    setImportError(undefined);
  }

  function handleApplyDirectorPreset(clipId: string, preset: DirectorPreset) {
    cancelGenerationForClip(clipId);
    setEditableProject((currentProject) =>
      applyDirectorPreset(currentProject, clipId, preset),
    );
    setImportError(undefined);
  }

  function handleNudgeClipTiming(clipId: string, nudge: ClipTimingNudge) {
    cancelGenerationForClip(clipId);
    setEditableProject((currentProject) =>
      nudgeClipTiming(currentProject, clipId, nudge),
    );
    setImportError(undefined);
  }

  function handleImportJson(text: string) {
    const importedProject = parseImportedProject(text);

    if (!importedProject.success) {
      setImportError(importedProject.error);
      return;
    }

    clearGenerationSession();
    setEditableProject(importedProject.project);
    setSelectedClipId(flattenClips(importedProject.project)[0]?.id);
    setRestoreState("restored");
    setImportError(undefined);
  }

  function handleResetDemo() {
    try {
      clearSavedProject(window.localStorage);
    } catch {
      // Reset should still restore the in-memory demo when storage is blocked.
    }

    setEditableProject((currentProject) => {
      skipNextSaveRef.current =
        serializeProject(currentProject) !== serializeProject(project);

      return project;
    });
    clearGenerationSession();
    setSelectedClipId(flattenClips(project)[0]?.id);
    setRestoreState("demo");
    setImportError(undefined);
  }

  return (
    <ProjectWorkspace
      importError={importError}
      summary={workspaceSummary}
      preview={previewSummary}
      selectedClipPreview={generationView.selectedClipPreview}
      onExportJson={() => exportProjectJson(editableProject)}
      onImportJson={handleImportJson}
      onPlaySelectedClip={handlePlaySelectedClip}
      onResetDemo={handleResetDemo}
    >
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(220px,0.86fr)_minmax(0,1.26fr)_minmax(220px,0.86fr)]">
        <div className="min-h-[520px] xl:h-[calc(100vh-152px)]">
          <StoryboardPanel
            project={displayProject}
            selectedClipId={activeClipId}
            onSelectClip={setSelectedClipId}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <TimelinePanel
            project={displayProject}
            selectedClipId={activeClipId}
            onSelectClip={setSelectedClipId}
          />
          <EmotionCurve project={editableProject} />
          <ValidationPanel issues={validationIssues} />
        </div>

        <div className="min-w-0">
          <ClipInspector
            fieldValidationIssues={selectedClipValidationIssues}
            selectedClip={displaySelectedClip}
            selectedClipGeneration={generationView.selectedClipControl}
            selectedClipSlot={previewSummary.selectedClipSlot}
            onApplyDirectorPreset={handleApplyDirectorPreset}
            onGenerateSelectedClip={handleGenerateSelectedClip}
            onCancelSelectedGeneration={handleCancelSelectedGeneration}
            onNudgeClipTiming={handleNudgeClipTiming}
            onUpdateClip={handleUpdateClip}
          />
        </div>
      </div>
    </ProjectWorkspace>
  );
}
