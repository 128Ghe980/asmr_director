"use client";

import { FileJson, RotateCcw, Upload } from "lucide-react";
import { useState } from "react";

type ProjectControlsProps = {
  importError: string | undefined;
  isDirty: boolean;
  onImportJson: (text: string) => void;
  onResetDemo: () => void;
  restoreState: "demo" | "restored";
};

function getStateLabel({
  isDirty,
  restoreState,
}: {
  isDirty: boolean;
  restoreState: "demo" | "restored";
}) {
  if (isDirty) {
    return "Edited";
  }

  return restoreState === "restored" ? "Restored from browser" : "Demo";
}

export function ProjectControls({
  importError,
  isDirty,
  onImportJson,
  onResetDemo,
  restoreState,
}: ProjectControlsProps) {
  const [importText, setImportText] = useState("");
  const stateLabel = getStateLabel({ isDirty, restoreState });

  return (
    <section className="rounded-lg border border-studio-line bg-studio-panel/88">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-studio-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-studio-text">
            Project Controls
          </h2>
          <p className="text-xs text-studio-muted">
            Browser restore, pasted JSON import, and demo reset.
          </p>
        </div>
        <span
          className={
            isDirty
              ? "inline-flex items-center rounded-full border border-sky-300/35 bg-sky-300/10 px-3 py-1 text-xs font-semibold text-sky-100"
              : "inline-flex items-center rounded-full border border-white/[0.1] bg-white/[0.035] px-3 py-1 text-xs font-semibold text-studio-muted"
          }
        >
          {stateLabel}
        </span>
      </div>

      <div className="space-y-3 p-4">
        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-studio-muted">
            <FileJson className="h-4 w-4" aria-hidden="true" />
            Import JSON
          </span>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder="Paste an ASMR Project JSON here"
            className="min-h-28 w-full resize-y rounded-md border border-white/[0.08] bg-black/20 px-3 py-2 text-sm leading-6 text-studio-text outline-none transition placeholder:text-studio-muted/60 focus:border-sky-300/45 focus:ring-2 focus:ring-sky-300/20"
          />
        </label>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => onImportJson(importText)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-sky-300/25 bg-sky-300/12 px-4 text-sm font-semibold text-sky-100 transition-colors hover:bg-sky-300/18 focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            Load JSON
          </button>
          <button
            type="button"
            onClick={() => {
              setImportText("");
              onResetDemo();
            }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.035] px-4 text-sm font-semibold text-studio-text transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-sky-300/45"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reset Demo
          </button>
        </div>

        {importError ? (
          <div className="whitespace-pre-wrap rounded-md border border-amber-300/16 bg-amber-300/[0.055] px-3 py-2 text-sm leading-6 text-amber-100">
            {importError}
          </div>
        ) : null}
      </div>
    </section>
  );
}
