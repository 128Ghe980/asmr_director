// @vitest-environment jsdom

import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "@/lib/asmr/audio-candidate";
import type { GenerationBridge } from "@/lib/asmr/generation-bridge";
import { demoProject } from "@/lib/asmr/mock-project";
import { createInitialProjectLibrary, getCurrentLibraryEntry, loadProjectLibrary, saveProjectLibrary } from "@/lib/asmr/project-library";
import type { AsmrProject, TimelineClip } from "@/lib/asmr/schema";
import { captureSpeechWorkspace, ensureSpeechWorkspaces, getSpeechWorkspaceProject, switchSpeechWorkspace } from "@/lib/asmr/speech-workspace";
import { flattenClips } from "@/lib/asmr/view-model";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import { getVoiceParagraphContext } from "@/lib/asmr/voice-paragraph-context";
import type { SelectedClipGenerationControl } from "@/lib/asmr/generation-view";
import { StudioApp } from "./studio-app";

const bridgeFactory = vi.hoisted(() => vi.fn());
const editor = vi.hoisted(() => ({ update: undefined as ((id: string, updates: Partial<TimelineClip>) => void) | undefined }));
vi.mock("@/lib/asmr/local-generation-bridge", () => ({ createLocalGenerationBridge: bridgeFactory }));
vi.mock("./project-workspace", () => ({ ProjectWorkspace: ({ children, project, onCreateProject }: {
  children: ReactNode; project: AsmrProject; onCreateProject: () => void;
}) => <div><output data-testid="project">{JSON.stringify(project)}</output><button onClick={onCreateProject}>测试新建项目</button>{children}</div> }));
vi.mock("./planner-panel", () => ({ PlannerPanel: () => null }));
vi.mock("./clip-inspector", () => ({ ClipInspector: ({ voiceGenerationPanel, selectedClipGeneration, onGenerateSelectedClip }: {
  voiceGenerationPanel?: (control: ReactNode) => ReactNode; selectedClipGeneration: SelectedClipGenerationControl; onGenerateSelectedClip: () => void;
}) => voiceGenerationPanel?.(<button disabled={selectedClipGeneration.disabled} onClick={onGenerateSelectedClip}>测试生成音频</button>) ?? null }));
vi.mock("./script-editor-panel", () => ({ ScriptEditorPanel: ({ onUpdateClip, workspaceTabs, paragraphBody }: {
  onUpdateClip: (id: string, updates: Partial<TimelineClip>) => void; workspaceTabs?: ReactNode; paragraphBody?: ReactNode;
}) => {
  editor.update = onUpdateClip; return <div>{workspaceTabs}{paragraphBody}</div>;
} }));
vi.mock("./timeline-panel", () => ({ TimelinePanel: () => null }));
vi.mock("./validation-panel", () => ({ ValidationPanel: () => null }));
vi.mock("./editor-panels", () => ({ EditorPanels: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const options = { provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "paragraph", analysisProvider: "local" } as const;
const catalog = { providers: [{ id: "voxcpm2", label: "VoxCPM2", available: true, defaultReferenceId: "soft_zh",
  references: [{ id: "soft_zh", label: "原参考声音", referenceModes: ["with_reference_text"] }], longText: { available: true, apiConfigured: true } }] };

function fixture() {
  const base = structuredClone(demoProject);
  base.project_id = "manual_confirmation_project";
  base.duration = 5;
  base.emotion_curve = [{ start: 0, end: 5, emotion: "gentle" }];
  base.timeline.tracks = base.timeline.tracks.map((track) => track.track_type === "voice" ? { ...track,
    clips: track.clips.slice(0, 2).map((clip, index) => ({ ...clip, text: index ? "先坐。" : "回来啦。", start: index ? 3 : 0, duration: index ? 2 : 3, pause_after: 0,
      asset: { asset_id: `short_keep_${index}`, uri: `asset://clip/short_keep_${index}`, duration: index ? 2 : 3 },
      generation: { ...clip.generation, status: "asset_generated" as const } })) } : { ...track, clips: [] });
  const initialized = ensureSpeechWorkspaces(base);
  initialized.speechWorkspace!.groups = [{ id: "manual_group", clipIds: initialized.speechWorkspace!.short.clips.map((clip) => clip.id) }];
  const paragraphProject = getSpeechWorkspaceProject(initialized, "paragraph");
  flattenClips(paragraphProject).filter((clip) => clip.type === "voice").forEach((clip, index) => {
    clip.asset = { asset_id: `paragraph_keep_${index}`, uri: `asset://clip/paragraph_keep_${index}`, duration: index ? 2 : 3 };
    clip.generation.status = "asset_generated";
  });
  const project = switchSpeechWorkspace(captureSpeechWorkspace(paragraphProject), "paragraph");
  const voice = flattenClips(project).find((clip) => clip.type === "voice")!;
  if (voice.type !== "voice") throw new Error("Voice fixture required");
  const context = getVoiceParagraphContext(project, voice.id)!;
  const textReview = { status: "needs_confirmation" as const, reason: "missing_final_particle" as const, expected: "回来啦", sourcePrefix: "回来了",
    expectedPinyin: "la5" as const, sourcePinyin: "le5" as const, similarity: 2 / 3,
    left: { transcript: "回来", words: [{ text: "回来", start: .1, end: 1 }], durationSeconds: 3 },
    right: { transcript: "先坐", words: [{ text: "先坐", start: .1, end: 1 }], durationSeconds: 2 },
    final: { transcript: "回来", words: [{ text: "回来", start: .1, end: 1 }], durationSeconds: 3 } };
  const candidate = AudioCandidateSchema.parse(makeVoiceCandidateFixture({ projectId: project.project_id, clipId: voice.id,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(voice, undefined, context), asset: { assetId: "review_first", uri: "asset://clip/review_first", duration: 3 },
    provenance: { provider: "voxcpm2", model: "VoxCPM2", seed: 1234, temperature: 1, voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "paragraph", parameters: {},
      paragraph: { version: 1, groupId: context.groupId, text: context.text, clipIds: context.clips.map((item) => item.clipId), checkStatus: "needs_confirmation",
        sourceAsset: { assetId: "source_original", uri: "asset://clip/source_original", duration: 5 }, segments: context.clips.map((item, index) => ({ clipId: item.clipId, text: item.text,
          asset: { assetId: index ? "review_second" : "review_first", uri: `asset://clip/${index ? "review_second" : "review_first"}`, duration: index ? 2 : 3 },
          cutStartSeconds: index ? 3 : 0, cutEndSeconds: index ? 5 : 3,
          recognition: { stage: "complete", expectedText: item.text, ...(index ? {} : { followingText: context.clips[1].text, shortSentenceReview: textReview }),
            sourceTranscript: index ? "先坐" : "回来了先坐", targetTranscript: index ? "先坐" : "回来",
            sourceWords: index ? [{ text: "先坐", start: .1, end: 1 }] : [{ text: "回来了", start: .1, end: 1 }, { text: "先坐", start: 3.1, end: 4 }] }, ...(index ? {} : { textReview }) })) } } }));
  saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
  window.localStorage.setItem("ai-asmr-studio:v1:voice-options-paragraph", JSON.stringify(options));
  return { project, candidate };
}

type ConfirmationPost = { url: string; body: { project: AsmrProject; clipId: string; confirmedClipIds: string[] }; signal?: AbortSignal | null;
  resolve: (response: Response) => void; reject: (reason?: unknown) => void };
function api(candidate: AudioCandidate) {
  const posts: ConfirmationPost[] = [];
  let savedCandidates = [candidate];
  const project = getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, demoProject)).project;
  const context = getVoiceParagraphContext(project, candidate.clipId)!;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/generation/clip" && init?.method !== "POST") return Response.json(catalog);
    if (url.startsWith("/api/audio-candidates?")) {
      const query = new URL(url, "http://localhost").searchParams;
      return Response.json({ candidates: query.get("projectId") === candidate.projectId && query.get("workspaceMode") === "paragraph" ? savedCandidates : [] });
    }
    if (url.startsWith("/api/voice-generation-recordings?")) return Response.json({ recordings: [], nextCursor: null });
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [10], duration: 3, sampleRate: 48000, channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    if (url.endsWith("/confirm-text") && init?.method === "POST") return await new Promise<Response>((resolve, reject) => {
      posts.push({ url, body: JSON.parse(String(init.body)), signal: init.signal, resolve, reject });
    });
    throw new Error(`Unexpected manual confirmation request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  const confirmed = () => AudioCandidateSchema.parse({ ...candidate, provenance: { ...candidate.provenance, paragraph: { ...candidate.provenance.paragraph!,
    manualTextConfirmation: { sourceCandidateId: candidate.candidateId, confirmedClipIds: [candidate.clipId], confirmedAt: "2026-10-14T13:45:00.000Z" } } } });
  const confirmedCandidates = () => candidate.provenance.paragraph!.segments.map((segment, index) => {
    const member = flattenClips(project).find((clip) => clip.id === segment.clipId)!;
    return AudioCandidateSchema.parse({ ...confirmed(), candidateId: index ? `${candidate.candidateId}_${index}` : candidate.candidateId, clipId: segment.clipId,
      sourceFingerprint: getVoiceCandidateSourceFingerprint(member, undefined, context), asset: segment.asset });
  });
  return { posts, fetcher, confirmed, confirmedCandidates, publish: () => { savedCandidates = confirmedCandidates(); } };
}
function current(): AsmrProject { return JSON.parse(screen.getByTestId("project").textContent!); }
async function mount(project: AsmrProject) {
  const view = render(<StrictMode><StudioApp project={project} /></StrictMode>);
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "候选 1 短句 1 已听且台词完整" })).toBeTruthy());
  return view;
}
function start() {
  fireEvent.click(screen.getByRole("checkbox", { name: "候选 1 短句 1 已听且台词完整" }));
  fireEvent.click(screen.getByRole("button", { name: "确认并采用候选 1" }));
}
beforeEach(() => {
  window.localStorage.clear(); bridgeFactory.mockReset(); vi.stubEnv("NEXT_PUBLIC_ASMR_GENERATION_MODE", "local");
  const bridge: GenerationBridge = { generateClip: vi.fn(), generateProjectMix: vi.fn(), cancelGeneration: vi.fn() };
  bridgeFactory.mockReturnValue(bridge);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("StudioApp manual paragraph text confirmation", () => {
  it("posts explicit ordered review IDs and persists whole-paragraph adoption while preserving short audio and ASR", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    expect((screen.getByRole("button", { name: "确认并采用候选 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mock.posts).toHaveLength(0);
    start();
    expect(mock.posts).toHaveLength(1);
    expect(mock.posts[0].url).toBe(`/api/audio-candidates/${candidate.candidateId}/confirm-text`);
    expect(mock.posts[0].body).toEqual({ project, clipId: candidate.clipId, confirmedClipIds: [candidate.clipId] });
    expect((screen.getByRole("button", { name: "测试生成音频" }) as HTMLButtonElement).disabled).toBe(true);
    mock.publish();
    await act(async () => mock.posts[0].resolve(Response.json({ candidate: mock.confirmed(), candidates: mock.confirmedCandidates() })));
    await waitFor(() => expect(current().speechWorkspace!.paragraph.clips[0].asset.asset_id).toBe("review_first"));
    expect(current().speechWorkspace!.paragraph.clips.map((clip) => clip.asset.asset_id)).toEqual(["review_first", "review_second"]);
    expect(current().speechWorkspace!.short.clips.map((clip) => clip.asset.asset_id)).toEqual(["short_keep_0", "short_keep_1"]);
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).toEqual(current());
    expect(screen.getByText("整段切分 · 台词已试听确认")).toBeTruthy();
    expect(screen.getByText("短句识别（已试听确认）").nextElementSibling?.textContent).toBe("回来");
    expect(candidate.provenance.paragraph!.manualTextConfirmation).toBeUndefined();
    expect(bridgeFactory).not.toHaveBeenCalled();
    expect(mock.fetcher.mock.calls.some(([input, init]) => String(input) === "/api/generation/clip" && init?.method === "POST")).toBe(false);
  });

  it("retains the audible project if confirmation rejects or fails to connect", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project); start();
    await act(async () => mock.posts[0].resolve(Response.json({ error: "原音或切片已变化，请重新识别。" }, { status: 409 })));
    expect(screen.getByText("原音或切片已变化，请重新识别。")).toBeTruthy();
    expect(current()).toEqual(project);
    fireEvent.click(screen.getByRole("button", { name: "确认并采用候选 1" }));
    await act(async () => mock.posts[1].reject(new TypeError("Failed to fetch")));
    expect(screen.getByText("无法连接本地服务，试听确认未能核实；当前人声保持。请刷新候选后重试。")).toBeTruthy();
    expect(current()).toEqual(project);
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it.each(["source", "asset", "evidence", "receipt"])("rejects a %s-mutated confirmation response before adoption", async (kind) => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project); start();
    const response = mock.confirmed();
    if (kind === "source") response.sourceFingerprint = "changed";
    if (kind === "asset") response.asset = { ...response.asset, assetId: "wrong", uri: "asset://clip/wrong" };
    if (kind === "evidence") response.provenance.paragraph!.segments[1].recognition!.sourceTranscript = "修改了原识别";
    if (kind === "receipt") response.provenance.paragraph!.manualTextConfirmation!.sourceCandidateId = "foreign_candidate";
    await act(async () => mock.posts[0].resolve(Response.json({ candidate: response, candidates: [response, ...mock.confirmedCandidates().slice(1)] })));
    expect(screen.getByText("试听确认结果与当前整段不一致，当前人声保持。")).toBeTruthy();
    expect(current()).toEqual(project);
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it.each(["main_only", "duplicate_clip", "sibling_source"])("rejects a %s sibling response before updating candidates or adopting", async (kind) => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project); start();
    let siblings = mock.confirmedCandidates();
    if (kind === "main_only") siblings = [siblings[0]];
    if (kind === "duplicate_clip") siblings[1] = { ...siblings[1], clipId: siblings[0].clipId, asset: siblings[0].asset, sourceFingerprint: siblings[0].sourceFingerprint };
    if (kind === "sibling_source") siblings[1].sourceFingerprint = "foreign_member_source";
    await act(async () => mock.posts[0].resolve(Response.json({ candidate: mock.confirmed(), candidates: siblings })));
    expect(screen.getByText("试听确认结果与当前整段不一致，当前人声保持。")).toBeTruthy();
    expect(screen.queryByText("整段切分 · 台词已试听确认")).toBeNull();
    expect(current()).toEqual(project);
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).toEqual(project);
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it("does not adopt a late confirmation after the paragraph copy changes", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project); start();
    fireEvent.change(screen.getByRole("textbox", { name: "整段 1 文案" }), { target: { value: "回来啦。先喝茶。" } });
    await act(async () => mock.posts[0].resolve(Response.json({ candidate: mock.confirmed() })));
    expect(current().speechWorkspace!.paragraph.clips[0].asset.asset_id).toBe("paragraph_keep_0");
    expect(screen.getByText("工程刚刚有修改，未采用试听确认结果；当前人声保持。")).toBeTruthy();
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it.each(["page", "project", "cancel", "unmount"])("aborts and ignores a late confirmation after %s", async (kind) => {
    const { project, candidate } = fixture(); const mock = api(candidate); const view = await mount(project); start();
    if (kind === "page") fireEvent.click(screen.getByRole("tab", { name: "短句" }));
    if (kind === "project") fireEvent.click(screen.getByRole("button", { name: "测试新建项目" }));
    if (kind === "cancel") fireEvent.click(screen.getByRole("button", { name: "取消试听确认" }));
    if (kind === "unmount") view.unmount();
    expect(mock.posts[0].signal?.aborted).toBe(true);
    const before = kind === "unmount" ? undefined : current();
    await act(async () => mock.posts[0].resolve(Response.json({ candidate: mock.confirmed() })));
    if (kind !== "unmount") expect(current()).toEqual(before);
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it("keeps previous audio when confirmation is saved but local adoption storage fails", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project); start();
    mock.publish();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage full", "QuotaExceededError"); });
    await act(async () => mock.posts[0].resolve(Response.json({ candidate: mock.confirmed(), candidates: mock.confirmedCandidates() })));
    expect(screen.getByText("试听确认已保存，但采用未能保存；当前人声保持。请检查本地存储后重试采用。")).toBeTruthy();
    expect(current()).toEqual(project);
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).toEqual(project);
    expect(screen.getByText("整段切分 · 台词已试听确认")).toBeTruthy();
    expect(bridgeFactory).not.toHaveBeenCalled();
  });
});
