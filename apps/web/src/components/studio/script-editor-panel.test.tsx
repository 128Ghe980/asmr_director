// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoProject } from "@/lib/asmr/mock-project";
import { flattenClips } from "@/lib/asmr/view-model";
import { ScriptEditorPanel } from "./script-editor-panel";

type Props = Parameters<typeof ScriptEditorPanel>[0];

function fixture(): Props {
  const project = structuredClone(demoProject);
  return {
    project, selectedClipId: undefined, busy: false, canUndo: false,
    onSelectClip: vi.fn(), onUpdateClip: vi.fn(), onAddClip: vi.fn(), onDeleteClip: vi.fn(),
    onSplitClip: vi.fn(), onMergeClip: vi.fn(), onGapChange: vi.fn(), onRewriteClip: vi.fn(), onUndo: vi.fn(),
    onOpenStoryboard: vi.fn(),
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("每段视频分镜入口", () => {
  it("opens the exact voice clip in displayed chronological order without activating script-edit actions", () => {
    const input = fixture();
    input.project.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0].start = 80;
    const voices = flattenClips(input.project).filter((clip) => clip.type === "voice");
    render(<StrictMode><ScriptEditorPanel {...input} /></StrictMode>);
    expect(screen.getAllByRole("button", { name: /^第 \d+ 段视频分镜$/u })).toHaveLength(voices.length);
    for (const [index, clip] of voices.entries()) {
      fireEvent.click(screen.getByRole("button", { name: `第 ${index + 1} 段视频分镜` }));
      expect(input.onOpenStoryboard).toHaveBeenNthCalledWith(index + 1, clip.id);
    }
    expect(input.onSelectClip).not.toHaveBeenCalled();
    expect(input.onUpdateClip).not.toHaveBeenCalled();
    expect(input.onSplitClip).not.toHaveBeenCalled();
    expect(input.onAddClip).not.toHaveBeenCalled();
    expect(input.onDeleteClip).not.toHaveBeenCalled();
  });

  it("preserves a selected text range across opening its storyboard and still forwards subsequent manual edits", () => {
    const input = fixture();
    const clip = input.project.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0];
    clip.text = "第一句。第二句。第三句。";
    input.selectedClipId = clip.id;
    render(<StrictMode><ScriptEditorPanel {...input} /></StrictMode>);
    const field = screen.getByRole("textbox", { name: "台词" }) as HTMLTextAreaElement;
    fireEvent.focus(field);
    field.setSelectionRange(2, 8);
    fireEvent.select(field);
    vi.mocked(input.onSelectClip).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "第 1 段视频分镜" }));
    expect(input.onOpenStoryboard).toHaveBeenCalledExactlyOnceWith(clip.id);
    expect(input.onSelectClip).not.toHaveBeenCalled();
    expect(input.onUpdateClip).not.toHaveBeenCalled();
    expect(field.selectionStart).toBe(2);
    expect(field.selectionEnd).toBe(8);
    const split = screen.getByRole("button", { name: "选区独立成段" }) as HTMLButtonElement;
    expect(split.disabled).toBe(false);
    fireEvent.click(split);
    expect(input.onSplitClip).toHaveBeenCalledExactlyOnceWith(clip.id, 2, 8);
    const edited = "  手工修改，\n<d>仍保留原样</d>。 ";
    fireEvent.change(field, { target: { value: edited } });
    expect(input.onUpdateClip).toHaveBeenCalledExactlyOnceWith(clip.id, { text: edited });
    expect(input.onOpenStoryboard).toHaveBeenCalledOnce();
  });
});
