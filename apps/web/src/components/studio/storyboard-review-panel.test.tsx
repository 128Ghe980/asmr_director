// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryboardReview } from "@/lib/asmr/storyboard-review";
import type { PerformanceStoryboardPart } from "@/lib/asmr/video-plan";
import { StoryboardReviewPanel } from "./storyboard-review-panel";

const review: StoryboardReview = { inputFingerprint: "fixture", notes: ["只修动作衔接。"], changes: [{ clipId: "first", reason: "交接应完成。",
  before: { title: "递外套", visual: "Standing by door", action: "Waits for the coat", camera: "Medium shot" },
  after: { title: "递外套", visual: "Standing by door", action: "Receives the coat and lowers it", camera: "Medium shot" } }] };
afterEach(cleanup);
describe("storyboard review summary", () => {
  it("shows a parts-only change including the sound role and omits unchanged continuous parts", async () => {
    const part: PerformanceStoryboardPart = { durationSeconds: 5, visual: "The same wooden box remains in place.",
      action: "Keep gently tapping the box.", camera: "Stable listener viewpoint.", ambientSound: "Gentle taps.",
      asmrSound: { prompt: "Dry fingertip taps.", mixMode: "overlay", postProcessing: {
        start: { pan: 0, distance: "near" }, end: { pan: 0, distance: "near" }, movement: "static", gainDb: -6,
      } } };
    const before = { ...review.changes[0].before, parts: [part, structuredClone(part), structuredClone(part)] };
    const after = structuredClone(before);
    after.parts[1].action = "Slow the taps and let the last contact settle.";
    after.parts[1].asmrSound.mixMode = "replace";
    const partsOnly: StoryboardReview = { ...review, changes: [{ clipId: "first", reason: "让声音自然收住。", before, after }] };
    render(<StoryboardReviewPanel result={{ review: partsOnly, automatic: false, applied: false }} onApply={vi.fn()} onUndo={vi.fn()} />);
    expect(screen.queryByText(/连续表演 2/)).toBeNull();
    fireEvent.click(screen.getByText("校对改动与说明"));
    expect(await screen.findByText("连续表演 2 · 5–10 秒")).toBeTruthy();
    expect(screen.getByText("动作原文：Keep gently tapping the box.")).toBeTruthy();
    expect(screen.getByText("修订：Slow the taps and let the last contact settle.")).toBeTruthy();
    expect(screen.getByText(/ASMR 触发音原文：Dry fingertip taps\.[\s\S]*叠加到原声音/)).toBeTruthy();
    expect(screen.getByText(/修订：Dry fingertip taps\.[\s\S]*作为本段主声音/)).toBeTruthy();
    expect(screen.queryByText(/连续表演 1/)).toBeNull();
    expect(screen.queryByText(/连续表演 3/)).toBeNull();
    expect(screen.queryByText(/画面原文：/)).toBeNull();
  });
  it("keeps differences collapsed and never applies a pending manual proposal on render", async () => {
    const onApply = vi.fn();
    render(<StoryboardReviewPanel result={{ review, automatic: false, applied: false }} onApply={onApply} onUndo={vi.fn()} />);
    expect(screen.getByText(/尚未修改分镜/)).toBeTruthy();
    expect(document.querySelector("details")!.open).toBe(false);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("校对改动与说明"));
    expect(await screen.findByText("动作原文：Waits for the coat")).toBeTruthy();
    expect(screen.getByText("修订：Receives the coat and lowers it")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "应用修订" })); expect(onApply).toHaveBeenCalledOnce();
  });
  it("disables stale application and guards undo without hiding historical differences", () => {
    const undo = vi.fn(), view = render(<StoryboardReviewPanel result={{ review, automatic: false, applied: false }} current={false} onApply={vi.fn()} onUndo={undo} />);
    expect((screen.getByRole("button", { name: "应用修订" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/剧情或分镜已修改/)).toBeTruthy();
    view.rerender(<StoryboardReviewPanel result={{ review, automatic: true, applied: true }} canUndo={false} onApply={vi.fn()} onUndo={undo} />);
    expect((screen.getByRole("button", { name: "撤回校对" }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<StoryboardReviewPanel result={{ review, automatic: true, applied: true }} canUndo onApply={vi.fn()} onUndo={undo} />);
    fireEvent.click(screen.getByRole("button", { name: "撤回校对" })); expect(undo).toHaveBeenCalledOnce();
  });
  it("has no permanent empty results section and no pointless apply action for no changes", () => {
    const view = render(<StoryboardReviewPanel onApply={vi.fn()} onUndo={vi.fn()} />);
    expect(screen.queryByRole("region")).toBeNull();
    view.rerender(<StoryboardReviewPanel result={{ review: { ...review, changes: [] }, automatic: false, applied: false }} onApply={vi.fn()} onUndo={vi.fn()} />);
    expect(screen.getByText(/0 镜调整/)).toBeTruthy(); expect(screen.queryByRole("button")).toBeNull();
  });
});
