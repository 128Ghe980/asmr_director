# Bounded text tolerance with verified voice extraction

Date: 2026-09-23. This updates the existing extraction workflow, not the roadmap or voice-generation parameters. [中文版](2026-09-23-tolerant-voice-extraction.zh.md).

## User decision

Small ASR differences should not automatically prevent reliable extraction. Separate the content comparison from the acoustic boundary decision: a target can be safely extracted while recognition differs slightly from the source text, provided the difference is explicitly shown. Complete original recordings remain separately available, with no quality-triggered synthesis retry or automatic candidate adoption.

This decision supersedes the target-text anchor rejection recorded in the [September 21 investigation](2026-09-21-voice-recognition-inspection.md). That investigation remains a record of the earlier behavior and real evidence; it did not establish that the audio actually pronounced an incorrect character.

## Bounded target-content comparison

Apply the existing normalization first: traditional-to-simplified Chinese, removal of punctuation/spacing, lowercase, and existing `地`/`得` to `的` equivalence. There is no new blanket homophone equivalence such as `啦` to `了`.

The accepted target and recognized text must have the same normalized length. Permit at most two positional character substitutions and require at least 90% agreement. The implementation uses `substitutionCount × 10 ≤ normalizedLength` to avoid rounding at the threshold. Existing edit-operation checks still reject insertion/deletion, reordering represented by shifted alignment, unequal replacement spans and newly duplicated phrases. This is a bounded text rule, not proof of exactly what was spoken.

- Ten characters can have one substitution; nine cannot.
- Twenty characters can have two substitutions; nineteen cannot.
- Three substitutions are rejected even in a long text with more than 90% agreement.
- A standalone three-character target such as `回来啦` versus `回来了` remains below the threshold. It does not borrow a tolerance budget from later context.

The target path no longer rejects solely because one of its first or last three characters differs. The strict comparison remains available as the default helper behavior and continues to protect the following-speech anchor.

## Independent boundary proof

A difference in the source target prefix forces the target through the existing nearby quiet-candidate search and independent recognition on both sides. Each candidate requires at least 160 ms of measured quiet, with at least 80 ms on each side of the chosen cut. Existing absolute/relative noise limits, nearby search bounds, valid-word-timestamp checks and the maximum of three candidate cuts remain in force. No cut is inferred from average speaking rate, character count or a fixed historical timestamp.

The left-side recognition may use the bounded target-content rule. The right-side recognition still uses strict following-text alignment, preserving the start of the next utterance and rejecting leaked target-tail or missing first-syllable speech. Segment recognition and the joined word transcript must agree after normalization on the accepted target side.

An exact source-prefix match may retain the existing fast cut. If the independent final cropped ASR first reveals an allowed substitution, extraction must return to two-sided verification and then crop and recognize again. This additional analysis pass is bounded to once; it does not run VoxCPM2 again. Source agreement alone cannot authorize a different final cropped transcript without two-sided evidence.

After the actual crop and safe quiet-edge processing, independently transcribe the retained audio. Both the final transcript and concatenated word transcript must pass the full-target rule and agree with each other exactly after normalization. A successful boundary cannot excuse missing, extra or contradictory recognized content. A true final unit has no following speech to separate; it retains the full-content checks and safe quiet-edge processing.

## Internal pause boundaries

Full-target acceptance establishes the permitted equal-length correspondence. `resolve_clause_boundaries` then maps each cumulative normalized clause length to the end of a whole ASR word, including the final clause. It first verifies that the clauses cover the requested target and that the complete joined word transcript passes the target comparison.

This lets the ten-character target `回来啦？外面是不是很冷？` pass with recognized `回来了外面是不是很冷`, then locate the first clause at the end of the recognized `回来了` word. It does not rerun a 90% test on that internal three-character prefix, while a standalone three-character request still fails. Internal pauses remain measured gaps between adjacent word timestamps, including valid zero gaps. A clause boundary inside one ASR word remains unresolved; the system does not divide that word's duration by character count or invent a boundary.

## Result, display and compatibility

Successful extraction retains `checkStatus: passed`; this means the extraction checks passed, not that every normalized character matches. Optional `recognition.contentComparison` explicitly records:

```text
status: matched | different
similarity: 0.9..1, rounded to six decimals
threshold: 0.9
substitutionCount: 0..2
expected: normalized target
recognized: normalized recognized target
```

The TypeScript schema checks that lengths, substitution count, similarity and status agree. Only a completed target comparison is attached; rejected cut attempts and intermediate recognition must not leave stale comparison or alignment evidence on another candidate.

For `passed` plus `different`, the result includes a listening warning and the folded recognition UI says the target was extracted but recognition differs from the source. It shows similarity and the source-to-recognition character differences. Original-recording playback/download remains the complete original and is labeled accordingly; its comparison does not turn that recording into the crop. Failed extraction still retains the full original with review status. Older records without `contentComparison` remain valid and are not relabeled as exact matches.

Analysis notices are rebuilt from the final group results. Replacing a previously reviewed group with a successful extraction removes that group's stale full-original warning and adds its current difference notice when needed; warnings for other groups still under review remain. `inconsistent_recognition` has a readable Chinese explanation for disagreement between the segment and word transcripts.

## Verification and real-recording evidence

The current deterministic Python suite passes **54 tests**, including the exact 90% boundary, the two-substitution limit, short independent targets, whole-word clause boundaries, both forced two-sided paths, missing quiet, strict following onset, inconsistent final transcript/words, insertion/deletion/reordering/repetition rejection, checkpoint retention and evidence cleanup between attempts. The tests do not load ASR models or synthesize audio.

The final Vitest run passed **65 files / 692 tests**, with one existing opt-in file/test skipped. Full ESLint, TypeScript and the production build passed.

Evidence root: `I:/AI/asmr-director-tolerant-extraction/2026-09-23`. `real-analysis.json` records a successful reanalysis of the existing September 21 source WAV, taking 84.665 seconds without new TTS. It retains source range 0–2.45 seconds, with final ASR `回来了外面是不是很冷`, `different`, similarity 0.9 and one substitution against `回来啦外面是不是很冷`. Two-sided validation uses measured quiet at 2.37–2.63 seconds (threshold −67.4437 dBFS). The retained tail contains 80 ms quiet. The final word timestamps yield one internal pause of 0 ms; this valid measured gap is not replaced with estimated silence.

`candidate-persistence.json` and `new-candidate.json` record derived candidate `vox_e34bc7d50ffd440b95bff2828363aeaf`, duration 2.45 seconds, from `vox_f33328cbe274426286a088606b03592b`. Its group has `passed` plus the visible 90.0% difference warning. The original candidate is unchanged; the original source SHA-256 remains `0e389037d755a1cd82ba0b9f86bd4a382342e65c3256024f4211ac1f10b095f5`. The manifest before adding the candidate is backed up in `candidate-manifest-before.json`. New TTS runs: zero. The new candidate is not adopted.

Production runs on port 3001 / PID 25872 / `.next-semantic-build`. Port 3001 was not listening at the start of deployment; no running service was killed. The candidate API returns both the new 2.45-second `passed`/`different` candidate and the old 23.36-second `review` candidate. Candidate asset and complete-original endpoints returned HTTP 200.

After browser reload, all 11 script units remained character-for-character unchanged. The new candidate appears first and the old recording remains as the second candidate. Expanding recognition shows source range 0.00–2.45 seconds, 90% threshold, 90% similarity, character 3 `啦 → 了`, and completed checking. Spatial playback ended normally with `currentTime = duration = 3.1 seconds`, `readyState = 4` and no media error; the 650 ms extension is the existing original-D spatial tail, not speech stretching. After a fresh reload the console error/warning list was empty. At 1729×1280 the document matched the viewport, and both upper panels spanned y=127..927.703125. The candidate was not adopted; new TTS runs remain zero. The evidence root contains the combined verification and deployment records.

Successful automated extraction under the new rule and successful browser playback are not headphone-listening acceptance or proof that the audio pronounced the disputed character incorrectly. This turn changes content/cut validation, not the accepted ellipsis, reference, model or sampling strategy. Changes remain uncommitted and unpushed.
