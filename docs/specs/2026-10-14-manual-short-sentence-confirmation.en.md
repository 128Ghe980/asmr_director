# Tiny-sentence ASR differences and manual listening confirmation

Date: 2026-10-14. This belongs to Audio Quality V1, not a new roadmap stage.

## User decision

After listening to the reconstructed original 0–2.02s window, the user confirmed that 啦 is retained and authorized option1: separate boundary safety from bounded tiny-sentence text checks, then allow adoption after explicit listening confirmation. Existing short-target/following-text extraction, independent result banks and synchronized source remain intact.

## Analysis scope

Only paragraph requests explicitly opt into `allowShortSentenceTextReview`, together with `requireTwoSided` and `allowShortSentenceParticle`, without semantic API hints. Existing `clip / long_text` do not opt in.

The normalized target is 3–9 Han characters with an explicit natural ending and a final neutral 啦/了. Full-source ASR must contain the complete target at a real whole-word endpoint: literal prefix agreement, with the existing neutral final-particle pair allowed. Independent left or final target ASR must omit only that one final particle at least once; the other window may be complete or have that same omission. Other omissions, changed prefix, reordering, repetition, inconsistent word text, invalid timestamps or unknown speech are not accepted by this branch.

The existing one safe quiet-edge retry remains. Non-final cuts still require measured quiet, independent following speech, valid timestamps and original-PCM checks. The final remainder retains all source frames and an independent final check. Preserve actual transcripts, word times and literal scores; do not fabricate exact text or reinterpret deletion as an equal-length particle substitution.

The real probe also encountered a following sentence with 坐 recognized as 做. A second branch permits exactly one same-syllable, same-tone substitution in a complete 3–9-Han sentence, excluding numeric/negation characters, insertion/deletion, tone changes and multiple substitutions. Source, left and final recognition must retain either the exact target or the same full-length single-character variant. A source-only difference still requires confirmation when the final transcript is correct.

For such a complete following-sentence variant, `followingPhoneticBoundary` preserves expected/actual text, the character and toned-pinyin evidence, the immediately adjacent complete source-word index, and real right-window words/times. This establishes phonetic boundary correspondence with unchanged quiet/timing checks; it is not general text acceptance.

`recognition.shortSentenceReview` and segment `textReview` carry identical evidence: status needs_confirmation, reason missing_final_particle or same_tone_substitution, expected/source prefix, actual final score and applicable left/right/final transcripts, words and window durations. The particle branch carries neutral ending pronunciation; the same-tone branch carries one evidenced character difference with toned pinyin. Strict parsers bind source and windows to the request.

## Three outcomes

| checkStatus | Meaning | Adoption |
|---|---|---|
| review | All boundaries could not be established; full original only | No manual bypass |
| passed | All automatic checks passed; complete continuous slices | Existing flow |
| needs_confirmation | All boundaries established; at least one bounded text difference | Explicit listening confirmation required |

Both sliced outcomes must cover every source frame in order and include every member. Never publish a partial group. A bounded text difference alone must not prevent the other sentence checks; any other unsafe boundary still returns the group to review.

After human confirmation, checkStatus stays needs_confirmation and all ASR evidence remains. Record separate `manualTextConfirmation: { sourceCandidateId, confirmedClipIds, confirmedAt }`. Confirmed IDs must exactly equal all textReview member IDs in source order. Human approval must not masquerade as automatic recognition success.

## UI and server confirmation

The candidate presents confirmed boundaries with text pending listening, native-PCM players, expected and unchanged recognized text, the actual differing recognition window, and unchecked completeness checkboxes. Explain a source-only same-tone difference when final recognition agrees, and keep following phonetic boundary evidence in collapsed comparison details. Enable confirm-and-adopt only after every pending member is checked. Confirmed candidates retain a normal adoption retry path with a distinct manual label.

POST `/api/audio-candidates/[candidateId]/confirm-text` accepts current project, clipId and confirmedClipIds. The server creates receipt/time, validates project/paragraph bank/complete ordered source and delivery fingerprints, every authoritative ready sibling, and actual full-source and sliced native PCM format/duration/byte correspondence. Under the manifest lock, compare every sibling snapshot again and atomically write the same receipt. Duplicate confirmation is idempotent. No model call, new candidate or automatic adoption.

Before adoption, the client validates returned identity, original asset, full group and exact confirmation IDs. Source changes, navigation, clip/project changes, cancellation and late responses retain their existing guards. Persistence precedes adoption, keeping old audio on storage failure. The other bank remains independent.

## Chinese alignment feasibility scope

The user separately asked how Chinese alignment works and whether this machine can host it. Perform read-only assessment, without installing weights. A possible pipeline is checked full transcript→Chinese CTC character alignment→real quiet near sentence endings→native48kHz PCM slices. Resampling the analysis input to16kHz does not change published PCM. Alignment alone cannot prove complete spoken content; low-score/unaligned characters must stay visible, never become estimated passing timestamps.

Local hardware: Ryzen7 5800H,16GB RAM,RTX3060 Laptop6GB; Torch2.8/torchaudio2.8/Transformers4.50 exist, WhisperX does not. Its default Chinese wav2vec2 PyTorch weight is approximately1.28GB. Hardware supports a bounded serial CPU/GPU feasibility trial, but soft-voice accuracy and speed are unmeasured. Store new models/cache/audio/build on I. Keep runtime-lock and memory checks; load and release TTS/Whisper/alignment by stage.

Use the development record for implementation, real probes, build and deployment. This contract alone is not evidence of completed verification.
