// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";
import { VoiceReferenceImport, type VoiceReferenceImportProps, type VoiceReferenceImportResult } from "./voice-reference-import";

const reference = { id: "user_new", label: "正太音", referenceModes: ["reference_only"] as const, audioUrl: "/api/voice-references/user_new/audio", durationSeconds: 15 };
function result(): VoiceReferenceImportResult {
  const imported = { ...reference, referenceModes: [...reference.referenceModes] };
  return { reference: imported, catalog: { providers: [{ id: "voxcpm2", label: "VoxCPM2", available: true, defaultReferenceId: "old", references: [imported] }] } };
}
function props(overrides: Partial<VoiceReferenceImportProps> = {}): VoiceReferenceImportProps {
  return { disabled: false, onImported: vi.fn(), onCatalogRefresh: vi.fn(), onBusyChange: vi.fn(), ...overrides };
}
function choose(file = new File(["audio"], "正太音.mp3", { type: "audio/mpeg" })) {
  fireEvent.click(screen.getByRole("button", { name: "添加参考音频" }));
  fireEvent.change(screen.getByLabelText("参考音频文件"), { target: { files: [file] } });
}
function saveButton() { return screen.getByRole("button", { name: "保存并选用参考音频" }) as HTMLButtonElement; }
function recognizeButton() { return screen.getByRole("button", { name: "识别所选片段文字" }) as HTMLButtonElement; }
function recognized(overrides: Record<string, unknown> = {}) {
  return { transcript: "这是自动识别的原话。", language: "zh", startSeconds: 0, durationSeconds: 8, ...overrides };
}
function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  const fetchMock = vi.fn<typeof fetch>(() => promise); vi.stubGlobal("fetch", fetchMock);
  return { resolve, fetchMock };
}

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:reference-test") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("reference audio import", () => {
  it("starts with an eight-second suggestion without changing explicit longer selections", () => {
    render(<VoiceReferenceImport {...props()} />); choose();
    expect((screen.getByLabelText("参考片段长度") as HTMLInputElement).value).toBe("8");
    expect(screen.getByText(/建议先选 3–8 秒/)).toBeTruthy();
    const audio = screen.getByLabelText("待添加的原录音试听") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 4.5 }); fireEvent.loadedMetadata(audio);
    expect((screen.getByLabelText("参考片段长度") as HTMLInputElement).value).toBe("4.5");
  });

  it("uploads only the chosen interval and optional accurate text, then selects the returned reference", async () => {
    const input = props(); const pending = deferredResponse();
    render(<VoiceReferenceImport {...input} />); choose();
    const audio = screen.getByLabelText("待添加的原录音试听") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 108 }); fireEvent.loadedMetadata(audio);
    expect(screen.getByText("原录音试听 · 108 秒")).toBeTruthy();
    expect((screen.getByLabelText("参考声音名称") as HTMLInputElement).value).toBe("正太音");
    fireEvent.change(screen.getByLabelText("参考片段开始时间"), { target: { value: "17.5" } });
    fireEvent.change(screen.getByLabelText("参考片段长度"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("参考片段原话"), { target: { value: "  这就是所选片段的原话。 " } });
    expect(screen.getByText("将使用 17.5–29.5 秒，共 12 秒。")).toBeTruthy();
    fireEvent.click(saveButton());
    const init = pending.fetchMock.mock.calls[0][1]!; const body = init.body as FormData;
    expect(pending.fetchMock.mock.calls[0][0]).toBe("/api/voice-references");
    expect(body.get("file")).toBeInstanceOf(File);
    expect(body.get("name")).toBe("正太音"); expect(body.get("startSeconds")).toBe("17.5");
    expect(body.get("durationSeconds")).toBe("12"); expect(body.get("promptText")).toBe("这就是所选片段的原话。");
    expect(input.onBusyChange).toHaveBeenLastCalledWith(true); expect(saveButton().disabled).toBe(true);
    await act(async () => pending.resolve(Response.json(result())));
    await waitFor(() => expect(input.onImported).toHaveBeenCalledWith(result()));
    expect(input.onBusyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByText("已添加并选中“正太音”。")).toBeTruthy();
    expect(screen.queryByLabelText("参考音频文件")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reference-test");
  });

  it("allows blank text and sends reference_only-compatible input without inventing a transcript", async () => {
    const input = props(); const fetchMock = vi.fn<typeof fetch>(async () => Response.json(result())); vi.stubGlobal("fetch", fetchMock);
    render(<VoiceReferenceImport {...input} />); choose(); fireEvent.click(saveButton());
    await waitFor(() => expect(input.onImported).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0][1]!.body as FormData).get("promptText")).toBe("");
  });

  it("previews the selection, stops at its end and uses the source playback position as a new start", async () => {
    const onPreviewPlay = vi.fn(); render(<VoiceReferenceImport {...props({ onPreviewPlay })} />); choose();
    const audio = screen.getByLabelText("待添加的原录音试听") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 108 }); fireEvent.loadedMetadata(audio);
    audio.currentTime = 25.5; fireEvent.click(screen.getByRole("button", { name: "从当前播放位置开始" }));
    expect((screen.getByLabelText("参考片段开始时间") as HTMLInputElement).value).toBe("25.5");
    fireEvent.click(screen.getByRole("button", { name: "试听所选片段" })); fireEvent.play(audio);
    expect(audio.play).toHaveBeenCalled(); expect(onPreviewPlay).toHaveBeenCalledWith(audio);
    audio.currentTime = 40.6; fireEvent.timeUpdate(audio); expect(audio.pause).toHaveBeenCalled();
  });

  it("keeps an explicitly chosen length when audio metadata arrives late", () => {
    render(<VoiceReferenceImport {...props()} />); choose();
    fireEvent.change(screen.getByLabelText("参考片段长度"), { target: { value: "22" } });
    const audio = screen.getByLabelText("待添加的原录音试听") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 108 }); fireEvent.loadedMetadata(audio);
    expect((screen.getByLabelText("参考片段长度") as HTMLInputElement).value).toBe("22");
    expect(screen.getByText("将使用 0–22 秒，共 22 秒。")).toBeTruthy();
  });

  it("rejects source size/type and invalid intervals without losing the valid chosen file", () => {
    render(<VoiceReferenceImport {...props()} />); choose();
    const fileInput = screen.getByLabelText("参考音频文件");
    const large = new File(["audio"], "too-big.wav"); Object.defineProperty(large, "size", { value: 32 * 1024 * 1024 + 1 });
    fireEvent.change(fileInput, { target: { files: [large] } }); expect(screen.getByRole("alert").textContent).toContain("32 MB");
    expect((screen.getByLabelText("参考声音名称") as HTMLInputElement).value).toBe("正太音");
    fireEvent.change(fileInput, { target: { files: [new File(["audio"], "fake.exe")] } });
    expect(screen.getByRole("alert").textContent).toContain("MP3 或 WAV");
    const audio = screen.getByLabelText("待添加的原录音试听") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 20 }); fireEvent.loadedMetadata(audio);
    for (const [field, value] of [["参考片段开始时间", "-1"], ["参考片段开始时间", "19"], ["参考片段长度", "31"], ["参考片段长度", "0"], ["参考片段长度", ""]]) {
      fireEvent.change(screen.getByLabelText(field), { target: { value } }); expect(saveButton().disabled).toBe(true);
    }
    fireEvent.change(screen.getByLabelText("参考片段开始时间"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("参考片段长度"), { target: { value: "15" } }); expect(saveButton().disabled).toBe(false);
  });

  it("keeps all entered fields on server errors and can retry successfully", async () => {
    const input = props(); const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: "所选片段没有有效的人声。" }, { status: 400 }))
      .mockResolvedValueOnce(Response.json(result())); vi.stubGlobal("fetch", fetchMock);
    render(<VoiceReferenceImport {...input} />); choose();
    fireEvent.change(screen.getByLabelText("参考片段开始时间"), { target: { value: "7" } }); fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("所选片段没有有效的人声。"));
    expect((screen.getByLabelText("参考片段开始时间") as HTMLInputElement).value).toBe("7");
    expect(screen.getByLabelText("待添加的原录音试听")).toBeTruthy(); expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton()); await waitFor(() => expect(input.onImported).toHaveBeenCalledOnce());
  });

  it("ignores cancelled late success, restores controls and recovers already saved references by refresh", async () => {
    const input = props(); const pending = deferredResponse(); render(<VoiceReferenceImport {...input} />); choose(); fireEvent.click(saveButton());
    const signal = pending.fetchMock.mock.calls[0][1]!.signal!;
    fireEvent.click(screen.getByRole("button", { name: "取消等待" })); expect(signal.aborted).toBe(true);
    expect(input.onBusyChange).toHaveBeenLastCalledWith(false); expect(saveButton().disabled).toBe(false);
    expect(screen.getByText(/若录音刚好已保存/)).toBeTruthy();
    await act(async () => pending.resolve(Response.json(result()))); expect(input.onImported).not.toHaveBeenCalled();
    pending.fetchMock.mockResolvedValueOnce(Response.json(result().catalog));
    fireEvent.click(screen.getByRole("button", { name: "刷新参考列表" }));
    await waitFor(() => expect(input.onCatalogRefresh).toHaveBeenCalledWith(result().catalog));
    expect(input.onImported).not.toHaveBeenCalled();
  });

  it("does not let an old cancelled request select a reference over a retried request", async () => {
    const input = props(); let resolveOld!: (response: Response) => void; let resolveNew!: (response: Response) => void;
    const old = new Promise<Response>((done) => { resolveOld = done; }); const newer = new Promise<Response>((done) => { resolveNew = done; });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockReturnValueOnce(old).mockReturnValueOnce(newer));
    render(<VoiceReferenceImport {...input} />); choose(); fireEvent.click(saveButton()); fireEvent.click(screen.getByRole("button", { name: "取消等待" })); fireEvent.click(saveButton());
    await act(async () => resolveOld(Response.json(result()))); expect(input.onImported).not.toHaveBeenCalled(); expect(saveButton().disabled).toBe(true);
    await act(async () => resolveNew(Response.json(result()))); expect(input.onImported).toHaveBeenCalledOnce();
  });

  it("uses current callbacks and cleans up pending requests on unmount, including StrictMode", async () => {
    const first = props(); const second = props(); const pending = deferredResponse();
    const view = render(<StrictMode><VoiceReferenceImport {...first} /></StrictMode>); choose(); fireEvent.click(saveButton());
    view.rerender(<StrictMode><VoiceReferenceImport {...second} /></StrictMode>);
    await act(async () => pending.resolve(Response.json(result())));
    expect(first.onImported).not.toHaveBeenCalled(); expect(second.onImported).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "添加参考音频" }));
    fireEvent.change(screen.getByLabelText("参考音频文件"), { target: { files: [new File(["audio"], "another.wav")] } });
    const unfinished = new Promise<Response>(() => {}); pending.fetchMock.mockReturnValueOnce(unfinished); fireEvent.click(saveButton());
    const signal = pending.fetchMock.mock.calls[1][1]!.signal!; view.unmount(); expect(signal.aborted).toBe(true);
    expect(second.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("bounds request waiting and never accepts an ignored late response after timeout", async () => {
    vi.useFakeTimers(); const input = props(); const pending = deferredResponse(); render(<VoiceReferenceImport {...input} />); choose(); fireEvent.click(saveButton());
    await act(async () => vi.advanceTimersByTime(120_000));
    expect(pending.fetchMock.mock.calls[0][1]!.signal?.aborted).toBe(true); expect(saveButton().disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("刷新参考列表确认");
    await act(async () => pending.resolve(Response.json(result()))); expect(input.onImported).not.toHaveBeenCalled();
  });

  it("blocks conflicting work at admission and leaves selectors disabled while generation is busy", () => {
    const input = props({ onBusyChange: vi.fn(() => false) }); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const view = render(<VoiceReferenceImport {...input} />); choose(); fireEvent.click(saveButton()); expect(fetchMock).not.toHaveBeenCalled();
    view.rerender(<VoiceReferenceImport {...input} disabled />);
    expect((screen.getByLabelText("参考音频文件") as HTMLInputElement).disabled).toBe(true); expect(saveButton().disabled).toBe(true);
  });

  it("rejects malformed success and keeps the source for recovery", async () => {
    const input = props(); vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json({ reference, catalog: { providers: [] } as VoiceProviderCatalog })));
    render(<VoiceReferenceImport {...input} />); choose(); fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("请刷新参考列表")); expect(input.onImported).not.toHaveBeenCalled();
    expect(screen.getByLabelText("待添加的原录音试听")).toBeTruthy();
  });
});

describe("reference audio transcription", () => {
  it("recognizes only the selected interval and language, shows editable text, and saves only on explicit confirmation", async () => {
    const input = props(); const pending = deferredResponse();
    render(<VoiceReferenceImport {...input} />); choose();
    expect((screen.getByLabelText("参考音频语言") as HTMLSelectElement).value).toBe("zh");
    expect(screen.getByText(/这是参考使用模式/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("参考音频语言"), { target: { value: "ja" } });
    fireEvent.change(screen.getByLabelText("参考片段开始时间"), { target: { value: "17.5" } });
    fireEvent.change(screen.getByLabelText("参考片段长度"), { target: { value: "6" } });
    fireEvent.click(recognizeButton());
    const [url, init] = pending.fetchMock.mock.calls[0]; const body = init!.body as FormData;
    expect(url).toBe("/api/voice-references/transcribe");
    expect([...body.keys()].sort()).toEqual(["durationSeconds", "file", "language", "startSeconds"]);
    expect(body.get("language")).toBe("ja"); expect(body.get("startSeconds")).toBe("17.5"); expect(body.get("durationSeconds")).toBe("6");
    expect(input.onBusyChange).toHaveBeenLastCalledWith(true); expect(saveButton().disabled).toBe(true);
    expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).disabled).toBe(false);
    await act(async () => pending.resolve(Response.json(recognized({ transcript: "お帰り。", language: "ja", startSeconds: 17.5, durationSeconds: 6 }))));
    expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).value).toBe("お帰り。");
    expect(screen.getByText(/请试听并校对，识别可能有误/)).toBeTruthy();
    expect(input.onImported).not.toHaveBeenCalled(); expect(pending.fetchMock).toHaveBeenCalledOnce();
    expect(input.onBusyChange).toHaveBeenLastCalledWith(false);
    fireEvent.change(screen.getByLabelText("参考片段原话"), { target: { value: "  おかえりなさい。 " } });
    expect(screen.queryByText("自动识别结果已填入下方，请核对。")).toBeNull();
    pending.fetchMock.mockResolvedValueOnce(Response.json(result())); fireEvent.click(saveButton());
    await waitFor(() => expect(input.onImported).toHaveBeenCalledOnce());
    expect(pending.fetchMock.mock.calls[1][0]).toBe("/api/voice-references");
    expect((pending.fetchMock.mock.calls[1][1]!.body as FormData).get("promptText")).toBe("おかえりなさい。");
  });

  it("requires a valid source interval but no voice name to recognize, and respects admission locks", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const input = props({ onBusyChange: vi.fn(() => false) }); render(<VoiceReferenceImport {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "添加参考音频" })); expect(recognizeButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("参考音频文件"), { target: { files: [new File(["audio"], "voice.wav")] } });
    fireEvent.change(screen.getByLabelText("参考声音名称"), { target: { value: "" } }); expect(recognizeButton().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("参考片段长度"), { target: { value: "0" } }); expect(recognizeButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("参考片段长度"), { target: { value: "8" } }); fireEvent.click(recognizeButton());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps manually entered text on recognition failure and allows another attempt", async () => {
    const input = props(); const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: "没有识别到清晰语音，请换片段。" }, { status: 422 }))
      .mockResolvedValueOnce(Response.json(recognized())); vi.stubGlobal("fetch", fetchMock);
    render(<VoiceReferenceImport {...input} />); choose();
    fireEvent.change(screen.getByLabelText("参考片段原话"), { target: { value: "人工原话" } }); fireEvent.click(recognizeButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("没有识别到清晰语音，请换片段。"));
    expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).value).toBe("人工原话");
    expect(recognizeButton().disabled).toBe(false); expect(input.onImported).not.toHaveBeenCalled();
    fireEvent.click(recognizeButton()); await waitFor(() => expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).value).toBe("这是自动识别的原话。"));
  });

  it("cancels recognition and rejects a late successful result without losing manual text", async () => {
    const input = props(); const pending = deferredResponse(); render(<VoiceReferenceImport {...input} />); choose();
    fireEvent.change(screen.getByLabelText("参考片段原话"), { target: { value: "人工原话" } }); fireEvent.click(recognizeButton());
    fireEvent.click(screen.getByRole("button", { name: "取消等待" }));
    expect(pending.fetchMock.mock.calls[0][1]!.signal?.aborted).toBe(true);
    expect(screen.getByText("已取消文字识别，原话未改动。")).toBeTruthy(); expect(input.onBusyChange).toHaveBeenLastCalledWith(false);
    await act(async () => pending.resolve(Response.json(recognized())));
    expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).value).toBe("人工原话");
    expect(screen.queryByText("自动识别结果已填入下方，请核对。")).toBeNull(); expect(input.onImported).not.toHaveBeenCalled();
  });

  it.each([
    ["参考片段原话", "已手动改好", "已手动改好"],
    ["参考片段开始时间", "3", "人工原话"],
    ["参考片段长度", "5", "人工原话"],
    ["参考音频语言", "en", "人工原话"],
  ])("rejects stale recognition when %s changes", async (label, value, expectedText) => {
    const input = props(); const pending = deferredResponse(); render(<VoiceReferenceImport {...input} />); choose();
    fireEvent.change(screen.getByLabelText("参考片段原话"), { target: { value: "人工原话" } }); fireEvent.click(recognizeButton());
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(pending.fetchMock.mock.calls[0][1]!.signal?.aborted).toBe(true); expect(input.onBusyChange).toHaveBeenLastCalledWith(false);
    await act(async () => pending.resolve(Response.json(recognized())));
    expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).value).toBe(expectedText);
    expect(recognizeButton().disabled).toBe(false); expect(screen.queryByText("自动识别结果已填入下方，请核对。")).toBeNull();
  });

  it("rejects old-file results after choosing a new recording", async () => {
    const input = props(); const pending = deferredResponse(); render(<VoiceReferenceImport {...input} />); choose(); fireEvent.click(recognizeButton());
    fireEvent.change(screen.getByLabelText("参考音频文件"), { target: { files: [new File(["other audio"], "新参考.wav")] } });
    expect(pending.fetchMock.mock.calls[0][1]!.signal?.aborted).toBe(true);
    await act(async () => pending.resolve(Response.json(recognized())));
    expect((screen.getByLabelText("参考声音名称") as HTMLInputElement).value).toBe("新参考");
    expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).value).toBe("");
  });

  it("cancels a stale interval when late audio metadata shortens the suggested selection", async () => {
    const input = props(); const pending = deferredResponse(); render(<VoiceReferenceImport {...input} />); choose();
    fireEvent.change(screen.getByLabelText("参考片段原话"), { target: { value: "人工原话" } }); fireEvent.click(recognizeButton());
    const audio = screen.getByLabelText("待添加的原录音试听") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 4 }); fireEvent.loadedMetadata(audio);
    expect(pending.fetchMock.mock.calls[0][1]!.signal?.aborted).toBe(true);
    expect((screen.getByLabelText("参考片段长度") as HTMLInputElement).value).toBe("4");
    await act(async () => pending.resolve(Response.json(recognized())));
    expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).value).toBe("人工原话");
  });

  it("invalidates a completed recognition when selecting another interval but keeps text for manual checking", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json(recognized())));
    render(<VoiceReferenceImport {...props()} />); choose(); fireEvent.click(recognizeButton());
    await waitFor(() => expect(screen.getByText("自动识别结果已填入下方，请核对。")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("参考片段开始时间"), { target: { value: "4" } });
    expect(screen.queryByText("自动识别结果已填入下方，请核对。")).toBeNull();
    expect(screen.getByText("片段已改变，请重新识别或校对原话。")).toBeTruthy();
    expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).value).toBe("这是自动识别的原话。");
  });

  it("does not let an older cancelled request overwrite a newer recognition", async () => {
    const input = props(); let resolveOld!: (response: Response) => void; let resolveNew!: (response: Response) => void;
    const older = new Promise<Response>((done) => { resolveOld = done; }); const newer = new Promise<Response>((done) => { resolveNew = done; });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockReturnValueOnce(older).mockReturnValueOnce(newer));
    render(<VoiceReferenceImport {...input} />); choose(); fireEvent.click(recognizeButton());
    fireEvent.change(screen.getByLabelText("参考音频语言"), { target: { value: "en" } }); fireEvent.click(recognizeButton());
    await act(async () => resolveOld(Response.json(recognized()))); expect(saveButton().disabled).toBe(true);
    expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).value).toBe("");
    await act(async () => resolveNew(Response.json(recognized({ transcript: "Welcome home.", language: "en" }))));
    expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).value).toBe("Welcome home."); expect(saveButton().disabled).toBe(false);
  });

  it("bounds recognition waiting and keeps manual text after timeout or unmount", async () => {
    vi.useFakeTimers(); const input = props(); const pending = deferredResponse(); const view = render(<VoiceReferenceImport {...input} />); choose();
    fireEvent.change(screen.getByLabelText("参考片段原话"), { target: { value: "人工原话" } }); fireEvent.click(recognizeButton());
    await act(async () => vi.advanceTimersByTime(190_000));
    expect(pending.fetchMock.mock.calls[0][1]!.signal?.aborted).toBe(true); expect(input.onBusyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("alert").textContent).toContain("文字识别超时，原话未改动");
    await act(async () => pending.resolve(Response.json(recognized())));
    expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).value).toBe("人工原话");
    pending.fetchMock.mockReturnValueOnce(new Promise<Response>(() => {})); fireEvent.click(recognizeButton());
    const signal = pending.fetchMock.mock.calls[1][1]!.signal!; view.unmount(); expect(signal.aborted).toBe(true);
    expect(input.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it.each([
    { transcript: "" }, { language: "en" }, { startSeconds: 1 }, { durationSeconds: undefined }, { transcript: "话".repeat(2001) },
  ])("rejects malformed or mismatched recognition results (%#)", async (invalid) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json(recognized(invalid))));
    render(<VoiceReferenceImport {...props()} />); choose();
    fireEvent.change(screen.getByLabelText("参考片段原话"), { target: { value: "人工原话" } }); fireEvent.click(recognizeButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("识别结果不完整，请重试或手动填写原话。"));
    expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).value).toBe("人工原话");
    expect(saveButton().disabled).toBe(false);
  });
});
