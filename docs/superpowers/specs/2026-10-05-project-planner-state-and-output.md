# Project Planner state and output limits

Date: 2026-10-05. Existing stage: Audio Quality V1, in progress.

The user reports that creating a project leaves the previous project's right-hand content
visible. A 3-minute Planner request about returning home after gathering resources in an
apocalypse, with a mechanical watch as an AI robot's birthday gift, also reports a length
limit. These are separate state and provider problems.

## Project workspaces

Planner edits now belong to the active project. A new project opens its own empty planning
workspace; switching back or reloading restores that project's draft and scene edits.
Project switches flush even edits within the 300ms save debounce, cancel the old request,
and reject its late responses. Waveform responses also respect project cancellation.
The existing template used for new audio timelines is outside this state correction.

Use `ai-asmr-studio:v1:planner-draft:project:<encodedProjectId>`. Preserve the original
global `ai-asmr-studio:v1:planner-draft` bytes. Automatic migration requires an existing
owner marker or a matching project source (the complete draft and its generation brief).
Shared generic section IDs alone do not prove ownership after regenerating the same theme.
Unowned legacy work does not appear automatically in a newly created project, including
after reload; **恢复旧版草稿** explicitly restores it with undo while retaining the original.
Never bind a legacy draft to the temporary demo project before library hydration completes.

When a scoped draft is absent, a project's adopted `plannerSource` can seed its workspace;
this must not overwrite an unreadable stored draft. The source remains an adoption snapshot,
not a live mirror of Planner edits. Preserve original projects, revisions, adopted assets,
storyboard notes and the older global draft. This replaces the global-workspace switching
rule in the 2026-10-01 Planner storyboard spec, following the user's latest instruction.

## Planner output

For the official DeepSeek endpoint, creative Planner requests explicitly disable thinking
so completion capacity is available for the JSON result. Allocate finite generation budgets
by duration: 1/3/5/10 minutes use 4096/8192/12288/16384 tokens. Keep other compatible
API and Ollama behavior within existing limits; do not send DeepSeek-only options elsewhere.
Short structural analysis, local CPU settings, cancellation and whole-operation deadlines
retain their own policies. A length-truncated response remains an error, not usable JSON;
do not automatically loop or require a shorter requested duration as the primary fix.

Verify project creation/switch/reload, edits before debounce, legacy ownership and recovery,
original-source preservation, and late responses. Verify provider wire settings, duration
budgets, length/error/cancel/timeout handling and shared structural-analysis regressions.
Run one bounded real 3-minute request with the user's exact theme. Save the result in the
current new project's scoped Planner draft for reload/switch verification, without adopting
it into the engineering timeline. Record actual outcomes and verification limitations.

[中文](2026-10-05-project-planner-state-and-output.zh.md).
