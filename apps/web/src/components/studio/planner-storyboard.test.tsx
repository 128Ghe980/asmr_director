// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlannerBriefSchema, type PlannerDraft, type PlannerSource } from "@/lib/asmr/planner";
import { createEmptyPlannerWorkingState, loadPlannerDraft, savePlannerDraft } from "@/lib/asmr/planner-persistence";
import { createStoryboardSourceFingerprint, type PlannerStoryboard } from "@/lib/asmr/storyboard";
import { PlannerPanel } from "./planner-panel";

const brief = PlannerBriefSchema.parse({ theme: "关门前的书店" });
const originalScene = "雪地中的木屋内，壁炉温暖，窗外飘雪。";
function makeDraft(title = "最后一盏阅读灯"): PlannerDraft {
  return {
    title, scene: "下雨的夜晚，书店准备关门。",
    character: { role: "书店店员", personality: ["自然"], speechStyle: ["轻声"] },
    sections: ["进来坐一会儿，外面雨有点大。", "这本书放在这里，你慢慢翻。", "灯会再亮一会儿，不用着急。"].map((text, index) => ({
      id: `unit_${index + 1}`, title: `小段 ${index + 1}`, text, emotion: "温柔", style: "自然", pace: "缓慢", direction: "轻轻翻页", soundSuggestions: "书页声",
      pauseAfter: "medium", position: { pan: 0, distance: "near", movement: "static" },
    })),
  };
}
function makeLegacyBoard(draft: PlannerDraft): PlannerStoryboard {
  return { version: 1, title: "原有分镜", sourceFingerprint: createStoryboardSourceFingerprint(draft), promptFormat: "minimax-h3",
    shots: [{ id: "shot_1", title: "雨夜书店", sourceSectionIds: draft.sections.map((section) => section.id), visual: "Existing visual notes.", action: "Existing action notes.", camera: "Existing camera notes." }] };
}
function control(label: string) { return screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; }
function seed(sceneDescription: string | null = null, legacy = false, draft = makeDraft()) {
  const storyboard = legacy ? makeLegacyBoard(draft) : null;
  expect(savePlannerDraft(window.localStorage, { ...createEmptyPlannerWorkingState(), brief, draftBrief: brief, draft, provider: "api", storyboard, sceneDescription })).toEqual({ success: true });
  return { draft, storyboard, sceneDescription };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function mockSceneApi(configured = true) {
  const responses: Promise<Response>[] = [];
  const posts: { body: Record<string, unknown>; signal?: AbortSignal | null }[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) === "/api/planner" && init?.method !== "POST") return Response.json({ providers: [{ id: "api", label: "外部 API", model: "fixture-scene", configured }], defaultProvider: "api" });
    expect(String(input)).toBe("/api/scene-description"); expect(init?.method).toBe("POST");
    posts.push({ body: JSON.parse(String(init?.body)), signal: init?.signal });
    const response = responses.shift(); if (!response) throw new Error("Unexpected scene request");
    // Deliberately settle after abort: the component must protect against late responses.
    return await response;
  }));
  return { posts, respond: (response: Response | Promise<Response>) => responses.push(Promise.resolve(response)) };
}
function sceneResponse(draft: PlannerDraft, sceneDescription = originalScene) { return Response.json({ sceneDescription, sourceFingerprint: createStoryboardSourceFingerprint(draft), provider: "api", model: "fixture-scene" }); }
async function mountPanel(source?: PlannerSource, onAdopt = vi.fn()) {
  const view = render(<StrictMode><PlannerPanel source={source} onAdopt={onAdopt} /></StrictMode>);
  await waitFor(() => { expect(control("今日主题").disabled).toBe(false); expect(screen.getByText(/fixture-scene/)).toBeTruthy(); });
  return { ...view, onAdopt };
}
function showScene() { fireEvent.click(screen.getByRole("tab", { name: "场景" })); }
function showScript() { fireEvent.click(screen.getByRole("tab", { name: "文案" })); }
const objectUrlDescriptors = new Map(["createObjectURL", "revokeObjectURL"].map((name) => [name, Object.getOwnPropertyDescriptor(URL, name)]));
function readBlob(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob); }); }
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const [name, descriptor] of objectUrlDescriptors) { if (descriptor) Object.defineProperty(URL, name, descriptor); else Reflect.deleteProperty(URL, name); } });

describe("Planner scene workflow replacing first-step storyboard controls", () => {
  it("generates from edited dialogue, saves/restores the scene and adopts scene plus preserved legacy notes", async () => {
    const { draft, storyboard } = seed(null, true); const api = mockSceneApi(); const first = await mountPanel();
    const edited = { ...draft, sections: draft.sections.map((section, index) => index === 0 ? { ...section, text: "这是我亲自改过的开场，窗外还在下雨。" } : section) };
    fireEvent.change(control("第 1 段台词"), { target: { value: edited.sections[0].text } });
    fireEvent.change(control("今日主题"), { target: { value: "下一期主题，不替换当前文案" } });
    api.respond(sceneResponse(edited)); showScene();
    expect(screen.queryByRole("tab", { name: /^分镜/ })).toBeNull(); expect(screen.queryByLabelText("第 1 镜画面")).toBeNull(); expect(screen.queryByRole("button", { name: "下载 H3 提示词" })).toBeNull();
    fireEvent.click(screen.getByText(/背景偏好/)); fireEvent.change(control("背景生成要求"), { target: { value: "  暖灯与雨夜的固定环境  " } });
    fireEvent.click(screen.getByRole("button", { name: "生成背景" }));
    await waitFor(() => expect(control("剧情背景").value).toBe(originalScene));
    expect(api.posts[0].body).toEqual({ provider: "api", draft: edited, instruction: "暖灯与雨夜的固定环境" });
    await waitFor(() => { const state = loadPlannerDraft(window.localStorage).state; expect(state.sceneDescription).toBe(originalScene); expect(state.storyboard).toEqual(storyboard); expect(state.draft).toEqual(edited); });
    first.unmount(); const second = await mountPanel(); showScene();
    expect(control("剧情背景").value).toBe(originalScene);
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" })); expect(second.onAdopt).toHaveBeenCalledExactlyOnceWith(brief, edited, storyboard, originalScene);
  });
  it("allows clearing a scene, undoing and saving temporary empty content through refresh", async () => {
    const { draft, storyboard } = seed(originalScene, true); mockSceneApi(); const first = await mountPanel(); showScene();
    fireEvent.change(control("剧情背景"), { target: { value: "" } });
    expect((screen.getByRole("button", { name: "下载背景" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "撤回修改" })); expect(control("剧情背景").value).toBe(originalScene);
    fireEvent.change(control("剧情背景"), { target: { value: "" } });
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.sceneDescription).toBe("")); first.unmount();
    const second = await mountPanel(); showScene(); expect(control("剧情背景").value).toBe(""); expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" })); expect(second.onAdopt).toHaveBeenCalledExactlyOnceWith(brief, draft, storyboard);
  });
  it.each([false, true])("preserves old adoption argument counts without a scene (legacy=%s)", async (legacy) => {
    const { draft, storyboard } = seed(null, legacy); mockSceneApi(); const { onAdopt } = await mountPanel();
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    if (legacy) expect(onAdopt).toHaveBeenCalledExactlyOnceWith(brief, draft, storyboard); else expect(onAdopt).toHaveBeenCalledExactlyOnceWith(brief, draft);
  });
  it("passes the scene as the fourth argument with no legacy storyboard", async () => {
    const { draft } = seed(originalScene); mockSceneApi(); const { onAdopt } = await mountPanel();
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" })); expect(onAdopt).toHaveBeenCalledExactlyOnceWith(brief, draft, undefined, originalScene);
  });
  it("cancels a request and ignores its response after a newer scene succeeds", async () => {
    const { draft } = seed(originalScene); const api = mockSceneApi(); const late = deferred<Response>(); api.respond(late.promise); await mountPanel(); showScene();
    fireEvent.click(screen.getByRole("button", { name: "重新生成背景" })); await screen.findByRole("button", { name: "取消" }); fireEvent.click(screen.getByRole("button", { name: "取消" })); expect(api.posts[0].signal?.aborted).toBe(true);
    const latest = "A softly lit room with tall shelves and a rain-streaked window."; api.respond(sceneResponse(draft, latest)); fireEvent.click(screen.getByRole("button", { name: "重新生成背景" }));
    await waitFor(() => expect(control("剧情背景").value).toBe(latest));
    await act(async () => { late.resolve(sceneResponse(draft, "An abandoned late response.")); await late.promise; }); expect(control("剧情背景").value).toBe(latest);
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.sceneDescription).toBe(latest));
  });
  it.each(["scene", "script"])("aborts pending generation when the %s is edited and rejects late output", async (kind) => {
    const { draft, storyboard } = seed(originalScene, true); const api = mockSceneApi(); const late = deferred<Response>(); api.respond(late.promise); await mountPanel(); showScene();
    fireEvent.click(screen.getByRole("button", { name: "重新生成背景" })); await screen.findByRole("button", { name: "取消" });
    if (kind === "scene") fireEvent.change(control("剧情背景"), { target: { value: "My scene written while generation was pending." } });
    else { showScript(); fireEvent.change(control("第 1 段台词"), { target: { value: "正在生成时，我亲手改了台词。" } }); }
    expect(api.posts[0].signal?.aborted).toBe(true);
    await act(async () => { late.resolve(sceneResponse(draft, "A late scene that must not replace current work.")); await late.promise; }); showScene();
    expect(control("剧情背景").value).toBe(kind === "scene" ? "My scene written while generation was pending." : originalScene);
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.storyboard).toEqual(storyboard));
    if (kind === "script") { showScript(); expect(control("第 1 段台词").value).toBe("正在生成时，我亲手改了台词。"); }
  });
  it.each(["empty", "long", "nonstring", "wrong fingerprint", "server failure"])("preserves the old scene and legacy data when a response has %s", async (kind) => {
    const { draft, storyboard } = seed(originalScene, true); const api = mockSceneApi();
    const body = { sceneDescription: "A proposed new room." as unknown, sourceFingerprint: createStoryboardSourceFingerprint(draft) };
    if (kind === "empty") body.sceneDescription = "  "; if (kind === "long") body.sceneDescription = "x".repeat(4001); if (kind === "nonstring") body.sceneDescription = { text: "invalid" }; if (kind === "wrong fingerprint") body.sourceFingerprint = createStoryboardSourceFingerprint(makeDraft("另一份文案"));
    api.respond(kind === "server failure" ? Response.json({ error: "模型暂时无法连接。" }, { status: 502 }) : Response.json(body)); await mountPanel(); showScene(); fireEvent.click(screen.getByRole("button", { name: "重新生成背景" })); await screen.findByRole("alert");
    expect(control("剧情背景").value).toBe(originalScene); expect((screen.getByRole("button", { name: "撤回修改" }) as HTMLButtonElement).disabled).toBe(true); expect(loadPlannerDraft(window.localStorage).state.storyboard).toEqual(storyboard);
  });
  it("clears a different source's missing scene and legacy notes, preserving both through undo", async () => {
    const { draft, storyboard } = seed(originalScene, true); mockSceneApi(); const originalSource = { brief, draft, storyboard: storyboard!, sceneDescription: originalScene };
    const { rerender, onAdopt } = await mountPanel(originalSource); showScene();
    const nextSource = { brief: PlannerBriefSchema.parse({ theme: "另一个工程" }), draft: makeDraft("另一个工程的文案") }; rerender(<StrictMode><PlannerPanel source={nextSource} onAdopt={onAdopt} /></StrictMode>);
    expect(control("剧情背景").value).toBe(originalScene);
    fireEvent.click(screen.getByText("项目原稿")); fireEvent.click(screen.getByRole("button", { name: "载入当前项目策划稿" }));
    expect(control("文案标题").value).toBe(nextSource.draft.title); expect(control("剧情背景").value).toBe("");
    await waitFor(() => { const state = loadPlannerDraft(window.localStorage).state; expect(state.sceneDescription).toBeNull(); expect(state.storyboard).toBeNull(); });
    fireEvent.click(screen.getByRole("button", { name: "撤回修改" })); expect(control("剧情背景").value).toBe(originalScene); expect(control("文案标题").value).toBe(draft.title);
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" })); expect(onAdopt).toHaveBeenCalledExactlyOnceWith(brief, draft, storyboard, originalScene);
  });
  it("loads a source's own scene without changing its text", async () => {
    seed(originalScene, true); mockSceneApi(); const source = { brief, draft: makeDraft("项目来源"), sceneDescription: "A calm room beside a frosted window." }; const { onAdopt } = await mountPanel(source); showScene();
    fireEvent.click(screen.getByText("项目原稿")); fireEvent.click(screen.getByRole("button", { name: "载入当前项目策划稿" })); expect(control("剧情背景").value).toBe(source.sceneDescription);
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" })); expect(onAdopt).toHaveBeenCalledExactlyOnceWith(brief, source.draft, undefined, source.sceneDescription);
  });
  it.each(["provider", "draft"])("disables scene generation when the %s is unavailable", async (kind) => {
    const draft = makeDraft(); if (kind === "draft") draft.sections[0].text = ""; seed(null, false, draft); const api = mockSceneApi(kind !== "provider"); await mountPanel(); showScene();
    const generate = screen.getByRole("button", { name: "生成背景" }) as HTMLButtonElement; expect(generate.disabled).toBe(true); fireEvent.click(generate); expect(api.posts).toHaveLength(0); expect(control("剧情背景").disabled).toBe(false);
  });
  it("downloads the exact scene TXT and retains the original script download", async () => {
    const { draft } = seed(originalScene, true); const api = mockSceneApi(); const blobs: Blob[] = []; const names: string[] = [];
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return "blob:scene"; }) }); const revoke = vi.fn(); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); }); await mountPanel(); showScene(); fireEvent.click(screen.getByRole("button", { name: "下载背景" }));
    expect(names[0]).toBe(`${draft.title}-剧情背景.txt`); expect(await readBlob(blobs[0])).toBe(originalScene); expect(blobs[0].type).toBe("text/plain;charset=utf-8");
    showScript(); fireEvent.click(screen.getByRole("button", { name: "下载" })); const scriptText = await readBlob(blobs[1]); for (const section of draft.sections) expect(scriptText).toContain(section.text);
    expect(names[1]).toBe(`${draft.title}.txt`); expect(revoke).toHaveBeenCalledTimes(2); expect(api.posts).toHaveLength(0);
  });
  it("navigates the scene tab with keyboard focus and aborts on unmount", async () => {
    seed(); const api = mockSceneApi(); const late = deferred<Response>(); api.respond(late.promise); const view = await mountPanel();
    fireEvent.keyDown(screen.getByRole("tab", { name: "文案" }), { key: "End" }); expect(document.activeElement?.id).toBe("planner-tab-scene"); expect(screen.getByRole("tabpanel").id).toBe("planner-panel-scene");
    fireEvent.keyDown(screen.getByRole("tab", { name: "场景" }), { key: "ArrowLeft" }); expect(document.activeElement?.id).toBe("planner-tab-script");
    showScene(); fireEvent.click(screen.getByRole("button", { name: "生成背景" })); await screen.findByRole("button", { name: "取消" }); view.unmount(); expect(api.posts[0].signal?.aborted).toBe(true);
    await act(async () => { late.resolve(sceneResponse(makeDraft())); await late.promise; }); expect(loadPlannerDraft(window.localStorage).state.sceneDescription).toBeNull();
  });
});
