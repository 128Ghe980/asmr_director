# Candidate recognition recheck

Date: 2026-10-07

Add **重新识别** beside Adopt/Discard on voice candidates. Recheck a candidate's saved full original recordings with the current offline ASR and extraction rules. Do not call TTS, change voice settings/seeds, or automatically adopt the result.

Supported candidates must have a long-text plan and exact saved-original provenance. The server validates candidate ownership, ready status and current text/context fingerprint; stale candidates or missing/ambiguous originals fail without replacing history. Resolve each group by its recorded asset and matching trace result, including reused groups from an earlier reroll. Never select a later recording merely because its text matches, and never substitute a cropped group asset for its full source.

POST `/api/audio-candidates/[candidateId]/recheck` accepts `{project, clipId}` and returns `{candidate}`. Use the shared native runtime gate and bounded, cancellable serial ASR. Reassemble checked groups with the existing pause and loudness rules. Save a new candidate and trace, preserving original lineage for repeated rechecks; recalculate recognition warnings while retaining unrelated generation warnings. An uncertain extraction may retain full source for review, following the existing analysis contract. Fatal errors, cancellation and timeout must leave existing candidates and the project unchanged.

The UI shows progress and cancellation, blocks conflicting generation/reference work, aborts on project/clip switch or unmount, and ignores late results. Only the new candidate is appended to history; the user chooses whether to adopt it. Unsupported/stale candidates explain why recheck is disabled.

Verification covers request ownership/freshness, exact original mapping, repeated recheck, no TTS, cancellation/failure retention and UI switch races. Build and browser verification include one actual recheck of the user's saved original, old-record preservation and compact action-row layout. This remains inside Audio Quality V1; SFX stays paused.

Delivered and verified:136 targeted tests, full TypeScript, related ESLint and production build; actual UI cancel and successful5.05s/100% recheck, reload and390px compact layout. See the [delivery record](../../records/2026-10-07-audio-quality-v1-candidate-recheck.md) for receipts and retained-history limits.
