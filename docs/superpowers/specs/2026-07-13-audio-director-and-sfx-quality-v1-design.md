# Audio Director and Real ASMR SFX Quality V1 Design

Date: 2026-07-13

Status: The design was approved section by section in conversation and is awaiting review of this written version. Implementation has not started.

## 1. Top-Level Decision

The next phase will stop expanding the workbench shell and directly address poor generated-audio quality through two product tracks:

1. Make director actions produce real audible changes instead of only editing JSON, volume, or basic pan.
2. Expand the range and quality of ASMR sound effects beyond the current limited procedural noise renderer.

The approved source strategy is a free hybrid:

- clearly licensed free sound assets;
- free local AI sound generation;
- the existing procedural renderer as a clearly labeled basic candidate and fallback;
- paid APIs, paid libraries, and user recording are deferred.

## 2. Current Problem

- `Softer` mostly changes style metadata and reduces gain; it does not produce a genuinely softer performance.
- `Closer`, `farther`, and left/right positioning mostly use gain and pan, without convincing near-ear, front/back, or vertical perception.
- `Pause` appends a text marker instead of creating a controlled natural pause.
- Breath, rubbing, tapping, and ambience have limited variety, and the procedural renderer cannot cover the real materials and actions from the original design.
- Users cannot easily compare the original, multiple candidates, and different sources, then explicitly accept or undo a result.

This phase is complete only when the result is audibly different, not merely when a WAV file was created.

## 3. Goals

- Deliver audible, comparable, and reversible performance and spatial director actions.
- Apply the same spatial actions to voice, breath, rubbing, tapping, and other SFX.
- Support a full horizontal orbit, two full vertical orbits, and left/right-side motion.
- Support forward/reverse direction, duration, and cycle count for every orbit. Speed is derived from cycle count and duration.
- Use a default spatial-hearing profile immediately; users only try alternatives if front/back or vertical perception feels inaccurate.
- Cover eight common ASMR sound categories.
- Compare free-library, local-AI, and procedural candidates directly.
- Preserve the original sound and allow restoration after accepting a new result.

## 4. Non-Goals

- Paid sound or voice APIs.
- Paid sound libraries.
- Requiring users to record audio.
- A training platform, dataset-cleaning platform, or model marketplace.
- A full DAW.
- Cloud accounts, billing, collaboration, or publishing.
- Integrating many models without listening acceptance.

## 5. User Workflow

1. Select a voice or SFX clip.
2. Choose a performance action, a spatial action, or a new SFX source.
3. Generate one or more candidates without overwriting the current sound.
4. Switch directly between the original and candidates, including free-library, local-AI, and procedural versions.
5. Accept one candidate or discard it and keep the original.
6. Regenerate the project mix after accepting a result.

Every candidate shows its source and execution type, such as `Free asset`, `Local AI`, `Basic synthesis`, `Voice regeneration`, or `Spatial processing`.

## 6. Director Actions

### 6.1 Voice Performance Actions

#### Softer

- Produce a genuinely lighter, softer, more whisper-like performance.
- Generate multiple candidates through a local voice model.
- Gain reduction alone does not satisfy the action and must not be presented as `Softer`.
- GPT-SoVITS remains the baseline. If it cannot produce a reliable audible difference, it is treated as not supporting this action.

#### Pause

- Let the user select the pause position and duration inside a sentence.
- Regenerate only the affected sentence or phrase.
- Persist the pause as structured, reproducible information instead of appending an ellipsis.

### 6.2 Spatial Actions Shared by Voice and SFX

- `Closer`
- `Farther`
- `Left ear`
- `Right ear`
- Full horizontal orbit
- Front/back vertical orbit
- Left/right vertical orbit
- Left-side horizontal motion
- Right-side horizontal motion
- Left-side vertical motion
- Right-side vertical motion

### 6.3 Motion Paths

- Full horizontal forward: front → right → back → left → front. Reverse follows the opposite order.
- Front/back vertical forward: top → front → bottom → back → top. Reverse follows the opposite order.
- Left/right vertical forward: left → top → right → bottom → left. Reverse follows the opposite order.
- Left horizontal: move between left-front and left-back through the left-ear region; reverse swaps the direction.
- Right horizontal: move between right-front and right-back through the right-ear region; reverse swaps the direction.
- Left vertical: move among upper-left, left-ear, and lower-left positions; reverse swaps the direction.
- Right vertical: move among upper-right, right-ear, and lower-right positions; reverse swaps the direction.

Each motion stores:

- path;
- forward or reverse direction;
- start time;
- duration;
- cycle count.

Speed is calculated as cycles divided by duration, avoiding three conflicting persisted values. The UI may still expose speed; changing it updates either cycles or duration consistently.

### 6.4 Spatial-Hearing Profiles

- Provide one default profile that works without setup.
- Offer several alternatives in settings with top, bottom, front, back, left, and right test sounds.
- Users only adjust this when the default feels inaccurate.
- Save the selected profile as the project default.
- Every spatial preview clearly recommends headphones.

### 6.5 Combining Actions

Voice performance actions produce a new voice candidate first, then spatial actions operate on the selected sound. Examples:

- Softer + closer;
- Softer + right-side vertical motion;
- Tapping + reverse horizontal orbit;
- Breath + downward motion on the left side.

## 7. ASMR Sound Sources

### 7.1 Free Licensed Assets

- Use only free assets with clear provenance and licensing.
- Record the source page, creator, license, attribution requirement, and redistribution permission.
- Assets that cannot be redistributed must not be bundled in the repository or installer.
- Assets without license information are blocked from production candidates.

### 7.2 Local AI Generation

- Integrate at least one free local sound model as a listenable experimental source.
- Validate it on the user's Windows system and RTX 3060 Laptop 6GB GPU.
- Allow multiple candidates from one description.
- Keep low-quality local results available for comparison, but do not select them automatically.
- Keep model code, weights, and generated assets under the D-drive runtime and outside the repository.

### 7.3 Procedural Synthesis

- Keep the existing renderer and label it `Basic synthesis`.
- Allow direct selection and use it when assets are missing, local AI fails, VRAM is insufficient, or an immediate preview is needed.
- Procedural rain and room tone may be accepted as final when the user likes the result.
- Never describe basic synthesis automatically as real recording or high-quality AI output.

### 7.4 First Eight Categories

1. Rain;
2. Room tone;
3. Soft breath;
4. Blanket rubbing;
5. Clothing rubbing;
6. Page turning;
7. Fingertip tapping;
8. Soft laugh or airy vocal sound.

Each source or result records at least its category, material, action, intensity, distance, channel layout, duration, loopability, origin, and license.

## 8. Engineering Structure

### 8.1 Original Sound and Candidates

`AsmrProject` continues to store the accepted asset for each clip. Unaccepted candidates and operation history live in a separate local candidate catalog and runtime manifest so provider-specific details do not flood the Timeline DSL.

Each candidate records at least:

- candidate ID;
- project ID and clip ID;
- source asset ID;
- source type;
- provider and version;
- actual seed and configuration summary;
- measured WAV duration, sample rate, and channel layout;
- license information;
- creation time;
- applied director actions;
- automated quality results;
- acceptance state.

Accepting a new voice or SFX candidate changes only the clip's selected dry-source reference. Accepting a spatial action keeps that dry-source reference and persists only the spatial settings. The original, preview caches, and other candidates remain available. Candidate counts are capped, with safe cleanup for unreferenced assets.

### 8.2 Reproducible Spatial Settings

Spatial motion is durable product-level direction and must be stored in Project JSON instead of browser-only state.

Add an optional provider-neutral `spatial_motion` object to a clip:

- path;
- direction;
- start_offset;
- duration;
- cycles;
- profile_id.

Old projects without this field continue to use the current static position behavior. Project import and the local project library handle compatible migration.

### 8.3 Dry-Source Rule

- Generated or imported source audio does not bake in Timeline gain, fades, or spatial motion.
- Gain, fades, and spatial processing are applied exactly once during preview or project mixing.
- The same rule applies to voice, free-library SFX, local-AI SFX, and procedural synthesis.
- Convert every source into one normalized internal format before spatial processing and mixing.
- Use 48 kHz stereo float internally by default; resample 32 kHz TTS and other source rates before mixing.
- Preserve real stereo or binaural sources according to an explicit policy instead of always folding them to mono.

### 8.4 Spatial Processing

Full and vertical orbits cannot rely on left/right gain alone. Processing includes at least:

- direction- and distance-dependent tonal change;
- small timing and level differences between ears;
- early reflections and restrained room response;
- open-licensed binaural spatial data for front/back and vertical perception;
- continuous path interpolation without sudden position jumps.

The source, version, and license of default and alternative spatial data are recorded in `docs/THIRD_PARTY_RUNTIMES.md`. Only data that permits the intended use and distribution may ship.

## 9. Data Flow

### New SFX

1. Enter or select a sound description.
2. Find free-asset candidates.
3. Optionally request local-AI candidates.
4. Offer procedural synthesis as a candidate or failure fallback.
5. Convert all candidates into the common audio format and measure real technical properties.
6. Preview, compare, and accept one candidate.
7. Write the accepted result to the current clip, then apply spatial actions and project mixing.

### Director Actions

1. Select the current sound and an action.
2. Route `Softer` and `Pause` to voice regeneration; route spatial actions to local spatial processing.
3. Produce a listenable candidate or preview cache.
4. Compare the original and result.
5. On voice-regeneration acceptance, switch the dry-source asset. On spatial-action acceptance, persist only the spatial settings and keep the original dry source. Undo restores the previous source or spatial settings.
6. Mark the project mix for regeneration.

## 10. Local Model Evaluation

### Local SFX Model

The first research task compares free local candidates using fixed blanket-rubbing, fingertip-tapping, and rain descriptions. Selection requirements:

- licensing permits use in this project;
- installation works locally on Windows;
- generation completes on an RTX 3060 Laptop 6GB, or through a documented CPU/offload mode;
- output converts into the project's common format;
- at least one sound category reaches acceptable listening quality;
- no paid API dependency.

The best runnable model becomes the first local-AI provider. It may remain an experimental candidate source for categories where it is weaker; those categories continue using free assets or procedural synthesis.

### Local Voice Model

- Keep GPT-SoVITS as the existing baseline.
- Use a fixed Chinese near-mic script to test whether references or supported controls create an audible `Softer` result.
- If not, evaluate one free, locally runnable provider with better performance control.
- `Softer` is not complete until a provider passes listening acceptance.

## 11. Errors and Fallbacks

- Keep the current sound when asset lookup or generation fails.
- On local-model OOM, timeout, or process exit, show the reason and allow procedural or free-asset alternatives.
- Block adoption and export of assets with missing license data.
- If spatial preview fails, continue playing the original and do not persist incomplete settings.
- When orbit duration exceeds the usable range, ask the user to adjust duration, cycles, or clip length.
- Let users switch profiles when the default spatial perception feels inaccurate without regenerating the source sound.
- Before deleting candidates, check references from the current project, revisions, and derived candidates.

## 12. Completion Criteria

### Listening

- `Softer` has a clear performance difference, not only a gain difference.
- `Closer` and `Farther` communicate distance, not only loudness.
- Headphone listeners can identify left/right and orbit direction.
- The default vertical profile creates basic up/down motion, with alternatives available when needed.
- Rubbing, page-turning, and tapping communicate the intended material and action.
- Rain and room tone play for long periods without obvious loop seams.
- No clicks, abrupt cuts, or obvious level jumps.

### Product Behavior

- Switch directly among the original, candidates, and different sources.
- Accept, undo, and remix reliably.
- Never overwrite the original asset.
- Show candidate origin, license, and execution method clearly.
- Never mislabel procedural synthesis as real recording or high-quality AI output.

### Automated Verification

- Validate real WAV format, duration, sample rate, channels, peak, and clipping.
- Verify continuous spatial paths without sudden jumps.
- Verify gain and fades are applied once rather than twice.
- Verify candidate actions preserve originals and acceptance/undo round-trips.
- Verify required license fields and unauthorized blocking.
- Fix the current standalone TypeScript test-type errors and combine test, typecheck, lint, and webpack build into one verification command.
- Browser-test candidate comparison, director actions, spatial settings, and failure fallbacks at desktop and narrow widths.

## 13. Delivery Order

### Round 1: Complete Sample

Use one voice line, one clothing-rub sound, one tapping sound, and one rain sound to deliver:

- `Softer`;
- `Closer/Farther`;
- full horizontal orbit;
- the left/right vertical orbit (left → top → right → bottom);
- free-asset, local-AI, and procedural sources;
- original/candidate comparison;
- accept, undo, and remix.

Round 1 proceeds to expansion only after actual listening acceptance.

### Round 2: Full Capability Expansion

- `Pause`;
- left ear and right ear;
- both full vertical orbits;
- left/right-side horizontal and vertical motion;
- direction, duration, cycles, and speed control for every motion;
- all eight ASMR SFX categories;
- default and alternative spatial profiles.

### Round 3: Full-Project Acceptance

Use a complete ASMR project to assess voice performance, material realism, spatial direction, long ambience, voice masking, version switching, and final mix quality.

## 14. Project Governance

- After written review, record this direction in `docs/ROADMAP.md`.
- Keep important designs in both English and Chinese.
- Write a detailed implementation plan before coding.
- Update `docs/THIRD_PARTY_RUNTIMES.md` with licenses for providers, spatial data, model weights, and free assets as they are selected.
- Adapters, API routes, and provider wrappers remain internal implementation details, not independent product milestones.
