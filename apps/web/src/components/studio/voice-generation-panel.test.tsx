// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getVoiceCandidateSourceFingerprint } from "@/lib/asmr/audio-candidate";
import { demoProject } from "@/lib/asmr/mock-project";
import type { TimelineClip } from "@/lib/asmr/schema";
import { flattenClips } from "@/lib/asmr/view-model";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import type { VoiceGenerationOptions } from "@/lib/asmr/voice-generation-options";
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
    { id: "voxcpm2", label: "VoxCPM2", available: true, defaultReferenceId: "soft_zh", references: [
      { id: "normal_zh", label: "普通中文参考", referenceModes: ["reference_only"] },
      { id: "soft_zh", label: "温柔中文参考", referenceModes: ["reference_only", "with_reference_text"] },
    ] },
  ],
};

function candidate() {
  return makeVoiceCandidateFixture({ sourceFingerprint: getVoiceCandidateSourceFingerprint(selectedClip) });
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
