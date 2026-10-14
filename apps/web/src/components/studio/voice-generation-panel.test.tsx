// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getVoiceCandidateSourceFingerprint, type AudioCandidate } from "@/lib/asmr/audio-candidate";
import { demoProject } from "@/lib/asmr/mock-project";
import type { TimelineClip } from "@/lib/asmr/schema";
import { flattenClips } from "@/lib/asmr/view-model";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import type { VoiceGenerationOptions } from "@/lib/asmr/voice-generation-options";
import type { VoiceLongTextResult } from "@/lib/asmr/voice-longtext-result";
import type { VoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";
import type { VoiceRecognition } from "@/lib/asmr/voice-recognition";
import type { VoiceParagraphContext } from "@/lib/asmr/voice-paragraph-context";

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

function paragraphCandidate(): { take: AudioCandidate; context: VoiceParagraphContext } {
  const second = flattenClips(demoProject).find((clip) => clip.id === "voice_002")!;
  if (selectedClip.type !== "voice" || second.type !== "voice") throw new Error("Voice fixture required");
  const base = candidate();
  const context = { groupId: "paragraph_1", text: selectedClip.text + second.text,
    clips: [selectedClip, second].map((clip) => ({ clipId: clip.id, text: clip.text, emotion: clip.emotion, style: clip.style, pace: clip.pace })) };
  const asset = { assetId: "paragraph_first", uri: "asset://clip/paragraph_first", duration: 3 };
  const sourceAsset = { assetId: "paragraph_source", uri: "asset://clip/paragraph_source", duration: 5 };
  const take: AudioCandidate = { ...base, candidateId: "paragraph_candidate", asset,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(selectedClip, undefined, context),
    provenance: { ...base.provenance, generationMode: "paragraph", paragraph: { version: 1, groupId: context.groupId,
      text: context.text, clipIds: context.clips.map((clip) => clip.clipId), sourceAsset, checkStatus: "passed", segments: [
        { clipId: selectedClip.id, text: selectedClip.text, asset, cutStartSeconds: 0, cutEndSeconds: 3,
          recognition: { stage: "complete", expectedText: selectedClip.text, followingText: second.text, sourceTranscript: context.text, targetTranscript: selectedClip.text } },
        { clipId: second.id, text: second.text, asset: { assetId: "paragraph_second", uri: "asset://clip/paragraph_second", duration: 2 }, cutStartSeconds: 3, cutEndSeconds: 5,
          recognition: { stage: "complete", expectedText: second.text, sourceTranscript: second.text, targetTranscript: second.text } },
      ] } } };
  return { take, context };
}

function manualParagraphCandidate() {
  const base = paragraphCandidate();
  if (selectedClip.type !== "voice") throw new Error("Voice fixture required");
  const clip = { ...selectedClip, text: "回来啦。" };
  const context = { ...base.context, text: "回来啦。先坐。", clips: base.context.clips.map((item, index) => ({ ...item, text: index ? "先坐。" : "回来啦。" })) };
  const textReview = { status: "needs_confirmation" as const, reason: "missing_final_particle" as const, expected: "回来啦", sourcePrefix: "回来了",
    expectedPinyin: "la5" as const, sourcePinyin: "le5" as const, similarity: 2 / 3,
    left: { transcript: "回来", words: [{ text: "回来", start: .1, end: 1 }], durationSeconds: 3 },
    right: { transcript: "先坐", words: [{ text: "先坐", start: .1, end: 1 }], durationSeconds: 2 },
    final: { transcript: "回来", words: [{ text: "回来", start: .1, end: 1 }], durationSeconds: 3 } };
  const take: AudioCandidate = { ...base.take, sourceFingerprint: getVoiceCandidateSourceFingerprint(clip, undefined, context), provenance: { ...base.take.provenance,
    paragraph: { ...base.take.provenance.paragraph!, text: context.text, checkStatus: "needs_confirmation",
      segments: base.take.provenance.paragraph!.segments.map((segment, index) => ({ ...segment, text: context.clips[index].text,
        recognition: { stage: "complete", expectedText: context.clips[index].text, ...(index ? {} : { followingText: context.clips[1].text, shortSentenceReview: textReview }),
          sourceTranscript: index ? "先坐" : "回来了先坐", targetTranscript: index ? "先坐" : "回来",
          sourceWords: index ? [{ text: "先坐", start: .1, end: 1 }] : [{ text: "回来了", start: .1, end: 1 }, { text: "先坐", start: 3.1, end: 4 }] }, ...(index ? {} : { textReview }) })) } } };
  return { take, context, clip, textReview };
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

function recognitionCandidate(group: Partial<VoiceLongTextResult["groups"][number]>) {
  const take = longTextCandidate();
  take.provenance.longText.groups = [{ ...take.provenance.longText.groups[0], isFinal: true, ...group }];
  take.provenance.longText.joins = [];
  return take;
}

function recognitionWithDifference(): VoiceRecognition {
  return {
    expectedText: "回来啦？外面是不是很冷？", sourceTranscript: "回来了，外面是不是很冷？快进来。",
    targetTranscript: "回来了，外面是不是很冷？", stage: "complete",
    contentComparison: { status: "different", similarity: 0.9, threshold: 0.9, substitutionCount: 1,
      expected: "回来啦外面是不是很冷", recognized: "回来了外面是不是很冷" },
  };
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

function mockMediaCall(audio: HTMLAudioElement, method: "pause" | "load") {
  const mock = vi.fn();
  Object.defineProperty(audio, method, { value: mock, configurable: true });
  return mock;
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("voice generation panel", () => {
  it("requires an unchecked explicit listen confirmation for every flagged native short slice", () => {
    const { take, context, clip } = manualParagraphCandidate();
    const onConfirmText = vi.fn();
    const input = props({ selectedClip: clip, candidates: [take], onConfirmText, options: { ...options, provider: "voxcpm2", generationMode: "paragraph" } });
    const view = render(<VoiceGenerationPanel {...input} workspaceMode="paragraph" paragraphContext={context} />);
    const checkbox = screen.getByRole("checkbox", { name: "候选 1 短句 1 已听且台词完整" }) as HTMLInputElement;
    const confirmation = screen.getByRole("button", { name: "确认并采用候选 1" }) as HTMLButtonElement;
    expect(checkbox.checked).toBe(false);
    expect(confirmation.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "采用候选 1" })).toBeNull();
    expect(screen.getByLabelText("候选 1 短句 1 原声试听").getAttribute("src")).toBe("/api/assets/clip/paragraph_first");
    expect(screen.getByText("裁后识别：回来")).toBeTruthy();
    fireEvent.click(checkbox);
    expect(confirmation.disabled).toBe(false);
    fireEvent.click(confirmation);
    expect(onConfirmText).toHaveBeenCalledWith(take, [clip.id]);
    expect(input.onAdopt).not.toHaveBeenCalled();
    view.rerender(<VoiceGenerationPanel {...input} workspaceMode="paragraph" paragraphContext={context} busy confirmingCandidateId={take.candidateId} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "确认并采用候选 1" }).textContent).toBe("确认中…");
    expect((screen.getByRole("button", { name: "确认并采用候选 1" }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<VoiceGenerationPanel {...input} workspaceMode="paragraph" paragraphContext={{ ...context, text: context.text + "已修改。" }} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "确认并采用候选 1" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows saved manual confirmation without claiming automatic text checks passed", () => {
    const { take, context, clip } = manualParagraphCandidate();
    const confirmationWarning = "短句音频已安全切分，部分文字待试听确认；请逐句确认后采用整段。";
    take.qualityWarnings = [confirmationWarning, "完整原音音量较低。"];
    take.provenance.paragraph!.manualTextConfirmation = { confirmedClipIds: [clip.id], sourceCandidateId: take.candidateId, confirmedAt: "2026-10-14T13:45:00.000Z" };
    const input = props({ selectedClip: clip, candidates: [take], onConfirmText: vi.fn(), options: { ...options, provider: "voxcpm2", generationMode: "paragraph" } });
    render(<VoiceGenerationPanel {...input} workspaceMode="paragraph" paragraphContext={context} />);
    expect(screen.getByText("整段切分 · 台词已试听确认")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/各短句已通过文字、双侧识别/)).toBeNull();
    expect(screen.queryByText(/整段已通过 \d+ 个短句/)).toBeNull();
    expect(screen.getByText("识别文字有差异，已试听确认。")).toBeTruthy();
    expect(screen.queryByText(confirmationWarning)).toBeNull();
    expect(screen.getByText("完整原音音量较低。")).toBeTruthy();
    expect(take.qualityWarnings[0]).toBe(confirmationWarning);
    fireEvent.click(screen.getByRole("button", { name: "采用候选 1" }));
    expect(input.onAdopt).toHaveBeenCalledWith(take);
  });

  it.each(["final_only", "source_only", "left_only", "both"])("labels a %s same-tone difference at its actual evidence location", (kind) => {
    const { take, context, clip: initialClip, textReview } = manualParagraphCandidate();
    const clip = { ...initialClip, text: "过来坐。" };
    context.clips[0].text = clip.text;
    context.text = clip.text + context.clips[1].text;
    take.sourceFingerprint = getVoiceCandidateSourceFingerprint(clip, undefined, context);
    take.provenance.paragraph!.text = context.text;
    const first = take.provenance.paragraph!.segments[0];
    first.text = clip.text;
    const finalText = kind === "final_only" || kind === "both" ? "过来做" : "过来坐";
    const sourceText = kind === "source_only" || kind === "both" ? "过来做" : "过来坐";
    const leftText = kind === "left_only" || kind === "both" ? "过来做" : "过来坐";
    first.textReview = { status: "needs_confirmation", reason: "same_tone_substitution", expected: "过来坐", sourcePrefix: sourceText, similarity: finalText === "过来坐" ? 1 : 2 / 3,
      differences: [{ index: 2, expected: "坐", recognized: "做", expectedPinyin: "zuo4", recognizedPinyin: "zuo4", rule: "same_tone" }],
      left: { transcript: leftText, words: [{ text: leftText, start: .1, end: 1 }], durationSeconds: 3 }, right: textReview.right,
      final: { transcript: finalText, words: [{ text: finalText, start: .1, end: 1 }], durationSeconds: 3 } };
    first.recognition = { ...first.recognition!, expectedText: first.text, sourceTranscript: sourceText + "先坐", targetTranscript: finalText,
      sourceWords: [{ text: sourceText, start: .1, end: 1 }, { text: "先坐", start: 3.1, end: 4 }], shortSentenceReview: first.textReview };
    const onConfirmText = vi.fn();
    render(<VoiceGenerationPanel {...props({ selectedClip: clip, candidates: [take], onConfirmText,
      options: { ...options, provider: "voxcpm2", generationMode: "paragraph" } })} workspaceMode="paragraph" paragraphContext={context} />);
    expect(screen.getByText("同音字待试听确认")).toBeTruthy();
    expect(screen.getByText(`裁后识别：${finalText}`)).toBeTruthy();
    expect(screen.getByText("坐 → 做 · 同音同调（zuo4）")).toBeTruthy();
    if (kind === "source_only") {
      expect(screen.getByText("源定位识别有同音字差，裁后识别一致。")).toBeTruthy();
      expect(screen.getByText("源定位识别：过来做")).toBeTruthy();
      expect(screen.getByText("字差位置：源定位")).toBeTruthy();
    }
    if (kind === "left_only") expect(screen.getByText("切点左侧识别有同音字差，裁后识别一致。")).toBeTruthy();
    if (kind === "final_only") expect(screen.getByText("字差位置：裁后识别")).toBeTruthy();
    if (kind === "both") expect(screen.getByText("字差位置：源定位、切点左侧、裁后识别")).toBeTruthy();
    expect(screen.queryByText("句尾语气词待试听确认")).toBeNull();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "确认并采用候选 1" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "确认并采用候选 1" }));
    expect(onConfirmText).toHaveBeenCalledWith(take, [clip.id]);
  });

  it("identifies only the missing-particle window when final ASR retained the allowed particle variant", () => {
    const { take, context, clip, textReview } = manualParagraphCandidate();
    const first = take.provenance.paragraph!.segments[0];
    first.textReview = { ...textReview, final: { transcript: "回来了", words: [{ text: "回来了", start: .1, end: 1 }], durationSeconds: 3 } };
    first.recognition = { ...first.recognition!, targetTranscript: "回来了", shortSentenceReview: first.textReview };
    render(<VoiceGenerationPanel {...props({ selectedClip: clip, candidates: [take], onConfirmText: vi.fn(),
      options: { ...options, provider: "voxcpm2", generationMode: "paragraph" } })} workspaceMode="paragraph" paragraphContext={context} />);
    expect(screen.getByText("切点左侧漏了句尾语气词；裁后识别已保留语气词。")).toBeTruthy();
    expect(screen.getByText("字差位置：切点左侧")).toBeTruthy();
    expect(screen.getByText("裁后识别：回来了")).toBeTruthy();
    expect(screen.getByText("切点左侧识别：回来")).toBeTruthy();
    expect((screen.getByRole("button", { name: "确认并采用候选 1" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables confirmation only after every flagged short sentence is explicitly checked", () => {
    const { take, context, clip, textReview } = manualParagraphCandidate();
    context.clips[1].text = "坐下啦。";
    context.text = "回来啦。坐下啦。";
    take.sourceFingerprint = getVoiceCandidateSourceFingerprint(clip, undefined, context);
    const paragraph = take.provenance.paragraph!;
    paragraph.text = context.text;
    const first = paragraph.segments[0];
    const right = { transcript: "坐下啦", words: [{ text: "坐下啦", start: .1, end: 1 }], durationSeconds: 2 };
    first.textReview = { ...textReview, right };
    first.recognition = { ...first.recognition!, followingText: context.clips[1].text, sourceTranscript: "回来了坐下啦",
      sourceWords: [{ text: "回来了", start: .1, end: 1 }, { text: "坐下啦", start: 3.1, end: 4 }], shortSentenceReview: first.textReview };
    const second = paragraph.segments[1];
    second.text = context.clips[1].text;
    second.textReview = { ...textReview, expected: "坐下啦", sourcePrefix: "坐下啦", sourcePinyin: "la5", left: undefined, right: undefined,
      final: { transcript: "坐下", words: [{ text: "坐下", start: .1, end: 1 }], durationSeconds: 2 } };
    second.recognition = { stage: "complete", expectedText: second.text, sourceTranscript: "坐下啦", targetTranscript: "坐下",
      sourceWords: [{ text: "坐下啦", start: .1, end: 1 }], shortSentenceReview: second.textReview };
    const onConfirmText = vi.fn();
    render(<VoiceGenerationPanel {...props({ selectedClip: clip, candidates: [take], onConfirmText,
      options: { ...options, provider: "voxcpm2", generationMode: "paragraph" } })} workspaceMode="paragraph" paragraphContext={context} />);
    const button = screen.getByRole("button", { name: "确认并采用候选 1" }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole("checkbox", { name: "候选 1 短句 1 已听且台词完整" }));
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "候选 1 短句 2 已听且台词完整" }));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onConfirmText).toHaveBeenCalledWith(take, context.clips.map((item) => item.clipId));
  });

  it("keeps the short generation controls and paragraph candidates in their own workspace", () => {
    const { take, context } = paragraphCandidate();
    const short = candidate();
    const input = props({ options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh" }, candidates: [short, take] });
    const view = render(<VoiceGenerationPanel {...input} workspaceMode="short" />);
    expect(control("生成方式").value).toBe("clip");
    expect(screen.getByLabelText("候选 1 试听").getAttribute("src")).toContain(short.asset.assetId);
    expect(screen.queryByLabelText("整段生成文案")).toBeNull();
    view.rerender(<VoiceGenerationPanel {...input} workspaceMode="paragraph" paragraphContext={context} options={{ ...input.options, generationMode: "paragraph" }} />);
    expect(screen.queryByRole("combobox", { name: "生成方式" })).toBeNull();
    expect(screen.getByLabelText("候选 1 试听").getAttribute("src")).toContain("paragraph_first");
    expect(screen.getByLabelText("整段生成文案").textContent).toContain(context.text);
    expect((screen.getByLabelText("整段生成文案") as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByLabelText("整段生成文案").querySelector("summary")?.textContent).toContain("生成范围");
    expect(screen.getByText("整段切分 · 2 句")).toBeTruthy();
    expect(screen.getByLabelText("候选 1 整段完整原音试听").getAttribute("src")).toContain("paragraph_source");
    expect(screen.getByRole("link", { name: "下载整段原音" }).getAttribute("href")).toContain("paragraph_source?download=1");
    expect(screen.getByLabelText("整段短句切分").children).toHaveLength(2);
  });
  it("invalidates paragraph adoption when another short sentence in the group changes", () => {
    const { take, context } = paragraphCandidate();
    const input = props({ options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh", generationMode: "paragraph" }, candidates: [take] });
    const view = render(<VoiceGenerationPanel {...input} workspaceMode="paragraph" paragraphContext={context} />);
    expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(false);
    const changed = { ...context, text: context.clips[0].text + "后半句已经修改。", clips: context.clips.map((clip, index) => index ? { ...clip, text: "后半句已经修改。" } : clip) };
    view.rerender(<VoiceGenerationPanel {...input} workspaceMode="paragraph" paragraphContext={changed} />);
    expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("整段文案已修改，请重新生成。")).toBeTruthy();
  });
  it("preserves full originals for review and can recheck them without legacy group regeneration", () => {
    const { take, context } = paragraphCandidate();
    const review = { ...take, asset: take.provenance.paragraph!.sourceAsset,
      provenance: { ...take.provenance, paragraph: { ...take.provenance.paragraph!, checkStatus: "review" as const, segments: [] } } };
    const onRecheck = vi.fn();
    render(<VoiceGenerationPanel {...props({ candidates: [review], onRecheck, onRegenerateGroup: vi.fn(),
      options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh", generationMode: "paragraph" } })} workspaceMode="paragraph" paragraphContext={context} />);
    expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("完整原音 · 切分待确认")).toBeTruthy();
    const recheck = screen.getByRole("button", { name: "重新识别候选 1" }) as HTMLButtonElement;
    expect(recheck.disabled).toBe(false);
    expect(recheck.title).toContain("只检查已保存整段原音，不重新生成语音");
    fireEvent.click(recheck);
    expect(onRecheck).toHaveBeenCalledWith(review);
    expect(screen.queryByText("重生成内部组")).toBeNull();
    expect(screen.getByRole("link", { name: "下载整段原音" })).toBeTruthy();
    expect(screen.queryByText("未保存识别文本")).toBeNull();
  });
  it("renders one paragraph recognition disclosure using each short target and the successive source scope", () => {
    const { take, context } = paragraphCandidate();
    render(<VoiceGenerationPanel {...props({ candidates: [take], options: { ...options, provider: "voxcpm2", generationMode: "paragraph" } })}
      workspaceMode="paragraph" paragraphContext={context} />);
    expect(screen.getAllByText("识别对照")).toHaveLength(1);
    const disclosure = screen.getByText("识别对照").closest("details")!;
    expect(disclosure.open).toBe(false);
    expect(within(disclosure).getByText("整段原音识别").nextElementSibling?.textContent).toBe(context.text);
    expect(within(disclosure).getByText("剩余原音识别").nextElementSibling?.textContent).toBe(context.clips[1].text);
    expect(within(disclosure).getAllByText("目标台词").map((label) => label.nextElementSibling?.textContent)).toEqual(context.clips.map((clip) => clip.text));
    expect(within(disclosure).queryByText("未保存识别文本")).toBeNull();
    expect(within(disclosure).queryByText("本条试听与下载均为完整原音。")).toBeNull();
  });
  it("shows a saved failed short target on paragraph review candidates and keeps stale rechecks disabled", () => {
    const { take, context } = paragraphCandidate();
    const failureRecognition: VoiceRecognition = { stage: "source_alignment", expectedText: context.clips[0].text,
      followingText: context.clips[1].text, sourceTranscript: "已保存的整段识别文字", alignment: { expected: "回来啦", recognizedPrefix: "回来了", reason: "uncertain_word_alignment" } };
    const review: AudioCandidate = { ...take, asset: take.provenance.paragraph!.sourceAsset, provenance: { ...take.provenance,
      paragraph: { ...take.provenance.paragraph!, checkStatus: "review", segments: [], diagnosticCode: "uncertain_word_alignment", failureRecognition, failedClipId: context.clips[0].clipId } } };
    const input = props({ candidates: [review], onRecheck: vi.fn(), options: { ...options, provider: "voxcpm2", generationMode: "paragraph" } });
    const view = render(<VoiceGenerationPanel {...input} workspaceMode="paragraph" paragraphContext={context} />);
    const disclosure = screen.getByText("识别对照").closest("details")!;
    expect(within(disclosure).getByText("目标台词").nextElementSibling?.textContent).toBe(context.clips[0].text);
    expect(within(disclosure).getByText("整段原音识别").nextElementSibling?.textContent).toBe(failureRecognition.sourceTranscript);
    expect(within(disclosure).getByText("识别文字未能定位目标句的结束位置。")).toBeTruthy();
    expect(within(disclosure).queryByText("未保存识别文本")).toBeNull();
    view.rerender(<VoiceGenerationPanel {...input} workspaceMode="paragraph" paragraphContext={{ ...context, text: context.text + "已修改。" }} />);
    expect((screen.getByRole("button", { name: "重新识别候选 1" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("scopes original-recording requests to the active audio workspace and resets on tab changes", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ recordings: [], truncated: false }) });
    vi.stubGlobal("fetch", fetcher);
    const input = props({ projectId: "project", options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh" } });
    const view = render(<VoiceGenerationPanel {...input} workspaceMode="short" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(new URL(String(fetcher.mock.calls[0][0]), "http://localhost").searchParams.get("workspaceMode")).toBe("short");
    const { context } = paragraphCandidate();
    view.rerender(<VoiceGenerationPanel {...input} workspaceMode="paragraph" paragraphContext={context} options={{ ...input.options, generationMode: "paragraph" }} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(new URL(String(fetcher.mock.calls[1][0]), "http://localhost").searchParams.get("workspaceMode")).toBe("paragraph");
  });
  it("displays recovered paragraph failure evidence on saved originals without relabelling the first short target", async () => {
    const { context } = paragraphCandidate();
    const failureRecognition: VoiceRecognition = { stage: "source_alignment", expectedText: context.clips[0].text,
      followingText: context.clips[1].text, sourceTranscript: "此前已保存的整段识别结果", alignment: { expected: "回来啦", recognizedPrefix: "回来了", reason: "uncertain_word_alignment" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ truncated: false, recordings: [{
      recordingId: "current_11111111-2222-4333-8444-555555555555_1_1", runId: "11111111-2222-4333-8444-555555555555", group: 1, take: 1,
      expectedText: context.text, inputText: context.text, createdAt: "2026-10-14T08:20:00.000Z", duration: 5,
      audioUrl: "/api/voice-generation-recordings/current_11111111-2222-4333-8444-555555555555_1_1", status: "needs_review", historicalMatch: false,
      warning: "识别文字未能定位目标句的结束位置；请展开识别对照。", paragraphRecognition: { checkStatus: "review", clipIds: context.clips.map((clip) => clip.clipId),
        segments: [], diagnosticCode: "uncertain_word_alignment", failedClipId: context.clips[0].clipId, failureRecognition },
    }] }) }));
    render(<VoiceGenerationPanel {...props({ projectId: "p", options: { ...options, provider: "voxcpm2", generationMode: "paragraph" } })}
      workspaceMode="paragraph" paragraphContext={context} />);
    await screen.findByLabelText("完整原音 1 试听");
    const original = screen.getByRole("article", { name: "完整原音 1" });
    const evidence = within(original).getByText("识别对照").closest("details")!;
    expect(within(evidence).getByText("本条试听与下载均为完整原音。")).toBeTruthy();
    expect(within(evidence).getByText("整段台词").nextElementSibling?.textContent).toBe(context.text);
    expect(within(evidence).getByText("目标台词").nextElementSibling?.textContent).toBe(context.clips[0].text);
    expect(within(evidence).getByText("整段原音识别").nextElementSibling?.textContent).toBe(failureRecognition.sourceTranscript);
    expect(within(evidence).queryByText("未保存识别文本")).toBeNull();
  });
  it("offers re-recognition beside adoption without regenerating and allows an adopted long-text take", () => {
    if (selectedClip.type !== "voice") throw new Error("Voice fixture required");
    const take = recognitionCandidate({ text: selectedClip.text, inputText: selectedClip.text, internalPausesMs: [], internalPauseClasses: [] });
    take.provenance.longText.plan = { clauses: [selectedClip.text], groups: [{ start: 0, end: 0, text: selectedClip.text, pauseAfter: "medium" }], clausePauseClasses: [], provider: "rules", warnings: [] };
    const onRecheck = vi.fn();
    const input = props({ candidates: [take], onRecheck });
    const view = render(<VoiceGenerationPanel {...input} />);
    const recheck = screen.getByRole("button", { name: "重新识别候选 1" });
    expect(recheck.parentElement).toBe(screen.getByRole("button", { name: "采用候选 1" }).parentElement);
    fireEvent.click(recheck);
    expect(onRecheck).toHaveBeenCalledWith(take);
    expect(input.onAdopt).not.toHaveBeenCalled();
    view.rerender(<VoiceGenerationPanel {...input} selectedClip={{ ...selectedClip, asset: { asset_id: take.asset.assetId, uri: take.asset.uri, duration: take.asset.duration } }} />);
    expect((screen.getByRole("button", { name: "重新识别候选 1" }) as HTMLButtonElement).disabled).toBe(false);
    for (const locked of [{ busy: true }, { referenceImportBusy: true }, { loading: true },
      { candidates: [{ ...take, sourceFingerprint: "stale" }] }]) {
      view.rerender(<VoiceGenerationPanel {...input} {...locked} />);
      expect((screen.getByRole("button", { name: "重新识别候选 1" }) as HTMLButtonElement).disabled).toBe(true);
    }
    const onCancelRecheck = vi.fn();
    view.rerender(<VoiceGenerationPanel {...input} busy recheckingCandidateId={take.candidateId} onCancelRecheck={onCancelRecheck} />);
    expect(screen.getByRole("button", { name: "重新识别候选 1" }).textContent).toBe("重新识别中…");
    fireEvent.click(screen.getByRole("button", { name: "取消重新识别" }));
    expect(onCancelRecheck).toHaveBeenCalledOnce();
    view.rerender(<VoiceGenerationPanel {...input} candidates={[candidate()]} />);
    expect((screen.getByRole("button", { name: "重新识别候选 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("未保存分组原音，暂不能重新识别。")).toBeTruthy();
    const legacy = recognitionCandidate({});
    view.rerender(<VoiceGenerationPanel {...input} candidates={[legacy]} />);
    expect((screen.getByRole("button", { name: "重新识别候选 1" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("corrects only the exact legacy continuation warning for the same review group without mutating its candidate", () => {
    const text = "今天是不是又加班了？眼睛都红红的。";
    const legacy = `第 1 段“${text}”：识别文字与目标台词存在差异，已保留完整原音供试听，没有因此重新生成或丢弃录音。`;
    const unrelated = "识别文字与目标台词存在差异，请检查其他录音。";
    const take = recognitionCandidate({ text, checkStatus: "review", diagnosticCode: "unrecognized_continuation",
      recognition: { stage: "continuation_alignment", expectedText: text, sourceTranscript: "今天是不是又加班了眼睛都红红的嗯面快好了", followingText: "面快好了，" } });
    take.qualityWarnings = [legacy, unrelated];
    const before = JSON.stringify(take);
    const input = props({ candidates: [take] });
    const view = render(<VoiceGenerationPanel {...input} />);
    expect(screen.queryByText(legacy)).toBeNull();
    expect(screen.getAllByRole("alert")[0].textContent).toContain("后续台词衔接未能定位");
    expect(screen.getByText(unrelated)).toBeTruthy();
    expect(JSON.stringify(take)).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "采用候选 1" }));
    expect(input.onAdopt).toHaveBeenCalledWith(take);
    for (const group of [ { ...take.provenance.longText.groups[0], checkStatus: "passed" as const },
      { ...take.provenance.longText.groups[0], checkStatus: undefined },
      { ...take.provenance.longText.groups[0], diagnosticCode: "cut_text_mismatch" } ]) {
      view.rerender(<VoiceGenerationPanel {...input} candidates={[{ ...take, provenance: { ...take.provenance,
        longText: { ...take.provenance.longText, groups: [group] } } }]} />);
      expect(screen.getByText(legacy)).toBeTruthy();
      expect(screen.getByText(unrelated)).toBeTruthy();
    }
  });

  it("shows reference upload only for VoxCPM2 and locks selection during import without reporting generation", () => {
    const input = props({ options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh" },
      onReferenceImported: vi.fn(), onReferenceCatalogRefresh: vi.fn(), onReferenceImportBusyChange: vi.fn() });
    const view = render(<VoiceGenerationPanel {...input} />);
    expect(screen.getByRole("button", { name: "添加参考音频" })).toBeTruthy();
    view.rerender(<VoiceGenerationPanel {...input} referenceImportBusy />);
    expect(control("参考声音").disabled).toBe(true); expect(control("人声引擎").disabled).toBe(true);
    expect(screen.queryByText("正在生成")).toBeNull();
    view.rerender(<VoiceGenerationPanel {...input} options={options} />);
    expect(screen.queryByRole("button", { name: "添加参考音频" })).toBeNull();
    expect(screen.getByText(/添加参考音频请在/)).toBeTruthy();
  });

  it("previews a selected imported reference and stops the current clip preview when it plays", () => {
    const take = candidate();
    const withAudio: VoiceProviderCatalog = { providers: catalog.providers.map((provider) => provider.id === "voxcpm2" ? {
      ...provider, references: provider.references.map((reference) => reference.id === "soft_zh" ? { ...reference, audioUrl: "/api/voice-references/soft_zh/audio", durationSeconds: 15 } : reference),
    } : provider) };
    render(<VoiceGenerationPanel {...props({ catalog: withAudio, options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh" }, candidates: [take] })} />);
    const referenceAudio = screen.getByLabelText("参考声音试听") as HTMLAudioElement;
    const candidateAudio = screen.getByLabelText("候选 1 试听") as HTMLAudioElement;
    expect(screen.getByText("参考片段 · 15.0 秒")).toBeTruthy();
    const paused = mockMediaCall(candidateAudio, "pause"); fireEvent.play(referenceAudio); expect(paused).toHaveBeenCalledOnce();
  });

  it("keeps successful source and cropped recognition collapsed beside the existing candidate actions", () => {
    const target = "回来啦？先坐一会儿。";
    const source = `${target}外面下雨了吗？`;
    const take = recognitionCandidate({ text: target, checkStatus: "passed", cutStartSeconds: 0.12, cutEndSeconds: 3.45,
      recognition: { expectedText: target, sourceTranscript: source, targetTranscript: target, stage: "complete" },
    });
    const input = props({ candidates: [take] });
    render(<VoiceGenerationPanel {...input} />);
    const disclosure = screen.getByText("识别对照").closest("details")!;
    expect(disclosure.open).toBe(false);
    expect(screen.getByLabelText("候选 1 试听")).toBeTruthy();
    fireEvent.click(screen.getByText("识别对照"));
    expect(disclosure.open).toBe(true);
    expect(within(disclosure).getByText("完整原音识别").nextElementSibling?.textContent).toBe(source);
    expect(within(disclosure).getByText("目标台词").nextElementSibling?.textContent).toBe(target);
    expect(within(disclosure).getByText("裁剪后识别").nextElementSibling?.textContent).toBe(target);
    expect(within(disclosure).getByText("已提取目标片段：0.12–3.45 秒。")).toBeTruthy();
    expect(within(disclosure).getByText("检查阶段：检查完成")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "采用候选 1" }));
    expect(input.onAdopt).toHaveBeenCalledWith(take);
  });

  it("shows a safely extracted candidate with recognized substitutions without labeling it a full-original fallback", () => {
    const recognition = recognitionWithDifference();
    const take = recognitionCandidate({ text: recognition.expectedText, checkStatus: "passed", cutStartSeconds: 0.1, cutEndSeconds: 2.5, recognition });
    const input = props({ candidates: [take] });
    render(<VoiceGenerationPanel {...input} />);
    const disclosure = screen.getByText("识别对照").closest("details")!;
    expect(disclosure.open).toBe(false);
    fireEvent.click(screen.getByText("识别对照"));
    expect(within(disclosure).getByText("已截取目标片段；识别文字与源文有差异。")).toBeTruthy();
    expect(within(disclosure).getByText("截取范围：0.10–2.50 秒。")).toBeTruthy();
    expect(within(disclosure).getByText("文字相似度 90% · 阈值 90%")).toBeTruthy();
    expect(within(disclosure).getByText("第 3 字：啦 → 了")).toBeTruthy();
    expect(within(disclosure).queryByText(/保留完整原音|念错|读错/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "采用候选 1" }));
    expect(input.onAdopt).toHaveBeenCalledWith(take);
  });

  it("keeps the full-original fallback when content comparison passes but the group cut remains under review", () => {
    const recognition = { ...recognitionWithDifference(), stage: "target_validation" as const };
    const take = recognitionCandidate({ text: recognition.expectedText, checkStatus: "review", recognition });
    render(<VoiceGenerationPanel {...props({ candidates: [take] })} />);
    const disclosure = screen.getByText("识别对照").closest("details")!;
    fireEvent.click(screen.getByText("识别对照"));
    expect(within(disclosure).getByText("保留完整原音，未采用裁剪。")).toBeTruthy();
    expect(within(disclosure).getByText("第 3 字：啦 → 了")).toBeTruthy();
    expect(within(disclosure).queryByText(/已截取目标片段/)).toBeNull();
  });

  it("explains an alignment failure with the actual recognized prefix and retained original", () => {
    const take = recognitionCandidate({ text: "回来啦？", checkStatus: "review", diagnosticCode: "uncertain_word_alignment",
      recognition: { expectedText: "回来啦？", sourceTranscript: "回来了，先坐一会儿。", stage: "source_alignment",
        alignment: { expected: "回来啦", recognizedPrefix: "回来了先坐", reason: "uncertain_word_alignment" },
      },
    });
    render(<VoiceGenerationPanel {...props({ candidates: [take] })} />);
    const disclosure = screen.getByText("识别对照").closest("details")!;
    fireEvent.click(screen.getByText("识别对照"));
    expect(within(disclosure).getByText("保留完整原音，未采用裁剪。")).toBeTruthy();
    expect(within(disclosure).getByText("回来了，先坐一会儿。")).toBeTruthy();
    expect(within(disclosure).getByText("定位时识别前缀").nextElementSibling?.textContent).toBe("回来了先坐");
    expect(within(disclosure).getByText("检查阶段：目标句定位")).toBeTruthy();
    expect(within(disclosure).getByText("识别文字未能定位目标句的结束位置。")).toBeTruthy();
    expect(within(disclosure).queryByText("裁剪后识别")).toBeNull();
    expect(within(disclosure).queryByText(/录音与台词未能核对一致/)).toBeNull();
  });

  it("shows an unsuccessful cropped transcript without implying that the crop was adopted", () => {
    const take = recognitionCandidate({ text: "回来啦？", checkStatus: "review", diagnosticCode: "cut_text_mismatch",
      recognition: { expectedText: "回来啦？", sourceTranscript: "回来啦？慢慢来。", targetTranscript: "回来了", stage: "target_validation" },
    });
    render(<VoiceGenerationPanel {...props({ candidates: [take] })} />);
    const disclosure = screen.getByText("识别对照").closest("details")!;
    fireEvent.click(screen.getByText("识别对照"));
    expect(within(disclosure).getByText("尝试裁剪后识别（未采用）").nextElementSibling?.textContent).toBe("回来了");
    expect(within(disclosure).getByText("尝试裁剪后的识别文字未通过核对。")).toBeTruthy();
    expect(within(disclosure).getByText("保留完整原音，未采用裁剪。")).toBeTruthy();
  });

  it("distinguishes a saved empty recognition result from legacy candidates without recognition", () => {
    const take = recognitionCandidate({ checkStatus: "review", transcript: "旧字段不等于完整窗口识别",
      recognition: { expectedText: "回来啦？", sourceTranscript: "", stage: "unavailable" },
    });
    const input = props({ candidates: [take] });
    const view = render(<VoiceGenerationPanel {...input} />);
    let disclosure = screen.getByText("识别对照").closest("details")!;
    fireEvent.click(screen.getByText("识别对照"));
    expect(within(disclosure).getByText("本次未取得识别文本")).toBeTruthy();
    expect(within(disclosure).queryByText("未保存识别文本")).toBeNull();
    const legacy = recognitionCandidate({ transcript: "旧字段不等于完整窗口识别" });
    view.rerender(<VoiceGenerationPanel {...input} candidates={[legacy]} />);
    disclosure = screen.getByText("识别对照").closest("details")!;
    expect(within(disclosure).getByText("未保存识别文本")).toBeTruthy();
    expect(within(disclosure).queryByText("完整原音识别")).toBeNull();
    expect(within(disclosure).queryByText("旧字段不等于完整窗口识别")).toBeNull();
    view.rerender(<VoiceGenerationPanel {...input} candidates={[candidate()]} />);
    expect(within(screen.getByText("识别对照").closest("details")!).getByText("未保存识别文本")).toBeTruthy();
  });

  it("checks the sliding context for long-text candidates without invalidating ordinary clip takes", () => {
    const voiceContext = { version: 1 as const, followingClauses: ["接下来坐这里。"], isFinal: false };
    const longTake = { ...longTextCandidate(), candidateId: "window_take",
      sourceFingerprint: getVoiceCandidateSourceFingerprint(selectedClip, voiceContext) };
    const input = props({ voiceContext, candidates: [longTake, candidate()] });
    const view = render(<VoiceGenerationPanel {...input} />);
    expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(false);
    view.rerender(<VoiceGenerationPanel {...input} voiceContext={{ ...voiceContext, followingClauses: ["换到旁边坐吧。"] }} />);
    expect((screen.getByRole("button", { name: "采用候选 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "采用候选 2" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("exposes failed historical originals for playback and download while generation remains busy", async () => {
    const audioUrl = "/api/voice-generation-recordings/legacy_11111111-2222-4333-8444-555555555555_1_3";
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ recordings: [{
      recordingId: "legacy_11111111-2222-4333-8444-555555555555_1_3", runId: "11111111-2222-4333-8444-555555555555",
      group: 1, take: 3, createdAt: "2026-09-20T08:27:03.201Z", expectedText: "回来啦？", inputText: "回来啦？补充文案。",
      duration: 22.72, audioUrl, status: "needs_review", warning: "台词核对有疑问，请试听。", historicalMatch: true,
    }], truncated: false }) });
    vi.stubGlobal("fetch", fetcher);
    const input = props({ projectId: "project", busy: true, error: "台词未能核对一致。",
      options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh", generationMode: "long_text" } });
    const view = render(<VoiceGenerationPanel {...input} />);
    const audio = await screen.findByLabelText("完整原音 1 试听");
    expect(audio.getAttribute("src")).toBe(audioUrl);
    expect(audio.hasAttribute("disabled")).toBe(false);
    const recordings = screen.getByRole("region", { name: "完整原始录音" }).querySelector("details")!;
    expect(recordings.open).toBe(true);
    expect(screen.getByRole("link", { name: "下载完整原音" }).getAttribute("href")).toBe(`${audioUrl}?download=1`);
    expect(screen.getByText("历史同文案")).toBeTruthy();
    expect(screen.getByText("台词未能核对一致。")).toBeTruthy();
    expect(String(fetcher.mock.calls[0][0])).toContain("projectId=project");
    fireEvent.click(screen.getByRole("button", { name: "刷新录音" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    view.rerender(<VoiceGenerationPanel {...input} busy={false} />);
    expect(recordings.open).toBe(true);
  });

  it.each(["needs_review", "checked"] as const)("shows saved recognition for a %s original without a candidate and keeps full-original playback", async (status) => {
    const audioUrl = "/api/voice-generation-recordings/current_11111111-2222-4333-8444-555555555555_1_1";
    const expectedText = "回来啦？";
    const sourceTranscript = "回来啦？先坐一会儿。";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ recordings: [{
      recordingId: "current_11111111-2222-4333-8444-555555555555_1_1", runId: "11111111-2222-4333-8444-555555555555",
      group: 1, take: 1, createdAt: "2026-09-21T08:00:00.000Z", expectedText, inputText: sourceTranscript,
      duration: 22.72, audioUrl, status, warning: "完整原音仍可试听。", historicalMatch: false,
      recognition: { stage: status === "checked" ? "complete" : "source_alignment", expectedText, sourceTranscript,
        ...(status === "checked" ? { targetTranscript: expectedText } : {}),
      },
    }], truncated: false }) }));
    render(<VoiceGenerationPanel {...props({ projectId: "project", candidates: [], error: status === "needs_review" ? "已取消生成。" : undefined,
      options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh", generationMode: "long_text" },
    })} />);
    const audio = await screen.findByLabelText("完整原音 1 试听");
    fireEvent.click(screen.getByText("完整原始录音 · 1 条可试听"));
    const original = screen.getByRole("article", { name: "完整原音 1" });
    const disclosure = within(original).getByText("识别对照").closest("details")!;
    expect(disclosure.open).toBe(false);
    fireEvent.click(within(original).getByText("识别对照"));
    expect(disclosure.open).toBe(true);
    expect(within(disclosure).getByText("完整原音识别").nextElementSibling?.textContent).toBe(sourceTranscript);
    expect(within(disclosure).getByText("目标台词").nextElementSibling?.textContent).toBe(expectedText);
    expect(within(disclosure).getByText("本条试听与下载均为完整原音。")).toBeTruthy();
    expect(within(disclosure).queryByText(/已提取目标片段/)).toBeNull();
    expect(audio.getAttribute("src")).toBe(audioUrl);
    expect(within(original).getByRole("link", { name: "下载完整原音" }).getAttribute("href")).toBe(`${audioUrl}?download=1`);
    expect(screen.queryByRole("button", { name: /采用候选/ })).toBeNull();
  });

  it("shows accepted recognition differences on the original while playback and download still use the complete source", async () => {
    const audioUrl = "/api/voice-generation-recordings/current_11111111-2222-4333-8444-555555555555_1_1";
    const recognition = recognitionWithDifference();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ recordings: [{
      recordingId: "current_11111111-2222-4333-8444-555555555555_1_1", runId: "11111111-2222-4333-8444-555555555555",
      group: 1, take: 1, createdAt: "2026-09-23T08:00:00.000Z", expectedText: recognition.expectedText, inputText: recognition.sourceTranscript,
      duration: 23.36, audioUrl, status: "checked", warning: "检查已完成。这里保留模型输出的全部声音。", historicalMatch: false, recognition,
    }], truncated: false }) }));
    render(<VoiceGenerationPanel {...props({ projectId: "project", candidates: [],
      options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh", generationMode: "long_text" },
    })} />);
    const audio = await screen.findByLabelText("完整原音 1 试听");
    fireEvent.click(screen.getByText("完整原始录音 · 1 条可试听"));
    const original = screen.getByRole("article", { name: "完整原音 1" });
    const disclosure = within(original).getByText("识别对照").closest("details")!;
    expect(disclosure.open).toBe(false);
    fireEvent.click(within(original).getByText("识别对照"));
    expect(within(disclosure).getByText("本条试听与下载均为完整原音。")).toBeTruthy();
    expect(within(disclosure).getByText("识别文字与源文有差异。")).toBeTruthy();
    expect(within(disclosure).getByText("文字相似度 90% · 阈值 90%")).toBeTruthy();
    expect(within(disclosure).getByText("第 3 字：啦 → 了")).toBeTruthy();
    expect(within(disclosure).queryByText(/已截取目标片段|未采用裁剪|念错|读错/)).toBeNull();
    expect(audio.getAttribute("src")).toBe(audioUrl);
    expect(within(original).getByRole("link", { name: "下载完整原音" }).getAttribute("href")).toBe(`${audioUrl}?download=1`);
  });

  it("polls originals during generation and stops polling after completion", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ recordings: [], truncated: false }) });
    vi.stubGlobal("fetch", fetcher);
    const input = props({ projectId: "project", busy: true, options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh" } });
    const view = render(<VoiceGenerationPanel {...input} />);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    view.rerender(<VoiceGenerationPanel {...input} busy={false} />);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("loads older originals and preserves them when the latest page refreshes", async () => {
    const recording = (take: number) => ({
      recordingId: `current_11111111-2222-4333-8444-555555555555_1_${take}`, runId: "11111111-2222-4333-8444-555555555555",
      group: 1, take, createdAt: "2026-09-20T08:27:03.201Z", expectedText: "回来啦？", inputText: "回来啦？",
      duration: 1, audioUrl: `/api/voice-generation-recordings/current_11111111-2222-4333-8444-555555555555_1_${take}`,
      status: "not_checked", warning: "当前片段原音（未做分组检查）。", historicalMatch: false,
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ recordings: [recording(2)], truncated: true, nextCursor: "olderCursor" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ recordings: [recording(1)], truncated: false, nextCursor: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ recordings: [recording(3), recording(2)], truncated: true, nextCursor: "refreshedCursor" }) });
    vi.stubGlobal("fetch", fetcher);
    render(<VoiceGenerationPanel {...props({ projectId: "project", options: { ...options, provider: "voxcpm2", voicePackId: "soft_zh" } })} />);
    await screen.findByLabelText("完整原音 1 试听");
    const disclosure = screen.getByRole("region", { name: "完整原始录音" }).querySelector("details")!;
    expect(disclosure.open).toBe(false);
    fireEvent.click(within(disclosure).getByText("完整原始录音 · 1 条可试听"));
    expect(disclosure.open).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "加载更多录音" }));
    await screen.findByLabelText("完整原音 2 试听");
    expect(String(fetcher.mock.calls[1][0])).toContain("cursor=olderCursor");
    fireEvent.click(screen.getByRole("button", { name: "刷新录音" }));
    await screen.findByLabelText("完整原音 3 试听");
    expect(screen.getByLabelText("完整原音 3 试听").getAttribute("src")).toContain("_1_1");
    expect(screen.queryByRole("button", { name: "加载更多录音" })).toBeNull();
  });

  it("labels review groups as complete originals awaiting listening confirmation", () => {
    const take = longTextCandidate();
    take.provenance.longText.groups[0].checkStatus = "review";
    render(<VoiceGenerationPanel {...props({ candidates: [take] })} />);
    expect(screen.getByText("完整原音 · 待试听确认")).toBeTruthy();
    expect(screen.getByLabelText("候选 1 第 1 组试听")).toBeTruthy();
  });

  it("waits for user playback before announcing spatial preparation, then clears it when ready", () => {
    render(<VoiceGenerationPanel {...props({ binaural: true, candidates: [candidate()] })} />);
    const audio = screen.getByLabelText("候选 1 试听") as HTMLAudioElement;
    expect(audio.getAttribute("src")).toMatch(/^\/api\/assets\/spatial\//);
    expect(audio.preload).toBe("none");
    expect(audio.autoplay).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.play(audio);
    expect(screen.getByRole("status").textContent).toBe("正在准备空间试听…");
    fireEvent.canPlay(audio);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.waiting(audio);
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.playing(audio);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.waiting(audio);
    fireEvent.pause(audio);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a spatial failure with retry and keeps other previews paused during the retry", async () => {
    render(<VoiceGenerationPanel {...props({ binaural: true, candidates: [candidate()],
      selectedClip: { ...selectedClip, asset: { asset_id: "original", uri: "asset://clip/original", duration: 5 } },
    })} />);
    const audio = screen.getByLabelText("候选 1 试听") as HTMLAudioElement;
    const current = screen.getByLabelText("当前人声试听") as HTMLAudioElement;
    const pauseCurrent = mockMediaCall(current, "pause");
    const load = mockMediaCall(audio, "load");
    const play = vi.spyOn(audio, "play").mockRejectedValueOnce(new Error("network failure"));
    fireEvent.error(audio);
    expect(screen.getByRole("alert").textContent).toContain("关闭双耳空间后试听原声");
    fireEvent.click(screen.getByRole("button", { name: "重试候选 1 试听" }));
    expect(load).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    expect(pauseCurrent).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "重试候选 1 试听" }));
    fireEvent.canPlay(audio);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("resets state and ignores late errors from the previous spatial source", () => {
    const input = props({ binaural: true, candidates: [candidate()] });
    const view = render(<VoiceGenerationPanel {...input} />);
    const oldAudio = screen.getByLabelText("候选 1 试听") as HTMLAudioElement;
    fireEvent.error(oldAudio);
    view.rerender(<VoiceGenerationPanel {...input} selectedClip={{ ...selectedClip,
      position: { ...selectedClip.position, movement: "orbit" },
    }} />);
    const newAudio = screen.getByLabelText("候选 1 试听") as HTMLAudioElement;
    expect(newAudio).not.toBe(oldAudio);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.play(newAudio);
    fireEvent.canPlay(newAudio);
    fireEvent.error(oldAudio);
    fireEvent.waiting(oldAudio);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(oldAudio.getAttribute("src")).toBeNull();
  });

  it("clears spatial errors when disabling the effect and leaves group previews as original audio", () => {
    const input = props({ binaural: true, candidates: [longTextCandidate()] });
    const view = render(<VoiceGenerationPanel {...input} />);
    expect(screen.getByLabelText("候选 1 第 2 组试听").getAttribute("src")).toBe("/api/assets/clip/group_1");
    fireEvent.error(screen.getByLabelText("候选 1 试听"));
    view.rerender(<VoiceGenerationPanel {...input} binaural={false} />);
    const original = screen.getByLabelText("候选 1 试听");
    expect(original.getAttribute("src")).toBe("/api/assets/clip/voice_fixture_1");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.waiting(original);
    expect(screen.getByRole("status").textContent).toBe("正在准备试听…");
  });

  it("keeps the source valid in StrictMode and releases media when unmounted", () => {
    const view = render(<StrictMode><VoiceGenerationPanel {...props({ binaural: true, candidates: [candidate()] })} /></StrictMode>);
    const audio = screen.getByLabelText("候选 1 试听") as HTMLAudioElement;
    expect(audio.getAttribute("src")).toMatch(/^\/api\/assets\/spatial\//);
    const pause = mockMediaCall(audio, "pause");
    const load = mockMediaCall(audio, "load");
    view.unmount();
    expect(pause).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
    expect(audio.getAttribute("src")).toBeNull();
    fireEvent.error(audio);
    expect(screen.queryByRole("alert")).toBeNull();
  });

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
    expect((screen.getByRole("option", { name: "长文连续生成" }) as HTMLOptionElement).disabled).toBe(true);
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
    expect(within(details).getByText("长文连续生成")).toBeTruthy();
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
    const pauses = [...screen.getByRole("region", { name: "人声生成设置" }).querySelectorAll("audio")].map((audio) => mockMediaCall(audio, "pause"));
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
    expect(screen.getByText("文案或后续上下文已修改，请重新生成。" )).toBeTruthy();
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

  it("prioritizes generation and candidates while leaving technical settings collapsed", () => {
    render(<VoiceGenerationPanel {...props({
      generationControl: <button>生成新候选</button>,
      selectedClip: { ...selectedClip, asset: { asset_id: "original", uri: "asset://clip/original", duration: 5 } },
      candidates: [candidate()],
    })} />);
    const action = screen.getByRole("button", { name: "生成新候选" });
    expect(control("参考声音").compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(action.compareDocumentPosition(screen.getByLabelText("当前人声试听")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(action.compareDocumentPosition(screen.getByLabelText("候选 1 试听")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const settings = screen.getByText("更多生成设置").closest("details")!;
    expect(settings.open).toBe(false);
    expect(screen.getByLabelText("候选 1 试听").compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(settings.contains(control("人声引擎"))).toBe(true);
    expect(settings.contains(control("参考模式"))).toBe(true);
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
    const pauseOriginal = mockMediaCall(original, "pause");
    const pauseFirst = mockMediaCall(firstAudio, "pause");
    const pauseSecond = mockMediaCall(secondAudio, "pause");

    fireEvent.play(firstAudio);
    expect(pauseOriginal).toHaveBeenCalledOnce();
    expect(pauseSecond).toHaveBeenCalledOnce();
    expect(pauseFirst).not.toHaveBeenCalled();
    fireEvent.play(original);
    expect(pauseFirst).toHaveBeenCalledOnce();
    expect(pauseSecond).toHaveBeenCalledTimes(2);
  });
});
