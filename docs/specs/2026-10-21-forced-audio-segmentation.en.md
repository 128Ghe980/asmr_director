# Forced audio segmentation after listening

Date: 2026-10-21. Parent: Audio Quality V1 in progress; SFX paused. No new top-level roadmap stage. Status: implemented and deployed on 3001 after production-build, actual HTTP and corrected-result verification for 29 executable failed recordings. One missing-source record remains separately untested; do not claim the entire inventory was tested.

## User flow and scope

The user explicitly requests: when automatic segmentation fails, listen to the full original recording, decide it is satisfactory, then press **Force split**. This is a separate forced-location path, not a restoration or renaming of the maintenance-oriented retry-old-candidates entry removed earlier.

Show the action only on automatically failed candidates that have not already been forced. Show cancellation while that request runs, retaining the original recording and candidate on cancellation. Listening is the user's judgment: add no per-sentence text checkbox, playback-completion certification or automatic adoption. Success creates a new candidate labelled forced and awaiting listening; ordinary adoption remains the user's choice. Keep download, discard and undo.

Leave generation and automatic segmentation unchanged. The forced path performs no TTS, audio regeneration or new Whisper transcription. It has no 160ms-quiet, 80ms-guard, transcript-similarity or acoustic-score acceptance threshold. Supplied text locates positions, not content correctness; quiet speech, homophones, omitted particles and merged ASR words are not independent rejection reasons.

## Independent CTC location

Use the existing local Chinese model `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn`, revision `99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd`, with fixed weight SHA256 `de031fd4b29e0c0667e5346450fadfe1326c89936b888b59c4ede608db763ee4`. Read offline; install or download nothing automatically.

The new `apps/web/scripts/force-align-voice.py` is separate from automatic segmentation. Input is original 48kHz mono PCM16 WAV, at most 120 seconds. Resampling to 16kHz creates an analysis copy only. Use processor normalization and attention masks, CUDA fp16 emissions and a NumPy CPU Viterbi CTC path. This is neither complete WhisperX nor the old experiment's quiet-candidate pipeline.

- Paragraphs use the saved full original, complete text and ordered sentence list in one emission/alignment pass. Do not use a sentence-only recording or a remainder from a failed earlier run as the full source.
- Short/context recordings use the actual saved complete `inputText`, including following text and fillers. Every one of the full T frames follows ordered known-text token, wildcard or blank states. At the final frame the path may end at any completed text prefix covering the target and first following character, without forcing unread padding. There is no free acoustic sink detached from the known context. Do not ignore tail frames or compare means of paths with different frame counts.
- Keep character provenance through punctuation/whitespace removal and simplification. Do not invent character-proportional times or substitute spellings. OOV characters retain their original spelling and distinct wildcard state identity; each frame uses the maximum nonblank emission without changing the fixed model vocabulary. Repeated identical unknown characters still require blank separation. Mark corresponding output characters with `wildcard: true`; do not force unread tail text or silently skip middle characters to align later text.

For each sentence boundary, use the midpoint between the left final character's end and right initial character's start, rounded to an original 48kHz frame. Adjacent spans may share that boundary without quiet. The approximately 20ms CTC grid is an estimate, not a guarantee of perfect audible boundaries. Paragraph pieces continuously partition the full native PCM, including the final tail, and reassemble exactly. A context clip retains only its target PCM prefix; do not mislabel the whole padded recording as target-only audio. A final input without following text may retain its entire original PCM.

## Provenance, results and executable errors

The backend processes failed candidates whose saved source still matches the current workspace, candidate, recording, original text/context and generation parameters. Do not force another recording after text/source changes. Missing or non-unique sources produce an explicit error while keeping the old candidate. New results preserve original-WAV SHA256, original UTF8 text SHA256, model revision, integer cuts, real character times/scores, wildcard flags, prior failure evidence and source-candidate identity.

Mark results with `forcedSegmentation.method: ctc_forced` and `contentVerified: false`. Do not fabricate an automatic safe-cut proof, alter old ASR scores or erase failure evidence. Preserve original audio and candidates; cancellation, errors or source changes before publication must not publish partial paragraph candidates. Keep voice references, portable video-package protocols and user adoption choices unchanged.

Executable errors still include missing/damaged audio, source-identity mismatch, normalization that cannot preserve mapping, insufficient CTC frames including repeated-token blanks, no valid path, nonfinite/invalid times, out-of-range or non-increasing rounded cuts, unavailable runtime/model/resources, cancellation and timeout. Ordinary OOV characters use wildcard states rather than a text-rejection rule. Do not drop characters or proportionally assign seconds to manufacture results.

## Acceptance

Synthetic cases cover full and all-T known-prefix CTC, a counterexample preventing free-sink target compression, repeated tokens, unread padding, real wildcard times/original-character flags, no-quiet midpoints, native frames and the file protocol. Product checks cover failed-only actions, cancellation, ordinary adoption, original/prior-failure retention, source-change protection, atomic publication and no TTS. Real verification must use existing failed originals and distinguish inventory, preparation, actual completion and missing sources. Neither the Oct16 experiment nor a synthetic-test count represents current real recordings; producing slices alone is not boundary acceptance.

Evidence root: `I:/AI/asmr-director-force-split/2026-10-21/`. Implementation, final tests, real results and deployment follow the [development record](../records/2026-10-21-forced-audio-segmentation.md) and actual receipts. Evaluate CTC by executable boundaries, native PCM conservation and listening, not whether ASR spelling improves.
