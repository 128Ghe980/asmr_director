# AI Creative Planning / LLM Planner V1

Date: 2026-09-07. The user approved theme → editable draft → section rewrite → project adoption. This is a named stage, not numbered Step 11. Audio Quality V1 remains in progress with its listening conclusions unchanged.

## Product behavior

Add AI planning / project editing workspace views. Require a theme; offer 1/3/5/10 minute targets and optional role, style and constraints. Default to Chinese and local Ollama, with a server-configured external API option.

Generate a complete speakable script: title, scene, character and 2–12 sections. Each section separates spoken text, director notes, sound suggestions, emotion/style/pace, positioning and after-section quiet. Notes do not enter TTS text; suggestions do not imply available real assets.

Allow manual editing, selected-section AI rewriting, cancellation, script download, and up to five in-session undo snapshots for AI updates/source loads. Lock conflicting edits while requests run. Failures/cancellation preserve the old draft; late responses cannot commit.

Persist the working form brief separately from the draft's original draftBrief. Changing inputs does not silently change the adopted draft's provenance; show a regeneration notice. Report failed saves and preserve corrupt storage until a user edit triggers another attempt.

Validate before adoption, create a new project and a safety revision of the previous one. Store a reloadable planning snapshot in library metadata; subsequent project text edits do not update that snapshot. Reset/import replacement clears old source metadata; revisions save and restore the corresponding source.

## Default interface and progressive disclosure

User correction on 2026-09-07: the functionality is mostly usable, but the interface contains too much irrelevant information and internal design guidance. This is a presentation refinement within Planner V1, not a new stage or capability.

The default interface presents the current task's actions and creative content. On wide screens, place the theme/settings beside the script; stack them on narrow screens. Project navigation starts collapsed; on mobile, open it through the header button. Planning has its own concise header and no engineering details dock or project import/export/reset controls. Those remain available in project editing.

Keep script text, selected-section rewriting, undo, download and adoption directly accessible. Put optional creative requirements, scene/character settings, per-section director/sound/performance details and project-source loading behind disclosure controls. Editing metadata, technical generation fields, history, track progress and full quality checks are also available on demand.

Remove marketing descriptions, workflow step banners, implementation notes, duplicate state summaries, empty asset statistics and placeholder waveforms. Preserve actionable errors, necessary save feedback, changed-brief notices and concise external-transmission/cost information. Technical data and successful checks must not crowd the writing surface. Presentation cleanup must preserve the user's current draft, saved projects and provider behavior; no model call is needed to verify layout.

## Contracts and providers

Independent Zod schemas validate PlannerBrief/Section/Draft. A deterministic compiler creates all five fixed tracks, with pending voice clips only. Director notes and sound suggestions remain in plannerSource, outside Project JSON.

The separate `ai-asmr-studio:v1:planner-draft` key contains working content and no credentials. Optional library entry/revision plannerSource is validated; corrupt metadata does not discard valid projects.

GET /api/planner returns a safe provider catalog; configured means complete configuration, not online availability. POST distinguishes generation and rewriting, revalidates requests/results and returns only the selected rewritten section.

Ollama uses /api/chat, JSON schema, non-streaming and think:false. External providers use compatible Chat Completions JSON mode. Server environment variables hold URLs/models/keys. Explain external transmission and possible cost in the UI. Bound body/response size, tokens and total timeout; allow one structural repair. Errors never echo upstream bodies or credentials. No fake template fallback. Enforce JSON Content-Type and same-origin Origin checks against simple cross-site model triggers.

## Timing

Target duration guides writing. Estimate speech and inter-section quiet without truncating text, speeding speech or padding to force a duration. Planning pauses are independent from Audio Quality V1's semantic-group pause recipe.

Voice assets record actual PCM WAV duration. For projects with planning metadata, extend underestimated clips, shift later clips/emotion boundaries and extend crossing looping ambience. Shorter takes retain planned quiet; ordinary existing projects keep established behavior. Concurrent voice generation ignores only start-time differences; text, duration and parameter changes still invalidate stale results.

## Acceptance

Iteration decision on 2026-09-08: the user accepted the verified external DeepSeek path and UI cleanup for this version. Local Ollama success and broader script-quality evaluation are deferred follow-ups, not prerequisites for starting VoxCPM2 integration and not claimed as passed.

- Real configured-provider generation and single-section rewriting; adopted projects synchronize storyboard/timeline/editor/validation. External DeepSeek passed this iteration; local Ollama remains deferred under the decision above.
- Draft reload, changed-brief notice, undo, source snapshots and safety revisions work.
- Invalid output, cancellation and offline errors preserve content; Project JSON excludes working drafts/runtime/credentials.
- Tests cover contracts/compiler/persistence/adoption/provider/timing/concurrency; lint, typecheck, Webpack build and desktop/390px checks pass.
- Default planning focuses on the theme and editable script; supplementary and technical details expand on demand. Existing actions and relevant errors remain accessible, and layout checks preserve the current user's content without generating replacement material.

Creative quality still needs evaluation across real themes. This stage does not complete VoxCPM2 integration, real sound expansion or one-click high-quality audio production.
