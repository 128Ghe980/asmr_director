// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StudioBatchAction } from "@/lib/asmr/studio-batch-generation";
import { StudioBatchActions } from "./studio-batch-actions";

type Props = Parameters<typeof StudioBatchActions>[0];

const actions: { action: StudioBatchAction; name: string }[] = [
  { action: "audio_missing", name: "音频全部生成" },
  { action: "audio_ungenerated", name: "生成未生成" },
  { action: "audio_all", name: "音频全部重新生成" },
  { action: "storyboard_missing", name: "分镜全部生成" },
  { action: "storyboard_all", name: "分镜全部重新生成" },
];

function fixture(): Props {
  return {
    counts: { audio_missing: 2, audio_ungenerated: 1, audio_all: 5, storyboard_missing: 3, storyboard_all: 4 },
    onRun: vi.fn(), onCancel: vi.fn(),
  };
}

function openMoreActions() {
  const summary = screen.getByLabelText("批量更多操作");
  if (!summary.closest("details")!.open) fireEvent.click(summary);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("studio batch actions", () => {
  it("labels all five actions distinctly, shows their eligible counts, and forwards the selected action", () => {
    const props = fixture();
    render(<StudioBatchActions {...props} />);
    openMoreActions();
    for (const [index, { action, name }] of actions.entries()) {
      const button = screen.getByRole("button", { name });
      expect(button.textContent).toContain(String(props.counts[action]));
      fireEvent.click(button);
      expect(props.onRun).toHaveBeenNthCalledWith(index + 1, action);
    }
    expect(props.onRun).toHaveBeenCalledTimes(5);
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "音频全部生成" }).title).toBe("生成当前页缺失或待更新的音频，沿用当前声音设置。");
    expect(screen.getByRole("button", { name: "音频全部重新生成" }).title).toBe("按当前页声音设置重新生成全部音频。");
    expect(screen.getByRole("button", { name: "生成未生成" }).title).toContain("当前可用候选");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("disables only actions without eligible clips and restores them when counts change", () => {
    const props = fixture();
    props.counts.audio_missing = 0;
    props.counts.audio_ungenerated = 0;
    props.counts.storyboard_missing = 0;
    const view = render(<StudioBatchActions {...props} />);
    openMoreActions();
    for (const { action, name } of actions) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(props.counts[action] === 0);
      fireEvent.click(button);
    }
    expect(props.onRun).toHaveBeenCalledTimes(2);
    expect(props.onRun).toHaveBeenNthCalledWith(1, "audio_all");
    expect(props.onRun).toHaveBeenNthCalledWith(2, "storyboard_all");
    view.rerender(<StudioBatchActions {...props} counts={{ ...props.counts, audio_missing: 1, audio_ungenerated: 2 }} />);
    fireEvent.click(screen.getByRole("button", { name: "音频全部生成" }));
    expect(props.onRun).toHaveBeenLastCalledWith("audio_missing");
    fireEvent.click(screen.getByRole("button", { name: "生成未生成" }));
    expect(props.onRun).toHaveBeenLastCalledWith("audio_ungenerated");
  });

  it("honors an external busy state even when all five counts are positive", () => {
    const props = fixture();
    render(<StudioBatchActions {...props} disabled />);
    openMoreActions();
    for (const { name } of actions) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(props.onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "取消批量生成" })).toBeNull();
  });

  it.each(["loading", "error"] as const)("waits for audio settings while keeping storyboard actions available: %s", (audioSettingsStatus) => {
    const props = fixture();
    const view = render(<StudioBatchActions {...props} audioSettingsStatus={audioSettingsStatus} />);
    openMoreActions();
    for (const { action, name } of actions) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(action.startsWith("audio"));
      if (action.startsWith("audio")) fireEvent.click(button);
    }
    expect(props.onRun).not.toHaveBeenCalled();
    expect(screen.getByText(audioSettingsStatus === "loading" ? "正在读取声音设置…" : "声音设置读取失败，请刷新重试。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "分镜全部生成" }));
    expect(props.onRun).toHaveBeenCalledWith("storyboard_missing");
    view.rerender(<StudioBatchActions {...props} audioSettingsStatus="ready" />);
    fireEvent.click(screen.getByRole("button", { name: "生成未生成" }));
    expect(props.onRun).toHaveBeenLastCalledWith("audio_ungenerated");
    expect(screen.queryByText("正在读取声音设置…")).toBeNull();
    expect(screen.queryByText("声音设置读取失败，请刷新重试。")).toBeNull();
  });

  it.each(["loading", "error"] as const)("disables only ungenerated audio and hides its count while the overview is %s", (overviewStatus) => {
    const props = fixture();
    const view = render(<StudioBatchActions {...props} overviewStatus={overviewStatus} />);
    openMoreActions();
    for (const { action, name } of actions) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(action === "audio_ungenerated");
    }
    const button = screen.getByRole("button", { name: "生成未生成" });
    expect(button.textContent).toContain("—");
    fireEvent.click(button);
    expect(props.onRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "音频全部生成" }));
    expect(props.onRun).toHaveBeenCalledExactlyOnceWith("audio_missing");
    view.rerender(<StudioBatchActions {...props} overviewStatus="ready" />);
    expect((screen.getByRole("button", { name: "生成未生成" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "生成未生成" }).textContent).toContain("1");
    fireEvent.click(screen.getByRole("button", { name: "生成未生成" }));
    expect(props.onRun).toHaveBeenLastCalledWith("audio_ungenerated");
  });

  it("reports completed clips and outcomes while preventing another run and allowing cancellation", () => {
    const props = fixture();
    render(<StudioBatchActions {...props} disabled progress={{ action: "audio_all", total: 5, completed: 3, succeeded: 1, failed: 1, skipped: 1, currentClipId: "voice-4" }} />);
    openMoreActions();
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

  it("shows the interval between audio tasks and keeps cancellation available", () => {
    const props = fixture();
    const view = render(<StudioBatchActions {...props} progress={{ action: "audio_ungenerated", total: 3, completed: 1, succeeded: 1, failed: 0, skipped: 0, waitingBetweenItems: true }} />);
    expect(screen.getByRole("status").textContent).toContain("任务间隔中（5 秒）");
    fireEvent.click(screen.getByRole("button", { name: "取消批量生成" }));
    expect(props.onCancel).toHaveBeenCalledOnce();
    view.rerender(<StudioBatchActions {...props} progress={{ action: "audio_missing", total: 3, completed: 1, succeeded: 1, failed: 0, skipped: 0, currentClipId: "next" }} />);
    expect(screen.queryByText("任务间隔中（5 秒）")).toBeNull();
  });

  it("keeps primary generation visible and puts both regeneration actions in one expandable menu", () => {
    render(<StudioBatchActions {...fixture()} />);
    const audio = screen.getByRole("group", { name: "批量音频" });
    const storyboard = screen.getByRole("group", { name: "批量分镜" });
    expect(within(audio).getAllByRole("button")).toHaveLength(2);
    const primary = within(audio).getByRole("button", { name: "音频全部生成" });
    const ungenerated = within(audio).getByRole("button", { name: "生成未生成" });
    expect(primary.textContent).toContain("生成音频");
    expect(primary.nextElementSibling).toBe(ungenerated);
    expect(within(storyboard).getAllByRole("button")).toHaveLength(1);
    const menu = screen.getByLabelText("批量更多操作").closest("details")!;
    expect(menu.open).toBe(false);
    openMoreActions();
    expect(menu.open).toBe(true);
    expect(screen.getByRole("button", { name: "音频全部重新生成" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "分镜全部重新生成" })).toBeTruthy();
    expect(within(menu).getAllByRole("button")).toHaveLength(2);
    expect(within(menu).queryByRole("button", { name: "生成未生成" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "生成未生成" })).toHaveLength(1);
    const layout = audio.parentElement!;
    expect(layout).toBe(storyboard.parentElement);
    // jsdom cannot measure responsive CSS: verify the compact wrapping layout.
    expect(layout.classList.contains("flex")).toBe(true);
    expect(layout.classList.contains("flex-wrap")).toBe(true);
    expect(layout.parentElement?.classList.contains("@container")).toBe(true);
  });
});
