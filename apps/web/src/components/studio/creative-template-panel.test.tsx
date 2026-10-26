// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CREATIVE_TEMPLATES } from "@/lib/asmr/creative-templates";
import { CreativeTemplatePanel } from "./creative-template-panel";

afterEach(cleanup);

describe("the collapsible reference template library", () => {
  it("shows multiple independently collapsible templates without opening selected content", () => {
    const first = CREATIVE_TEMPLATES[0];
    const second = { ...first, id: "second", title: "雨夜陪伴", creativePrompt: "第二个模板的 Prompt" };
    const onApply = vi.fn(); const onUpdate = vi.fn();
    const view = render(<CreativeTemplatePanel templates={[first, second]} selected={second} disabled={false} onApply={onApply} onUpdate={onUpdate} onLoadDemo={vi.fn()} onRemove={vi.fn()} />);
    const firstCard = screen.getByLabelText(`模板：${first.title}`) as HTMLDetailsElement;
    const secondCard = screen.getByLabelText(`模板：${second.title}`) as HTMLDetailsElement;
    expect(firstCard.open).toBe(false); expect(secondCard.open).toBe(false);
    expect(view.container.querySelectorAll("details[open]")).toHaveLength(0);
    expect(screen.queryByText(first.source.analysisBasis)).toBeNull();
    fireEvent.click(firstCard.querySelector("summary")!);
    expect(firstCard.open).toBe(true); expect(secondCard.open).toBe(false);
    fireEvent.click(within(firstCard).getByRole("button", { name: "应用到创作设定" }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith(first);
    fireEvent.click(firstCard.querySelector("summary")!);
    expect(firstCard.open).toBe(false);
    fireEvent.click(secondCard.querySelector("summary")!);
    const prompt = within(secondCard).getByLabelText("模板创作提示词") as HTMLDetailsElement;
    fireEvent.click(prompt.querySelector("summary")!);
    fireEvent.change(within(secondCard).getByLabelText("模板创作 Prompt"), { target: { value: "修改第二个模板" } });
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ ...second, creativePrompt: "修改第二个模板" });
    expect(firstCard.open).toBe(false);
  });
});
