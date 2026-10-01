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
import { resolvePlayableAssetUri, resolveClipPlaybackUri } from "@/lib/asmr/playback-asset-resolver";
import { AudioCandidateSchema, type AudioCandidate } from "@/lib/asmr/audio-candidate";
import { adoptAudioCandidate, canUndoLastAudioCandidate, undoLastAudioCandidate } from "@/lib/asmr/candidate-acceptance";
import { VoiceGenerationOptionsSchema, type VoiceGenerationOptions, type LongTextRetry } from "@/lib/asmr/voice-generation-options";
import { getVoiceGenerationContext } from "@/lib/asmr/voice-generation-context";
import type { VoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";
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
import { addVoiceClip, deleteVoiceClip, getVoiceGapAfter, mergeVoiceClipWithNext, setVoiceGapAfter, splitVoiceClip } from "@/lib/asmr/voice-segments";
import { getValueLabel } from "@/lib/asmr/ui-copy";
import { flattenClips, formatTimeRange } from "@/lib/asmr/view-model";
import { createClipH3Prompt, isClipVideoStoryboardCurrent, type ClipVideoStoryboard } from "@/lib/asmr/video-plan";

import { ClipInspector } from "./clip-inspector";
import { ClipStoryboardEditor } from "./clip-storyboard-editor";
import { EditorPanels } from "./editor-panels";
import { VoiceGenerationPanel } from "./voice-generation-panel";
import { PlannerPanel } from "./planner-panel";
import { ProjectWorkspace } from "./project-workspace";
import { ScriptEditorPanel } from "./script-editor-panel";
import { TimelinePanel } from "./timeline-panel";
import { ValidationPanel } from "./validation-panel";

type StudioAppProps = {
  project: AsmrProject;
};

function defaultClipId(project: AsmrProject) {
  const clips = flattenClips(project);
  return (clips.find((clip) => clip.type === "voice") ?? clips[0])?.id;
}

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
  const [inspectorTab, setInspectorTab] = useState<"audio" | "storyboard">("audio");
  const [editorPanel, setEditorPanel] = useState(0);
  const [editableProject, setEditableProject] = useState<AsmrProject>(() => project);
  const editableProjectRef = useRef(editableProject);
  const editRevisionRef = useRef(0);
  const [scriptHistory, setScriptHistory] = useState<{ project: AsmrProject; clipId?: string }[]>([]);
  const [scriptNotice, setScriptNotice] = useState<string>();
  const [voiceOptions, setVoiceOptions] = useState<VoiceGenerationOptions>({
    provider: "gpt-sovits", voicePackId: "default", referenceMode: "with_reference_text", generationMode: "clip",
  });
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceProviderCatalog | null>(null);
  const [voiceCatalogError, setVoiceCatalogError] = useState<string>();
  const [voiceError, setVoiceError] = useState<string>();
  const [voiceCandidates, setVoiceCandidates] = useState<AudioCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidateActionBusy, setCandidateActionBusy] = useState(false);
  const [candidateRefresh, setCandidateRefresh] = useState(0);
  const candidateJobIdsRef = useRef(new Set<string>());
  const windowedVoiceJobsRef = useRef(new Map<string, { clipId: string; context: string }>());
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
    () => defaultClipId(project),
  );
  const selectedClip =
    clips.find((clip) => clip.id === selectedClipId) ?? clips[0];
  const activeClipId = selectedClip?.id;
  const inspectorView = selectedClip?.type === "voice" ? inspectorTab : "audio";
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
  const voiceBusy = candidateActionBusy || Object.values(generationRuntimeState.jobsById).some(isActiveGenerationJob);
  const visibleVoiceCandidates = voiceCandidates.filter((candidate) =>
    candidate.projectId === editableProject.project_id && candidate.clipId === activeClipId,
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

  useEffect(() => { editableProjectRef.current = editableProject; }, [editableProject]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/generation/clip", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取人声配置。");
        const catalog = await response.json() as VoiceProviderCatalog;
        if (!Array.isArray(catalog.providers)) throw new Error("无法读取人声配置。");
        if (controller.signal.aborted) return;
        setVoiceCatalog(catalog);
        let stored: VoiceGenerationOptions | undefined;
        try {
          const parsed = VoiceGenerationOptionsSchema.safeParse(JSON.parse(window.localStorage.getItem("ai-asmr-studio:v1:voice-options") || "null"));
          if (parsed.success) stored = parsed.data;
        } catch { /* Project persistence separately reports storage availability. */ }
        setVoiceOptions((current) => {
          const preferred = stored ?? current;
          const provider = catalog.providers.find((item) => item.id === preferred.provider);
          const reference = provider?.references.find((item) => item.id === preferred.voicePackId) ?? provider?.references.find((item) => item.id === provider.defaultReferenceId);
          return reference ? { ...preferred, voicePackId: reference.id,
            referenceMode: reference.referenceModes.includes(preferred.referenceMode) ? preferred.referenceMode : reference.referenceModes[0] } : preferred;
        });
      })
      .catch(() => { if (!controller.signal.aborted) setVoiceCatalogError("无法读取人声配置，请刷新重试。"); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const projectId = editableProject.project_id;
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setVoiceError(undefined);
        setVoiceCandidates([]);
        setCandidatesLoading(Boolean(hasLoadedStorage && activeClipId));
      }
    });
    if (hasLoadedStorage && activeClipId) {
      const query = new URLSearchParams({ projectId, clipId: activeClipId });
      void fetch(`/api/audio-candidates?${query}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("候选列表读取失败，请刷新重试。");
          const payload = await response.json() as { candidates: unknown };
          const candidates = AudioCandidateSchema.array().parse(payload.candidates);
          if (!controller.signal.aborted) setVoiceCandidates(candidates);
        })
        .catch(() => { if (!controller.signal.aborted) setVoiceError("候选列表读取失败，请刷新重试。"); })
        .finally(() => { if (!controller.signal.aborted) setCandidatesLoading(false); });
    }
    return () => controller.abort();
  }, [editableProject.project_id, activeClipId, candidateRefresh, hasLoadedStorage]);

  function handleVoiceOptionsChange(next: VoiceGenerationOptions) {
    setVoiceOptions(next);
    setVoiceError(undefined);
    try { window.localStorage.setItem("ai-asmr-studio:v1:voice-options", JSON.stringify(next)); }
    catch { setVoiceError("声音设置未能保存，刷新后需要重新选择。"); }
  }

  function commitCandidateLibrary(next: typeof projectLibrary) {
    // Persist first: storage failure must leave the original audible project intact.
    saveProjectLibrary(window.localStorage, next);
    clearGenerationSession();
    setScriptHistory([]);
    projectLibraryRef.current = next;
    setProjectLibrary(next);
    const entry = getCurrentLibraryEntry(next);
    editableProjectRef.current = entry.project;
    setEditableProject(entry.project);
    setProjectMixFingerprint(entry.mixFingerprint);
    setStorageAvailable(true);
    setVoiceError(undefined);
  }

  async function handleAdoptVoiceCandidate(candidate: AudioCandidate) {
    if (voiceBusy) return;
    if (validationIssues.length > 0) { setVoiceError("请先修正片段内容，再采用候选。"); return; }
    const session = generationSessionRef.current;
    const editRevision = editRevisionRef.current;
    setCandidateActionBusy(true);
    setVoiceError(undefined);
    try {
      const query = new URLSearchParams({ projectId: candidate.projectId, clipId: candidate.clipId });
      const response = await fetch(`/api/audio-candidates/${encodeURIComponent(candidate.candidateId)}?${query}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "候选已不可用，请重新生成。");
      if (session !== generationSessionRef.current) return;
      if (editRevision !== editRevisionRef.current) throw new Error("工程刚刚有修改，请检查后重新采用。");
      const fresh = AudioCandidateSchema.parse(payload.candidate);
      const latestLibrary = updateLibraryProject(projectLibraryRef.current, editableProjectRef.current);
      const next = adoptAudioCandidate(latestLibrary, fresh);
      try { commitCandidateLibrary(next); }
      catch { setStorageAvailable(false); throw new Error("采用未保存，原声已保留。请检查本地存储后重试。"); }
    } catch (error) {
      if (session === generationSessionRef.current) setVoiceError(error instanceof Error ? error.message : "未能采用候选。");
    } finally { setCandidateActionBusy(false); }
  }

  async function handleDiscardVoiceCandidate(candidate: AudioCandidate) {
    if (voiceBusy || selectedClip?.asset.asset_id === candidate.asset.assetId) return;
    const session = generationSessionRef.current;
    setCandidateActionBusy(true);
    try {
      const query = new URLSearchParams({ projectId: candidate.projectId, clipId: candidate.clipId });
      const response = await fetch(`/api/audio-candidates/${encodeURIComponent(candidate.candidateId)}?${query}`, { method: "DELETE" });
      if (!response.ok) throw new Error("未能放弃候选，请重试。");
      if (session === generationSessionRef.current) setCandidateRefresh((value) => value + 1);
    } catch { if (session === generationSessionRef.current) setVoiceError("未能放弃候选，请重试。"); }
    finally { setCandidateActionBusy(false); }
  }

  function handleUndoVoiceCandidate() {
    if (voiceBusy) return;
    try {
      const current = updateLibraryProject(projectLibraryRef.current, editableProject);
      const next = undoLastAudioCandidate(current);
      try { commitCandidateLibrary(next); }
      catch { setStorageAvailable(false); throw new Error("撤回未保存，请检查本地存储后重试。"); }
    } catch (error) { setVoiceError(error instanceof Error ? error.message : "未能撤回采用。"); }
  }

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
        setSelectedClipId(defaultClipId(loadedEntry.project));
      } catch {
        const fallbackLibrary = createInitialProjectLibrary(project);
        setStorageAvailable(false);
        projectLibraryRef.current = fallbackLibrary;
        setProjectLibrary(fallbackLibrary);
        setEditableProject(project);
        setRestoreState("demo");
        setSelectedClipId(defaultClipId(project));
      } finally {
        setHasLoadedStorage(true);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [project]);

  useEffect(() => {
    if (!hasLoadedStorage || validationIssues.length > 0) {
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
  }, [editableProject, hasLoadedStorage, validationIssues.length]);

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
    const windowedJobs = windowedVoiceJobsRef.current;
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
      windowedJobs.clear();
      generationFingerprintsRef.current = {};
      projectMixReasonsRef.current = {};
      projectMixJobFingerprintsRef.current = {};
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  function clearGenerationSession() {
    candidateJobIdsRef.current.clear();
    windowedVoiceJobsRef.current.clear();
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
    setScriptHistory([]);
    setScriptNotice(undefined);
    persistLibrary(nextLibrary);
    editableProjectRef.current = entry.project;
    setEditableProject(entry.project);
    setProjectMixFingerprint(entry.mixFingerprint);
    setSelectedClipId(defaultClipId(entry.project));
    setInspectorTab("audio");
    setEditorPanel(0);
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
    windowedVoiceJobsRef.current.delete(job.jobId);
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

    if (update.type !== "snapshot") windowedVoiceJobsRef.current.delete(update.job.jobId);

    if (update.type === "snapshot") {
      setGenerationRuntimeState((current) => {
        const next = upsertGenerationJob(current, update.job);
        generationRuntimeStateRef.current = next;

        return next;
      });
      return;
    }

    if (update.type === "candidate") {
      setRuntimeState(clearGenerationJob(generationRuntimeStateRef.current, update.job.jobId));
      candidateJobIdsRef.current.delete(update.job.jobId);
      delete generationReasonsRef.current[update.job.jobId];
      delete generationFingerprintsRef.current[update.job.jobId];
      setCandidateRefresh((value) => value + 1);
      return;
    }

    if (candidateJobIdsRef.current.has(update.job.jobId)) {
      candidateJobIdsRef.current.delete(update.job.jobId);
      setRuntimeState(clearGenerationJob(generationRuntimeStateRef.current, update.job.jobId));
      delete generationReasonsRef.current[update.job.jobId];
      delete generationFingerprintsRef.current[update.job.jobId];
      if (update.type === "failed") setVoiceError(update.error);
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
            ignoreVoiceStart: true,
          },
        )
          ? commitGenerationSuccess(
              currentProject,
              update.job.clipId,
              update.asset,
              {
                fitVoiceTiming: true,
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
            ignoreVoiceStart: true,
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
    startSelectedClipGeneration();
  }

  function handleRegenerateVoiceGroup(candidate: AudioCandidate, groupIndex: number) {
    if (voiceBusy || candidate.clipId !== selectedClip?.id || candidate.projectId !== editableProject.project_id) return;
    const options: VoiceGenerationOptions = { provider: "voxcpm2", generationMode: "long_text",
      voicePackId: candidate.provenance.voicePackId, referenceMode: candidate.provenance.referenceMode,
      analysisProvider: voiceOptions.analysisProvider ?? "local" };
    handleVoiceOptionsChange(options);
    startSelectedClipGeneration(options, { candidateId: candidate.candidateId, groupIndex });
  }

  function startSelectedClipGeneration(optionsOverride?: VoiceGenerationOptions, longTextRetry?: LongTextRetry, target?: { project: AsmrProject; clipId: string }) {
    const generationProject = target?.project ?? editableProject;
    const generationClip = target ? flattenClips(generationProject).find((clip) => clip.id === target.clipId) : selectedClip;
    const control = target ? getGenerationView({ project: generationProject, selectedClip: generationClip, runtimeState: generationRuntimeStateRef.current, selectedClipHasValidationIssues: Object.keys(getClipFieldValidationIssues(generationProject, target.clipId, getProjectValidationIssues(generationProject))).length > 0, projectMixFingerprint }).selectedClipControl : generationView.selectedClipControl;
    if (!generationClip || control.disabled) {
      return;
    }
    const options = generationClip.type === "voice" ? optionsOverride ?? voiceOptions : undefined;
    if (options?.provider === "voxcpm2" && voiceBusy) return;
    if (options?.provider === "voxcpm2" && !voiceCatalog?.providers.find((item) => item.id === "voxcpm2")?.available) {
      setVoiceError("VoxCPM2 尚未就绪，请检查本机配置。");
      return;
    }
    if (options?.provider === "voxcpm2" && options.generationMode === "long_text") {
      const capability = voiceCatalog?.providers.find((item) => item.id === "voxcpm2")?.longText;
      if (!capability?.available) { setVoiceError(capability?.reason || "长文语音分析尚未就绪。"); return; }
      if (!(generationClip.type === "voice" && generationClip.semantic_unit) && !longTextRetry && options.analysisProvider === "api" && !capability.apiConfigured) { setVoiceError("请先配置外部文本分析 API，或选择本地分析。"); return; }
    }
    setVoiceError(undefined);

    const action = control.action;
    const reason: GenerateClipReason =
      action === "retry"
        ? "retry"
        : action === "regenerate"
          ? "regenerate"
          : "generate";
    let didFinishBeforeStart = false;
    const generationSession = generationSessionRef.current;
    const fingerprint = getClipGenerationFingerprint(generationClip, {
      ignoreVoiceStart: true,
    });
    const voiceContext = options?.provider === "voxcpm2" && options.generationMode === "long_text"
      ? getVoiceGenerationContext(generationProject, generationClip.id) : undefined;

    void getGenerationBridge()
      .generateClip(
        {
          project: generationProject,
          clipId: generationClip.id,
          reason,
          voiceOptions: options,
          ...(longTextRetry ? { longTextRetry } : {}),
        },
        (update) => {
          if (generationSession !== generationSessionRef.current) {
            return;
          }

          generationReasonsRef.current[update.job.jobId] = reason;
          if (voiceContext && update.type === "snapshot") windowedVoiceJobsRef.current.set(update.job.jobId, {
            clipId: generationClip.id, context: JSON.stringify(voiceContext),
          });
          if (options?.provider === "voxcpm2") candidateJobIdsRef.current.add(update.job.jobId);
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

    const resolvedUri = selectedClip
      ? resolveClipPlaybackUri(selectedClip, editableProject.timeline.mixing.binaural)
      : resolvePlayableAssetUri(generationView.selectedClipPreview.uri);

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

  function handleBinauralChange(enabled: boolean) {
    editRevisionRef.current += 1;
    cancelProjectMixGeneration();
    audioRef.current?.pause();
    setEditableProject((current) => ({ ...current, timeline: {
      ...current.timeline, mixing: { ...current.timeline.mixing, binaural: enabled },
    } }));
  }

  function handleUpdateClip(clipId: string, patch: ClipPatch) {
    const current = editableProjectRef.current;
    const clip = flattenClips(current).find((item) => item.id === clipId);
    if (clip?.type === "voice" && patch.text !== undefined && patch.text !== clip.text) {
      const next = updateClipInProject(current, clipId, patch);
      const track = next.timeline.tracks.find((item) => item.track_type === "voice")!;
      track.clips = track.clips.map((item) => item.id === clipId ? {
        ...item, asset: { asset_id: null, uri: null, duration: null },
        generation: { ...item.generation, status: "asset_pending", error: null },
      } : item);
      commitScriptEdit(next, clipId, "台词已更新，可以生成这一段的新音频。", Boolean(clip.asset.uri));
      return;
    }
    editRevisionRef.current += 1;
    cancelGenerationForClip(clipId);
    cancelProjectMixGeneration();
    const updated = syncExplicitWaits(updateClipInProject(current, clipId, patch));
    cancelChangedVoiceWindows(updated);
    editableProjectRef.current = updated;
    setEditableProject(updated);
    setImportError(undefined);
  }

  function handleApplyDirectorPreset(clipId: string, preset: DirectorPreset) {
    if (preset === "add-pause") {
      const current = editableProjectRef.current;
      const gap = getVoiceGapAfter(current, clipId);
      if (gap !== null) commitScriptEdit(setVoiceGapAfter(current, clipId, gap + 0.5), clipId, "段后等待增加了 0.5 秒。");
      else setScriptNotice("这是最后一段；添加下一段后即可设置段间等待。");
      return;
    }
    editRevisionRef.current += 1;
    cancelGenerationForClip(clipId);
    cancelProjectMixGeneration();
    setEditableProject((currentProject) =>
      applyDirectorPreset(currentProject, clipId, preset),
    );
    setImportError(undefined);
  }

  function handleNudgeClipTiming(clipId: string, nudge: ClipTimingNudge) {
    editRevisionRef.current += 1;
    cancelGenerationForClip(clipId);
    cancelProjectMixGeneration();
    const updated = syncExplicitWaits(nudgeClipTiming(editableProjectRef.current, clipId, nudge));
    cancelChangedVoiceWindows(updated);
    editableProjectRef.current = updated;
    setEditableProject(updated);
    setImportError(undefined);
  }

  function syncExplicitWaits(next: AsmrProject): AsmrProject {
    return { ...next, timeline: { ...next.timeline, tracks: next.timeline.tracks.map((track) => track.track_type !== "voice" ? track : {
      ...track, clips: track.clips.map((clip) => clip.pause_after === undefined ? clip : { ...clip, pause_after: getVoiceGapAfter(next, clip.id) ?? clip.pause_after }),
    }) } };
  }

  function commitScriptEdit(next: AsmrProject, clipId?: string, notice?: string, protect = true) {
    const current = editableProjectRef.current;
    if (next === current) return;
    setScriptHistory((history) => [...history.slice(-29), { project: current, clipId: activeClipId }]);
    if (protect && getProjectValidationIssues(current).length === 0) {
      persistLibrary(createProjectRevision(updateLibraryProject(projectLibraryRef.current, current), current.project_id, new Date(), "文案编辑前"));
    }
    editRevisionRef.current += 1;
    cancelChangedVoiceWindows(next);
    const after = new Map(flattenClips(next).map((clip) => [clip.id, clip]));
    for (const clip of flattenClips(current)) {
      if (JSON.stringify(clip) !== JSON.stringify(after.get(clip.id))) cancelGenerationForClip(clip.id);
    }
    cancelProjectMixGeneration();
    audioRef.current?.pause();
    editableProjectRef.current = next;
    setEditableProject(next);
    setSelectedClipId(clipId);
    setScriptNotice(notice);
    setImportError(undefined);
  }

  function cancelChangedVoiceWindows(next: AsmrProject) {
    for (const [jobId, job] of windowedVoiceJobsRef.current) {
      if (JSON.stringify(getVoiceGenerationContext(next, job.clipId)) !== job.context) {
        cancelGenerationForClip(job.clipId);
        windowedVoiceJobsRef.current.delete(jobId);
      }
    }
  }

  function handleSplitVoice(clipId: string, start: number, end: number, generate = false) {
    if (generate && voiceBusy) return;
    const result = splitVoiceClip(editableProjectRef.current, clipId, start, end);
    const targetId = result.selectedClipId ?? clipId;
    commitScriptEdit(result.project, targetId, "已按所选范围分段；各段可独立编辑、生成和设置等待。");
    setSelectedClipId(targetId);
    const options = voiceOptions.provider === "voxcpm2"
      ? { ...voiceOptions, generationMode: "long_text" as const } : voiceOptions;
    if ((generate || result.project !== editableProject) && options !== voiceOptions) handleVoiceOptionsChange(options);
    if (generate) {
      startSelectedClipGeneration(options, undefined, { project: result.project, clipId: targetId });
    }
  }

  function handleAddVoice(afterClipId?: string) {
    const result = addVoiceClip(editableProjectRef.current, afterClipId);
    commitScriptEdit(result.project, result.selectedClipId ?? undefined, "已添加一段，直接输入台词即可。");
    if (voiceOptions.provider === "voxcpm2") handleVoiceOptionsChange({ ...voiceOptions, generationMode: "long_text" });
  }

  function handleUndoScriptEdit() {
    const previous = scriptHistory.at(-1);
    if (!previous || previous.project.project_id !== editableProject.project_id) return;
    editRevisionRef.current += 1;
    clearGenerationSession();
    editableProjectRef.current = previous.project;
    setEditableProject(previous.project);
    setSelectedClipId(previous.clipId);
    setScriptHistory((history) => history.slice(0, -1));
    setScriptNotice("已撤回上一次文案编辑。");
  }

  function handleRewriteVoice(clipId: string, original: string, text: string) {
    const target = flattenClips(editableProjectRef.current).find((clip) => clip.id === clipId);
    if (target?.type !== "voice" || target.text !== original) {
      setScriptNotice("文案已修改，未覆盖新的内容。请重新选择范围改写。");
      return;
    }
    handleUpdateClip(clipId, { text });
    setScriptNotice("已只改写选定文字，可继续编辑或生成音频。");
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

  function handleAdoptPlanner(brief: PlannerBrief, draft: PlannerDraft, storyboard?: import("@/lib/asmr/storyboard").PlannerStoryboard, sceneDescription?: string) {
    const nextLibrary = adoptPlannerDraft(getLibraryWithCurrentProject(), brief, draft, new Date(), storyboard, sceneDescription);
    activateLibraryProject(nextLibrary);
    if (draft.segmentation === "semantic" && voiceOptions.provider === "voxcpm2") {
      handleVoiceOptionsChange({ ...voiceOptions, generationMode: "long_text" });
    }
    setWorkspaceView("editor");
  }

  function handleVideoSceneChange(sceneDescription: string) {
    const current = editableProjectRef.current;
    const next = { ...current, videoPlan: { version: 1 as const, sceneDescription, shots: current.videoPlan?.shots ?? {} } };
    editableProjectRef.current = next;
    setEditableProject(next);
  }

  function handleSaveClipStoryboard(projectId: string, shot: ClipVideoStoryboard): boolean {
    const current = editableProjectRef.current;
    if (current.project_id !== projectId) return false;
    const next = { ...current, videoPlan: {
      version: 1 as const, sceneDescription: current.videoPlan?.sceneDescription ?? current.scene.name,
      shots: { ...current.videoPlan?.shots, [shot.clipId]: shot },
    } };
    if (!isClipVideoStoryboardCurrent(next, shot.clipId)) return false;
    try { createClipH3Prompt(next, shot.clipId); }
    catch { return false; }
    editableProjectRef.current = next;
    setEditableProject(next);
    return true;
  }

  function handleEditClipStoryboard(clipId: string, patch: Partial<Pick<ClipVideoStoryboard, "title" | "visual" | "action" | "camera">>) {
    const current = editableProjectRef.current;
    const plan = current.videoPlan;
    const shot = plan?.shots[clipId];
    if (!plan || !shot) return;
    const next = { ...current, videoPlan: { ...plan, shots: { ...plan.shots, [clipId]: { ...shot, ...patch } } } };
    editableProjectRef.current = next;
    setEditableProject(next);
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
      project={editableProject}
      binaural={editableProject.timeline.mixing.binaural}
      onBinauralChange={handleBinauralChange}
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
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-studio-line bg-studio-panel p-1" aria-label="工作区视图">
          <button type="button" aria-pressed={workspaceView === "planner"} aria-controls="planner-workspace" onClick={() => setWorkspaceView("planner")} className={`min-h-8 rounded-md px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-sky-300 ${workspaceView === "planner" ? "bg-sky-300/12 text-sky-100" : "text-studio-muted hover:text-studio-text"}`}>AI 创意策划</button>
          <button type="button" aria-pressed={workspaceView === "editor"} aria-controls="editor-workspace" onClick={() => setWorkspaceView("editor")} className={`min-h-8 rounded-md px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-sky-300 ${workspaceView === "editor" ? "bg-sky-300/12 text-sky-100" : "text-studio-muted hover:text-studio-text"}`}>工程编辑</button>
        </div>
      </div>
      <div id="planner-workspace" className="min-h-0 flex-1 overflow-hidden" hidden={workspaceView !== "planner"}>
        <PlannerPanel source={currentLibraryEntry?.plannerSource} onAdopt={handleAdoptPlanner} />
      </div>
      <div id="editor-workspace" className="min-h-0 flex-1 overflow-hidden" hidden={workspaceView !== "editor"}>
      <div className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,0.42fr)] gap-2">
      <EditorPanels activePanel={editorPanel} onPanelChange={setEditorPanel}>
        <div className="h-full min-h-0 min-w-0">
          <ScriptEditorPanel
            key={editableProject.project_id}
            project={displayProject}
            selectedClipId={activeClipId}
            onSelectClip={setSelectedClipId}
            busy={voiceBusy}
            canUndo={scriptHistory.length > 0}
            notice={scriptNotice}
            onUpdateClip={handleUpdateClip}
            onAddClip={handleAddVoice}
            onDeleteClip={(clipId) => { const result = deleteVoiceClip(editableProjectRef.current, clipId); commitScriptEdit(result.project, result.selectedClipId ?? undefined, "已删除片段，可撤回编辑。"); }}
            onSplitClip={handleSplitVoice}
            onMergeClip={(clipId) => { const result = mergeVoiceClipWithNext(editableProjectRef.current, clipId); commitScriptEdit(result.project, result.selectedClipId ?? undefined, "已合并，可重新选择修改或生成的范围。"); }}
            onGapChange={(clipId, seconds) => commitScriptEdit(setVoiceGapAfter(editableProjectRef.current, clipId, seconds), clipId, `下一段将在人声结束后等待 ${seconds} 秒。`)}
            onRewriteClip={handleRewriteVoice}
            onUndo={handleUndoScriptEdit}
            onOpenStoryboard={(clipId) => {
              setSelectedClipId(clipId); setInspectorTab("storyboard"); setEditorPanel(1);
              requestAnimationFrame(() => document.getElementById("clip-inspector-tab-storyboard")?.focus());
            }}
          />
        </div>

        <div aria-label="声音与分镜设置" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-studio-line bg-studio-panel/88">
          <div role="tablist" aria-label="片段工作内容" className="flex shrink-0 gap-1 border-b border-studio-line px-3 py-2">
            {([['audio', '声音'], ['storyboard', '分镜']] as const).map(([tab, label]) => <button key={tab} type="button" role="tab" id={`clip-inspector-tab-${tab}`} aria-selected={inspectorView === tab} aria-controls={`clip-inspector-${tab}`} tabIndex={inspectorView === tab ? 0 : -1} disabled={tab === "storyboard" && selectedClip?.type !== "voice"} onClick={() => setInspectorTab(tab)} onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || selectedClip?.type !== "voice") return; event.preventDefault(); const next = event.key === "Home" ? "audio" : event.key === "End" ? "storyboard" : tab === "audio" ? "storyboard" : "audio"; setInspectorTab(next); document.getElementById(`clip-inspector-tab-${next}`)?.focus(); }} className={`min-h-8 rounded-lg px-4 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-violet-300 disabled:opacity-35 ${inspectorView === tab ? tab === "storyboard" ? "bg-violet-300/15 text-violet-100" : "bg-sky-300/15 text-sky-100" : "text-studio-muted hover:bg-white/5"}`}>{label}</button>)}
          </div>
          <div id="clip-inspector-audio" role="tabpanel" aria-labelledby="clip-inspector-tab-audio" hidden={inspectorView !== "audio"} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [&>section]:border-0">
          <ClipInspector
            textEditorExternal
            binaural={editableProject.timeline.mixing.binaural}
            voiceGenerationPanel={selectedClip?.type === "voice" ? (generationControl) => (
              <VoiceGenerationPanel
                projectId={editableProject.project_id}
                voiceContext={getVoiceGenerationContext(editableProject, selectedClip.id)}
                binaural={editableProject.timeline.mixing.binaural}
                generationControl={generationControl}
                options={voiceOptions} onOptionsChange={handleVoiceOptionsChange}
                catalog={voiceCatalog} catalogError={voiceCatalogError} busy={voiceBusy}
                selectedClip={selectedClip} candidates={visibleVoiceCandidates}
                onAdopt={handleAdoptVoiceCandidate} onDiscard={handleDiscardVoiceCandidate}
                onRegenerateGroup={handleRegenerateVoiceGroup}
                onUndo={handleUndoVoiceCandidate}
                canUndo={canUndoLastAudioCandidate({ ...projectLibrary, projects: projectLibrary.projects.map((entry) =>
                  entry.projectId === editableProject.project_id ? { ...entry, project: editableProject } : entry,
                ) })}
                hasUndo={Boolean(currentLibraryEntry?.candidateAcceptance)}
                error={voiceError} loading={candidatesLoading}
              />
            ) : undefined}
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
          <div id="clip-inspector-storyboard" role="tabpanel" aria-labelledby="clip-inspector-tab-storyboard" hidden={inspectorView !== "storyboard"} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {inspectorView === "storyboard" && selectedClip?.type === "voice" ? <ClipStoryboardEditor key={`${editableProject.project_id}:${selectedClip.id}`} project={editableProject} clipId={selectedClip.id} onSceneChange={handleVideoSceneChange} onSave={handleSaveClipStoryboard} onEdit={handleEditClipStoryboard} /> : null}
          </div>
        </div>
      </EditorPanels>
      <div className="flex min-h-0 min-w-0 flex-col gap-1">
        <TimelinePanel project={displayProject} selectedClipId={activeClipId} onSelectClip={setSelectedClipId} />
        <details className="relative shrink-0 rounded-md border border-studio-line bg-studio-panel/60 px-3 py-1"><summary className="cursor-pointer text-xs text-studio-muted">情绪与工程检查{validationIssues.length ? ` · ${validationIssues.length} 项待检查` : ""}</summary><div className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-[60dvh] space-y-3 overflow-y-auto rounded-lg border border-studio-line bg-studio-panel p-3 shadow-2xl"><EmotionCurve project={editableProject} /><ValidationPanel issues={validationIssues} /></div></details>
      </div>
      </div>
      </div>
    </ProjectWorkspace>
  );
}
