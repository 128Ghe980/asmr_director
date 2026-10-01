# Semantic speech units and a viewport-sized workspace

Date: 2026-09-20. This corrects the existing Planner, editor and long-text workflow; it introduces no numbered roadmap stage and does not complete Audio Quality V1.

## User decision

Generate semantic short units with the initial script and show the same units in Planner and engineering. Editing controls appear on selection. VoxCPM2 continues to generate a longer input and extract its opening, moving the context window with the selected unit. Both editing panels align and the timeline stays inside the viewport; scrolling belongs to individual panels.

## Data and generation

- Retain existing sections and voice clips. New drafts use `segmentation: semantic`; each section is a continuous semantic unit and compiles to a voice clip with `semantic_unit: true`. The generation protocol uses `groups[].units` to share direction metadata, with only text and pause class on each unit, then expands losslessly into sections. This avoids spending the output budget on repeated metadata. The writing model supplies the boundaries in its initial response instead of requiring another model request for every unit.
- Keep an action or unfinished thought together, normally using 2–3 clauses separated by comma or sentence boundaries, up to 4 for one action. Do not treat 2–3 compound sentences as short units. Oversized model output has a character-preserving local splitting fallback. Legacy drafts can be explicitly converted; loading a saved project never automatically splits its existing audio.
- New units reuse the established long-text pause defaults (0.18/0.35/0.6 seconds), with exact-second overrides. Unmarked legacy drafts preserve their old planning waits. Adopting actual speech duration retains the user's explicit `pause_after`.
- Derive each window from the project's current voice order: target first, actual following speech within the window next, then the accepted neutral continuation padding when needed. Target and context together contain at most 16 clauses; the native 500-character limit is a separate safety ceiling, not a window to fill. Following clips provide context only; this request does not generate or replace their assets. Only the actual final unit gets an independent natural ending.
- Unmarked legacy clips retain their internal grouped generation. Manual splits and insertions create semantic units; merging retains the user's chosen boundary.
- Long-text source/request fingerprints include the effective context. Editing that context cancels its in-flight generation and prevents stale candidate adoption. Text beyond the effective window does not affect the candidate. Ordinary clip mode keeps its previous validation.
- Preserve accepted original-D rendering, complete original playback/download, advisory checks, one generation per group and no quality-triggered retries.

## Interface

Planner combines compact writing settings with a continuous script. Unselected units show text and a light index; selected units expose rewriting, splitting/merging, insertion/deletion and optional direction fields. Engineering follows the same reading and selection pattern.

The workspace fits `100dvh`: header and view navigation take their natural height; the remainder contains the upper editing panels and lower timeline. Both panels share one grid row and scroll independently. The timeline has its own scroll area. Narrow screens use script/sound tabs and overlay drawers to preserve usable space without growing the page.

## Verification

- Automated checks: 64 Vitest files / 652 tests passed, with one existing opt-in file/test skipped; full ESLint, TypeScript and the final Webpack production build passed. The final suite used 4 workers and a 15-second case timeout to accommodate filesystem latency during heavy concurrent local builds; assertions were unchanged. The existing Windows native SWC warning uses the WASM fallback.
- Real initial DeepSeek generation produced 深夜温水, 149 characters / 9 units. Adoption created 9 voice clips with exactly the same text sequence, retained after reload. Only one selected unit exposed rewrite controls; selecting VoxCPM2 defaulted to long-text mode. All mutating browser checks used the isolated 3002 origin.
- At 1280×720 the document measured exactly 1280×720. Both panels shared y=127..533.328125; the timeline occupied y=541.328125..682. Checks at 1024×600 and 390×844 also had no page overflow. Mobile script/sound switching, overlay settings, Escape dismissal and focus restoration passed. Browser error/warn arrays were empty.
- Real VoxCPM2 generated each of two targets once. The nonfinal target included actual following speech and 12 established neutral fillers; alignment returned `uncertain_word_alignment`, retaining its complete 37.28-second original for review. The final target had no padding, passed checking and produced 1.69 seconds. Both candidate and original URLs returned HTTP 200, with no automatic retries. This validates windows and delivery, not new headphone acceptance.
- Production runs on port 3001 / PID 6168 with `ASMR_NEXT_DIST_DIR=.next-semantic-build`, HTTP 200. Old PID 19292 and temporary port 3002 are stopped. `.env.local` still names an older build directory, so explicitly set the new directory when restarting. Its cache junction targets `I:/AI/asmr-director-build-cache/semantic-workspace`. A read-only production check confirmed the user's original six-unit 深夜回家，小安陪你吃碗热汤面 project text remains intact.

Logs, real-model results and the structured `verification.json` are in `I:/AI/asmr-director-semantic-workspace/2026-09-20`. Changes remain in the shared working tree; no commit or push was requested.

## 2026-09-21 historical-recipe clarification

The 16-clause maximum described above is a new stability limit for marked semantic sliding windows, introduced after the native failure below. In the accepted historical recipe, 16 was a minimum-context padding baseline: append neutral clauses when the remaining source has fewer than 16; it was not a maximum on the source. The Sept 14 accepted first-group input contained 22 clauses. Therefore the new bounded window must not be described as an unchanged historical recipe or a demonstrated sound-quality optimum. Legacy unmarked grouped input retains the historical behavior. Chinese ellipses for nonfinal clauses and a natural ending for the true final unit are historical rules. See [recognition investigation](2026-09-21-voice-recognition-inspection.md) for original metadata, real ASR and pause evidence.

## 2026-09-21 first-unit generation failure correction

The user reported a generic VoxCPM2 failure on the first short unit. Two incident records and a native reproduction with the same input confirmed that the previous window only enforced 500 characters, producing 69 clauses / 499 characters. Final AudioVAE decoding hit `GGML_ASSERT(grid_y < USHRT_MAX)`, exit code 3221226505 after 53.935 seconds, without a WAV. This was not ASR withholding audio.

Introduce and enforce a 16-clause maximum for semantic windows in both the context snapshot and final input; text beyond it does not enter candidate fingerprints. This is the new stability constraint clarified above. Never truncate target speech, and retain actual-final-unit and unmarked legacy behavior. Failed native runs additionally retain bounded stdout/stderr tails, exit code, signal and spawn error in the voice-work root's `diagnostics` directory, surviving temporary cleanup. The UI receives safe capacity/memory/disk classifications, never raw logs or paths. New evidence root: `I:/AI/asmr-director-generation-failure/2026-09-21`.

After correction, 64 files / 663 tests, full ESLint, TypeScript, production build and diff check passed. Production runs on 3001 / PID 20008 / `.next-semantic-build`. A single UI generation of the user's original first unit used 2 target + 14 following clauses / 122 characters, completed TTS in 33.679 seconds and the workflow in 70.387 seconds, and returned a 23.36-second candidate and original. Native generation no longer failed; `uncertain_word_alignment` still requires review, so the result retains the complete original rather than claiming successful first-unit extraction. Candidate, original and original-D spatial preview returned HTTP 200. Browser playback advanced to 17.31 seconds without a media error, and reopening retained all 11 text units and the candidate. The original browser tab crashed during UI verification; a new same-origin tab restored the saved project and completed playback without clearing storage. No candidate adoption, zero automatic retries, and the generation lock was released. See `verification.json` in the evidence directory.
