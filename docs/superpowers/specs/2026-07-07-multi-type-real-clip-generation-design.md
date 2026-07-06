# Multi-Type Real Clip Generation Design

Status: Approved by delegation on 2026-07-07. The user asked Codex to design the details, write the Step 8 plan, and begin implementation while away from the computer.

## Goal

Roadmap Step 8 extends real clip generation beyond voice. At least two non-voice clip classes must generate playable audio through the existing selected-clip generation flow, commit only durable `asset://clip/...` references to Project JSON, and preview through the existing Preview Layer.

This design implements all three non-voice classes currently present in the demo project:

- `breath`
- `sfx`
- `ambience`

## Selected Approach

Use a local procedural audio provider for non-voice clips.

Voice clips continue to use GPT-SoVITS. Breath, SFX, and ambience clips are rendered locally in Node as deterministic PCM WAV files and saved through the existing local asset store. This avoids introducing another large model runtime before project mixing exists, keeps the app usable offline, and produces real WAV assets instead of mock data URLs.

## Alternatives Considered

1. **Local procedural renderer, selected**
   - Pros: no new model downloads, works with current D-drive runtime, deterministic tests, fast enough for clip preview, low operational risk.
   - Cons: sound quality is serviceable rather than model-grade.

2. **Download a dedicated SFX / ambience generation model now**
   - Pros: potentially better texture variety.
   - Cons: high setup and storage risk, unclear licensing, delays Step 8 behind another runtime integration.

3. **Asset-library only**
   - Pros: highest predictable audio quality if a curated licensed library exists.
   - Cons: no current licensed asset library is available in the repo, and it would not exercise generation parameters.

## Architecture

Add a focused procedural renderer in `apps/web/src/lib/asmr/procedural-audio.ts`.

The renderer:

- accepts a non-voice `TimelineClip`;
- uses the clip type, content field, seed, duration, fade settings, volume, and pan-related metadata to produce deterministic mono WAV bytes;
- writes 16-bit PCM WAV at 32 kHz;
- keeps local absolute paths out of returned project data.

Update `apps/web/src/lib/asmr/local-clip-generation.ts` so:

- `voice` still follows the GPT-SoVITS path;
- `breath`, `sfx`, and `ambience` follow the procedural path;
- unsupported clips fail with a clear error;
- the returned asset shape remains `GeneratedAssetResult`.

The existing API route, browser bridge, project mutation, preview resolver, and Preview Layer remain the product contract. They should not learn provider-specific details.

## Procedural Sound Rules

`breath`:

- Render soft filtered noise with slow inhale/exhale envelopes.
- Use shorter swell cycles for `light_breath` / `轻呼吸`.
- Use the clip seed to vary noise while keeping regeneration deterministic.

`sfx`:

- Render friction-like noise for blanket / cloth / rubbing labels.
- Render short decaying impulses for tapping-like labels if they appear later.
- Shape the envelope so short SFX do not click at boundaries.

`ambience`:

- Render rain-like continuous noise plus sparse droplet ticks.
- Support long clips such as the demo ambience clip without requiring external assets.
- Apply short fades so selected preview starts and ends cleanly.

## UI Behavior

No new controls are required. The selected clip generation panel already appears for all clip types.

Expected behavior:

- Selecting breath, SFX, or ambience and clicking `生成` starts the existing runtime job UI.
- Success changes the selected clip control to `重生成`.
- The selected clip preview button becomes playable.
- Generating one clip only mutates that clip's generation and asset fields.

## Persistence Rules

- Project JSON stores only final asset metadata and `asset://clip/<assetId>`.
- It must not store local absolute paths, job IDs, progress, `blob:` URLs, or `data:audio` URLs.
- Runtime generated WAV files stay under `D:\CodexWorkplace\asmr_director_runtime\assets\clips\app` by default.

## Error Handling

- Voice generation errors continue to surface provider messages from GPT-SoVITS.
- Procedural generation errors should be ordinary local generation failures and commit `asset_failed` through the existing bridge flow.
- Invalid or missing clip IDs still fail through the API route.

## Testing

Unit tests should cover:

- WAV header and byte length for procedural output.
- Deterministic output for the same non-voice clip and seed.
- Different seeds or different clip classes produce different bytes.
- `generateLocalClip` routes voice to GPT-SoVITS and non-voice clips to procedural rendering.
- The API/helper path saves non-voice assets as `asset://clip/...`.
- Generation view allows non-voice generated assets to preview through the same selected clip preview contract.

Manual/browser verification should cover:

- Select `breath_001`, generate, confirm `asset://clip/...`, playback endpoint returns `audio/wav` and `RIFF`.
- Select one SFX clip, generate, confirm the same.
- Optionally select ambience and verify a long generated file plays through the same API route.

## Out Of Scope

- Real project mix/export. That is Step 9.
- Real waveform rendering.
- Cloud storage or server job queues.
- Training, fine-tuning, or downloading new SFX models.
- A full licensed sound library workflow.
