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

type CandidateRead = { url: string; resolve: (response: Response) => void; reject: (reason?: unknown) => void };
function api(candidate: AudioCandidate) {
  const reads: CandidateRead[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/generation/clip" && init?.method !== "POST") return Response.json(catalog);
    if (url.startsWith("/api/audio-candidates?")) {
      const query = new URL(url, "http://localhost").searchParams;
      return Response.json({ candidates: query.get("projectId") === candidate.projectId && query.get("workspaceMode") === "paragraph" ? [candidate] : [] });
    }
    if (url.startsWith("/api/voice-generation-recordings?")) return Response.json({ recordings: [], nextCursor: null });
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [10], duration: 3, sampleRate: 48000, channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    if (url.startsWith("/api/audio-candidates/" + candidate.candidateId + "?") && !init?.method) return await new Promise<Response>((resolve, reject) => {
      reads.push({ url, resolve, reject });
    });
    throw new Error("Unexpected paragraph adoption request: " + url);
  });
  vi.stubGlobal("fetch", fetcher);
  return { reads, fetcher, complete: async (fresh = candidate) => {
    await act(async () => reads.at(-1)!.resolve(Response.json({ candidate: fresh })));
  } };
}
function current(): AsmrProject { return JSON.parse(screen.getByTestId("project").textContent!); }
async function mount(project: AsmrProject) {
  const view = render(<StrictMode><StudioApp project={project} /></StrictMode>);
  await waitFor(() => expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole("checkbox", { name: /已听且台词完整/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /确认并采用/ })).toBeNull();
  return view;
}
function start() { fireEvent.click(screen.getByRole("button", { name: "采用候选 1" })); }
function noConfirmationOrGeneration(mock: ReturnType<typeof api>) {
  expect(mock.fetcher.mock.calls.some(([input]) => String(input).includes("/confirm-text"))).toBe(false);
  expect(mock.fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  expect(bridgeFactory).not.toHaveBeenCalled();
}
beforeEach(() => {
  window.localStorage.clear(); bridgeFactory.mockReset(); vi.stubEnv("NEXT_PUBLIC_ASMR_GENERATION_MODE", "local");
  const bridge: GenerationBridge = { generateClip: vi.fn(), generateProjectMix: vi.fn(), cancelGeneration: vi.fn() };
  bridgeFactory.mockReturnValue(bridge);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("StudioApp ordinary adoption of safely split legacy paragraphs", () => {
  it("adopts all saved slices without text confirmation, preserves short audio and ASR, and supports undo", async () => {
    const { project, candidate } = fixture(); const before = JSON.stringify(candidate); const mock = api(candidate); await mount(project);
    expect(current()).toEqual(project);
    expect(screen.getByLabelText("候选 1 整段完整原音试听").getAttribute("src")).toContain("source_original");
    expect(screen.getByLabelText("候选 1 短句 1 原声试听").getAttribute("src")).toContain("review_first");
    expect(screen.getByText("短句识别（历史）").nextElementSibling?.textContent).toBe("回来");
    start(); expect(mock.reads).toHaveLength(1);
    expect(new URL(mock.reads[0].url, "http://localhost").searchParams.get("projectId")).toBe(project.project_id);
    await mock.complete();
    await waitFor(() => expect(current().speechWorkspace!.paragraph.clips.map(clip => clip.asset.asset_id)).toEqual(["review_first", "review_second"]));
    expect(current().speechWorkspace!.short.clips.map(clip => clip.asset.asset_id)).toEqual(["short_keep_0", "short_keep_1"]);
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).toEqual(current());
    expect(candidate.provenance.paragraph!.manualTextConfirmation).toBeUndefined();
    expect(JSON.stringify(candidate)).toBe(before);
    expect(screen.getByText("短句识别（历史）").nextElementSibling?.textContent).toBe("回来");
    expect(screen.queryByText("历史试听确认记录已保存。")).toBeNull();
    const undo = screen.getByRole("button", { name: "撤回上次采用" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(false); fireEvent.click(undo);
    await waitFor(() => expect(current().speechWorkspace!.paragraph.clips.map(clip => clip.asset.asset_id)).toEqual(["paragraph_keep_0", "paragraph_keep_1"]));
    expect(current().speechWorkspace!.short.clips.map(clip => clip.asset.asset_id)).toEqual(["short_keep_0", "short_keep_1"]);
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).toEqual(current());
    expect(JSON.stringify(candidate)).toBe(before); noConfirmationOrGeneration(mock);
  });

  it("keeps audible and persisted audio if local adoption storage fails, and permits a later retry", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project); start();
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage full", "QuotaExceededError"); });
    await mock.complete();
    expect(screen.getByText("采用未保存，原声已保留。请检查本地存储后重试。")).toBeTruthy();
    expect(current()).toEqual(project);
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).toEqual(project);
    expect(candidate.provenance.paragraph!.manualTextConfirmation).toBeUndefined();
    storage.mockRestore(); start(); await mock.complete();
    await waitFor(() => expect(current().speechWorkspace!.paragraph.clips[0].asset.asset_id).toBe("review_first"));
    noConfirmationOrGeneration(mock);
  });

  it.each(["http", "network"])("keeps the project after a %s revalidation failure", async kind => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project); start();
    await act(async () => {
      if (kind === "http") mock.reads[0].resolve(Response.json({ error: "原音或切片已变化，请重新切分。" }, { status: 409 }));
      else mock.reads[0].reject(new TypeError("Failed to fetch"));
    });
    await waitFor(() => expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(false));
    expect(current()).toEqual(project);
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).toEqual(project);
    noConfirmationOrGeneration(mock);
  });

  it.each(["source", "asset", "review", "discarded"])("rejects a fresh %s candidate without changing the audible project", async kind => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project); start();
    const fresh = structuredClone(candidate);
    if (kind === "source") fresh.sourceFingerprint = "changed";
    if (kind === "asset") fresh.asset = { ...fresh.asset, assetId: "wrong", uri: "asset://clip/wrong" };
    if (kind === "review") { fresh.provenance.paragraph!.checkStatus = "review"; fresh.provenance.paragraph!.segments = []; fresh.asset = fresh.provenance.paragraph!.sourceAsset; }
    if (kind === "discarded") fresh.status = "discarded";
    await mock.complete(fresh);
    await waitFor(() => expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(false));
    expect(current()).toEqual(project);
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).toEqual(project);
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).candidateAcceptances?.paragraph).toBeUndefined();
    noConfirmationOrGeneration(mock);
  });

  it("disables adoption after the paragraph copy changes", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    fireEvent.change(screen.getByRole("textbox", { name: "整段 1 文案" }), { target: { value: "回来啦。先喝茶。" } });
    expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(true);
    start(); expect(mock.reads).toHaveLength(0); noConfirmationOrGeneration(mock);
  });

  it("blocks duplicate adoption and actual generation during fresh-candidate revalidation", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project); start();
    expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "测试生成音频" }));
    expect(screen.queryByRole("button", { name: "重新切分候选 1" })).toBeNull();
    start(); expect(mock.reads).toHaveLength(1); expect(current()).toEqual(project);
    await mock.complete(); noConfirmationOrGeneration(mock);
  });

  it("keeps unsplit review audio available while preventing ordinary slice adoption", async () => {
    const { project, candidate } = fixture();
    candidate.provenance.paragraph!.checkStatus = "review";
    candidate.provenance.paragraph!.segments = [];
    candidate.asset = candidate.provenance.paragraph!.sourceAsset;
    const mock = api(candidate);
    render(<StrictMode><StudioApp project={project} /></StrictMode>);
    await screen.findByText("完整原音 · 未保存切片");
    expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("候选 1 试听").getAttribute("src")).toContain("source_original");
    start(); expect(mock.reads).toHaveLength(0); expect(current()).toEqual(project);
    noConfirmationOrGeneration(mock);
  });

  it("ignores the response after the paragraph copy changes during adoption", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project); start();
    fireEvent.change(screen.getByRole("textbox", { name: "整段 1 文案" }), { target: { value: "回来啦。先喝茶。" } });
    await mock.complete();
    expect(current().speechWorkspace!.paragraph.clips[0].asset.asset_id).toBe("paragraph_keep_0");
    expect(screen.getByText("工程刚刚有修改，请检查后重新采用。")).toBeTruthy();
    noConfirmationOrGeneration(mock);
  });

  it("finishes adoption into its paragraph bank after tab switching without replacing short-page audio", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project); start();
    fireEvent.click(screen.getByRole("tab", { name: "短句" }));
    await mock.complete();
    expect(current().speechWorkspace!.activeMode).toBe("short");
    expect(current().speechWorkspace!.short.clips.map(clip => clip.asset.asset_id)).toEqual(["short_keep_0", "short_keep_1"]);
    expect(flattenClips(current()).filter(clip => clip.type === "voice").map(clip => clip.asset.asset_id)).toEqual(["short_keep_0", "short_keep_1"]);
    expect(current().speechWorkspace!.paragraph.clips.map(clip => clip.asset.asset_id)).toEqual(["review_first", "review_second"]);
    noConfirmationOrGeneration(mock);
  });

  it.each(["project", "unmount"])("ignores a late adoption response after %s", async kind => {
    const { project, candidate } = fixture(); const mock = api(candidate); const view = await mount(project); start();
    if (kind === "project") fireEvent.click(screen.getByRole("button", { name: "测试新建项目" }));
    if (kind === "unmount") view.unmount();
    const before = kind === "unmount" ? undefined : current();
    await mock.complete();
    if (kind !== "unmount") expect(current()).toEqual(before);
    noConfirmationOrGeneration(mock);
  });

  it("preserves an existing historical receipt without requesting or manufacturing a new one", async () => {
    const { project, candidate } = fixture();
    candidate.provenance.paragraph!.manualTextConfirmation = { sourceCandidateId: candidate.candidateId,
      confirmedClipIds: [candidate.clipId], confirmedAt: "2026-10-14T13:45:00.000Z" };
    const before = JSON.stringify(candidate); const mock = api(candidate); await mount(project);
    expect(screen.getByText("历史试听确认记录已保存。")).toBeTruthy();
    start(); await mock.complete();
    await waitFor(() => expect(current().speechWorkspace!.paragraph.clips[0].asset.asset_id).toBe("review_first"));
    expect(JSON.stringify(candidate)).toBe(before); noConfirmationOrGeneration(mock);
  });
});
