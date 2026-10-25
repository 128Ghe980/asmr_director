// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AsmrProject, TimelineClip } from "@/lib/asmr/schema";
import type { ClipPatch } from "@/lib/asmr/edit-project";
import { createInitialProjectLibrary, getCurrentLibraryEntry, loadProjectLibrary, saveProjectLibrary } from "@/lib/asmr/project-library";
import { getStoryboardReviewFingerprint, type StoryboardReview } from "@/lib/asmr/storyboard-review";
import { createClipVideoSourceFingerprint, getClipStoryboardReferenceContext, type ClipVideoStoryboard } from "@/lib/asmr/video-plan";
import { postProcessingProject } from "./audio-post-processing-test-fixture";
import { StudioApp } from "./studio-app";

const bridge = vi.hoisted(() => ({ generateClip: vi.fn(), generateProjectMix: vi.fn(), cancelGeneration: vi.fn(async () => {}) }));
const dialogMethods = ["showModal", "close"] as const;
const dialogDescriptors = dialogMethods.map(name => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
vi.mock("@/lib/asmr/local-generation-bridge", () => ({ createLocalGenerationBridge: () => bridge }));
vi.mock("./project-workspace", () => ({ ProjectWorkspace: ({ children, project, onCreateProject }: { children: ReactNode; project: AsmrProject; onCreateProject: () => void }) => <div>
  <output data-testid="review-project">{JSON.stringify(project)}</output><button onClick={onCreateProject}>切换测试工程</button>{children}</div> }));
vi.mock("./clip-inspector", () => ({ ClipInspector: ({ selectedClip, onUpdateClip }: { selectedClip: TimelineClip; onUpdateClip: (id: string, patch: ClipPatch) => void }) => <div>
  <button onClick={() => onUpdateClip(selectedClip.id, { volume_db: -7 })}>修改无关音量</button>
  <button onClick={() => onUpdateClip("voice_002", { text: "修改后文台词。" })}>修改后文台词</button></div> }));
vi.mock("./clip-storyboard-editor", () => ({ ClipStoryboardEditor: ({ project, onEdit }: { project: AsmrProject; onEdit: (id: string, patch: Partial<ClipVideoStoryboard>) => void }) => {
  const id = Object.keys(project.videoPlan?.shots ?? {})[0];
  return <button onClick={() => onEdit(id, { action: "User edited action" })}>手改已生成分镜</button>;
} }));
vi.mock("./planner-panel", () => ({ PlannerPanel: () => null }));
vi.mock("./timeline-panel", () => ({ TimelinePanel: () => null }));
vi.mock("./validation-panel", () => ({ ValidationPanel: () => null }));
vi.mock("./editor-panels", () => ({ EditorPanels: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

type Post = { url: string; body: { project: AsmrProject; editableClipIds?: string[]; clipId?: string; referenceMode?: "new" | "continuous" }; signal?: AbortSignal | null; finish: (response: Response) => void };
const pick = (shot: ClipVideoStoryboard) => ({ title: shot.title, visual: shot.visual, action: shot.action, camera: shot.camera, ...(shot.ambientSound === undefined ? {} : { ambientSound: shot.ambientSound }) });
function proposal(project: AsmrProject, ids = Object.keys(project.videoPlan!.shots)): StoryboardReview {
  return { inputFingerprint: getStoryboardReviewFingerprint(project), notes: ["保留原场景，只补交接完成。"], changes: ids.map(clipId => ({ clipId, reason: "动作需要完成。", before: pick(project.videoPlan!.shots[clipId]), after: { ...pick(project.videoPlan!.shots[clipId]), action: "Receives the coat and lowers it" } })) };
}
function mockApi() {
  const posts: Post[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/generation/clip" && init?.method !== "POST") return Response.json({ providers: [] });
    if (url === "/api/planner") return Response.json({ defaultProvider: "api", providers: [{ id: "api", configured: true }] });
    if (url.startsWith("/api/audio-candidates?")) return Response.json({ candidates: [] });
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [], duration: 1, sampleRate: 48000, channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    if (["/api/storyboard-review", "/api/clip-storyboard"].includes(url) && init?.method === "POST") return await new Promise<Response>(finish => posts.push({ url, body: JSON.parse(String(init.body)), signal: init.signal, finish }));
    throw new Error("Unexpected review UI request: " + url);
  }));
  return { posts, async finishReview(index: number, error?: string, override?: StoryboardReview) {
    const post = posts[index]; await act(async () => post.finish(error ? Response.json({ error }, { status: 500 }) : Response.json({ review: override ?? proposal(post.body.project, post.body.editableClipIds), provider: "api", model: "mock-review" })));
  }, async finishShot(index: number, error?: string) {
    const post = posts[index], project = post.body.project, id = post.body.clipId!, old = project.videoPlan!.shots[id];
    const reference = getClipStoryboardReferenceContext(project, id, post.body.referenceMode!);
    await act(async () => post.finish(error ? Response.json({ error }, { status: 500 }) : Response.json({ storyboard: { ...old,
      sourceFingerprint: createClipVideoSourceFingerprint(project, id), title: "新镜 " + id, visual: "New warm room", action: "Offers the coat", referenceMode: post.body.referenceMode,
      ...(reference ?? {}) }, provider: "api", model: "mock-storyboard" })));
  } };
}
function current(): AsmrProject { return JSON.parse(screen.getByTestId("review-project").textContent!); }
function stored(fallback: AsmrProject) { return getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, fallback)).project; }
async function mount(project = postProcessingProject()) {
  saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
  const view = render(<StrictMode><StudioApp project={project} /></StrictMode>);
  await waitFor(() => expect((screen.getByRole("button", { name: "分镜全部重新生成" }) as HTMLButtonElement).disabled).toBe(false));
  return { project, view };
}
function openMore() { const summary = screen.getByLabelText("批量更多操作"); if (!summary.closest("details")!.open) fireEvent.click(summary); }
function manual() { openMore(); fireEvent.click(screen.getByRole("button", { name: "整批校对" })); }
function regenerate() { openMore(); fireEvent.click(screen.getByRole("button", { name: "分镜全部重新生成" })); }
function openResults() {
  fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
  return screen.getByRole("dialog", { name: "操作结果" });
}
function closeResults() { fireEvent.click(within(screen.getByRole("dialog", { name: "操作结果" })).getByRole("button", { name: "关闭操作结果" })); }
beforeEach(() => {
  for (const name of dialogMethods) Object.defineProperty(HTMLDialogElement.prototype, name, { configurable: true, writable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.open = name === "showModal"; }) });
  window.localStorage.clear(); vi.clearAllMocks(); vi.spyOn(window, "confirm").mockReturnValue(true); for (const name of ["pause", "load"] as const) vi.spyOn(HTMLMediaElement.prototype, name).mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear();
  dialogMethods.forEach((name, index) => { const descriptor = dialogDescriptors[index]; if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, name); });
});

describe("whole-batch storyboard review UI", () => {
  it("previews legacy/manual shots before explicit apply and can undo without losing later DSP edits", async () => {
    const api = mockApi(), { project } = await mount(); const before = structuredClone(current().videoPlan);
    manual(); expect(api.posts).toHaveLength(1); expect(api.posts[0].body.editableClipIds).toHaveLength(2);
    expect(screen.getByText("整批校对中…")).toBeTruthy(); expect((screen.getByRole("button", { name: "生成后处理" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull(); expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    await api.finishReview(0); expect(current().videoPlan).toEqual(before); expect(stored(project).videoPlan).toEqual(before);
    expect(screen.queryByRole("button", { name: "应用修订" })).toBeNull();
    expect(screen.queryByRole("region", { name: "整批校对结果" })).toBeNull();
    const requestsBeforeViewing = vi.mocked(fetch).mock.calls.length;
    fireEvent.click(within(openResults()).getByRole("button", { name: "应用修订" }));
    expect(vi.mocked(fetch).mock.calls).toHaveLength(requestsBeforeViewing);
    expect(Object.values(stored(project).videoPlan!.shots)[0].action).toBe("Receives the coat and lowers it");
    closeResults();
    fireEvent.click(screen.getByRole("button", { name: "修改无关音量" }));
    fireEvent.click(within(openResults()).getByRole("button", { name: "撤回校对" }));
    expect(current().videoPlan).toEqual(before);
    expect(current().timeline.tracks.find(track => track.track_type === "voice")!.clips[0].volume_db).toBe(-7);
    expect(api.posts).toHaveLength(1); expect(bridge.generateClip).not.toHaveBeenCalled();
  });
  it("automatically reviews only this batch's newly saved shots once and persists their revisions", async () => {
    const api = mockApi(), { project } = await mount(); regenerate();
    await waitFor(() => expect(api.posts).toHaveLength(1)); await api.finishShot(0);
    await waitFor(() => expect(api.posts).toHaveLength(2)); await api.finishShot(1);
    await waitFor(() => expect(api.posts).toHaveLength(3)); expect(api.posts[2].url).toBe("/api/storyboard-review");
    expect(api.posts[2].body.editableClipIds).toEqual(["voice_001", "voice_002"]);
    await api.finishReview(2);
    expect((await screen.findByRole("status", { name: "操作结果摘要" })).textContent).toContain("校对已应用 2 镜");
    expect(Object.values(stored(project).videoPlan!.shots).every(shot => shot.action === "Receives the coat and lowers it")).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(openResults()).queryByRole("button", { name: "应用修订" })).toBeNull(); expect(api.posts).toHaveLength(3);
  });
  it.each(["project", "workspace"] as const)("clears a viewed review when changing %s without another review request", async change => {
    const api = mockApi(); await mount(); manual(); await api.finishReview(0);
    const dialog = openResults();
    expect(within(dialog).getByRole("button", { name: "应用修订" })).toBeTruthy();
    closeResults();
    if (change === "project") fireEvent.click(screen.getByRole("button", { name: "切换测试工程" }));
    else fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "查看结果" })).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.queryByRole("region", { name: "整批校对结果" })).toBeNull();
    if (change === "workspace") {
      fireEvent.click(screen.getByRole("tab", { name: "短句" }));
      expect(screen.queryByRole("button", { name: "查看结果" })).toBeNull();
    }
    expect(api.posts).toHaveLength(1);
  });
  it("preserves all generated shots if automatic review fails and leaves post-processing available", async () => {
    const api = mockApi(); await mount(); regenerate();
    await waitFor(() => expect(api.posts).toHaveLength(1)); await api.finishShot(0); await waitFor(() => expect(api.posts).toHaveLength(2)); await api.finishShot(1);
    await waitFor(() => expect(api.posts).toHaveLength(3)); await api.finishReview(2, "校对服务暂时断开。");
    await screen.findByRole("status", { name: "操作结果摘要" });
    expect(within(openResults()).getByText(/已有分镜保留，可继续后处理或导出/)).toBeTruthy();
    expect(Object.values(current().videoPlan!.shots).every(shot => shot.action === "Offers the coat")).toBe(true);
    closeResults();
    expect((screen.getByRole("button", { name: "生成后处理" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("releases a cancelled automatic review immediately and ignores its late response during a fresh manual review", async () => {
    const api = mockApi(); await mount(); regenerate(); await waitFor(() => expect(api.posts).toHaveLength(1)); await api.finishShot(0);
    await waitFor(() => expect(api.posts).toHaveLength(2)); await api.finishShot(1); await waitFor(() => expect(api.posts).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "取消整批校对" })); expect(api.posts[2].signal?.aborted).toBe(true);
    manual(); expect(api.posts).toHaveLength(4); await api.finishReview(2);
    expect(screen.getByText("整批校对中…")).toBeTruthy(); expect(screen.queryByRole("button", { name: "应用修订" })).toBeNull();
    await api.finishReview(3); expect(within(openResults()).getByRole("button", { name: "应用修订" })).toBeTruthy();
    expect(Object.values(current().videoPlan!.shots).every(shot => shot.action === "Offers the coat")).toBe(true);
  });
  it("does not make an automatic edit to a newly generated shot that was hand-edited during the batch", async () => {
    const api = mockApi(); await mount(); fireEvent.click(screen.getByRole("tab", { name: "分镜" })); regenerate();
    await waitFor(() => expect(api.posts).toHaveLength(1)); await api.finishShot(0); await waitFor(() => expect(api.posts).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "手改已生成分镜" })); await api.finishShot(1);
    expect(within(openResults()).getByText(/本轮没有未修改的新分镜/)).toBeTruthy();
    expect(current().videoPlan!.shots.voice_001.action).toBe("User edited action");
    expect(api.posts.some(post => post.url === "/api/storyboard-review")).toBe(false);
  });
  it("skips automatic review when a failed remaining shot leaves the batch incomplete", async () => {
    const api = mockApi(), project = postProcessingProject(); delete project.videoPlan!.shots.voice_002;
    await mount(project); regenerate(); await waitFor(() => expect(api.posts).toHaveLength(1)); await api.finishShot(0);
    await waitFor(() => expect(api.posts).toHaveLength(2)); await api.finishShot(1, "本镜未能生成。");
    expect(within(openResults()).getByText(/本轮未自动校对/)).toBeTruthy();
    expect(current().videoPlan!.shots.voice_001.action).toBe("Offers the coat");
    expect(api.posts.some(post => post.url === "/api/storyboard-review")).toBe(false);
  });
  it("keeps newly generated shots if automatic revisions cannot be saved", async () => {
    const api = mockApi(); await mount(); regenerate(); await waitFor(() => expect(api.posts).toHaveLength(1)); await api.finishShot(0);
    await waitFor(() => expect(api.posts).toHaveLength(2)); await api.finishShot(1); await waitFor(() => expect(api.posts).toHaveLength(3));
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) { if (String(value).includes("Receives the coat")) throw new Error("synthetic storage full"); originalSet.call(this, key, value); });
    await api.finishReview(2); expect(within(openResults()).getByText(/校对修订未能保存/)).toBeTruthy();
    expect(Object.values(current().videoPlan!.shots).every(shot => shot.action === "Offers the coat")).toBe(true);
  });
  it("cannot undo over a later storyboard edit", async () => {
    const api = mockApi(); await mount(); manual(); await api.finishReview(0); fireEvent.click(within(openResults()).getByRole("button", { name: "应用修订" }));
    closeResults();
    fireEvent.click(screen.getByRole("tab", { name: "分镜" })); fireEvent.click(screen.getByRole("button", { name: "手改已生成分镜" }));
    const dialog = openResults();
    expect((within(dialog).getByRole("button", { name: "撤回校对" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "撤回校对" })); expect(current().videoPlan!.shots.voice_001.action).toBe("User edited action");
  });
  it("does not apply a late review after a storyboard edit and refuses a pending proposal after later edits", async () => {
    const api = mockApi(); await mount(); fireEvent.click(screen.getByRole("tab", { name: "分镜" })); manual(); fireEvent.click(screen.getByRole("button", { name: "手改已生成分镜" }));
    expect(api.posts[0].signal?.aborted).toBe(true); await api.finishReview(0); expect(screen.queryByRole("button", { name: "应用修订" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "声音" })); manual(); await api.finishReview(1); fireEvent.click(screen.getByRole("button", { name: "修改后文台词" }));
    expect((within(openResults()).getByRole("button", { name: "应用修订" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it.each(["cancel", "project", "workspace", "unmount"] as const)("ignores the late review and clears pending state after %s", async change => {
    const api = mockApi(), { view } = await mount(); manual();
    if (change === "cancel") fireEvent.click(screen.getByRole("button", { name: "取消整批校对" }));
    else if (change === "project") fireEvent.click(screen.getByRole("button", { name: "切换测试工程" }));
    else if (change === "workspace") fireEvent.click(screen.getByRole("tab", { name: "整段" })); else view.unmount();
    expect(api.posts[0].signal?.aborted).toBe(true); await api.finishReview(0);
    expect(screen.queryByRole("button", { name: "应用修订" })).toBeNull();
  });
  it("keeps original storyboards intact when saving an explicit revision fails", async () => {
    const api = mockApi(); await mount(); const before = structuredClone(current().videoPlan); manual(); await api.finishReview(0);
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) { if (String(value).includes("Receives the coat")) throw new Error("synthetic storage full"); originalSet.call(this, key, value); });
    fireEvent.click(within(openResults()).getByRole("button", { name: "应用修订" }));
    expect(current().videoPlan).toEqual(before); expect(within(screen.getByRole("dialog", { name: "操作结果" })).getByText(/校对修订未能保存/)).toBeTruthy();
  });
  it("discards a generated shot if a following line changes while its request is pending", async () => {
    const api = mockApi(); await mount(); regenerate(); await waitFor(() => expect(api.posts).toHaveLength(1));
    const before = current().videoPlan!.shots.voice_001;
    fireEvent.click(screen.getByRole("button", { name: "修改后文台词" })); await api.finishShot(0);
    await waitFor(() => expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull());
    expect(current().videoPlan!.shots.voice_001).toEqual(before); expect(api.posts.some(post => post.url === "/api/storyboard-review")).toBe(false);
  });
});
