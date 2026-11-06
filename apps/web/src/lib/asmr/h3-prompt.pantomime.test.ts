import { describe, expect, it } from "vitest";
import { renderConciseH3Prompt } from "./h3-prompt";

const directions = {
  visual: "S1 faces the camera with empty hands at lower chest height.",
  action: "S1 gently pinches the air below the lens, spreads both hands, then pauses.",
  camera: "Fixed frontal medium close-up.", dialogue: "领口有点歪，我帮你弄好。",
  durationSeconds: 3.2, storyboardStyle: "listener_pov" as const,
};

describe("camera pantomime final H3 contract", () => {
  it.each([false, true])("uses supplied non-vocal audio without requesting a second generated track, pantomime=%s", pantomime => {
    const prompt = renderConciseH3Prompt({ ...directions, silent: true, performance: true, pantomime,
      silentAudioReference: true, dialogue: "", ambientSound: "Legacy generated cloth sound." });
    expect(prompt).toContain("<Audio 1>: fully_copy");
    expect(prompt).toContain("supplied non-vocal ASMR track unchanged");
    expect(prompt).toContain("specified visible actions follow its rhythm");
    expect(prompt).toContain("without speaking or lip-sync movements");
    expect(prompt).toContain(`Action: ${directions.action}`);
    expect(prompt).toContain(`Visual: ${directions.visual}`);
    expect(prompt).not.toContain("Legacy generated cloth sound");
    expect(prompt).not.toContain("<d>");
    expect(prompt).not.toContain("Generate only this quiet natural ambient sound");
    expect(prompt).not.toContain("Produce the specified textures");
    if (pantomime) expect(prompt).toContain("hands hold nothing");
  });

  it("keeps default silent prompts and all speech prompts unchanged by the export option", () => {
    const silent = { ...directions, silent: true, ambientSound: "Gentle rain." };
    expect(renderConciseH3Prompt({ ...silent, silentAudioReference: false })).toBe(renderConciseH3Prompt(silent));
    expect(renderConciseH3Prompt({ ...directions, silentAudioReference: true })).toBe(renderConciseH3Prompt(directions));
  });

  it("keeps dialogue verbatim while making only empty-hand actor gestures visible", () => {
    const prompt = renderConciseH3Prompt({ ...directions, pantomime: true });
    expect(prompt).toContain(`<d>[Chinese]${directions.dialogue}</d>`);
    expect(prompt).toContain("fully_copy");
    expect(prompt).toContain("full head, face, upper torso and connected arms");
    expect(prompt).toContain("hands hold nothing");
    expect(prompt).toContain("Mouth movements follow <Audio 1>");
    expect(prompt).not.toContain("may speak from outside");
    expect(prompt).not.toContain("when the listener walks");
  });

  it("permits material foley without generating its physical source in the main image", () => {
    const prompt = renderConciseH3Prompt({ ...directions, silent: true, performance: true,
      pantomime: true, dialogue: "", ambientSound: "Soft fabric-rubbing foley synchronized to the finger movements." });
    expect(prompt).toContain("synchronized foley");
    expect(prompt).toContain("Sound-producing materials are not visible scene objects");
    expect(prompt).toContain("S1 remains visible and performs silently");
    expect(prompt).not.toContain("do not invent props or contact sounds for facial reactions or mime");
    expect(prompt).not.toContain("S1 may be off-screen");
    expect(prompt).not.toContain("<Audio 1>");
  });

  it("leaves existing material performances and moving POV prompts unchanged by default", () => {
    const original = renderConciseH3Prompt({ ...directions, silent: true, performance: true, ambientSound: "Soft cloth rubbing." });
    expect(renderConciseH3Prompt({ ...directions, silent: true, performance: true, ambientSound: "Soft cloth rubbing.", pantomime: false })).toBe(original);
    expect(original).toContain("do not invent props or contact sounds for facial reactions or mime");
    expect(original).toContain("when the listener walks");
    expect(original).not.toContain("hands hold nothing");
  });

  it("keeps a quiet gaze still instead of forcing a gesture into every pantomime shot", () => {
    const prompt = renderConciseH3Prompt({ ...directions, pantomime: true, silent: true,
      dialogue: "", action: "S1 holds a calm gaze with hands resting below the frame.", ambientSound: "Very quiet room tone." });
    expect(prompt).toContain("quiet gaze and waiting remain still without added hand movements");
    expect(prompt).toContain("Action: S1 holds a calm gaze");
    expect(prompt).not.toContain("with small finger gestures");
  });
});
