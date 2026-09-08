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
  GenerateProjectMixReason,
  GenerationBridge,
  GenerationJobUpdate,
} from "@/lib/asmr/generation-bridge";
import {
  getClipGenerationFingerprint,
  getProjectMixFingerprint,
  isCurrentClipGenerationFingerprint,
  isCurrentProjectMixFingerprint,
} from "@/lib/asmr/generation-fingerprint";
import {
  commitGenerationFailure,
  commitGenerationSuccess,
} from "@/lib/asmr/generation-project-state";
import {
  clearGenerationJob,
  emptyGenerationRuntimeState,
  getGenerationJobForClip,
  getGenerationJobForProjectMix,
  isActiveGenerationJob,
  markGenerationJobCanceling,
  upsertGenerationJob,
} from "@/lib/asmr/generation-runtime";
import { getGenerationView } from "@/lib/asmr/generation-view";
import { createLocalGenerationBridge } from "@/lib/asmr/local-generation-bridge";
import { createMockGenerationBridge } from "@/lib/asmr/mock-generation-bridge";
import { resolvePlayableAssetUri } from "@/lib/asmr/playback-asset-resolver";
import type { AudioAnalysis } from "@/lib/asmr/audio-analysis";
import {
  adoptPlannerDraft,
  createInitialProjectLibrary,
  createLibraryProject,
  createProjectRevision,
  deleteLibraryProject,
  duplicateLibraryProject,
  getCurrentLibraryEntry,
  getProjectLibrarySummaries,
  loadProjectLibrary,
  replaceLibraryProject,
  restoreProjectRevision,
  saveProjectLibrary,
  selectLibraryProject,
  setLibraryProjectMixFingerprint,
  updateLibraryProject,
} from "@/lib/asmr/project-library";
import {
  commitProjectMixFailure,
  commitProjectMixSuccess,
} from "@/lib/asmr/project-mix-state";
import {
  parseImportedProject,
  serializeProject,
} from "@/lib/asmr/project-persistence";
import {
  getProductQualityReport,
  type AudioAnalysisStatus,
} from "@/lib/asmr/product-quality";
import { getProjectWorkspaceSummary } from "@/lib/asmr/project-summary";
import type { AsmrProject } from "@/lib/asmr/schema";
import type { PlannerBrief, PlannerDraft } from "@/lib/asmr/planner";
import { getValueLabel } from "@/lib/asmr/ui-copy";
import { flattenClips, formatTimeRange } from "@/lib/asmr/view-model";

import { ClipInspector } from "./clip-inspector";
import { PlannerPanel } from "./planner-panel";
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
  const [workspaceView, setWorkspaceView] = useState<"editor" | "planner">("editor");
  const [editableProject, setEditableProject] = useState<AsmrProject>(() => project);
  const [projectLibrary, setProjectLibrary] = useState(() =>
    createInitialProjectLibrary(project, new Date(0)),
  );
  const projectLibraryRef = useRef(projectLibrary);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [importError, setImportError] = useState<string>();
  const [restoreState, setRestoreState] = useState<"demo" | "restored">("demo");
  const [audioAnalysis, setAudioAnalysis] = useState<AudioAnalysis>();
  const [audioAnalysisStatus, setAudioAnalysisStatus] =
    useState<AudioAnalysisStatus>("idle");
  const bridgeRef = useRef<GenerationBridge | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generationSessionRef = useRef(0);
  const generationReasonsRef = useRef<Record<string, GenerateClipReason>>({});
  const generationFingerprintsRef = useRef<Record<string, string>>({});
  const projectMixReasonsRef = useRef<Record<string, GenerateProjectMixReason>>({});
  const projectMixJobFingerprintsRef = useRef<Record<string, string>>({});
  const [projectMixFingerprint, setProjectMixFingerprint] = useState<string>();
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
  const currentLibraryEntry = projectLibrary.projects.find(
    (entry) => entry.projectId === editableProject.project_id,
  );
  const isDirty = useMemo(
    () =>
      !currentLibraryEntry ||
      serializeProject(editableProject) !==
        serializeProject(currentLibraryEntry.project),
    [currentLibraryEntry, editableProject],
  );
  const workspaceSummary = useMemo(
    () =>
      getProjectWorkspaceSummary({
        project: editableProject,
        isDirty,
        restoreState,
        storageAvailable,
        validationIssueCount: validationIssues.length,
      }),
    [
      editableProject,
      isDirty,
      restoreState,
      storageAvailable,
      validationIssues.length,
    ],
  );
  const generationView = useMemo(
    () =>
      getGenerationView({
        project: editableProject,
        selectedClip,
        runtimeState: generationRuntimeState,
        selectedClipHasValidationIssues,
        projectMixFingerprint,
      }),
    [
      editableProject,
      generationRuntimeState,
      projectMixFingerprint,
      selectedClip,
      selectedClipHasValidationIssues,
    ],
  );
  const previewSummary = generationView.preview;
  const displayProject = generationView.displayProject;
  const displaySelectedClip = generationView.displaySelectedClip ?? selectedClip;
  const projectMixUri = generationView.projectMixControl.uri?.startsWith(
    "asset://mix/",
  )
    ? generationView.projectMixControl.uri
    : undefined;
  const selectedClipUri = generationView.selectedClipPreview.uri?.startsWith(
    "asset://clip/",
  )
    ? generationView.selectedClipPreview.uri
    : undefined;
  const analysisUri = projectMixUri ?? selectedClipUri;
  const audioAnalysisSourceLabel = projectMixUri
    ? "整段真实波形"
    : selectedClipUri
      ? "片段真实波形"
      : "等待真实音频";
  const qualityReport = useMemo(
    () =>
      getProductQualityReport({
        project: editableProject,
        validationIssueCount: validationIssues.length,
        mixIsStale:
          generationView.projectMixControl.statusLabel === "需重混",
        analysisStatus: projectMixUri ? audioAnalysisStatus : "idle",
        analysis: projectMixUri ? audioAnalysis : undefined,
      }),
    [
      audioAnalysis,
      audioAnalysisStatus,
      editableProject,
      generationView.projectMixControl.statusLabel,
      projectMixUri,
      validationIssues.length,
    ],
  );
  const projectSummaries = useMemo(
    () => getProjectLibrarySummaries(projectLibrary),
    [projectLibrary],
  );

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
        const loadedLibrary = loadProjectLibrary(
          window.localStorage,
          project,
        );
        const loadedEntry = getCurrentLibraryEntry(loadedLibrary);

        saveProjectLibrary(window.localStorage, loadedLibrary);
        setStorageAvailable(true);
        projectLibraryRef.current = loadedLibrary;
        setProjectLibrary(loadedLibrary);
        setEditableProject(loadedEntry.project);
        setProjectMixFingerprint(loadedEntry.mixFingerprint);
        setRestoreState(
          loadedEntry.projectId === project.project_id &&
            serializeProject(loadedEntry.project) === serializeProject(project)
            ? "demo"
            : "restored",
        );
        setSelectedClipId(flattenClips(loadedEntry.project)[0]?.id);
      } catch {
        const fallbackLibrary = createInitialProjectLibrary(project);
        setStorageAvailable(false);
        projectLibraryRef.current = fallbackLibrary;
        setProjectLibrary(fallbackLibrary);
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

    let isCancelled = false;

    queueMicrotask(() => {
      if (isCancelled) {
        return;
      }

      const nextLibrary = updateLibraryProject(
        projectLibraryRef.current,
        editableProject,
      );

      try {
        saveProjectLibrary(window.localStorage, nextLibrary);
        setStorageAvailable(true);
      } catch {
        setStorageAvailable(false);
      }

      projectLibraryRef.current = nextLibrary;
      setProjectLibrary(nextLibrary);
    });

    return () => {
      isCancelled = true;
    };
  }, [editableProject, hasLoadedStorage]);

  useEffect(() => {
    const controller = new AbortController();

    if (!analysisUri) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) {
          setAudioAnalysis(undefined);
          setAudioAnalysisStatus("idle");
        }
      });

      return () => controller.abort();
    }

    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setAudioAnalysis(undefined);
        setAudioAnalysisStatus("loading");
      }
    });

    void fetch(
      `/api/assets/analysis?uri=${encodeURIComponent(analysisUri)}&bars=64`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Audio analysis failed");
        }

        return (await response.json()) as { analysis?: AudioAnalysis };
      })
      .then((body) => {
        if (!body.analysis) {
          throw new Error("Audio analysis missing");
        }

        setAudioAnalysis(body.analysis);
        setAudioAnalysisStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        void error;
        setAudioAnalysis(undefined);
        setAudioAnalysisStatus("error");
      });

    return () => controller.abort();
  }, [analysisUri]);

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
      projectMixReasonsRef.current = {};
      projectMixJobFingerprintsRef.current = {};
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
    projectMixReasonsRef.current = {};
    projectMixJobFingerprintsRef.current = {};
    generationRuntimeStateRef.current = emptyGenerationRuntimeState;
    setGenerationRuntimeState(emptyGenerationRuntimeState);
    setProjectMixFingerprint(undefined);
    audioRef.current?.pause();
    audioRef.current = null;
  }

  function persistLibrary(nextLibrary: typeof projectLibrary) {
    projectLibraryRef.current = nextLibrary;
    setProjectLibrary(nextLibrary);

    try {
      saveProjectLibrary(window.localStorage, nextLibrary);
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }

  function activateLibraryProject(
    nextLibrary: typeof projectLibrary,
    nextRestoreState: "demo" | "restored" = "restored",
  ) {
    const entry = getCurrentLibraryEntry(nextLibrary);

    clearGenerationSession();
    persistLibrary(nextLibrary);
    setEditableProject(entry.project);
    setProjectMixFingerprint(entry.mixFingerprint);
    setSelectedClipId(flattenClips(entry.project)[0]?.id);
    setRestoreState(nextRestoreState);
    setImportError(undefined);
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

  function cancelProjectMixGeneration() {
    const job = getGenerationJobForProjectMix(
      generationRuntimeStateRef.current,
      "wav",
    );

    if (!job || !isActiveGenerationJob(job)) {
      return;
    }

    const next = clearGenerationJob(
      generationRuntimeStateRef.current,
      job.jobId,
    );

    delete projectMixReasonsRef.current[job.jobId];
    delete projectMixJobFingerprintsRef.current[job.jobId];
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
      if (update.job.target?.type === "project_mix") {
        const fingerprint =
          projectMixJobFingerprintsRef.current[update.job.jobId];

        setEditableProject((currentProject) =>
          fingerprint &&
          isCurrentProjectMixFingerprint(currentProject, fingerprint)
            ? commitProjectMixSuccess(currentProject, update.asset)
            : currentProject,
        );
        if (fingerprint) {
          const nextLibrary = setLibraryProjectMixFingerprint(
            projectLibraryRef.current,
            projectLibraryRef.current.currentProjectId,
            fingerprint,
          );
          projectLibraryRef.current = nextLibrary;
          setProjectLibrary(nextLibrary);
          setProjectMixFingerprint(fingerprint);
        }
        setGenerationRuntimeState((current) => {
          const next = clearGenerationJob(current, update.job.jobId);
          generationRuntimeStateRef.current = next;

          return next;
        });
        delete projectMixReasonsRef.current[update.job.jobId];
        delete projectMixJobFingerprintsRef.current[update.job.jobId];
        return;
      }

      const fingerprint = generationFingerprintsRef.current[update.job.jobId];

      setEditableProject((currentProject) =>
        fingerprint &&
        isCurrentClipGenerationFingerprint(
          currentProject,
          update.job.clipId,
          fingerprint,
          {
            ignoreVoiceStart: Boolean(projectLibraryRef.current.projects.find(
              (entry) => entry.projectId === currentProject.project_id,
            )?.plannerSource),
          },
        )
          ? commitGenerationSuccess(
              currentProject,
              update.job.clipId,
              update.asset,
              {
                fitVoiceTiming: Boolean(projectLibraryRef.current.projects.find(
                  (entry) => entry.projectId === currentProject.project_id,
                )?.plannerSource),
              },
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
      if (update.job.target?.type === "project_mix") {
        const reason =
          projectMixReasonsRef.current[update.job.jobId] ?? "mix";
        const fingerprint =
          projectMixJobFingerprintsRef.current[update.job.jobId];

        setEditableProject((currentProject) =>
          fingerprint &&
          isCurrentProjectMixFingerprint(currentProject, fingerprint)
            ? commitProjectMixFailure(currentProject, {
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
        delete projectMixReasonsRef.current[update.job.jobId];
        delete projectMixJobFingerprintsRef.current[update.job.jobId];
        return;
      }

      const reason =
        generationReasonsRef.current[update.job.jobId] ?? "generate";
      const fingerprint = generationFingerprintsRef.current[update.job.jobId];

      setEditableProject((currentProject) =>
        fingerprint &&
        isCurrentClipGenerationFingerprint(
          currentProject,
          update.job.clipId,
          fingerprint,
          {
            ignoreVoiceStart: Boolean(projectLibraryRef.current.projects.find(
              (entry) => entry.projectId === currentProject.project_id,
            )?.plannerSource),
          },
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
    delete projectMixReasonsRef.current[update.job.jobId];
    delete projectMixJobFingerprintsRef.current[update.job.jobId];
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
    const fingerprint = getClipGenerationFingerprint(selectedClip, {
      ignoreVoiceStart: Boolean(currentLibraryEntry?.plannerSource),
    });

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

  function handleGenerateProjectMix() {
    if (generationView.projectMixControl.disabled) {
      return;
    }

    const action = generationView.projectMixControl.action;

    if (action === "cancel" || action === "none") {
      return;
    }

    const reason: GenerateProjectMixReason =
      action === "retry" ? "retry" : action === "remix" ? "remix" : "mix";
    let didFinishBeforeStart = false;
    const generationSession = generationSessionRef.current;
    const fingerprint = getProjectMixFingerprint(editableProject);

    void getGenerationBridge()
      .generateProjectMix(
        {
          project: editableProject,
          exportType: "wav",
          reason,
        },
        (update) => {
          if (generationSession !== generationSessionRef.current) {
            return;
          }

          projectMixReasonsRef.current[update.job.jobId] = reason;
          projectMixJobFingerprintsRef.current[update.job.jobId] = fingerprint;
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
          projectMixReasonsRef.current[started.jobId] = reason;
          projectMixJobFingerprintsRef.current[started.jobId] = fingerprint;
        }
      })
      .catch(() => undefined);
  }

  function handleCancelProjectMix() {
    const jobId = generationView.projectMixControl.jobId;

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

  function handlePlayProjectMix() {
    if (!generationView.projectMixControl.canPlay) {
      return;
    }

    const resolvedUri = resolvePlayableAssetUri(
      generationView.projectMixControl.uri,
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

  function handleDownloadProjectMix() {
    if (!generationView.projectMixControl.canDownload) {
      return;
    }

    const resolvedUri = resolvePlayableAssetUri(
      generationView.projectMixControl.uri,
    );

    if (!resolvedUri) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = resolvedUri;
    anchor.download = `${editableProject.project_id}.wav`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function handleUpdateClip(clipId: string, patch: ClipPatch) {
    cancelGenerationForClip(clipId);
    cancelProjectMixGeneration();
    setEditableProject((currentProject) =>
      updateClipInProject(currentProject, clipId, patch),
    );
    setImportError(undefined);
  }

  function handleApplyDirectorPreset(clipId: string, preset: DirectorPreset) {
    cancelGenerationForClip(clipId);
    cancelProjectMixGeneration();
    setEditableProject((currentProject) =>
      applyDirectorPreset(currentProject, clipId, preset),
    );
    setImportError(undefined);
  }

  function handleNudgeClipTiming(clipId: string, nudge: ClipTimingNudge) {
    cancelGenerationForClip(clipId);
    cancelProjectMixGeneration();
    setEditableProject((currentProject) =>
      nudgeClipTiming(currentProject, clipId, nudge),
    );
    setImportError(undefined);
  }

  function getLibraryWithCurrentProject() {
    return updateLibraryProject(projectLibrary, editableProject);
  }

  function handleSelectProject(projectId: string) {
    if (projectId === editableProject.project_id) {
      return;
    }

    const protectedLibrary = createProjectRevision(
      getLibraryWithCurrentProject(),
      editableProject.project_id,
      new Date(),
      "切换前",
    );
    activateLibraryProject(selectLibraryProject(protectedLibrary, projectId));
  }

  function handleCreateProject() {
    const protectedLibrary = createProjectRevision(
      getLibraryWithCurrentProject(),
      editableProject.project_id,
      new Date(),
      "切换前",
    );
    activateLibraryProject(createLibraryProject(protectedLibrary, project));
  }

  function handleAdoptPlanner(brief: PlannerBrief, draft: PlannerDraft) {
    const nextLibrary = adoptPlannerDraft(getLibraryWithCurrentProject(), brief, draft);
    activateLibraryProject(nextLibrary);
    setWorkspaceView("editor");
  }

  function handleDuplicateProject() {
    const baseLibrary = getLibraryWithCurrentProject();
    activateLibraryProject(
      duplicateLibraryProject(
        baseLibrary,
        editableProject.project_id,
        new Date(),
      ),
    );
  }

  function handleDeleteProject(projectId: string) {
    const target = projectLibrary.projects.find(
      (entry) => entry.projectId === projectId,
    );

    if (
      !target ||
      projectLibrary.projects.length <= 1 ||
      !window.confirm(`删除“${target.title}”？此操作不会删除已生成的音频文件。`)
    ) {
      return;
    }

    const nextLibrary = deleteLibraryProject(
      getLibraryWithCurrentProject(),
      projectId,
    );

    if (projectId === editableProject.project_id) {
      activateLibraryProject(nextLibrary);
    } else {
      persistLibrary(nextLibrary);
    }
  }

  function handleCreateRevision() {
    const nextLibrary = createProjectRevision(
      getLibraryWithCurrentProject(),
      editableProject.project_id,
      new Date(),
      "手动版本",
    );
    persistLibrary(nextLibrary);
  }

  function handleRestoreRevision(revisionId: string) {
    const nextLibrary = restoreProjectRevision(
      getLibraryWithCurrentProject(),
      editableProject.project_id,
      revisionId,
      new Date(),
    );
    activateLibraryProject(nextLibrary);
  }

  function handleImportJson(text: string) {
    const importedProject = parseImportedProject(text);

    if (!importedProject.success) {
      setImportError(importedProject.error);
      return;
    }

    const nextLibrary = replaceLibraryProject(
      getLibraryWithCurrentProject(),
      importedProject.project,
      new Date(),
      "导入前",
    );
    activateLibraryProject(nextLibrary);
  }

  function handleResetDemo() {
    const resetProject = {
      ...project,
      project_id: editableProject.project_id,
    };
    const nextLibrary = replaceLibraryProject(
      getLibraryWithCurrentProject(),
      resetProject,
      new Date(),
      "重置前",
    );

    activateLibraryProject(nextLibrary, "demo");
  }

  return (
    <ProjectWorkspace
      planning={workspaceView === "planner"}
      importError={importError}
      currentProjectId={projectLibrary.currentProjectId}
      projects={hasLoadedStorage ? projectSummaries : []}
      summary={workspaceSummary}
      preview={previewSummary}
      audioAnalysis={audioAnalysis}
      audioAnalysisStatus={audioAnalysisStatus}
      audioAnalysisSourceLabel={audioAnalysisSourceLabel}
      projectMixControl={generationView.projectMixControl}
      qualityReport={qualityReport}
      revisions={currentLibraryEntry?.revisions ?? []}
      selectedClipPreview={generationView.selectedClipPreview}
      onCancelProjectMix={handleCancelProjectMix}
      onCreateProject={handleCreateProject}
      onCreateRevision={handleCreateRevision}
      onDeleteProject={handleDeleteProject}
      onDownloadProjectMix={handleDownloadProjectMix}
      onDuplicateProject={handleDuplicateProject}
      onExportJson={() => exportProjectJson(editableProject)}
      onGenerateProjectMix={handleGenerateProjectMix}
      onImportJson={handleImportJson}
      onPlayProjectMix={handlePlayProjectMix}
      onPlaySelectedClip={handlePlaySelectedClip}
      onRestoreRevision={handleRestoreRevision}
      onResetDemo={handleResetDemo}
      onSelectProject={handleSelectProject}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-studio-line bg-studio-panel p-1" aria-label="工作区视图">
          <button type="button" aria-pressed={workspaceView === "planner"} aria-controls="planner-workspace" onClick={() => setWorkspaceView("planner")} className={`min-h-10 rounded-md px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-sky-300 ${workspaceView === "planner" ? "bg-sky-300/12 text-sky-100" : "text-studio-muted hover:text-studio-text"}`}>AI 创意策划</button>
          <button type="button" aria-pressed={workspaceView === "editor"} aria-controls="editor-workspace" onClick={() => setWorkspaceView("editor")} className={`min-h-10 rounded-md px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-sky-300 ${workspaceView === "editor" ? "bg-sky-300/12 text-sky-100" : "text-studio-muted hover:text-studio-text"}`}>工程编辑</button>
        </div>
      </div>
      <div id="planner-workspace" hidden={workspaceView !== "planner"}>
        <PlannerPanel source={currentLibraryEntry?.plannerSource} onAdopt={handleAdoptPlanner} />
      </div>
      <div id="editor-workspace" hidden={workspaceView !== "editor"}>
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
      </div>
    </ProjectWorkspace>
  );
}
