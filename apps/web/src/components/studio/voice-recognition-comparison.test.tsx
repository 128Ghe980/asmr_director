// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { VoiceRecognition } from "@/lib/asmr/voice-recognition";
import type { VoiceLongTextResult } from "@/lib/asmr/voice-longtext-result";
import { VoiceRecognitionComparison, VoiceRecordingRecognitionComparison } from "./voice-recognition-comparison";

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
});
