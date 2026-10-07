# Ending-anchor extraction with bounded text edits

Date: 2026-09-24; verification resumed on 2026-10-01. This extends the existing target-extraction workflow without adding a roadmap stage or changing generation parameters. [中文版](2026-09-24-ending-anchor-extraction.zh.md).

## User request and diagnosed example

The user asked whether unusual prosody punctuation causes a mismatch, proposed using the last word or characters as an endpoint anchor, and requested an API judgment as a last fallback. Content matching and acoustic cut safety remain separate decisions; complete originals must stay available and candidates must not be adopted automatically.

Existing normalization already removes punctuation and other non-letter/non-number symbols, including `~`, `～`, ellipses, dashes and brackets. Letters inside an annotation such as `[轻声]` remain content. This change does not remove annotation words or modify the actual synthesis text, pacing, ellipsis strategy, voice reference or model settings.

The actual failed target is `来~~，面来啦！慢点儿吃，小心烫。汤也喝一点，暖胃。`. Its normalized form contains 18 characters. The recognized target prefix `来,面来了,慢点吃,小心烫,汤也喝一点,暖胃` contains 17: `啦 → 了` and omitted `儿`. The September 23 comparison rejects unequal lengths, before attempting a safe cut. Even ordinary edit similarity would be `1 - 2/18 = 88.8889%`, below its 90% substitution-only threshold. Punctuation is not the cause.

## Implemented bounded fallback contract

The existing exact/90% equal-length substitution path keeps its original comparison format and behavior. A separate `bounded_edits` comparison permits insertions, deletions and substitutions only when all these bounds hold:

- The normalized target contains at least 10 characters.
- There are at most two Levenshtein edits in total.
- Similarity is `1 - editCount / max(targetLength, recognizedLength)` and is at least 85%.
- Reordering/transposition and newly repeated phrases are rejected.
- Candidate target prefixes retain the exact first two normalized characters and end at a whole ASR word.

The lower threshold is specific to this endpoint-assisted fallback. It does not silently lower the original comparison threshold, globally remove `儿`, or turn homophones into exact matches. The result records its mode, threshold, insertion/deletion/substitution counts, edit count, normalized source and normalized recognized text. Existing accepted comparisons retain their old shape for backward compatibility.

A local ending anchor uses an exact shared suffix of at least two and at most six normalized characters, preferring a longer usable suffix. The full bounded prefix and immediate following speech must identify one unique candidate endpoint in the plausible opening search. Repeated words earlier in an otherwise valid prefix do not alone prevent extraction; an extra repeated ending before the continuation cannot be skipped. A shared final word alone cannot admit unrelated or truncated content or jump to a distant match elsewhere in the recording.

## Acoustic proof and internal mapping

### October 7 continuation interjection repair

The target-content thresholds above remain unchanged. The real target `今天是不是又加班了？眼睛都红红的。` was recognized exactly after normalization, but its continuation began `嗯面快好了` rather than `面快好了`. Strict continuation-prefix matching stopped before crop validation and the generated warning incorrectly described a target-text difference.

A narrowly bounded continuation bridge may discard one separately timed source ASR word `嗯` immediately after an **exact** target prefix. It cannot skip other words, repeated interjections, merged `嗯面` words, changed/missing continuation syllables, or an approximate target. Independently recognize the complete remaining right side, bounded by the existing120-second source limit and worker deadline: a short continuation-only window can misrecognize the anchor. Its segment text and whole-word prefix must start with the complete supplied continuation, optionally preceded by one separate `嗯`; omission of this interjection by the independent recognizer is allowed only with the separately timed source word and guarded quiet proof. Never scan later text for a matching anchor. The left and final target checks remain exact. Search only between the target word end plus80ms and the source interjection start minus80ms, using at least160ms measured quiet. No timestamp may be split by character count. Failure retains the complete original.

Completed exact-content results may include bounded `continuationBridge` evidence containing the source word index/times and the actual independently recognized right-side text. The server additionally requires cut validation before the interjection. UI explanations distinguish the complete recording, supplied continuation and an unadopted trial crop. Historical continuation warnings are corrected for display only, without rewriting stored projects or audio. This extension does not change synthesis parameters or automatically rerun/adopt recordings.

Every endpoint-assisted crop requires the established nearby quiet search and independent recognition on both sides. Actual measured quiet must protect both sides of the cut; an ASR word timestamp alone is insufficient. The target side uses the bounded full-target comparison, and the following side retains strict continuation checks. The final cropped transcript and joined word transcript must agree after normalization. Unsafe or unverified boundaries keep the complete source with review status.

Internal clause mapping must use the accepted edit alignment rather than unchanged character offsets. Only unambiguous mappings to whole ASR-word endpoints are accepted. A deleted clause-ending character, ambiguous alignment around repeated text or a boundary inside an ASR word does not acquire a guessed timestamp. Internal pause lengths remain gaps between actual adjacent word timestamps. No timestamp is inferred from average pace or character ratios.

## API fallback scope

The implemented API fallback can choose only among locally computed, bounded candidate endpoints. Its response contains only an existing word index or `null`; the application retrieves the recognized prefix from the original local candidate. It cannot invent words, timestamps or candidate indices, bypass text bounds, or authorize a crop without local acoustic proof. Local deterministic success does not require an API call.

The fallback reuses the configured external Planner provider. It sends bounded target/recognized text and nearby word indices, not WAV audio, timestamps, local paths or unrelated distant continuation. It runs only after local source alignment reports an unresolved/ambiguous ending with admissible endpoints, and uses one request with a default 15-second timeout. A selected endpoint gets one complete local verification pass; there is no API retry, recursive fallback or native generation retry. Unconfigured providers, null decisions, malformed responses and request failures preserve the complete-original delivery path and local recognition evidence. Cancellation remains effective through both passes. Recognition records expose selected/declined/unavailable API status and local/API boundary provenance separately from actual cut validation.

The initial live provider call returned HTTP 400 with an explicit JSON-mode requirement: the prompt must contain the word `json`. The boundary prompt now explicitly requests JSON, with a regression test for that provider requirement. This JSON literal is the provider fix in this round. Existing helper configuration is unchanged, including its earlier thinking toggle for the official `api.deepseek.com` host; creative Planner behavior, model and output budget are unchanged. The October 1 live text-only check returned HTTP 200 with `{ "terminalWordIndex": 13 }` using the configured `deepseek-v4-pro` model. The application selected the already-existing prefix and completed in 644 ms. Evidence: `I:/AI/asmr-director-ending-anchor/2026-10-01/api-check-before.json` and `api-check-after.json`. This proves real provider endpoint selection; the actual example crop still used the local path and did not depend on this separate API check.

## Existing recording evidence

Evidence source: `I:/AI/asmr-director-voice-work/long-text/06662776-ebb3-4886-84d5-c189715cf483`. The matching `plan.json` identifies clip `voice_705043b8-7b9e-4594-b204-054bf2205bab`; `group-1-take-1-analysis.json` records `source_alignment` and `uncertain_word_alignment`. Its original WAV lasts 22.56 seconds. The source transcript exactly matches the example supplied by the user.

Stored word times are `暖` 6.22–6.70 seconds, `胃` 6.70–6.90 and `今天` 6.98–7.96. The initial read-only DSP inspection found actual quiet from 7.00 to 7.55 seconds, giving a 7.275-second candidate midpoint. The same search also produces an earlier 6.49-second candidate inside target speech, which cannot be accepted solely from silence. No new synthesis or ASR model run was needed for that initial diagnosis.

The subsequent real analysis completed successfully in 78.898 seconds, recorded in `I:/AI/asmr-director-ending-anchor/2026-09-24/real-analysis.json`. It selected source word index 13 with ending anchor `也喝一点暖胃`, verified both sides of the measured 7.00–7.55-second quiet interval (550 ms, threshold −54.2723 dBFS), and retained source range **0–7.11 seconds** after safe edge trimming. The final transcript is `来,面来了,慢点吃小心烫,汤也喝一点,暖胃`, with `bounded_edits`, similarity 0.888889, one substitution, one deletion and zero insertions. The retained tail contains 110 ms of quiet. Internal pauses remain the independently measured word gaps `[120, 180, 640, 60, 200]` ms.

This recording was extracted using the local ending-anchor path. It required no API judgment and no new TTS. The original 22.56-second recording remains available. Successful automatic extraction does not establish headphone-listening acceptance or prove whether ASR or the spoken performance caused a disputed character.

On October 1 the extracted result was saved as candidate `vox_8ea1c310dc5641f0ae1cee3b70824b8e`, duration 7.11 seconds, derived from `vox_d4766c98916e47b4ba1e1f9dc327f862`. `candidate-persistence.json` confirms the previous candidate is unchanged, no new TTS ran and the new candidate was not adopted. Source SHA-256 remains `1891dd45260888252fb4df29636eeeac5d70f8a7c4c6d3ca48b4e1259aa83f89`. The October 1 evidence directory also retains the pre-insertion manifest, new candidate metadata and cropped WAV.

The current browser project contains 15 units. Target unit 11 still has the same requested text, but following unit 12 has since been edited. The derived candidate deliberately preserves the original recording's generation fingerprint and context. Browser verification confirms it correctly appears stale/preview-only in the current project; reanalysis does not forge generation provenance or automatically adopt the recording against changed context.

## Verification status

On October 1, all **74 deterministic Python tests passed**, including the original 54 and 20 ending-anchor cases. They cover unusual punctuation and annotation words, the two-edit example, exact threshold/length/edit bounds, old comparison compatibility, adjacent and nonadjacent swaps, inserted repetition, immediate continuation, whole-word/deleted-ending/ambiguous mapping, competing endpoints, forged API hints, forced two-sided/final recognition and rejection when real quiet is absent. Tests do not load an ASR model or synthesize audio. Log: `I:/AI/asmr-director-ending-anchor/2026-10-01/python-tests.log`.

The final full TypeScript application suite passed **67 files / 734 tests**, with one existing opt-in test skipped. Full ESLint, TypeScript and the production build passed. Independent review also ensured that legitimate noise-adapted acoustic validation remains accepted and that an empty failed second API verification pass cannot overwrite the useful first-pass recognition checkpoint. API selection status is preserved in the result and displayed separately from verified extraction.

Production is running on port 3001, PID 19500, using `.next-semantic-build`. The previous service was not listening when this deployment began. The Webpack production build exited successfully; only its generated TypeScript include changes were restored after structural comparison, preserving existing source configuration. The new candidate list/API and audio asset returned HTTP 200.

After a production browser reload, all 15 script texts remained exactly equal to the pre-reload values. Selecting unit 11 and expanding candidate 1 shows the 7.11-second extracted range, 88.9% similarity against the 85% fallback threshold, `啦 → 了`, `儿 → 未识别`, and ending anchor `也喝一点暖胃`. Its stale warning correctly reflects the edited following context; it was not adopted. Spatial playback completed normally at 7.76 seconds (7.11-second clip plus the unchanged original-D 650 ms room tail), with media error `null` and ready state 4. There were no new console errors or warnings. At viewport 1768×1252 the document matched the viewport, and both upper panels spanned y=127..907.984375 with no outer-page overflow. Screenshot: `I:/AI/asmr-director-ending-anchor/2026-10-01/browser-proof.jpg`.

The implemented extraction, API fallback, preserved provenance, production UI and playback checks are complete for this request. No candidate was automatically adopted, no new TTS was generated, and no commit or push was performed. Listening quality and the interpretation of individual ASR differences remain the user's judgment.
