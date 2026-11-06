import type { StoryboardStyle } from "./storyboard-style";

type H3ShotDirections = {
  visual: string;
  action: string;
  camera: string;
  dialogue: string;
  durationSeconds?: number;
  silent?: boolean;
  ambientSound?: string;
  storyboardStyle?: StoryboardStyle;
  performance?: boolean;
  pantomime?: boolean;
  silentAudioReference?: boolean;
  nativeAsmrFocus?: boolean;
  separateSpeechAndAsmr?: boolean;
};

export const SEPARATE_ASMR_AUDIO_RETENTION = "<Audio 1>: partially_copy - Adopted narration. Mouth movements follow only the spoken words and pauses in <Audio 1>; keep the lips closed in speech gaps.\n<Audio 2>: partially_copy - Non-vocal ASMR on the same timeline. Time each indicated hand contact, release and still pause to <Audio 2>; continue the existing action. Use both tracks together in the final soundtrack without adding sounds or repeating the action.";

export const NATIVE_ASMR_FOCUS = "Treat this as a dedicated ASMR performance for relaxation and sleep. Make the specified tactile sounds gently present and clearly audible: preserve their material-specific attack, fine texture and short natural decay instead of uniform rustling or broadband hiss. Synchronize each sound onset, texture change and release with the specified visible action; contacts stop sounding when the action pauses. Keep room tone lower than the trigger, with restrained peaks, little room reverb, no cinematic effects and no added layers. Quiet gaze and waiting keep only the specified quiet ambience; do not invent contact sounds or new actions. No speech, whispering, breathing, mouth sounds, vocal sounds or music.";

/** Background and previous-shot context guide planning; only current directions are exported. */
export function renderConciseH3Prompt({ visual, action, camera, dialogue, durationSeconds, silent = false, ambientSound, storyboardStyle, performance = false, pantomime = false, silentAudioReference = false, nativeAsmrFocus = false, separateSpeechAndAsmr = false }: H3ShotDirections): string {
  return [
    "subject_definitions:",
    "<Subject 1> (S1): Appearance and outfit follow <Picture 1>, overriding written descriptions; it is a character reference, not the opening frame.",
    "",
    "retention_analysis:",
    silent && silentAudioReference
      ? "<Audio 1>: fully_copy - Use the entire supplied non-vocal ASMR track unchanged as the complete soundtrack, preserving its textures, rhythm and quiet pauses. Let the specified visible actions follow its rhythm without adding gestures during quiet waiting. Do not generate or add another soundtrack, speech, whispering, breathing, vocal sounds or music. S1 performs silently, without speaking or lip-sync movements."
      : silent ? pantomime
      ? `Sound is synchronized foley accompanying S1's empty-hand gestures: ${ambientSound?.trim() ?? ""} Produce the specified textures and pauses while the visible interaction space remains empty. Sound-producing materials are not visible scene objects. No speech, whispering, breathing, vocal sounds or music. No additional sound layers.`
      : performance || nativeAsmrFocus
      ? `Sound is the main content of this non-speaking performance: ${ambientSound?.trim() ?? ""} Match actual contacts and pauses to the action. Preserve intentional quiet; do not invent props or contact sounds for facial reactions or mime. No dialogue, speech, voice-over or music. No additional sound layers.`
      : `Generate only this quiet natural ambient sound: ${ambientSound?.trim() ?? ""} No dialogue, speech, voice-over or music. No other sounds.`
      : separateSpeechAndAsmr ? SEPARATE_ASMR_AUDIO_RETENTION
      : "<Audio 1>: fully_copy - Use the entire supplied speech track unchanged as the complete soundtrack, preserving words, voice, pace and pauses. Add no other sound.",
    ...(silent && nativeAsmrFocus && !silentAudioReference ? [NATIVE_ASMR_FOCUS] : []),
    "",
    `[Shot 1] One continuous shot${durationSeconds === undefined ? silent ? "." : " spanning the full supplied audio." : `, ${durationSeconds} seconds.`}`,
    `Visual: ${visual}`,
    `Action: ${action}`,
    `Camera: ${camera}`,
    ...(pantomime ? [
      "Performance: S1 performs empty-handed toward the fixed camera. Follow only the specified Action: when it calls for gestures, make them in open air in front of the lens; quiet gaze and waiting remain still without added hand movements. The full head, face, upper torso and connected arms remain together in one stable frontal medium close-up. Only S1 is visible. The interaction space stays empty; hands hold nothing, touch no surface, and remain separated from the lens. Gestures target the camera-facing space rather than S1's own body or outfit. Keep the face readable and the camera stationary; no inserts, reverse angles or extreme close-ups.",
    ] : performance ? ["Performance: Keep the established camera position, axis and eye height while S1 performs. Do not introduce cuts, reverse angles or cinematic camera moves. Change the viewpoint only when the described listener action actually changes it."] : []),
    ...(!pantomime && storyboardStyle === "listener_pov" ? ["Viewpoint: The camera is the listener's own eyes inside the scene, never a separate observer filming S1. Its position, eye height, facing direction and movement follow the listener's actual actions and the current story state. Preserve the listener's location when only S1 moves; when the listener walks, turns or sits, carry that first-person movement through the shot. Do not show the listener's face or cut to an external view."] : []),
    silent ? pantomime ? "S1 remains visible and performs silently, without speaking or lip-sync movements."
      : "S1 may be off-screen; follow the visual directions without adding a speaking person."
      : storyboardStyle === "listener_pov" && !pantomime
        ? `<Subject 1> (S1) speaks to the listener: <d>[Chinese]${dialogue}</d> When S1's mouth is visible, its movements follow ${separateSpeechAndAsmr ? "only the spoken words in <Audio 1>, never the trigger sounds" : "<Audio 1>"}, with lips closed during pauses and at the end. S1 may speak from outside the listener's current field of view when the story directs the listener to look elsewhere; do not turn the viewpoint back merely to frame the speaker.`
        : `<Subject 1> (S1) speaks on camera: <d>[Chinese]${dialogue}</d> Mouth movements follow ${separateSpeechAndAsmr ? "only the spoken words in <Audio 1>, never the trigger sounds" : "<Audio 1>"}; keep the mouth visible, with lips closed during pauses and at the end.`,
    "",
    "non_diegetic_music: N/A",
  ].join("\n");
}
