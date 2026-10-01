// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { updateClipInProject, type ClipPatch } from "@/lib/asmr/edit-project";
import { demoProject } from "@/lib/asmr/mock-project";
import type { TimelineClip } from "@/lib/asmr/schema";
import { ClipInspector } from "./clip-inspector";

function mountInspector(movement: TimelineClip["position"]["movement"] = "static", binaural = true, textEditorExternal = false) {
  const onUpdateClip = vi.fn<(clipId: string, patch: ClipPatch) => void>();
  const onApplyDirectorPreset = vi.fn();
  function Harness() {
    const [project, setProject] = useState(() => updateClipInProject(demoProject, "voice_002", {
      position: { pan: 0.32, distance: "mid", movement },
    }));
    const selectedClip = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips[1];
    return <ClipInspector
      binaural={binaural}
      textEditorExternal={textEditorExternal}
      fieldValidationIssues={{}}
      selectedClip={selectedClip}
      selectedClipGeneration={{ action: "generate", label: "生成", disabled: false, statusLabel: "待生成", tone: "neutral" }}
      selectedClipSlot={undefined}
      onApplyDirectorPreset={onApplyDirectorPreset}
      onGenerateSelectedClip={() => {}}
      onCancelSelectedGeneration={() => {}}
      onNudgeClipTiming={() => {}}
      onUpdateClip={(clipId, patch) => {
        onUpdateClip(clipId, patch);
        setProject((current) => updateClipInProject(current, clipId, patch));
      }}
    />;
  }
  render(<Harness />);
  return { onUpdateClip, onApplyDirectorPreset };
}

const movementControl = () => screen.getByRole("combobox", { name: /^移动/ }) as HTMLSelectElement;
const distanceControl = () => screen.getByRole("combobox", { name: /^距离/ }) as HTMLSelectElement;
const panControl = () => screen.getByRole("spinbutton", { name: /^声像/ }) as HTMLInputElement;

afterEach(cleanup);

describe("ClipInspector spatial controls", () => {
  it("shows a range summary without a duplicate editor when text is edited in the storyboard", () => {
    mountInspector("static", true, true);
    expect(screen.queryByRole("textbox", { name: "台词" })).toBeNull();
    const voice = demoProject.timeline.tracks.find((track) => track.track_type === "voice")!.clips[1];
    if (voice.type !== "voice") throw new Error("Expected a voice clip");
    expect(screen.getByLabelText("当前范围文本").textContent).toBe(voice.text);
    const generation = screen.getByRole("button", { name: "生成" });
    expect(generation.compareDocumentPosition(distanceControl()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const label of ["时间与微调", "表演与导演快捷", "素材与生成信息"]) {
      const details = screen.getByText(label).closest("details")!;
      expect(details.open).toBe(false);
      expect(distanceControl().compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("keeps the standalone text editor available by default", () => {
    const { onUpdateClip } = mountInspector();
    fireEvent.change(screen.getByRole("textbox", { name: "台词" }), { target: { value: "修改这句话。" } });
    expect(onUpdateClip).toHaveBeenLastCalledWith("voice_002", { text: "修改这句话。" });
  });

  it("offers both orbit routes and preserves existing movement options", () => {
    const { onUpdateClip } = mountInspector();
    expect(Array.from(movementControl().options, (option) => option.value)).toEqual([
      "static", "approach", "recede", "left_to_right", "right_to_left", "orbit", "orbit_approach",
    ]);
    fireEvent.change(movementControl(), { target: { value: "orbit" } });
    expect(onUpdateClip).toHaveBeenLastCalledWith("voice_002", { position: { movement: "orbit" } });
    expect(panControl().disabled).toBe(true);
    expect(panControl().value).toBe("");
    expect(distanceControl().disabled).toBe(false);
    expect(screen.getByText("空间说明").closest("details")?.open).toBe(false);
  });

  it.each(["far", "mid", "near", "close", "very_close"])("keeps the orbit while selecting %s distance", (distance) => {
    const { onUpdateClip } = mountInspector("orbit");
    fireEvent.change(distanceControl(), { target: { value: distance } });
    expect(onUpdateClip).toHaveBeenLastCalledWith("voice_002", { position: { distance } });
    expect(movementControl().value).toBe("orbit");
    expect(distanceControl().value).toBe(distance);
  });

  it("disables fields ignored by the approach route and restores their saved values when leaving it", () => {
    const { onApplyDirectorPreset } = mountInspector("orbit_approach");
    expect(panControl().disabled).toBe(true);
    expect(distanceControl().disabled).toBe(true);
    expect(distanceControl().selectedOptions[0].textContent).toBe("由远到近路线决定");
    expect(screen.getByText("从远处绕到近处，末段停留在近处。")).toBeTruthy();
    const closer = screen.getByRole("button", { name: "更近: 让人声更贴近" }) as HTMLButtonElement;
    expect(closer.disabled).toBe(true);
    fireEvent.click(closer);
    expect(onApplyDirectorPreset).not.toHaveBeenCalled();
    fireEvent.change(movementControl(), { target: { value: "static" } });
    expect(panControl().disabled).toBe(false);
    expect(panControl().value).toBe("0.32");
    expect(distanceControl().disabled).toBe(false);
    expect(distanceControl().value).toBe("mid");
    expect(closer.disabled).toBe(false);
  });

  it("makes the disabled binaural state explicit without silently replacing the selected orbit", () => {
    mountInspector("orbit", false);
    expect(screen.getByText("环绕需开启双耳空间；当前使用普通立体声。")).toBeTruthy();
    expect(movementControl().value).toBe("orbit");
  });
});
