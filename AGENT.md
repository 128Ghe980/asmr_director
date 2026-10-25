# Agent Entry

This project has a fixed roadmap and a separate project-management rulebook. Before answering roadmap questions or starting implementation, read these files first:

1. `docs/ROADMAP.md`
2. `docs/PROJECT_MANAGEMENT.md`
3. `docs/AI_HANDOFF.md`
4. `docs/STORAGE.md` before creating outputs, running tests, moving or deleting files.

Also check current git status and recent project history before deciding what should happen next.

## Rules

- `docs/ROADMAP.md` is the only source of truth for the top-level product sequence.
- `docs/PROJECT_MANAGEMENT.md` defines how agents should follow and update the project process.
- Do not invent new top-level roadmap steps.
- Do not turn implementation details into top-level roadmap gates.
- Do not answer "what next?" from intuition. Answer from the roadmap plus current project state.
- If project reality conflicts with the roadmap, explain the conflict and propose a roadmap update before changing direction.
- Keep `docs/AI_HANDOFF.md` as recovery context, not a competing roadmap.
- Keep `docs/project-archive.md` as historical context.
- After meaningful work, update the relevant docs.
- New important specs need both English and Chinese versions.
- Completion claims require verification evidence.
- Storage is project-scoped: use `I:/AI/asmr_director/{artifacts,qa,runtime,service,cache,archive,tmp}` for external data, or repository `.local/tmp` for small local fallback files. Never create project outputs in `I:/temp` or new `I:/AI/asmr-director-*` siblings. `I:/AI` is a shared parent for many projects. Old absolute paths in historical evidence are not current output instructions; resolve them through `I:/AI/asmr_director/storage-map.json`.
