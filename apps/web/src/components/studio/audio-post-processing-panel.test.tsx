// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAudioPostProcessingClips } from "@/lib/asmr/audio-post-processing";
import { AudioPostProcessingPanel } from "./audio-post-processing-panel";
import { processedProject } from "./audio-post-processing-test-fixture";

const token = "/api/assets/voice-preview?token=11111111-1111-4111-8111-111111111111";
function metadata() { return { audioUrl: token, filename: "后处理.wav", clipCount: 2, skippedCount: 0, duration: 3.3, size: 633644, expiresAt: Date.now() + 60_000 }; }
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("stored audio post-processing results", () => {
  it("keeps per-shot results collapsed until opened, then plays stored files directly", async () => {
    const project = processedProject(1);
    const raw = structuredClone(getAudioPostProcessingClips(project).map(clip => clip.asset));
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<AudioPostProcessingPanel project={project} />);
    expect(screen.queryByLabelText("第 1 镜后处理试听")).toBeNull();
    expect(screen.getByLabelText("逐镜后处理结果").closest("details")!.open).toBe(false);
    fireEvent.click(screen.getByLabelText("逐镜后处理结果"));
    await screen.findByLabelText("第 1 镜后处理试听");
    expect(screen.getByLabelText("第 1 镜后处理试听").getAttribute("src")).toBe("/api/assets/clip/processed_0");
    expect(screen.getByRole("link", { name: "下载第 1 镜后处理" }).getAttribute("href")).toBe("/api/assets/clip/processed_0?download=1");
    expect((screen.getByRole("button", { name: "后处理整体试听" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/正前.*右侧/)).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
    expect(getAudioPostProcessingClips(project).map(clip => clip.asset)).toEqual(raw);
  });

  it("marks old files as needing update while retaining explicitly labelled playback", async () => {
    const project = processedProject();
    getAudioPostProcessingClips(project)[0].volume_db -= 1;
    render(<AudioPostProcessingPanel project={project} />);
    fireEvent.click(screen.getByLabelText("逐镜后处理结果"));
    await screen.findByLabelText("第 1 镜上次后处理试听");
    expect(screen.getByText("需更新 · 上次结果保留")).toBeTruthy();
    expect(screen.getByLabelText("第 1 镜上次后处理试听").getAttribute("src")).toBe("/api/assets/clip/processed_0");
    expect((screen.getByRole("button", { name: "后处理整体试听" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requests only prepared processed files for the full preview and releases its token on unmount", async () => {
    const project = processedProject();
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json(metadata()));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<AudioPostProcessingPanel project={project} />);
    fireEvent.click(screen.getByRole("button", { name: "后处理整体试听" }));
    await screen.findByLabelText("后处理整体成品试听");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ project, audioVersion: "processed" });
    expect(screen.getByRole("link", { name: "下载后处理整体 WAV" }).getAttribute("href")).toBe(token + "&download=1");
    view.unmount();
    expect(fetcher.mock.calls.filter(call => call[1]?.method === "DELETE")).toHaveLength(1);
    expect(fetcher.mock.calls.every(call => String(call[0]).startsWith("/api/assets/voice-preview"))).toBe(true);
  });

  it.each(["cancel", "changed_input"] as const)("discards a late whole-preview response after %s", async (reason) => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn((_url: unknown, init?: RequestInit) => init?.method === "DELETE" ? Promise.resolve(new Response(null, { status: 204 })) : new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const project = processedProject();
    const view = render(<AudioPostProcessingPanel project={project} />);
    fireEvent.click(screen.getByRole("button", { name: "后处理整体试听" }));
    if (reason === "cancel") fireEvent.click(screen.getByRole("button", { name: "取消后处理整体试听" }));
    else { const changed = structuredClone(project); changed.title += "已修改"; view.rerender(<AudioPostProcessingPanel project={changed} />); }
    await act(async () => { finish(Response.json(metadata())); });
    await waitFor(() => expect(fetcher.mock.calls.some(call => call[1]?.method === "DELETE")).toBe(true));
    expect(screen.queryByLabelText("后处理整体成品试听")).toBeNull();
  });

  it("rejects an unexpected preview URL without exposing it as audio or download", async () => {
    const fetcher = vi.fn(async () => Response.json({ ...metadata(), audioUrl: "https://example.invalid/untrusted.wav" }));
    vi.stubGlobal("fetch", fetcher);
    render(<AudioPostProcessingPanel project={processedProject()} />);
    fireEvent.click(screen.getByRole("button", { name: "后处理整体试听" }));
    expect((await screen.findByRole("alert")).textContent).toContain("无效");
    expect(screen.queryByLabelText("后处理整体成品试听")).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
