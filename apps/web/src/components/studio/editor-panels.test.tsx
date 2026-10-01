// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorPanels } from "./editor-panels";

afterEach(() => { cleanup(); });

describe("受控工程面板切换", () => {
  it("opens panel one on request, reports both tab changes and preserves mounted editor drafts", () => {
    const onPanelChange = vi.fn();
    const panels = (activePanel: number) => <StrictMode><EditorPanels activePanel={activePanel} onPanelChange={onPanelChange}>
      <div><label>测试文案草稿<input aria-label="测试文案草稿" defaultValue="原文" /></label></div>
      <div><label>测试声音面板草稿<input aria-label="测试声音面板草稿" defaultValue="声音设置" /></label></div>
    </EditorPanels></StrictMode>;
    const view = render(panels(1));
    const script = screen.getByLabelText("测试文案草稿") as HTMLInputElement;
    const inspector = screen.getByLabelText("测试声音面板草稿") as HTMLInputElement;
    const scriptTab = screen.getByRole("tab", { name: "文案" });
    const inspectorTab = screen.getByRole("tab", { name: "声音与分镜" });
    expect(inspectorTab.getAttribute("aria-selected")).toBe("true");
    expect(scriptTab.getAttribute("aria-selected")).toBe("false");
    expect(script.isConnected && inspector.isConnected).toBe(true);
    fireEvent.change(script, { target: { value: "文案面板尚未提交的修改" } });
    fireEvent.change(inspector, { target: { value: "声音面板尚未提交的修改" } });

    fireEvent.click(scriptTab);
    expect(onPanelChange).toHaveBeenCalledExactlyOnceWith(0);
    // Controlled state only changes when the parent acknowledges the callback.
    expect(inspectorTab.getAttribute("aria-selected")).toBe("true");
    view.rerender(panels(0));
    expect(scriptTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("测试文案草稿")).toBe(script);
    expect(screen.getByLabelText("测试声音面板草稿")).toBe(inspector);
    expect(script.value).toBe("文案面板尚未提交的修改");
    expect(inspector.value).toBe("声音面板尚未提交的修改");

    fireEvent.click(inspectorTab);
    expect(onPanelChange).toHaveBeenLastCalledWith(1);
    view.rerender(panels(1));
    expect(inspectorTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("测试文案草稿")).toBe(script);
    expect(screen.getByLabelText("测试声音面板草稿")).toBe(inspector);
    expect(script.value).toBe("文案面板尚未提交的修改");
    expect(inspector.value).toBe("声音面板尚未提交的修改");
  });
});
