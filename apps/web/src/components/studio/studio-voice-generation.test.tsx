// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVoiceCandidateRequestFingerprint, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "@/lib/asmr/audio-candidate";
import type { GenerateClipRequest } from "@/lib/asmr/generation-bridge";
import { getProjectMixFingerprint, isCurrentProjectMixFingerprint } from "@/lib/asmr/generation-fingerprint";
import { demoProject } from "@/lib/asmr/mock-project";
import { PlannerBriefSchema, type PlannerDraft } from "@/lib/asmr/planner";
import { PROJECT_LIBRARY_STORAGE_KEY, createInitialProjectLibrary, getCurrentLibraryEntry, saveProjectLibrary, type ProjectLibrary } from "@/lib/asmr/project-library";
import type { AsmrProject } from "@/lib/asmr/schema";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import { flattenClips } from "@/lib/asmr/view-model";
import { StudioApp } from "./studio-app";

const voiceOptions = { provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "clip" } as const;
const catalog = { providers: [
  { id: "gpt-sovits", label: "GPT-SoVITS", available: true, defaultReferenceId: "default", references: [{ id: "default", label: "原有声音", referenceModes: ["with_reference_text"] }] },
  { id: "voxcpm2", label: "VoxCPM2", available: true, defaultReferenceId: "soft_zh", longText: { available: true, apiConfigured: true }, references: [{ id: "soft_zh", label: "温柔参考", referenceModes: ["reference_only", "with_reference_text"] }] },
] };
const draft: PlannerDraft = {
  title: "候选测试书店", scene: "安静书店", character: { role: "店员", personality: ["温暖"], speechStyle: ["轻声"] },
  sections: [0, 1].map((index) => ({ id: `s_${index}`, title: "欢迎", text: "来坐一会儿。", emotion: "温暖", style: "柔和", pace: "缓慢", direction: "翻书", soundSuggestions: "", pauseAfter: "medium", position: { pan: 0, distance: "near", movement: "static" } })),
};

function fixtureProject(): AsmrProject {
  const voices = demoProject.timeline.tracks.find((track) => track.track_type === "voice")!.clips.slice(0, 2);
  return {
    ...structuredClone(demoProject), title: "候选测试书店", duration: 10,
    emotion_curve: [{ start: 0, end: 10, emotion: "gentle" }],
    timeline: { ...demoProject.timeline, tracks: demoProject.timeline.tracks.map((track) => track.track_type === "voice" ? {
      ...track, clips: voices.map((clip, index) => ({ ...clip, start: index * 5, duration: 3,
        generation: { ...clip.generation, status: "asset_generated" },
        asset: { asset_id: `original_${index}`, uri: `asset://clip/original_${index}`, duration: 3 },
      })),
    } : { ...track, clips: [] }) },
    exports: [{ type: "wav", status: "exported", uri: "asset://mix/original_mix" }],
  };
}

function seedLibrary(project = fixtureProject(), secondProject = false) {
  const library = createInitialProjectLibrary(project);
  library.projects[0].plannerSource = { brief: PlannerBriefSchema.parse({ theme: "书店" }), draft };
  library.projects[0].mixFingerprint = "original_mix_fingerprint";
  if (secondProject) library.projects.push(createInitialProjectLibrary({ ...project, project_id: "other_project", title: "另一工程" }).projects[0]);
  saveProjectLibrary(window.localStorage, library);
  window.localStorage.setItem("ai-asmr-studio:v1:voice-options", JSON.stringify(voiceOptions));
  return library;
}

function storedLibrary(): ProjectLibrary { return JSON.parse(window.localStorage.getItem(PROJECT_LIBRARY_STORAGE_KEY)!); }
function currentProject() { return getCurrentLibraryEntry(storedLibrary()).project; }
function firstVoice(project = currentProject()) { return project.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0]; }
function takeFor(project: AsmrProject, id = "take_1"): AudioCandidate {
  const clip = firstVoice(project);
  return makeVoiceCandidateFixture({ candidateId: id, projectId: project.project_id, clipId: clip.id,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(clip), requestFingerprint: getVoiceCandidateRequestFingerprint(clip, voiceOptions),
    asset: { assetId: id, uri: `asset://clip/${id}`, duration: 6 },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mockApi(initialCandidates: AudioCandidate[] = []) {
  const candidates = [...initialCandidates];
  const responses: Promise<Response>[] = [];
  const reads: Promise<Response>[] = [];
  const posts: { request: GenerateClipRequest; signal: AbortSignal | null | undefined }[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/generation/clip") {
      if (init?.method !== "POST") return Response.json(catalog);
      posts.push({ request: JSON.parse(String(init.body)), signal: init.signal });
      const promise = responses.shift();
      if (!promise) throw new Error("Unexpected generation in test");
      // Even an aborted request may deliver a late response in this fixture.
      const response = await promise;
      const payload = await response.clone().json();
      if (payload.candidate) candidates.push(payload.candidate);
      return response;
    }
    if (url.startsWith("/api/audio-candidates?")) {
      const query = new URL(url, "http://localhost").searchParams;
      return Response.json({ candidates: candidates.filter((item) => item.projectId === query.get("projectId") && item.clipId === query.get("clipId") && item.status === "ready") });
    }
    if (url.startsWith("/api/audio-candidates/")) {
      const id = new URL(url, "http://localhost").pathname.split("/").at(-1)!;
      const candidate = candidates.find((item) => item.candidateId === id);
      if (init?.method === "DELETE") {
        if (candidate) candidate.status = "discarded";
        return Response.json({ discarded: true });
      }
      return reads.shift() ?? Response.json({ candidate });
    }
    if (url.startsWith("/api/voice-generation-recordings?")) return Response.json({ recordings: [], truncated: false });
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [10, 30, 20], duration: 10, sampleRate: 48000, channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    throw new Error(`Unexpected test request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { posts, respond: (response: Response | Promise<Response>) => responses.push(Promise.resolve(response)), deferRead: (response: Promise<Response>) => reads.push(response) };
}

async function mount(project = fixtureProject()) {
  const view = render(<StrictMode><StudioApp project={project} /></StrictMode>);
  await waitFor(() => {
    const reference = screen.getByRole("combobox", { name: "参考声音" }) as HTMLSelectElement;
    expect(reference.value).toBe("soft_zh");
    expect(reference.disabled).toBe(false);
  });
  return view;
}
function openDisclosure(label: string) {
  const summary = screen.getByText(label, { selector: "summary" });
  if (!summary.closest("details")!.open) fireEvent.click(summary);
}
function audioSource() { return screen.getByLabelText("当前人声试听").getAttribute("src"); }
function audioAssetId() {
  const url = new URL(audioSource() ?? "", "http://localhost");
  const match = url.pathname.match(/^\/api\/assets\/(?:clip|spatial)\/([^/]+)$/);
  if (!match) throw new Error(`Unexpected preview route: ${url.pathname}`);
  return decodeURIComponent(match[1]);
}
async function waitOriginal() { await waitFor(() => expect(audioAssetId()).toBe("original_0")); }

beforeEach(() => {
  window.localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_ASMR_GENERATION_MODE", "local");
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("StudioApp voice candidate workflow with simulated HTTP", () => {
  it("defaults newly inserted semantic speech to the sliding generation mode", async () => {
    const project = fixtureProject();
    seedLibrary(project);
    mockApi();
    await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "下方插入" }));
    await waitFor(() => expect(currentProject().timeline.tracks.find((track) => track.track_type === "voice")!.clips[1].semantic_unit).toBe(true));
    const savedOptions = JSON.parse(window.localStorage.getItem("ai-asmr-studio:v1:voice-options")!);
    expect(savedOptions.generationMode).toBe("long_text");
  });

  it("cancels a semantic window when its following text changes while preserving the original target audio", async () => {
    const project = fixtureProject();
    const voices = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
    voices.forEach((clip) => { clip.semantic_unit = true; });
    seedLibrary(project);
    window.localStorage.setItem("ai-asmr-studio:v1:voice-options", JSON.stringify({ ...voiceOptions, generationMode: "long_text", analysisProvider: "local" }));
    const api = mockApi();
    const delayed = deferred<Response>();
    api.respond(delayed.promise);
    await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "重生成" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0].request.voiceOptions?.generationMode).toBe("long_text");
    fireEvent.click(screen.getByRole("button", { name: "选择第 2 段" }));
    fireEvent.change(screen.getByRole("textbox", { name: "台词" }), { target: { value: "后文已经更改。" } });
    await waitFor(() => expect(api.posts[0].signal?.aborted).toBe(true));
    await act(async () => { delayed.resolve(Response.json({ error: "canceled" }, { status: 499 })); await delayed.promise; });
    expect(firstVoice().asset.uri).toBe("asset://clip/original_0");
    expect(firstVoice().text).toBe(voices[0].text);
    expect(currentProject().timeline.tracks.find((track) => track.track_type === "voice")!.clips[1].text).toBe("后文已经更改。");
  });

  it("switches spatial playback routes and edits orbit distance without replacing the dry asset", async () => {
    const initial = seedLibrary();
    const entry = initial.projects[0];
    entry.mixFingerprint = getProjectMixFingerprint(entry.project);
    saveProjectLibrary(window.localStorage, initial);
    const dryAsset = structuredClone(firstVoice(entry.project).asset);
    const api = mockApi();
    await mount(entry.project);
    fireEvent.click(screen.getAllByRole("button", { name: "展开项目详情" })[0]);
    const toggle = screen.getByRole("checkbox", { name: "双耳空间与房间感" }) as HTMLInputElement;
    const preview = within(screen.getByRole("complementary", { name: "试听与导出" }));
    expect(toggle.checked).toBe(true);
    expect(new URL(audioSource()!, "http://localhost").pathname).toBe("/api/assets/spatial/original_0");
    expect(preview.queryAllByText("需重混")).toHaveLength(0);

    fireEvent.click(toggle);
    await waitFor(() => expect(currentProject().timeline.mixing.binaural).toBe(false));
    expect(audioSource()).toBe("/api/assets/clip/original_0");
    expect(firstVoice().asset).toEqual(dryAsset);
    expect(preview.getAllByText("需重混").length).toBeGreaterThan(0);

    fireEvent.click(toggle);
    await waitFor(() => expect(currentProject().timeline.mixing.binaural).toBe(true));
    expect(new URL(audioSource()!, "http://localhost").pathname).toBe("/api/assets/spatial/original_0");
    expect(preview.queryAllByText("需重混")).toHaveLength(0);
    expect(firstVoice().asset).toEqual(dryAsset);

    fireEvent.change(screen.getByRole("combobox", { name: /^距离/ }), { target: { value: "far" } });
    fireEvent.change(screen.getByRole("combobox", { name: /^移动/ }), { target: { value: "orbit" } });
    await waitFor(() => expect(firstVoice().position).toMatchObject({ distance: "far", movement: "orbit" }));
    const spatialUrl = new URL(audioSource()!, "http://localhost");
    expect(JSON.parse(spatialUrl.searchParams.get("position")!)).toMatchObject({ distance: "far", movement: "orbit" });
    expect(audioAssetId()).toBe("original_0");
    expect(firstVoice().asset).toEqual(dryAsset);
    expect(firstVoice().generation.status).toBe("asset_generated");
    expect(currentProject().exports).toEqual(entry.project.exports);
    expect(isCurrentProjectMixFingerprint(currentProject(), entry.mixFingerprint)).toBe(false);
    expect(preview.getAllByText("需重混").length).toBeGreaterThan(0);
    expect(api.posts).toHaveLength(0);
  });

  it.each(["local", "api"] as const)("sends and restores the user's long-text %s analysis choice", async (analysisProvider) => {
    const initial = seedLibrary();
    const project = initial.projects[0].project;
    const api = mockApi();
    api.respond(Response.json({ error: "测试生成失败。" }, { status: 503 }));
    let view = await mount(project);
    openDisclosure("更多生成设置");
    fireEvent.change(screen.getByRole("combobox", { name: "生成方式" }), { target: { value: "long_text" } });
    expect((screen.getByRole("combobox", { name: "文本分析" }) as HTMLSelectElement).value).toBe("local");
    if (analysisProvider === "api") fireEvent.change(screen.getByRole("combobox", { name: "文本分析" }), { target: { value: "api" } });
    fireEvent.click(screen.getByRole("button", { name: "重生成" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0].request.voiceOptions).toEqual({ ...voiceOptions, generationMode: "long_text", analysisProvider });
    expect(currentProject()).toEqual(project);
    view.unmount();
    view = await mount(project);
    openDisclosure("更多生成设置");
    expect((screen.getByRole("combobox", { name: "生成方式" }) as HTMLSelectElement).value).toBe("long_text");
    expect((screen.getByRole("combobox", { name: "文本分析" }) as HTMLSelectElement).value).toBe(analysisProvider);
    expect(api.posts).toHaveLength(1);
    view.unmount();
  });

  it("keeps generated audio as a candidate and persists adoption/Planner timing/undo across remount", async () => {
    const initial = seedLibrary();
    const project = initial.projects[0].project;
    const candidate = takeFor(project);
    const api = mockApi();
    api.respond(Response.json({ candidate }));
    let view = await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "重生成" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "采用候选 1" })).toBeTruthy());
    expect(audioAssetId()).toBe("original_0");
    expect(currentProject()).toEqual(project);
    expect(getCurrentLibraryEntry(storedLibrary()).mixFingerprint).toBe("original_mix_fingerprint");
    fireEvent.click(screen.getByRole("button", { name: "采用候选 1" }));
    await waitFor(() => expect(firstVoice().asset.asset_id).toBe("take_1"));
    expect(firstVoice().duration).toBe(6);
    expect(flattenClips(currentProject())[1].start).toBe(8);
    expect(currentProject().duration).toBe(13);
    expect(currentProject().emotion_curve[0].end).toBe(13);
    expect(getCurrentLibraryEntry(storedLibrary()).plannerSource).toEqual(initial.projects[0].plannerSource);
    expect(getCurrentLibraryEntry(storedLibrary()).mixFingerprint).toBeUndefined();
    view.unmount();
    view = await mount(project);
    expect(audioAssetId()).toBe("take_1");
    fireEvent.click(screen.getByRole("button", { name: "撤回上次采用" }));
    await waitOriginal();
    expect(currentProject()).toEqual(project);
    expect(getCurrentLibraryEntry(storedLibrary()).plannerSource).toEqual(initial.projects[0].plannerSource);
    view.unmount();
  });

  it.each(["cancel", "edit", "switch"] as const)("isolates a late candidate after %s", async (action) => {
    const initial = seedLibrary(fixtureProject(), true);
    const project = initial.projects[0].project;
    const candidate = takeFor(project);
    const late = deferred<Response>();
    const api = mockApi();
    api.respond(late.promise);
    await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "重生成" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    if (action === "cancel") fireEvent.click(screen.getByRole("button", { name: "取消" }));
    if (action === "edit") fireEvent.change(screen.getByLabelText("台词"), { target: { value: "我刚刚编辑的新台词。" } });
    if (action === "switch") {
      fireEvent.click(screen.getAllByRole("button", { name: "展开项目栏" })[0]);
      fireEvent.click(screen.getByRole("button", { name: /^另一工程/ }));
    }
    await waitFor(() => expect(api.posts[0].signal?.aborted).toBe(true));
    await act(async () => { late.resolve(Response.json({ candidate })); await late.promise; });
    if (action === "edit") {
      await waitFor(() => expect(firstVoice().asset.asset_id).toBeNull());
      expect(screen.queryByLabelText("当前人声试听")).toBeNull();
      expect(firstVoice().text).toBe("我刚刚编辑的新台词。");
      expect(getCurrentLibraryEntry(storedLibrary()).revisions.some((revision) => firstVoice(revision.project).asset.asset_id === "original_0")).toBe(true);
    } else {
      await waitOriginal();
      expect(firstVoice().asset.asset_id).toBe("original_0");
    }
    if (action === "switch") expect(storedLibrary().currentProjectId).toBe("other_project");
    const originalEntry = storedLibrary().projects.find((entry) => entry.projectId === project.project_id)!;
    expect(originalEntry.candidateAcceptance).toBeUndefined();
    expect(originalEntry.mixFingerprint).toBe("original_mix_fingerprint");
  });

  it("preserves the old project when adoption cannot be saved", async () => {
    const initial = seedLibrary();
    const project = initial.projects[0].project;
    mockApi([takeFor(project)]);
    await mount(project);
    const adopt = await screen.findByRole("button", { name: "采用候选 1" });
    const storedBefore = window.localStorage.getItem(PROJECT_LIBRARY_STORAGE_KEY);
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === PROJECT_LIBRARY_STORAGE_KEY) throw new DOMException("Quota exceeded", "QuotaExceededError");
      return originalSetItem.call(this, key, value);
    });
    fireEvent.click(adopt);
    await waitFor(() => expect(screen.getByText(/采用未保存，原声已保留/)).toBeTruthy());
    expect(audioAssetId()).toBe("original_0");
    expect(window.localStorage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).toBe(storedBefore);
  });

  it("does not overwrite an edit made while the candidate availability check is pending", async () => {
    const initial = seedLibrary();
    const project = initial.projects[0].project;
    const candidate = takeFor(project);
    const late = deferred<Response>();
    const api = mockApi([candidate]);
    api.deferRead(late.promise);
    await mount(project);
    fireEvent.click(await screen.findByRole("button", { name: "采用候选 1" }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("台词"), { target: { value: "检查期间的新编辑。" } });
      late.resolve(Response.json({ candidate }));
      await late.promise;
    });
    await waitFor(() => expect(firstVoice().text).toBe("检查期间的新编辑。"));
    expect(firstVoice().asset.asset_id).toBeNull();
    expect(screen.queryByLabelText("当前人声试听")).toBeNull();
    expect(getCurrentLibraryEntry(storedLibrary()).revisions.some((revision) => firstVoice(revision.project).asset.asset_id === "original_0")).toBe(true);
    expect(getCurrentLibraryEntry(storedLibrary()).candidateAcceptance).toBeUndefined();
  });

  it.each([
    ["台词", "text", "重新输入的完整台词。"],
    ["情绪", "emotion", "安静而温暖"],
  ] as const)("keeps the last valid project while %s is cleared and resumes saving after input", async (label, field, replacement) => {
    const initial = seedLibrary();
    const project = initial.projects[0].project;
    mockApi([takeFor(project)]);
    await mount(project);
    await screen.findByRole("button", { name: "采用候选 1" });
    if (field === "emotion") openDisclosure("表演与导演快捷");
    const savedBefore = currentProject();
    const input = screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "" } });
    await act(async () => { await Promise.resolve(); });
    expect(document.body.contains(input)).toBe(true);
    expect(input.value).toBe("");
    expect(currentProject()).toEqual(savedBefore);
    if (field === "text") expect(screen.queryByLabelText("当前人声试听")).toBeNull();
    else expect(audioAssetId()).toBe("original_0");

    fireEvent.change(input, { target: { value: replacement } });
    await waitFor(() => expect(firstVoice()[field]).toBe(replacement));
    expect(firstVoice().asset.asset_id).toBe(field === "text" ? null : "original_0");
    if (field === "text") expect(getCurrentLibraryEntry(storedLibrary()).revisions.some((revision) => firstVoice(revision.project).asset.asset_id === "original_0")).toBe(true);
    expect(getCurrentLibraryEntry(storedLibrary()).plannerSource).toEqual(initial.projects[0].plannerSource);
  });
});
