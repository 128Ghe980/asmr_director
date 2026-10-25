"use client";

import { ListChecks, X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A compact entry keeps operation details out of the script column's layout. */
export function StudioOperationResults({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const backdropPointer = useRef(false);

  useLayoutEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);

  function outsideDialog(x: number, y: number, dialog: HTMLDialogElement) {
    const bounds = dialog.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  }

  return <>
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-studio-line bg-white/[0.02] px-3 py-1.5">
      <ListChecks className="h-3.5 w-3.5 shrink-0 text-studio-muted" aria-hidden="true" />
      <p role="status" aria-label="操作结果摘要" className="min-w-0 flex-1 truncate text-[11px] text-studio-muted">{summary}</p>
      <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId} onClick={() => setOpen(true)}
        className="min-h-7 shrink-0 rounded-md px-2 text-[11px] font-medium text-sky-100 hover:bg-sky-300/10 focus-visible:outline-2 focus-visible:outline-sky-300">查看结果</button>
    </div>
    {open && createPortal(<dialog ref={dialogRef} id={dialogId} aria-labelledby={titleId} aria-modal="true"
      onCancel={event => { event.preventDefault(); setOpen(false); }}
      onPointerDown={event => { backdropPointer.current = event.target === event.currentTarget && outsideDialog(event.clientX, event.clientY, event.currentTarget); }}
      onPointerCancel={() => { backdropPointer.current = false; }}
      onClick={event => {
        if (backdropPointer.current && event.target === event.currentTarget && outsideDialog(event.clientX, event.clientY, event.currentTarget)) setOpen(false);
        backdropPointer.current = false;
      }}
      className="fixed inset-0 m-auto flex max-h-[calc(100dvh-2rem)] w-[min(48rem,calc(100vw-2rem))] min-w-0 flex-col overflow-hidden rounded-xl border border-studio-line bg-studio-panel p-0 text-studio-text shadow-2xl outline-none backdrop:bg-black/65 backdrop:backdrop-blur-sm">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-studio-line px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">操作结果</h2>
        <button ref={closeRef} type="button" aria-label="关闭操作结果" onClick={() => setOpen(false)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-studio-muted hover:bg-white/5 hover:text-studio-text focus-visible:outline-2 focus-visible:outline-sky-300"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain break-words [overflow-wrap:anywhere]">{children}</div>
    </dialog>, document.body)}
  </>;
}
