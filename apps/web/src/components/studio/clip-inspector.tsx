import type { TimelineClip } from "@/lib/asmr/schema";
import { formatTimeRange, getPositionLabel } from "@/lib/asmr/view-model";

import { StatusBadge } from "./status-badge";

type ClipInspectorProps = {
  selectedClip: TimelineClip | undefined;
};

function getClipContent(clip: TimelineClip): string {
  switch (clip.type) {
    case "voice":
      return clip.text;
    case "breath":
      return clip.breath.replaceAll("_", " ");
    case "sfx":
      return clip.sfx.replaceAll("_", " ");
    case "ambience":
      return clip.ambience.replaceAll("_", " ");
  }
}

function getClipModelDetails(clip: TimelineClip): string {
  return `${clip.generation.model} · seed ${clip.generation.seed}`;
}

function InspectorRow({
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

export function ClipInspector({ selectedClip }: ClipInspectorProps) {
  if (!selectedClip) {
    return (
      <section className="rounded-lg border border-studio-line bg-studio-panel/88 p-4">
        <h2 className="text-sm font-semibold text-studio-text">Clip Inspector</h2>
        <p className="mt-3 text-sm text-studio-muted">No clip selected.</p>
      </section>
    );
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

      <dl className="px-4">
        <InspectorRow label="Content" value={getClipContent(selectedClip)} />
        <InspectorRow
          label="Time"
          value={formatTimeRange(selectedClip.start, selectedClip.duration)}
        />
        <InspectorRow
          label="Position"
          value={getPositionLabel(selectedClip.position)}
        />
        <InspectorRow label="Volume" value={`${selectedClip.volume_db} dB`} />
        <InspectorRow label="Model" value={getClipModelDetails(selectedClip)} />
        <InspectorRow
          label="Status"
          value={<StatusBadge status={selectedClip.generation.status} />}
        />
      </dl>
    </section>
  );
}
