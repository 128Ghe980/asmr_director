# Development record — Batch download transport recovery

Date: 2026-10-02. Route: existing Audio Quality V1 in [ROADMAP](../ROADMAP.md). Status: this fix is implemented and verified; parent route remains in progress. No commit/push or new roadmap stage.

## Failure and resulting behavior

The user saw `Failed to fetch` in the batch download popover. The actual request reached Next; diagnostic logs show 10 clips, a fully prepared 20,982,790-byte ZIP and the same number of bytes read by the response stream, without a server stream error. The IAB binary fetch still failed. Removing only `Content-Disposition` did not help. This establishes the failing delivery path, without claiming a specific internal browser limit.

The UI now POSTs the unchanged project snapshot with `Accept: application/json`, reads small metadata and starts a same-origin HTTP download link. Native GET streams the same ZIP with its UTF-8 attachment name; default binary POST remains compatible. Ready UUID tokens are process-local, single-use, expire after five minutes and retain at most two archives. GET claims before opening/stat validation, then streams with 64 KiB byte backpressure; owned cleanup is idempotent on completion/cancel/open failure. Abandoned links expire; a service restart requires fresh preparation. Client URL validation rejects external/path-based destinations, network failures have a Chinese retry explanation, and cancellation remains available during preparation. No folder/audio processing or project-generation rules changed.

## Evidence

Root: `I:/AI/asmr-director-batch-download-recovery/2026-10-02`. **Two unique targeted files / 27 tests pass** (UI11/API16), five owned-source/test files pass ESLint, separate full TypeScript and production Webpack build pass. Logs: `ui-tests.log`, `route-tests.log`, `ui-eslint.log`, `route-eslint.log`, `typecheck.log`, `build.log`. Existing native SWC warning still falls back successfully to WASM. Temporary diagnostic code was removed; its historical output is `diagnostic-3001.stdout.log`.

The actual IAB download is `C:/Users/Yuki1/Downloads/深夜回家，小安陪你吃碗热汤面_已采用音频.zip`: **20,982,790 bytes, 10 adopted clips, 21 entries**, one title folder with paired untreated/processed filenames and manifest. The saved file was reopened; all CRCs, raw-source SHA values, processed 48 kHz stereo PCM16 WAVs and full source durations (plus 650 ms where D spatialized) pass (`browser-zip-verification.json`, `verify_browser_zip.py`). This evidence is the real browser package, not merely the success banner.

An independent API fixture uses 20 verification clips referencing one existing source, without editing the user's project or synthesizing audio: **21,015,839 bytes, 41 entries**, all CRC/raw/D-tail checks pass; token replay returns404 (`large-api-verification.json`, `verify_large.py`). Metadata size is only a diagnostic reserialization, not a measured HTTP payload limit. Default binary POST is covered by regression and the single-source real API probe.

Visible title, 22 dialogue/timeline entries and audio overview10/0/12 match before/after; all **138 current asset files/hashes** are unchanged (`assets-before.json`, `asset-preservation.json`). No temporary ready package remains, console error/warn logs are empty, desktop success screenshot inspected only. Zero TTS/text-model/H3 calls and no user candidate adoption/discard. `recovery-verification.json` collects the final checks.

## Runtime and continuation

Latest production **3001/PID32092/`.next-batch-generation-production`/HTTP200**. Old PIDs17804/27136/29772 were identified and stopped with no active audio generation; earlier runtime notes are historical. Existing I-drive cache/voice-work/temp configuration remains. Follow the [English export spec](../superpowers/specs/2026-10-01-batch-adopted-audio-download.md), [中文说明](../superpowers/specs/2026-10-01-batch-adopted-audio-download.zh.md) and [AI_HANDOFF](../AI_HANDOFF.md).

```powershell
Set-Location 'D:/CodexWorkplace/asmr_director/apps/web'
$env:ASMR_NEXT_DIST_DIR = '.next-batch-generation-production'
$env:ASMR_VOICE_WORK_ROOT = 'I:/AI/asmr-director-voice-work'
$env:ASMR_BATCH_DOWNLOAD_TEMP_ROOT = 'I:/AI/asmr-director-batch-download/2026-10-01/temp-downloads'
& 'D:/nodejs/node.exe' node_modules/next/dist/bin/next start --port 3001 --hostname 127.0.0.1
```
