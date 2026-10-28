// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsmrSoundEditor } from "./asmr-sound-editor";
import type { AsmrSound } from "@/lib/asmr/asmr-sound";

const sound: AsmrSound = { prompt: "Gentle cloth friction.", postProcessing: {
  start: { pan: -.5, distance: "near" }, end: { pan: .5, distance: "close" }, movement: "left_to_right", gainDb: -12,
} };
afterEach(cleanup);
describe("ASMR sound editing", () => {
  it("preserves an empty in-progress edit and commits meaningful prompt text on blur", () => {
    const onChange = vi.fn();
    render(<AsmrSoundEditor sound={sound} duration={2.123} disabled={false} onChange={onChange} />);
    expect(screen.getByText("ASMR 触发音 · 随本段音频时长")).toBeTruthy();
    const input = screen.getByLabelText("ASMR 触发音提示词");
    fireEvent.change(input, { target: { value: "" } }); fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe(sound.prompt);
    fireEvent.change(input, { target: { value: "Soft paper folds." } }); fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith({ ...sound, prompt: "Soft paper folds." });
  });
  it("keeps static anchors equal and retains API-selected gain when changing movement", () => {
    const onChange = vi.fn();
    render(<AsmrSoundEditor sound={sound} duration={2} disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("ASMR 声音移动"), { target: { value: "static" } });
    expect(onChange).toHaveBeenCalledWith({ ...sound, postProcessing: { ...sound.postProcessing, movement: "static", end: sound.postProcessing.start } });
    expect((screen.getByLabelText("ASMR H3 提示词") as HTMLTextAreaElement).value).toContain("No speech, whispering");
  });
});
