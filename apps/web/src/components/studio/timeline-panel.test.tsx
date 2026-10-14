// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoProject } from "@/lib/asmr/mock-project";
import { TimelinePanel } from "./timeline-panel";

afterEach(cleanup);

describe("collapsible timeline", () => {
  it("starts as a compact bar without mounting clips or focusable tracks", () => {
    const view = render(<TimelinePanel project={demoProject} selectedClipId={undefined} onSelectClip={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: "展开时间线" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const tracks = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(tracks?.hidden).toBe(true);
    expect(tracks?.tabIndex).toBe(-1);
    expect(tracks?.childElementCount).toBe(0);
    expect(view.container.querySelectorAll("[aria-pressed]")).toHaveLength(0);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("expands the original tracks and preserves clip selection", () => {
    const onSelectClip = vi.fn();
    const voice = demoProject.timeline.tracks.find(track => track.track_type === "voice")!.clips[0];
    const view = render(<TimelinePanel project={demoProject} selectedClipId={voice.id} onSelectClip={onSelectClip} />);
    fireEvent.click(screen.getByRole("button", { name: "展开时间线" }));
    const toggle = screen.getByRole("button", { name: "收起时间线" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const tracks = screen.getByRole("region", { name: "时间线轨道" });
    expect(tracks.id).toBe(toggle.getAttribute("aria-controls"));
    expect(tracks.tabIndex).toBe(0);
    const selected = tracks.querySelector<HTMLButtonElement>('[aria-pressed="true"]')!;
    expect(selected.textContent).toContain(voice.text);
    fireEvent.click(selected);
    expect(onSelectClip).toHaveBeenCalledExactlyOnceWith(voice.id);
    const visibleClipCount = demoProject.timeline.tracks.filter(track => track.track_type !== "post_processing")
      .reduce((count, track) => count + track.clips.length, 0);
    expect(view.container.querySelectorAll("[aria-pressed]")).toHaveLength(visibleClipCount);
    fireEvent.click(toggle);
    expect(view.container.querySelectorAll("[aria-pressed]")).toHaveLength(0);
  });

  it("keeps the user's choice when timeline data changes", () => {
    const props = { selectedClipId: undefined, onSelectClip: vi.fn() };
    const view = render(<TimelinePanel project={demoProject} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "展开时间线" }));
    view.rerender(<TimelinePanel project={{ ...demoProject, duration: demoProject.duration + 2 }} {...props} />);
    expect(screen.getByRole("button", { name: "收起时间线" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "时间线轨道" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "收起时间线" }));
    view.rerender(<TimelinePanel project={demoProject} {...props} />);
    expect(screen.getByRole("button", { name: "展开时间线" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "时间线轨道" })).toBeNull();
  });

  it("reports controlled expansion so the page can release the bottom grid space", () => {
    const onExpandedChange = vi.fn();
    const props = { project: demoProject, selectedClipId: undefined, onSelectClip: vi.fn(), onExpandedChange };
    const view = render(<TimelinePanel {...props} expanded={false} />);
    fireEvent.click(screen.getByRole("button", { name: "展开时间线" }));
    expect(onExpandedChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.queryByRole("region", { name: "时间线轨道" })).toBeNull();
    view.rerender(<TimelinePanel {...props} expanded />);
    fireEvent.click(screen.getByRole("button", { name: "收起时间线" }));
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
    view.rerender(<TimelinePanel {...props} expanded={false} />);
    expect(screen.queryByRole("region", { name: "时间线轨道" })).toBeNull();
  });
});
