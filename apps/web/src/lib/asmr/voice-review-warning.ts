import type { VoiceLongTextResult } from "./voice-longtext-result";
import type { VoiceContentComparison } from "./voice-recognition";

export function getVoiceContentDifferenceWarning(index: number, comparison: VoiceContentComparison) {
  if (comparison.mode === "phonetic_substitutions") {
    return `第 ${index + 1} 段：已截取目标片段；拼音容错通过（文字 ${(comparison.similarity * 100).toFixed(1)}%，拼音得分 ${(comparison.phoneticSimilarity * 100).toFixed(1)}%），仍有识别字差，请试听确认。`;
  }
  return `第 ${index + 1} 段：已截取目标片段；识别结果与源文有差异（相似度 ${(comparison.similarity * 100).toFixed(1)}%），请试听确认。`;
}

export function getVoiceReviewWarning(index: number, text: string, code?: string, reasonOverride?: string) {
  const characters = Array.from(text.replace(/\s+/gu, " ").trim());
  const excerpt = characters.slice(0, 28).join("") + (characters.length > 28 ? "…" : "");
  const reason = reasonOverride ?? (code === "uncertain_word_alignment" ? "识别文字未能定位目标句的结束位置"
    : code === "unrecognized_continuation" ? "后续台词衔接未能定位"
    : code === "cut_text_mismatch" ? "截取后的识别文字与目标台词存在差异"
    : ["missing_speech", "incomplete_or_unrelated_speech", "missing_or_extra_speech", "repeated_speech"].includes(code ?? "") ? "识别文字与目标台词存在差异"
    : ["no_safe_quiet_cut", "no_verified_quiet_cut", "missing_continuation_boundary", "uncertain_boundary_timestamps", "invalid_word_timestamps", "invalid_quiet_crop", "missing_internal_boundary", "uncertain_internal_pause"].includes(code ?? "") ? "分段位置未能确认"
    : "录音检查未完成");
  return `第 ${index + 1} 段“${excerpt}”：${reason}，已保留完整原音供试听，没有因此重新生成或丢弃录音。`;
}

// Old candidates keep their stored metadata. Correct only this known generated
// warning when the same group's diagnostic identifies a continuation failure.
export function getVoiceReviewWarningForDisplay(warning: string, groups?: VoiceLongTextResult["groups"]) {
  for (const group of groups ?? []) {
    if (group.checkStatus !== "review" || group.diagnosticCode !== "unrecognized_continuation") continue;
    if (warning === getVoiceReviewWarning(group.index, group.text, group.diagnosticCode, "识别文字与目标台词存在差异")) {
      return getVoiceReviewWarning(group.index, group.text, group.diagnosticCode);
    }
  }
  return warning;
}
