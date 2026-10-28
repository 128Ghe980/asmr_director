import type { AsmrSound } from "./asmr-sound";

export const asmrSoundFixture: AsmrSound = {
  prompt: "A sleeve brushes softly over the wooden counter as a hand settles beside it, making a brief dry fabric rustle followed by a quiet pause.",
  postProcessing: {
    start: { pan: -.2, distance: "near" }, end: { pan: -.2, distance: "near" },
    movement: "static", gainDb: -12,
  },
};
