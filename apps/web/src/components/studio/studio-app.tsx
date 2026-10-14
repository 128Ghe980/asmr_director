"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { AudioCandidateSchema, getAudioCandidateWorkspaceMode, getVoiceCandidateRequestFingerprint, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "@/lib/asmr/audio-candidate";
import { adoptAudioCandidate, canUndoLastAudioCandidate, getLastAudioCandidateAcceptance, undoLastAudioCandidate } from "@/lib/asmr/candidate-acceptance";
import { VoiceGenerationOptionsSchema, type VoiceGenerationOptions, type LongTextRetry } from "@/lib/asmr/voice-generation-options";
import { getVoiceGenerationContext } from "@/lib/asmr/voice-generation-context";
import { getVoiceParagraphContext } from "@/lib/asmr/voice-paragraph-context";
import { captureSpeechWorkspace, ensureSpeechWorkspaces, getParagraphGroup, getSpeechWorkspaceMode, getSpeechWorkspaceProject, hasSharedSpeechScriptChanges, hasUnsplitSpeechSentences, mergeSpeechWorkspaceProject, normalizeSpeechSentences, replaceParagraphScript, restoreSharedSpeechScript, restoreSpeechWorkspaceArrangement, switchSpeechWorkspace, syncSharedSpeechScript } from "@/lib/asmr/speech-workspace";
import type { VoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";
import type { VoiceReferenceImportResult } from "./voice-reference-import";
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
import type { AsmrProject, SpeechWorkspaceMode } from "@/lib/asmr/schema";
import type { PlannerBrief, PlannerDraft } from "@/lib/asmr/planner";
import { addSilentClip, setSilentClipDuration, addVoiceClip, deleteVoiceClip, getVoiceGapAfter, mergeVoiceClipWithNext, moveVoiceClip, setVoiceGapAfter, splitVoiceClip, type VoiceClipMoveDirection } from "@/lib/asmr/voice-segments";
import { getValueLabel } from "@/lib/asmr/ui-copy";
import { flattenClips, formatTimeRange } from "@/lib/asmr/view-model";
import { ClipVideoStoryboardSchema, createClipH3Prompt, createClipVideoSourceFingerprint, getClipStoryboardReferenceContext, getClipStoryboardReferenceMode, getPreviousVoiceClip, isClipVideoStoryboardCurrent, type ClipVideoStoryboard, type StoryboardReferenceMode } from "@/lib/asmr/video-plan";
import { getStudioBatchTargets, runStudioBatchQueue, waitForStudioVoiceGeneration, type StudioBatchAction } from "@/lib/asmr/studio-batch-generation";
import { getStudioAudioProgress } from "@/lib/asmr/studio-audio-overview";

import { ClipInspector } from "./clip-inspector";
import { ClipStoryboardEditor } from "./clip-storyboard-editor";
import { EditorPanels } from "./editor-panels";
import { VoiceGenerationPanel } from "./voice-generation-panel";
import { PlannerPanel } from "./planner-panel";
import { ProjectWorkspace } from "./project-workspace";
import { ScriptEditorPanel } from "./script-editor-panel";
import { ParagraphScriptList } from "./paragraph-script-list";
import { StudioBatchActions, type StudioBatchProgress } from "./studio-batch-actions";
import { TimelinePanel } from "./timeline-panel";
import { ValidationPanel } from "./validation-panel";
import { AcceptedVoicePreview } from "./accepted-voice-preview";

type StudioAppProps = {
  project: AsmrProject;
};

function defaultClipId(project: AsmrProject) {
  const clips = flattenClips(project);
  return (clips.find((clip) => clip.type === "voice") ?? clips[0])?.id;
}

function batchAudioSource(project: AsmrProject, clipId: string, options: VoiceGenerationOptions) {
  const clip = flattenClips(project).find((item) => item.id === clipId);
  if (clip?.type !== "voice") return "";
  const context = options.provider === "voxcpm2" && options.generationMode === "long_text"
    ? getVoiceGenerationContext(project, clipId) : undefined;
  const paragraph = options.generationMode === "paragraph" ? getVoiceParagraphContext(project, clipId) : undefined;
  return getVoiceCandidateRequestFingerprint(clip, options, undefined, context, paragraph);
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
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const inspectorScrollerRef = useRef<HTMLDivElement>(null);
  const [editableProject, setEditableProject] = useState<AsmrProject>(() => project);
  const editableProjectRef = useRef(editableProject);
  const editRevisionRef = useRef(0);
  const [scriptHistory, setScriptHistory] = useState<{ project: AsmrProject; clipId?: string; mode: SpeechWorkspaceMode }[]>([]);
  const [scriptNotice, setScriptNotice] = useState<string>();
  const [shortVoiceOptions, setVoiceOptions] = useState<VoiceGenerationOptions>({
    provider: "gpt-sovits", voicePackId: "default", referenceMode: "with_reference_text", generationMode: "clip",
  });
  const [paragraphVoiceOptions, setParagraphVoiceOptions] = useState<VoiceGenerationOptions>();
  const speechMode = getSpeechWorkspaceMode(editableProject);
  const voiceOptions = speechMode === "paragraph" ? paragraphVoiceOptions ?? { ...shortVoiceOptions, provider: "voxcpm2" as const, generationMode: "paragraph" as const } : shortVoiceOptions;
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceProviderCatalog | null>(null);
  const [voiceCatalogError, setVoiceCatalogError] = useState<string>();
  const [referenceImportBusy, setReferenceImportBusy] = useState(false);
  const referenceImportBusyRef = useRef(false);
  const referenceImportModeRef = useRef<SpeechWorkspaceMode>("short");
  const [voiceError, setVoiceError] = useState<string>();
  const [voiceCandidates, setVoiceCandidates] = useState<AudioCandidate[]>([]);
  const [candidateListState, setCandidateListState] = useState<{ projectId: string; status: "loading" | "ready" | "error" }>();
  const [candidateActionBusy, setCandidateActionBusy] = useState(false);
  const [recheckingCandidateId, setRecheckingCandidateId] = useState<string>();
  const [confirmingCandidateId, setConfirmingCandidateId] = useState<string>();
  const candidateRecheckRunRef = useRef<{ controller: AbortController; projectId: string; clipId: string; kind?: "confirm" } | null>(null);
  const handleCancelCandidateRecheck = useCallback((notify = true) => {
    const run = candidateRecheckRunRef.current;
    if (!run) return;
    candidateRecheckRunRef.current = null;
    run.controller.abort();
    setRecheckingCandidateId(undefined);
    setConfirmingCandidateId(undefined);
    if (notify) setVoiceError(run.kind === "confirm" ? "已取消采用，当前人声保持；可刷新候选查看试听确认是否已保存。" : "已取消重新识别，原候选已保留。");
  }, []);
  const [candidateRefresh, setCandidateRefresh] = useState(0);
  const [batchProgress, setBatchProgress] = useState<StudioBatchProgress>();
  const [batchNotice, setBatchNotice] = useState<string>();
  const batchRunRef = useRef<{ controller: AbortController; projectId: string; jobId?: string } | null>(null);
  const [singleStoryboardBusy, setSingleStoryboardBusy] = useState(false);
  const singleStoryboardBusyRef = useRef(false);
  const storyboardProviderRef = useRef<"api" | "ollama" | null>(null);
  const handleStoryboardBusyChange = useCallback((busy: boolean) => {
    singleStoryboardBusyRef.current = busy;
    setSingleStoryboardBusy(busy);
  }, []);
  const handleStoryboardProviderChange = useCallback((provider: "api" | "ollama") => {
    storyboardProviderRef.current = provider;
  }, []);
  const candidateJobIdsRef = useRef(new Set<string>());
  const windowedVoiceJobsRef = useRef(new Map<string, { clipId: string; context: string; mode: SpeechWorkspaceMode; paragraph?: boolean }>());
  const generationWorkspaceRef = useRef(new Map<string, SpeechWorkspaceMode>());
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
  const acceptedPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const handlePreviewAudioChange = useCallback((audio: HTMLAudioElement | null) => { acceptedPreviewAudioRef.current = audio; }, []);
  const generationSessionRef = useRef(0);
  const generationReasonsRef = useRef<Record<string, GenerateClipReason>>({});
  const generationFingerprintsRef = useRef<Record<string, string>>({});
  const projectMixReasonsRef = useRef<Record<string, GenerateProjectMixReason>>({});
  const projectMixJobFingerprintsRef = useRef<Record<string, string>>({});
  const [projectMixFingerprint, setProjectMixFingerprint] = useState<string>();
  const activeMixFingerprint = editableProject.speechWorkspace ? editableProject.speechWorkspace[speechMode].mixFingerprint : projectMixFingerprint;
  const generationRuntimeStateRef = useRef(emptyGenerationRuntimeState);
  const handleReferenceImportBusyChange = useCallback((busy: boolean) => {
    if (busy && (batchRunRef.current || candidateRecheckRunRef.current || candidateActionBusy || Object.values(generationRuntimeStateRef.current.jobsById).some(isActiveGenerationJob))) return false;
    if (busy) referenceImportModeRef.current = getSpeechWorkspaceMode(editableProjectRef.current);
    referenceImportBusyRef.current = busy;
    setReferenceImportBusy(busy);
    return true;
  }, [candidateActionBusy]);
  const handleReferenceCatalogRefresh = useCallback((catalog: VoiceProviderCatalog) => {
    setVoiceCatalog(catalog); setVoiceCatalogError(undefined);
  }, []);
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
  useEffect(() => { if (inspectorScrollerRef.current) inspectorScrollerRef.current.scrollTop = 0; }, [speechMode, activeClipId, inspectorView]);
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
  const voiceBusy = Boolean(batchProgress) || candidateActionBusy || Boolean(recheckingCandidateId) || Boolean(confirmingCandidateId) || Object.values(generationRuntimeState.jobsById).some(isActiveGenerationJob);
  const batchCounts = useMemo(() => Object.fromEntries(
    (["audio_missing", "audio_all", "storyboard_missing", "storyboard_all"] as const)
      .map((action) => [action, getStudioBatchTargets(editableProject, action).length]),
  ) as Record<StudioBatchAction, number>, [editableProject]);
  const visibleVoiceCandidates = voiceCandidates.filter((candidate) =>
    candidate.projectId === editableProject.project_id && candidate.clipId === activeClipId && getAudioCandidateWorkspaceMode(candidate) === speechMode,
  );
  const audioProgress = useMemo(() => getStudioAudioProgress(editableProject, voiceCandidates), [editableProject, voiceCandidates]);
  const audioOverview = audioProgress.overview;
  const audioOverviewStatus = hasLoadedStorage && candidateListState?.projectId === editableProject.project_id
    ? candidateListState.status : "loading";
  const candidatesLoading = audioOverviewStatus === "loading";
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
  const workspaceRuntime = useMemo(() => Object.values(generationRuntimeState.jobsById)
    .filter((job) => (generationWorkspaceRef.current.get(job.jobId) ?? "short") === speechMode)
    .reduce((state, job) => upsertGenerationJob(state, job), emptyGenerationRuntimeState), [generationRuntimeState, speechMode]);
  const generationView = useMemo(
    () =>
      getGenerationView({
        project: editableProject,
        selectedClip,
        runtimeState: workspaceRuntime,
        selectedClipHasValidationIssues,
        projectMixFingerprint: activeMixFingerprint,
      }),
    [
      editableProject,
      workspaceRuntime,
      activeMixFingerprint,
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

  useEffect(() => () => {
    handleCancelCandidateRecheck(false);
  }, [editableProject.project_id, activeClipId, speechMode, handleCancelCandidateRecheck]);

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
        try {
          const paragraph = VoiceGenerationOptionsSchema.safeParse(JSON.parse(window.localStorage.getItem("ai-asmr-studio:v1:voice-options-paragraph") || "null"));
          if (paragraph.success) setParagraphVoiceOptions({ ...paragraph.data, provider: "voxcpm2", generationMode: "paragraph" });
        } catch { /* Default to the current reference on the first paragraph visit. */ }
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
        setCandidateListState({ projectId, status: "loading" });
      }
    });
    if (hasLoadedStorage) {
      const query = new URLSearchParams({ projectId, workspaceMode: speechMode });
      void fetch(`/api/audio-candidates?${query}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("候选列表读取失败，请刷新重试。");
          const payload = await response.json() as { candidates: unknown };
          const candidates = AudioCandidateSchema.array().parse(payload.candidates);
          if (!controller.signal.aborted) {
            setVoiceCandidates(candidates);
            setCandidateListState({ projectId, status: "ready" });
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setVoiceError("候选列表读取失败，请刷新重试。");
            setCandidateListState({ projectId, status: "error" });
          }
        });
    }
    return () => controller.abort();
  }, [editableProject.project_id, candidateRefresh, hasLoadedStorage, speechMode]);

  useEffect(() => {
    let current = true;
    queueMicrotask(() => { if (current) setVoiceError(undefined); });
    return () => { current = false; };
  }, [activeClipId]);

  function handleVoiceOptionsChange(next: VoiceGenerationOptions, mode: SpeechWorkspaceMode = getSpeechWorkspaceMode(editableProjectRef.current)) {
    const paragraph = mode === "paragraph";
    const normalized = paragraph ? { ...next, provider: "voxcpm2" as const, generationMode: "paragraph" as const } : next;
    if (paragraph) setParagraphVoiceOptions(normalized); else setVoiceOptions(normalized);
    setVoiceError(undefined);
    try { window.localStorage.setItem(paragraph ? "ai-asmr-studio:v1:voice-options-paragraph" : "ai-asmr-studio:v1:voice-options", JSON.stringify(normalized)); }
    catch { setVoiceError("声音设置未能保存，刷新后需要重新选择。"); }
  }

  function handleSpeechModeChange(mode: SpeechWorkspaceMode) {
    const current = editableProjectRef.current;
    handleCancelCandidateRecheck(false);
    const next = switchSpeechWorkspace(current, mode, current.speechWorkspace ? {} : { mixFingerprint: projectMixFingerprint });
    audioRef.current?.pause();
    acceptedPreviewAudioRef.current?.pause();
    editableProjectRef.current = next;
    setEditableProject(next);
    setProjectMixFingerprint(next.speechWorkspace?.[mode].mixFingerprint);
    setVoiceError(undefined);
    setScriptNotice(undefined);
    setAudioAnalysis(undefined);
    setAudioAnalysisStatus("idle");
    setCandidateRefresh((value) => value + 1);
  }

  function handleReferenceImported({ reference, catalog }: VoiceReferenceImportResult) {
    setVoiceCatalog(catalog); setVoiceCatalogError(undefined);
    const mode = referenceImportModeRef.current;
    const base = mode === "short" ? shortVoiceOptions : paragraphVoiceOptions ?? { ...shortVoiceOptions, generationMode: "paragraph" as const };
    handleVoiceOptionsChange({ ...base, provider: "voxcpm2", voicePackId: reference.id,
      referenceMode: reference.referenceModes.includes("with_reference_text") ? "with_reference_text" : "reference_only" }, mode);
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
    setProjectMixFingerprint(entry.project.speechWorkspace ? entry.project.speechWorkspace[getSpeechWorkspaceMode(entry.project)].mixFingerprint : entry.mixFingerprint);
    setStorageAvailable(true);
    setVoiceError(undefined);
  }

  async function handleAdoptVoiceCandidate(candidate: AudioCandidate) {
    if (referenceImportBusyRef.current || candidateRecheckRunRef.current || voiceBusy) return;
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
      const current = editableProjectRef.current;
      const mode = getAudioCandidateWorkspaceMode(fresh);
      const projection = current.speechWorkspace ? getSpeechWorkspaceProject(current, mode) : current;
      const latestLibrary = updateLibraryProject(projectLibraryRef.current, projection);
      let next = adoptAudioCandidate(latestLibrary, fresh);
      if (current.speechWorkspace) next = { ...next, projects: next.projects.map((entry) => entry.projectId === current.project_id ? {
        ...entry, project: mergeSpeechWorkspaceProject(current, mode, entry.project),
        mixFingerprint: mode === getSpeechWorkspaceMode(current) ? undefined : projectMixFingerprint,
      } : entry) };
      try { commitCandidateLibrary(next); }
      catch { setStorageAvailable(false); throw new Error("采用未保存，原声已保留。请检查本地存储后重试。"); }
    } catch (error) {
      if (session === generationSessionRef.current) setVoiceError(error instanceof Error ? error.message : "未能采用候选。");
    } finally { setCandidateActionBusy(false); }
  }

  async function handleDiscardVoiceCandidate(candidate: AudioCandidate) {
    if (referenceImportBusyRef.current || candidateRecheckRunRef.current || voiceBusy || selectedClip?.asset.asset_id === candidate.asset.assetId) return;
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
    if (referenceImportBusyRef.current || candidateRecheckRunRef.current || voiceBusy) return;
    try {
      const current = updateLibraryProject(projectLibraryRef.current, editableProject);
      const next = undoLastAudioCandidate(current);
      try { commitCandidateLibrary(next); }
      catch { setStorageAvailable(false); throw new Error("撤回未保存，请检查本地存储后重试。"); }
    } catch (error) { setVoiceError(error instanceof Error ? error.message : "未能撤回采用。"); }
  }

  async function handleRecheckVoiceCandidate(candidate: AudioCandidate) {
    if (referenceImportBusyRef.current || candidateRecheckRunRef.current || voiceBusy || singleStoryboardBusyRef.current || candidatesLoading) return;
    const projectSnapshot = structuredClone(editableProjectRef.current);
    const clip = flattenClips(projectSnapshot).find((item) => item.id === activeClipId);
    if (!clip || clip.type !== "voice" || candidate.status !== "ready" || candidate.projectId !== projectSnapshot.project_id || candidate.clipId !== clip.id) return;
    const paragraphRecheck = candidate.provenance.generationMode === "paragraph" && Boolean(candidate.provenance.paragraph?.sourceAsset);
    if (!paragraphRecheck && (candidate.provenance.generationMode !== "long_text" || !candidate.provenance.longText?.plan)) {
      setVoiceError("此候选未保存可核对的分组原音，暂不能重新识别。"); return;
    }
    const context = paragraphRecheck ? undefined : getVoiceGenerationContext(projectSnapshot, clip.id);
    const paragraphContext = paragraphRecheck ? getVoiceParagraphContext(projectSnapshot, clip.id) : undefined;
    const sourceFingerprint = getVoiceCandidateSourceFingerprint(clip, context, paragraphContext);
    if (candidate.sourceFingerprint !== sourceFingerprint) {
      setVoiceError("文案或后续上下文已修改，暂不能重新识别此候选。"); return;
    }
    const run = { controller: new AbortController(), projectId: projectSnapshot.project_id, clipId: clip.id };
    candidateRecheckRunRef.current = run;
    const session = generationSessionRef.current;
    const savedContext = JSON.stringify(candidate.provenance.longText?.context);
    let failureMessage = "无法连接本地服务，请确认 3001 服务正在运行后重试；原候选已保留。";
    setRecheckingCandidateId(candidate.candidateId);
    setVoiceError(undefined);
    try {
      const response = await fetch(`/api/audio-candidates/${encodeURIComponent(candidate.candidateId)}/recheck`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectSnapshot, clipId: clip.id }), signal: run.controller.signal,
      });
      failureMessage = "重新识别服务未返回有效结果，请刷新页面后重试；原候选已保留。";
      const rawPayload: unknown = await response.json();
      if (candidateRecheckRunRef.current !== run || run.controller.signal.aborted || session !== generationSessionRef.current) return;
      if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) throw new Error(failureMessage);
      const payload = rawPayload as { candidate?: unknown; error?: unknown };
      if (!response.ok) {
        failureMessage = typeof payload.error === "string" && payload.error.trim() ? payload.error : failureMessage;
        throw new Error(failureMessage);
      }
      const latest = editableProjectRef.current;
      const latestClip = flattenClips(latest).find((item) => item.id === clip.id);
      if (latest.project_id !== run.projectId || !latestClip || latestClip.type !== "voice"
          || getVoiceCandidateSourceFingerprint(latestClip, paragraphRecheck ? undefined : getVoiceGenerationContext(latest, clip.id), paragraphRecheck ? getVoiceParagraphContext(latest, clip.id) : undefined) !== sourceFingerprint) {
        failureMessage = "文案或后续上下文已修改，重新识别结果未加入；原候选已保留。";
        throw new Error(failureMessage);
      }
      const parsed = AudioCandidateSchema.safeParse(payload.candidate);
      if (!parsed.success || parsed.data.projectId !== run.projectId || parsed.data.clipId !== run.clipId || parsed.data.status !== "ready"
          || parsed.data.sourceFingerprint !== sourceFingerprint || parsed.data.candidateId === candidate.candidateId
          || voiceCandidates.some((item) => item.candidateId === parsed.data.candidateId)
          || (paragraphRecheck ? parsed.data.provenance.generationMode !== "paragraph"
            || parsed.data.provenance.paragraph?.sourceAsset.assetId !== candidate.provenance.paragraph?.sourceAsset.assetId
            || parsed.data.provenance.paragraph?.text !== paragraphContext?.text
            || parsed.data.provenance.paragraph?.clipIds.join("|") !== paragraphContext?.clips.map((item) => item.clipId).join("|")
            : parsed.data.provenance.generationMode !== "long_text" || JSON.stringify(parsed.data.provenance.longText?.context) !== savedContext)) {
        failureMessage = "重新识别结果与当前片段不一致，原候选已保留。";
        throw new Error(failureMessage);
      }
      setVoiceCandidates((current) => [parsed.data, ...current]);
      if (paragraphRecheck) setCandidateRefresh((value) => value + 1);
    } catch {
      if (candidateRecheckRunRef.current === run && !run.controller.signal.aborted && session === generationSessionRef.current) {
        setVoiceError(failureMessage);
      }
    } finally {
      if (candidateRecheckRunRef.current === run) {
        candidateRecheckRunRef.current = null;
        setRecheckingCandidateId(undefined);
      }
    }
  }

  async function handleConfirmParagraphText(candidate: AudioCandidate, confirmedClipIds: string[]) {
    if (referenceImportBusyRef.current || candidateRecheckRunRef.current || voiceBusy || singleStoryboardBusyRef.current || candidatesLoading) return;
    const projectSnapshot = structuredClone(editableProjectRef.current);
    const clip = flattenClips(projectSnapshot).find((item) => item.id === activeClipId);
    const paragraph = candidate.provenance.paragraph;
    if (getSpeechWorkspaceMode(projectSnapshot) !== "paragraph" || !clip || clip.type !== "voice" || candidate.status !== "ready"
        || candidate.projectId !== projectSnapshot.project_id || candidate.clipId !== clip.id || paragraph?.checkStatus !== "needs_confirmation" || paragraph.manualTextConfirmation) return;
    if (validationIssues.length) { setVoiceError("请先修正片段内容，再确认并采用。"); return; }
    const paragraphContext = getVoiceParagraphContext(projectSnapshot, clip.id);
    const sourceFingerprint = getVoiceCandidateSourceFingerprint(clip, undefined, paragraphContext);
    const reviewIds = paragraph.segments.filter((segment) => segment.textReview).map((segment) => segment.clipId);
    if (candidate.sourceFingerprint !== sourceFingerprint || !reviewIds.length || confirmedClipIds.join("|") !== reviewIds.join("|")) {
      setVoiceError("文案或试听范围已变化，请重新逐句试听确认。"); return;
    }
    const run = { controller: new AbortController(), projectId: projectSnapshot.project_id, clipId: clip.id, kind: "confirm" as const };
    candidateRecheckRunRef.current = run;
    const session = generationSessionRef.current;
    const editRevision = editRevisionRef.current;
    setConfirmingCandidateId(candidate.candidateId);
    setVoiceError(undefined);
    let failureMessage = "无法连接本地服务，试听确认未能核实；当前人声保持。请刷新候选后重试。";
    try {
      const response = await fetch(`/api/audio-candidates/${encodeURIComponent(candidate.candidateId)}/confirm-text`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectSnapshot, clipId: clip.id, confirmedClipIds }), signal: run.controller.signal,
      });
      failureMessage = "试听确认服务未返回有效结果，当前人声保持；请刷新候选后重试。";
      const rawPayload: unknown = await response.json();
      if (candidateRecheckRunRef.current !== run || run.controller.signal.aborted || session !== generationSessionRef.current) return;
      if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) throw new Error(failureMessage);
      const payload = rawPayload as { candidate?: unknown; candidates?: unknown; error?: unknown };
      if (!response.ok) {
        failureMessage = typeof payload.error === "string" && payload.error.trim() ? payload.error : failureMessage;
        throw new Error(failureMessage);
      }
      const latest = editableProjectRef.current;
      const latestClip = flattenClips(latest).find((item) => item.id === clip.id);
      if (editRevision !== editRevisionRef.current || latest.project_id !== run.projectId || getSpeechWorkspaceMode(latest) !== "paragraph"
          || !latestClip || latestClip.type !== "voice" || getVoiceCandidateSourceFingerprint(latestClip, undefined, getVoiceParagraphContext(latest, clip.id)) !== sourceFingerprint) {
        failureMessage = "工程刚刚有修改，未采用试听确认结果；当前人声保持。";
        throw new Error(failureMessage);
      }
      const parsed = AudioCandidateSchema.safeParse(payload.candidate);
      const { manualTextConfirmation: priorConfirmation, ...originalParagraph } = paragraph;
      void priorConfirmation;
      const confirmedParagraph = parsed.success ? parsed.data.provenance.paragraph : undefined;
      const { manualTextConfirmation, ...resultParagraph } = confirmedParagraph ?? {};
      if (!parsed.success || parsed.data.candidateId !== candidate.candidateId || parsed.data.projectId !== run.projectId
          || parsed.data.clipId !== run.clipId || parsed.data.status !== "ready" || parsed.data.sourceFingerprint !== sourceFingerprint
          || parsed.data.provenance.generationMode !== "paragraph" || JSON.stringify(parsed.data.asset) !== JSON.stringify(candidate.asset)
          || JSON.stringify(resultParagraph) !== JSON.stringify(originalParagraph) || manualTextConfirmation?.sourceCandidateId !== candidate.candidateId
          || manualTextConfirmation?.confirmedClipIds.join("|") !== reviewIds.join("|")) {
        failureMessage = "试听确认结果与当前整段不一致，当前人声保持。";
        throw new Error(failureMessage);
      }
      const siblings = AudioCandidateSchema.array().safeParse(payload.candidates);
      const currentParagraphContext = getVoiceParagraphContext(latest, clip.id);
      const currentMembers = flattenClips(latest);
      if (!siblings.success || new Set(siblings.data.map((item) => item.candidateId)).size !== siblings.data.length
          || siblings.data.length !== paragraph.clipIds.length
          || new Set(siblings.data.map((item) => item.clipId)).size !== paragraph.clipIds.length
          || paragraph.clipIds.some((id) => !siblings.data.some((item) => item.clipId === id))
          || !siblings.data.some((item) => JSON.stringify(item) === JSON.stringify(parsed.data))
          || siblings.data.some((item) => item.projectId !== run.projectId || item.status !== "ready" || item.provenance.generationMode !== "paragraph"
            || JSON.stringify(item.provenance.paragraph) !== JSON.stringify(confirmedParagraph)
            || JSON.stringify(item.asset) !== JSON.stringify(confirmedParagraph?.segments.find((segment) => segment.clipId === item.clipId)?.asset)
            || !currentParagraphContext || !currentMembers.some((member) => member.type === "voice" && member.id === item.clipId
              && item.sourceFingerprint === getVoiceCandidateSourceFingerprint(member, undefined, currentParagraphContext)))) {
        failureMessage = "试听确认结果与当前整段不一致，当前人声保持。";
        throw new Error(failureMessage);
      }
      setVoiceCandidates((items) => items.map((item) => siblings.data.find((saved) => saved.candidateId === item.candidateId) ?? item));
      const projection = getSpeechWorkspaceProject(latest, "paragraph");
      const latestLibrary = updateLibraryProject(projectLibraryRef.current, projection);
      failureMessage = "试听确认已保存，但未能采用；当前人声保持。请刷新候选后重试。";
      const adoptedLibrary = adoptAudioCandidate(latestLibrary, parsed.data);
      const next = { ...adoptedLibrary, projects: adoptedLibrary.projects.map((entry) => entry.projectId === latest.project_id ? {
        ...entry, project: mergeSpeechWorkspaceProject(latest, "paragraph", entry.project), mixFingerprint: undefined,
      } : entry) };
      try { commitCandidateLibrary(next); }
      catch { setStorageAvailable(false); failureMessage = "试听确认已保存，但采用未能保存；当前人声保持。请检查本地存储后重试采用。"; throw new Error(failureMessage); }
    } catch {
      if (candidateRecheckRunRef.current === run && !run.controller.signal.aborted && session === generationSessionRef.current) setVoiceError(failureMessage);
    } finally {
      if (candidateRecheckRunRef.current === run) { candidateRecheckRunRef.current = null; setConfirmingCandidateId(undefined); }
    }
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
        setProjectMixFingerprint(loadedEntry.project.speechWorkspace ? loadedEntry.project.speechWorkspace[getSpeechWorkspaceMode(loadedEntry.project)].mixFingerprint : loadedEntry.mixFingerprint);
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
        editableProject.speechWorkspace ? captureSpeechWorkspace(editableProject, { mixFingerprint: activeMixFingerprint }) : editableProject,
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
  }, [editableProject, hasLoadedStorage, validationIssues.length, activeMixFingerprint]);

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
        if (controller.signal.aborted) return;
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
      batchRunRef.current?.controller.abort();
      batchRunRef.current = null;
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
    handleCancelCandidateRecheck(false);
    batchRunRef.current?.controller.abort();
    batchRunRef.current = null;
    setBatchProgress(undefined);
    setBatchNotice(undefined);
    candidateJobIdsRef.current.clear();
    windowedVoiceJobsRef.current.clear();
    generationWorkspaceRef.current.clear();
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
    setProjectMixFingerprint(entry.project.speechWorkspace ? entry.project.speechWorkspace[getSpeechWorkspaceMode(entry.project)].mixFingerprint : entry.mixFingerprint);
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

  function cancelGenerationForClip(clipId: string, mode = getSpeechWorkspaceMode(editableProjectRef.current)) {
    const job = getGenerationJobForClip(
      generationRuntimeStateRef.current,
      clipId,
    );

    if (!job || !isActiveGenerationJob(job)) {
      return;
    }
    if (editableProjectRef.current.speechWorkspace && (generationWorkspaceRef.current.get(job.jobId) ?? "short") !== mode) return;

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

  function cancelProjectMixGeneration(mode = getSpeechWorkspaceMode(editableProjectRef.current)) {
    const job = getGenerationJobForProjectMix(
      generationRuntimeStateRef.current,
      "wav",
    );

    if (!job || !isActiveGenerationJob(job)) {
      return;
    }
    if (editableProjectRef.current.speechWorkspace && (generationWorkspaceRef.current.get(job.jobId) ?? "short") !== mode) return;

    const next = clearGenerationJob(
      generationRuntimeStateRef.current,
      job.jobId,
    );

    delete projectMixReasonsRef.current[job.jobId];
    delete projectMixJobFingerprintsRef.current[job.jobId];
    setRuntimeState(next);
    void bridgeRef.current?.cancelGeneration(job.jobId);
  }

  function cancelStaleWorkspaceJobs(next: AsmrProject) {
    cancelChangedVoiceWindows(next);
    for (const job of Object.values(generationRuntimeStateRef.current.jobsById)) {
      const mode = generationWorkspaceRef.current.get(job.jobId) ?? "short";
      const projection = next.speechWorkspace ? getSpeechWorkspaceProject(next, mode) : next;
      if (job.target?.type === "project_mix") {
        const fingerprint = projectMixJobFingerprintsRef.current[job.jobId];
        if (!fingerprint || !isCurrentProjectMixFingerprint(projection, fingerprint)) cancelProjectMixGeneration(mode);
      } else {
        const fingerprint = generationFingerprintsRef.current[job.jobId];
        if (!fingerprint || !isCurrentClipGenerationFingerprint(projection, job.clipId, fingerprint, { ignoreVoiceStart: true })) cancelGenerationForClip(job.clipId, mode);
      }
    }
  }

  function handleGenerationUpdate(
    update: GenerationJobUpdate,
    generationSession: number,
  ) {
    if (generationSession !== generationSessionRef.current) {
      return;
    }
    const mode = generationWorkspaceRef.current.get(update.job.jobId) ?? "short";
    function commitWorkspaceResult(updateProject: (project: AsmrProject) => AsmrProject) {
      setEditableProject((current) => {
        const projection = current.speechWorkspace ? getSpeechWorkspaceProject(current, mode) : current;
        const updated = updateProject(projection);
        const merged = current.speechWorkspace ? mergeSpeechWorkspaceProject(current, mode, updated) : updated;
        editableProjectRef.current = merged;
        return merged;
      });
    }

    if (update.type !== "snapshot") windowedVoiceJobsRef.current.delete(update.job.jobId);

    if (update.type === "snapshot") {
      setRuntimeState(upsertGenerationJob(generationRuntimeStateRef.current, update.job));
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
      if (update.type === "failed" && getSpeechWorkspaceMode(editableProjectRef.current) === mode) setVoiceError(update.error);
      return;
    }

    if (update.type === "succeeded") {
      if (update.job.target?.type === "project_mix") {
        const fingerprint =
          projectMixJobFingerprintsRef.current[update.job.jobId];

        commitWorkspaceResult((currentProject) =>
          fingerprint &&
          isCurrentProjectMixFingerprint(currentProject, fingerprint)
            ? currentProject.speechWorkspace ? captureSpeechWorkspace(commitProjectMixSuccess(currentProject, update.asset), { mixFingerprint: fingerprint }) : commitProjectMixSuccess(currentProject, update.asset)
            : currentProject,
        );
        if (fingerprint && getSpeechWorkspaceMode(editableProjectRef.current) === mode
          && isCurrentProjectMixFingerprint(editableProjectRef.current, fingerprint)) {
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

      commitWorkspaceResult((currentProject) =>
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

        commitWorkspaceResult((currentProject) =>
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

      commitWorkspaceResult((currentProject) =>
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
    if (referenceImportBusyRef.current || voiceBusy || candidate.clipId !== selectedClip?.id || candidate.projectId !== editableProject.project_id) return;
    const options: VoiceGenerationOptions = { provider: "voxcpm2", generationMode: "long_text",
      voicePackId: candidate.provenance.voicePackId, referenceMode: candidate.provenance.referenceMode,
      analysisProvider: voiceOptions.analysisProvider ?? "local" };
    handleVoiceOptionsChange(options);
    startSelectedClipGeneration(options, { candidateId: candidate.candidateId, groupIndex });
  }

  function startSelectedClipGeneration(optionsOverride?: VoiceGenerationOptions, longTextRetry?: LongTextRetry, target?: { project: AsmrProject; clipId: string }) {
    if (referenceImportBusyRef.current || candidateRecheckRunRef.current || batchRunRef.current) return;
    const generationProject = target?.project ?? editableProject;
    const generationClip = target ? flattenClips(generationProject).find((clip) => clip.id === target.clipId) : selectedClip;
    const control = target ? getGenerationView({ project: generationProject, selectedClip: generationClip, runtimeState: generationRuntimeStateRef.current, selectedClipHasValidationIssues: Object.keys(getClipFieldValidationIssues(generationProject, target.clipId, getProjectValidationIssues(generationProject))).length > 0, projectMixFingerprint }).selectedClipControl : generationView.selectedClipControl;
    if (!generationClip || control.disabled) {
      return;
    }
    const options = generationClip.type === "voice" ? optionsOverride ?? voiceOptions : undefined;
    if ((options?.provider === "voxcpm2" && voiceBusy) || (generationClip.type === "voice" && generationClip.kind === "silent")
      || Object.values(generationRuntimeStateRef.current.jobsById).some((job) => isActiveGenerationJob(job) && job.clipId === generationClip.id)) return;
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
    const paragraphContext = options?.generationMode === "paragraph" ? getVoiceParagraphContext(generationProject, generationClip.id) : undefined;
    const mode = getSpeechWorkspaceMode(generationProject);

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
          generationWorkspaceRef.current.set(update.job.jobId, mode);
          if ((voiceContext || paragraphContext) && update.type === "snapshot") windowedVoiceJobsRef.current.set(update.job.jobId, {
            clipId: generationClip.id, context: JSON.stringify(paragraphContext ?? voiceContext), mode, paragraph: Boolean(paragraphContext),
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
    if (batchRunRef.current) { handleCancelBatch(); return; }
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
    if (referenceImportBusyRef.current || candidateRecheckRunRef.current || batchRunRef.current || voiceBusy) return;
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
          generationWorkspaceRef.current.set(update.job.jobId, speechMode);
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

    acceptedPreviewAudioRef.current?.pause();
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

    acceptedPreviewAudioRef.current?.pause();
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
      commitScriptEdit(next, clipId, current.speechWorkspace ? "文案已同步；原音已保留，生成新候选后再采用。" : "台词已更新，可以生成这一段的新音频。", Boolean(clip.asset.uri));
      return;
    }
    editRevisionRef.current += 1;
    cancelGenerationForClip(clipId);
    cancelProjectMixGeneration();
    const raw = syncExplicitWaits(updateClipInProject(current, clipId, patch));
    const updated = current.speechWorkspace ? syncSharedSpeechScript(current, raw) : raw;
    if (current.speechWorkspace) cancelStaleWorkspaceJobs(updated); else cancelChangedVoiceWindows(updated);
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
    const current = editableProjectRef.current;
    const raw = applyDirectorPreset(current, clipId, preset);
    const updated = current.speechWorkspace ? syncSharedSpeechScript(current, raw) : raw;
    if (current.speechWorkspace) cancelStaleWorkspaceJobs(updated); else cancelChangedVoiceWindows(updated);
    editableProjectRef.current = updated;
    setEditableProject(updated);
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

  function commitScriptEdit(next: AsmrProject, clipId?: string, notice?: string, protect = true, sourceAlreadySynced = false) {
    const current = editableProjectRef.current;
    if (next === current) return;
    if (current.speechWorkspace && !sourceAlreadySynced) next = syncSharedSpeechScript(current, next);
    setScriptHistory((history) => [...history.slice(-29), { project: current, clipId: activeClipId, mode: getSpeechWorkspaceMode(current) }]);
    if (protect && getProjectValidationIssues(current).length === 0) {
      persistLibrary(createProjectRevision(updateLibraryProject(projectLibraryRef.current, current), current.project_id, new Date(), "文案编辑前"));
    }
    editRevisionRef.current += 1;
    if (current.speechWorkspace) cancelStaleWorkspaceJobs(next);
    else {
      cancelChangedVoiceWindows(next);
      const after = new Map(flattenClips(next).map((clip) => [clip.id, clip]));
      for (const clip of flattenClips(current)) {
        if (JSON.stringify(clip) !== JSON.stringify(after.get(clip.id))) cancelGenerationForClip(clip.id);
      }
      cancelProjectMixGeneration();
    }
    audioRef.current?.pause();
    editableProjectRef.current = next;
    setEditableProject(next);
    setSelectedClipId(clipId);
    setScriptNotice(notice);
    setImportError(undefined);
  }

  function cancelChangedVoiceWindows(next: AsmrProject) {
    for (const [jobId, job] of windowedVoiceJobsRef.current) {
      const source = next.speechWorkspace ? getSpeechWorkspaceProject(next, job.mode) : next;
      const context = job.paragraph ? getVoiceParagraphContext(source, job.clipId) : getVoiceGenerationContext(source, job.clipId);
      if (JSON.stringify(context) !== job.context) {
        cancelGenerationForClip(job.clipId, job.mode);
        windowedVoiceJobsRef.current.delete(jobId);
      }
    }
  }

  function handleSplitVoice(clipId: string, start: number, end: number, generate = false) {
    if (generate && (referenceImportBusyRef.current || voiceBusy)) return;
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
    if (speechMode === "short" && voiceOptions.provider === "voxcpm2") handleVoiceOptionsChange({ ...voiceOptions, generationMode: "long_text" });
  }

  function handleAddSilent(afterClipId?: string) {
    const result = addSilentClip(editableProjectRef.current, afterClipId);
    commitScriptEdit(result.project, result.selectedClipId ?? undefined, "已插入无对白镜头，可编辑画面描述并生成分镜。");
    setInspectorTab("storyboard");
  }

  function handleSilentDuration(clipId: string, duration: number) {
    commitScriptEdit(setSilentClipDuration(editableProjectRef.current, clipId, duration), clipId, "无对白镜头时长已同步。");
  }

  function handleParagraphScript(groupId: string, text: string) {
    commitScriptEdit(replaceParagraphScript(editableProjectRef.current, groupId, text), activeClipId, "文案与短句已同步；旧音频可从编辑历史恢复。", true, true);
  }

  function handleNormalizeSentences(clipId?: string) {
    const current = editableProjectRef.current;
    const initialized = ensureSpeechWorkspaces(current);
    const normalized = normalizeSpeechSentences(initialized, clipId);
    if (normalized === initialized) return;
    commitScriptEdit(normalized, clipId ?? activeClipId, "已切为短句并同步两页；原长段音频保存在编辑历史。", true, true);
  }

  function handleUndoScriptEdit() {
    const previous = scriptHistory.at(-1);
    if (!previous || previous.project.project_id !== editableProject.project_id) return;
    editRevisionRef.current += 1;
    const current = editableProjectRef.current;
    let restored = previous.project;
    if (current.speechWorkspace) {
      const source = hasSharedSpeechScriptChanges(current, previous.project) ? restoreSharedSpeechScript(current, previous.project) : current;
      restored = restoreSpeechWorkspaceArrangement(source, previous.project, previous.mode);
      cancelStaleWorkspaceJobs(restored);
    } else clearGenerationSession();
    editableProjectRef.current = restored;
    setEditableProject(restored);
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
    const next = { ...current, videoPlan: { ...current.videoPlan, version: 1 as const, sceneDescription, shots: current.videoPlan?.shots ?? {} } };
    editableProjectRef.current = next;
    setEditableProject(next);
  }

  function handleMoveVoice(clipId: string, direction: VoiceClipMoveDirection) {
    if (voiceBusy || referenceImportBusyRef.current || singleStoryboardBusyRef.current || batchRunRef.current) return;
    const result = moveVoiceClip(editableProjectRef.current, clipId, direction);
    commitScriptEdit(result.project, activeClipId, `已${direction === "up" ? "上移" : "下移"}本段，已采用音频保留，可撤回编辑。`);
  }

  function handleStoryboardReferenceModeChange(clipId: string, mode: StoryboardReferenceMode) {
    if (batchRunRef.current || candidateRecheckRunRef.current || singleStoryboardBusyRef.current || candidateActionBusy
      || Object.values(generationRuntimeStateRef.current.jobsById).some(isActiveGenerationJob)) return;
    const current = editableProjectRef.current;
    if (!flattenClips(current).some((clip) => clip.id === clipId && clip.type === "voice")) return;
    const nextMode = getPreviousVoiceClip(current, clipId) ? mode : "new";
    const next = { ...current, videoPlan: {
      ...current.videoPlan, version: 1 as const,
      sceneDescription: current.videoPlan?.sceneDescription ?? current.scene.name,
      shots: current.videoPlan?.shots ?? {},
      referenceModes: { ...current.videoPlan?.referenceModes, [clipId]: nextMode },
    } };
    editableProjectRef.current = next;
    setEditableProject(next);
  }

  function handleCancelBatch() {
    const run = batchRunRef.current;
    if (!run) return;
    run.controller.abort();
    if (run.jobId) {
      candidateJobIdsRef.current.delete(run.jobId);
      windowedVoiceJobsRef.current.delete(run.jobId);
      delete generationReasonsRef.current[run.jobId];
      delete generationFingerprintsRef.current[run.jobId];
      setRuntimeState(clearGenerationJob(generationRuntimeStateRef.current, run.jobId));
    }
    setBatchNotice("已停止后续排队，正在取消当前生成。");
  }

  async function handleRunBatch(action: StudioBatchAction) {
    if (referenceImportBusyRef.current || candidateRecheckRunRef.current || batchRunRef.current || candidateActionBusy || singleStoryboardBusyRef.current
      || Object.values(generationRuntimeStateRef.current.jobsById).some(isActiveGenerationJob)) return;
    const initial = structuredClone(editableProjectRef.current);
    const mode = getSpeechWorkspaceMode(initial);
    const clipIds = getStudioBatchTargets(initial, action);
    if (!clipIds.length) return;
    const audio = action.startsWith("audio");
    const options = structuredClone(voiceOptions);
    const run = { controller: new AbortController(), projectId: initial.project_id, jobId: undefined as string | undefined };
    batchRunRef.current = run;
    const signal = run.controller.signal;
    setBatchNotice(undefined);
    if (audio) setVoiceError(undefined);
    setBatchProgress({ action, total: clipIds.length, completed: 0, succeeded: 0, failed: 0, skipped: 0 });
    const session = generationSessionRef.current;
    try {
      if (audio) {
        const engine = voiceCatalog?.providers.find((item) => item.id === options.provider);
        if (!engine?.available) throw new Error("当前人声引擎尚未就绪，请先检查声音设置。");
        if (options.provider === "voxcpm2" && options.generationMode === "long_text" && !engine.longText?.available) {
          throw new Error(engine.longText?.reason || "长文语音分析尚未就绪。");
        }
      } else if (!(initial.videoPlan?.sceneDescription ?? initial.scene.name).trim()) {
        throw new Error("请先补全工程剧情背景，再批量生成分镜。");
      }
      let provider: "api" | "ollama" = "api";
      if (!audio) {
        const response = await fetch("/api/planner", { signal });
        if (!response.ok) throw new Error("暂时无法读取分镜模型配置，请稍后重试。");
        const catalog = await response.json() as { defaultProvider: "api" | "ollama"; providers: { id: "api" | "ollama"; configured: boolean }[] };
        provider = storyboardProviderRef.current ?? catalog.defaultProvider;
        if (!catalog.providers.some((item) => item.id === provider && item.configured)) throw new Error("请先配置可用的分镜模型。");
      }
      const sources = new Map(clipIds.map((clipId) => [clipId, audio
        ? batchAudioSource(initial, clipId, options) : createClipVideoSourceFingerprint(initial, clipId)]));
      const originalShots = new Map(clipIds.map((clipId) => [clipId, JSON.stringify(initial.videoPlan?.shots[clipId] ?? null)]));
      const referenceModes = new Map(clipIds.map((clipId) => [clipId, getClipStoryboardReferenceMode(initial, clipId)]));
      const result = await runStudioBatchQueue({
        clipIds, signal,
        onProgress: (progress) => { if (batchRunRef.current === run) setBatchProgress({ action, ...progress }); },
        onItem: async (clipId) => {
          const active = editableProjectRef.current;
          const latest = active.speechWorkspace ? getSpeechWorkspaceProject(active, mode) : active;
          if (signal.aborted || latest.project_id !== run.projectId) return "skipped";
          if (!getStudioBatchTargets(latest, action).includes(clipId)) return "skipped";
          const snapshot = structuredClone(latest);
          const clip = flattenClips(snapshot).find((item) => item.id === clipId);
          if (clip?.type !== "voice") return "skipped";
          if (audio) {
            if (batchAudioSource(snapshot, clipId, options) !== sources.get(clipId)) return "skipped";
            if (Object.keys(getClipFieldValidationIssues(snapshot, clipId, getProjectValidationIssues(snapshot))).length) {
              throw new Error("当前段落存在无效设置，请修正后重新生成。");
            }
            if (options.provider === "voxcpm2" && options.generationMode === "long_text" && !clip.semantic_unit
              && options.analysisProvider === "api" && !voiceCatalog?.providers.find((item) => item.id === "voxcpm2")?.longText?.apiConfigured) {
              throw new Error("请先配置外部文本分析，或改用本地分析。");
            }
            const reason = clip.generation.status === "asset_generated" ? "regenerate" : "generate";
            const fingerprint = getClipGenerationFingerprint(clip, { ignoreVoiceStart: true });
            const context = options.provider === "voxcpm2" && options.generationMode === "long_text" ? getVoiceGenerationContext(snapshot, clipId) : undefined;
            const paragraphContext = options.generationMode === "paragraph" ? getVoiceParagraphContext(snapshot, clipId) : undefined;
            let itemJobId: string | undefined;
            try {
              await waitForStudioVoiceGeneration({
              bridge: getGenerationBridge(), request: { project: snapshot, clipId, reason, voiceOptions: options }, signal,
              onUpdate: (update) => {
                if (signal.aborted || batchRunRef.current !== run || session !== generationSessionRef.current) return;
                itemJobId = update.job.jobId;
                run.jobId = itemJobId;
                generationReasonsRef.current[update.job.jobId] = reason;
                generationWorkspaceRef.current.set(update.job.jobId, mode);
                generationFingerprintsRef.current[update.job.jobId] = fingerprint;
                if (options.provider === "voxcpm2") candidateJobIdsRef.current.add(update.job.jobId);
                if ((context || paragraphContext) && update.type === "snapshot") windowedVoiceJobsRef.current.set(update.job.jobId, { clipId, context: JSON.stringify(paragraphContext ?? context), mode, paragraph: Boolean(paragraphContext) });
                handleGenerationUpdate(update, session);
                if (update.type !== "snapshot") run.jobId = undefined;
              },
              });
            } finally {
              if (itemJobId) {
                const job = generationRuntimeStateRef.current.jobsById[itemJobId];
                if (job && isActiveGenerationJob(job)) {
                  void getGenerationBridge().cancelGeneration(itemJobId).catch(() => {});
                }
                candidateJobIdsRef.current.delete(itemJobId);
                windowedVoiceJobsRef.current.delete(itemJobId);
                delete generationReasonsRef.current[itemJobId];
                delete generationFingerprintsRef.current[itemJobId];
                if (batchRunRef.current === run && session === generationSessionRef.current) {
                  setRuntimeState(clearGenerationJob(generationRuntimeStateRef.current, itemJobId));
                }
                if (run.jobId === itemJobId) run.jobId = undefined;
              }
            }
            return batchAudioSource(editableProjectRef.current.speechWorkspace ? getSpeechWorkspaceProject(editableProjectRef.current, mode) : editableProjectRef.current, clipId, options) === sources.get(clipId) ? "completed" : "skipped";
          }
          const fingerprint = createClipVideoSourceFingerprint(snapshot, clipId);
          const referenceMode = getClipStoryboardReferenceMode(snapshot, clipId);
          if (fingerprint !== sources.get(clipId)
            || referenceMode !== referenceModes.get(clipId)
            || JSON.stringify(snapshot.videoPlan?.shots[clipId] ?? null) !== originalShots.get(clipId)) return "skipped";
          const referenceContext = getClipStoryboardReferenceContext(snapshot, clipId, referenceMode);
          const includePrevious = Boolean(referenceContext);
          if (referenceMode === "continuous" && !referenceContext) throw new Error("连续镜头需要上一段的可用分镜，请先生成或更新上一段。");
          const response = await fetch("/api/clip-storyboard", {
            method: "POST", headers: { "content-type": "application/json" }, signal,
            body: JSON.stringify({ provider, project: snapshot, clipId, includePrevious, referenceMode }),
          });
          const body = await response.json();
          if (signal.aborted || batchRunRef.current !== run) return "skipped";
          if (!response.ok) throw new Error(body.error || "本段分镜生成失败，请重试。");
          const shot = ClipVideoStoryboardSchema.parse(body.storyboard);
          const current = editableProjectRef.current.speechWorkspace ? getSpeechWorkspaceProject(editableProjectRef.current, mode) : editableProjectRef.current;
          if (current.project_id !== run.projectId || createClipVideoSourceFingerprint(current, clipId) !== fingerprint
            || getClipStoryboardReferenceMode(current, clipId) !== referenceMode
            || JSON.stringify(current.videoPlan?.shots[clipId] ?? null) !== originalShots.get(clipId)
            || JSON.stringify(getClipStoryboardReferenceContext(current, clipId, referenceMode)) !== JSON.stringify(referenceContext)) return "skipped";
          if (shot.clipId !== clipId || shot.sourceFingerprint !== fingerprint || (clip.kind === "silent" ? Boolean(shot.audio) : !shot.audio || shot.audio.assetId !== clip.asset.asset_id
            || shot.audio.uri !== clip.asset.uri) || shot.referenceMode !== referenceMode || Boolean(shot.previousClipId) !== includePrevious
            || (referenceContext && (shot.previousClipId !== referenceContext.previousClipId || shot.previousPromptFingerprint !== referenceContext.previousPromptFingerprint))) {
            throw new Error("分镜结果与当前段落或音频不一致，请重新生成。");
          }
          if (!handleSaveClipStoryboard(run.projectId, shot, mode)) return "skipped";
          return "completed";
        },
      });
      if (batchRunRef.current === run) {
        const details = [`成功 ${result.succeeded}`, ...(result.failed ? [`失败 ${result.failed}`] : []), ...(result.skipped ? [`跳过 ${result.skipped}`] : [])].join(" · ");
        const outcome = result.state === "cancelled" ? "已取消批量生成" : result.state === "stopped" ? "批量生成已停止" : "批量生成完成";
        const remaining = result.state === "stopped" ? ` 还有 ${result.total - result.completed} 段未处理。` : "";
        const failure = result.state === "stopped" ? result.failures[result.failures.length - 1] : result.failures[0];
        setBatchNotice(`${outcome}：${details}。${remaining}${audio && options.provider === "voxcpm2" && result.succeeded ? "可逐段试听并采用新候选。" : ""}${failure ? ` ${failure.message}` : ""}`);
      }
    } catch (error) {
      if (batchRunRef.current === run) setBatchNotice(signal.aborted ? "已取消批量生成。" : error instanceof Error ? error.message : "批量生成失败，请重试。");
    } finally {
      if (batchRunRef.current === run) {
        batchRunRef.current = null;
        setBatchProgress(undefined);
      }
    }
  }

  function handleSaveClipStoryboard(projectId: string, shot: ClipVideoStoryboard, mode: SpeechWorkspaceMode = getSpeechWorkspaceMode(editableProjectRef.current)): boolean {
    const active = editableProjectRef.current;
    const current = active.speechWorkspace ? getSpeechWorkspaceProject(active, mode) : active;
    if (current.project_id !== projectId) return false;
    const next = { ...current, videoPlan: {
      ...current.videoPlan, version: 1 as const, sceneDescription: current.videoPlan?.sceneDescription ?? current.scene.name,
      shots: { ...current.videoPlan?.shots, [shot.clipId]: shot },
    } };
    if (!isClipVideoStoryboardCurrent(next, shot.clipId)) return false;
    try { createClipH3Prompt(next, shot.clipId); }
    catch { return false; }
    const merged = active.speechWorkspace ? mergeSpeechWorkspaceProject(active, mode, next) : next;
    editableProjectRef.current = merged;
    setEditableProject(merged);
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
      projectMixControl={referenceImportBusy ? { ...generationView.projectMixControl, disabled: true, disabledReason: "正在处理参考音频" } : generationView.projectMixControl}
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
        {hasLoadedStorage ? <PlannerPanel projectId={editableProject.project_id}
          source={currentLibraryEntry?.plannerSource} onAdopt={handleAdoptPlanner} /> : null}
      </div>
      <div id="editor-workspace" className="min-h-0 flex-1 overflow-hidden" hidden={workspaceView !== "editor"}>
      <div className={`grid h-full min-h-0 min-w-0 gap-2 ${timelineExpanded ? "grid-rows-[minmax(0,1fr)_minmax(0,0.42fr)]" : "grid-rows-[minmax(0,1fr)_auto]"}`}>
      <EditorPanels activePanel={editorPanel} onPanelChange={setEditorPanel}>
        <div className="h-full min-h-0 min-w-0">
          <ScriptEditorPanel
            workspaceTabs={<div role="tablist" aria-label="语音生成方式" className="inline-flex rounded-lg bg-black/15 p-0.5">{([['short', '短句'], ['paragraph', '整段']] as const).map(([mode, label]) => <button key={mode} type="button" role="tab" aria-selected={speechMode === mode} aria-label={label} onClick={() => handleSpeechModeChange(mode)} title={mode === "short" ? "原有流程：短句 + 长生成取前部" : "整段一次生成，检查后切成短句"} className={`min-h-8 rounded-md px-4 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-sky-300 ${speechMode === mode ? "bg-sky-300/12 text-sky-100 shadow-sm" : "text-studio-muted hover:bg-white/5 hover:text-studio-text"}`}>{label}</button>)}</div>}
            paragraphBody={speechMode === "paragraph" ? <ParagraphScriptList project={editableProject} selectedClipId={activeClipId} onSelectClip={setSelectedClipId} onUpdateParagraph={handleParagraphScript} onUpdateClip={handleUpdateClip} onDurationChange={handleSilentDuration} onOpenStoryboard={(id) => { setSelectedClipId(id); setInspectorTab("storyboard"); setEditorPanel(1); }} onDeleteClip={(id) => { const result = deleteVoiceClip(editableProjectRef.current, id); commitScriptEdit(result.project, result.selectedClipId ?? undefined, "已删除镜头。"); }} /> : undefined}
            audioStates={audioProgress.byClip} audioStatesStatus={audioOverviewStatus}
            key={editableProject.project_id}
            batchActions={<>
              <StudioBatchActions counts={batchCounts} audioOverview={audioOverview} overviewStatus={audioOverviewStatus} disabled={!hasLoadedStorage || referenceImportBusy || voiceBusy || singleStoryboardBusy} progress={batchProgress} notice={batchNotice} onRun={(action) => void handleRunBatch(action)} onCancel={handleCancelBatch} />
              <AcceptedVoicePreview project={editableProject} disabled={!hasLoadedStorage} onAudioElementChange={handlePreviewAudioChange} onPlaybackStart={() => audioRef.current?.pause()} />
            </>}
            project={displayProject}
            selectedClipId={activeClipId}
            onSelectClip={setSelectedClipId}
            onReferenceModeChange={handleStoryboardReferenceModeChange}
            referenceModeBusy={voiceBusy || singleStoryboardBusy || Boolean(batchProgress)}
            busy={voiceBusy || referenceImportBusy || singleStoryboardBusy || Boolean(batchProgress)}
            canUndo={scriptHistory.length > 0}
            notice={scriptNotice}
            onUpdateClip={handleUpdateClip}
            onNormalizeSentences={handleNormalizeSentences}
            canNormalizeSentences={speechMode === "short" && hasUnsplitSpeechSentences(editableProject)}
            onAddClip={(after) => handleAddVoice(speechMode === "paragraph" && after ? getParagraphGroup(editableProjectRef.current, after).at(-1)?.id ?? after : after)}
            onAddSilentClip={(after) => handleAddSilent(speechMode === "paragraph" && after ? getParagraphGroup(editableProjectRef.current, after).at(-1)?.id ?? after : after)}
            onSilentDurationChange={handleSilentDuration}
            onMoveClip={handleMoveVoice}
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
          <div ref={inspectorScrollerRef} id="clip-inspector-audio" role="tabpanel" aria-labelledby="clip-inspector-tab-audio" hidden={inspectorView !== "audio"} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [&>section]:border-0">
          <ClipInspector
            speechWorkspaceMode={speechMode}
            textEditorExternal
            binaural={editableProject.timeline.mixing.binaural}
            voiceGenerationPanel={selectedClip?.type === "voice" ? (generationControl) => (
              <VoiceGenerationPanel
                workspaceMode={speechMode}
                paragraphContext={speechMode === "paragraph" ? getVoiceParagraphContext(editableProject, selectedClip.id) : undefined}
                projectId={editableProject.project_id}
                voiceContext={getVoiceGenerationContext(editableProject, selectedClip.id)}
                binaural={editableProject.timeline.mixing.binaural}
                generationControl={generationControl}
                options={voiceOptions} onOptionsChange={handleVoiceOptionsChange}
                catalog={voiceCatalog} catalogError={voiceCatalogError} busy={voiceBusy || singleStoryboardBusy}
                referenceImportBusy={referenceImportBusy} onReferenceImportBusyChange={handleReferenceImportBusyChange}
                onReferenceImported={handleReferenceImported} onReferenceCatalogRefresh={handleReferenceCatalogRefresh}
                selectedClip={selectedClip} candidates={visibleVoiceCandidates}
                onAdopt={handleAdoptVoiceCandidate} onDiscard={handleDiscardVoiceCandidate}
                onRegenerateGroup={handleRegenerateVoiceGroup}
                onRecheck={handleRecheckVoiceCandidate} recheckingCandidateId={recheckingCandidateId} onCancelRecheck={() => handleCancelCandidateRecheck()}
                onConfirmText={handleConfirmParagraphText} confirmingCandidateId={confirmingCandidateId} onCancelConfirmation={() => handleCancelCandidateRecheck()}
                onUndo={handleUndoVoiceCandidate}
                canUndo={canUndoLastAudioCandidate({ ...projectLibrary, projects: projectLibrary.projects.map((entry) =>
                  entry.projectId === editableProject.project_id ? { ...entry, project: editableProject } : entry,
                ) })}
                hasUndo={Boolean(currentLibraryEntry && getLastAudioCandidateAcceptance({ ...currentLibraryEntry, project: editableProject }))}
                error={voiceError} loading={candidatesLoading}
              />
            ) : undefined}
            fieldValidationIssues={selectedClipValidationIssues}
            selectedClip={displaySelectedClip}
            selectedClipGeneration={referenceImportBusy || recheckingCandidateId || confirmingCandidateId ? { ...generationView.selectedClipControl, disabled: true, disabledReason: confirmingCandidateId ? "正在保存试听确认" : recheckingCandidateId ? "正在重新识别已保存的原音" : "正在处理参考音频" } : generationView.selectedClipControl}
            selectedClipSlot={previewSummary.selectedClipSlot}
            onApplyDirectorPreset={handleApplyDirectorPreset}
            onGenerateSelectedClip={handleGenerateSelectedClip}
            onCancelSelectedGeneration={handleCancelSelectedGeneration}
            onNudgeClipTiming={handleNudgeClipTiming}
            onUpdateClip={handleUpdateClip}
          />
          </div>
          <div id="clip-inspector-storyboard" role="tabpanel" aria-labelledby="clip-inspector-tab-storyboard" hidden={inspectorView !== "storyboard"} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {inspectorView === "storyboard" && selectedClip?.type === "voice" ? <ClipStoryboardEditor key={`${editableProject.project_id}:${speechMode}:${selectedClip.id}`} project={editableProject} clipId={selectedClip.id} batchBusy={Boolean(batchProgress) || Boolean(recheckingCandidateId) || Boolean(confirmingCandidateId)} referenceModeBusy={voiceBusy || singleStoryboardBusy || Boolean(batchProgress)} onReferenceModeChange={handleStoryboardReferenceModeChange} onBusyChange={handleStoryboardBusyChange} onProviderChange={handleStoryboardProviderChange} onSceneChange={handleVideoSceneChange} onSave={(id, shot) => handleSaveClipStoryboard(id, shot, speechMode)} onEdit={handleEditClipStoryboard} /> : null}
          </div>
        </div>
      </EditorPanels>
      <div className="flex min-h-0 min-w-0 flex-col gap-1">
        <TimelinePanel project={displayProject} selectedClipId={activeClipId} onSelectClip={setSelectedClipId} expanded={timelineExpanded} onExpandedChange={setTimelineExpanded} />
        <details className="relative shrink-0 rounded-md border border-studio-line bg-studio-panel/60 px-3 py-1"><summary className="cursor-pointer text-xs text-studio-muted">情绪与工程检查{validationIssues.length ? ` · ${validationIssues.length} 项待检查` : ""}</summary><div className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-[60dvh] space-y-3 overflow-y-auto rounded-lg border border-studio-line bg-studio-panel p-3 shadow-2xl"><EmotionCurve project={editableProject} /><ValidationPanel issues={validationIssues} /></div></details>
      </div>
      </div>
      </div>
    </ProjectWorkspace>
  );
}
