# Storyboard status markers and batch TXT download

Date: 2026-10-03. Scope: existing Audio Quality V1 project editing and export.

Each voice paragraph's existing storyboard button shows a small right-side status marker: green for a complete current H3 prompt, gray for no saved storyboard, amber for saved notes needing an update or completion. Accessible text and tooltips identify the state. The marker does not add a grid column or replace the adjacent Continuous/New shot toggle. Dialogue, adopted audio, background and predecessor changes derive updated states; saved notes remain intact.

The existing top **批量下载** popover contains **音频 / 分镜** tabs. Audio keeps its original/raw and processed ZIP workflow. Storyboard download produces a ZIP with one UTF-8 `.txt` per usable paragraph, containing exactly its existing H3 prompt. Files retain the original voice paragraph ordinal and a sanitized dialogue prefix, including numbering gaps where unavailable prompts are skipped. The project title names the ZIP and enclosing folder.

The storyboard tab shows ready, pending and needs-update counts and explicitly excludes missing, stale and incomplete prompts. An empty export is disabled and rejected by the server. Exports neither generate replacement storyboards nor change adopted audio or saved notes.

Client-safe status and export selection share current/complete validation with per-clip prompt copying. The existing `/api/assets/batch-download` POST accepts optional `kind: "audio" | "storyboard"`, defaulting to audio for compatibility. Both use small JSON metadata followed by a native opaque-token GET download; binary audio POST compatibility remains. Server ZIP writing retains cancellation, size/count limits and temporary-file cleanup. Switching tabs or changing project/source cannot trigger a late download for an obsolete request.

Acceptance and runtime evidence: [development record](../../records/2026-10-03-audio-quality-v1-storyboard-status-export.md). [中文说明](2026-10-03-storyboard-status-and-batch-txt.zh.md).
