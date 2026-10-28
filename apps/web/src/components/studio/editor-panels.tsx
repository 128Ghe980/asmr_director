"use client";

import { Children, useState, type ReactNode } from "react";

/** Keep both editors mounted while small screens show one working panel at a time. */
export function EditorPanels({ children, activePanel: controlledPanel, onPanelChange }: { children: ReactNode; activePanel?: number; onPanelChange?: (index: number) => void }) {
  const panels = Children.toArray(children);
  const [selectedPanel, setActivePanel] = useState(0);
  const activePanel = controlledPanel ?? selectedPanel;

  return <div className="flex min-h-0 min-w-0 flex-col gap-2">
    <div role="tablist" aria-label="工程面板" className="flex shrink-0 gap-1 rounded-md bg-white/[0.035] p-1 md:hidden">
      {["表演脚本", "声音与画面"].map((label, index) => <button
        key={label}
        type="button"
        role="tab"
        id={`editor-panel-tab-${index}`}
        aria-controls={`editor-panel-${index}`}
        aria-selected={activePanel === index}
        onClick={() => { setActivePanel(index); onPanelChange?.(index); }}
        className={`min-h-8 flex-1 rounded px-3 text-xs font-semibold ${activePanel === index ? "bg-sky-300/12 text-sky-100" : "text-studio-muted"}`}
      >{label}</button>)}
    </div>
    <div className="grid min-h-0 min-w-0 flex-1 gap-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.85fr)]">
      {panels.map((panel, index) => <div
        key={index}
        id={`editor-panel-${index}`}
        role="tabpanel"
        aria-labelledby={`editor-panel-tab-${index}`}
        className={`h-full min-h-0 min-w-0 overflow-hidden ${activePanel === index ? "block" : "hidden md:block"}`}
      >{panel}</div>)}
    </div>
  </div>;
}
