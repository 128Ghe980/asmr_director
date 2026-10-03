// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProject } from "@/lib/asmr/mock-project";
import { getBatchDownloadClips, getBatchDownloadFilename } from "@/lib/asmr/batch-download";
import { getBatchStoryboardClips, getBatchStoryboardDownloadFilename, getBatchStoryboardDownloadFolderName } from "@/lib/asmr/storyboard-batch-download";
import { createClipVideoSourceFingerprint } from "@/lib/asmr/video-plan";
import { flattenClips } from "@/lib/asmr/view-model";
import { BatchAudioDownload } from "./batch-audio-download";

function adoptedProject() {
  const project = structuredClone(demoProject);
  const clip = flattenClips(project)[0];
  clip.generation.status = "asset_generated";
  clip.asset = { asset_id: "adopted_voice", uri: "asset://clip/adopted_voice", duration: 3 };
  return project;
}

function open() { fireEvent.click(screen.getByRole("button", { name: "批量下载" })); }

function storyboardProject() {
  const project = structuredClone(demoProject);
  project.videoPlan = { version: 1, sceneDescription: "窗边有一张木桌，角色坐在桌旁。", shots: {} };
  const voices = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
  for (const [index, clip] of voices.entries()) {
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `adopted_${index}`, uri: `asset://clip/adopted_${index}`, duration: 3 + index };
    project.videoPlan.shots[clip.id] = {
      version: 1, promptFormat: "minimax-h3", clipId: clip.id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
      audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: 3 + index },
      title: "窗边片刻", visual: "S1 sits beside the wooden table.",
      action: "S1 rests a hand beside a cup.", camera: "A static medium close-up.",
    };
  }
  return project;
}

function showStoryboards() { fireEvent.click(screen.getByRole("tab", { name: "分镜" })); }

const downloadUrl = "/api/assets/batch-download?token=1f9ab138-5013-49cf-9f8d-9ba81c5c097a";
function readyArchive(project = adoptedProject(), kind: "audio" | "storyboard" = "audio") {
  return Response.json({
    downloadUrl,
    filename: kind === "audio" ? getBatchDownloadFilename(project) : getBatchStoryboardDownloadFilename(project),
    clipCount: kind === "audio" ? getBatchDownloadClips(project).length : getBatchStoryboardClips(project).length,
    size: 6,
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:zip") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("batch audio download", () => {
  it("explains the empty state and returns keyboard focus on Escape", () => {
    render(<BatchAudioDownload project={demoProject} />);
    open();
    expect(screen.getByText("采用生成的音频后，即可在这里打包下载。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "下载音频 ZIP" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "批量下载" }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the current project snapshot and downloads one ZIP without editing assets", async () => {
    const project = adoptedProject();
    const before = structuredClone(project);
    vi.mocked(fetch).mockResolvedValue(readyArchive(project));
    let savedFilename = "";
    let savedUrl = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { savedFilename = this.download; savedUrl = this.getAttribute("href") ?? ""; });
    render(<BatchAudioDownload project={project} />);
    open();
    expect(screen.getByText("当前工程已采用 1 个片段，打包为一个 ZIP。")).toBeTruthy();
    expect(screen.getByText("无后处理")).toBeTruthy();
    expect(screen.getByText("后处理")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下载音频 ZIP" }));
    await waitFor(() => expect(screen.getByText("下载已发起，解压后即可查看两个文件夹。")).toBeTruthy());
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/assets/batch-download");
    expect(JSON.parse(String(options?.body))).toEqual({ project });
    expect(options?.headers).toHaveProperty("accept", "application/json");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(savedFilename).toBe(getBatchDownloadFilename(project));
    expect(savedUrl).toBe(downloadUrl);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(project).toEqual(before);
  });

  it("allows cancellation and ignores a late response before retrying", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<BatchAudioDownload project={adoptedProject()} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "下载音频 ZIP" }));
    expect((screen.getByRole("button", { name: "正在准备音频…" }) as HTMLButtonElement).disabled).toBe(true);
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(signal?.aborted).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "下载音频 ZIP" }));
    await act(async () => { finish(readyArchive()); });
    expect(click).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "下载音频 ZIP" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a server failure and permits a fresh retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "空间处理暂不可用，请重试。" }, { status: 503 }));
    render(<BatchAudioDownload project={adoptedProject()} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "下载音频 ZIP" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("空间处理暂不可用，请重试。"));
    expect((screen.getByRole("button", { name: "重试下载音频 ZIP" }) as HTMLButtonElement).disabled).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not a zip", { headers: { "content-type": "text/html" } }));
    fireEvent.click(screen.getByRole("button", { name: "重试下载音频 ZIP" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("下载文件暂不可用，请重试。"));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it.each(["request", "body"])("explains a %s connection failure and permits downloading again", async (stage) => {
    const connectionError = new TypeError("Failed to fetch");
    if (stage === "request") vi.mocked(fetch).mockRejectedValueOnce(connectionError);
    else {
      const response = readyArchive();
      vi.spyOn(response, "json").mockRejectedValueOnce(connectionError);
      vi.mocked(fetch).mockResolvedValueOnce(response);
    }
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const project = adoptedProject();
    const before = structuredClone(project);
    render(<BatchAudioDownload project={project} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "下载音频 ZIP" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("音频包下载连接中断，请重试。"));
    expect(click).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(readyArchive());
    fireEvent.click(screen.getByRole("button", { name: "重试下载音频 ZIP" }));
    await waitFor(() => expect(screen.getByText("下载已发起，解压后即可查看两个文件夹。")).toBeTruthy());
    expect(click).toHaveBeenCalledOnce();
    expect(project).toEqual(before);
  });

  it.each(["https://example.com/audio.zip", "//example.com/audio.zip", "/api/assets/batch-download?token=../audio.zip"])("rejects an unsafe download destination %s", async (url) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ downloadUrl: url, filename: getBatchDownloadFilename(adoptedProject()), clipCount: 1, size: 6 }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<BatchAudioDownload project={adoptedProject()} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "下载音频 ZIP" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("下载文件暂不可用，请重试。"));
    expect(click).not.toHaveBeenCalled();
  });

  it("aborts preparation when the project download component is removed", () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => undefined));
    const view = render(<BatchAudioDownload project={adoptedProject()} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "下载音频 ZIP" }));
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("dismisses when keyboard focus leaves the popover for another workspace action", () => {
    render(<><BatchAudioDownload project={adoptedProject()} /><button type="button">载入工程</button></>);
    open();
    const outside = screen.getByRole("button", { name: "载入工程" });
    act(() => { outside.focus(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(outside);
  });
});

describe("batch storyboard download", () => {
  it("shows usable, missing and outdated counts and only previews usable TXT filenames", () => {
    const project = storyboardProject();
    const voices = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
    voices[1].text += "修改后的台词。";
    delete project.videoPlan!.shots[voices[2].id];
    project.videoPlan!.shots[voices[3].id].camera = "";
    render(<BatchAudioDownload project={project} />);
    open(); showStoryboards();
    expect(screen.getByRole("dialog", { name: "批量下载" })).toBeTruthy();
    expect(screen.getByText("当前工程 4 段台词，1 段可下载。")).toBeTruthy();
    expect(screen.getByLabelText("已完成 1 段")).toBeTruthy();
    expect(screen.getByLabelText("待生成 1 段")).toBeTruthy();
    expect(screen.getByLabelText("需更新 2 段")).toBeTruthy();
    expect(screen.getByText(getBatchStoryboardDownloadFolderName(project))).toBeTruthy();
    expect(screen.getByText(getBatchStoryboardClips(project)[0].filename)).toBeTruthy();
    expect(screen.getByText("仅打包已保存、完整且未过期的提示词；待生成与需更新段落不包含在内。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "下载分镜 TXT" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("disables an empty storyboard archive while retaining the audio download", () => {
    render(<BatchAudioDownload project={adoptedProject()} />);
    open(); showStoryboards();
    expect(screen.getByText("暂无可下载分镜，请先生成或更新本段分镜。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "下载分镜 TXT" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "下载分镜 TXT" }));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "音频" }));
    expect((screen.getByRole("button", { name: "下载音频 ZIP" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("prepares the current saved prompts and uses a native ZIP download without touching assets", async () => {
    const project = storyboardProject(); const before = structuredClone(project);
    vi.mocked(fetch).mockResolvedValueOnce(readyArchive(project, "storyboard"));
    let savedFilename = ""; let savedUrl = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { savedFilename = this.download; savedUrl = this.getAttribute("href") ?? ""; });
    render(<BatchAudioDownload project={project} />); open(); showStoryboards();
    expect(screen.getByText("另外 1 段 TXT")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下载分镜 TXT" }));
    await waitFor(() => expect(screen.getByText("下载已发起，解压后即可逐段查看 H3 提示词。")).toBeTruthy());
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/assets/batch-download");
    expect(JSON.parse(String(options?.body))).toEqual({ project: before, kind: "storyboard" });
    expect(options?.headers).toHaveProperty("accept", "application/json");
    expect(savedFilename).toBe(getBatchStoryboardDownloadFilename(project));
    expect(savedUrl).toBe(downloadUrl);
    expect(fetch).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(project).toEqual(before);
    fireEvent.click(screen.getByRole("tab", { name: "音频" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "下载音频 ZIP" })).toBeTruthy();
  });

  it("supports arrow, Home and End tab navigation without moving focus outside the popover", () => {
    render(<BatchAudioDownload project={storyboardProject()} />); open();
    const audio = screen.getByRole("tab", { name: "音频" }); const storyboard = screen.getByRole("tab", { name: "分镜" });
    act(() => { audio.focus(); });
    fireEvent.keyDown(audio, { key: "ArrowRight" });
    expect(storyboard.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(storyboard);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(storyboard.id);
    fireEvent.keyDown(storyboard, { key: "ArrowRight" });
    expect(audio.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(audio);
    fireEvent.keyDown(audio, { key: "End" }); expect(document.activeElement).toBe(storyboard);
    fireEvent.keyDown(storyboard, { key: "Home" }); expect(document.activeElement).toBe(audio);
    fireEvent.keyDown(audio, { key: "ArrowLeft" }); expect(document.activeElement).toBe(storyboard);
    fireEvent.keyDown(storyboard, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "批量下载" }));
  });

  it("locks tabs during preparation, cancels a late result and resets errors on a mode switch", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const project = storyboardProject(); render(<BatchAudioDownload project={project} />); open(); showStoryboards();
    fireEvent.click(screen.getByRole("button", { name: "下载分镜 TXT" }));
    for (const tab of screen.getAllByRole("tab")) expect((tab as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "音频" }));
    expect(screen.getByRole("tab", { name: "分镜" }).getAttribute("aria-selected")).toBe("true");
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(signal?.aborted).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "下载分镜 TXT" }));
    await act(async () => { finish(readyArchive(project, "storyboard")); });
    expect(click).not.toHaveBeenCalled();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: "下载分镜 TXT" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("分镜包下载连接中断，请重试。"));
    expect(screen.getByRole("button", { name: "重试下载分镜 TXT" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "音频" }));
    expect(screen.queryByRole("alert")).toBeNull();
    showStoryboards();
    expect(screen.getByRole("button", { name: "下载分镜 TXT" })).toBeTruthy();
  });

  it.each(["filename", "count", "missing count", "size"])("rejects mismatched storyboard archive %s metadata", async (field) => {
    const project = storyboardProject();
    const metadata: Record<string, unknown> = { downloadUrl, filename: getBatchStoryboardDownloadFilename(project), clipCount: 4, size: 6 };
    if (field === "filename") metadata.filename = getBatchDownloadFilename(project);
    if (field === "count") metadata.clipCount = 1;
    if (field === "missing count") delete metadata.clipCount;
    if (field === "size") metadata.size = 0;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(metadata));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<BatchAudioDownload project={project} />); open(); showStoryboards();
    fireEvent.click(screen.getByRole("button", { name: "下载分镜 TXT" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("下载文件暂不可用，请重试。"));
    expect(click).not.toHaveBeenCalled();
  });

  it.each([
    ["request", "project"], ["body", "project"], ["request", "saved prompt"], ["body", "saved prompt"],
  ])("aborts an old %s after the %s changes and ignores its late result during a new request", async (stage, changedSource) => {
    const original = storyboardProject();
    const changed = structuredClone(original);
    if (changedSource === "project") changed.project_id = "another_project";
    else changed.videoPlan!.shots["voice_001"].visual += " S1 keeps the cup on the table.";
    let finishOld!: (value: Response | Record<string, unknown>) => void;
    let finishNew!: (response: Response) => void;
    if (stage === "request") vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOld = resolve as typeof finishOld; }));
    else {
      const response = readyArchive(original, "storyboard");
      vi.spyOn(response, "json").mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
      vi.mocked(fetch).mockResolvedValueOnce(response);
    }
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { finishNew = resolve; }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const view = render(<BatchAudioDownload project={original} />); open(); showStoryboards();
    fireEvent.click(screen.getByRole("button", { name: "下载分镜 TXT" }));
    await waitFor(() => expect(finishOld).toBeTypeOf("function"));
    const oldSignal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    view.rerender(<BatchAudioDownload project={changed} />);
    expect(oldSignal?.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "下载分镜 TXT" }));
    await act(async () => { finishOld(stage === "request" ? readyArchive(original, "storyboard") : await readyArchive(original, "storyboard").json()); });
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "正在准备分镜…" })).toBeTruthy();
    await act(async () => { finishNew(readyArchive(changed, "storyboard")); });
    expect(click).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({ project: changed, kind: "storyboard" });
  });
});
