// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAudioPlayback } from "./audio-playback-coordinator";

let releases: Array<() => void> = [];
function register(audio: HTMLAudioElement) {
  const release = registerAudioPlayback(audio);
  releases.push(release);
  return release;
}
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function(this: HTMLMediaElement) {
    this.dispatchEvent(new Event("pause"));
  });
});
afterEach(() => { releases.forEach(release => release()); releases = []; vi.restoreAllMocks(); });

describe("page audio playback coordination", () => {
  it("only pauses the previous registered player after the next really starts", () => {
    const first = new Audio(); const second = new Audio();
    register(first); register(second);
    expect(first.pause).not.toHaveBeenCalled();
    first.dispatchEvent(new Event("play"));
    second.dispatchEvent(new Event("play"));
    expect(first.pause).toHaveBeenCalledOnce();
    expect(vi.mocked(first.pause).mock.contexts).toEqual([first]);
  });
  it("does not pause the same player on repeated play events", () => {
    const audio = new Audio(); register(audio);
    audio.dispatchEvent(new Event("play")); audio.dispatchEvent(new Event("play"));
    expect(audio.pause).not.toHaveBeenCalled();
  });
  it("does not forget the new active player when an old inactive event arrives late", () => {
    const first = new Audio(); const second = new Audio(); const third = new Audio();
    register(first); register(second); register(third);
    first.dispatchEvent(new Event("play")); second.dispatchEvent(new Event("play"));
    first.dispatchEvent(new Event("pause")); first.dispatchEvent(new Event("error"));
    third.dispatchEvent(new Event("play"));
    expect(vi.mocked(first.pause).mock.contexts).toEqual([first, second]);
  });
  it("ref-counts duplicate registrations and makes disposal idempotent", () => {
    const first = new Audio(); const second = new Audio();
    const releaseFirst = register(first); const releaseDuplicate = register(first); register(second);
    releaseFirst(); releaseFirst();
    first.dispatchEvent(new Event("play")); second.dispatchEvent(new Event("play"));
    expect(vi.mocked(first.pause).mock.contexts).toEqual([first]);
    releaseDuplicate();
    first.dispatchEvent(new Event("play"));
    expect(vi.mocked(first.pause).mock.contexts).toEqual([first]);
  });
  it("releases an ended or disposed current player without pausing it on the next play", () => {
    const first = new Audio(); const second = new Audio();
    const release = register(first); register(second);
    first.dispatchEvent(new Event("play")); first.dispatchEvent(new Event("ended"));
    second.dispatchEvent(new Event("play"));
    expect(first.pause).not.toHaveBeenCalled();
    first.dispatchEvent(new Event("play")); release();
    second.dispatchEvent(new Event("play"));
    expect(vi.mocked(first.pause).mock.contexts).toEqual([second]);
  });
});
