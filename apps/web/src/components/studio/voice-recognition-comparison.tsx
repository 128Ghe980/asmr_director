import type { VoiceLongTextResult } from "@/lib/asmr/voice-longtext-result";
import type { VoiceParagraphRecordingRecognition } from "@/lib/asmr/voice-generation-recording";
import { isVoiceParagraphManuallyConfirmed, type VoiceParagraphResult } from "@/lib/asmr/voice-paragraph-result";
import { getVoiceContentDifferences, isCuttingOnlyRecognition, type VoiceContentComparison, type VoiceRecognition } from "@/lib/asmr/voice-recognition";

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
  boundary_unlocatable: "无法确定目标片段的切分位置，完整原音已保留。",
  ambiguous_boundary: "存在多个可能的切分位置，完整原音已保留。",
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
    <dd className="mt-1 whitespace-pre-wrap break-words rounded bg-black/15 px-2 py-1.5 leading-5 text-studio-text">
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
    {comparison.mode === "phonetic_substitutions" || comparison.mode === "sentence_particle" ? <>
      {comparison.mode === "phonetic_substitutions" ? <p>拼音容错得分 {percent(comparison.phoneticSimilarity)} · 阈值 {percent(comparison.phoneticThreshold)}</p>
        : <p className="text-amber-100">历史记录：句尾语气词存在识别字差，仅供试听参考。</p>}
      <ul className="space-y-1 text-amber-100">
        {comparison.differences.map(difference => <li key={difference.index}>
          第 {difference.index + 1} 字拼音：{difference.expectedPinyin} → {difference.recognizedPinyin} · {difference.rule === "same_tone" ? "同音同调"
            : difference.rule === "sentence_particle" ? "句末语气词差异" : `声调差异（完整原音识别为“${difference.sourceCharacter}”）`}
        </li>)}
      </ul>
    </> : null}
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

function RecognitionEvidence({ recognition, expectedText, diagnosticCode, review = false, verifiedCrop = false,
  sourceLabel = "完整原音识别", sourceHint = "完整原音可能包含后续台词或生成语境；识别文字可能省略标点。", targetLabel }: {
  recognition?: VoiceRecognition;
  expectedText: string;
  diagnosticCode?: string;
  review?: boolean;
  verifiedCrop?: boolean;
  sourceLabel?: string;
  sourceHint?: string;
  targetLabel?: string;
}) {
  const cuttingOnly = isCuttingOnlyRecognition(recognition);
  const reason = recognition?.alignment?.reason || diagnosticCode;
  const bridge = !cuttingOnly && verifiedCrop && recognition?.stage === "complete" && recognition.contentComparison?.status === "matched"
    ? recognition.continuationBridge : undefined;
  return <>
    {!cuttingOnly && recognition ? <p className="leading-5">历史识别记录，仅供试听参考；不作为采用条件。</p> : null}
    <dl className="min-w-0 space-y-2">
      <RecognitionText label="目标台词" text={recognition?.expectedText || expectedText} empty="未保存目标台词" />
      {recognition ? <>
        <RecognitionText label={sourceLabel} text={recognition.sourceTranscript} />
        {recognition.followingText ? <RecognitionText label="后续台词（定位用）" text={recognition.followingText} /> : null}
        {recognition.targetTranscript !== undefined ? <RecognitionText label={cuttingOnly ? "目标片段定位文本" : targetLabel ?? (review || recognition.stage !== "complete" ? "尝试裁剪后识别（未采用）" : "裁剪后识别")} text={recognition.targetTranscript} /> : null}
        {bridge ? <RecognitionText label="截取位置后的独立识别" text={bridge.rightTranscript} /> : null}
        {recognition.alignment ? <>
          <RecognitionText label="定位期望文字" text={recognition.alignment.expected} empty="未保存定位期望文字" />
          <RecognitionText label="定位时识别前缀" text={recognition.alignment.recognizedPrefix} />
        </> : null}
      </> : null}
    </dl>
    {recognition ? <p className="leading-5">{cuttingOnly ? "识别文本仅用于定位切分，目标片段定位文本来自上述原音识别；内容是否符合台词，请试听原声判断。" : sourceHint}</p> : null}
    {bridge ? <p className="leading-5">已在“嗯”之前截取；后续台词已独立核对。</p> : null}
    {!cuttingOnly && recognition?.boundaryMatch ? <p className="break-words leading-5">
      {recognition.boundaryMatch.method === "api" ? "API 辅助定位末尾词" : "末尾词定位"}：「{recognition.boundaryMatch.anchorText}」
    </p> : null}
    {!cuttingOnly && recognition?.apiFallback?.status === "declined" ? <p className="leading-5">API 未能确认结束位置。</p> : null}
    {!cuttingOnly && recognition?.apiFallback?.status === "unavailable" ? <p className="leading-5">API 辅助定位暂不可用。</p> : null}
    {!cuttingOnly && recognition?.followingPhoneticBoundary ? <details className="min-w-0 rounded border border-studio-line px-2 py-1.5">
      <summary className="cursor-pointer leading-5 text-amber-100">后文边界 · 同音字差</summary>
      <div className="mt-2 min-w-0 space-y-2">
        <dl className="min-w-0 space-y-2">
          <RecognitionText label="后文定位文字" text={recognition.followingPhoneticBoundary.expected} />
          <RecognitionText label="切点右侧识别" text={recognition.followingPhoneticBoundary.right.transcript} />
        </dl>
        <p className="break-words leading-5 text-amber-100">第 {recognition.followingPhoneticBoundary.difference.index + 1} 字：{recognition.followingPhoneticBoundary.difference.expected} → {recognition.followingPhoneticBoundary.difference.recognized}
          （{recognition.followingPhoneticBoundary.difference.expectedPinyin} → {recognition.followingPhoneticBoundary.difference.recognizedPinyin} · 同音同调）</p>
        <p className="leading-5">用于核对后文衔接位置，实际识别字差保留。</p>
      </div>
    </details> : null}
    {!cuttingOnly && recognition?.contentComparison ? <ContentComparison comparison={recognition.contentComparison} /> : null}
    {recognition ? <p className="leading-5">{cuttingOnly ? `切分阶段：${recognition.stage === "complete" ? "切分完成，待试听" : stageLabels[recognition.stage]}` : `检查阶段：${recognition.shortSentenceReview ? "历史切分及识别记录" : stageLabels[recognition.stage]}`}</p> : <p className="leading-5">未保存识别文本</p>}
    {reason ? <p className="break-words leading-5 text-amber-100">{reasonLabels[reason] ?? `检查标记：${reason}`}</p> : null}
  </>;
}

export function VoiceParagraphRecognitionComparison({ paragraph, expectedText, originalRecording = false }: {
  paragraph: VoiceParagraphRecordingRecognition | VoiceParagraphResult;
  expectedText: string;
  originalRecording?: boolean;
}) {
  const failedIndex = paragraph.failedClipId ? paragraph.clipIds.indexOf(paragraph.failedClipId) : -1;
  const review = paragraph.checkStatus === "review";
  const cuttingOnly = isCuttingOnlyRecognition(paragraph.failureRecognition)
    || paragraph.segments.some((segment) => isCuttingOnlyRecognition(segment.recognition));
  const manuallyConfirmed = "sourceAsset" in paragraph && isVoiceParagraphManuallyConfirmed(paragraph);
  return <details className="min-w-0 text-xs text-studio-muted">
    <summary className="cursor-pointer py-1">{cuttingOnly ? "切分定位参考" : "识别对照"}</summary>
    <div className="mt-2 min-w-0 space-y-3">
      {originalRecording ? <p className="leading-5">本条试听与下载均为完整原音。</p> : null}
      <p className={`leading-5 ${review ? "text-amber-100" : "text-studio-muted"}`}>
        {review ? cuttingOnly ? "切点未确定，完整原音已保留。" : "未保存完整切片，原音已保留。"
          : `切分完成，待试听。已保存 ${paragraph.segments.length} 个短句片段，内容由您试听判断。`}
      </p>
      {manuallyConfirmed ? <p className="leading-5">历史试听确认回执已保存，原识别结果保留。</p> : null}
      <dl><RecognitionText label="整段台词" text={expectedText} /></dl>
      {review ? <div className="min-w-0 space-y-2 border-t border-studio-line pt-2">
        {failedIndex >= 0 ? <p className="font-semibold text-studio-text">短句 {failedIndex + 1} · {cuttingOnly ? "切点未确定" : "检查未通过"}</p> : null}
        {paragraph.failureRecognition ? <RecognitionEvidence recognition={paragraph.failureRecognition}
          expectedText={paragraph.failureRecognition.expectedText} diagnosticCode={paragraph.diagnosticCode} review
          sourceLabel={failedIndex === 0 ? "整段原音识别" : failedIndex > 0 ? "剩余原音识别" : "本次分析原音识别"}
          sourceHint={failedIndex === 0 ? "先识别整段原音以定位第一句；识别文字可能省略标点。" : "这次识别针对尚未切出的剩余原音，字词时间从剩余原音起点计算。"} />
          : <>
            <p className="leading-5">{originalRecording ? "本条录音未保存短句检查明细；完整原音仍可试听和下载。" : "本条候选未保存短句检查明细，可在完整原始录音的识别对照中查看已保存的检查记录。"}</p>
            {paragraph.diagnosticCode ? <p className="break-words leading-5 text-amber-100">{reasonLabels[paragraph.diagnosticCode] ?? `检查标记：${paragraph.diagnosticCode}`}</p> : null}
          </>}
      </div> : <ol className="min-w-0 space-y-4">
        {paragraph.segments.map((segment, index) => <li key={segment.clipId} className="min-w-0 space-y-2 border-t border-studio-line pt-2">
          <p className="font-semibold text-studio-text">短句 {index + 1} · {segment.cutStartSeconds.toFixed(2)}–{segment.cutEndSeconds.toFixed(2)} 秒</p>
          {!cuttingOnly && segment.textReview ? <p className="text-studio-muted">{manuallyConfirmed ? "历史试听确认记录已保存；原识别字差保留。"
            : segment.textReview.reason === "same_tone_substitution" ? "历史识别存在同音字差，仅供试听参考。" : "历史识别遗漏句尾语气词，仅供试听参考。"}</p> : null}
          {segment.textReview?.left && segment.textReview.left.transcript !== segment.textReview.final.transcript ? <dl>
            <RecognitionText label="切点左侧识别" text={segment.textReview.left.transcript} />
          </dl> : null}
          {segment.textReview?.reason === "same_tone_substitution" ? <ul className="space-y-1 text-amber-100">
            {segment.textReview.differences.map((difference) => <li key={difference.index}>第 {difference.index + 1} 字：{difference.expected} → {difference.recognized}
              （{difference.expectedPinyin} → {difference.recognizedPinyin} · 同音同调）</li>)}
          </ul> : null}
          <RecognitionEvidence recognition={segment.recognition} expectedText={segment.text} verifiedCrop={!segment.textReview}
            targetLabel={segment.textReview ? "短句识别（历史）" : undefined}
            sourceLabel={index === 0 ? "整段原音识别" : "剩余原音识别"}
            sourceHint={index === 0 ? "先识别整段原音以定位第一句；识别文字可能省略标点。" : "这次识别针对尚未切出的剩余原音，字词时间从剩余原音起点计算。"} />
        </li>)}
      </ol>}
    </div>
  </details>;
}

export function VoiceRecordingRecognitionComparison({ recognition, expectedText, review = false }: {
  recognition?: VoiceRecognition;
  expectedText: string;
  review?: boolean;
}) {
  const cuttingOnly = isCuttingOnlyRecognition(recognition);
  return <details className="min-w-0 text-xs text-studio-muted">
    <summary className="cursor-pointer py-1">{cuttingOnly ? "切分定位参考" : "识别对照"}</summary>
    <div className="mt-2 min-w-0 space-y-2">
      <p className="leading-5">本条试听与下载均为完整原音。</p>
      {!cuttingOnly && recognition?.contentComparison?.status === "different" ? <p className="leading-5 text-amber-100">识别文字与源文有差异。</p> : null}
      <RecognitionEvidence recognition={recognition} expectedText={expectedText} review={review} verifiedCrop={!review && recognition?.stage === "complete"} />
    </div>
  </details>;
}

export function VoiceRecognitionComparison({ groups }: { groups?: VoiceLongTextResult["groups"] }) {
  const cuttingOnly = groups?.some((group) => isCuttingOnlyRecognition(group.recognition));
  return <details className="min-w-0 text-xs text-studio-muted">
    <summary className="cursor-pointer py-1">{cuttingOnly ? "切分定位参考" : "识别对照"}</summary>
    {!groups?.length ? <p className="py-2">未保存识别文本</p> : <ol className="mt-2 min-w-0 space-y-4">
      {groups.map((group) => {
        const recognition = group.recognition;
        const cuttingOnlyGroup = isCuttingOnlyRecognition(recognition);
        const review = group.checkStatus === "review";
        const extractedWithDifference = group.checkStatus === "passed" && recognition?.contentComparison?.status === "different";
        return <li key={group.index} className="min-w-0 space-y-2 border-t border-studio-line pt-2 first:border-t-0 first:pt-0">
          {groups.length > 1 ? <p className="font-semibold text-studio-text">第 {group.index + 1} 组</p> : null}
          <p className={`leading-5 ${review || extractedWithDifference ? "text-amber-100" : "text-studio-muted"}`}>
            {review ? cuttingOnlyGroup ? "切点未确定，完整原音已保留。" : "保留完整原音，未采用裁剪。"
              : group.checkStatus === "passed" ? "切分完成，待试听。" : "已保存原音与定位参考，请试听。"}
          </p>
          {extractedWithDifference || group.checkStatus === "passed" ? <p className="leading-5">截取范围：{group.cutStartSeconds.toFixed(2)}–{group.cutEndSeconds.toFixed(2)} 秒。</p> : null}
          <RecognitionEvidence recognition={recognition} expectedText={group.text} diagnosticCode={group.diagnosticCode} review={review} verifiedCrop={group.checkStatus === "passed"} />
        </li>;
      })}
    </ol>}
  </details>;
}
