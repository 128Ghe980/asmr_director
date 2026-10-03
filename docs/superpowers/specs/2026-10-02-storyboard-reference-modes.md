# Per-paragraph storyboard reference modes

Date: 2026-10-02. Scope: the existing Audio Quality V1 editing workflow.

The previous continuity checkbox becomes two exclusive next-generation settings:

- **Continuous shot / 连续镜头** (`continuous`): extend the usable immediately preceding voice shot's scene, lighting, framing and action, with the current paragraph's dialogue and adopted audio.
- **New shot / 新镜头** (`new`): prioritize the project story background and current dialogue to plan a fresh view or related location. A usable adjacent shot supplies secondary visual context. Without one, generation can proceed from the background alone.

The first voice paragraph always uses a new shot. Continuous generation requires a current complete adjacent storyboard; it cannot skip over a missing, stale or incomplete predecessor. The browser and server enforce this condition.

A compact icon toggle sits immediately right of each paragraph's storyboard entry. Link and framing icons distinguish the modes, with violet and cyan accents, accessible current-state/action labels and keyboard focus. The toggle changes the paragraph's preference without selecting it or opening its inspector. The inspector presents the same two modes as radio choices. Both surfaces are locked during generation.

Preferences persist in optional `videoPlan.referenceModes[clipId]`; saved generation provenance uses optional `shot.referenceMode`. Resolution is first-paragraph override, explicit preference, saved mode, then legacy predecessor presence (`continuous`) or absence (`new`). Existing projects and source fingerprints remain compatible. Changing a preference alone does not rewrite or invalidate an existing saved prompt.

Manual and serial batch generation send the resolved mode, use the latest saved predecessor and verify mode, source, adopted audio and predecessor provenance before accepting a result. Each accepted batch result is saved before the next paragraph is dispatched. New explicit modes send only predecessor title/visual/action/camera to the text model, avoiding repetition of prior dialogue, audio rules and full H3 prompts. The current audio remains the only final soundtrack.

Legacy API requests without `referenceMode` retain their existing `includePrevious` behavior. This change does not call a video-generation API or alter audio adoption. Verification is recorded in [the development record](../../records/2026-10-02-audio-quality-v1-storyboard-reference-modes.md).
