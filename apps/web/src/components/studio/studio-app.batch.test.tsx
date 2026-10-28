// @vitest-environment jsdom

import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getVoiceCandidateRequestFingerprint, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "@/lib/asmr/audio-candidate";
import type { GenerateClipRequest, GenerationBridge, GenerationJobSnapshot, GenerationJobUpdate } from "@/lib/asmr/generation-bridge";
import { demoProject } from "@/lib/asmr/mock-project";
import { createInitialProjectLibrary, getCurrentLibraryEntry, loadProjectLibrary, saveProjectLibrary } from "@/lib/asmr/project-library";
import type { AsmrProject, VoiceClip } from "@/lib/asmr/schema";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import { createClipVideoSourceFingerprint, getClipStoryboardReferenceContext, type ClipVideoStoryboard, type StoryboardReferenceMode } from "@/lib/asmr/video-plan";
import { StudioApp } from "./studio-app";
import { INSUFFICIENT_STORAGE, LocalStorageError } from "@/lib/asmr/local-storage-error";

const bridgeFactory = vi.hoisted(() => vi.fn());
const dialogMethods = ["showModal", "close"] as const;
const dialogDescriptors = dialogMethods.map(name => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
vi.mock("@/lib/asmr/local-generation-bridge", () => ({ createLocalGenerationBridge: bridgeFactory }));
vi.mock("./project-workspace", () => ({
  ProjectWorkspace: ({ children, project }: { children: ReactNode; project: AsmrProject }) => <div><output data-testid="current-project">{JSON.stringify(project)}</output>{children}</div>,
}));
vi.mock("./planner-panel", () => ({ PlannerPanel: () => null }));
vi.mock("./clip-inspector", () => ({ ClipInspector: () => null }));
vi.mock("./timeline-panel", () => ({ TimelinePanel: () => null }));
vi.mock("./validation-panel", () => ({ ValidationPanel: () => null }));
vi.mock("./editor-panels", () => ({ EditorPanels: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const voiceOptions = { provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "clip" } as const;
const catalog = { providers: [
  { id: "gpt-sovits", label: "GPT-SoVITS", available: true, defaultReferenceId: "default", references: [{ id: "default", label: "旧声音", referenceModes: ["with_reference_text"] }] },
  { id: "voxcpm2", label: "VoxCPM2", available: true, defaultReferenceId: "soft_zh", references: [{ id: "soft_zh", label: "当前参考声音", referenceModes: ["with_reference_text"] }], longText: { available: true, apiConfigured: true } },
] };

function voices(project: AsmrProject): VoiceClip[] {
  return project.timeline.tracks.flatMap<VoiceClip>((track) => track.track_type === "voice" ? track.clips : []).sort((a, b) => a.start - b.start);
}

function fixtureProject(adopted = [0]): AsmrProject {
  const project = structuredClone(demoProject);
  project.project_id = "batch_current_project";
  project.title = "当前工程的批量任务";
  project.duration = 15;
  project.emotion_curve = [{ start: 0, end: 15, emotion: "gentle" }];
  project.videoPlan = { version: 1, sceneDescription: "雪地木屋内，壁炉温暖，窗外下着雪。", shots: {} };
  project.timeline.tracks = project.timeline.tracks.map((track) => track.track_type === "voice" ? {
    ...track, clips: track.clips.slice(0, 3).map((clip, index) => ({
      ...clip, text: `当前工程第${index + 1}段的原台词。`, start: index * 5, duration: 3, semantic_unit: false,
      generation: { ...clip.generation, status: adopted.includes(index) ? "asset_generated" as const : "asset_pending" as const },
      asset: adopted.includes(index) ? { asset_id: `original_${index}`, uri: `asset://clip/original_${index}`, duration: 3 } : { asset_id: null, uri: null, duration: null },
    })),
  } : { ...track, clips: [] });
  return project;
}

function seed(project: AsmrProject) {
  saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
  window.localStorage.setItem("ai-asmr-studio:v1:voice-options", JSON.stringify(voiceOptions));
}

function storedProject(fallback: AsmrProject): AsmrProject {
  return getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, fallback)).project;
}

function currentProject(): AsmrProject { return JSON.parse(screen.getByTestId("current-project").textContent!); }
function openResults() {
  fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
  return screen.getByRole("dialog", { name: "操作结果" });
}
function closeResults() { fireEvent.click(within(screen.getByRole("dialog", { name: "操作结果" })).getByRole("button", { name: "关闭操作结果" })); }

function shotFor(project: AsmrProject, clipId: string, title = "A newly generated moment"): ClipVideoStoryboard {
  const clip = voices(project).find((item) => item.id === clipId)!;
  return {
    version: 1, promptFormat: "minimax-h3", clipId, sourceFingerprint: createClipVideoSourceFingerprint(project, clipId),
    audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: 2.75 }, title,
    visual: "S1 sits beside a cup in the warm cabin.", action: "S1 gently rests a hand near the cup, keeping the mouth visible.", camera: "A static medium close-up.",
  };
}

type ClipStoryboardRequest = { project: AsmrProject; clipId: string; provider: string; includePrevious: boolean; referenceMode: StoryboardReferenceMode };
type StoryboardPost = { body: ClipStoryboardRequest; signal?: AbortSignal | null; resolve: (response: Response) => void };

function mockApi({ candidateListFails = false }: { candidateListFails?: boolean } = {}) {
  const posts: StoryboardPost[] = [];
  const candidates: AudioCandidate[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/generation/clip" && init?.method !== "POST") return Response.json(catalog);
    if (url === "/api/planner" && init?.method !== "POST") return Response.json({
      providers: [{ id: "api", label: "测试文字模型", model: "batch-fixture", configured: true }, { id: "ollama", label: "未启用本地模型", model: "local-fixture", configured: false }], defaultProvider: "api",
    });
    if (url.startsWith("/api/audio-candidates?")) {
      if (candidateListFails) return Response.json({ error: "候选读取失败" }, { status: 500 });
      const query = new URL(url, "http://localhost").searchParams;
      return Response.json({ candidates: candidates.filter((candidate) => candidate.projectId === query.get("projectId") && (!query.has("clipId") || candidate.clipId === query.get("clipId"))) });
    }
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [10, 20], duration: 3, sampleRate: 48000, channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    if (url === "/api/clip-storyboard" && init?.method === "POST") return await new Promise<Response>((resolve) => {
      // Deliberately allow late replies after abort to exercise the real App guard.
      posts.push({ body: JSON.parse(String(init.body)), signal: init.signal, resolve });
    });
    throw new Error(`Unexpected batch integration request: ${url}`);
  }));
  return {
    posts, candidates,
    finishShot(index: number, title?: string) {
      const post = posts[index];
      const { project, clipId, referenceMode } = post.body;
      const storyboard = { ...shotFor(project, clipId, title), referenceMode,
        ...getClipStoryboardReferenceContext(project, clipId, referenceMode) };
      post.resolve(Response.json({ storyboard, provider: "api", model: "batch-fixture" }));
    },
  };
}

function mockBridge(candidates: AudioCandidate[]) {
  const calls: { request: GenerateClipRequest; job: GenerationJobSnapshot; onUpdate: (update: GenerationJobUpdate) => void }[] = [];
  const bridge: GenerationBridge = {
    generateClip: vi.fn(async (request, onUpdate) => {
      const job: GenerationJobSnapshot = { jobId: `batch_job_${calls.length + 1}`, clipId: request.clipId, target: { type: "clip", clipId: request.clipId }, status: "generating", progress: 0.1, createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" };
      calls.push({ request: structuredClone(request), job, onUpdate });
      onUpdate({ type: "snapshot", job });
      return { jobId: job.jobId };
    }),
    generateProjectMix: vi.fn(async () => { throw new Error("Batch clips must not request a project mix"); }),
    cancelGeneration: vi.fn(async () => undefined),
  };
  bridgeFactory.mockReturnValue(bridge);
  return {
    bridge, calls,
    finishCandidate(index: number) {
      const call = calls[index];
      const clip = voices(call.request.project).find((item) => item.id === call.request.clipId)!;
      const candidate = makeVoiceCandidateFixture({ candidateId: `batch_take_${index}`, projectId: call.request.project.project_id, clipId: clip.id,
        sourceFingerprint: getVoiceCandidateSourceFingerprint(clip), requestFingerprint: getVoiceCandidateRequestFingerprint(clip, call.request.voiceOptions!),
        asset: { assetId: `batch_take_${index}`, uri: `asset://clip/batch_take_${index}`, duration: 2.75 },
      });
      candidates.push(candidate);
      call.onUpdate({ type: "candidate", job: { ...call.job, status: "succeeded", progress: 1 }, candidate });
    },
  };
}

async function mount(project: AsmrProject) {
  const view = render(<StrictMode><StudioApp project={project} /></StrictMode>);
  fireEvent.click(screen.getByLabelText("批量更多操作"));
  await waitFor(() => expect((screen.getByRole("button", { name: "音频全部重新生成" }) as HTMLButtonElement).disabled).toBe(false));
  await act(async () => {});
  return view;
}

async function advanceAudioBatchInterval(calls: readonly unknown[], completedCalls: number) {
  expect(screen.getByText("任务间隔中（5 秒）")).toBeTruthy();
  expect(calls).toHaveLength(completedCalls);
  await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
  expect(calls).toHaveLength(completedCalls);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(calls).toHaveLength(completedCalls + 1);
}

beforeEach(() => {
  for (const name of dialogMethods) Object.defineProperty(HTMLDialogElement.prototype, name, { configurable: true, writable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.open = name === "showModal"; }) });
  window.localStorage.clear(); bridgeFactory.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubEnv("NEXT_PUBLIC_ASMR_GENERATION_MODE", "local");
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  dialogMethods.forEach((name, index) => { const descriptor = dialogDescriptors[index]; if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, name); });
});

describe("StudioApp batch generation with simulated bridge and HTTP", () => {
  it("updates storyboard markers from saved prompts and dialogue edits, including the linked next paragraph", async () => {
    const project = fixtureProject([0, 1]);
    const [first, second] = voices(project);
    project.videoPlan!.shots[first.id] = shotFor(project, first.id);
    project.videoPlan!.shots[second.id] = { ...shotFor(project, second.id),
      ...getClipStoryboardReferenceContext(project, second.id, "continuous"), referenceMode: "continuous" };
    seed(project);
    const api = mockApi(); const generation = mockBridge(api.candidates);
    let view = await mount(project);
    expect(screen.getByRole("img", { name: "第 1 段分镜状态：设计已完成" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "第 2 段分镜状态：设计已完成" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "第 3 段分镜状态：设计待生成" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "台词" }), { target: { value: "修改第一段的当前台词。" } });
    await waitFor(() => expect(screen.getByRole("img", { name: "第 1 段分镜状态：设计待更新" })).toBeTruthy());
    expect(screen.getByRole("img", { name: "第 2 段分镜状态：设计待更新" })).toBeTruthy();
    expect(storedProject(project).videoPlan?.shots).toEqual(project.videoPlan!.shots);
    view.unmount(); view = await mount(project);
    expect(screen.getByRole("img", { name: "第 1 段分镜状态：设计待更新" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "第 2 段分镜状态：设计待更新" })).toBeTruthy();
    expect(api.posts).toHaveLength(0);
    expect(generation.calls).toHaveLength(0);
    view.unmount();
  });
  it("leaves candidate-dependent counts unknown when the project candidate list cannot be read", async () => {
    const project = fixtureProject(); seed(project);
    const api = mockApi({ candidateListFails: true }); mockBridge(api.candidates);
    await mount(project);
    expect((await screen.findByRole("status", { name: "音频总览暂时无法读取" })).textContent).toBe("已采用 1·待生成 —·未采用 —");
    expect(screen.queryByRole("status", { name: "已采用 1 段，待生成 2 段，已生成未采用 0 段，共 3 段" })).toBeNull();
    expect(storedProject(project)).toEqual(project);
  });
  it("counts candidates across the whole project without fetching again when the selected paragraph changes", async () => {
    const project = fixtureProject(); seed(project);
    const api = mockApi(); mockBridge(api.candidates);
    const clip = voices(project)[2];
    api.candidates.push(makeVoiceCandidateFixture({ projectId: project.project_id, clipId: clip.id,
      sourceFingerprint: getVoiceCandidateSourceFingerprint(clip),
    }));
    await mount(project);
    const summary = await screen.findByRole("status", { name: "已采用 1 段，待生成 1 段，已生成未采用 1 段，共 3 段" });
    expect(summary.textContent).toBe("已采用 1·待生成 1·未采用 1");
    const candidateQueries = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/audio-candidates?"));
    const count = candidateQueries().length;
    expect(count).toBeGreaterThan(0);
    expect(candidateQueries().every((url) => !new URL(url, "http://localhost").searchParams.has("clipId"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "选择第 3 段" }));
    await act(async () => {});
    expect(candidateQueries()).toHaveLength(count);
    expect(screen.getByRole("status", { name: "已采用 1 段，待生成 1 段，已生成未采用 1 段，共 3 段" })).toBe(summary);
    fireEvent.change(screen.getByRole("textbox", { name: "台词" }), { target: { value: "这段台词现在变了。" } });
    await waitFor(() => expect(screen.getByRole("status", { name: "已采用 1 段，待生成 2 段，已生成未采用 0 段，共 3 段" }).textContent).toBe("已采用 1·待生成 2·未采用 0"));
    expect(candidateQueries()).toHaveLength(count);
  });
  it("shows the storage failure that stopped the queue after an earlier recoverable model error", async () => {
    const project = fixtureProject(); seed(project);
    const api = mockApi(); const generation = mockBridge(api.candidates);
    await mount(project);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "音频全部重新生成" }));
    await act(async () => {});
    expect(generation.calls).toHaveLength(1);
    const first = generation.calls[0];
    await act(async () => { first.onUpdate({ type: "failed", job: { ...first.job, status: "failed" }, error: "模型暂不可用" }); });
    await advanceAudioBatchInterval(generation.calls, 1);
    const second = generation.calls[1];
    await act(async () => { second.onUpdate({ type: "failed", job: { ...second.job, status: "failed" }, error: new LocalStorageError().message, errorCode: INSUFFICIENT_STORAGE }); });
    expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    const notice = within(openResults()).getByText(/批量生成已停止：成功 0 · 失败 2/).textContent;
    expect(notice).toContain(new LocalStorageError().message);
    expect(notice).not.toContain("模型暂不可用");
    expect(notice).toContain("还有 1 段未处理");
    closeResults();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(generation.calls).toHaveLength(2);
  });
  it("stops dispatching after a storage failure and reports unprocessed paragraphs", async () => {
    const project = fixtureProject(); seed(project);
    const api = mockApi(); const generation = mockBridge(api.candidates);
    await mount(project);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "音频全部重新生成" }));
    await act(async () => {});
    expect(generation.calls).toHaveLength(1);
    await act(async () => { generation.finishCandidate(0); });
    await advanceAudioBatchInterval(generation.calls, 1);
    const call = generation.calls[1];
    await act(async () => { call.onUpdate({ type: "failed", job: { ...call.job, status: "failed" }, error: new LocalStorageError().message, errorCode: INSUFFICIENT_STORAGE }); });
    expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull();
    expect(within(openResults()).getByText(/批量生成已停止：成功 1 · 失败 1/).textContent).toContain("还有 1 段未处理");
    closeResults();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(generation.calls).toHaveLength(2);
    expect(storedProject(project)).toEqual(project);
    expect(api.candidates).toHaveLength(1);
    expect((screen.getByRole("button", { name: "音频全部重新生成" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("serially fills missing audio from the current project and keeps Vox candidates unadopted", async () => {
    const project = fixtureProject(); seed(project);
    const api = mockApi(); const generation = mockBridge(api.candidates);
    await mount(project);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "音频全部生成" }));
    await act(async () => {});
    expect(generation.calls).toHaveLength(1);
    expect(generation.calls[0].request).toMatchObject({ clipId: voices(project)[1].id, reason: "generate", voiceOptions });
    expect(generation.calls[0].request.project).toEqual(project);
    await act(async () => {});
    expect(generation.calls).toHaveLength(1); // Starting the bridge is not a completed clip.
    await act(async () => { generation.finishCandidate(0); });
    await advanceAudioBatchInterval(generation.calls, 1);
    expect(screen.getByRole("status", { name: "已采用 1 段，待生成 1 段，已生成未采用 1 段，共 3 段" })).toBeTruthy();
    expect(generation.calls[1].request.clipId).toBe(voices(project)[2].id);
    await act(async () => { generation.finishCandidate(1); });
    expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(generation.calls).toHaveLength(2);
    expect(storedProject(project)).toEqual(project);
    expect(api.candidates).toHaveLength(2);
    expect(screen.getByRole("status", { name: "已采用 1 段，待生成 0 段，已生成未采用 2 段，共 3 段" })).toBeTruthy();
    expect(api.posts).toHaveLength(0);
    expect(generation.bridge.generateProjectMix).not.toHaveBeenCalled();
  });

  it("regenerates adopted audio through the same Vox candidate workflow and stops after cancellation", async () => {
    const project = fixtureProject(); seed(project);
    const api = mockApi(); const generation = mockBridge(api.candidates);
    await mount(project);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "音频全部重新生成" }));
    await act(async () => {});
    expect(generation.calls).toHaveLength(1);
    expect(generation.calls[0].request).toMatchObject({ clipId: voices(project)[0].id, reason: "regenerate", voiceOptions });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    expect(screen.getByRole("progressbar", { name: "音频批量进度" })).toBeTruthy();
    await act(async () => { generation.finishCandidate(0); });
    await advanceAudioBatchInterval(generation.calls, 1);
    expect(voices(currentProject())[0].asset).toEqual(voices(project)[0].asset);
    fireEvent.click(screen.getByRole("button", { name: "取消批量生成" }));
    expect(generation.bridge.cancelGeneration).toHaveBeenCalledWith(generation.calls[1].job.jobId);
    await act(async () => { generation.finishCandidate(1); });
    expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(generation.calls).toHaveLength(2);
    expect(storedProject(project)).toEqual(project);
    expect(api.posts).toHaveLength(0);
  });

  it("continues after startup rejects following a running snapshot and clears runtime so the toolbar can run again", async () => {
    const project = fixtureProject(); seed(project);
    const api = mockApi(); const generation = mockBridge(api.candidates);
    const generate = vi.mocked(generation.bridge.generateClip);
    const start = generate.getMockImplementation()!;
    generate.mockImplementationOnce(async (request, onUpdate) => {
      await start(request, onUpdate); // The running job is already visible when startup fails.
      throw new Error("桥接启动失败，下一段仍可生成。");
    });
    await mount(project);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "音频全部生成" }));
    await act(async () => {});
    await advanceAudioBatchInterval(generation.calls, 1);
    expect(generation.calls.map((call) => call.request.clipId)).toEqual(voices(project).slice(1).map((clip) => clip.id));
    expect(generation.bridge.cancelGeneration).toHaveBeenCalledWith(generation.calls[0].job.jobId);
    await act(async () => { generation.finishCandidate(1); });
    expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull();
    for (const name of ["音频全部生成", "音频全部重新生成", "批量设计画面与声音", "批量重新设计画面与声音"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
    }
    expect(screen.getByRole("status", { name: "操作结果摘要" }).textContent).toContain("成功 1 · 失败 1");
    expect(screen.getByRole("status", { name: "操作结果摘要" }).textContent).not.toContain("桥接启动失败");
    expect(within(openResults()).getByRole("region", { name: "批量生成结果" }).textContent).toContain("桥接启动失败");
    closeResults();
    expect(storedProject(project)).toEqual(project);
    expect(api.candidates).toHaveLength(1);
  });

  it("fills only absent storyboards, skips unadopted audio, and persists existing manual notes across remount", async () => {
    const project = fixtureProject([0, 1]);
    const manual = { ...shotFor(project, voices(project)[0].id, "Manual notes"), visual: "The user's existing handmade visual description." };
    project.videoPlan!.shots[manual.clipId] = manual; seed(project);
    const api = mockApi(); const generation = mockBridge(api.candidates);
    let view = await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "批量设计画面与声音" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(api.posts[0].body).toMatchObject({ project, clipId: voices(project)[1].id, provider: "api", includePrevious: true, referenceMode: "continuous" });
    await act(async () => { api.finishShot(0); });
    await waitFor(() => expect(storedProject(project).videoPlan?.shots[voices(project)[1].id]?.title).toBe("A newly generated moment"));
    expect(storedProject(project).videoPlan?.shots[manual.clipId]).toEqual(manual);
    expect(storedProject(project).videoPlan?.shots[voices(project)[2].id]).toBeUndefined();
    expect(storedProject(project).timeline).toEqual(project.timeline);
    expect(generation.calls).toHaveLength(0);
    view.unmount(); view = await mount(project);
    expect(currentProject().videoPlan?.shots[manual.clipId]).toEqual(manual);
    expect(currentProject().videoPlan?.shots[voices(project)[1].id]?.title).toBe("A newly generated moment");
    expect((screen.getByRole("button", { name: "批量设计画面与声音" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "批量设计画面与声音" }).textContent).toContain("重新设计画面与声音");
    expect(api.posts).toHaveLength(1);
    view.unmount();
  });

  it.each(["primary", "more"] as const)("declines existing-storyboard replacement from %s without requests or project changes", async (entry) => {
    const project = fixtureProject([0, 1]);
    for (const clip of voices(project).slice(0, 2)) project.videoPlan!.shots[clip.id] = shotFor(project, clip.id, "Keep existing " + clip.id);
    seed(project); const api = mockApi(); const generation = mockBridge(api.candidates); await mount(project);
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    const button = screen.getByRole("button", { name: entry === "primary" ? "批量设计画面与声音" : "批量重新设计画面与声音" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false); fireEvent.click(button); await act(async () => {});
    expect(window.confirm).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/(?=.*重新生成)(?=.*已有分镜)/));
    expect(api.posts).toHaveLength(0); expect(generation.calls).toHaveLength(0);
    expect(storedProject(project)).toEqual(project); expect(currentProject()).toEqual(project);
    expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull();
  });

  it("regenerates from the primary action after confirmation and preserves an old shot when its request fails", async () => {
    const project = fixtureProject([0, 1]), [first, second] = voices(project);
    for (const clip of [first, second]) project.videoPlan!.shots[clip.id] = shotFor(project, clip.id, "Old manual " + clip.id);
    const keptSecond = structuredClone(project.videoPlan!.shots[second.id]);
    seed(project); const api = mockApi(); const generation = mockBridge(api.candidates); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "批量设计画面与声音" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(window.confirm).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/(?=.*重新生成)(?=.*已有分镜)/));
    expect(api.posts[0].body.clipId).toBe(first.id); expect(storedProject(project)).toEqual(project);
    await act(async () => { api.finishShot(0, "Confirmed replacement first shot"); });
    await waitFor(() => expect(api.posts).toHaveLength(2)); expect(api.posts[1].body.clipId).toBe(second.id);
    await act(async () => { api.posts[1].resolve(Response.json({ error: "分镜模型暂时不可用。" }, { status: 502 })); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull());
    const saved = storedProject(project);
    expect(saved.videoPlan!.shots[first.id].title).toBe("Confirmed replacement first shot");
    expect(saved.videoPlan!.shots[second.id]).toEqual(keptSecond); expect(saved.timeline).toEqual(project.timeline);
    expect(screen.getByRole("status", { name: "操作结果摘要" }).textContent).toContain("成功 1 · 失败 1");
    expect(generation.calls).toHaveLength(0);
  });

  it("identifies every failed script segment and distinguishes a model failure from its following continuity failure", async () => {
    const project = fixtureProject([0, 1, 2]), [first, second, third] = voices(project);
    first.id = "snow_voice_003"; second.id = "snow_voice_015"; third.id = "snow_voice_099";
    second.text = "擦擦脸，外面风雪大。"; third.text = "喝点热的，先暖暖手。";
    project.videoPlan!.shots[first.id] = { ...shotFor(project, first.id, "Original first"), referenceMode: "new" };
    for (const clip of [second, third]) project.videoPlan!.shots[clip.id] = {
      ...shotFor(project, clip.id, "Keep original " + clip.id), referenceMode: "continuous",
      ...getClipStoryboardReferenceContext(project, clip.id, "continuous"),
    };
    const originalSecond = structuredClone(project.videoPlan!.shots[second.id]);
    const originalThird = structuredClone(project.videoPlan!.shots[third.id]);
    seed(project); const api = mockApi(); const generation = mockBridge(api.candidates); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "批量设计画面与声音" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    await act(async () => { api.finishShot(0, "New first shot retained"); });
    await waitFor(() => expect(api.posts).toHaveLength(2));
    await act(async () => { api.posts[1].resolve(Response.json({ error: "模型分镜结构不正确，请重试。" }, { status: 502 })); });
    const summary = await screen.findByRole("status", { name: "操作结果摘要" });
    expect(summary.textContent).toContain("批量生成完成：成功 1 · 失败 2");
    expect(summary.textContent).not.toContain("擦擦脸");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/第 2 段“擦擦脸/)).toBeNull();
    const requestsBeforeViewing = vi.mocked(fetch).mock.calls.length;
    const notice = within(openResults()).getByText(/^批量生成完成：成功 1 · 失败 2/);
    expect(notice.textContent).toContain("\n第 2 段“擦擦脸，外面风雪大。”：模型分镜结构不正确，请重试。");
    expect(notice.textContent).toContain("\n第 3 段“喝点热的，先暖暖手。”：连续镜头需要上一段的可用分镜，请先生成或更新上一段。");
    expect(notice.classList.contains("whitespace-pre-line")).toBe(true);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(requestsBeforeViewing);
    closeResults();
    expect(api.posts.map(post => post.body.clipId)).toEqual([first.id, second.id]);
    const saved = storedProject(project);
    expect(saved.videoPlan!.shots[first.id].title).toBe("New first shot retained");
    expect(saved.videoPlan!.shots[second.id]).toEqual(originalSecond);
    expect(saved.videoPlan!.shots[third.id]).toEqual(originalThird);
    expect(saved.timeline).toEqual(project.timeline); expect(generation.calls).toHaveLength(0);
  });

  it("serially regenerates all eligible storyboards with fresh project snapshots and never creates audio", async () => {
    const project = fixtureProject([0, 1]);
    project.videoPlan!.shots[voices(project)[0].id] = shotFor(project, voices(project)[0].id, "Old manual shot"); seed(project);
    const api = mockApi(); const generation = mockBridge(api.candidates);
    await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "批量重新设计画面与声音" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    await act(async () => {});
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0].body.clipId).toBe(voices(project)[0].id);
    await act(async () => { api.finishShot(0, "Replacement first shot"); });
    await waitFor(() => expect(api.posts).toHaveLength(2));
    expect(api.posts[1].body.clipId).toBe(voices(project)[1].id);
    expect(api.posts[1].body.project.videoPlan?.shots[voices(project)[0].id]?.title).toBe("Replacement first shot");
    expect(api.posts[1].body).toMatchObject({ includePrevious: true, referenceMode: "continuous" });
    await act(async () => { api.finishShot(1, "Replacement second shot"); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull());
    expect(storedProject(project).videoPlan?.shots[voices(project)[1].id]?.title).toBe("Replacement second shot");
    expect(storedProject(project).videoPlan?.shots[voices(project)[2].id]).toBeUndefined();
    expect(storedProject(project).timeline).toEqual(project.timeline);
    expect(generation.calls).toHaveLength(0);
  });

  it("aborts a storyboard batch without overwriting manual notes from a late response or starting the next clip", async () => {
    const project = fixtureProject([0, 1]);
    const original = shotFor(project, voices(project)[0].id, "Keep this manual shot");
    project.videoPlan!.shots[original.clipId] = original; seed(project);
    const api = mockApi(); const generation = mockBridge(api.candidates);
    await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "批量重新设计画面与声音" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "取消批量生成" }));
    expect(api.posts[0].signal?.aborted).toBe(true);
    await act(async () => { api.finishShot(0, "A late result must be ignored"); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull());
    expect(api.posts).toHaveLength(1);
    expect(storedProject(project)).toEqual(project);
    expect(generation.calls).toHaveLength(0);
  });

  it("persists the list mode without changing selection or saved prompts, and keeps the inspector synchronized", async () => {
    const project = fixtureProject([0, 1]);
    const secondId = voices(project)[1].id;
    const saved = shotFor(project, secondId, "Keep the existing prompt");
    project.videoPlan!.shots[secondId] = saved; seed(project);
    const api = mockApi(); mockBridge(api.candidates);
    let view = await mount(project);
    const firstToggle = screen.getByRole("button", { name: /第 1 段：新镜头。首段/ });
    expect((firstToggle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "第 2 段：新镜头，点击切换为连续镜头（用于下次生成）" }));
    await waitFor(() => expect(storedProject(project).videoPlan?.referenceModes?.[secondId]).toBe("continuous"));
    expect(screen.getByRole("button", { name: "选择第 1 段" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("tab", { name: "声音" }).getAttribute("aria-selected")).toBe("true");
    expect(storedProject(project).videoPlan?.shots[secondId]).toEqual(saved);
    fireEvent.click(screen.getByRole("button", { name: "第 2 段画面与声音" }));
    expect((screen.getByRole("radio", { name: "连续镜头" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "新镜头" }));
    await waitFor(() => expect(storedProject(project).videoPlan?.referenceModes?.[secondId]).toBe("new"));
    expect(screen.getByRole("button", { name: "第 2 段：新镜头，点击切换为连续镜头（用于下次生成）" })).toBeTruthy();
    expect(storedProject(project).videoPlan?.shots[secondId]).toEqual(saved);
    expect(storedProject(project).timeline).toEqual(project.timeline);
    view.unmount(); view = await mount(project);
    expect(currentProject().videoPlan?.referenceModes?.[secondId]).toBe("new");
    expect(api.posts).toHaveLength(0);
    view.unmount();
  });

  it("uses each persisted mode and the newly saved predecessor in a serial mixed-mode batch", async () => {
    const project = fixtureProject([0, 1, 2]);
    const [first, second, third] = voices(project);
    project.videoPlan!.referenceModes = { [first.id]: "continuous", [second.id]: "continuous", [third.id]: "new" };
    seed(project);
    const api = mockApi(); const generation = mockBridge(api.candidates);
    await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "批量设计画面与声音" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(api.posts[0].body).toMatchObject({ clipId: first.id, referenceMode: "new", includePrevious: false });
    expect((screen.getByRole("button", { name: /第 2 段：连续镜头，点击切换/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { api.finishShot(0, "First fresh scene"); });
    await waitFor(() => expect(api.posts).toHaveLength(2));
    expect(api.posts[1].body).toMatchObject({ clipId: second.id, referenceMode: "continuous", includePrevious: true });
    expect(api.posts[1].body.project.videoPlan?.shots[first.id]?.title).toBe("First fresh scene");
    await act(async () => { api.finishShot(1, "Continuous second scene"); });
    await waitFor(() => expect(api.posts).toHaveLength(3));
    expect(api.posts[2].body).toMatchObject({ clipId: third.id, referenceMode: "new", includePrevious: true });
    expect(api.posts[2].body.project.videoPlan?.shots[second.id]?.title).toBe("Continuous second scene");
    await act(async () => { api.finishShot(2, "New third scene"); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull());
    const result = storedProject(project);
    expect(result.videoPlan?.referenceModes).toEqual(project.videoPlan!.referenceModes);
    expect(result.videoPlan?.shots[second.id]).toMatchObject({ referenceMode: "continuous", previousClipId: first.id });
    expect(result.videoPlan?.shots[third.id]).toMatchObject({ referenceMode: "new", previousClipId: second.id });
    expect(result.timeline).toEqual(project.timeline);
    expect(generation.calls).toHaveLength(0);
  });

  it("rejects a mismatched generation mode without overwriting the saved shot", async () => {
    const project = fixtureProject([0]);
    const firstId = voices(project)[0].id;
    const saved = shotFor(project, firstId, "Original first shot");
    project.videoPlan!.shots[firstId] = saved; seed(project);
    const api = mockApi(); mockBridge(api.candidates);
    await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "批量重新设计画面与声音" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    await act(async () => { api.posts[0].resolve(Response.json({ storyboard: { ...shotFor(project, firstId), referenceMode: "continuous" } })); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull());
    expect(screen.getByRole("status", { name: "操作结果摘要" }).textContent).toContain("失败 1");
    expect(storedProject(project)).toEqual(project);
  });
});
