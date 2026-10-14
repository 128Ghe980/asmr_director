// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { VoiceRecognition } from "@/lib/asmr/voice-recognition";
import type { VoiceLongTextResult } from "@/lib/asmr/voice-longtext-result";
import type { VoiceParagraphResult } from "@/lib/asmr/voice-paragraph-result";
import { VoiceParagraphRecognitionComparison, VoiceRecognitionComparison, VoiceRecordingRecognitionComparison } from "./voice-recognition-comparison";

afterEach(cleanup);

const recognition: VoiceRecognition = {
  stage: "complete", expectedText: "来~~，面来啦！慢点儿吃，小心烫。汤也喝一点，暖胃。",
  sourceTranscript: "来，面来了，慢点吃，小心烫，汤也喝一点，暖胃，今天外面风大。",
  targetTranscript: "来，面来了，慢点吃，小心烫，汤也喝一点，暖胃。",
  contentComparison: { mode: "bounded_edits", status: "different", threshold: .85, similarity: 1 - 2 / 18,
    editCount: 2, substitutionCount: 1, deletionCount: 1, insertionCount: 0,
    expected: "来面来啦慢点儿吃小心烫汤也喝一点暖胃", recognized: "来面来了慢点吃小心烫汤也喝一点暖胃" },
  boundaryMatch: { method: "ending_anchor", terminalWordIndex: 12, anchorText: "暖胃", recognizedPrefix: "来面来了慢点吃小心烫汤也喝一点暖胃" },
};

function group(evidence: VoiceRecognition): VoiceLongTextResult["groups"][number] {
  return { index: 0, text: evidence.expectedText, inputText: evidence.expectedText, paddingClauses: [], isFinal: false,
    pauseAfter: "medium", seed: 1, parameters: {}, asset: { assetId: "test", uri: "asset://clip/test", duration: 5 },
    internalPausesMs: [], internalPauseClasses: [], leadingQuietMs: 0, trailingQuietMs: 80,
    transcript: evidence.targetTranscript ?? "", coverage: .888889, cutStartSeconds: 0, cutEndSeconds: 5,
    attempts: 1, checkStatus: "passed", recognition: evidence };
}

describe("ending match recognition inspection", () => {
  it("keeps following-boundary homophone evidence folded and displays the original right text and pinyin", () => {
    const evidence: VoiceRecognition = { ...recognition, followingText: "过来坐，炉子边暖和。",
      followingPhoneticBoundary: { expected: "过来坐炉子边暖和", recognized: "过来做炉子边暖和", sourceWordIndex: 13,
        difference: { index: 2, expected: "坐", recognized: "做", expectedPinyin: "zuo4", recognizedPinyin: "zuo4", rule: "same_tone" },
        right: { transcript: "过来做炉子边暖和", words: [{ text: "过来做炉子边暖和", start: .1, end: 1.8 }], durationSeconds: 2 } } };
    render(<VoiceRecognitionComparison groups={[group(evidence)]} />);
    const boundary = screen.getByText("后文边界 · 同音字差").closest("details")!;
    expect(boundary.open).toBe(false);
    expect(screen.getByText("后文定位文字").nextElementSibling?.textContent).toBe("过来坐炉子边暖和");
    expect(screen.getByText("切点右侧识别").nextElementSibling?.textContent).toBe("过来做炉子边暖和");
    expect(screen.getByText(/第 3 字：坐 → 做（zuo4 → zuo4 · 同音同调）/)).toBeTruthy();
    expect(screen.getByText("用于核对后文衔接位置，实际识别字差保留。")).toBeTruthy();
  });

  it("distinguishes safe cuts awaiting human text review from automatic and manually confirmed text", () => {
    const textReview = { status: "needs_confirmation" as const, reason: "missing_final_particle" as const, expected: "回来啦", sourcePrefix: "回来了",
      expectedPinyin: "la5" as const, sourcePinyin: "le5" as const, similarity: 2 / 3,
      final: { transcript: "回来", words: [{ text: "回来", start: .1, end: 1 }], durationSeconds: 2 } };
    const paragraph: VoiceParagraphResult = { version: 1, groupId: "group", text: "回来啦。", clipIds: ["a"], checkStatus: "needs_confirmation",
      sourceAsset: { assetId: "source", uri: "asset://clip/source", duration: 2 }, segments: [{ clipId: "a", text: "回来啦。", cutStartSeconds: 0, cutEndSeconds: 2,
        asset: { assetId: "slice", uri: "asset://clip/slice", duration: 2 }, textReview,
        recognition: { stage: "complete", expectedText: "回来啦。", sourceTranscript: "回来了", targetTranscript: "回来", sourceWords: [{ text: "回来了", start: .1, end: 1 }], shortSentenceReview: textReview } }] };
    const view = render(<VoiceParagraphRecognitionComparison expectedText={paragraph.text} paragraph={paragraph} />);
    expect(screen.getByText("各短句切点已确认；部分台词需要试听确认。")).toBeTruthy();
    expect(screen.getByText("短句识别（待试听确认）").nextElementSibling?.textContent).toBe("回来");
    expect(screen.getByText("检查阶段：切点检查完成 · 文字需试听确认")).toBeTruthy();
    expect(screen.queryByText(/整段已通过/)).toBeNull();
    view.rerender(<VoiceParagraphRecognitionComparison expectedText={paragraph.text} paragraph={{ ...paragraph,
      manualTextConfirmation: { sourceCandidateId: "candidate", confirmedClipIds: ["a"], confirmedAt: "2026-10-14T13:00:00.000Z" } }} />);
    expect(screen.getByText("台词已试听确认；原识别字差保留。")).toBeTruthy();
    expect(screen.getByText("短句识别（已试听确认）").nextElementSibling?.textContent).toBe("回来");
    expect(screen.queryByText(/整段已通过/)).toBeNull();
  });

  it("reports a short final-particle exception without inventing a phonetic score", () => {
    const evidence: VoiceRecognition = { stage: "complete", expectedText: "回来啦。", sourceTranscript: "回来了先坐。", targetTranscript: "回来了",
      followingText: "先坐。", contentComparison: { mode: "sentence_particle", status: "different", similarity: 2 / 3, threshold: .9,
        substitutionCount: 1, expected: "回来啦", recognized: "回来了", sourcePrefix: "回来了", acceptanceRule: "exact_prefix_final_particle",
        differences: [{ index: 2, expected: "啦", recognized: "了", expectedPinyin: "la5", recognizedPinyin: "le5", rule: "sentence_particle", clauseEnd: true }] } };
    render(<VoiceRecognitionComparison groups={[group(evidence)]} />);
    expect(screen.getByText("已截取目标片段；句尾语气词容错通过，请试听。")).toBeTruthy();
    expect(screen.getByText("文字相似度 66.7% · 阈值 90%")).toBeTruthy();
    expect(screen.getByText("句尾语气词容错通过；其余字与源文逐字一致。")).toBeTruthy();
    expect(screen.getByText("第 3 字：啦 → 了")).toBeTruthy();
    expect(screen.getByText(/la5 → le5 · 句末语气词差异/)).toBeTruthy();
    expect(screen.queryByText(/拼音容错得分|95%/)).toBeNull();
  });
  it("keeps failed remaining-audio recognition bound to its own short sentence", () => {
    render(<VoiceParagraphRecognitionComparison expectedText="回来啦。先坐。" originalRecording paragraph={{ checkStatus: "review", clipIds: ["a", "b"], segments: [],
      failedClipId: "b", diagnosticCode: "cut_text_mismatch", failureRecognition: { stage: "target_validation", expectedText: "先坐。", sourceTranscript: "先坐喝茶", targetTranscript: "先坐喝茶" } }} />);
    expect(screen.getByText("短句 2 · 检查未通过")).toBeTruthy();
    expect(screen.getByText("整段台词").nextElementSibling?.textContent).toBe("回来啦。先坐。");
    expect(screen.getByText("目标台词").nextElementSibling?.textContent).toBe("先坐。");
    expect(screen.getByText("剩余原音识别").nextElementSibling?.textContent).toBe("先坐喝茶");
    expect(screen.getByText("尝试裁剪后识别（未采用）").nextElementSibling?.textContent).toBe("先坐喝茶");
    expect(screen.queryByText("整段原音识别")).toBeNull();
    expect(screen.queryByText("未保存识别文本")).toBeNull();
  });
  it("explains a verified leading hmm cut only from saved independent recognition evidence", () => {
    const expectedText = "今天是不是又加班了？眼睛都红红的。";
    const normalized = "今天是不是又加班了眼睛都红红的";
    const evidence: VoiceRecognition = { stage: "complete", expectedText, sourceTranscript: `${normalized}嗯面快好了`, targetTranscript: normalized,
      followingText: "面快好了，", contentComparison: { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0, expected: normalized, recognized: normalized },
      sourceWords: [{ text: normalized, start: .1, end: 3.8 }, { text: "嗯", start: 4, end: 4.2 }, { text: "面快好了", start: 4.3, end: 5 }],
      continuationBridge: { kind: "leading_hmm", text: "嗯", sourceWordIndex: 1, sourceStartSeconds: 4, sourceEndSeconds: 4.2, rightTranscript: "嗯面快好了" } };
    const take = group(evidence);
    const view = render(<VoiceRecognitionComparison groups={[take]} />);
    expect(screen.getByText("已在“嗯”之前截取；后续台词已独立核对。")).toBeTruthy();
    expect(screen.getByText("截取位置后的独立识别").nextElementSibling?.textContent).toBe("嗯面快好了");
    expect(screen.getByText("完整原音识别").nextElementSibling?.textContent).toBe(evidence.sourceTranscript);
    for (const altered of [ { ...take, checkStatus: "review" as const }, { ...take, checkStatus: undefined },
      { ...take, recognition: { ...evidence, stage: "continuation_alignment" as const } },
      { ...take, recognition: { ...evidence, continuationBridge: undefined } },
      { ...take, recognition: { ...evidence, contentComparison: undefined } } ]) {
      view.rerender(<VoiceRecognitionComparison groups={[altered]} />);
      expect(screen.queryByText("已在“嗯”之前截取；后续台词已独立核对。")).toBeNull();
      expect(screen.queryByText("截取位置后的独立识别")).toBeNull();
    }
  });

  it("labels recognition on a reviewed original as an unadopted trial", () => {
    render(<VoiceRecordingRecognitionComparison expectedText="回来啦？" review recognition={{ stage: "complete", expectedText: "回来啦？",
      sourceTranscript: "回来啦嗯慢慢来", targetTranscript: "回来啦嗯" }} />);
    expect(screen.getByText("尝试裁剪后识别（未采用）").nextElementSibling?.textContent).toBe("回来啦嗯");
    expect(screen.getByText("本条试听与下载均为完整原音。")).toBeTruthy();
    expect(screen.queryByText("裁剪后识别")).toBeNull();
  });

  it("explains punctuation-free originals and following context without claiming a verified crop", () => {
    const expectedText = "今天是不是又加班了？眼睛都红红的。";
    const evidence: VoiceRecognition = { stage: "continuation_alignment", expectedText, followingText: "面快好了，",
      sourceTranscript: "今天是不是又加班了眼睛都红红的嗯面快好了",
      alignment: { expected: "面快好了", recognizedPrefix: "嗯面快好了", reason: "unrecognized_continuation" } };
    render(<VoiceRecognitionComparison groups={[{ ...group(evidence), checkStatus: "review" }]} />);
    expect(screen.getByText("完整原音识别").nextElementSibling?.textContent).toBe(evidence.sourceTranscript);
    expect(screen.getByText("后续台词（定位用）").nextElementSibling?.textContent).toBe("面快好了，");
    expect(screen.getByText("完整原音可能包含后续台词或生成语境；识别文字可能省略标点。")).toBeTruthy();
    expect(screen.getByText("后续台词衔接未能定位，暂未采用裁剪。")).toBeTruthy();
    expect(screen.getByText("保留完整原音，未采用裁剪。")).toBeTruthy();
    expect(screen.queryByText(/识别文字与源文一致|目标台词存在差异|已提取目标片段/)).toBeNull();
  });

  it("labels failed cropped recognition as an unadopted attempt even if old evidence says complete", () => {
    const evidence: VoiceRecognition = { stage: "complete", expectedText: "回来啦？", sourceTranscript: "回来啦嗯慢慢来",
      targetTranscript: "回来啦嗯", followingText: "慢慢来。" };
    render(<VoiceRecognitionComparison groups={[{ ...group(evidence), checkStatus: "review", diagnosticCode: "cut_text_mismatch" }]} />);
    expect(screen.getByText("尝试裁剪后识别（未采用）").nextElementSibling?.textContent).toBe("回来啦嗯");
    expect(screen.queryByText("裁剪后识别")).toBeNull();
    expect(screen.getByText("尝试裁剪后的识别文字未通过核对。")).toBeTruthy();
  });

  it("shows the ending anchor and isolated missing/substituted characters in a folded crop inspection", () => {
    render(<VoiceRecognitionComparison groups={[group(recognition)]} />);
    expect(screen.getByText("识别对照").closest("details")?.open).toBe(false);
    expect(screen.getByText("已截取目标片段；识别文字与源文有差异。")).toBeTruthy();
    expect(screen.getByText("末尾词定位：「暖胃」")).toBeTruthy();
    expect(screen.getByText("文字相似度 88.9% · 阈值 85%")).toBeTruthy();
    expect(screen.getByText("第 4 字：啦 → 了")).toBeTruthy();
    expect(screen.getByText("第 7 字：儿 → （未识别）")).toBeTruthy();
    expect(screen.queryByText(/第 8 字：/)).toBeNull();
  });

  it("labels an API end selection and still distinguishes the complete recording from its successful crop", () => {
    render(<VoiceRecordingRecognitionComparison expectedText={recognition.expectedText}
      recognition={{ ...recognition, boundaryMatch: { ...recognition.boundaryMatch!, method: "api" } }} />);
    expect(screen.getByText("API 辅助定位末尾词：「暖胃」")).toBeTruthy();
    expect(screen.getByText("本条试听与下载均为完整原音。")).toBeTruthy();
    expect(screen.queryByText(/已截取目标片段/)).toBeNull();
  });

  it("renders an extra recognized character at its insertion position", () => {
    render(<VoiceRecordingRecognitionComparison expectedText="abcdefghij" recognition={{ stage: "complete", sourceTranscript: "abc甲defghij",
      expectedText: "abcdefghij", contentComparison: { mode: "bounded_edits", status: "different", threshold: .85, similarity: 10 / 11,
        expected: "abcdefghij", recognized: "abc甲defghij", editCount: 1, insertionCount: 1, substitutionCount: 0, deletionCount: 0 } }} />);
    expect(screen.getByText("第 3 字后多识别：（源文无此字） → 甲")).toBeTruthy();
    expect(screen.queryByText(/第 4 字：/)).toBeNull();
  });

  it("explains ambiguous ending words without claiming a successful cut", () => {
    const evidence: VoiceRecognition = { stage: "source_alignment", expectedText: "暖胃。", sourceTranscript: "暖胃，暖胃。",
      alignment: { expected: "暖胃", recognizedPrefix: "暖胃暖胃", reason: "ambiguous_ending_anchor" }, apiFallback: { status: "declined" } };
    render(<VoiceRecognitionComparison groups={[{ ...group(evidence), checkStatus: "review" }]} />);
    expect(screen.getByText("保留完整原音，未采用裁剪。")).toBeTruthy();
    expect(screen.getByText("末尾词出现多次，暂未确认应采用的结束位置。")).toBeTruthy();
    expect(screen.getByText("API 未能确认结束位置。")).toBeTruthy();
  });

  it("keeps the legacy substitution threshold and label", () => {
    render(<VoiceRecordingRecognitionComparison expectedText="回来啦？外面是不是很冷？" recognition={{ stage: "complete", sourceTranscript: "回来了外面是不是很冷",
      expectedText: "回来啦？外面是不是很冷？", contentComparison: { status: "different", similarity: .9, threshold: .9, substitutionCount: 1,
        expected: "回来啦外面是不是很冷", recognized: "回来了外面是不是很冷" } }} />);
    expect(screen.getByText("文字相似度 90% · 阈值 90%")).toBeTruthy();
    expect(screen.getByText("第 3 字：啦 → 了")).toBeTruthy();
  });

  it("separates pronunciation tolerance from the unchanged literal score and keeps adoption manual", () => {
    const evidence: VoiceRecognition = { stage: "complete", expectedText: "来~~，面来啦！汤也喝一点，暖胃。",
      sourceTranscript: "来,面来了,汤也喝一点,暖胃。今天是不是又加班了?", targetTranscript: "来,面来了,糖也喝一点,暖胃",
      followingText: "今天是不是又加班了？",
      sourceWords: [{ text: "来,面来了,汤也喝一点,暖胃。", start: .1, end: 4.56 }, { text: "今天是不是又加班了?", start: 5.14, end: 6.94 }],
      contentComparison: { mode: "phonetic_substitutions", status: "different", similarity: .818182, threshold: .9,
        phoneticSimilarity: .954545, phoneticThreshold: .95, substitutionCount: 2,
        expected: "来面来啦汤也喝一点暖胃", recognized: "来面来了糖也喝一点暖胃", sourcePrefix: "来面来了汤也喝一点暖胃",
        differences: [{ index: 3, expected: "啦", recognized: "了", expectedPinyin: "la5", recognizedPinyin: "le5", rule: "sentence_particle", clauseEnd: true },
          { index: 4, expected: "汤", recognized: "糖", expectedPinyin: "tang1", recognizedPinyin: "tang2", rule: "source_supported_tone", sourceCharacter: "汤" }] } };
    render(<VoiceRecognitionComparison groups={[{ ...group(evidence), coverage: .818182 }]} />);
    expect(screen.getByText("已截取目标片段；拼音容错通过，请试听。")).toBeTruthy();
    expect(screen.getByText("文字相似度 81.8% · 阈值 90%")).toBeTruthy();
    expect(screen.getByText("拼音容错得分 95.5% · 阈值 95%")).toBeTruthy();
    expect(screen.getByText("第 4 字：啦 → 了")).toBeTruthy();
    expect(screen.getByText("第 5 字：汤 → 糖")).toBeTruthy();
    expect(screen.getByText(/la5 → le5 · 句末语气词差异/)).toBeTruthy();
    expect(screen.getByText(/tang1 → tang2 · 声调差异（完整原音识别为“汤”）/)).toBeTruthy();
    expect(screen.queryByText("识别文字与源文一致。")).toBeNull();
  });
});
