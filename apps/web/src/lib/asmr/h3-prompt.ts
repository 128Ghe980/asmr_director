type H3ShotDirections = {
  visual: string;
  action: string;
  camera: string;
  dialogue: string;
  durationSeconds?: number;
  silent?: boolean;
  ambientSound?: string;
};

/** Background and previous-shot context guide planning; only current directions are exported. */
export function renderConciseH3Prompt({ visual, action, camera, dialogue, durationSeconds, silent = false, ambientSound }: H3ShotDirections): string {
  return [
    "subject_definitions:",
    "<Subject 1> (S1): Appearance and outfit follow <Picture 1>, overriding written descriptions; it is a character reference, not the opening frame.",
    "",
    "retention_analysis:",
    silent ? `Generate only this quiet natural ambient sound: ${ambientSound?.trim() ?? ""} No dialogue, speech, voice-over or music. No other sounds.`
      : "<Audio 1>: fully_copy - Use the entire supplied speech track unchanged as the complete soundtrack, preserving words, voice, pace and pauses. Add no other sound.",
    "",
    `[Shot 1] One continuous shot${durationSeconds === undefined ? silent ? "." : " spanning the full supplied audio." : `, ${durationSeconds} seconds.`}`,
    `Visual: ${visual}`,
    `Action: ${action}`,
    `Camera: ${camera}`,
    silent ? "S1 may be off-screen; follow the visual directions without adding a speaking person."
      : `<Subject 1> (S1) speaks on camera: <d>[Chinese]${dialogue}</d> Mouth movements follow <Audio 1>; keep the mouth visible, with lips closed during pauses and at the end.`,
    "",
    "non_diegetic_music: N/A",
  ].join("\n");
}
