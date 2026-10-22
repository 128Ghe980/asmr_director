// @vitest-environment jsdom
import { StrictMode, createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPlayer } from "./audio-player";
import { registerAudioPlayback } from "./audio-playback-coordinator";

let externalRelease: (() => void) | undefined;
function metadata(audio: HTMLAudioElement, duration = 12.5) {
  Object.defineProperty(audio, "duration", { configurable: true, value: duration });
  Object.defineProperty(audio, "readyState", { configurable: true, value: 4 });
  fireEvent.loadedMetadata(audio);
}
function media(label = "候选 1 试听") {
  return screen.getByLabelText(label) as HTMLAudioElement;
}
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function(this: HTMLMediaElement) {
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function(this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
});
afterEach(() => {
  cleanup(); externalRelease?.(); externalRelease = undefined; vi.restoreAllMocks();
});

describe("shared audio player", () => {
  it("forwards the real audio ref and preserves its source, preload and parent events", () => {
    const ref = createRef<HTMLAudioElement>();
    const calls = Object.fromEntries(["Play", "Waiting", "CanPlay", "Playing", "Pause", "TimeUpdate", "LoadedMetadata", "Error"]
      .map(name => [name, vi.fn()]));
    render(<AudioPlayer ref={ref} src="/clip.wav" label="候选 1 试听" preload="metadata"
      onPlay={calls.Play} onWaiting={calls.Waiting} onCanPlay={calls.CanPlay}
      onPlaying={calls.Playing} onPause={calls.Pause} onTimeUpdate={calls.TimeUpdate}
      onLoadedMetadata={calls.LoadedMetadata} onError={calls.Error} />);
    const audio = media();
    expect(ref.current).toBe(audio); expect(audio).toBeInstanceOf(HTMLAudioElement);
    expect(audio.getAttribute("src")).toBe("/clip.wav");
    expect(audio.preload).toBe("metadata"); expect(audio.controls).toBe(false);
    expect(audio.play).not.toHaveBeenCalled();
    fireEvent.play(audio); fireEvent.waiting(audio); fireEvent.canPlay(audio); fireEvent.playing(audio);
    fireEvent.pause(audio); fireEvent.timeUpdate(audio); metadata(audio); fireEvent.error(audio);
    for (const call of Object.values(calls)) expect(call).toHaveBeenCalledOnce();
  });
  it("keeps seeking unavailable until real finite metadata, then seeks without changing the source", () => {
    render(<AudioPlayer src="/clip.wav" label="候选 1 试听" />);
    const audio = media(); const slider = screen.getByRole("slider", { name: "候选 1 试听播放进度" }) as HTMLInputElement;
    expect(slider.disabled).toBe(true); expect(screen.getByText("0:00 / --:--")).toBeTruthy();
    Object.defineProperty(audio, "duration", { configurable: true, value: 10 });
    fireEvent.durationChange(audio);
    expect(slider.disabled).toBe(true);
    metadata(audio, Number.POSITIVE_INFINITY); expect(slider.disabled).toBe(true);
    metadata(audio, 12.5); expect(slider.disabled).toBe(false);
    expect(slider.type).toBe("range"); expect(slider.max).toBe("12.5"); expect(slider.step).toBe("0.01");
    fireEvent.change(slider, { target: { value: "4.25" } });
    expect(audio.currentTime).toBe(4.25);
    expect(slider.getAttribute("aria-valuetext")).toBe("0:04 / 0:12");
    expect(audio.getAttribute("src")).toBe("/clip.wav");
  });
  it("plays, pauses and mutes through the media element while reflecting native updates", () => {
    render(<AudioPlayer src="/clip.wav" label="候选 1 试听" />);
    const audio = media(); metadata(audio);
    fireEvent.click(screen.getByRole("button", { name: "播放候选 1 试听" }));
    expect(audio.play).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "暂停候选 1 试听" }));
    expect(audio.pause).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "静音候选 1 试听" }));
    expect(audio.muted).toBe(true);
    expect(screen.getByRole("button", { name: "取消静音候选 1 试听" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "取消静音候选 1 试听" }));
    expect(audio.muted).toBe(false);
    audio.currentTime = 7.2; fireEvent.timeUpdate(audio);
    expect(screen.getByText("0:07 / 0:12")).toBeTruthy();
  });
  it("keeps playback options collapsed and downloads only the current source after replacement", () => {
    const view = render(<AudioPlayer src="/old.wav?asset=old" label="候选 1 试听" />);
    const more = screen.getByRole("button", { name: "候选 1 试听更多播放选项" });
    const options = document.getElementById(more.getAttribute("aria-controls")!)!;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(options.hidden).toBe(true);
    expect(options.parentElement).toBe(media().parentElement);
    expect(screen.queryByRole("link", { name: "下载候选 1 试听" })).toBeNull();
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(options.hidden).toBe(false);
    const oldLink = screen.getByRole("link", { name: "下载候选 1 试听" });
    expect(oldLink.getAttribute("href")).toBe("/old.wav?asset=old");
    expect(oldLink.hasAttribute("download")).toBe(true);
    fireEvent.keyDown(oldLink, { key: "Escape" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(options.hidden).toBe(true); expect(document.activeElement).toBe(more);
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    view.rerender(<AudioPlayer src="/new.mp3?asset=new" label="候选 1 试听" />);
    const nextMore = screen.getByRole("button", { name: "候选 1 试听更多播放选项" });
    expect(nextMore.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "下载候选 1 试听" })).toBeNull();
    fireEvent.click(nextMore);
    expect(screen.getByRole("link", { name: "下载候选 1 试听" }).getAttribute("href")).toBe("/new.mp3?asset=new");
    expect(media().play).not.toHaveBeenCalled();
  });
  it("synchronizes menu volume and mute state with native volume events without starting audio", () => {
    const changed = vi.fn();
    render(<AudioPlayer src="/clip.wav" label="候选 1 试听" onVolumeChange={event => changed(event.currentTarget)} />);
    fireEvent.click(screen.getByLabelText("候选 1 试听更多播放选项"));
    const audio = media();
    const volume = screen.getByRole("slider", { name: "候选 1 试听音量" }) as HTMLInputElement;
    fireEvent.change(volume, { target: { value: "0.35" } });
    expect(audio.volume).toBe(0.35); expect(volume.value).toBe("0.35");
    audio.volume = 0.8; audio.muted = true; fireEvent.volumeChange(audio);
    expect(volume.value).toBe("0.8"); expect(volume.getAttribute("aria-valuetext")).toBe("80%");
    expect(screen.getByRole("button", { name: "取消静音候选 1 试听" })).toBeTruthy();
    expect(changed).toHaveBeenCalledWith(audio);
    fireEvent.click(screen.getByRole("button", { name: "取消静音候选 1 试听" }));
    expect(audio.volume).toBe(0.8); expect(audio.muted).toBe(false);
    expect(audio.play).not.toHaveBeenCalled();
  });
  it("synchronizes menu speed with native rate events and retains external non-menu rates", () => {
    const changed = vi.fn();
    render(<AudioPlayer src="/clip.wav" label="候选 1 试听" onRateChange={event => changed(event.currentTarget)} />);
    fireEvent.click(screen.getByLabelText("候选 1 试听更多播放选项"));
    const audio = media();
    const speed = screen.getByRole("combobox", { name: "候选 1 试听播放速度" }) as HTMLSelectElement;
    expect(Array.from(speed.options, option => option.value)).toEqual(["0.75", "1", "1.25", "1.5", "2"]);
    fireEvent.change(speed, { target: { value: "1.25" } });
    expect(audio.playbackRate).toBe(1.25); expect(speed.value).toBe("1.25");
    audio.playbackRate = 1.1; fireEvent.rateChange(audio);
    expect(speed.value).toBe("1.1"); expect(changed).toHaveBeenCalledWith(audio);
    expect(audio.getAttribute("src")).toBe("/clip.wav"); expect(audio.play).not.toHaveBeenCalled();
  });
  it("coordinates separate player instances and an off-DOM studio audio", () => {
    render(<><AudioPlayer src="/first.wav" label="第一段" /><AudioPlayer src="/second.wav" label="第二段" /></>);
    const first = media("第一段"); const second = media("第二段");
    const headless = new Audio("/mix.wav"); externalRelease = registerAudioPlayback(headless);
    fireEvent.play(first); fireEvent.play(second);
    expect(vi.mocked(first.pause).mock.contexts).toEqual([first]);
    act(() => { headless.dispatchEvent(new Event("play")); });
    expect(vi.mocked(first.pause).mock.contexts).toEqual([first, second]);
  });
  it("composes a parent's reference-selection stop boundary with internal time tracking", () => {
    render(<AudioPlayer src="/reference.wav" label="参考试听" onTimeUpdate={event => {
      if (event.currentTarget.currentTime >= 8) event.currentTarget.pause();
    }} />);
    const audio = media("参考试听"); metadata(audio, 30);
    fireEvent.play(audio); audio.currentTime = 8.1; fireEvent.timeUpdate(audio);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "播放参考试听" })).toBeTruthy();
    expect(screen.getByText("0:08 / 0:30")).toBeTruthy();
  });
  it("shows waiting only after a play event and retries the same source after a native error", () => {
    render(<AudioPlayer src="/spatial.wav" label="空间试听" waitingLabel="正在准备空间试听…" errorLabel="空间试听失败" />);
    const audio = media("空间试听");
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.play(audio); expect(screen.getByRole("status").textContent).toBe("正在准备空间试听…");
    fireEvent.error(audio); expect(screen.getByRole("alert").textContent).toBe("空间试听失败");
    metadata(audio); fireEvent.click(screen.getByRole("button", { name: "重试空间试听" }));
    expect(audio.load).toHaveBeenCalledOnce(); expect(audio.play).toHaveBeenCalledOnce();
    fireEvent.playing(audio); expect(screen.queryByRole("alert")).toBeNull();
    expect(audio.getAttribute("src")).toBe("/spatial.wav");
  });
  it("allows parent-owned error copy without rendering a second alert or retry row", () => {
    const parentError = vi.fn();
    render(<><AudioPlayer src="/source.wav" label="原录音" statusDisplay="none" onError={parentError} />
      <p role="alert">父级负责错误恢复</p></>);
    const audio = media("原录音"); fireEvent.error(audio);
    expect(parentError).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "重试原录音" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "播放原录音" }));
    expect(audio.load).toHaveBeenCalledOnce(); expect(audio.play).toHaveBeenCalledOnce();
  });
  it("reports a current play rejection and can retry, while an AbortError stays quiet", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("play failed"));
    render(<AudioPlayer src="/clip.wav" label="候选 1 试听" />);
    fireEvent.click(screen.getByRole("button", { name: "播放候选 1 试听" }));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toBe("试听暂不可用，请重试。");
    fireEvent.click(screen.getByRole("button", { name: "重试候选 1 试听" }));
    expect(media().load).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.pause(media());
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("interrupted", "AbortError"));
    fireEvent.click(screen.getByRole("button", { name: "播放候选 1 试听" }));
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("ignores a previous source play rejection, clears its element, and does not autoplay the replacement", async () => {
    let rejectOld!: (reason: unknown) => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; }));
    const ref = createRef<HTMLAudioElement>();
    const view = render(<AudioPlayer ref={ref} src="/old.wav" label="候选试听" />);
    const oldAudio = media("候选试听");
    fireEvent.click(screen.getByRole("button", { name: "播放候选试听" }));
    view.rerender(<AudioPlayer ref={ref} src="/new.wav" label="候选试听" />);
    const newAudio = media("候选试听");
    expect(newAudio).not.toBe(oldAudio); expect(ref.current).toBe(newAudio);
    expect(oldAudio.getAttribute("src")).toBeNull();
    expect(newAudio.getAttribute("src")).toBe("/new.wav");
    await act(async () => rejectOld(new Error("old source failed")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(vi.mocked(newAudio.play).mock.contexts).toEqual([oldAudio]);
  });
  it("ignores a late play rejection after the user cancels a pending start", async () => {
    let rejectPlay!: (reason: unknown) => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectPlay = reject; }));
    render(<AudioPlayer src="/clip.wav" label="候选 1 试听" />);
    fireEvent.click(screen.getByRole("button", { name: "播放候选 1 试听" }));
    fireEvent.click(screen.getByRole("button", { name: "暂停候选 1 试听" }));
    await act(async () => rejectPlay(new Error("cancelled old request")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "播放候选 1 试听" })).toBeTruthy();
  });
  it("keeps StrictMode sources valid and releases the source and forwarded ref on unmount", () => {
    const ref = createRef<HTMLAudioElement>();
    const view = render(<StrictMode><AudioPlayer ref={ref} src="/clip.wav" label="候选 1 试听" /></StrictMode>);
    const audio = media();
    expect(ref.current).toBe(audio); expect(audio.getAttribute("src")).toBe("/clip.wav");
    expect(audio.play).not.toHaveBeenCalled();
    view.unmount();
    expect(ref.current).toBeNull(); expect(audio.getAttribute("src")).toBeNull();
    expect(audio.pause).toHaveBeenCalled(); expect(audio.load).toHaveBeenCalled();
  });
});
