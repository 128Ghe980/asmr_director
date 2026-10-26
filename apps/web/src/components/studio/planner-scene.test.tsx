// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlannerDraft } from "@/lib/asmr/planner";
import { PlannerSceneEditor } from "./planner-scene";

const draft: PlannerDraft = {
  title: "书店", scene: "雨夜书店", character: { role: "店员", personality: ["温柔"], speechStyle: ["自然"] },
  sections: [{ id: "one", title: "开场", text: "进来坐一会儿。", emotion: "平静", style: "自然", pace: "缓慢", direction: "", soundSuggestions: "", pauseAfter: "short", position: { pan: 0, distance: "near", movement: "static" } }],
};

afterEach(cleanup);

describe("PlannerSceneEditor", () => {
  it("shows a return action before a script exists and offers no generation or per-shot prompts", () => {
    const onBack = vi.fn();
    render(<PlannerSceneEditor draft={null} sceneDescription={null} busy={false} canGenerate={false} onGenerate={vi.fn()} onEdit={vi.fn()} onBack={onBack} />);
    expect(screen.queryByRole("button", { name: "生成背景" })).toBeNull();
    expect(screen.queryByLabelText("剧情背景")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "返回文案" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("edits a Chinese story background and passes preferences to generation", () => {
    const onEdit = vi.fn(); const onGenerate = vi.fn();
    render(<PlannerSceneEditor draft={draft} sceneDescription="雪地木屋内，壁炉温暖，窗外飘雪。" busy={false} canGenerate={true} onGenerate={onGenerate} onEdit={onEdit} onBack={vi.fn()} />);
    const field = screen.getByLabelText("剧情背景") as HTMLTextAreaElement;
    expect(field.maxLength).toBe(4000); expect(field.value).toBe("雪地木屋内，壁炉温暖，窗外飘雪。");
    expect(field.placeholder).toContain("雪地");
    expect(screen.queryByText(/英文/)).toBeNull();
    expect(screen.queryByText(/逐段分镜据此选取具体场景/)).toBeNull();
    fireEvent.change(field, { target: { value: "木屋中温暖安静，一扇窗朝向雪地。" } });
    expect(onEdit).toHaveBeenCalledExactlyOnceWith("木屋中温暖安静，一扇窗朝向雪地。");
    fireEvent.click(screen.getByText(/背景偏好/));
    fireEvent.change(screen.getByLabelText("背景生成要求"), { target: { value: "保留雪地木屋的温暖氛围。" } });
    fireEvent.click(screen.getByRole("button", { name: "重新生成背景" }));
    expect(onGenerate).toHaveBeenCalledExactlyOnceWith("保留雪地木屋的温暖氛围。");
    expect(screen.queryByText(/已采用音频逐段生成分镜/)).toBeNull();
    expect(screen.queryByText("H3 提示词")).toBeNull();
  });

  it.each([{ busy: true, canGenerate: true }, { busy: false, canGenerate: false }])("disables generation but keeps the scene editable for %j", ({ busy, canGenerate }) => {
    const onGenerate = vi.fn();
    render(<PlannerSceneEditor draft={draft} sceneDescription="A quiet room." busy={busy} canGenerate={canGenerate} onGenerate={onGenerate} onEdit={vi.fn()} onBack={vi.fn()} />);
    const generate = screen.getByRole("button", { name: "重新生成背景" }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true); fireEvent.click(generate); expect(onGenerate).not.toHaveBeenCalled();
    expect((screen.getByLabelText("剧情背景") as HTMLTextAreaElement).disabled).toBe(false);
  });
});
