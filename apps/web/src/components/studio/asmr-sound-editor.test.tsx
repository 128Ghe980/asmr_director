// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsmrSoundEditor, formatAsmrSound } from "./asmr-sound-editor";
import type { AsmrSound } from "@/lib/asmr/asmr-sound";

const sound: AsmrSound = { prompt: "Gentle cloth friction.", postProcessing: {
  start: { pan: -.5, distance: "near" }, end: { pan: .5, distance: "close" }, movement: "left_to_right", gainDb: -12,
} };
afterEach(cleanup);
describe("ASMR sound editing", () => {
  it("sets an explicit continuation only for an eligible speech segment", () => {
    const onChange = vi.fn(), trigger: AsmrSound = { ...sound, role: "trigger", mixMode: "overlay" };
    render(<AsmrSoundEditor sound={trigger} duration={2} disabled={false} canContinuePrevious onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "接续上一无台词段的 ASMR 动作" }));
    expect(onChange).toHaveBeenCalledWith({ ...trigger, continuation: "previous-silent" });
    expect(formatAsmrSound({ ...trigger, continuation: "previous-silent" })).toContain("接续上一无台词段的 ASMR 动作");
  });
  it("keeps an invalid saved continuation removable and clears it when choosing ambience", () => {
    const onChange = vi.fn(), continued: AsmrSound = { ...sound, role: "trigger", continuation: "previous-silent" };
    render(<AsmrSoundEditor sound={continued} duration={2} disabled={false} onChange={onChange} />);
    const option = screen.getByRole("checkbox", { name: "接续上一无台词段的 ASMR 动作" }) as HTMLInputElement;
    expect(option.checked).toBe(true); expect(option.disabled).toBe(false);
    fireEvent.click(option);
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("continuation");
    fireEvent.change(screen.getByLabelText("ASMR 声音用途"), { target: { value: "ambience" } });
    expect(onChange.mock.calls[1][0]).not.toHaveProperty("continuation");
  });
  it("does not offer continuation on silent or ineligible speech segments", () => {
    const view = render(<AsmrSoundEditor sound={sound} duration={2} disabled={false} onChange={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: "接续上一无台词段的 ASMR 动作" })).toBeNull();
    view.rerender(<AsmrSoundEditor sound={{ ...sound, role: "trigger" }} duration={2} disabled={false} silent canContinuePrevious onChange={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: "接续上一无台词段的 ASMR 动作" })).toBeNull();
  });
  it("opts into a sound role at its neutral level without losing prompt or spatial settings", () => {
    const onChange = vi.fn();
    render(<AsmrSoundEditor sound={sound} duration={2} disabled={false} onChange={onChange} />);
    expect((screen.getByLabelText("ASMR 声音用途") as HTMLSelectElement).value).toBe("legacy");
    fireEvent.change(screen.getByLabelText("ASMR 声音用途"), { target: { value: "ambience" } });
    expect(onChange).toHaveBeenCalledWith({ ...sound, role: "ambience", postProcessing: { ...sound.postProcessing, gainDb: -30 } });
  });
  it("shows balanced gain as a bounded trim and preserves that role when editing", () => {
    const balanced: AsmrSound = { ...sound, role: "trigger" };
    const onChange = vi.fn();
    render(<AsmrSoundEditor sound={balanced} duration={2} disabled={false} onChange={onChange} />);
    expect((screen.getByLabelText("ASMR 响度微调") as HTMLSelectElement).value).toBe("0");
    expect(screen.queryByLabelText("ASMR 叠加音量")).toBeNull();
    fireEvent.change(screen.getByLabelText("ASMR 响度微调"), { target: { value: "-3" } });
    expect(onChange).toHaveBeenCalledWith({ ...balanced, postProcessing: { ...sound.postProcessing, gainDb: -15 } });
    expect(formatAsmrSound(balanced)).toContain("主要触发音 · 响度微调 0 dB");
    expect(formatAsmrSound(sound)).toContain("-12 dB");
  });
  it("preserves an empty in-progress edit and commits meaningful prompt text on blur", () => {
    const onChange = vi.fn();
    render(<AsmrSoundEditor sound={sound} duration={2.123} disabled={false} onChange={onChange} />);
    expect(screen.getByText("环境与触发音 · 随本段音频时长")).toBeTruthy();
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
