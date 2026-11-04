"use client";

import { useState } from "react";

export function SegmentPauseInput({ value, label, onChange }: { value: number; label: string; onChange: (seconds: number) => void }) {
  const [input, setInput] = useState(String(Number(value.toFixed(3))));
  return <label className="flex items-center gap-2 text-xs text-studio-muted">
    段间留白
    <input aria-label={label} type="number" min="0" max="30" step="0.05" value={input}
      className="w-20 rounded-md border border-studio-line bg-black/20 px-2 py-1.5 text-studio-text"
      onChange={(event) => setInput(event.target.value)}
      onBlur={() => { const seconds = Number(input); if (input.trim() && Number.isFinite(seconds) && seconds >= 0 && seconds <= 30) { if (Math.abs(seconds - value) > 0.0005) onChange(seconds); } else setInput(String(value)); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />秒
  </label>;
}
