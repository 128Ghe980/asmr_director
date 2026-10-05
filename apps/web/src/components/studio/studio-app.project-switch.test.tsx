// @vitest-environment jsdom

import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoProject } from "@/lib/asmr/mock-project";
import { PlannerBriefSchema, compilePlannerDraft, type PlannerDraft, type PlannerSource } from "@/lib/asmr/planner";
import { PLANNER_DRAFT_STORAGE_KEY, createEmptyPlannerWorkingState, getPlannerDraftStorageKey, loadPlannerDraft, savePlannerDraft } from "@/lib/asmr/planner-persistence";
import { createInitialProjectLibrary, createLibraryProject, getCurrentLibraryEntry, loadProjectLibrary, saveProjectLibrary, type ProjectLibrarySummary } from "@/lib/asmr/project-library";
import type { AudioAnalysis } from "@/lib/asmr/audio-analysis";
import type { AsmrProject } from "@/lib/asmr/schema";
import { createStoryboardSourceFingerprint } from "@/lib/asmr/storyboard";
import { StudioApp } from "./studio-app";

vi.mock("./project-workspace", () => ({ ProjectWorkspace: ({ children, project, projects, onCreateProject, onSelectProject, audioAnalysis }: {
  children: ReactNode; project: AsmrProject; projects: ProjectLibrarySummary[]; onCreateProject: () => void; onSelectProject: (id: string) => void;
  audioAnalysis?: AudioAnalysis;
}) => <div><output data-testid="current-project">{JSON.stringify(project)}</output><output data-testid="analysis-duration">{audioAnalysis?.duration ?? "none"}</output><button onClick={onCreateProject}>新建项目</button>
  <nav aria-label="项目列表">{projects.map((entry) => <button key={entry.projectId} data-project-id={entry.projectId} onClick={() => onSelectProject(entry.projectId)}>{entry.title}</button>)}</nav>{children}</div> }));
vi.mock("./timeline-panel", () => ({ TimelinePanel: () => null }));
vi.mock("./validation-panel", () => ({ ValidationPanel: () => null }));
vi.mock("./editor-panels", () => ({ EditorPanels: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const brief = PlannerBriefSchema.parse({ theme: "旧项目的夜间书店", durationSeconds: 180 });
const draft: PlannerDraft = {
  title: "已有书店项目", scene: "原稿的安静书店", character: { role: "店员", personality: ["自然"], speechStyle: ["轻声"] },
  sections: [0, 1].map((index) => ({ id: `source_${index}`, title: `原稿第 ${index + 1} 段`, text: `旧项目独有的第 ${index + 1} 句台词。`,
    emotion: "平静", style: "轻声", pace: "缓慢", direction: "", soundSuggestions: "", pauseAfter: "medium",
    position: { pan: 0, distance: "near", movement: "static" } })),
};
const source: PlannerSource = { brief, draft, sceneDescription: "原稿的旧剧情背景" };
const catalog = { providers: [
  { id: "gpt-sovits", label: "GPT-SoVITS", available: true, defaultReferenceId: "default", references: [{ id: "default", label: "原声音", referenceModes: ["with_reference_text"] }] },
  { id: "voxcpm2", label: "VoxCPM2", available: true, defaultReferenceId: "soft", references: [{ id: "soft", label: "柔和声音", referenceModes: ["reference_only"] }], longText: { available: true, apiConfigured: true } },
] };
function oldProject() {
  const project = compilePlannerDraft(brief, draft, "old_project");
  project.videoPlan = { version: 1, sceneDescription: "旧工程分镜的剧情背景", shots: {} };
  project.timeline.tracks = project.timeline.tracks.map((track) => track.track_type === "voice" ? { ...track, clips: track.clips.map((clip, index) => ({
    ...clip, asset: { asset_id: `old_audio_${index}`, uri: `asset://clip/old_audio_${index}`, duration: clip.duration },
    generation: { ...clip.generation, status: "asset_generated" as const },
  })) } : track);
  return project;
}
function seed(project = oldProject(), withSource = true) {
  const library = createInitialProjectLibrary(project);
  if (withSource) library.projects[0].plannerSource = structuredClone(source);
  saveProjectLibrary(window.localStorage, library); return project;
}
function seedLegacy() {
  const state = { ...createEmptyPlannerWorkingState(), brief: { ...brief, theme: "旧项目尚未采用的新主题" }, draftBrief: brief,
    draft: structuredClone(draft), sceneDescription: "旧项目未采用的场景草稿" };
  savePlannerDraft(window.localStorage, state); return state;
}
function deferredResponse() { let resolve!: (response: Response) => void; const promise = new Promise<Response>((done) => { resolve = done; }); return { resolve, promise }; }
function mockApi() {
  const posts: { url: string; body: Record<string, unknown>; signal?: AbortSignal | null; response: ReturnType<typeof deferredResponse> }[] = [];
  const analyses: { signal?: AbortSignal | null; response: ReturnType<typeof deferredResponse> }[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/generation/clip" && init?.method !== "POST") return Response.json(catalog);
    if (url === "/api/planner" && init?.method !== "POST") return Response.json({ providers: [{ id: "ollama", label: "本地", model: "project-switch-fixture", configured: true }], defaultProvider: "ollama" });
    if ((url === "/api/planner" || url === "/api/scene-description") && init?.method === "POST") {
      const response = deferredResponse(); posts.push({ url, body: JSON.parse(String(init.body)), signal: init.signal, response }); return response.promise;
    }
    if (url.startsWith("/api/audio-candidates?")) return Response.json({ candidates: [] });
    if (url.startsWith("/api/voice-generation-recordings?")) return Response.json({ recordings: [], nextCursor: null });
    if (url.startsWith("/api/assets/analysis")) { const response = deferredResponse(); analyses.push({ signal: init?.signal, response }); return response.promise; }
    throw new Error(`Unexpected project-switch test request: ${url}`);
  }));
  return { posts, analyses };
}
function control(name: string) { return screen.getByLabelText(name) as HTMLInputElement | HTMLTextAreaElement; }
function currentProject(): AsmrProject { return JSON.parse(screen.getByTestId("current-project").textContent!); }
async function mount() {
  const view = render(<StrictMode><StudioApp project={demoProject} /></StrictMode>);
  await waitFor(() => expect(screen.getByRole("button", { name: "已有书店项目" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "AI 创意策划" }));
  await waitFor(() => expect(control("今日主题").disabled).toBe(false)); return view;
}
beforeEach(() => {
  window.localStorage.clear(); vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("StudioApp project boundaries with the actual planner and inspector", () => {
  it("opens a new project's own planning workspace, flushes edits before autosave and restores the old project on return", async () => {
    const original = seed(); const legacy = seedLegacy(); const rawLegacy = window.localStorage.getItem(PLANNER_DRAFT_STORAGE_KEY); mockApi(); await mount();
    expect(control("今日主题").value).toBe(legacy.brief.theme);
    fireEvent.change(control("第 1 段台词"), { target: { value: "刚修改，尚未到 300 毫秒保存的旧项目台词。" } });
    fireEvent.click(screen.getByRole("tab", { name: "场景" }));
    fireEvent.change(control("剧情背景"), { target: { value: "刚修改的旧项目场景，回切必须保留。" } });
    fireEvent.click(screen.getByRole("button", { name: "新建项目" })); const createdId = currentProject().project_id;
    expect(createdId).not.toBe(original.project_id);
    await waitFor(() => expect(control("今日主题").value).toBe(""));
    expect(screen.queryByLabelText("第 1 段台词")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "场景" })); expect(screen.queryByLabelText("剧情背景")).toBeNull();
    expect(loadPlannerDraft(window.localStorage, original.project_id).state.draft?.sections[0].text).toContain("刚修改");
    expect(loadPlannerDraft(window.localStorage, original.project_id).state.sceneDescription).toBe("刚修改的旧项目场景，回切必须保留。");
    fireEvent.change(control("今日主题"), { target: { value: "新项目专属主题" } });
    fireEvent.click(screen.getByRole("button", { name: "已有书店项目" }));
    await waitFor(() => expect(control("今日主题").value).toBe(legacy.brief.theme));
    expect(control("第 1 段台词").value).toContain("刚修改");
    fireEvent.click(screen.getByRole("tab", { name: "场景" })); expect(control("剧情背景").value).toBe("刚修改的旧项目场景，回切必须保留。");
    const library = loadProjectLibrary(window.localStorage, demoProject);
    expect(library.projects.find((entry) => entry.projectId === original.project_id)?.plannerSource).toEqual(source);
    expect(currentProject()).toEqual(original);
    expect(window.localStorage.getItem(PLANNER_DRAFT_STORAGE_KEY)).toBe(rawLegacy);
    fireEvent.click(screen.getByRole("button", { name: "未命名项目" }));
    await waitFor(() => expect(control("今日主题").value).toBe("新项目专属主题"));
    expect(currentProject().project_id).toBe(createdId);
  });

  it("leaves unattributed legacy content hidden after reloading an already-created new project and supports reversible explicit recovery", async () => {
    seed();
    const previouslyCreated = createLibraryProject(loadProjectLibrary(window.localStorage, demoProject), demoProject, new Date("2026-10-05T00:00:00.000Z"));
    const unrelated = getCurrentLibraryEntry(previouslyCreated).project; saveProjectLibrary(window.localStorage, previouslyCreated);
    const legacy = seedLegacy(); const rawLegacy = window.localStorage.getItem(PLANNER_DRAFT_STORAGE_KEY); mockApi(); const view = await mount();
    expect(control("今日主题").value).toBe(""); expect(screen.queryByLabelText("第 1 段台词")).toBeNull();
    expect(screen.getByRole("button", { name: "恢复旧版策划草稿", hidden: true })).toBeTruthy();
    fireEvent.change(control("今日主题"), { target: { value: "当前项目先写下的主题" } });
    fireEvent.click(screen.getByText("恢复旧版草稿")); fireEvent.click(screen.getByRole("button", { name: "恢复旧版策划草稿" }));
    expect(control("今日主题").value).toBe(legacy.brief.theme); expect(control("第 1 段台词").value).toBe(draft.sections[0].text);
    fireEvent.click(screen.getByRole("button", { name: "撤回修改" })); expect(control("今日主题").value).toBe("当前项目先写下的主题");
    expect(screen.queryByLabelText("第 1 段台词")).toBeNull();
    view.unmount(); await mount(); expect(control("今日主题").value).toBe("当前项目先写下的主题");
    expect(currentProject().project_id).toBe(unrelated.project_id); expect(window.localStorage.getItem(PLANNER_DRAFT_STORAGE_KEY)).toBe(rawLegacy);
  });

  it.each(["planner", "scene"] as const)("cancels an old %s request on project switch and ignores its late response", async (kind) => {
    const original = seed(); seedLegacy(); const api = mockApi(); await mount();
    if (kind === "planner") fireEvent.click(screen.getByRole("button", { name: "重新生成策划稿" }));
    else { fireEvent.click(screen.getByRole("tab", { name: "场景" })); fireEvent.click(screen.getByRole("button", { name: "重新生成背景" })); }
    await waitFor(() => expect(api.posts).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "新建项目" })); const createdId = currentProject().project_id;
    await waitFor(() => expect(control("今日主题").value).toBe("")); expect(api.posts[0].signal?.aborted).toBe(true);
    const lateDraft = { ...draft, title: "不应落到新项目的晚到结果" };
    await act(async () => api.posts[0].response.resolve(Response.json(kind === "planner" ? { draft: lateDraft }
      : { sceneDescription: "不应落到新项目的晚到背景", sourceFingerprint: createStoryboardSourceFingerprint(draft) })));
    expect(control("今日主题").value).toBe(""); expect(screen.queryByLabelText("第 1 段台词")).toBeNull();
    expect(loadPlannerDraft(window.localStorage, createdId).state.draft).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "已有书店项目" }));
    await waitFor(() => expect(control("今日主题").value).toBe("旧项目尚未采用的新主题"));
    expect(control("文案标题").value).toBe(draft.title);
    fireEvent.click(screen.getByRole("tab", { name: "场景" })); expect(control("剧情背景").value).toBe("旧项目未采用的场景草稿");
    expect(currentProject().project_id).toBe(original.project_id);
  });

  it("resets inspector selection to the new project's clip and uses its own scene when switching back", async () => {
    const original = seed(); seedLegacy(); mockApi(); await mount();
    fireEvent.click(screen.getByRole("button", { name: "工程编辑" }));
    const script = screen.getByLabelText("文案与分段");
    fireEvent.click(within(script).getByRole("button", { name: "选择第 2 段" }));
    fireEvent.click(screen.getByRole("tab", { name: "分镜" }));
    await waitFor(() => expect(control("工程剧情背景").value).toBe("旧工程分镜的剧情背景"));
    expect(screen.getByLabelText("本段视频分镜").textContent).toContain(draft.sections[1].text);
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    expect(screen.getByRole("tab", { name: "声音" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByLabelText("本段视频分镜")).toBeNull();
    expect(screen.getByLabelText("当前范围文本").textContent).not.toContain("旧项目独有");
    fireEvent.click(screen.getByRole("button", { name: "已有书店项目" }));
    fireEvent.click(screen.getByRole("tab", { name: "分镜" }));
    await waitFor(() => expect(screen.getByLabelText("本段视频分镜").textContent).toContain(draft.sections[0].text));
    expect(control("工程剧情背景").value).toBe("旧工程分镜的剧情背景");
    expect(currentProject()).toEqual(original);
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, demoProject)).project).toEqual(original);
    expect(window.localStorage.getItem(getPlannerDraftStorageKey(original.project_id))).toBeTruthy();
  });

  it("keeps the current draft in memory on return even if its switch-time storage write fails", async () => {
    const project = seed(); mockApi(); await mount();
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === getPlannerDraftStorageKey(project.project_id)) throw new Error("quota");
      originalSetItem.call(this, key, value);
    });
    fireEvent.change(control("第 1 段台词"), { target: { value: "保存失败也要在回切时保留的修改。" } });
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    await waitFor(() => expect(control("今日主题").value).toBe(""));
    fireEvent.click(screen.getByRole("button", { name: "已有书店项目" }));
    await waitFor(() => expect(control("第 1 段台词").value).toBe("保存失败也要在回切时保留的修改。"));
    expect(currentProject()).toEqual(project);
  });

  it("ignores an old project's late audio-analysis response after creating a project with no adopted audio", async () => {
    seed(); const api = mockApi(); await mount();
    await waitFor(() => expect(api.analyses.length).toBeGreaterThan(0));
    const oldAnalysis = api.analyses.at(-1)!;
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    await waitFor(() => expect(oldAnalysis.signal?.aborted).toBe(true));
    await act(async () => oldAnalysis.response.resolve(Response.json({ analysis: { bars: [10], duration: 999, sampleRate: 48000, channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } })));
    expect(screen.getByTestId("analysis-duration").textContent).toBe("none");
  });
});
