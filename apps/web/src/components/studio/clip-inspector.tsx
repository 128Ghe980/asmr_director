"use client";

import type { ClipPatch } from "@/lib/asmr/edit-project";
import type { TimelineClip } from "@/lib/asmr/schema";
import { formatTimeRange, getPositionLabel } from "@/lib/asmr/view-model";

import { StatusBadge } from "./status-badge";

type ClipInspectorProps = {
  selectedClip: TimelineClip | undefined;
  onUpdateClip: (clipId: string, patch: ClipPatch) => void;
};

function getClipModelDetails(clip: TimelineClip): string {
  return `${clip.generation.model} · seed ${clip.generation.seed}`;
}

const distanceOptions: Array<TimelineClip["position"]["distance"]> = [
  "far",
  "mid",
  "near",
  "close",
  "very_close",
];

const movementOptions: Array<TimelineClip["position"]["movement"]> = [
  "static",
  "approach",
  "recede",
  "left_to_right",
  "right_to_left",
];

function InspectorField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 border-b border-white/[0.06] py-3 last:border-b-0">
      <span className="pt-2 text-xs font-semibold uppercase tracking-normal text-studio-muted">
        {label}
      </span>
      <span className="min-w-0">{children}</span>
    </label>
  );
}

function ReadOnlyRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 border-b border-white/[0.06] py-3 last:border-b-0">
      <dt className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
        {label}
      </dt>
      <dd className="min-w-0 text-sm text-studio-text">{value}</dd>
    </div>
  );
}

function controlClassName(extra = "") {
  return [
    "w-full rounded-md border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-studio-text outline-none transition",
    "focus:border-sky-300/45 focus:ring-2 focus:ring-sky-300/20",
    extra,
  ].join(" ");
}

function parseNumericInput(value: string): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

export function ClipInspector({
  selectedClip,
  onUpdateClip,
}: ClipInspectorProps) {
  if (!selectedClip) {
    return (
      <section className="rounded-lg border border-studio-line bg-studio-panel/88 p-4">
        <h2 className="text-sm font-semibold text-studio-text">Clip Inspector</h2>
        <p className="mt-3 text-sm text-studio-muted">No clip selected.</p>
      </section>
    );
  }

  function updateClip(patch: ClipPatch) {
    if (!selectedClip) {
      return;
    }

    onUpdateClip(selectedClip.id, patch);
  }

  return (
    <section className="rounded-lg border border-studio-line bg-studio-panel/88">
      <div className="flex h-12 items-center justify-between border-b border-studio-line px-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-studio-text">Clip Inspector</h2>
          <p className="truncate text-xs text-studio-muted">{selectedClip.id}</p>
        </div>
        <StatusBadge status={selectedClip.generation.status} />
      </div>

      <div className="px-4">
        {selectedClip.type === "voice" ? (
          <>
            <InspectorField label="Text">
              <textarea
                value={selectedClip.text}
                onChange={(event) => updateClip({ text: event.target.value })}
                className={controlClassName("min-h-24 resize-y leading-6")}
              />
            </InspectorField>
            <InspectorField label="Emotion">
              <input
                value={selectedClip.emotion}
                onChange={(event) => updateClip({ emotion: event.target.value })}
                className={controlClassName()}
              />
            </InspectorField>
            <InspectorField label="Style">
              <input
                value={selectedClip.style}
                onChange={(event) => updateClip({ style: event.target.value })}
                className={controlClassName()}
              />
            </InspectorField>
            <InspectorField label="Pace">
              <input
                value={selectedClip.pace}
                onChange={(event) => updateClip({ pace: event.target.value })}
                className={controlClassName()}
              />
            </InspectorField>
          </>
        ) : null}

        {selectedClip.type === "breath" ? (
          <InspectorField label="Breath">
            <input
              value={selectedClip.breath}
              onChange={(event) => updateClip({ breath: event.target.value })}
              className={controlClassName()}
            />
          </InspectorField>
        ) : null}

        {selectedClip.type === "sfx" ? (
          <InspectorField label="SFX">
            <input
              value={selectedClip.sfx}
              onChange={(event) => updateClip({ sfx: event.target.value })}
              className={controlClassName()}
            />
          </InspectorField>
        ) : null}

        {selectedClip.type === "ambience" ? (
          <>
            <InspectorField label="Room">
              <input
                value={selectedClip.ambience}
                onChange={(event) => updateClip({ ambience: event.target.value })}
                className={controlClassName()}
              />
            </InspectorField>
            <label className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 border-b border-white/[0.06] py-3">
              <span className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
                Loop
              </span>
              <span className="flex min-w-0 items-center">
                <input
                  type="checkbox"
                  checked={selectedClip.loop}
                  onChange={(event) => updateClip({ loop: event.target.checked })}
                  className="h-4 w-4 accent-sky-300"
                />
              </span>
            </label>
          </>
        ) : null}

        <div className="grid grid-cols-2 gap-3 border-b border-white/[0.06] py-3">
          <label>
            <span className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
              Start
            </span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={selectedClip.start}
              onChange={(event) =>
                updateClip({ start: parseNumericInput(event.target.value) })
              }
              className={controlClassName("mt-2")}
            />
          </label>
          <label>
            <span className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
              Duration
            </span>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={selectedClip.duration}
              onChange={(event) =>
                updateClip({ duration: parseNumericInput(event.target.value) })
              }
              className={controlClassName("mt-2")}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 border-b border-white/[0.06] py-3">
          <label>
            <span className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
              Volume
            </span>
            <input
              type="number"
              step={1}
              value={selectedClip.volume_db}
              onChange={(event) =>
                updateClip({ volume_db: parseNumericInput(event.target.value) })
              }
              className={controlClassName("mt-2")}
            />
          </label>
          <label>
            <span className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
              Pan
            </span>
            <input
              type="number"
              min={-1}
              max={1}
              step={0.01}
              value={selectedClip.position.pan}
              onChange={(event) =>
                updateClip({
                  position: { pan: parseNumericInput(event.target.value) },
                })
              }
              className={controlClassName("mt-2")}
            />
          </label>
        </div>

        <InspectorField label="Distance">
          <select
            value={selectedClip.position.distance}
            onChange={(event) =>
              updateClip({
                position: {
                  distance: event.target
                    .value as TimelineClip["position"]["distance"],
                },
              })
            }
            className={controlClassName()}
          >
            {distanceOptions.map((distance) => (
              <option key={distance} value={distance}>
                {distance}
              </option>
            ))}
          </select>
        </InspectorField>

        <InspectorField label="Move">
          <select
            value={selectedClip.position.movement}
            onChange={(event) =>
              updateClip({
                position: {
                  movement: event.target
                    .value as TimelineClip["position"]["movement"],
                },
              })
            }
            className={controlClassName()}
          >
            {movementOptions.map((movement) => (
              <option key={movement} value={movement}>
                {movement.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </InspectorField>

        <ReadOnlyRow
          label="Time"
          value={formatTimeRange(selectedClip.start, selectedClip.duration)}
        />
        <ReadOnlyRow
          label="Position"
          value={getPositionLabel(selectedClip.position)}
        />
        <ReadOnlyRow label="Model" value={getClipModelDetails(selectedClip)} />
        <ReadOnlyRow
          label="Status"
          value={<StatusBadge status={selectedClip.generation.status} />}
        />
      </div>
    </section>
  );
}
