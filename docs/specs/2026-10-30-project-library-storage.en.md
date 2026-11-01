# Project library capacity and durable persistence

2026-10-30. Reliability work within Audio Quality V1; no new roadmap stage.

## Problem

Importing the new Halloween project displays 39 segments in memory but reports that local saving is unavailable. The project can disappear after reload. The existing synchronous loader also treats a failed normalization write as a read failure and may return the demo despite having successfully read the user's library.

## Contract

- Restore existing libraries and migrate legacy single projects without discarding projects, valid revisions, acceptance records, or short/paragraph workspaces.
- Store the complete library in IndexedDB. Retain original localStorage data as the migration source; do not solve capacity by deleting projects or truncating data.
- A save succeeds only after the database transaction commits. Serialize writes; an older asynchronous result must neither overwrite newer data nor mark newer unsaved edits as saved.
- Finish restoration before enabling automatic saves. A failed normalization write must not discard readable user data or replace it with a demo/empty library.
- Fall back to legacy storage only when consistency can be preserved. If durability is unavailable, keep the current edits visible and report failure.
- Preserve project JSON, generated content, audio, and batch package formats. Do not invoke generation models or video rendering.

## Acceptance

Test migration, full round trips, quota/transaction failures, write ordering, stale save statuses, and reload restoration. In the user's actual page, the imported project must show 20 adopted voices, 19 silent performances, and 20 processed voices, remain in the list after reload, and retain old projects. Build an isolated copy of the active release with only this change overlaid.
