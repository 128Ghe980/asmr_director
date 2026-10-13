# Conservative pronunciation tolerance for cropped voice recognition

Date: 2026-10-07. [中文版](2026-10-07-voice-recognition-phonetic-tolerance.zh.md).

This extends Audio Quality V1's existing voice-extraction checks. It creates no new roadmap stage and leaves the paused SFX work unchanged. It supplements the [bounded text rule](2026-09-23-tolerant-voice-extraction.md) and uses the existing [candidate recheck](2026-10-07-candidate-recognition-recheck.md) workflow.

## Problem and scope

The target `来~~，面来啦！汤也喝一点，暖胃。` normalizes to eleven characters. The original ASR prefix `来,面来了,汤也喝一点,暖胃。` has one substitution and passes the existing 90% rule. The cropped ASR `来,面来了,糖也喝一点,暖胃` has two substitutions and scores 81.8182%, so it fails that rule even though the differences can plausibly be recognition errors.

Add a local, bounded pinyin fallback for independently checked target crops. This is **crop-only**: pinyin does not find the original source endpoint or authorize scanning for a later matching sentence. Keep the ordinary 90% positional-substitution path and the existing evidence-gated 85% bounded-edit path unchanged. Try those paths first; enable the new mode only after they fail. An eligible original target prefix must already pass the old 90% comparison, end at a whole ASR word, and agree between the full-source transcript and the joined source-word prefix.

## Text and pronunciation contract

Keep existing Python normalization: traditional-to-simplified Chinese, punctuation/spacing removal, lowercase and `地`/`得` to `的`. Tildes and Chinese/English punctuation do not count as spoken characters. Let `N` be the normalized target length. The target and recognized crop must have the same length, `N >= 10`, with one or two substitutions at the same ordered positions. Do not permit insertion, deletion, shifted alignment, swaps, newly repeated phrases, or three differences. Changed characters must be single Han characters; changed numerals and negation characters are protected. Near initials or finals are not accepted.

Use whole-text `pypinyin` tone-number output and allow only these rules:

| Rule | Evidence | Cost |
| --- | --- | --- |
| `same_tone` | Identical syllable and tone | 0 |
| `source_supported_tone` | Same syllable with a different tone; the corresponding original source character equals the requested character | 0.25 |
| `sentence_particle` | Only neutral `啦 (la5)` ↔ `了 (le5)` at an actual requested clause end | 0.25 |

Permit at most one `source_supported_tone` difference. Its source character must be traceable to the complete normalized `sourcePrefix` at that same index. A clause-final `了` pronounced `liao3` is not this particle rule.

Require `phoneticSimilarity = 1 - sum(cost) / N >= 0.95`, using integer quarter-cost comparisons to avoid threshold rounding. This is a **weighted text/pinyin rule score**, not an acoustic measurement, confidence probability, or proof of semantic correctness. Same-tone homophones may have different meanings; the user still needs to listen.

For the eleven-character example, `啦 → 了` is a clause-final particle difference and `汤 (tang1) → 糖 (tang2)` has support from the original source's `汤`. Literal similarity stays `0.818182`; the pinyin score is `1 - 0.5 / 11 = 0.954545`.

## Acoustic and completeness requirements

Every successful pinyin fallback requires an existing `cutValidation` from an actual nearby quiet interval of at least 160 ms, with at least 80 ms on each side of the chosen cut. Retain noise-floor limits, source-duration bounds, timestamp validation and the bounded candidate search. Character count or pinyin cannot supply a missing acoustic boundary.

Independently recognize the target side, the following side, and the final processed crop. On the target side and final crop, full-segment text must agree exactly with the joined word transcript after normalization. The following side still needs strict onset/content alignment. If an exact original prefix first reveals a pinyin difference after the fast crop, repeat the existing two-sided check before publishing the final crop. A pinyin result without real cut validation cannot be published.

Clauses must cover the whole requested target, and clause boundaries must map to whole ASR-word ends. Retain measured internal pauses and existing edge processing. Pinyin cannot create an internal boundary inside one word. Do not enable this fallback without following speech or through the leading-`嗯` continuation bridge; that bridge's target remains exact.

## Result, interface and compatibility

The new comparison has `mode: phonetic_substitutions` and `status: different`. Retain actual literal `similarity`, `threshold: 0.9`, `substitutionCount`, normalized `expected` and `recognized`; add `phoneticSimilarity`, `phoneticThreshold: 0.95`, `sourcePrefix`, and ordered differences containing character indices, characters, tone-number pinyin and the rule. Only a particle difference carries `clauseEnd: true`; only a supported tone difference carries `sourceCharacter`.

Python recomputes public scores and source-prefix provenance. TypeScript validates lengths, ordered differences, costs, source-character evidence, original source-word/full-transcript agreement, target transcript, request clause ends, completed recognition and the actual quiet cut. It accepts literal coverage below 90% only with these additional safeguards, down to the mathematically possible 80% floor. Ordinary rules retain their previous limits. TypeScript does not reproduce Python's full OpenCC conversion; if traditional/simplified normalization cannot be reconciled with the original evidence, conservatively reject the new mode instead of weakening provenance checks.

The interface shows both literal similarity and the pinyin tolerance score, lists the evidence and says `已截取目标片段；拼音容错通过，请试听。` Preserve the listening warning and manual Adopt action. Do not automatically adopt or replace an existing candidate. Users can click **重新识别** on a supported existing candidate to analyze its saved complete source under the new rules; append a new result while retaining the old candidate, source recording and lineage. No TTS retry is triggered by this rule.

`pypinyin` is optional. If unavailable, or if dictionary lookup fails, keep ordinary comparison and the existing conservative rejection/full-source-review behavior. Missing pinyin must not disable the ASR worker. Older metadata remains valid without the new fields.

## Verification snapshot and embedding alternative

Evidence root: `I:/AI/asmr-director-phonetic-review/2026-10-07`.

| Verification | Recorded evidence |
| --- | --- |
| Python deterministic tests | `python-implementation-tests-final.log`: 110/110, including 18 new test methods; staged ASR replies are mocks and no model is loaded |
| TypeScript/UI regression | `phonetic-tests.log`: 6 files, 172/172; schema, analysis and rendering tests use fixtures/mocks |
| Python source hashes and scope | `python-implementation-final.json` |

Negative cases cover missing/unsupported source evidence, multiple tone changes, non-final particles, `liao3`, protected numerals/negations, near sounds, insertion/deletion/moves/repetition, missing quiet, wrong continuation, word/segment disagreement, unresolved clause boundaries, optional dictionary failures, tampered metadata and the exact `嗯` bridge. The staged current-example test requires two-sided and final recognition while retaining literal 81.8% coverage. This snapshot does **not** establish actual saved-recording ASR success, production-build success or user listening acceptance for the new mode.

Subsequent deployment verification is recorded in the [development record](../../records/2026-10-07-audio-quality-v1-phonetic-recognition.md): final compatibility tests, independent contract review, lint and production build pass; original3001 browser data is preserved. Actual ASR still has not run because the available committed-memory guard failed. Keep the deterministic score and real-recording acceptance separate.

The separate embedding preparation did not complete inference. The official `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` uint8 AVX2 ONNX download reached its 300-second chunk-checked budget; the retained partial artifact was not loaded. A final blocked read may exceed that budget by up to the 30-second socket timeout; no exact external wall-clock receipt was captured. All prepared-case cosine values remain null, with no measured threshold or accuracy claim. No embedding or Flash API integration was added. See `embedding/embedding-attempt-verification.json` and `embedding/README.zh.md` for the unsuccessful attempt; handwritten text fixtures and character scores are not embedding results.
