// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StudioBatchAction } from "@/lib/asmr/studio-batch-generation";
import { StudioBatchActions } from "./studio-batch-actions";

type Props = Parameters<typeof StudioBatchActions>[0];

const actions: { action: StudioBatchAction; name: string }[] = [
  { action: "audio_missing", name: "音频全部生成" },
  { action: "audio_all", name: "音频全部重新生成" },
  { action: "storyboard_missing", name: "分镜全部生成" },
  { action: "storyboard_all", name: "分镜全部重新生成" },
];

function fixture(): Props {
  return {
    counts: { audio_missing: 2, audio_all: 5, storyboard_missing: 3, storyboard_all: 4 },
    onRun: vi.fn(), onCancel: vi.fn(),
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("studio batch actions", () => {
  it("labels all four actions distinctly, shows their eligible counts, and forwards the selected action", () => {
    const props = fixture();
    render(<StudioBatchActions {...props} />);
    for (const [index, { action, name }] of actions.entries()) {
      const button = screen.getByRole("button", { name });
      expect(button.textContent).toContain(String(props.counts[action]));
      fireEvent.click(button);
      expect(props.onRun).toHaveBeenNthCalledWith(index + 1, action);
    }
    expect(props.onRun).toHaveBeenCalledTimes(4);
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "音频全部生成" }).title).toBe("生成尚未采用音频的段落，沿用当前声音设置。");
    expect(screen.getByRole("button", { name: "音频全部重新生成" }).title).toBe("按当前声音设置重新生成全部音频。");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("disables only actions without eligible clips and restores them when counts change", () => {
    const props = fixture();
    props.counts.audio_missing = 0;
    props.counts.storyboard_missing = 0;
    const view = render(<StudioBatchActions {...props} />);
    for (const { action, name } of actions) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(props.counts[action] === 0);
      fireEvent.click(button);
    }
    expect(props.onRun).toHaveBeenCalledTimes(2);
    expect(props.onRun).toHaveBeenNthCalledWith(1, "audio_all");
    expect(props.onRun).toHaveBeenNthCalledWith(2, "storyboard_all");
    view.rerender(<StudioBatchActions {...props} counts={{ ...props.counts, audio_missing: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "音频全部生成" }));
    expect(props.onRun).toHaveBeenLastCalledWith("audio_missing");
  });

  it("honors an external busy state even when all four counts are positive", () => {
    const props = fixture();
    render(<StudioBatchActions {...props} disabled />);
    for (const { name } of actions) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(props.onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull();
  });

  it("reports completed clips and outcomes while preventing another run and allowing cancellation", () => {
    const props = fixture();
    render(<StudioBatchActions {...props} disabled progress={{ action: "audio_all", total: 5, completed: 3, succeeded: 1, failed: 1, skipped: 1, currentClipId: "voice-4" }} />);
    for (const { name } of actions) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("音频 · 完成 3/5");
    expect(status.textContent).toContain("成功 1 · 失败 1 · 跳过 1");
    const bar = screen.getByRole("progressbar", { name: "音频批量进度" });
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
    expect(bar.getAttribute("aria-valuetext")).toBe("完成 3/5");
    const cancel = screen.getByRole("button", { name: "取消批量生成" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    fireEvent.click(cancel);
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onRun).not.toHaveBeenCalled();
  });

  it("updates storyboard progress and leaves a completion notice without keeping actions locked", () => {
    const props = fixture();
    const view = render(<StudioBatchActions {...props} progress={{ action: "storyboard_missing", total: 3, completed: 0, succeeded: 0, failed: 0, skipped: 0 }} />);
    expect(screen.getByRole("status").textContent).toBe("分镜 · 完成 0/3");
    view.rerender(<StudioBatchActions {...props} progress={{ action: "storyboard_missing", total: 3, completed: 2, succeeded: 2, failed: 0, skipped: 0 }} />);
    expect(screen.getByRole("progressbar", { name: "分镜批量进度" }).getAttribute("aria-valuenow")).toBe("2");
    view.rerender(<StudioBatchActions {...props} notice="分镜完成 3/3" />);
    expect(screen.getByRole("status").textContent).toBe("分镜完成 3/3");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "分镜全部生成" }));
    expect(props.onRun).toHaveBeenCalledExactlyOnceWith("storyboard_missing");
  });

  it("keeps each pair together in a fluid narrow-first layout that can expand within a wider panel", () => {
    render(<StudioBatchActions {...fixture()} />);
    const audio = screen.getByRole("group", { name: "批量音频" });
    const storyboard = screen.getByRole("group", { name: "批量分镜" });
    expect(within(audio).getAllByRole("button")).toHaveLength(2);
    expect(within(storyboard).getAllByRole("button")).toHaveLength(2);
    const layout = audio.parentElement!;
    expect(layout).toBe(storyboard.parentElement);
    // jsdom cannot measure responsive CSS: preserve the one-column default and a panel-width expansion.
    expect(layout.classList.contains("grid-cols-1")).toBe(true);
    expect([...layout.classList].some((name) => name.startsWith("@min-") && name.endsWith(":grid-cols-2"))).toBe(true);
    expect(layout.parentElement?.classList.contains("@container")).toBe(true);
  });
});
