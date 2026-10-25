// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AsmrProject, TimelineClip } from "@/lib/asmr/schema";
import type { ClipPatch } from "@/lib/asmr/edit-project";
import { createInitialProjectLibrary, getCurrentLibraryEntry, loadProjectLibrary, saveProjectLibrary } from "@/lib/asmr/project-library";
import { getAudioPostProcessingClips, getAudioPostProcessingSummary } from "@/lib/asmr/audio-post-processing";
import { postProcessingPlan, postProcessingProject, postProcessingReceipt } from "./audio-post-processing-test-fixture";
import { StudioApp } from "./studio-app";

const bridge = vi.hoisted(() => ({ generateClip: vi.fn(), generateProjectMix: vi.fn(), cancelGeneration: vi.fn(async () => {}) }));
const dialogMethods = ["showModal", "close"] as const;
const dialogDescriptors = dialogMethods.map(name => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
vi.mock("@/lib/asmr/local-generation-bridge", () => ({ createLocalGenerationBridge: () => bridge }));
vi.mock("./project-workspace", () => ({ ProjectWorkspace: ({ children, project, onCreateProject }: { children: ReactNode; project: AsmrProject; onCreateProject: () => void }) => <div>
  <output data-testid="post-project">{JSON.stringify(project)}</output><button onClick={onCreateProject}>切换测试工程</button>{children}</div> }));
vi.mock("./clip-inspector", () => ({ ClipInspector: ({ selectedClip, onUpdateClip }: { selectedClip: TimelineClip; onUpdateClip: (id: string, patch: ClipPatch) => void }) => <div>
  <button onClick={() => onUpdateClip(selectedClip.id, { volume_db: -7 })}>修改处理参数</button>
  <button onClick={() => onUpdateClip(selectedClip.id, { text: "已修改的合成台词。" })}>修改处理原稿</button></div> }));
vi.mock("./planner-panel", () => ({ PlannerPanel: () => null }));
vi.mock("./timeline-panel", () => ({ TimelinePanel: () => null }));
vi.mock("./validation-panel", () => ({ ValidationPanel: () => null }));
vi.mock("./editor-panels", () => ({ EditorPanels: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

type Post = { url: string; body: { project: AsmrProject; provider?: string; clipId?: string }; signal?: AbortSignal | null; finish: (response: Response) => void };
function mockApi() {
  const posts: Post[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/generation/clip" && init?.method !== "POST") return Response.json({ providers: [] });
    if (url.startsWith("/api/audio-candidates?")) return Response.json({ candidates: [] });
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [], duration: 1, sampleRate: 48000, channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    if (url.startsWith("/api/audio-post-processing/") && init?.method === "POST") return await new Promise<Response>(finish => {
      posts.push({ url, body: JSON.parse(String(init.body)), signal: init.signal, finish });
    });
    throw new Error("Unexpected post-processing UI request: " + url);
  });
  vi.stubGlobal("fetch", fetcher);
  return { posts, fetcher,
    async finishPlan(index = 0) {
      const post = posts[index];
      await act(async () => post.finish(Response.json({ processing: post.body.project.audioPostProcessing ?? postProcessingPlan(post.body.project) })));
    },
    async finishRender(index: number, failed = false) {
      const post = posts[index];
      await act(async () => post.finish(failed ? Response.json({ error: "合成渲染故障" }, { status: 500 })
        : Response.json({ receipt: postProcessingReceipt(post.body.project, post.body.clipId!) })));
    },
  };
}
function current(): AsmrProject { return JSON.parse(screen.getByTestId("post-project").textContent!); }
function stored(fallback: AsmrProject) { return getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, fallback)).project; }
function openResults() {
  fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
  return screen.getByRole("dialog", { name: "操作结果" });
}
function closeResults() { fireEvent.click(within(screen.getByRole("dialog", { name: "操作结果" })).getByRole("button", { name: "关闭操作结果" })); }
async function mount(project = postProcessingProject()) {
  saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
  const view = render(<StrictMode><StudioApp project={project} /></StrictMode>);
  await waitFor(() => expect((screen.getByRole("button", { name: "生成后处理" }) as HTMLButtonElement).disabled).toBe(false));
  await act(async () => {});
  return { project, view };
}
beforeEach(() => {
  for (const name of dialogMethods) Object.defineProperty(HTMLDialogElement.prototype, name, { configurable: true, writable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.open = name === "showModal"; }) });
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear();
  dialogMethods.forEach((name, index) => { const descriptor = dialogDescriptors[index]; if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, name); });
});

describe("explicit audio post-processing flow", () => {
  it("persists the plan before serial rendering, saves each result, and leaves adopted raw assets intact", async () => {
    const api = mockApi(); const { project } = await mount();
    const originals = getAudioPostProcessingClips(current()).map(clip => clip.asset);
    expect(api.posts).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "生成后处理" }));
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0].body.provider).toBe("api");
    expect(screen.getByText("正在设计后处理…")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull(); expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "分镜全部生成" }) as HTMLButtonElement).disabled).toBe(true);
    await api.finishPlan();
    await waitFor(() => expect(api.posts).toHaveLength(2));
    expect(stored(project).audioPostProcessing?.shots).toHaveLength(2);
    expect(api.posts[1].url).toBe("/api/audio-post-processing/render");
    expect(api.posts[1].body.project.audioPostProcessing?.shots).toHaveLength(2);
    await api.finishRender(1);
    await waitFor(() => expect(api.posts).toHaveLength(3));
    expect(Object.keys(stored(project).audioPostProcessing!.results)).toHaveLength(1);
    expect(Object.keys(api.posts[2].body.project.audioPostProcessing!.results)).toHaveLength(1);
    await api.finishRender(2);
    await screen.findByText(/后处理结束：完成 2\/2 镜/);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("region", { name: "音频后处理结果" })).toBeNull();
    expect(getAudioPostProcessingSummary(stored(project)).complete).toBe(true);
    expect(getAudioPostProcessingClips(current()).map(clip => clip.asset)).toEqual(originals);
    expect(bridge.generateClip).not.toHaveBeenCalled();
    expect(bridge.generateProjectMix).not.toHaveBeenCalled();
    expect(api.fetcher.mock.calls.some(call => String(call[0]).includes("/api/assets/spatial/"))).toBe(false);
    // Re-entry still asks the server to validate cached files, even with all receipts current.
    fireEvent.click(screen.getByRole("button", { name: "生成后处理" }));
    await api.finishPlan(3);
    await waitFor(() => expect(api.posts).toHaveLength(5));
    expect(api.posts[4].url).toBe("/api/audio-post-processing/render");
    fireEvent.click(screen.getByRole("button", { name: "取消后处理" }));
  });

  it("continues after one render fails and keeps the other result independently playable", async () => {
    const api = mockApi(); const { project } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "生成后处理" }));
    await api.finishPlan(); await waitFor(() => expect(api.posts).toHaveLength(2));
    await api.finishRender(1, true); await waitFor(() => expect(api.posts).toHaveLength(3));
    await api.finishRender(2);
    await screen.findByText(/后处理结束：完成 1\/2 镜，失败 1 镜/);
    expect(Object.keys(stored(project).audioPostProcessing!.results)).toHaveLength(1);
    expect(screen.queryByLabelText("逐镜后处理结果")).toBeNull();
    const requestCount = api.fetcher.mock.calls.length, dialog = openResults();
    expect(api.fetcher.mock.calls).toHaveLength(requestCount);
    fireEvent.click(within(dialog).getByLabelText("逐镜后处理结果"));
    await within(dialog).findByLabelText("第 2 镜后处理试听");
    expect(within(dialog).getByLabelText("第 2 镜后处理试听").getAttribute("src")).toBe("/api/assets/clip/processed_1");
    closeResults();
    expect(screen.queryByLabelText("第 2 镜后处理试听")).toBeNull();
  });

  it("stops before rendering when the plan cannot be persisted", async () => {
    const api = mockApi(); await mount();
    fireEvent.click(screen.getByRole("button", { name: "生成后处理" }));
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (String(value).includes('"audioPostProcessing"')) throw new Error("synthetic storage full");
      originalSet.call(this, key, value);
    });
    await api.finishPlan();
    await screen.findByText(/后处理记录未能保存/);
    expect(api.posts).toHaveLength(1);
    expect(current().audioPostProcessing).toBeUndefined();
  });

  it("stops the batch instead of continuing when a rendered result cannot be saved", async () => {
    const api = mockApi(); await mount();
    fireEvent.click(screen.getByRole("button", { name: "生成后处理" }));
    await api.finishPlan(); await waitFor(() => expect(api.posts).toHaveLength(2));
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (String(value).includes('"processed_0"')) throw new Error("synthetic storage full");
      originalSet.call(this, key, value);
    });
    await api.finishRender(1);
    await screen.findByText(/后处理记录未能保存/);
    expect(api.posts).toHaveLength(2);
    expect(current().audioPostProcessing?.results).toEqual({});
  });

  it("cancels immediately and ignores a late render while retaining the first saved result", async () => {
    const api = mockApi(); const { project } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "生成后处理" }));
    await api.finishPlan(); await waitFor(() => expect(api.posts).toHaveLength(2));
    await api.finishRender(1); await waitFor(() => expect(api.posts).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "取消后处理" }));
    expect(api.posts[2].signal?.aborted).toBe(true);
    await api.finishRender(2);
    expect(Object.keys(stored(project).audioPostProcessing!.results)).toHaveLength(1);
    expect(screen.getByText(/已取消后处理/)).toBeTruthy();
  });

  it.each(["修改处理参数", "修改处理原稿"])("does not apply a late plan after %s", async (button) => {
    const api = mockApi(); await mount();
    fireEvent.click(screen.getByRole("button", { name: "生成后处理" }));
    fireEvent.click(screen.getByRole("button", { name: button }));
    expect(api.posts[0].signal?.aborted).toBe(true);
    await api.finishPlan();
    expect(api.posts).toHaveLength(1);
    expect(current().audioPostProcessing).toBeUndefined();
    expect(screen.getByText(/工程或处理设置已修改/)).toBeTruthy();
  });

  it.each(["project", "workspace", "unmount"] as const)("releases a pending plan and rejects its late response after %s", async (change) => {
    const api = mockApi(); const { view } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "生成后处理" }));
    if (change === "project") fireEvent.click(screen.getByRole("button", { name: "切换测试工程" }));
    else if (change === "workspace") fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    else view.unmount();
    expect(api.posts[0].signal?.aborted).toBe(true);
    await api.finishPlan();
    expect(api.posts).toHaveLength(1);
    if (change !== "unmount") expect(current().audioPostProcessing).toBeUndefined();
  });
});
