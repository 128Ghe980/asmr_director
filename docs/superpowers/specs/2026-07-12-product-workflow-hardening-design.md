# Step 10: Product Workflow Hardening Design

Date: 2026-07-12

## Goal

Turn the current single-project generation and mixing console into a local-first product workflow that can be used and recovered over time. Users must be able to manage projects, keep versions, inspect real audio waveforms, and understand export readiness.

## Current Reality

- Steps 7, 8, and 9 provide real voice generation, semi-real non-voice generation, real project mixing, and WAV download.
- The left rail still contains placeholders for recent projects and a project list.
- One `localStorage` key stores one project; switching and recovery points do not exist.
- Preview Layer still renders a fake waveform even when a real WAV exists.
- Schema validation exists, but generation readiness, mix freshness, and technical audio warnings are not presented as one export quality report.
- The product is currently local-first. Cloud persistence, accounts, billing, publishing, and collaboration require deployment and product-policy decisions and must not be represented as completed local MVP capabilities.

## Approaches Considered

### A. Local product loop (selected)

Store a versioned multi-project library and revision metadata in `localStorage`; analyze existing WAV files through a local Next API; wire the workflow into the current rail, Preview Layer, and details dock.

This matches the current architecture, needs no new service, and produces an immediately usable workflow. Browser storage remains appropriate because audio stays in the D-drive runtime and only small project documents enter storage.

### B. IndexedDB project library

IndexedDB offers more capacity and transactions, but introduces an asynchronous database and migration layer without meaningful benefit while project documents remain small.

### C. Filesystem project library

A Next API could store project folders and revision files. This is closer to a desktop application, but couples the browser UI to a local server lifecycle and requires path, concurrency, and backup policy. It remains a future desktop-packaging option.

## Delivery Scope

### Local multi-project library

Add a versioned library envelope with `version`, `currentProjectId`, and project records containing the current `AsmrProject`, update time, and revisions. Migrate the legacy single-project key on first load. Keep library metadata outside Project JSON.

Users can create a clean project from the demo structure, switch projects, duplicate the current project, delete any non-final project, and import a project into the library.

### Versions and recovery

Keep autosave for current state. Add explicit revisions plus deduplicated safety revisions before destructive operations. Retain at most 12 revisions per project. Restoring a revision first protects the current state, then replaces only the current project document.

### Real WAV waveform and analysis

Add `GET /api/assets/analysis?uri=<durable-uri>&bars=64`. Accept only local clip or mix asset URIs, reuse safe path resolution and PCM WAV decoding, and return peak bars, duration, sample rate, channel count, peak dBFS, RMS dBFS, and clipped-sample count. Analysis data remains runtime-only.

Preview Layer prefers the current real mix waveform, then the selected playable clip waveform, and otherwise shows a quiet pending placeholder.

### Quality checks

Build a pure quality-report function that combines schema validity, generated-asset completeness, current mix availability, audio-analysis availability, stereo output, and clipping/headroom warnings. Checks use `pass`, `warn`, and `block` severities. Existing readiness rules remain the action gates; technical warnings do not destroy or hide the last usable WAV.

### UI

Keep both side regions collapsible. The left rail becomes a compact project library with short Chinese actions. The right dock adds compact quality and version sections below Preview Layer. Show at most five recent revisions with restore actions. Preserve center Timeline width and the existing visual language.

## Data Flow

1. Load and migrate the project library, then select `currentProjectId`.
2. Autosave edits and successful generation/mix commits into the selected library record.
3. End the active generation session before switching projects.
4. Request runtime audio analysis for the current mix or selected playable clip URI.
5. Combine analysis and project state into the quality report.
6. Route revision restoration through the normal editable-project and autosave path.

## Error Handling

- Ignore invalid library records and fall back to the demo instead of crashing.
- Continue in memory when browser storage is unavailable and surface the unavailable save state.
- Reject unknown URI schemes, unsafe asset IDs, missing files, and invalid WAV content.
- A waveform failure displays an unavailable state without disabling playback or download.
- Prevent deletion of the final project.

## Verification

- Pure tests cover migration, save, switch, create, duplicate, delete, revision deduplication, retention, and restore.
- PCM fixtures cover waveform bars, channels, peak/RMS metrics, and clipping counts.
- Quality tests cover missing assets, missing mix, current mix, stale mix, and clipping warnings.
- Run the full test, lint, and production build commands.
- Browser-check switching, revision restore, real waveform rendering, quality display, collapsed layout, and console errors.

## Out of Scope

- Cloud persistence, accounts, billing, publishing, and collaboration.
- Audio binary data in browser storage or Project JSON.
- Full DAW waveform editing, spectrograms, or mastering-suite analysis.
- Timeline DSL top-level schema changes.
