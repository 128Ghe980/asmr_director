import { describe, expect, it } from "vitest";
import { getVoiceCandidateRequestFingerprint, getVoiceCandidateSourceFingerprint } from "./audio-candidate";
import { getClipGenerationFingerprint, isCurrentClipGenerationFingerprint } from "./generation-fingerprint";
import { demoProject } from "./mock-project";
import { getVoiceGenerationContext } from "./voice-generation-context";
import { buildLongTextInputs, continuationClause, createSemanticVoiceLongTextPlan, splitVoiceClauses } from "./voice-longtext-plan";

function fixture() {
  const project = structuredClone(demoProject);
  const voices = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
  voices.forEach((voice, index) => { voice.semantic_unit = true; voice.text = ["已经说过的开头。", "请坐近一点。", "先放松肩膀。慢慢呼吸。", "今晚好好休息。"][index]; });
  return { project, voices };
}

describe("semantic voice forward context", () => {
  it("uses only chronologically following voice text, even when the stored array is out of order", () => {
    const { project, voices } = fixture();
    voices.reverse();
    const context = getVoiceGenerationContext(project, "voice_002")!;
    expect(context).toEqual({ version: 1, followingClauses: ["先放松肩膀。", "慢慢呼吸。", "今晚好好休息。"], isFinal: false });
    const target = voices.find((clip) => clip.id === "voice_002")!;
    const input = buildLongTextInputs(createSemanticVoiceLongTextPlan(target.text, context), context);
    expect(input).toHaveLength(1);
    expect(input[0].expectedText).toBe(target.text);
    expect(input[0].followingText).toBe("先放松肩膀。");
    expect(input[0].text).toContain("请坐近一点……先放松肩膀……慢慢呼吸……今晚好好休息……");
    expect(input[0].text).not.toContain("已经说过");
    expect(input[0].isFinal).toBe(false);
    expect(input[0].paddingClauses.length).toBeGreaterThan(0);
  });

  it("gives only the true last voice a natural ending and preserves unmarked legacy behavior", () => {
    const { project, voices } = fixture();
    const last = voices[3];
    const context = getVoiceGenerationContext(project, last.id)!;
    const input = buildLongTextInputs(createSemanticVoiceLongTextPlan(last.text, context), context)[0];
    expect(context).toEqual({ version: 1, followingClauses: [], isFinal: true });
    expect(input.text).toBe(last.text);
    expect(input.isFinal).toBe(true);
    expect(input.paddingClauses).toEqual([]);
    delete voices[1].semantic_unit;
    expect(getVoiceGenerationContext(project, voices[1].id)).toBeUndefined();
    expect(getVoiceGenerationContext(project, "missing")).toBeUndefined();
  });

  it("bounds the actual window to 500 characters without skipping over a long intervening clip", () => {
    const { project, voices } = fixture();
    voices[2].text = "紧接后文".repeat(160);
    const context = getVoiceGenerationContext(project, voices[1].id)!;
    const input = buildLongTextInputs(createSemanticVoiceLongTextPlan(voices[1].text, context), context)[0];
    expect(input.text.length).toBeLessThanOrEqual(500);
    expect(context.followingClauses).toHaveLength(1);
    expect(input.text).not.toContain(voices[3].text);
    const before = getVoiceCandidateSourceFingerprint(voices[1], context);
    voices[3].text = "窗口之外的新台词。";
    expect(getVoiceCandidateSourceFingerprint(voices[1], getVoiceGenerationContext(project, voices[1].id))).toBe(before);
  });

  it("limits a 69-clause script to 16 actual clauses and ignores edits beyond that window", () => {
    const { project, voices } = fixture();
    const target = voices[1];
    target.text = "回来啦？外面是不是很冷？";
    const following = Array.from({ length: 67 }, (_, index) => `后文${index}。`);
    voices[2].text = following.slice(0, 7).join("");
    voices[3].text = following.slice(7).join("");
    const original = structuredClone(project);
    const context = getVoiceGenerationContext(project, target.id)!;
    const input = buildLongTextInputs(createSemanticVoiceLongTextPlan(target.text, context), context)[0];
    expect(context.followingClauses).toEqual(following.slice(0, 14));
    expect(input.text).toBe([...splitVoiceClauses(target.text), ...following.slice(0, 14)].map(continuationClause).join(""));
    expect(splitVoiceClauses(input.text)).toHaveLength(16);
    expect(input).toMatchObject({ expectedText: target.text, followingText: following[0], isFinal: false, paddingClauses: [] });
    expect(project).toEqual(original);

    const source = getVoiceCandidateSourceFingerprint(target, context);
    const options = { provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "long_text" } as const;
    const request = getVoiceCandidateRequestFingerprint(target, options, undefined, context);
    const job = getClipGenerationFingerprint(target, { ignoreVoiceStart: true, voiceContext: context });
    following[14] = "窗口之外的改动。";
    voices[3].text = following.slice(7).join("");
    const unchanged = getVoiceGenerationContext(project, target.id)!;
    expect(unchanged).toEqual(context);
    expect(getVoiceCandidateSourceFingerprint(target, unchanged)).toBe(source);
    expect(getVoiceCandidateRequestFingerprint(target, options, undefined, unchanged)).toBe(request);
    expect(isCurrentClipGenerationFingerprint(project, target.id, job, { ignoreVoiceStart: true, voiceContext: unchanged })).toBe(true);

    following[13] = "窗口以内的改动。";
    voices[3].text = following.slice(7).join("");
    const changed = getVoiceGenerationContext(project, target.id)!;
    expect(getVoiceCandidateSourceFingerprint(target, changed)).not.toBe(source);
    expect(getVoiceCandidateRequestFingerprint(target, options, undefined, changed)).not.toBe(request);
    expect(isCurrentClipGenerationFingerprint(project, target.id, job, { ignoreVoiceStart: true, voiceContext: changed })).toBe(false);
  });

  it("makes content fingerprints sensitive to context edits and reorder but independent of uniform timing shifts", () => {
    const { project, voices } = fixture();
    const clip = voices[1];
    const context = getVoiceGenerationContext(project, clip.id)!;
    const source = getVoiceCandidateSourceFingerprint(clip, context);
    const job = getClipGenerationFingerprint(clip, { ignoreVoiceStart: true, voiceContext: context });
    voices.forEach((voice) => { voice.start += 1; });
    expect(getVoiceCandidateSourceFingerprint(clip, getVoiceGenerationContext(project, clip.id))).toBe(source);
    expect(isCurrentClipGenerationFingerprint(project, clip.id, job, { ignoreVoiceStart: true, voiceContext: getVoiceGenerationContext(project, clip.id) })).toBe(true);
    voices[2].text = "换一段后续的话。";
    expect(getVoiceCandidateSourceFingerprint(clip, getVoiceGenerationContext(project, clip.id))).not.toBe(source);
    expect(isCurrentClipGenerationFingerprint(project, clip.id, job, { ignoreVoiceStart: true, voiceContext: getVoiceGenerationContext(project, clip.id) })).toBe(false);
    voices[2].start = 0;
    expect(getVoiceGenerationContext(project, clip.id)!.followingClauses).toEqual([voices[3].text]);
  });

  it("keeps direct clip requests context independent while long-text requests include the forward window", () => {
    const { project, voices } = fixture();
    const clip = voices[1], context = getVoiceGenerationContext(project, clip.id)!;
    const options = { provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "clip" } as const;
    expect(getVoiceCandidateRequestFingerprint(clip, options, undefined, context)).toBe(getVoiceCandidateRequestFingerprint(clip, options));
    expect(getVoiceCandidateRequestFingerprint(clip, { ...options, generationMode: "long_text" }, undefined, context))
      .not.toBe(getVoiceCandidateRequestFingerprint(clip, { ...options, generationMode: "long_text" }));
  });
});
