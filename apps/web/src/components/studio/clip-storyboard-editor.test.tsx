// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoProject } from "@/lib/asmr/mock-project";
import type { AsmrProject, TimelineClip } from "@/lib/asmr/schema";
import {
  createClipH3Prompt, createClipVideoSourceFingerprint, getPreviousClipPromptFingerprint,
  type ClipVideoStoryboard, type StoryboardReferenceMode,
} from "@/lib/asmr/video-plan";
import { ClipStoryboardEditor } from "./clip-storyboard-editor";

type VoiceClip = Extract<TimelineClip, { type: "voice" }>;
const measuredDuration = 2.375;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const objectUrlDescriptors = new Map(["createObjectURL", "revokeObjectURL"].map((name) => [name, Object.getOwnPropertyDescriptor(URL, name)]));

function voices(project: AsmrProject): VoiceClip[] {
  return project.timeline.tracks.flatMap<VoiceClip>((track) => track.track_type === "voice" ? track.clips : []).sort((a, b) => a.start - b.start);
}

function fixture() {
  const project = structuredClone(demoProject);
  project.project_id = "current_audio_project";
  project.title = "当前工程:音频/画面";
  project.videoPlan = { version: 1, sceneDescription: "雪地木屋内，壁炉的火光映在木桌上。窗外下着雪，窗边有一张靠椅。角色正在递来水杯，随后会整理桌上的书。", shots: {} };
  for (const [index, clip] of voices(project).entries()) {
    clip.text = ["这句只属于上一段，不要再朗读。", "工程里改过的台词：别着急，先喝口水。~", "这里是后面另一段的台词。"][index] ?? "另一个段落。";
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `adopted_${index + 1}`, uri: `asset://clip/adopted_${index + 1}`, duration: 9.9 + index };
  }
  return project;
}

function shotFixture(project: AsmrProject, clipId = voices(project)[1].id, includePrevious = false, referenceMode: StoryboardReferenceMode = includePrevious ? "continuous" : "new"): ClipVideoStoryboard {
  const clip = voices(project).find((item) => item.id === clipId)!;
  const previous = voices(project)[voices(project).findIndex((item) => item.id === clipId) - 1];
  return {
    version: 1, promptFormat: "minimax-h3", clipId, referenceMode,
    sourceFingerprint: createClipVideoSourceFingerprint(project, clipId),
    audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: measuredDuration },
    title: "A calm moment", visual: "S1 sits beside an open book under warm lighting.",
    action: "S1 gently rests a hand beside the cup, keeping the mouth visible.", camera: "A static medium close-up with gentle framing.",
    ...(includePrevious ? { previousClipId: previous.id, previousPromptFingerprint: getPreviousClipPromptFingerprint(project, clipId)! } : {}),
  };
}

function withShot(project: AsmrProject, clipId = voices(project)[1].id, includePrevious = false) {
  const shot = shotFixture(project, clipId, includePrevious);
  project.videoPlan!.shots[clipId] = shot;
  return shot;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mockApi(configured = true, localConfigured = false) {
  const responses: Promise<Response>[] = [];
  const posts: { body: Record<string, unknown>; signal?: AbortSignal | null }[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) === "/api/planner" && init?.method !== "POST") return Response.json({
      providers: [{ id: "api", label: "测试外部模型", model: "fixture-clip", configured }, { id: "ollama", label: "测试本地模型", model: "fixture-local", configured: localConfigured }], defaultProvider: "api",
    });
    expect(String(input)).toBe("/api/clip-storyboard");
    expect(init?.method).toBe("POST");
    posts.push({ body: JSON.parse(String(init?.body)), signal: init?.signal });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected clip-storyboard request in test");
    // Ignore abort here deliberately to test the component's late-result guard.
    return await next;
  }));
  return { posts, respond: (response: Response | Promise<Response>) => responses.push(Promise.resolve(response)) };
}

async function mountEditor(project: AsmrProject, clipId = voices(project)[1].id, saveAllowed = true) {
  const onSave = vi.fn<(projectId: string, shot: ClipVideoStoryboard) => boolean>().mockReturnValue(saveAllowed);
  const onEdit = vi.fn();
  const onSceneChange = vi.fn();
  const component = (next: AsmrProject, nextClipId = clipId) => <StrictMode><ClipStoryboardEditor project={next} clipId={nextClipId} onSave={onSave} onEdit={onEdit} onSceneChange={onSceneChange} /></StrictMode>;
  const view = render(component(project));
  await screen.findByRole("option", { name: "测试外部模型" });
  return { ...view, onSave, onEdit, onSceneChange, update: (next: AsmrProject, nextClipId = clipId) => view.rerender(component(next, nextClipId)) };
}

function control(label: string) { return screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement; }
function generationButton() { return screen.getByRole("button", { name: /^(?:重新)?生成本段分镜$/ }) as HTMLButtonElement; }
function copyButton() { return screen.getByRole("button", { name: /^(?:复制|已复制) H3 提示词$/ }) as HTMLButtonElement; }
function setClipboard(writeText?: (text: string) => Promise<void>) { Object.defineProperty(navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined }); }
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob); });
}

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard); else Reflect.deleteProperty(navigator, "clipboard");
  for (const [name, descriptor] of objectUrlDescriptors) { if (descriptor) Object.defineProperty(URL, name, descriptor); else Reflect.deleteProperty(URL, name); }
});

describe("ClipStoryboardEditor current-audio workflow", () => {
  it.each(["pending", "wrong URI"])("disables generation until the current clip has adopted audio (%s)", async (kind) => {
    const project = fixture(); const clip = voices(project)[1];
    if (kind === "pending") { clip.generation.status = "asset_pending"; clip.asset = { asset_id: null, uri: null, duration: null }; }
    else clip.asset.uri = "asset://clip/another_asset";
    const api = mockApi(); await mountEditor(project);
    expect(generationButton().disabled).toBe(true);
    expect(screen.getByText(/先生成并采用本段音频/)).toBeTruthy();
    fireEvent.click(generationButton()); expect(api.posts).toHaveLength(0);
  });

  it("defaults to a new shot using the current project and usable previous shot as a secondary reference", async () => {
    const project = fixture(); const clip = voices(project)[1]; const previous = voices(project)[0]; withShot(project, previous.id);
    const result = shotFixture(project, clip.id, true, "new"); const before = structuredClone(project); const api = mockApi(); api.respond(Response.json({ storyboard: result }));
    const { onSave } = await mountEditor(project);
    expect((control("新镜头") as HTMLInputElement).checked).toBe(true);
    expect((control("连续镜头") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByText(/本段偏好/)); fireEvent.change(control("本段分镜要求"), { target: { value: "  Keep the cup on the table.  " } });
    fireEvent.click(generationButton()); await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith(project.project_id, result));
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0].body).toEqual({ provider: "api", project: before, clipId: clip.id, referenceMode: "new", includePrevious: true, instruction: "Keep the cup on the table." });
    expect(api.posts[0].body).not.toHaveProperty("draft");
    expect(project).toEqual(before); expect(result.audio.duration).toBe(measuredDuration); expect(result.audio.duration).not.toBe(clip.duration);
  });

  it.each(["valid", "wrong predecessor", "wrong predecessor fingerprint", "missing requested reference", "wrong mode", "missing mode"])("checks requested reference mode and previous-shot metadata (%s)", async (kind) => {
    const project = fixture(); const previous = voices(project)[0]; const clip = voices(project)[1]; withShot(project, previous.id);
    const result = shotFixture(project, clip.id, true);
    if (kind === "wrong predecessor") result.previousClipId = voices(project)[2].id;
    if (kind === "wrong predecessor fingerprint") result.previousPromptFingerprint = "another previous prompt";
    if (kind === "missing requested reference") { delete result.previousClipId; delete result.previousPromptFingerprint; }
    if (kind === "wrong mode") result.referenceMode = "new";
    if (kind === "missing mode") delete result.referenceMode;
    const api = mockApi(); api.respond(Response.json({ storyboard: result })); const { onSave } = await mountEditor(project);
    fireEvent.click(control("连续镜头")); fireEvent.click(generationButton());
    await waitFor(() => expect(api.posts).toHaveLength(1)); expect(api.posts[0].body.includePrevious).toBe(true); expect(api.posts[0].body.referenceMode).toBe("continuous");
    if (kind === "valid") await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith(project.project_id, result));
    else { await screen.findByRole("alert"); expect(onSave).not.toHaveBeenCalled(); }
  });

  it.each(["first clip", "missing adjacent", "stale adjacent"])("forces the first shot new and waits for a usable predecessor only in continuous mode (%s)", async (kind) => {
    const project = fixture(); const [first, adjacent, target] = voices(project); withShot(project, first.id);
    if (kind === "stale adjacent") { withShot(project, adjacent.id); adjacent.text += "修改过的台词。"; }
    const clipId = kind === "first clip" ? first.id : target.id;
    const api = mockApi(); const result = shotFixture(project, clipId); api.respond(Response.json({ storyboard: result })); const { onSave } = await mountEditor(project, clipId);
    const continuous = control("连续镜头") as HTMLInputElement; const newShot = control("新镜头") as HTMLInputElement;
    expect(continuous.disabled).toBe(kind === "first clip"); expect(continuous.checked).toBe(false); expect(newShot.disabled).toBe(false); expect(newShot.checked).toBe(true);
    fireEvent.click(continuous);
    if (kind !== "first clip") {
      expect(continuous.checked).toBe(true); expect(newShot.checked).toBe(false); expect(generationButton().disabled).toBe(true);
      fireEvent.click(generationButton()); expect(api.posts).toHaveLength(0); expect(screen.getByText(/先生成上一段后再生成连续镜头/)).toBeTruthy();
      fireEvent.click(newShot);
    }
    expect(generationButton().disabled).toBe(false); fireEvent.click(generationButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith(project.project_id, result));
    expect(api.posts[0].body.referenceMode).toBe("new"); expect(api.posts[0].body.includePrevious).toBe(false);
  });

  it("saves the next-generation preference through its callback while retaining an editable and copyable legacy shot", async () => {
    const project = fixture(); const [previous, clip] = voices(project); withShot(project, previous.id);
    const oldShot = withShot(project, clip.id); delete oldShot.referenceMode;
    const original = structuredClone(oldShot); const originalPrompt = createClipH3Prompt(project, clip.id);
    const onReferenceModeChange = vi.fn(); const onSave = vi.fn().mockReturnValue(true); const onEdit = vi.fn(); const api = mockApi();
    const component = (next: AsmrProject) => <StrictMode><ClipStoryboardEditor project={next} clipId={clip.id} onReferenceModeChange={onReferenceModeChange} onSave={onSave} onEdit={onEdit} onSceneChange={vi.fn()} /></StrictMode>;
    const view = render(component(project)); await screen.findByRole("option", { name: "测试外部模型" });
    fireEvent.click(control("连续镜头")); expect(onReferenceModeChange).toHaveBeenCalledExactlyOnceWith(clip.id, "continuous");
    expect((control("新镜头") as HTMLInputElement).checked).toBe(true);
    const changed = structuredClone(project); changed.videoPlan!.referenceModes = { [clip.id]: "continuous" }; view.rerender(component(changed));
    expect((control("连续镜头") as HTMLInputElement).checked).toBe(true); expect((control("新镜头") as HTMLInputElement).checked).toBe(false);
    expect(control("本段分镜画面").value).toBe(original.visual); expect(control("本段分镜画面").disabled).toBe(false);
    expect(copyButton().disabled).toBe(false); expect(createClipH3Prompt(changed, clip.id)).toBe(originalPrompt); expect(changed.videoPlan!.shots[clip.id]).toEqual(original);
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined); setClipboard(writeText);
    fireEvent.click(copyButton()); await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(originalPrompt));
    const result = shotFixture(changed, clip.id, true, "continuous"); api.respond(Response.json({ storyboard: result })); fireEvent.click(generationButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith(changed.project_id, result));
    expect(api.posts[0].body.referenceMode).toBe("continuous"); expect(api.posts[0].body.includePrevious).toBe(true);
    expect(project.videoPlan!.shots[clip.id]).toEqual(original); expect(onEdit).not.toHaveBeenCalled();
  });

  it("locks both choices while external generation is busy and restores the saved preference afterward", async () => {
    const project = fixture(); const clip = voices(project)[1]; project.videoPlan!.referenceModes = { [clip.id]: "continuous" };
    const onReferenceModeChange = vi.fn(); mockApi();
    const component = (referenceModeBusy: boolean) => <ClipStoryboardEditor project={project} clipId={clip.id} referenceModeBusy={referenceModeBusy} onReferenceModeChange={onReferenceModeChange} onSave={vi.fn()} onEdit={vi.fn()} onSceneChange={vi.fn()} />;
    const view = render(component(true)); await screen.findByRole("option", { name: "测试外部模型" });
    expect(control("连续镜头").disabled).toBe(true); expect(control("新镜头").disabled).toBe(true);
    fireEvent.click(control("新镜头")); expect(onReferenceModeChange).not.toHaveBeenCalled();
    view.rerender(component(false)); expect(control("连续镜头").disabled).toBe(false); expect(control("新镜头").disabled).toBe(false);
    expect((control("连续镜头") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(control("新镜头")); expect(onReferenceModeChange).toHaveBeenCalledExactlyOnceWith(clip.id, "new");
  });

  it("cancels an old request and ignores its result after a newer generation is saved", async () => {
    const project = fixture(); const original = withShot(project); const api = mockApi(); const late = deferred<Response>(); api.respond(late.promise);
    const { onSave } = await mountEditor(project); fireEvent.click(generationButton()); await screen.findByRole("button", { name: "取消生成" });
    fireEvent.click(screen.getByRole("button", { name: "取消生成" })); expect(api.posts[0].signal?.aborted).toBe(true);
    const fresh = { ...shotFixture(project), visual: "A newly generated current visual." }; api.respond(Response.json({ storyboard: fresh })); fireEvent.click(generationButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith(project.project_id, fresh));
    await act(async () => { late.resolve(Response.json({ storyboard: { ...original, visual: "A late canceled visual." } })); await late.promise; });
    expect(onSave).toHaveBeenCalledTimes(1); expect(control("本段分镜画面").value).toBe(original.visual);
  });

  it.each(["text", "audio", "scene", "mode", "project identity", "selected clip"])("cancels pending generation after the %s changes and rejects late output", async (kind) => {
    const project = fixture(); const clipId = voices(project)[1].id; const original = withShot(project); const api = mockApi(); const late = deferred<Response>(); api.respond(late.promise);
    const view = await mountEditor(project); fireEvent.click(generationButton()); await screen.findByRole("button", { name: "取消生成" });
    const changed = structuredClone(project); const clip = voices(changed)[1];
    if (kind === "text") clip.text += "新的工程文字。";
    if (kind === "audio") clip.asset = { asset_id: "new_adopted_asset", uri: "asset://clip/new_adopted_asset", duration: 8.8 };
    if (kind === "scene") changed.videoPlan!.sceneDescription = "A different room with a blue window.";
    if (kind === "mode") changed.videoPlan!.referenceModes = { [clipId]: "continuous" };
    if (kind === "project identity") changed.project_id = "different_current_project";
    view.update(changed, kind === "selected clip" ? voices(changed)[2].id : clipId);
    expect(api.posts[0].signal?.aborted).toBe(true);
    await act(async () => { late.resolve(Response.json({ storyboard: shotFixture(project) })); await late.promise; });
    expect(view.onSave).not.toHaveBeenCalled();
    if (kind !== "selected clip") expect(control("本段分镜画面").value).toBe(original.visual);
  });

  it.each(["continuous", "new"] as const)("a previous-shot hand edit cancels a pending %s shot", async (referenceMode) => {
    const project = fixture(); const previous = voices(project)[0]; withShot(project, previous.id);
    const result = shotFixture(project, voices(project)[1].id, true, referenceMode); const api = mockApi(); const late = deferred<Response>(); api.respond(late.promise);
    const view = await mountEditor(project); if (referenceMode === "continuous") fireEvent.click(control("连续镜头")); fireEvent.click(generationButton());
    await screen.findByRole("button", { name: "取消生成" });
    const changed = structuredClone(project); changed.videoPlan!.shots[previous.id].visual = "The previous hand-edited visual now faces the window."; view.update(changed);
    expect(api.posts[0].signal?.aborted).toBe(true);
    await act(async () => { late.resolve(Response.json({ storyboard: result })); await late.promise; });
    expect(view.onSave).not.toHaveBeenCalled();
  });

  it.each(["save rejection", "server failure"])("retains existing manual notes after %s", async (kind) => {
    const project = fixture(); const shot = withShot(project); shot.visual = "My existing manual visual must remain.";
    const api = mockApi(); api.respond(kind === "server failure" ? Response.json({ error: "分镜模型暂时无法连接。" }, { status: 502 }) : Response.json({ storyboard: shotFixture(project) }));
    const view = await mountEditor(project, voices(project)[1].id, kind !== "save rejection"); fireEvent.click(generationButton()); await screen.findByRole("alert");
    expect(control("本段分镜画面").value).toBe(shot.visual);
    if (kind === "save rejection") expect(view.onSave).toHaveBeenCalledOnce(); else expect(view.onSave).not.toHaveBeenCalled();
    expect(generationButton().disabled).toBe(false);
  });

  it("copies the exact current dialogue and measured complete audio duration without previous dialogue", async () => {
    const project = fixture(); const [previous, clip] = voices(project); const previousShot = withShot(project, previous.id); previousShot.visual = "The preceding shot shows a chair beside a snowy window."; const shot = withShot(project, clip.id, true);
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined); setClipboard(writeText); const api = mockApi(); await mountEditor(project);
    fireEvent.click(screen.getByText("H3 提示词预览")); const preview = control("本段 H3 提示词") as HTMLTextAreaElement;
    expect(preview.readOnly).toBe(true); expect(preview.value).toBe(createClipH3Prompt(project, clip.id));
    expect(preview.value).toContain(`<d>[Chinese]${clip.text}</d>`); expect(preview.value).not.toContain(previous.text);
    expect(preview.value).toContain(`${shot.audio.duration} seconds`); expect(preview.value).not.toContain(`${clip.asset.duration} seconds`); expect(preview.value).not.toContain(`${clip.duration} seconds`);
    expect(preview.value).toContain("<Audio 1>: fully_copy"); expect(preview.value).toContain("non_diegetic_music: N/A");
    expect(preview.value).toContain(shot.visual); expect(preview.value).toContain(shot.action); expect(preview.value).toContain(shot.camera);
    expect(preview.value).not.toContain(project.videoPlan!.sceneDescription);
    expect(preview.value).not.toContain(previousShot.visual);
    expect(preview.value).not.toMatch(/summary:|Shared setting:|Previous (?:visual|action|camera) continuity:|detailed_description:|overall_soundscape:/);
    expect(preview.value.split(clip.text)).toHaveLength(2);
    fireEvent.click(copyButton()); await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(preview.value));
    expect(screen.getByRole("button", { name: "已复制 H3 提示词" })).toBeTruthy(); expect(api.posts).toHaveLength(0);
  });

  it.each(["unavailable", "rejected"])("selects the readonly prompt for manual copying when clipboard access is %s", async (kind) => {
    const project = fixture(); withShot(project); mockApi(); const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error("Clipboard unavailable")); setClipboard(kind === "rejected" ? writeText : undefined);
    await mountEditor(project); fireEvent.click(copyButton()); await screen.findByText(/已选中提示词，请手动复制/);
    const preview = control("本段 H3 提示词") as HTMLTextAreaElement;
    expect(preview.closest("details")?.open).toBe(true); expect(document.activeElement).toBe(preview); expect(preview.selectionStart).toBe(0); expect(preview.selectionEnd).toBe(preview.value.length); expect(preview.readOnly).toBe(true);
    if (kind === "rejected") expect(writeText).toHaveBeenCalledExactlyOnceWith(preview.value); else expect(writeText).not.toHaveBeenCalled();
  });

  it("downloads the exact current H3 task as a safe TXT filename and revokes its object URL", async () => {
    const project = fixture(); withShot(project); const api = mockApi(); const blobs: Blob[] = []; const names: string[] = [];
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return "blob:current-clip-h3"; }) });
    const revoke = vi.fn(); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    await mountEditor(project); fireEvent.click(screen.getByRole("button", { name: "下载提示词" }));
    expect(names).toEqual(["当前工程 音频 画面-第002段-H3.txt"]); expect(blobs).toHaveLength(1); expect(blobs[0].type).toBe("text/plain;charset=utf-8");
    expect(await readBlob(blobs[0])).toBe(createClipH3Prompt(project, voices(project)[1].id)); expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:current-clip-h3"); expect(api.posts).toHaveLength(0);
  });

  it.each(["incomplete", "stale"])("keeps visual notes editable while disabling prompt use for %s content", async (kind) => {
    const project = fixture(); const shot = withShot(project); if (kind === "incomplete") shot.action = ""; else voices(project)[1].text += "来源已经变了。";
    const api = mockApi(); const view = await mountEditor(project);
    expect(copyButton().disabled).toBe(true); expect((screen.getByRole("button", { name: "下载提示词" }) as HTMLButtonElement).disabled).toBe(true); expect(screen.queryByLabelText("本段 H3 提示词")).toBeNull();
    expect(control("本段分镜画面").value).toBe(shot.visual); expect(control("本段分镜画面").disabled).toBe(false);
    fireEvent.change(control("本段分镜画面"), { target: { value: "My saved hand-edited setting." } }); expect(view.onEdit).toHaveBeenCalledExactlyOnceWith(shot.clipId, { visual: "My saved hand-edited setting." });
    expect(api.posts).toHaveLength(0);
  });

  it("cancels pending generation when visual notes or the shared scene are edited", async () => {
    const project = fixture(); const shot = withShot(project); const api = mockApi(); const late = deferred<Response>(); api.respond(late.promise); const view = await mountEditor(project);
    fireEvent.click(generationButton()); await screen.findByRole("button", { name: "取消生成" });
    fireEvent.change(control("本段分镜动作"), { target: { value: "S1 gently touches the cup without hiding the mouth." } });
    expect(api.posts[0].signal?.aborted).toBe(true); expect(view.onEdit).toHaveBeenCalledExactlyOnceWith(shot.clipId, { action: "S1 gently touches the cup without hiding the mouth." });
    await act(async () => { late.resolve(Response.json({ storyboard: shotFixture(project) })); await late.promise; }); expect(view.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/剧情背景/u, { selector: "summary" }));
    expect(control("工程剧情背景").value).toBe(project.videoPlan!.sceneDescription);
    expect(screen.getByText(/不原文复制背景/)).toBeTruthy();
    fireEvent.change(control("工程剧情背景"), { target: { value: "雪地木屋内，窗边是一张木桌。" } }); expect(view.onSceneChange).toHaveBeenCalledExactlyOnceWith("雪地木屋内，窗边是一张木桌。");
  });

  it.each(["unconfigured model", "empty scene"])("disables generation when the %s is unavailable", async (kind) => {
    const project = fixture(); if (kind === "empty scene") project.videoPlan!.sceneDescription = " "; const api = mockApi(kind !== "unconfigured model"); await mountEditor(project);
    expect(generationButton().disabled).toBe(true); fireEvent.click(generationButton()); expect(api.posts).toHaveLength(0);
  });

  it("locks generation and all source or shot settings during a batch while keeping existing prompts available", async () => {
    const project = fixture(); const [previous, clip] = voices(project);
    withShot(project, previous.id); const shot = withShot(project, clip.id);
    const api = mockApi(); const onSave = vi.fn().mockReturnValue(true); const onEdit = vi.fn(); const onSceneChange = vi.fn();
    const component = (batchBusy: boolean) => <StrictMode><ClipStoryboardEditor project={project} clipId={clip.id} batchBusy={batchBusy} onSave={onSave} onEdit={onEdit} onSceneChange={onSceneChange} /></StrictMode>;
    const view = render(component(true));
    await screen.findByRole("option", { name: "测试外部模型" });
    const fields = ["工程剧情背景", "连续镜头", "新镜头", "本段分镜要求", "本段分镜标题", "本段分镜画面", "本段分镜动作", "本段分镜镜头"];
    for (const name of fields) expect(control(name).disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: "分镜模型" }) as HTMLSelectElement).disabled).toBe(true);
    expect(generationButton().disabled).toBe(true);
    fireEvent.click(generationButton());
    expect(api.posts).toHaveLength(0); expect(onSave).not.toHaveBeenCalled(); expect(onEdit).not.toHaveBeenCalled(); expect(onSceneChange).not.toHaveBeenCalled();
    expect(control("本段分镜画面").value).toBe(shot.visual);
    expect(copyButton().disabled).toBe(false);
    expect((screen.getByRole("button", { name: "下载提示词" }) as HTMLButtonElement).disabled).toBe(false);
    view.rerender(component(false));
    for (const name of fields) expect(control(name).disabled).toBe(false);
    expect((screen.getByRole("combobox", { name: "分镜模型" }) as HTMLSelectElement).disabled).toBe(false);
    expect(generationButton().disabled).toBe(false);
    fireEvent.change(control("本段分镜画面"), { target: { value: "S1 keeps the cup beside the book." } });
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(clip.id, { visual: "S1 keeps the cup beside the book." });
  });

  it("reports the default and selected provider and releases single-shot busy state on cancel and unmount", async () => {
    const project = fixture(); const clipId = voices(project)[1].id;
    const api = mockApi(true, true); const first = deferred<Response>(); const second = deferred<Response>(); api.respond(first.promise); api.respond(second.promise);
    const onBusyChange = vi.fn(); const onProviderChange = vi.fn(); const onSave = vi.fn().mockReturnValue(true);
    const view = render(<StrictMode><ClipStoryboardEditor project={project} clipId={clipId} onBusyChange={onBusyChange} onProviderChange={onProviderChange} onSave={onSave} onEdit={vi.fn()} onSceneChange={vi.fn()} /></StrictMode>);
    await screen.findByRole("option", { name: "测试外部模型" });
    expect(onProviderChange).toHaveBeenCalledExactlyOnceWith("api");
    onProviderChange.mockClear(); onBusyChange.mockClear();
    fireEvent.change(screen.getByRole("combobox", { name: "分镜模型" }), { target: { value: "ollama" } });
    expect(onProviderChange).toHaveBeenCalledExactlyOnceWith("ollama");
    fireEvent.click(generationButton());
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0].body.provider).toBe("ollama"); expect(onBusyChange.mock.calls).toEqual([[true]]);
    fireEvent.click(screen.getByRole("button", { name: "取消生成" }));
    expect(api.posts[0].signal?.aborted).toBe(true); expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    await act(async () => { first.resolve(Response.json({ storyboard: shotFixture(project) })); await first.promise; });
    expect(onSave).not.toHaveBeenCalled(); expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    fireEvent.click(generationButton());
    await waitFor(() => expect(api.posts).toHaveLength(2));
    expect(onBusyChange.mock.calls).toEqual([[true], [false], [true]]);
    view.unmount();
    expect(api.posts[1].signal?.aborted).toBe(true); expect(onBusyChange.mock.calls).toEqual([[true], [false], [true], [false]]);
    await act(async () => { second.resolve(Response.json({ storyboard: shotFixture(project) })); await second.promise; });
    expect(onSave).not.toHaveBeenCalled(); expect(onBusyChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it("aborts on unmount and never saves an eventual late response", async () => {
    const project = fixture(); const api = mockApi(); const late = deferred<Response>(); api.respond(late.promise); const view = await mountEditor(project);
    fireEvent.click(generationButton()); await screen.findByRole("button", { name: "取消生成" }); view.unmount(); expect(api.posts[0].signal?.aborted).toBe(true);
    await act(async () => { late.resolve(Response.json({ storyboard: shotFixture(project) })); await late.promise; }); expect(view.onSave).not.toHaveBeenCalled();
  });
});
