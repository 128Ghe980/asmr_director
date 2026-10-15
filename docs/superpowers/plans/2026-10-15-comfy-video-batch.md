# ComfyUI video-batch implementation

Approved specification: [中文](../specs/2026-10-15-comfy-video-batch.zh.md) / [English](../specs/2026-10-15-comfy-video-batch.md).

1. Record the confirmed scope and portable manifest. Preserve unrelated spatial-workbench changes and production assets; keep large QA outputs on I:.
2. Add compatible optional ambient-sound metadata, DeepSeek preparation using both neighboring shots, simple editing, and the five-second non-dialogue rule. Cover source validation and both existing speech workspaces.
3. Add all-shot package validation and a bounded multipart/ZIP export. Include one adopted audio per speech shot, current prompts, optional replaceable character image and the standalone runner files. Do not reuse predecessor-chain readiness as an export gate.
4. Add a third video-package tab to the existing download popover. Keep reference selection optional, support cancellation and stale-response protection, and retain existing audio/TXT downloads.
5. Build a Python-standard-library runner and clean 04-derived API template. Support command line and a small desktop launcher, ComfyUI preflight, sequential media injection, continuation tail reference, speech-original/ambient-generated audio routing, bounded retries, persistent resume and per-shot rerender. Finish media with FFmpeg; optionally build an ordered preview after every shot succeeds, keeping individual files intact.
6. Verify unit/component/API/ZIP contracts, simulated ComfyUI orchestration, package-to-runner dry run and local FFmpeg media. Run TypeScript, source ESLint, full relevant tests and a separate production build. Check responsive UI when browser policy permits; do not bypass refusals or claim unavailable target-host verification.
7. Record actual evidence and remaining remote-host H3 acceptance in docs/records, ROADMAP, AI_HANDOFF and project-archive. Do not automatically publish, commit unrelated work or replace the running production service.
