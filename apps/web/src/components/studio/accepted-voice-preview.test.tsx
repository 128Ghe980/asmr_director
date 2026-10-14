// @vitest-environment jsdom
import { StrictMode, createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAcceptedVoicePreviewPlan } from "@/lib/asmr/accepted-voice-preview";
import { demoProject } from "@/lib/asmr/mock-project";
import { AcceptedVoicePreview } from "./accepted-voice-preview";

const url = "/api/assets/voice-preview?token=12345678-1234-1234-1234-123456789abc";
function fixture() {
  const project = structuredClone(demoProject);
  project.timeline.tracks = project.timeline.tracks.map(track => track.track_type === "voice" ? { ...track,
    clips: track.clips.slice(0, 3).map((clip, index) => ({ ...clip, start: index * 4, duration: 3,
      pause_after: 1, asset: index === 1 ? { asset_id: null, uri: null, duration: null }
        : { asset_id: `take_${index}`, uri: `asset://clip/take_${index}`, duration: 3 },
      generation: { ...clip.generation, status: index === 1 ? "asset_pending" as const : "asset_generated" as const } })) }
    : { ...track, clips: [] });
  return project;
}
function response(project = fixture()) {
  const plan = getAcceptedVoicePreviewPlan(project);
  return { audioUrl: url, filename: plan.filename, clipCount: plan.clipCount, skippedCount: plan.skippedCount,
    duration: 7, size: 1344044, expiresAt: Date.now() + 1800000 };
}
function mockApi() {
  let resolvePost!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => init?.method === "POST"
    ? await new Promise<Response>(resolve => { resolvePost = resolve; }) : new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, resolve: async (result: unknown, status = 200) => {
    await act(async () => resolvePost(Response.json(result, { status })));
  } };
}
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("adopted voice preview", () => {
  it("prepares adopted-only metadata, exposes the same native WAV for listening and download, and releases it on unmount", async () => {
    const project = fixture(); const api = mockApi(); const played = vi.fn(); const ref = createRef<HTMLAudioElement>();
    const view = render(<StrictMode><AcceptedVoicePreview project={project} onPlaybackStart={played} onAudioElementChange={audio => { ref.current = audio; }} /></StrictMode>);
    expect(screen.getByText(/2\/3/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "下载整体预览 WAV" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "整体预览" }));
    expect(api.fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(api.fetcher.mock.calls[0][1]?.body))).toEqual({ project });
    expect(api.fetcher.mock.calls[0][0]).toBe("/api/assets/voice-preview");
    await api.resolve(response(project));
    const audio = screen.getByLabelText("已采用语音整体试听") as HTMLAudioElement;
    const download = screen.getByRole("link", { name: "下载整体预览 WAV" });
    expect(audio.getAttribute("src")).toBe(url);
    expect(download.getAttribute("href")).toBe(`${url}&download=1`);
    expect(download.getAttribute("download")).toBe(getAcceptedVoicePreviewPlan(project).filename);
    expect(screen.getByText(/跳过 1 段/)).toBeTruthy();
    fireEvent.play(audio); expect(played).toHaveBeenCalledOnce(); expect(ref.current).toBe(audio);
    view.unmount();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(api.fetcher).toHaveBeenCalledWith(url, { method: "DELETE", keepalive: true });
    expect(ref.current).toBeNull();
  });
  it("does not request audio with no adopted takes", () => {
    const project = fixture(); project.timeline.tracks.forEach(track => track.clips.forEach(clip => { clip.generation.status = "asset_pending"; }));
    const api = mockApi(); render(<AcceptedVoicePreview project={project} />);
    expect((screen.getByRole("button", { name: "整体预览" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/采用音频后/)).toBeTruthy(); expect(api.fetcher).not.toHaveBeenCalled();
  });
  it("releases ready previews when the page reloads or closes", async () => {
    const api = mockApi(); render(<AcceptedVoicePreview project={fixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "整体预览" })); await api.resolve(response());
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(api.fetcher).toHaveBeenCalledWith(url, { method: "DELETE", keepalive: true });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByLabelText("已采用语音整体试听")).toBeNull();
  });
  it("cancels pending work and releases a late result without showing it", async () => {
    const api = mockApi(); render(<AcceptedVoicePreview project={fixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "整体预览" }));
    const signal = api.fetcher.mock.calls[0][1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "取消整体预览" }));
    expect(signal?.aborted).toBe(true);
    await api.resolve(response());
    expect(screen.queryByLabelText("已采用语音整体试听")).toBeNull();
    expect(api.fetcher).toHaveBeenCalledWith(url, { method: "DELETE", keepalive: true });
  });
  it("aborts on project changes and ignores a previous project's response", async () => {
    const project = fixture(); const api = mockApi(); const view = render(<AcceptedVoicePreview project={project} />);
    fireEvent.click(screen.getByRole("button", { name: "整体预览" }));
    view.rerender(<AcceptedVoicePreview project={{ ...project, project_id: "another_project" }} />);
    expect(api.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await api.resolve(response(project));
    expect(screen.queryByRole("link")).toBeNull();
    expect(api.fetcher).toHaveBeenCalledWith(url, { method: "DELETE", keepalive: true });
  });
  it("invalidates ready audio after changing order or adopting another take, and stops the old element", async () => {
    const project = fixture(); const api = mockApi(); const view = render(<AcceptedVoicePreview project={project} />);
    fireEvent.click(screen.getByRole("button", { name: "整体预览" })); await api.resolve(response(project));
    const audio = screen.getByLabelText("已采用语音整体试听");
    const changed = structuredClone(project); const voices = changed.timeline.tracks.find(track => track.track_type === "voice")!;
    voices.clips[0].start = 9; voices.clips[2].start = 0;
    view.rerender(<AcceptedVoicePreview project={changed} />);
    expect(audio.getAttribute("src")).toBeNull(); expect(screen.queryByRole("link")).toBeNull();
    expect(api.fetcher).toHaveBeenCalledWith(url, { method: "DELETE", keepalive: true });
    expect((screen.getByRole("button", { name: "整体预览" }) as HTMLButtonElement).disabled).toBe(false);
    view.rerender(<AcceptedVoicePreview project={project} />);
    expect(screen.queryByLabelText("已采用语音整体试听")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "整体预览" })).toBeTruthy();
  });
  it("retains useful server errors and rejects malformed preview metadata", async () => {
    const api = mockApi(); render(<AcceptedVoicePreview project={fixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "整体预览" }));
    await api.resolve({ error: "找不到已采用的音频文件。" }, 404);
    expect(screen.getByRole("alert").textContent).toContain("找不到");
    fireEvent.click(screen.getByRole("button", { name: "整体预览" }));
    await api.resolve({ ...response(), clipCount: 99 });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("重新合并"));
    expect(screen.queryByRole("link")).toBeNull();
    expect(api.fetcher).toHaveBeenCalledWith(url, { method: "DELETE", keepalive: true });
  });
});
