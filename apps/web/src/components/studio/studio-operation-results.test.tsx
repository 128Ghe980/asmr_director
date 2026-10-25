// @vitest-environment jsdom
import { StrictMode, useEffect } from "react";
import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioOperationResults } from "./studio-operation-results";

const nativeDialogMethods = new Map((["showModal", "close"] as const).map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]));
beforeEach(() => {
  // JSDOM has the element type but does not implement the native top-layer APIs.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = true; }) });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = false; }) });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); document.body.style.overflow = "";
  for (const [name, descriptor] of nativeDialogMethods) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

function pointerDown(dialog: HTMLDialogElement, x: number, y: number, target: Element = dialog) {
  const event = createEvent.pointerDown(target, { clientX: x, clientY: y });
  fireEvent(target, event);
}
function bounds(dialog: HTMLDialogElement) {
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({ left: 100, top: 100, right: 700, bottom: 600, width: 600, height: 500, x: 100, y: 100, toJSON: () => ({}) });
}

describe("compact operation results", () => {
  it("shows a single-line summary while keeping full details outside the script layout", () => {
    const detail = "第 005 镜失败：" + "very-long-unbroken-result".repeat(100);
    const view = render(<StudioOperationResults summary="批量生成完成：成功 14 · 失败 10"><p>{detail}</p></StudioOperationResults>);
    const trigger = screen.getByRole("button", { name: "查看结果" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("status").className).toContain("truncate");
    expect(screen.queryByText(detail)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "操作结果" });
    expect(dialog.id).toBe(trigger.getAttribute("aria-controls"));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText(detail).textContent).toBe(detail);
    expect(view.container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.querySelectorAll(".overflow-y-auto")).toHaveLength(1);
    expect(dialog.className).toContain("100dvh");
    expect(dialog.className).toContain("100vw");
  });

  it("opens a native modal, locks background scrolling, and returns focus on close", () => {
    document.body.style.overflow = "scroll";
    render(<StrictMode><StudioOperationResults summary="校对 2 镜"><button>应用修订</button></StudioOperationResults></StrictMode>);
    const trigger = screen.getByRole("button", { name: "查看结果" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭操作结果" }));
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "关闭操作结果" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledOnce();
    expect(document.body.style.overflow).toBe("scroll");
    expect(document.activeElement).toBe(trigger);
  });

  it("handles the native Escape cancellation without invoking any result action", () => {
    const apply = vi.fn();
    render(<StudioOperationResults summary="校对建议"><button onClick={apply}>应用修订</button></StudioOperationResults>);
    const trigger = screen.getByRole("button", { name: "查看结果" });
    fireEvent.click(trigger);
    const event = new Event("cancel", { bubbles: false, cancelable: true });
    fireEvent(screen.getByRole("dialog"), event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses only a backdrop click and preserves clicks or drags starting in the result panel", () => {
    render(<StudioOperationResults summary="结果"><p>完整错误说明</p></StudioOperationResults>);
    fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
    const dialog = screen.getByRole("dialog") as HTMLDialogElement;
    bounds(dialog);
    pointerDown(dialog, 200, 200);
    fireEvent.click(dialog, { clientX: 200, clientY: 200 });
    expect(screen.getByRole("dialog")).toBe(dialog);
    pointerDown(dialog, 200, 200, screen.getByText("完整错误说明"));
    fireEvent.click(dialog, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("dialog")).toBe(dialog);
    pointerDown(dialog, 10, 10);
    fireEvent.click(dialog, { clientX: 10, clientY: 10 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cleans preview children on close, remounts on demand, and keeps updated result text complete", () => {
    const mounted = vi.fn(), released = vi.fn(), action = vi.fn();
    function Preview() { useEffect(() => { mounted(); return released; }, []); return <button onClick={action}>试听已存结果</button>; }
    const view = render(<StudioOperationResults summary="后处理 1/2"><Preview /><p>旧结果</p></StudioOperationResults>);
    expect(mounted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
    expect(mounted).toHaveBeenCalledOnce();
    view.rerender(<StudioOperationResults summary="后处理 2/2"><Preview /><p>新结果全文</p></StudioOperationResults>);
    expect(screen.getByRole("status").textContent).toBe("后处理 2/2");
    expect(within(screen.getByRole("dialog")).getByText("新结果全文")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭操作结果" }));
    expect(released).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(action).not.toHaveBeenCalled();
    view.unmount();
    expect(released).toHaveBeenCalledTimes(2);
    expect(document.body.style.overflow).toBe("");
  });
});
