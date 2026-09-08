// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getVoiceCandidateSourceFingerprint } from "@/lib/asmr/audio-candidate";
import { demoProject } from "@/lib/asmr/mock-project";
import type { TimelineClip } from "@/lib/asmr/schema";
import { flattenClips } from "@/lib/asmr/view-model";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import type { VoiceGenerationOptions } from "@/lib/asmr/voice-generation-options";
import type { VoiceLongTextResult } from "@/lib/asmr/voice-longtext-result";
import type { VoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";

import { VoiceGenerationPanel, type VoiceGenerationPanelProps } from "./voice-generation-panel";

const selectedClip = flattenClips(demoProject).find((clip) => clip.id === "voice_001")!;
const options: VoiceGenerationOptions = {
  provider: "gpt-sovits", voicePackId: "default", referenceMode: "with_reference_text", generationMode: "clip",
};
const catalog: VoiceProviderCatalog = {
  providers: [
    { id: "gpt-sovits", label: "GPT-SoVITS", available: true, defaultReferenceId: "default", references: [
      { id: "default", label: "原有声音", referenceModes: ["with_reference_text"] },
    ] },
    { id: "voxcpm2", label: "VoxCPM2", available: true, defaultReferenceId: "soft_zh", longText: { available: true, apiConfigured: true }, references: [
      { id: "normal_zh", label: "普通中文参考", referenceModes: ["reference_only"] },
      { id: "soft_zh", label: "温柔中文参考", referenceModes: ["reference_only", "with_reference_text"] },
    ] },
  ],
};

function candidate() {
  return makeVoiceCandidateFixture({ sourceFingerprint: getVoiceCandidateSourceFingerprint(selectedClip) });
}

function longTextCandidate() {
  const take = candidate();
  const longText: VoiceLongTextResult = {
    version: 1, analysisProvider: "api", analysisModel: "text-analysis-model", loudnessGainDb: 0, asrModel: "local-asr",
    groups: [0, 1, 2].map((index) => ({
      index, text: `慢慢放松，第 ${index + 1} 组。`, inputText: "慢慢放松。", paddingClauses: [], isFinal: index === 2, pauseAfter: "medium",
      seed: 901 + index, parameters: {}, asset: { assetId: `group_${index}`, uri: `asset://clip/group_${index}`, duration: 2 },
      internalPausesMs: [350], internalPauseClasses: ["medium"], leadingQuietMs: 0, trailingQuietMs: 0,
      transcript: "慢慢放松。", coverage: 1, cutStartSeconds: 0, cutEndSeconds: 2, attempts: 1,
    })),
    joins: [350, 440].map((actualDurationMs) => ({ durationMs: 350, actualDurationMs, source: "adjacent", category: "medium" })),
  };
  return { ...take, provenance: { ...take.provenance, generationMode: "long_text" as const, longText } };
}

function props(overrides: Partial<VoiceGenerationPanelProps> = {}): VoiceGenerationPanelProps {
  return {
    options, onOptionsChange: vi.fn(), catalog, busy: false, candidates: [], selectedClip,
    onAdopt: vi.fn(), onDiscard: vi.fn(), onUndo: vi.fn(), canUndo: false, hasUndo: false,
    ...overrides,
  };
}

function control(name: string) {
  return screen.getByRole("combobox", { name }) as HTMLSelectElement;
}

afterEach(cleanup);

describe("voice generation panel", () => {
  it("selects the provider's default reference and prefers its transcript mode", () => {
    const input = props();
    render(<VoiceGenerationPanel {...input} />);
    fireEvent.change(control("人声引擎"), { target: { value: "voxcpm2" } });
    expect(input.onOptionsChange).toHaveBeenCalledWith({
      provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "clip",
    });
  });

  it("allows only supported reference modes and updates them when the reference changes", () => {
    const input = props({ options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh" } });
    const view = render(<VoiceGenerationPanel {...input} />);
    fireEvent.change(control("参考模式"), { target: { value: "reference_only" } });
    expect(input.onOptionsChange).toHaveBeenLastCalledWith({ ...input.options, referenceMode: "reference_only" });
    fireEvent.change(control("参考声音"), { target: { value: "normal_zh" } });
    expect(input.onOptionsChange).toHaveBeenLastCalledWith({ ...input.options, voicePackId: "normal_zh", referenceMode: "reference_only" });
    view.rerender(<VoiceGenerationPanel {...input} options={{ ...input.options, voicePackId: "normal_zh", referenceMode: "reference_only" }} />);
    expect(within(control("参考模式")).queryByRole("option", { name: "参考音频＋文本" })).toBeNull();
  });

  it("shows unavailable engines without letting the user select them", () => {
    const unavailable = { ...catalog.providers[1], available: false, references: [], defaultReferenceId: null, unavailableReason: "请检查 VoxCPM2 配置。" };
    render(<VoiceGenerationPanel {...props({ catalog: { providers: [catalog.providers[0], unavailable] } })} />);
    const option = screen.getByRole("option", { name: /VoxCPM2/ }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(control("人声引擎").disabled).toBe(false);
  });

  it("offers long-text generation only for VoxCPM2 and defaults its analysis to local", () => {
    const input = props();
    const view = render(<VoiceGenerationPanel {...input} />);
    expect(screen.queryByRole("combobox", { name: "生成方式" })).toBeNull();
    const voxOptions = { ...options, provider: "voxcpm2" as const, voicePackId: "soft_zh" };
    view.rerender(<VoiceGenerationPanel {...input} options={voxOptions} />);
    expect(control("生成方式").value).toBe("clip");
    expect(screen.queryByRole("combobox", { name: "文本分析" })).toBeNull();
    fireEvent.change(control("生成方式"), { target: { value: "long_text" } });
    expect(input.onOptionsChange).toHaveBeenLastCalledWith({ ...voxOptions, generationMode: "long_text", analysisProvider: "local" });
    view.rerender(<VoiceGenerationPanel {...input} options={{ ...voxOptions, generationMode: "long_text" }} />);
    expect(control("文本分析").value).toBe("local");
    expect(screen.queryByText("文案将发送到已配置的外部 API。")).toBeNull();
  });

  it("preserves long-text settings across reference changes and resets them when switching to GPT", () => {
    const input = props({ options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh", generationMode: "long_text", analysisProvider: "api" } });
    render(<VoiceGenerationPanel {...input} />);
    fireEvent.change(control("参考模式"), { target: { value: "reference_only" } });
    expect(input.onOptionsChange).toHaveBeenLastCalledWith({ ...input.options, referenceMode: "reference_only" });
    fireEvent.change(control("参考声音"), { target: { value: "normal_zh" } });
    expect(input.onOptionsChange).toHaveBeenLastCalledWith({ ...input.options, voicePackId: "normal_zh", referenceMode: "reference_only" });
    fireEvent.change(control("人声引擎"), { target: { value: "gpt-sovits" } });
    expect(input.onOptionsChange).toHaveBeenLastCalledWith(options);
  });

  it("disables unavailable long-text generation and explains why without changing the selection", () => {
    const unavailableCatalog: VoiceProviderCatalog = { providers: [catalog.providers[0], {
      ...catalog.providers[1], longText: { available: false, apiConfigured: true, reason: "请配置本地语音校验工具。" },
    }] };
    const input = props({ options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh" }, catalog: unavailableCatalog });
    render(<VoiceGenerationPanel {...input} />);
    expect((screen.getByRole("option", { name: "长文分组" }) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("请配置本地语音校验工具。");
    fireEvent.change(control("生成方式"), { target: { value: "long_text" } });
    expect(input.onOptionsChange).not.toHaveBeenCalled();
  });

  it("requires a configured external API and discloses sending the script only when it is selected", () => {
    const unconfiguredCatalog: VoiceProviderCatalog = { providers: [catalog.providers[0], {
      ...catalog.providers[1], longText: { available: true, apiConfigured: false },
    }] };
    const input = props({ options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh", generationMode: "long_text" }, catalog: unconfiguredCatalog });
    const view = render(<VoiceGenerationPanel {...input} />);
    expect((screen.getByRole("option", { name: /外部 API/ }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.change(control("文本分析"), { target: { value: "api" } });
    expect(input.onOptionsChange).not.toHaveBeenCalled();
    expect(screen.queryByText("文案将发送到已配置的外部 API。")).toBeNull();
    view.rerender(<VoiceGenerationPanel {...input} catalog={catalog} />);
    fireEvent.change(control("文本分析"), { target: { value: "api" } });
    expect(input.onOptionsChange).toHaveBeenLastCalledWith({ ...input.options, analysisProvider: "api" });
    view.rerender(<VoiceGenerationPanel {...input} catalog={catalog} options={{ ...input.options, analysisProvider: "api" }} />);
    expect(screen.getByText("文案将发送到已配置的外部 API。")).toBeTruthy();
    fireEvent.change(control("文本分析"), { target: { value: "local" } });
    expect(input.onOptionsChange).toHaveBeenLastCalledWith({ ...input.options, analysisProvider: "local" });
    view.rerender(<VoiceGenerationPanel {...input} options={{ ...input.options, analysisProvider: "local" }} />);
    expect(screen.queryByText("文案将发送到已配置的外部 API。")).toBeNull();
  });

  it("reports a previously selected API becoming unavailable instead of silently falling back", () => {
    const input = props({ options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh", generationMode: "long_text", analysisProvider: "api" }, catalog: { providers: [{
      ...catalog.providers[1], longText: { available: true, apiConfigured: false },
    }] } });
    render(<VoiceGenerationPanel {...input} />);
    expect(control("文本分析").value).toBe("api");
    expect(screen.getByRole("alert").textContent).toBe("请先配置外部文本 API。");
    expect(input.onOptionsChange).not.toHaveBeenCalled();
  });

  it("disables both long-text controls while generation is busy", () => {
    const input = props({ busy: true, options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh", generationMode: "long_text" } });
    render(<VoiceGenerationPanel {...input} />);
    expect(control("生成方式").disabled).toBe(true);
    expect(control("文本分析").disabled).toBe(true);
    fireEvent.change(control("生成方式"), { target: { value: "clip" } });
    fireEvent.change(control("文本分析"), { target: { value: "api" } });
    expect(input.onOptionsChange).not.toHaveBeenCalled();
  });

  it("keeps long-text group counts and actual join durations inside collapsed generation details", () => {
    render(<VoiceGenerationPanel {...props({ candidates: [longTextCandidate()] })} />);
    const article = screen.getByRole("article", { name: "候选 1" });
    const details = within(article).getByText("生成详情").closest("details")!;
    expect(details.open).toBe(false);
    expect(within(details).getByText("长文分组")).toBeTruthy();
    expect(within(details).getByText("3 组")).toBeTruthy();
    expect(within(details).getByText("350 / 440 ms")).toBeTruthy();
    expect(within(details).getByText("外部 API")).toBeTruthy();
    expect(within(details).getByText("text-analysis-model")).toBeTruthy();
    expect(within(article).getAllByText("3 组")).toHaveLength(1);
    expect(within(article).getAllByText("350 / 440 ms")).toHaveLength(1);
  });

  it("requests only the chosen candidate group from collapsed details without adopting it", () => {
    const take = { ...longTextCandidate(), candidateId: "long_take" };
    const input = props({
      options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh", generationMode: "long_text" },
      candidates: [candidate(), take], onRegenerateGroup: vi.fn(),
    });
    render(<VoiceGenerationPanel {...input} />);
    const article = screen.getByRole("article", { name: "候选 2" });
    const details = within(article).getByText("生成详情").closest("details")!;
    expect(details.open).toBe(false);
    expect(within(details).getByTitle("慢慢放松，第 2 组。")).toBeTruthy();
    fireEvent.click(within(details).getByRole("button", { name: "重生成候选 2 第 2 组" }));
    expect(input.onRegenerateGroup).toHaveBeenCalledExactlyOnceWith(take, 1);
    expect(input.onAdopt).not.toHaveBeenCalled();
    expect(input.onDiscard).not.toHaveBeenCalled();
    expect(screen.getByLabelText("候选 2 试听")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "候选 1" })).queryByRole("button", { name: /重生成候选/ })).toBeNull();
  });

  it.each(["busy", "loading", "stale"] as const)("blocks group regeneration when %s", (state) => {
    if (selectedClip.type !== "voice") throw new Error("Expected voice");
    const input = props({
      options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh", generationMode: "long_text" },
      candidates: [longTextCandidate()], onRegenerateGroup: vi.fn(),
      busy: state === "busy", loading: state === "loading",
      selectedClip: state === "stale" ? { ...selectedClip, text: "刚刚编辑的新文案。" } : selectedClip,
    });
    render(<VoiceGenerationPanel {...input} />);
    const button = screen.getByRole("button", { name: "重生成候选 1 第 1 组" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(input.onRegenerateGroup).not.toHaveBeenCalled();
  });

  it("does not expose group regeneration for clip mode, discarded candidates, or an absent handler", () => {
    const input = props({ candidates: [longTextCandidate()], onRegenerateGroup: vi.fn() });
    const view = render(<VoiceGenerationPanel {...input} />);
    expect(screen.queryByRole("button", { name: /重生成候选/ })).toBeNull();
    const longOptions = { ...options, provider: "voxcpm2" as const, voicePackId: "soft_zh", generationMode: "long_text" as const };
    view.rerender(<VoiceGenerationPanel {...input} options={longOptions} candidates={[{ ...longTextCandidate(), status: "discarded" }]} />);
    expect(screen.queryByRole("button", { name: /重生成候选/ })).toBeNull();
    view.rerender(<VoiceGenerationPanel {...input} options={longOptions} onRegenerateGroup={undefined} />);
    expect(screen.queryByRole("button", { name: /重生成候选/ })).toBeNull();
  });

  it("previews the individual group asset and pauses other audio in the same panel", () => {
    render(<VoiceGenerationPanel {...props({ candidates: [longTextCandidate()] })} />);
    const groupAudio = screen.getByLabelText("候选 1 第 2 组试听") as HTMLAudioElement;
    const wholeAudio = screen.getByLabelText("候选 1 试听") as HTMLAudioElement;
    expect(groupAudio.getAttribute("src")).toBe("/api/assets/clip/group_1");
    expect(groupAudio.preload).toBe("none");
    expect(groupAudio.autoplay).toBe(false);
    const pauses = [...screen.getByRole("region", { name: "人声生成设置" }).querySelectorAll("audio")].map((audio) => vi.spyOn(audio, "pause").mockImplementation(() => {}));
    fireEvent.play(groupAudio);
    expect(wholeAudio.pause).toHaveBeenCalledOnce();
    expect(groupAudio.pause).not.toHaveBeenCalled();
    for (const pause of pauses) pause.mockRestore();
  });

  it("offers separate current and candidate audio without autoplay and keeps provenance collapsed", () => {
    const take = candidate();
    const input = props({
      selectedClip: { ...selectedClip, asset: { asset_id: "original", uri: "asset://clip/original", duration: 5 } },
      candidates: [take],
    });
    render(<VoiceGenerationPanel {...input} />);
    const audio = screen.getByLabelText("候选 1 试听") as HTMLAudioElement;
    expect(audio.getAttribute("src")).toBe("/api/assets/clip/voice_fixture_1");
    expect(audio.preload).toBe("none");
    expect(audio.autoplay).toBe(false);
    expect(screen.getByLabelText("当前人声试听").getAttribute("src")).toBe("/api/assets/clip/original");
    expect(screen.getByText("8.5 秒")).toBeTruthy();
    expect(screen.getByText("生成详情").closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "采用候选 1" }));
    expect(input.onAdopt).toHaveBeenCalledWith(take);
    fireEvent.click(screen.getByRole("button", { name: "放弃候选 1" }));
    expect(input.onDiscard).toHaveBeenCalledWith(take);
  });

  it("marks the selected clip asset as adopted and prevents adopting or discarding it again", () => {
    const take = candidate();
    render(<VoiceGenerationPanel {...props({
      candidates: [take], selectedClip: { ...selectedClip, asset: { asset_id: take.asset.assetId, uri: take.asset.uri, duration: take.asset.duration } },
    })} />);
    expect(screen.getByText("已采用")).toBeTruthy();
    expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "放弃候选 1" })).toBeNull();
  });

  it("keeps old takes playable but blocks adoption after their source text changes", () => {
    if (selectedClip.type !== "voice") throw new Error("Expected voice");
    const input = props({ candidates: [candidate()], selectedClip: { ...selectedClip, text: "新的台词。" } });
    render(<VoiceGenerationPanel {...input} />);
    expect(screen.getByLabelText("候选 1 试听")).toBeTruthy();
    expect(screen.getByText("文案已修改，请重新生成。" )).toBeTruthy();
    const adopt = screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement;
    expect(adopt.disabled).toBe(true);
    fireEvent.click(adopt);
    expect(input.onAdopt).not.toHaveBeenCalled();
  });

  it("keeps real warnings visible and blocks settings and candidate changes while busy", () => {
    const take = { ...candidate(), qualityWarnings: ["可能读到步数上限，请试听结尾。"] };
    render(<VoiceGenerationPanel {...props({ candidates: [take], busy: true, error: "本地生成失败。" })} />);
    expect(screen.getByText(take.qualityWarnings[0])).toBeTruthy();
    expect(screen.getByText("本地生成失败。")).toBeTruthy();
    for (const select of screen.getAllByRole("combobox")) expect((select as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "放弃候选 1" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("restores adopted audio only when the parent says the saved undo is valid", () => {
    const input = props({ hasUndo: true, canUndo: true });
    const view = render(<VoiceGenerationPanel {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "撤回上次采用" }));
    expect(input.onUndo).toHaveBeenCalledOnce();
    view.rerender(<VoiceGenerationPanel {...input} canUndo={false} />);
    expect(screen.getByText("片段已编辑，可从历史版本恢复。" )).toBeTruthy();
    expect((screen.getByRole("button", { name: "撤回上次采用" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows catalog errors, hides discarded or other clip takes, and never renders non-voice controls", () => {
    const view = render(<VoiceGenerationPanel {...props({ catalog: null, catalogError: "声音配置暂不可用。", candidates: [
      { ...candidate(), status: "discarded" }, { ...candidate(), clipId: "other" },
    ] })} />);
    expect(screen.getByText("声音配置暂不可用。" )).toBeTruthy();
    expect(control("人声引擎").disabled).toBe(true);
    expect(screen.queryByLabelText("候选 1 试听")).toBeNull();
    const nonVoice = flattenClips(demoProject).find((clip) => clip.type !== "voice") as TimelineClip;
    view.rerender(<VoiceGenerationPanel {...props({ selectedClip: nonVoice })} />);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("keeps the provided generation action above current audio and accumulated candidates", () => {
    render(<VoiceGenerationPanel {...props({
      generationControl: <button>生成新候选</button>,
      selectedClip: { ...selectedClip, asset: { asset_id: "original", uri: "asset://clip/original", duration: 5 } },
      candidates: [candidate()],
    })} />);
    const action = screen.getByRole("button", { name: "生成新候选" });
    expect(control("参考模式").compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(action.compareDocumentPosition(screen.getByLabelText("当前人声试听")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(action.compareDocumentPosition(screen.getByLabelText("候选 1 试听")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("pauses the other previews when one current or candidate audio starts playing", () => {
    const first = candidate();
    render(<VoiceGenerationPanel {...props({
      selectedClip: { ...selectedClip, asset: { asset_id: "original", uri: "asset://clip/original", duration: 5 } },
      candidates: [first, { ...first, candidateId: "candidate_second", asset: { ...first.asset, assetId: "second", uri: "asset://clip/second" } }],
    })} />);
    const original = screen.getByLabelText("当前人声试听") as HTMLAudioElement;
    const firstAudio = screen.getByLabelText("候选 1 试听") as HTMLAudioElement;
    const secondAudio = screen.getByLabelText("候选 2 试听") as HTMLAudioElement;
    const pauseOriginal = vi.spyOn(original, "pause").mockImplementation(() => {});
    const pauseFirst = vi.spyOn(firstAudio, "pause").mockImplementation(() => {});
    const pauseSecond = vi.spyOn(secondAudio, "pause").mockImplementation(() => {});

    fireEvent.play(firstAudio);
    expect(pauseOriginal).toHaveBeenCalledOnce();
    expect(pauseSecond).toHaveBeenCalledOnce();
    expect(pauseFirst).not.toHaveBeenCalled();
    fireEvent.play(original);
    expect(pauseFirst).toHaveBeenCalledOnce();
    expect(pauseSecond).toHaveBeenCalledTimes(2);
  });
});
