// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProject } from "@/lib/asmr/mock-project";
import { getBatchDownloadFilename } from "@/lib/asmr/batch-download";
import { flattenClips } from "@/lib/asmr/view-model";
import { BatchAudioDownload } from "./batch-audio-download";

function adoptedProject() {
  const project = structuredClone(demoProject);
  const clip = flattenClips(project)[0];
  clip.generation.status = "asset_generated";
  clip.asset = { asset_id: "adopted_voice", uri: "asset://clip/adopted_voice", duration: 3 };
  return project;
}

function open() { fireEvent.click(screen.getByRole("button", { name: "批量下载音频" })); }

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
    expect((screen.getByRole("button", { name: "下载 ZIP" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "批量下载音频" }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the current project snapshot and downloads one ZIP without editing assets", async () => {
    const project = adoptedProject();
    const before = structuredClone(project);
    vi.mocked(fetch).mockResolvedValue(new Response(new Blob(["zip bytes"]), { headers: { "content-type": "application/zip" } }));
    let savedFilename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { savedFilename = this.download; });
    render(<BatchAudioDownload project={project} />);
    open();
    expect(screen.getByText("当前工程已采用 1 个片段，打包为一个 ZIP。")).toBeTruthy();
    expect(screen.getByText("无后处理")).toBeTruthy();
    expect(screen.getByText("后处理")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下载 ZIP" }));
    await waitFor(() => expect(screen.getByText("下载已发起，解压后即可查看两个文件夹。")).toBeTruthy());
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/assets/batch-download");
    expect(JSON.parse(String(options?.body))).toEqual({ project });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(savedFilename).toBe(getBatchDownloadFilename(project));
    expect(project).toEqual(before);
  });

  it("allows cancellation and ignores a late response before retrying", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<BatchAudioDownload project={adoptedProject()} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "下载 ZIP" }));
    expect((screen.getByRole("button", { name: "正在准备音频…" }) as HTMLButtonElement).disabled).toBe(true);
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(signal?.aborted).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "下载 ZIP" }));
    await act(async () => { finish(new Response("zip", { headers: { "content-type": "application/zip" } })); });
    expect(click).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "下载 ZIP" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a server failure and permits a fresh retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "空间处理暂不可用，请重试。" }, { status: 503 }));
    render(<BatchAudioDownload project={adoptedProject()} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "下载 ZIP" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("空间处理暂不可用，请重试。"));
    expect((screen.getByRole("button", { name: "重试下载 ZIP" }) as HTMLButtonElement).disabled).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not a zip", { headers: { "content-type": "text/html" } }));
    fireEvent.click(screen.getByRole("button", { name: "重试下载 ZIP" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("下载文件暂不可用，请重试。"));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("aborts preparation when the project download component is removed", () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => undefined));
    const view = render(<BatchAudioDownload project={adoptedProject()} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "下载 ZIP" }));
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
