// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoProject } from "@/lib/asmr/mock-project";
import type { AsmrProject, VoiceClip } from "@/lib/asmr/schema";
import { createClipVideoSourceFingerprint, getPreviousClipPromptFingerprint, type ClipVideoStoryboard } from "@/lib/asmr/video-plan";
import { flattenClips } from "@/lib/asmr/view-model";
import { ScriptEditorPanel } from "./script-editor-panel";
import { StudioBatchActions } from "./studio-batch-actions";

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

function storyboardFixture(): Props {
  const input = fixture();
  input.project.videoPlan = { version: 1, sceneDescription: "木屋内，暖灯亮着。", shots: {} };
  for (const clip of flattenClips(input.project).filter((clip) => clip.type === "voice")) {
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `adopted_${clip.id}`, uri: `asset://clip/adopted_${clip.id}`, duration: 3.21 };
  }
  return input;
}

function saveShot(project: AsmrProject, clip: VoiceClip, patch: Partial<ClipVideoStoryboard> = {}) {
  const shot: ClipVideoStoryboard = {
    version: 1, promptFormat: "minimax-h3", clipId: clip.id,
    sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
    audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: clip.asset.duration! },
    title: "灯下陪伴", visual: "S1 sits beside the table in warm light.",
    action: "S1 gently holds the bowl with the mouth visible.", camera: "Static medium close-up.",
    ...patch,
  };
  project.videoPlan!.shots[clip.id] = shot;
  return shot;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("台词上下调整", () => {
  it("exposes compact controls on every voice row and forwards the displayed clip identity", () => {
    const input = fixture();
    input.project.timeline.tracks.find((track) => track.track_type === "voice")!.clips.reverse();
    const onMoveClip = vi.fn();
    render(<ScriptEditorPanel {...input} onMoveClip={onMoveClip} />);
    const voices = flattenClips(input.project).filter((clip) => clip.type === "voice");
    expect(screen.getAllByRole("button", { name: /^上移第 \d+ 段$/u })).toHaveLength(voices.length);
    expect(screen.getAllByRole("button", { name: /^下移第 \d+ 段$/u })).toHaveLength(voices.length);
    const firstUp = screen.getByRole("button", { name: "上移第 1 段" }) as HTMLButtonElement;
    const lastDown = screen.getByRole("button", { name: `下移第 ${voices.length} 段` }) as HTMLButtonElement;
    expect(firstUp.disabled).toBe(true);
    expect(lastDown.disabled).toBe(true);
    fireEvent.click(firstUp); fireEvent.click(lastDown);
    expect(onMoveClip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "下移第 1 段" }));
    fireEvent.click(screen.getByRole("button", { name: "上移第 3 段" }));
    expect(onMoveClip).toHaveBeenNthCalledWith(1, voices[0].id, "down");
    expect(onMoveClip).toHaveBeenNthCalledWith(2, voices[2].id, "up");
    expect(input.onSelectClip).not.toHaveBeenCalled();
    expect(input.onUpdateClip).not.toHaveBeenCalled();
    expect(input.onOpenStoryboard).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "下移第 1 段" }).closest("[data-clip-move-controls]")!.className).toContain("h-8 w-12");
  });

  it("disables all ordering controls during a busy operation and restores boundary restrictions afterward", () => {
    const input = fixture();
    const onMoveClip = vi.fn();
    const view = render(<ScriptEditorPanel {...input} onMoveClip={onMoveClip} busy />);
    for (const button of screen.getAllByRole("button", { name: /^(?:上移|下移)第 \d+ 段$/u })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(onMoveClip).not.toHaveBeenCalled();
    view.rerender(<ScriptEditorPanel {...input} onMoveClip={onMoveClip} />);
    expect((screen.getByRole("button", { name: "下移第 1 段" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "上移第 1 段" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("retains the selected text range and leaves storyboard actions available alongside ordering", () => {
    const input = fixture();
    const first = flattenClips(input.project).find((clip) => clip.type === "voice")!;
    input.selectedClipId = first.id;
    const onMoveClip = vi.fn();
    render(<ScriptEditorPanel {...input} onMoveClip={onMoveClip} onReferenceModeChange={vi.fn()} />);
    const field = screen.getByRole("textbox", { name: "台词" }) as HTMLTextAreaElement;
    field.setSelectionRange(2, 8); fireEvent.select(field);
    vi.mocked(input.onSelectClip).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "下移第 1 段" }));
    expect(field.selectionStart).toBe(2); expect(field.selectionEnd).toBe(8);
    expect(input.onSelectClip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "选区独立成段" }));
    expect(input.onSplitClip).toHaveBeenCalledExactlyOnceWith(first.id, 2, 8);
    fireEvent.click(screen.getByRole("button", { name: "第 1 段视频分镜" }));
    expect(input.onOpenStoryboard).toHaveBeenCalledExactlyOnceWith(first.id);
  });

  it("keeps existing callers compatible when no ordering callback is supplied", () => {
    render(<ScriptEditorPanel {...fixture()} />);
    expect(screen.queryByRole("button", { name: "上移第 1 段" })).toBeNull();
    expect(screen.getByRole("button", { name: "第 1 段视频分镜" })).toBeTruthy();
  });
});

describe("每段视频分镜入口", () => {
  it("shows independent ready, pending and incomplete storyboard markers inside the existing right-side buttons", () => {
    const input = storyboardFixture();
    const [first, second, third] = flattenClips(input.project).filter((clip) => clip.type === "voice");
    saveShot(input.project, first);
    saveShot(input.project, third, { camera: "" });
    input.audioStates = { [first.id]: "pending", [second.id]: "adopted", [third.id]: "adopted" };
    const before = structuredClone(input.project);
    render(<StrictMode><ScriptEditorPanel {...input} onReferenceModeChange={vi.fn()} /></StrictMode>);
    for (const [index, state, label, color] of [
      [1, "ready", "分镜已生成", "bg-emerald-200"],
      [2, "pending", "分镜待生成", "bg-slate-400"],
      [3, "needs_update", "分镜待更新", "bg-amber-200"],
    ] as const) {
      const marker = screen.getByRole("img", { name: `第 ${index} 段分镜状态：${label}` });
      const button = screen.getByRole("button", { name: `第 ${index} 段视频分镜` });
      expect(marker.dataset.storyboardState).toBe(state);
      expect(marker.className).toContain(color);
      expect(button.contains(marker)).toBe(true);
      expect(button.title).toContain(label);
      expect(button.className).toContain("h-8 w-8");
      expect(button.parentElement!.className).toContain("grid-cols-[22px_minmax(0,1fr)_32px_32px]");
    }
    expect(screen.getByRole("img", { name: "第 1 段音频状态：待生成" }).dataset.audioState).toBe("pending");
    expect(screen.getByRole("img", { name: "第 3 段音频状态：已采用" }).dataset.audioState).toBe("adopted");
    expect(screen.getAllByRole("img", { name: /^第 \d+ 段分镜状态：/u })).toHaveLength(4);
    expect(input.project).toEqual(before);
    expect(input.onUpdateClip).not.toHaveBeenCalled();
    expect(input.onOpenStoryboard).not.toHaveBeenCalled();
  });

  it.each(["dialogue", "audio", "background"] as const)("refreshes a ready marker to needs-update after a %s source edit without overwriting the saved shot", (source) => {
    const input = storyboardFixture();
    const clip = flattenClips(input.project).find((clip) => clip.type === "voice")!;
    const saved = structuredClone(saveShot(input.project, clip));
    const view = render(<ScriptEditorPanel {...input} />);
    expect(screen.getByRole("img", { name: "第 1 段分镜状态：分镜已生成" }).dataset.storyboardState).toBe("ready");
    const changed = structuredClone(input.project);
    const changedClip = flattenClips(changed).find((item) => item.id === clip.id)!;
    if (source === "dialogue" && changedClip.type === "voice") changedClip.text += "慢慢吃。";
    if (source === "audio") changedClip.asset = { asset_id: "another_take", uri: "asset://clip/another_take", duration: 3.21 };
    if (source === "background") changed.videoPlan!.sceneDescription += "窗外正在下雨。";
    view.rerender(<ScriptEditorPanel {...input} project={changed} />);
    expect(screen.getByRole("img", { name: "第 1 段分镜状态：分镜待更新" }).dataset.storyboardState).toBe("needs_update");
    expect(changed.videoPlan!.shots[clip.id]).toEqual(saved);
    expect(input.onUpdateClip).not.toHaveBeenCalled();
  });

  it("updates a dependent marker when its predecessor is edited while leaving the usable predecessor green", () => {
    const input = storyboardFixture();
    const [first, second] = flattenClips(input.project).filter((clip) => clip.type === "voice");
    saveShot(input.project, first);
    const saved = structuredClone(saveShot(input.project, second, {
      previousClipId: first.id,
      previousPromptFingerprint: getPreviousClipPromptFingerprint(input.project, second.id),
      referenceMode: "continuous",
    }));
    const view = render(<ScriptEditorPanel {...input} onReferenceModeChange={vi.fn()} />);
    expect(screen.getByRole("img", { name: "第 2 段分镜状态：分镜已生成" }).dataset.storyboardState).toBe("ready");
    const changed = structuredClone(input.project);
    changed.videoPlan!.shots[first.id].visual += " The bowl is now beside S1.";
    view.rerender(<ScriptEditorPanel {...input} project={changed} onReferenceModeChange={vi.fn()} />);
    expect(screen.getByRole("img", { name: "第 1 段分镜状态：分镜已生成" }).dataset.storyboardState).toBe("ready");
    expect(screen.getByRole("img", { name: "第 2 段分镜状态：分镜待更新" }).dataset.storyboardState).toBe("needs_update");
    expect(screen.getByRole("button", { name: /^第 2 段：连续镜头，点击/u }).dataset.referenceMode).toBe("continuous");
    expect(changed.videoPlan!.shots[second.id]).toEqual(saved);
    expect(input.onSelectClip).not.toHaveBeenCalled();
    expect(input.onUpdateClip).not.toHaveBeenCalled();
  });

  it("places a compact mode toggle to the right of each storyboard entry and changes only the requested preference", () => {
    const input = fixture(); const onReferenceModeChange = vi.fn();
    const [first, second] = flattenClips(input.project).filter((clip) => clip.type === "voice");
    input.project.videoPlan = { version: 1, sceneDescription: "木屋内。", shots: {}, referenceModes: { [first.id]: "continuous", [second.id]: "new" } };
    const component = () => <StrictMode><ScriptEditorPanel {...input} onReferenceModeChange={onReferenceModeChange} /></StrictMode>;
    const view = render(component());
    const firstToggle = screen.getByRole("button", { name: /^第 1 段：新镜头。首段/u }) as HTMLButtonElement;
    expect(firstToggle.disabled).toBe(true); expect(firstToggle.title).toContain("首段"); expect(firstToggle.dataset.referenceMode).toBe("new");
    fireEvent.click(firstToggle); expect(onReferenceModeChange).not.toHaveBeenCalled();
    const newToggle = screen.getByRole("button", { name: "第 2 段：新镜头，点击切换为连续镜头（用于下次生成）" });
    const storyboard = screen.getByRole("button", { name: "第 2 段视频分镜" });
    expect(storyboard.nextElementSibling).toBe(newToggle); expect(newToggle.title).toBe(newToggle.getAttribute("aria-label"));
    expect(newToggle.className).toContain("h-8 w-8"); expect(newToggle.className).toContain("text-cyan-200");
    const newIcon = newToggle.querySelector("svg")!.outerHTML;
    expect(newToggle.parentElement!.className).toContain("grid-cols-[22px_minmax(0,1fr)_32px_32px]");
    fireEvent.click(newToggle); expect(onReferenceModeChange).toHaveBeenCalledExactlyOnceWith(second.id, "continuous");
    input.project.videoPlan.referenceModes![second.id] = "continuous"; view.rerender(component());
    const continuousToggle = screen.getByRole("button", { name: "第 2 段：连续镜头，点击切换为新镜头（用于下次生成）" });
    expect(continuousToggle.getAttribute("aria-pressed")).toBe("true"); expect(continuousToggle.className).toContain("text-violet-200");
    expect(continuousToggle.querySelector("svg")!.outerHTML).not.toBe(newIcon);
    fireEvent.click(continuousToggle); expect(onReferenceModeChange).toHaveBeenLastCalledWith(second.id, "new");
    expect(input.onSelectClip).not.toHaveBeenCalled(); expect(input.onOpenStoryboard).not.toHaveBeenCalled(); expect(input.onUpdateClip).not.toHaveBeenCalled();
  });

  it("preserves script selection across a mode toggle and locks preferences during generation", () => {
    const input = fixture(); const [first, second] = flattenClips(input.project).filter((clip) => clip.type === "voice");
    const onReferenceModeChange = vi.fn(); input.selectedClipId = first.id;
    const component = (referenceModeBusy: boolean) => <ScriptEditorPanel {...input} referenceModeBusy={referenceModeBusy} onReferenceModeChange={onReferenceModeChange} />;
    const view = render(component(false));
    const field = screen.getByRole("textbox", { name: "台词" }) as HTMLTextAreaElement;
    field.setSelectionRange(2, 8); fireEvent.select(field); vi.mocked(input.onSelectClip).mockClear();
    const toggle = screen.getByRole("button", { name: /^第 2 段：连续镜头，点击/u }) as HTMLButtonElement;
    fireEvent.click(toggle); expect(onReferenceModeChange).toHaveBeenCalledExactlyOnceWith(second.id, "new");
    expect(field.selectionStart).toBe(2); expect(field.selectionEnd).toBe(8);
    expect(input.onSelectClip).not.toHaveBeenCalled(); expect(input.onOpenStoryboard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "选区独立成段" })); expect(input.onSplitClip).toHaveBeenCalledExactlyOnceWith(first.id, 2, 8);
    onReferenceModeChange.mockClear(); view.rerender(component(true)); expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle); expect(onReferenceModeChange).not.toHaveBeenCalled();
    view.rerender(component(false)); expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle); expect(onReferenceModeChange).toHaveBeenCalledExactlyOnceWith(second.id, "new");
  });

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

describe("批量工具条位置与编辑行为", () => {
  it("places batch actions between the existing header and scrollable script without replacing header commands", () => {
    const input = fixture();
    input.canUndo = true;
    const onRun = vi.fn();
    const counts = { audio_missing: 2, audio_ungenerated: 1, audio_all: 5, storyboard_missing: 3, storyboard_all: 4 };
    render(<ScriptEditorPanel {...input} batchActions={<StudioBatchActions counts={counts} onRun={onRun} onCancel={vi.fn()} />} />);
    const toolbar = screen.getByRole("group", { name: "批量生成" });
    const scroller = screen.getByRole("textbox", { name: "第 1 段台词" }).closest("[data-script-scroll]")!;
    const heading = screen.getByRole("heading", { name: "文案与分段" });
    expect(scroller.contains(toolbar)).toBe(false);
    expect(heading.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toolbar.compareDocumentPosition(scroller) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "撤回编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "新增一段" }));
    expect(input.onUndo).toHaveBeenCalledOnce();
    const lastVoice = flattenClips(input.project).filter((clip) => clip.type === "voice").at(-1)!;
    expect(input.onAddClip).toHaveBeenCalledExactlyOnceWith(lastVoice.id);
    expect(onRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "音频全部生成" }));
    expect(onRun).toHaveBeenCalledExactlyOnceWith("audio_missing");
    expect(input.onUpdateClip).not.toHaveBeenCalled();
    expect(input.onSplitClip).not.toHaveBeenCalled();
  });

  it("preserves selected text and manual edits while batch progress follows the existing busy behavior", () => {
    const input = fixture();
    const clip = input.project.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0];
    clip.text = "第一句。第二句。第三句。";
    input.selectedClipId = clip.id;
    const counts = { audio_missing: 2, audio_ungenerated: 1, audio_all: 5, storyboard_missing: 3, storyboard_all: 4 };
    const onRun = vi.fn();
    const onCancel = vi.fn();
    const view = render(<ScriptEditorPanel {...input} batchActions={<StudioBatchActions counts={counts} onRun={onRun} onCancel={onCancel} />} />);
    const field = screen.getByRole("textbox", { name: "台词" }) as HTMLTextAreaElement;
    field.setSelectionRange(2, 8);
    fireEvent.select(field);
    fireEvent.click(screen.getByRole("button", { name: "分镜全部生成" }));
    view.rerender(<ScriptEditorPanel {...input} busy batchActions={<StudioBatchActions counts={counts} onRun={onRun} onCancel={onCancel} progress={{ action: "storyboard_missing", total: 3, completed: 1, succeeded: 1, failed: 0, skipped: 0 }} />} />);
    expect(field.selectionStart).toBe(2);
    expect(field.selectionEnd).toBe(8);
    expect(field.value).toBe(clip.text);
    expect((screen.getByRole("button", { name: "生成选区音频" }) as HTMLButtonElement).disabled).toBe(true);
    const split = screen.getByRole("button", { name: "选区独立成段" }) as HTMLButtonElement;
    expect(split.disabled).toBe(false);
    fireEvent.click(split);
    expect(input.onSplitClip).toHaveBeenCalledExactlyOnceWith(clip.id, 2, 8);
    const edited = "手工修改后仍保留原文格式。";
    fireEvent.change(field, { target: { value: edited } });
    expect(input.onUpdateClip).toHaveBeenCalledExactlyOnceWith(clip.id, { text: edited });
    expect(onRun).toHaveBeenCalledExactlyOnceWith("storyboard_missing");
    expect(onCancel).not.toHaveBeenCalled();
  });
});
