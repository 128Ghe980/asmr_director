// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVoiceCandidateRequestFingerprint, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "@/lib/asmr/audio-candidate";
import type { GenerateClipRequest } from "@/lib/asmr/generation-bridge";
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
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [10, 30, 20], duration: 10, sampleRate: 48000, channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    throw new Error(`Unexpected test request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { posts, respond: (response: Response | Promise<Response>) => responses.push(Promise.resolve(response)), deferRead: (response: Promise<Response>) => reads.push(response) };
}

async function mount(project = fixtureProject()) {
  const view = render(<StrictMode><StudioApp project={project} /></StrictMode>);
  await waitFor(() => {
    const engine = screen.getByRole("combobox", { name: "人声引擎" }) as HTMLSelectElement;
    expect(engine.value).toBe("voxcpm2");
    expect(engine.disabled).toBe(false);
  });
  return view;
}
function audioSource() { return screen.getByLabelText("当前人声试听").getAttribute("src"); }
async function waitOriginal() { await waitFor(() => expect(audioSource()).toBe("/api/assets/clip/original_0")); }

beforeEach(() => {
  window.localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_ASMR_GENERATION_MODE", "local");
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("StudioApp voice candidate workflow with simulated HTTP", () => {
  it.each(["local", "api"] as const)("sends and restores the user's long-text %s analysis choice", async (analysisProvider) => {
    const initial = seedLibrary();
    const project = initial.projects[0].project;
    const api = mockApi();
    api.respond(Response.json({ error: "测试生成失败。" }, { status: 503 }));
    let view = await mount(project);
    fireEvent.change(screen.getByRole("combobox", { name: "生成方式" }), { target: { value: "long_text" } });
    expect((screen.getByRole("combobox", { name: "文本分析" }) as HTMLSelectElement).value).toBe("local");
    if (analysisProvider === "api") fireEvent.change(screen.getByRole("combobox", { name: "文本分析" }), { target: { value: "api" } });
    fireEvent.click(screen.getByRole("button", { name: "重生成" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0].request.voiceOptions).toEqual({ ...voiceOptions, generationMode: "long_text", analysisProvider });
    expect(currentProject()).toEqual(project);
    view.unmount();
    view = await mount(project);
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
    expect(audioSource()).toBe("/api/assets/clip/original_0");
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
    expect(audioSource()).toBe("/api/assets/clip/take_1");
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
    await waitOriginal();
    expect(firstVoice().asset.asset_id).toBe("original_0");
    if (action === "edit") expect(firstVoice().text).toBe("我刚刚编辑的新台词。");
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
    expect(audioSource()).toBe("/api/assets/clip/original_0");
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
    expect(audioSource()).toBe("/api/assets/clip/original_0");
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
    const savedBefore = currentProject();
    const input = screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "" } });
    await act(async () => { await Promise.resolve(); });
    expect(document.body.contains(input)).toBe(true);
    expect(input.value).toBe("");
    expect(currentProject()).toEqual(savedBefore);
    expect(audioSource()).toBe("/api/assets/clip/original_0");

    fireEvent.change(input, { target: { value: replacement } });
    await waitFor(() => expect(firstVoice()[field]).toBe(replacement));
    expect(firstVoice().asset.asset_id).toBe("original_0");
    expect(getCurrentLibraryEntry(storedLibrary()).plannerSource).toEqual(initial.projects[0].plannerSource);
  });
});
