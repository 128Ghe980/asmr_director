# Voice recognition inspection and generation provenance

Date: 2026-09-21. This documents an existing voice-generation correction and investigation, not a new roadmap stage or a new listening-quality acceptance. [中文版](2026-09-21-voice-recognition-inspection.zh.md).

## Intent and delivery

The user needs to inspect what ASR heard and why a selected short unit was not extracted, while still hearing and downloading every complete original. Recognition is advisory evidence. It must not suppress an original, trigger another generation, or silently relax text and safe-cut checks.

Both the candidate and original-recording views provide a collapsed “识别对照” disclosure. It distinguishes the requested target, recognition of the complete generation window, and recognition after an attempted crop. A complete window can contain later script units and neutral continuation padding; it is not a transcript of the target alone. A failed extraction explicitly reports that the complete original is retained. A checked extraction identifies its retained time range. The original-recording view always describes its playback/download as the full original, even when target extraction succeeded elsewhere.

The disclosure shows the check stage and, where available, the normalized expected text and actual accumulated ASR prefix used by alignment. Missing historical evidence is labeled as missing; it is not reconstructed from the target text or treated as a successful check. Text areas scroll inside the disclosure instead of expanding the workspace indefinitely.

## Recognition contract and persistence

An optional `recognition` object accompanies analysis success/failure, grouped candidate results and original-recording metadata. Existing records without this field remain compatible. It contains only bounded text and timestamps, never native logs, local paths or raw exception messages.

- Required: `stage`, `sourceTranscript` (up to 8,000 UTF-16 code units), `expectedText` (500).
- Optional: `sourceWords` (up to 2,000 entries; text up to 200, finite start/end from 0 through 120.1 seconds with end ≥ start), `targetTranscript` (8,000), `followingText` (1,500).
- Optional alignment evidence: normalized `expected` (1,500), the actually accumulated `recognizedPrefix` (2,000), and a bounded lowercase/underscore `reason`.
- Stages: input validation, source transcription, source alignment, continuation alignment, boundary check, target transcription, target validation, complete, unavailable. Stage describes how far recognition/checking progressed; `complete` alone does not prove later file publication succeeded.

The Python helper publishes an atomic `analysis_incomplete` JSON checkpoint immediately after source recognition and updates it as stages or target recognition become available. Child-process and reusable-worker error paths can retain that bounded checkpoint on timeout or interruption instead of losing completed ASR with temporary-directory cleanup. Final success/failure replaces the checkpoint. The backend validates the schema and target/context identity before attaching evidence to the appropriate recording/candidate, and persistence carries it through reload. Candidate-specific alignment evidence must not leak from a rejected cut into a later cut's result.

Generic failures use safe diagnostic codes. Recognition cannot replace the final check result or authorize a crop. Exact text anchors, content matching, independent cropped ASR, and measured quiet protection remain unchanged, including rejection of the observed `啦`/`了` discrepancy.

## Real investigation

Evidence root: `I:/AI/asmr-director-recognition-inspection/2026-09-21`. The investigation reused existing WAVs and ran offline CPU/int8 faster-whisper large-v3; it did not synthesize replacements or adopt a diagnostic crop.

The current original is `I:/AI/asmr-director-voice-work/long-text/57dfefdd-1e15-4f1f-b663-067919bb3a96/group-1-take-1-source.wav`, duration 23.36 seconds. The requested target is `回来啦？外面是不是很冷？`, followed by `快进来，`.

- `real-integration.json` records `uncertain_word_alignment` at `source_alignment`. ASR starts with `回来了` rather than `回来啦`; the strict opening anchor fails before quiet-boundary selection. Its preserved recognized prefix includes the actual additional words examined while looking for a match.
- `boundary-acoustics.json` records ASR word end 2.30 seconds and next-word start 2.40 seconds: a 100 ms timestamp gap. Separately, measured waveform quiet spans 2.37–2.63 seconds, totaling 260 ms, with a candidate midpoint at 2.50 seconds. The timestamp gap is not a measurement of physical silence, and the original failure does not establish that no quiet boundary exists.
- `boundary-probe.json` independently recognizes the 0–2.50-second left probe as `回来了外面是不是很冷`, still failing strict target validation. The 2.50–3.65-second right probe recognizes `快进来` and passes. Thus bypassing the first alignment failure would not make this candidate satisfy the unchanged independent crop check. No probe was adopted, and no phonetic-equivalence rule was introduced.

`comparison.json` records a rough transcript-character / full-file-duration comparison:

| Existing recording | Normalized ASR characters | Duration | Characters/second |
| --- | ---: | ---: | ---: |
| Current full continuation window | 89 | 23.36 s | 3.81 |
| Sept 14 accepted colloquial dry voice | 136 | 34.54 s | 3.94 |
| Sept 4 accepted soft dry voice | 150 | 34.75 s | 4.32 |

These are different texts and scopes: the current file retains continuation speech; the accepted files assemble selected target groups with intentional joins. ASR substitutions also affect the count. These values neither establish an audible speedup nor disprove the user's perception of faster delivery. Phrase rhythm, pause distribution and candidate choice require listening; this is not a controlled same-text speed experiment.

## Parameter and historical-recipe clarification

The current run's source metadata and Sept 14 `source_tts.json` confirm identical fixed settings: Combined reference mode, soft Chinese reference, CFG 2, timesteps 10, temperature 1, GPU layers 0 and low-VRAM mode. Their CLI SHA-256 is identical (`ecb34b72…`). Rehashing the unchanged reference WAV plus the Sept 14 normalized reference transcript yields the current joint reference identity (`2390b032…`). Model file names, sizes and modification times agree; this check did not freshly hash both model files.

The actual differences include text, random seed, context length and candidate selection. Current seed is 1836054406; its maximum steps are 600 and generated steps 146. Sept 14 selected groups from multiple attempts, with a 22-clause initial input for its first accepted group. The current semantic window contains 2 target plus 14 following clauses. The older Sept 4 example also includes a manually selected replacement group, so it is not evidence that every first take produces the accepted effect.

`pace=slow` and the director's style/emotion fields are not separate VoxCPM2 CLI speed controls. The provider passes no pace argument. Accepted dry-voice assembly inserts only the required group-join silence and applies whole-result loudness adjustment; the reviewed spatial-render preparation does not time-stretch the voice. There is no supported claim that a hidden slow-down factor was removed.

Chinese ellipsis conversion is part of the historical accepted input strategy: nonfinal clauses lose trailing punctuation and each receives `……`; the true final unit retains natural ending punctuation without continuation padding. Ellipses influence the model's context, not a guaranteed silence duration per clause.

**Correction to the previous semantic-workspace wording:** historically, 16 was the baseline used to add neutral padding when remaining source clauses were fewer than 16. It was not a maximum on source clauses. The Sept 14 22-clause input directly demonstrates this. The new maximum of 16 target-plus-following clauses applies to marked semantic sliding windows as a stability correction after the 69-clause / 499-character AudioVAE `grid_y < USHRT_MAX` crash. It is a new implementation constraint, not an unchanged historical recipe or a demonstrated optimum for sound quality. Legacy unmarked grouped input retains its established behavior, and target text is never silently truncated. The external September 20 recipe remains a historical record with a dated version note linking this clarification.

## Verification status

Implementation evidence covers schema/persistence, successful and failed diagnostics, source checkpoints, process/worker interruption, folded UI, legacy records and unchanged strict matching/cut rules. Real ASR and boundary probes above are available.

- Final TypeScript suite: 64 files / 677 tests passed, with one existing opt-in file/test skipped. The initial concurrent run hit the existing 5-second timeout in the 200-record pagination test; the final run used 4 workers / a 15-second timeout and passed without assertion changes. Full ESLint, TypeScript and the production build passed. Evidence: `tests-final.log`, `lint-final.log`, `typecheck-final.log`, `build.log`; combined verification is recorded in `verification.json`.
- The existing candidate and original-recording metadata were backfilled only with the real recognition evidence. `metadata-backup/` retains the previous metadata; `metadata-backfill.json` records candidate `vox_f33328cbe274426286a088606b03592b` and unchanged source-audio SHA-256 `0e389037d755a1cd82ba0b9f86bd4a382342e65c3256024f4211ac1f10b095f5`. `http-verification.json` confirms that both APIs expose `source_alignment` and the actual ASR text. No replacement audio was generated or adopted.
- Production was rebuilt and restarted on port 3001 / PID 29948 / `.next-semantic-build`. After browser refresh, all 11 script units remained character-for-character unchanged. Candidate and original-recording disclosures were collapsed initially and showed the correct recognition evidence when expanded. At 1877×1280 there was no page overflow; both upper panels spanned y=127..927.703125. Browser console errors/warnings were empty. The UI check did not generate or adopt a candidate.

All 38 Python mock tests passed, including rejected-cut evidence clearing before a later cut's ASR, successful cut or final target-validation failure. Strict matching and cut conditions are unchanged. This technical verification does not convert the failed current extraction into a pass or assert new headphone-listening acceptance.
