# Shared scene and adopted-clip video storyboards

Date: 2026-10-01

Status: implementation, automated checks, real text-provider and production-browser verification complete. This extends the existing **Audio Quality V1** work in [ROADMAP](../../ROADMAP.md), without a new top-level stage or H3 video-quality acceptance. [中文说明](2026-10-01-adopted-clip-video-storyboards.zh.md)

## User workflow

The first-step Planner now has **文案 / 场景** tabs. After writing or loading the actual draft, the user can generate, regenerate or edit one shared English scene description. This describes the environment, light, materials and mood, rather than planning all video shots before audio exists. Optional scene preferences stay secondary; download, save, undo and cancellation use the existing compact workspace.

Adopting a draft carries its nonblank scene description into the new project's `videoPlan`. The Planner UI omits a cleared/whitespace scene on adoption, so the new project falls back to its scene name; the data API can retain an explicitly supplied empty description. The old Planner storyboard remains compatible in working storage and `PlannerSource`, including adoption, duplication and revisions; it is not silently converted into audio-bound clip storyboards. Its old multi-shot editor is no longer the first-step main view. Loading a source without a scene clears the working scene instead of reusing another project's content.

In the project editor, a small video-storyboard button beside each voice line opens that clip's **声音 / 分镜** inspector. The inspector uses the existing internal-scroll region. It shows the current dialogue, adopted audio download, shared scene, model choice, optional direction and generate/regenerate controls. Generated title, visual, action and camera are editable. H3 preview, copy and a per-clip TXT download appear with the saved result; failed automatic copy opens and selects the preview for manual copying.

## Actual audio and independent shots

`POST /api/scene-description` accepts `{ provider, draft, instruction? }`. It uses the existing Planner provider configuration and returns `{ sceneDescription, sourceFingerprint, provider, model }`. The server fingerprints draft title, scene, character and ordered section IDs/text; section titles, audio-direction settings and waiting are excluded. The frontend validates that writing-source relationship before applying the result. Generated scene text is nonblank and at most 4,000 characters. Manual working state can retain an empty or null scene.

`POST /api/clip-storyboard` accepts `{ provider, project, clipId, includePrevious?: boolean, instruction? }`, with `includePrevious` defaulting to `false`. Only a unique voice clip with `asset_generated` and a consistent `asset://clip/<assetId>` reference is eligible. Unadopted candidates, raw generation windows, mixes, mock assets and SFX are not clip sources. The server resolves the adopted WAV inside the configured asset root and decodes PCM to measure its full actual duration. Timeline `clip.duration` is not audio duration, and the model cannot choose an asset or invent seconds. The file limit is 128 MiB and the measured duration limit is 10 minutes. Invalid, missing, changing or unsupported audio returns an error while existing notes remain.

The model generates only title and English visual/action/camera. A deterministic helper injects the exact current Chinese `clip.text`, measured audio duration and fixed H3 sound/reference rules. Each exported clip is an independent `[Shot 1]` with `<Subject 1> (S1)`, `<Picture 1>` and `<Audio 1>`. The picture supplies appearance and clothing, not the opening frame; reference appearance takes priority over invented written details. The complete current audio is `fully_copy`, at its original timing, words and pauses, with no new dialogue, ambience, effects or music and `non_diegetic_music: N/A`. The mouth follows the track and closes during pauses and after speech. Use one restrained continuous action with a visible mouth.

The default is independent generation. Optional continuity uses only the adjacent preceding voice in timeline order, ignoring SFX and ambience. It is available only when that preceding storyboard is current and complete. The previous prompt informs visual continuity; the new output still uses only the current clip's own dialogue and full audio. It does not copy the previous soundtrack or turn a series into one multi-shot prompt.

## Stored data and validity

English language and appearance constraints are model instructions, not semantic schema validation. The source fingerprint identifies input metadata rather than hashing WAV bytes. Changing the selected clip/project and closing the clip's storyboard inspector cancel that inspector's request; switching only the top-level Planner/audio workspace keeps hidden panels mounted and does not by itself cancel requests.

Optional Project JSON metadata is:

```ts
videoPlan: {
  version: 1,
  sceneDescription: string,
  shots: Record<clipId, {
    version: 1,
    promptFormat: "minimax-h3",
    clipId: string,
    sourceFingerprint: string,
    audio: { assetId: string, uri: string, duration: number },
    title: string, visual: string, action: string, camera: string,
    previousClipId?: string,
    previousPromptFingerprint?: string
  }>
}
```

`audio.duration` is measured seconds. The optional predecessor fields occur together and bind the adjacent preceding clip's source, measured audio and editable content. Source fingerprints bind exact current text, adopted asset, declared asset metadata, base project scene, character and the shared scene description. A legacy project without `videoPlan` uses `project.scene.name` as the effective scene; an explicitly cleared description remains empty.

Text, audio, scene or character changes make a saved storyboard stale. Editing a referenced preceding storyboard, or invalidating its own source/reference chain, makes dependent storyboards stale; the validity check is iterative rather than recursive. Waiting, gain, fades, spatial settings and estimated clip duration do not change a clip's source identity. Rearranging which voice is adjacent can invalidate a saved continuity relationship.

Stale or incomplete storyboards stay visible and editable. Copy/TXT export requires a current source, complete title/visual/action/camera and a nonblank shared scene. Cancel, source changes, project/clip changes and manual editing stop an in-flight request; mismatched or late results cannot overwrite newer work. Regeneration errors preserve existing notes.

Working storage and PlannerSource accept optional scene descriptions and old V1 data. Project JSON, project duplication and revision storage retain valid optional `videoPlan`; a malformed block is dropped independently without discarding the original audio project or Planner draft. Temporarily empty editable fields remain saveable. Video edits merge into the latest project without cancelling audio generation or editing the audio arrangement. Mix and clip-generation fingerprints exclude video metadata. Candidate-adoption undo protection also excludes it; undo restores the prior audio while preserving the current video plan, so a storyboard bound to a replaced take naturally becomes stale.

## Verification and recovery

Evidence root: `I:/AI/asmr-director-clip-video/2026-10-01`. Four data/helper test files currently pass **116 tests** (`data-tests-final.log`); full TypeScript and owned-file ESLint also pass. These results cover metadata compatibility, actual-duration prompt use, independent/linked validity, stale propagation, persistence/revisions and audio undo.

Final full Vitest passes **86 files / 953 tests**, with one existing opt-in file/test skipped (`full-tests-final.log`). Full TypeScript, ESLint, diff check and production Webpack build pass (`typecheck-final.log`, `eslint-final.log`, `diff-check-final.log`, `build-final.log`). The existing Win32 SWC warning falls back successfully. Current production is **3001 / PID 25824 / `.next-clip-storyboard-production` / HTTP 200**; temporary 3002 is stopped. Native output stays on D:, with only the cache junction targeting the evidence root's `next-cache`. See [AI_HANDOFF](../../AI_HANDOFF.md) for the explicit restart command and [the development record](../../records/2026-10-01-audio-quality-v1-clip-video-storyboards.md) for scoped evidence.

`browser-verification.json` records **three successful DeepSeek-v4-pro calls**: shared scene, independent third clip and fourth clip with third-clip continuity. Clipboard readback confirms exact current engineering dialogue, rather than draft/previous dialogue, measured **3.24 / 8.59 seconds**, `fully_copy` and `N/A`. The fourth prompt contains previous visual/action/camera continuity but not the third clip's dialogue; a fresh fifth-clip checkbox is off. An unadopted second clip cannot generate. Editing the preceding camera makes its dependent shot stale with notes retained and copy disabled; restoring it restores availability. Empty global scene disables generation/copy. Scene, shots, continuity and exact copied prompt persist after reload. Planner's original seven texts remain exact, and its scene and enabled regenerate control survive reload.

The existing **22 voice clips / seven Planner sections**, engineering title, dialogue and timeline labels/timing remain unchanged. All **76 WAV SHA-256 values** are identical (`audio-hashes-before.json`, `audio-hashes-after.json`). Desktop **1768×1252**, **390×844** and **320×740** fit their document bounds with inspector scrolling; the mobile per-line entry selects the correct panel and focuses its visible storyboard tab. Console errors: zero. Screenshots were inspected in tool output, not saved. TXT download was triggered; Blob contents and filename have automated proof, while the browser-downloaded file was not reopened.

This iteration prepares text prompts and pairs them with an existing adopted audio download. There were **zero TTS and zero video-generation calls**. It does not upload images. Real text-model checks above do not constitute a rendered H3 video, visual-video quality or listening acceptance. No commit or push is requested for this feature.
