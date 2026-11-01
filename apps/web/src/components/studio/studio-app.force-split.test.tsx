// @vitest-environment jsdom

import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "@/lib/asmr/audio-candidate";
import type { GenerationBridge, GenerationJobSnapshot, GenerationJobUpdate } from "@/lib/asmr/generation-bridge";
import { demoProject } from "@/lib/asmr/mock-project";
import { createInitialProjectLibrary, getCurrentLibraryEntry, loadProjectLibrary, saveProjectLibrary } from "@/lib/asmr/project-library";
import type { AsmrProject, TimelineClip } from "@/lib/asmr/schema";
import { captureSpeechWorkspace, ensureSpeechWorkspaces, getSpeechWorkspaceProject, switchSpeechWorkspace } from "@/lib/asmr/speech-workspace";
import { flattenClips } from "@/lib/asmr/view-model";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import { getVoiceGenerationContext } from "@/lib/asmr/voice-generation-context";
import { getVoiceParagraphContext } from "@/lib/asmr/voice-paragraph-context";
import type { SelectedClipGenerationControl } from "@/lib/asmr/generation-view";
import { StudioApp } from "./studio-app";

const bridgeFactory = vi.hoisted(() => vi.fn());
const inspector = vi.hoisted(() => ({ generate: undefined as (() => void) | undefined }));
const editor = vi.hoisted(() => ({ update: undefined as ((id: string, updates: Partial<TimelineClip>) => void) | undefined }));
vi.mock("@/lib/asmr/local-generation-bridge", () => ({ createLocalGenerationBridge: bridgeFactory }));
vi.mock("./project-workspace", () => ({ ProjectWorkspace: ({ children, project, onCreateProject }: {
  children: ReactNode; project: AsmrProject; onCreateProject: () => void;
}) => <div><output data-testid="project">{JSON.stringify(project)}</output><button onClick={onCreateProject}>测试新建项目</button>{children}</div> }));
vi.mock("./planner-panel", () => ({ PlannerPanel: () => null }));
vi.mock("./clip-inspector", () => ({ ClipInspector: ({ voiceGenerationPanel, selectedClipGeneration, onGenerateSelectedClip }: {
  voiceGenerationPanel?: (control: ReactNode) => ReactNode; selectedClipGeneration: SelectedClipGenerationControl; onGenerateSelectedClip: () => void;
}) => { inspector.generate = onGenerateSelectedClip; return voiceGenerationPanel?.(<button disabled={selectedClipGeneration.disabled} onClick={onGenerateSelectedClip}>测试生成音频</button>) ?? null; } }));
vi.mock("./script-editor-panel", () => ({ ScriptEditorPanel: ({ project, onSelectClip, onUpdateClip, batchActions, workspaceTabs, paragraphBody }: {
  project: AsmrProject; onSelectClip: (id: string) => void; onUpdateClip: (id: string, updates: Partial<TimelineClip>) => void;
  batchActions: ReactNode; workspaceTabs?: ReactNode; paragraphBody?: ReactNode;
}) => { editor.update = onUpdateClip; return <div>{workspaceTabs}{paragraphBody}{batchActions}{flattenClips(project).filter(clip => clip.type === "voice").map((clip, index) => <button key={clip.id} onClick={() => onSelectClip(clip.id)}>测试选择第{index + 1}段</button>)}</div>; } }));
vi.mock("./timeline-panel", () => ({ TimelinePanel: () => null }));
vi.mock("./validation-panel", () => ({ ValidationPanel: () => null }));
vi.mock("./emotion-curve", () => ({ EmotionCurve: () => null }));
vi.mock("./editor-panels", () => ({ EditorPanels: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const catalog = { providers: [{ id: "voxcpm2", label: "VoxCPM2", available: true, defaultReferenceId: "soft_zh",
  references: [{ id: "soft_zh", label: "原参考声音", referenceModes: ["with_reference_text"] }], longText: { available: true, apiConfigured: true } }] };

function fixture(mode: "short" | "paragraph" = "short") {
  const base = structuredClone(demoProject);
  base.project_id = "force_split_project"; base.duration = 5;
  base.emotion_curve = [{ start: 0, end: 5, emotion: "gentle" }];
  base.timeline.tracks = base.timeline.tracks.map(track => track.track_type === "voice" ? { ...track,
    clips: track.clips.slice(0, 2).map((clip, index) => ({ ...clip, text: index ? "先坐。" : "回来啦。", start: index ? 3 : 0, duration: index ? 2 : 3,
      pause_after: 0, semantic_unit: true, asset: { asset_id: "keep_" + index, uri: "asset://clip/keep_" + index, duration: index ? 2 : 3 },
      generation: { ...clip.generation, status: "asset_generated" as const } })) } : { ...track, clips: [] });
  const initialized = ensureSpeechWorkspaces(base);
  initialized.speechWorkspace!.groups = [{ id: "force_group", clipIds: initialized.speechWorkspace!.short.clips.map(clip => clip.id) }];
  const project = switchSpeechWorkspace(captureSpeechWorkspace(getSpeechWorkspaceProject(initialized, mode)), mode);
  const voice = flattenClips(project).find(clip => clip.type === "voice")!;
  if (voice.type !== "voice") throw new Error("Voice fixture required");
  const context = mode === "short" ? getVoiceGenerationContext(project, voice.id) : undefined;
  const paragraphContext = mode === "paragraph" ? getVoiceParagraphContext(project, voice.id)! : undefined;
  const recognition = { analysisMode: "cutting_only" as const, stage: "boundary_check" as const, expectedText: voice.text,
    followingText: "先坐。", sourceTranscript: "回来先坐", targetTranscript: "回来",
    alignment: { expected: "回来啦", recognizedPrefix: "回来", reason: "no_verified_quiet_cut" } };
  const asset = { assetId: "source_original", uri: "asset://clip/source_original", duration: 5 };
  const candidate = AudioCandidateSchema.parse(makeVoiceCandidateFixture({ projectId: project.project_id, clipId: voice.id, asset,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(voice, context, paragraphContext),
    provenance: { provider: "voxcpm2", model: "VoxCPM2", seed: 1234, temperature: 1, voicePackId: "soft_zh", referenceMode: "with_reference_text",
      generationMode: mode === "paragraph" ? "paragraph" : "long_text", parameters: {},
      ...(paragraphContext ? { paragraph: { version: 1, groupId: paragraphContext.groupId, text: paragraphContext.text,
        clipIds: paragraphContext.clips.map(item => item.clipId), sourceAsset: asset, checkStatus: "review", segments: [],
        failedClipId: voice.id, diagnosticCode: "no_verified_quiet_cut", failureRecognition: recognition } } : {
        longText: { version: 1, analysisProvider: "local", loudnessGainDb: 0, asrModel: "fixture-asr", ...(context ? { context } : {}),
          groups: [{ index: 0, text: voice.text, inputText: voice.text, paddingClauses: [], isFinal: context?.isFinal ?? true, pauseAfter: "medium",
            seed: 1234, parameters: {}, asset, internalPausesMs: [], internalPauseClasses: [], leadingQuietMs: 0, trailingQuietMs: 0,
            transcript: "回来", recognition, coverage: .5, cutStartSeconds: 0, cutEndSeconds: 5, attempts: 1, checkStatus: "review" }], joins: [] } }),
    } }));
  saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
  const options = { provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: mode === "paragraph" ? "paragraph" : "long_text", analysisProvider: "local" };
  window.localStorage.setItem(mode === "paragraph" ? "ai-asmr-studio:v1:voice-options-paragraph" : "ai-asmr-studio:v1:voice-options", JSON.stringify(options));
  return { project, candidate, voice, paragraphContext };
}

function forced(candidate: AudioCandidate, project: AsmrProject, id = "forced_candidate"): AudioCandidate {
  const result = structuredClone(candidate); result.candidateId = id;
  const paragraph = result.provenance.paragraph;
  const previousRecognition = paragraph?.failureRecognition ?? result.provenance.longText!.groups[0].recognition;
  const asset = { assetId: id + "_audio", uri: "asset://clip/" + id + "_audio", duration: 3 };
  result.asset = asset;
  if (paragraph) {
    const context = getVoiceParagraphContext(project, candidate.clipId)!;
    paragraph.checkStatus = "passed"; delete paragraph.failedClipId; delete paragraph.failureRecognition;
    paragraph.segments = context.clips.map((clip, index) => ({ clipId: clip.clipId, text: clip.text, cutStartSeconds: index ? 3 : 0, cutEndSeconds: index ? 5 : 3,
      asset: index ? { assetId: id + "_second", uri: "asset://clip/" + id + "_second", duration: 2 } : asset }));
  } else {
    const group = result.provenance.longText!.groups[0];
    group.asset = asset; group.cutEndSeconds = 3; group.checkStatus = "passed"; group.segmentationMethod = "ctc_forced"; group.internalPausePositions = [];
  }
  result.provenance.forcedSegmentation = { version: 1, method: "ctc_forced", sourceCandidateId: candidate.candidateId,
    createdAt: "2026-10-21T04:00:00.000Z", contentVerified: false, alignments: [{
      method: "ctc_forced", mode: paragraph ? "paragraph" : "prefix", groupIndex: 0, sourceAssetId: "source_original",
      sourceSha256: "a".repeat(64), inputTextSha256: "b".repeat(64), sampleRate: 48_000, sourceFrames: 240_000,
      contentVerified: false, previousRecognition, modelId: "fixture-ctc", modelRevision: "fixture-revision", cutFrames: [144_000],
      characters: [{ char: "回", startSeconds: .1, endSeconds: .2, score: .00001 }],
    }] };
  return AudioCandidateSchema.parse(result);
}

function candidateForSecondClip(candidate: AudioCandidate, project: AsmrProject): AudioCandidate {
  const clip = flattenClips(project).filter(item => item.type === "voice")[1];
  if (clip.type !== "voice") throw new Error("Voice fixture required");
  const result = structuredClone(candidate);
  result.candidateId = "second_source"; result.clipId = clip.id;
  const context = getVoiceGenerationContext(project, clip.id);
  result.sourceFingerprint = getVoiceCandidateSourceFingerprint(clip, context);
  result.provenance.longText!.context = context;
  Object.assign(result.provenance.longText!.groups[0], { text: clip.text, inputText: clip.text, isFinal: context?.isFinal ?? true });
  return AudioCandidateSchema.parse(result);
}

function generationBridge() {
  let onUpdate: ((update: GenerationJobUpdate) => void) | undefined;
  let job: GenerationJobSnapshot | undefined;
  const bridge: GenerationBridge = {
    generateClip: vi.fn(async (request, update) => {
      onUpdate = update;
      job = { jobId: "generation_job", clipId: request.clipId, target: { type: "clip", clipId: request.clipId },
        status: "generating", progress: .1, createdAt: "2026-10-29T00:00:00.000Z", updatedAt: "2026-10-29T00:00:00.000Z" };
      update({ type: "snapshot", job });
      return { jobId: job.jobId };
    }),
    generateProjectMix: vi.fn(), cancelGeneration: vi.fn(),
  };
  bridgeFactory.mockReturnValue(bridge);
  return { bridge,
    fail: () => onUpdate!({ type: "failed", job: { ...job!, status: "failed" }, error: "测试生成失败" }),
    finish: (candidate: AudioCandidate) => onUpdate!({ type: "candidate", job: { ...job!, status: "succeeded", progress: 1 }, candidate }),
  };
}

type ForcePost = { url: string; body: { project: AsmrProject; clipId: string }; signal?: AbortSignal | null;
  resolve: (response: Response) => void; reject: (reason?: unknown) => void };
function api(candidate: AudioCandidate, initial = [candidate], deferList = false) {
  const posts: ForcePost[] = []; let candidates = initial;
  let releaseList: (() => void) | undefined;
  const listReady = deferList ? new Promise<void>(resolve => { releaseList = resolve; }) : Promise.resolve();
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/generation/clip" && init?.method !== "POST") return Response.json(catalog);
    if (url.startsWith("/api/audio-candidates?")) {
      await listReady;
      const query = new URL(url, "http://localhost").searchParams;
      return Response.json({ candidates: query.get("projectId") === candidate.projectId
        && query.get("workspaceMode") === (candidate.provenance.generationMode === "paragraph" ? "paragraph" : "short") ? candidates : [] });
    }
    if (url.startsWith("/api/audio-candidates/") && !init?.method) {
      const id = url.split("/").at(-1)!.split("?")[0]; return Response.json({ candidate: candidates.find(item => item.candidateId === id) });
    }
    if (url.endsWith("/force-split") && init?.method === "POST") return await new Promise<Response>((resolve, reject) => {
      posts.push({ url, body: JSON.parse(String(init.body)), signal: init.signal, resolve, reject });
    });
    if (url.startsWith("/api/voice-generation-recordings?")) return Response.json({ recordings: [], nextCursor: null });
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [10], duration: 3, sampleRate: 48000, channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    throw new Error("Unexpected force-split request: " + url);
  });
  vi.stubGlobal("fetch", fetcher);
  return { posts, fetcher, releaseList: () => releaseList?.(), setCandidates: (next: AudioCandidate[]) => { candidates = next; },
    complete: async (result: AudioCandidate, index = posts.length - 1) => {
    candidates = [result, ...candidates.filter(item => item.candidateId !== result.candidateId)];
    await act(async () => posts[index].resolve(Response.json({ candidate: result })));
  } };
}
function current(): AsmrProject { return JSON.parse(screen.getByTestId("project").textContent!); }
async function mount(project: AsmrProject, automatic = true) {
  const view = render(<StrictMode><StudioApp project={project} /></StrictMode>);
  await waitFor(() => expect(screen.getByRole("button", { name: "测试生成音频" })).toBeTruthy());
  if (automatic) await waitFor(() => expect(screen.getByRole("button", { name: "强制切分候选 1" }).textContent).toBe("强制切分中…"));
  else await act(async () => {});
  return view;
}
function start() { fireEvent.click(screen.getByRole("button", { name: "强制切分候选 1" })); }
function noGeneration(mock: ReturnType<typeof api>) {
  expect(bridgeFactory).not.toHaveBeenCalled();
  expect(mock.fetcher.mock.calls.some(([input, init]) => init?.method === "POST" && !String(input).endsWith("/force-split"))).toBe(false);
}
beforeEach(() => {
  window.localStorage.clear(); bridgeFactory.mockReset(); vi.stubEnv("NEXT_PUBLIC_ASMR_GENERATION_MODE", "local");
  const bridge: GenerationBridge = { generateClip: vi.fn(), generateProjectMix: vi.fn(), cancelGeneration: vi.fn() };
  bridgeFactory.mockReturnValue(bridge);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("StudioApp automatic force splitting of failed saved candidates", () => {
  it("serializes eligible candidates across clips while preserving the selected clip and adopted audio", async () => {
    const { project, candidate } = fixture();
    const second = candidateForSecondClip(candidate, project);
    const mock = api(candidate, [candidate, second]); await mount(project);
    expect(mock.posts).toHaveLength(1);
    expect(mock.posts[0].body.clipId).toBe(candidate.clipId);
    await mock.complete(forced(candidate, project, "first_forced"));
    await waitFor(() => expect(mock.posts).toHaveLength(2));
    expect(mock.posts[1].body.clipId).toBe(second.clipId);
    expect(mock.posts[1].url).toBe("/api/audio-candidates/second_source/force-split");
    expect(screen.getByRole("article", { name: "候选 1" }).textContent).toContain("已强制切分，待试听");
    await mock.complete(forced(second, project, "second_forced"));
    await act(async () => {});
    expect(mock.posts).toHaveLength(2);
    expect(current()).toEqual(project);
    fireEvent.click(screen.getByRole("button", { name: "测试选择第2段" }));
    expect(screen.getByText("已强制切分，待试听")).toBeTruthy();
    noGeneration(mock);
  });

  it("continues to another eligible clip after a failure without retrying the failed source", async () => {
    const { project, candidate } = fixture(); const second = candidateForSecondClip(candidate, project);
    const mock = api(candidate, [candidate, second]); await mount(project);
    await act(async () => mock.posts[0].reject(new TypeError("Failed to fetch")));
    await waitFor(() => expect(mock.posts).toHaveLength(2));
    expect(mock.posts[1].body.clipId).toBe(second.clipId);
    await mock.complete(forced(second, project, "second_forced"));
    await act(async () => {});
    expect(mock.posts).toHaveLength(2);
    expect(current()).toEqual(project); noGeneration(mock);
  });

  it("skips a saved original that already has a forced result, including after workspace refresh", async () => {
    const { project, candidate } = fixture(); const result = forced(candidate, project);
    const mock = api(candidate, [result, candidate]); await mount(project, false);
    await waitFor(() => expect(screen.getByText("已强制切分，待试听")).toBeTruthy());
    expect(mock.posts).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("tab", { name: "短句" }));
    await act(async () => {});
    await waitFor(() => expect(screen.getByText("已强制切分，待试听")).toBeTruthy());
    expect(mock.posts).toHaveLength(0); noGeneration(mock);
  });

  it.each(["stale", "passed", "discarded", "foreign_project", "foreign_workspace", "forced"])("does not automatically process a %s candidate", async kind => {
    const { project, candidate } = fixture();
    let saved = structuredClone(candidate);
    if (kind === "stale") saved.sourceFingerprint = "outdated_copy";
    if (kind === "passed") saved.provenance.longText!.groups[0].checkStatus = "passed";
    if (kind === "discarded") saved.status = "discarded";
    if (kind === "foreign_project") saved.projectId = "different_project";
    if (kind === "foreign_workspace") {
      saved = fixture("paragraph").candidate;
      saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
    }
    if (kind === "forced") saved = forced(candidate, project);
    const mock = api(candidate, [saved]); await mount(project, false);
    await waitFor(() => expect((screen.getByRole("button", { name: "测试生成音频" }) as HTMLButtonElement).disabled).toBe(false));
    expect(mock.posts).toHaveLength(0); expect(current()).toEqual(project); noGeneration(mock);
  });

  it("also processes an adopted review source without replacing the adopted audio", async () => {
    const { project, candidate, voice } = fixture();
    voice.asset = { asset_id: candidate.asset.assetId, uri: candidate.asset.uri, duration: candidate.asset.duration };
    saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
    const mock = api(candidate); await mount(project);
    expect(mock.posts).toHaveLength(1);
    await mock.complete(forced(candidate, project));
    expect(flattenClips(current()).find(clip => clip.id === voice.id)?.asset.asset_id).toBe(candidate.asset.assetId);
    noGeneration(mock);
  });

  it("waits for an active generation to finish before splitting newly loaded candidates", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate, [candidate], true);
    const generation = generationBridge(); await mount(project, false);
    await waitFor(() => expect((screen.getByRole("button", { name: "测试生成音频" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "测试生成音频" }));
    await waitFor(() => expect(generation.bridge.generateClip).toHaveBeenCalledTimes(1));
    await act(async () => mock.releaseList());
    expect(mock.posts).toHaveLength(0);
    await act(async () => generation.fail());
    await waitFor(() => expect(mock.posts).toHaveLength(1));
    await mock.complete(forced(candidate, project));
    expect(generation.bridge.generateClip).toHaveBeenCalledTimes(1);
  });

  it("automatically splits a new review candidate after generation refreshes the list", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate, []);
    const generation = generationBridge(); await mount(project, false);
    await waitFor(() => expect((screen.getByRole("button", { name: "测试生成音频" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "测试生成音频" }));
    await waitFor(() => expect(generation.bridge.generateClip).toHaveBeenCalledTimes(1));
    expect(mock.posts).toHaveLength(0);
    mock.setCandidates([candidate]);
    await act(async () => generation.finish(candidate));
    await waitFor(() => expect(mock.posts).toHaveLength(1));
    await mock.complete(forced(candidate, project));
    expect(current()).toEqual(project);
    expect(generation.bridge.generateClip).toHaveBeenCalledTimes(1);
  });

  it("does not automatically retry a canceled candidate after reloading its workspace, while manual retry remains available", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "取消强制切分" }));
    fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("tab", { name: "短句" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "强制切分候选 1" }) as HTMLButtonElement).disabled).toBe(false));
    expect(mock.posts).toHaveLength(1);
    start(); expect(mock.posts).toHaveLength(2);
    await mock.complete(forced(candidate, project), 1);
    expect(screen.getByText("已强制切分，待试听")).toBeTruthy();
    noGeneration(mock);
  });

  it.each(["short", "paragraph"] as const)("creates a %s forced candidate without TTS or automatic adoption and keeps original evidence", async mode => {
    const { project, candidate } = fixture(mode); const original = JSON.stringify(candidate); const mock = api(candidate); await mount(project);
    expect(screen.queryByRole("checkbox")).toBeNull(); expect(screen.queryByRole("dialog")).toBeNull();
    expect(mock.posts).toHaveLength(1);
    expect(mock.posts[0].url).toBe("/api/audio-candidates/" + candidate.candidateId + "/force-split");
    expect(mock.posts[0].body).toEqual({ project, clipId: candidate.clipId });
    expect(screen.getByRole("button", { name: "强制切分候选 1" }).textContent).toBe("强制切分中…");
    expect((screen.getByRole("button", { name: "测试生成音频" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => inspector.generate?.()); start(); expect(mock.posts).toHaveLength(1);
    const result = forced(candidate, project); await mock.complete(result);
    await waitFor(() => expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(2));
    expect(current()).toEqual(project);
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).toEqual(project);
    expect(screen.getByText("已强制切分，待试听")).toBeTruthy();
    const item = screen.getByRole("article", { name: "候选 1" });
    expect(within(item).queryByRole("button", { name: /强制切分/ })).toBeNull();
    expect(JSON.stringify(candidate)).toBe(original);
    if (mode === "paragraph") {
      expect(within(item).getByRole("link", { name: "下载整段原音" })).toBeTruthy();
      expect(within(item).getByLabelText("强制切分前识别记录").textContent).toContain("回来先坐");
    } else expect(within(item).getByText("回来先坐")).toBeTruthy();
    fireEvent.click(within(item).getByRole("button", { name: "采用候选 1" }));
    await waitFor(() => expect(flattenClips(current()).find(clip => clip.id === candidate.clipId)?.asset.asset_id).toBe(result.asset.assetId));
    noGeneration(mock);
  });

  it.each(["network", "http", "json", "unmarked", "wrong_source", "wrong_project", "same_id", "review"])("retains the original and releases busy state after a %s failure", async kind => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    await act(async () => {
      if (kind === "network") { mock.posts[0].reject(new TypeError("Failed to fetch")); return; }
      if (kind === "http") { mock.posts[0].resolve(Response.json({ error: "原音已变化，请刷新候选。" }, { status: 409 })); return; }
      if (kind === "json") { mock.posts[0].resolve(new Response("invalid")); return; }
      const result = forced(candidate, project);
      if (kind === "unmarked") { delete result.provenance.forcedSegmentation; delete result.provenance.longText!.groups[0].segmentationMethod; }
      if (kind === "wrong_source") result.provenance.forcedSegmentation!.sourceCandidateId = "foreign_candidate";
      if (kind === "wrong_project") result.projectId = "foreign_project";
      if (kind === "same_id") result.candidateId = candidate.candidateId;
      if (kind === "review") result.provenance.longText!.groups[0].checkStatus = "review";
      mock.posts[0].resolve(Response.json({ candidate: result }));
    });
    await waitFor(() => expect((screen.getByRole("button", { name: "强制切分候选 1" }) as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {});
    expect(mock.posts).toHaveLength(1);
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(1); expect(current()).toEqual(project);
    expect(screen.getByLabelText("候选 1 试听").getAttribute("src")).toContain("source_original"); noGeneration(mock);
  });

  it.each(["target", "following"])("rejects a response after the %s copy changes", async kind => {
    const { project, candidate, voice } = fixture(); const mock = api(candidate); await mount(project);
    const id = kind === "target" ? voice.id : flattenClips(project).filter(clip => clip.type === "voice")[1].id;
    act(() => editor.update?.(id, { text: "修改后的文稿。" }));
    await mock.complete(forced(candidate, project));
    expect(screen.queryByText("已强制切分，待试听")).toBeNull();
    expect(flattenClips(current()).find(clip => clip.id === candidate.clipId)?.asset.asset_id).toBe("keep_0"); noGeneration(mock);
  });

  it.each(["cancel", "workspace", "project", "unmount"])("aborts and ignores late success after %s", async kind => {
    const { project, candidate } = fixture(); const mock = api(candidate); const view = await mount(project);
    if (kind === "cancel") fireEvent.click(screen.getByRole("button", { name: "取消强制切分" }));
    if (kind === "workspace") fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    if (kind === "project") fireEvent.click(screen.getByRole("button", { name: "测试新建项目" }));
    if (kind === "unmount") view.unmount();
    expect(mock.posts[0].signal?.aborted).toBe(true);
    const before = kind === "unmount" ? undefined : current();
    await mock.complete(forced(candidate, project));
    if (kind !== "unmount") expect(current()).toEqual(before);
    expect(mock.posts).toHaveLength(1);
    noGeneration(mock);
  });

  it("keeps automatic work running when selecting another clip and retains its result on the original clip", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "测试选择第2段" }));
    expect(mock.posts[0].signal?.aborted).toBe(false);
    await mock.complete(forced(candidate, project));
    expect(screen.queryByText("已强制切分，待试听")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "测试选择第1段" }));
    expect(screen.getByText("已强制切分，待试听")).toBeTruthy();
    expect(current()).toEqual(project); noGeneration(mock);
  });

  it("pauses the remaining automatic queue after explicit cancel and resumes it after a manual retry", async () => {
    const { project, candidate } = fixture(); const second = candidateForSecondClip(candidate, project);
    const mock = api(candidate, [candidate, second]); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "取消强制切分" }));
    await act(async () => {});
    expect(mock.posts).toHaveLength(1);
    start(); expect(mock.posts).toHaveLength(2);
    await mock.complete(forced(candidate, project), 1);
    await waitFor(() => expect(mock.posts).toHaveLength(3));
    expect(mock.posts[2].body.clipId).toBe(second.clipId);
    await mock.complete(forced(second, project, "second_forced"), 2);
    expect(current()).toEqual(project); noGeneration(mock);
  });

  it("keeps a newer force request protected from an old canceled response", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "取消强制切分" })); start();
    expect(mock.posts).toHaveLength(2);
    await mock.complete(forced(candidate, project, "late_old"), 0);
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "强制切分候选 1" }).textContent).toBe("强制切分中…");
    expect(mock.posts[1].signal?.aborted).toBe(false);
    await mock.complete(forced(candidate, project, "new_current"), 1);
    await waitFor(() => expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(2));
    expect(current()).toEqual(project); noGeneration(mock);
  });
});
