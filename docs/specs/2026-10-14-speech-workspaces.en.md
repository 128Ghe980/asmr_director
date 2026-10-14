# Independent short-sentence and paragraph speech workspaces

Date: 2026-10-14 (HKT). Parent route: **Audio Quality V1**, still in progress. This specification defines an implementation slice within the existing route; it does not create a new roadmap gate. [中文版本](2026-10-14-speech-workspaces.zh.md).

## Product contract

The editor offers **Short sentences** and **Paragraphs** as two independent workspaces. They share the script, but keep their generated results independently. Choosing a tab restores that workspace; navigation must not split, repartition, regenerate, discard, or adopt anything.

Adopting an AI creative draft initializes both workspaces together. An existing project without workspace metadata starts in the short workspace and keeps all existing adopted assets. Its new paragraph workspace starts with the same script IDs and blank generated results. The previous `clip` and `long_text` workflows remain available in the short workspace.

The short workspace displays and edits actual natural sentences. AI adoption first splits exact source text at sentence endings, semicolons and newlines, then initializes both banks with the same sentence IDs. Punctuation, quotes, whitespace and decimals are preserved; commas and character counts do not mechanically cut words. Paragraphs display these same sentences and use them as the native audio cutting targets. The initial grouping target is approximately **80 Chinese characters**, accumulating complete sentences. This is a provisional preference from the tested script/reference/engine combination, not a universal model limit. Tab navigation does not regroup.

Legacy projects retain their original text and results until the user chooses **Split into short sentences** when a multi-sentence unit is present. A complete revision protects both banks before splitting. Each bank keeps its own provisional source span and final wait; this never crops actual audio by text proportions. A whole old recording must not become the first shorter sentence's valid take. Split units start pending; original assets and candidate files remain in history and recordings. Ordinary word edits retain independent old takes with explicit staleness.

The timeline starts collapsed to its title bar. Its expand/collapse control releases editor space and retains the current choice across speech-tab navigation.

## Persistent state and active projection

`AsmrProject.speechWorkspace` is optional for compatibility and contains:

| Field | Contract |
| --- | --- |
| `version` | `1` |
| `activeMode` | `short` or `paragraph` |
| `short`, `paragraph` | Independent result banks |
| `groups` | Ordered `{ id, clipIds }` paragraph definitions |

Each bank retains its voice clips, duration, supporting tracks, emotion curve, mixing settings, optional video plan, exports, and optional mix fingerprint. The top-level timeline, video plan and exports represent the active bank. Capture the current bank before switching, saving, or projecting another bank for a background operation.

Paragraph grouping uses workspace `groups` and the current projected timeline. It does not use `speech_group_id`, destructive `prepareParagraphGroups`, or a global generation-mode switch. Duplicate, missing or silent members cannot establish a valid generation context.

Voice settings use separate short and paragraph preferences. Choosing a reference or finishing an asynchronous reference import updates the workspace where the action began. Short settings must not be replaced with paragraph settings. Runtime jobs, candidates and request controllers remain outside the persistent project JSON.

## Shared source and independent results

Source edits synchronize text, delivery metadata, speech/silent kind, source ordering, insertions and deletions between the two banks. Results remain associated with their own workspace. Word edits that preserve sentence boundaries retain existing audio with `audio_stale`. Structural splitting or merging protects old complete recordings in revisions instead of using them as valid new sentence takes.

A short-sentence source change invalidates that short take and the affected paragraph take. Other short takes and other paragraphs retain their results. Shared spoken-order or paragraph-member changes must invalidate affected paragraph identities. Inserting a silent shot can retain existing speech audio when the spoken content and order remain unchanged; timing and mix validity must still be recalculated.

Source undo restores shared source while retaining the latest result snapshots in both banks. It must not restore an old inactive-bank snapshot over a later adopted take. Deleted source IDs may recover their own workspace's historical assets; changed surviving sources retain current assets with the appropriate staleness marker. Candidate-adoption undo is also workspace-specific and must preserve the other workspace.

Playback, adopted previews, waveform analysis, downloads, mix results and storyboard audio bindings use the active bank. Returning to the other tab restores that bank's own results. An old exported mix can remain available for comparison while its fingerprint indicates that it needs regeneration.

## Paragraph generation and strict splitting

The paragraph request uses `generationMode: "paragraph"`. If workspace metadata is present, the request must project the paragraph workspace. The server joins the saved members' original text and generates **A exactly once**. It does not add following text B/C, neutral padding, or additional native quality retries.

The current paragraph input contract allows at most 500 UTF-16 code units and 32 target units, checked before TTS. The strict splitter accepts native 48 kHz, mono PCM16 WAVs up to 120 seconds; these are implementation bounds, separate from the provisional 80-character grouping preference.

The paragraph recipe uses the selected fixed reference, natural reference text when reference-text mode is selected, and `maxSteps: 800`. Native CFG 2, temperature 1, timesteps 10, GPU layers 0 and low-VRAM settings follow the verified recipe. `ASMR_VOXCPM2_PARAGRAPH_CLI_PATH` may select the corrected decoder exclusively for this workflow. Reference-text mode remains subject to the chosen reference's available transcript.

The existing `clip` and `long_text` branches keep the profile executable, normalized reference-text handling, adaptive step limit capped at 600, and their established generation behavior. The new mode must not replace those branches or change their native arguments.

Publish the complete native WAV before analysis. For each successive short unit, the offline verifier compares the opening target with all remaining supplied text. Every non-final boundary requires the existing strict independent left/right recognition and measured quiet interval, enforced with `requireTwoSided: true`; paragraph analysis does not invoke the optional semantic API fallback. Existing text, timestamp and quiet thresholds are not relaxed.

Paragraph analysis additionally opts into `allowShortSentenceParticle`: only 3–9 Han characters, at least two exactly matching prefix characters, one final neutral 啦/了 difference and an explicit natural sentence ending. Dedicated `sentence_particle` evidence preserves the actual literal score (2/3 for a three-character target) without inventing a 95% pronunciation score or lowering global thresholds for other differences. Endpoints must remain complete ASR words with strict immediate following text. Non-final cuts retain real quiet and independent left/right checks; the final remainder must match the complete source and independent final recognition. Existing `clip / long_text` requests do not opt into this short-source rule; long-sentence phonetic rules remain unchanged.

If independent left recognition omits only the final neutral 啦/了 while all other literal and word-level text matches, the verifier may safely trim quiet edges of that same cut's analysis input for one additional ASR call across the boundary search. Skip when no safe trim is available. The retry must recognize the complete target and still pass right-side and final checks; deletion is never accepted. Original PCM, cut position and ASR parameters remain unchanged.

Paragraph comparisons show each sentence's evidence. The first source transcript is the full paragraph; later ones describe the remaining original audio. Never rewrite a per-sentence expected target as the whole paragraph. Failure records retain the sentence ID, recognition checkpoint and diagnostic; historical failure traces remain readable in original-recording listings. Paragraph recheck uses only the exact full source asset bound by the saved candidate and adds a new checked candidate without TTS, overwriting old candidates or automatic adoption. Validate format/duration, project/workspace/full ordered source, capacity and source candidate status before publication, and repeat the source-candidate check inside the manifest lock. Publish all verified sentence cuts atomically.

The split helper uses analysis as evidence and slices the **original PCM bytes**. It does not use the verifier's trimmed/faded excerpt as an output asset. Slices form one continuous partition from frame zero to the original final frame, retaining all natural pauses and both outer edges. There is no gain normalization, speed/pitch adjustment, crossfade, or added audio silence.

Only after every target and boundary passes may short assets and sibling candidates be published. Candidate publication is one atomic manifest revision. Each sibling records the same group, full text, complete source asset and ordered segment assets/ranges. If analysis cannot confirm every cut, retain the complete source, publish no partial short cuts, and prevent adoption of that complete source as a short unit.

## Candidate and asynchronous-operation scopes

`candidate.provenance.generationMode` distinguishes the result bank: `paragraph` belongs to the paragraph bank; `clip` and `long_text` belong to the short bank. Identical source clip IDs can coexist in both banks.

The 12-unadopted-candidate capacity applies separately per project, clip and workspace. Candidate and complete-recording listings accept `workspaceMode`; recording pagination cursors also include that scope. Rejecting a paragraph take atomically discards all siblings matching its project, group and complete source asset, while keeping every WAV and all short-workspace candidates.

Paragraph source fingerprints cover the entire ordered group, including each member's text and delivery fields. A sibling edit makes every candidate from that paragraph stale. Adoption validates fresh server status and current source identity, commits all verified sibling assets in one workspace revision, and leaves the other bank unchanged.

Background generation, mix and storyboard work capture their originating workspace. On completion, project that bank, verify its current source or mix fingerprint, then merge only its results into the latest project. Navigation during a pending candidate-status request must not redirect adoption into the newly visible bank. Project/session changes and source edits retain their existing stale-response guards. Reference imports retain their origin mode; switching modes cancels a pending candidate recheck.

## Silent shots

A script slot with `kind: "silent"` represents a shot without dialogue. It has editable visual description and duration and retains storyboard generation. It requires no voice asset, never enters TTS or paragraph membership, and is excluded from voice-candidate and adopted-speech download requirements. A silent slot separates paragraph runs. Source insertion and duration changes synchronize to both views while each bank retains its own visual results.

## Verification and natural source boundaries

The successful existing-WAV probe split a 21.92-second, approximately 80-character normal-reference recording into four target units, with exact text matches and all three boundaries verified from both sides. Reassembled original PCM matched the source PCM SHA. The test made zero TTS calls. The preserved evidence is `I:/AI/asmr-director-feature-qa/2026-10-13-paragraph-shots/split-real-report3.json`; the earlier failed attempts remain alongside it.

The earlier 2026-10-14 workspace source audit confirmed six byte-identical engine/analysis files against that successful probe, recorded in `I:/AI/asmr-director-dual-workspace/2026-10-14/paragraph-engine-source-audit.json`. **That is a historical snapshot.** The later short-particle fix changes the Python verifier, TS adapter and splitter evidence handling; that audit cannot establish a successful real test of the new rule. Native provider, profile and runtime configuration remain unchanged. The new 15.36-second real recording still fails because independent first-sentence ASR omits its final particle; see the current [recognition record](../records/2026-10-14-paragraph-recognition-and-particle-alignment.md) for evidence and limits.

**Natural source-boundary mapping is implemented.** A local word edit retains an actual single sentence's ID and boundary; an edited legacy multi-sentence unit becomes real short units. Copy synchronizes immediately in either page. The short page commits newly inserted sentence boundaries when that field loses focus, avoiding focus changes during typing; paragraph editing directly maps the affected region at natural endings. Exact punctuation, quotes and whitespace are retained. Existing IDs are reused in order and a shorter rewrite merges units without cutting a word. Replacing “先坐一会儿。我给你倒茶。” with “雨停了。” therefore produces one short unit.

When a rewritten group exceeds 32 members or the 500-character generation limit, complete units are partitioned into additional groups within that affected group, including when the source IDs remain unchanged. Other groups retain membership. Individual sentences are not split merely to fit a character cap, and generation still checks hard limits. Word edits retain surviving assets with source-stale markers; structural cuts protect incompatible whole takes in revisions and reset only affected sentence results. Structural undo recovers the historical source span and final wait in both banks while retaining later independent takes. The implementation is [speech-workspace.ts](../../apps/web/src/lib/asmr/speech-workspace.ts), with source-sync, bounded-group and undo evidence in [speech-workspace.test.ts](../../apps/web/src/lib/asmr/speech-workspace.test.ts) and [short-sentence regressions](../../apps/web/src/lib/asmr/speech-workspace.short-sentences.test.ts).

Final whole-suite, build, browser screenshots and deployment status belong in the development record. They must not be inferred from this contract or the historical audio probe.
