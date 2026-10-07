import type { VoiceLongTextResult } from "@/lib/asmr/voice-longtext-result";
import { getVoiceContentDifferences, type VoiceContentComparison, type VoiceRecognition } from "@/lib/asmr/voice-recognition";

const stageLabels: Record<VoiceRecognition["stage"], string> = {
  input_validation: "输入检查",
  source_transcription: "完整原音识别",
  source_alignment: "目标句定位",
  continuation_alignment: "后文衔接定位",
  boundary_check: "裁剪边界检查",
  target_transcription: "裁剪后识别",
  target_validation: "裁剪后台词核对",
  complete: "检查完成",
  unavailable: "未取得检查结果",
};

const reasonLabels: Record<string, string> = {
  uncertain_word_alignment: "识别文字未能定位目标句的结束位置。",
  unrecognized_continuation: "后续台词衔接未能定位，暂未采用裁剪。",
  cut_text_mismatch: "尝试裁剪后的识别文字未通过核对。",
  no_verified_quiet_cut: "没有确认可采用的安静裁剪位置。",
  no_safe_quiet_cut: "没有找到足够安静的裁剪位置。",
  uncertain_boundary_timestamps: "目标句与后文交界的时间位置不确定。",
  invalid_word_timestamps: "识别出的字词时间位置不可用。",
  missing_continuation_boundary: "没有取得后续台词的起始位置。",
  missing_speech: "本次检查未取得可核对的识别文字。",
  incomplete_or_unrelated_speech: "识别文字未通过目标内容核对。",
  inconsistent_recognition: "整句识别与字词识别不一致，暂未采用裁剪。",
  missing_or_extra_speech: "识别文字可能有缺漏或额外内容。",
  repeated_speech: "识别文字中检测到重复内容。",
  reordered_speech: "识别文字的先后顺序与源文不一致，暂未采用裁剪。",
  ambiguous_ending_anchor: "末尾词出现多次，暂未确认应采用的结束位置。",
};

function RecognitionText({ label, text, empty = "本次未取得识别文本" }: {
  label: string;
  text: string;
  empty?: string;
}) {
  return <div className="min-w-0">
    <dt className="text-studio-muted">{label}</dt>
    <dd className="mt-1 max-h-32 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded bg-black/15 px-2 py-1.5 leading-5 text-studio-text">
      {text || empty}
    </dd>
  </div>;
}

function ContentComparison({ comparison }: { comparison: VoiceContentComparison }) {
  const recognized = Array.from(comparison.recognized);
  const differences = comparison.mode === "bounded_edits" ? getVoiceContentDifferences(comparison.expected, comparison.recognized)
    : Array.from(comparison.expected).flatMap((character, index) => character === recognized[index] ? []
      : [{ kind: "substitution" as const, expectedIndex: index, recognizedIndex: index, expected: character, recognized: recognized[index] }]);
  const percent = (value: number) => `${Number((value * 100).toFixed(1))}%`;
  return <div className="space-y-1 leading-5">
    <p>文字相似度 {percent(comparison.similarity)} · 阈值 {percent(comparison.threshold)}</p>
    {comparison.status === "different" ? <div className="text-amber-100">
      <p>差异字（源文 → 识别）</p>
      <ul className="flex flex-wrap gap-x-3">
        {differences.map((difference, index) => <li key={index}>
          {difference.kind === "insertion" ? (difference.expectedIndex === 0 ? "开头多识别：" : `第 ${difference.expectedIndex} 字后多识别：`) : `第 ${difference.expectedIndex + 1} 字：`}
          {difference.expected || "（源文无此字）"} → {difference.recognized || "（未识别）"}
        </li>)}
      </ul>
    </div> : <p>识别文字与源文一致。</p>}
  </div>;
}

function RecognitionEvidence({ recognition, expectedText, diagnosticCode, review = false, verifiedCrop = false }: {
  recognition?: VoiceRecognition;
  expectedText: string;
  diagnosticCode?: string;
  review?: boolean;
  verifiedCrop?: boolean;
}) {
  const reason = recognition?.alignment?.reason || diagnosticCode;
  const bridge = verifiedCrop && recognition?.stage === "complete" && recognition.contentComparison?.status === "matched"
    ? recognition.continuationBridge : undefined;
  return <>
    <dl className="min-w-0 space-y-2">
      <RecognitionText label="目标台词" text={recognition?.expectedText || expectedText} empty="未保存目标台词" />
      {recognition ? <>
        <RecognitionText label="完整原音识别" text={recognition.sourceTranscript} />
        {recognition.followingText ? <RecognitionText label="后续台词（定位用）" text={recognition.followingText} /> : null}
        {recognition.targetTranscript !== undefined ? <RecognitionText label={review || recognition.stage !== "complete" ? "尝试裁剪后识别（未采用）" : "裁剪后识别"} text={recognition.targetTranscript} /> : null}
        {bridge ? <RecognitionText label="截取位置后的独立识别" text={bridge.rightTranscript} /> : null}
        {recognition.alignment ? <>
          <RecognitionText label="定位期望文字" text={recognition.alignment.expected} empty="未保存定位期望文字" />
          <RecognitionText label="定位时识别前缀" text={recognition.alignment.recognizedPrefix} />
        </> : null}
      </> : null}
    </dl>
    {recognition ? <p className="leading-5">完整原音可能包含后续台词或生成语境；识别文字可能省略标点。</p> : null}
    {bridge ? <p className="leading-5">已在“嗯”之前截取；后续台词已独立核对。</p> : null}
    {recognition?.boundaryMatch ? <p className="break-words leading-5">
      {recognition.boundaryMatch.method === "api" ? "API 辅助定位末尾词" : "末尾词定位"}：「{recognition.boundaryMatch.anchorText}」
    </p> : null}
    {recognition?.apiFallback?.status === "declined" ? <p className="leading-5">API 未能确认结束位置。</p> : null}
    {recognition?.apiFallback?.status === "unavailable" ? <p className="leading-5">API 辅助定位暂不可用。</p> : null}
    {recognition?.contentComparison ? <ContentComparison comparison={recognition.contentComparison} /> : null}
    {recognition ? <p className="leading-5">检查阶段：{stageLabels[recognition.stage]}</p> : <p className="leading-5">未保存识别文本</p>}
    {reason ? <p className="break-words leading-5 text-amber-100">{reasonLabels[reason] ?? `检查标记：${reason}`}</p> : null}
  </>;
}

export function VoiceRecordingRecognitionComparison({ recognition, expectedText, review = false }: {
  recognition?: VoiceRecognition;
  expectedText: string;
  review?: boolean;
}) {
  return <details className="min-w-0 text-xs text-studio-muted">
    <summary className="cursor-pointer py-1">识别对照</summary>
    <div className="mt-2 max-h-80 space-y-2 overflow-y-auto overscroll-contain">
      <p className="leading-5">本条试听与下载均为完整原音。</p>
      {recognition?.contentComparison?.status === "different" ? <p className="leading-5 text-amber-100">识别文字与源文有差异。</p> : null}
      <RecognitionEvidence recognition={recognition} expectedText={expectedText} review={review} verifiedCrop={!review && recognition?.stage === "complete"} />
    </div>
  </details>;
}

export function VoiceRecognitionComparison({ groups }: { groups?: VoiceLongTextResult["groups"] }) {
  return <details className="min-w-0 text-xs text-studio-muted">
    <summary className="cursor-pointer py-1">识别对照</summary>
    {!groups?.length ? <p className="py-2">未保存识别文本</p> : <ol className="mt-2 max-h-80 space-y-4 overflow-y-auto overscroll-contain">
      {groups.map((group) => {
        const recognition = group.recognition;
        const review = group.checkStatus === "review";
        const extractedWithDifference = group.checkStatus === "passed" && recognition?.contentComparison?.status === "different";
        return <li key={group.index} className="min-w-0 space-y-2 border-t border-studio-line pt-2 first:border-t-0 first:pt-0">
          {groups.length > 1 ? <p className="font-semibold text-studio-text">第 {group.index + 1} 组</p> : null}
          <p className={`leading-5 ${review || extractedWithDifference ? "text-amber-100" : "text-studio-muted"}`}>
            {review ? "保留完整原音，未采用裁剪。" : extractedWithDifference ? "已截取目标片段；识别文字与源文有差异。"
              : `${group.checkStatus === "passed" ? "已提取目标片段" : "已存音频范围"}：${group.cutStartSeconds.toFixed(2)}–${group.cutEndSeconds.toFixed(2)} 秒。`}
          </p>
          {extractedWithDifference ? <p className="leading-5">截取范围：{group.cutStartSeconds.toFixed(2)}–{group.cutEndSeconds.toFixed(2)} 秒。</p> : null}
          <RecognitionEvidence recognition={recognition} expectedText={group.text} diagnosticCode={group.diagnosticCode} review={review} verifiedCrop={group.checkStatus === "passed"} />
        </li>;
      })}
    </ol>}
  </details>;
}
