"use client";

import {
  Clock3,
  Ear,
  Heart,
  Minus,
  MoveLeft,
  MoveRight,
  Pause,
  Plus,
  Volume1,
  type LucideIcon,
} from "lucide-react";

import type { DirectorPreset } from "@/lib/asmr/director-presets";
import type {
  ClipFieldValidationIssues,
  ClipFieldValidationKey,
  ClipPatch,
  ClipTimingNudge,
  ProjectValidationIssue,
} from "@/lib/asmr/edit-project";
import type { GenerationSlot } from "@/lib/asmr/generation-summary";
import type { TimelineClip } from "@/lib/asmr/schema";
import {
  getDistanceLabel,
  getMovementLabel,
} from "@/lib/asmr/ui-copy";
import {
  formatTimeRange,
  getLocalizedPositionLabel,
} from "@/lib/asmr/view-model";

import { GenerationSlotList } from "./generation-slot-list";
import { StatusBadge } from "./status-badge";

type ClipInspectorProps = {
  fieldValidationIssues: ClipFieldValidationIssues;
  selectedClip: TimelineClip | undefined;
  selectedClipSlot: GenerationSlot | undefined;
  onApplyDirectorPreset: (clipId: string, preset: DirectorPreset) => void;
  onNudgeClipTiming: (clipId: string, nudge: ClipTimingNudge) => void;
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

type DirectorAction = {
  icon: LucideIcon;
  label: string;
  preset: DirectorPreset;
  title: string;
};

const directorActions: DirectorAction[] = [
  {
    icon: Heart,
    label: "更柔",
    preset: "softer",
    title: "让人声更柔和",
  },
  {
    icon: Ear,
    label: "更近",
    preset: "closer",
    title: "让人声更贴近",
  },
  {
    icon: MoveLeft,
    label: "左耳",
    preset: "left-ear",
    title: "放到左耳",
  },
  {
    icon: MoveRight,
    label: "右耳",
    preset: "right-ear",
    title: "放到右耳",
  },
  {
    icon: Pause,
    label: "停顿",
    preset: "add-pause",
    title: "增加表演停顿",
  },
  {
    icon: Volume1,
    label: "降低",
    preset: "quieter",
    title: "降低音量",
  },
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

function DirectorActionStrip({
  onApplyPreset,
}: {
  onApplyPreset: (preset: DirectorPreset) => void;
}) {
  return (
    <div className="border-b border-white/[0.06] py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
          导演动作
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {directorActions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.preset}
              type="button"
              onClick={() => onApplyPreset(action.preset)}
              title={action.title}
              aria-label={`${action.label}: ${action.title}`}
              className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-xs font-semibold text-studio-text transition-colors hover:border-sky-300/30 hover:bg-sky-300/12 focus:outline-none focus:ring-2 focus:ring-sky-300/35"
            >
              <Icon
                className="h-3.5 w-3.5 shrink-0 text-studio-gold"
                aria-hidden="true"
              />
              <span className="truncate">{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimingActionStrip({
  onNudge,
}: {
  onNudge: (nudge: ClipTimingNudge) => void;
}) {
  const timingActions = [
    {
      icon: Minus,
      label: "开始 -0.5秒",
      title: "选中片段提前 0.5 秒",
      nudge: { field: "start", delta: -0.5 },
    },
    {
      icon: Plus,
      label: "开始 +0.5秒",
      title: "选中片段延后 0.5 秒",
      nudge: { field: "start", delta: 0.5 },
    },
    {
      icon: Minus,
      label: "时长 -0.5秒",
      title: "选中片段缩短 0.5 秒",
      nudge: { field: "duration", delta: -0.5 },
    },
    {
      icon: Plus,
      label: "时长 +0.5秒",
      title: "选中片段延长 0.5 秒",
      nudge: { field: "duration", delta: 0.5 },
    },
  ] satisfies Array<{
    icon: LucideIcon;
    label: string;
    title: string;
    nudge: ClipTimingNudge;
  }>;

  return (
    <div className="border-b border-white/[0.06] py-3">
      <div className="mb-2 flex items-center gap-2">
        <Clock3 className="h-3.5 w-3.5 text-studio-gold" aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
          时间微调
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {timingActions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.label}
              type="button"
              onClick={() => onNudge(action.nudge)}
              title={action.title}
              aria-label={`${action.label}: ${action.title}`}
              className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-xs font-semibold text-studio-text transition-colors hover:border-sky-300/30 hover:bg-sky-300/12 focus:outline-none focus:ring-2 focus:ring-sky-300/35"
            >
              <Icon
                className="h-3.5 w-3.5 shrink-0 text-studio-gold"
                aria-hidden="true"
              />
              <span className="truncate">{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FieldError({
  id,
  issues,
}: {
  id: string;
  issues: ProjectValidationIssue[];
}) {
  if (issues.length === 0) {
    return null;
  }

  return (
    <span id={id} className="mt-2 block text-xs leading-5 text-amber-100">
      {issues.map((issue) => issue.message).join(" ")}
    </span>
  );
}

function controlClassName(extra = "", hasError = false) {
  return [
    "w-full rounded-md border px-3 py-2 text-sm text-studio-text outline-none transition",
    hasError
      ? "border-amber-300/55 bg-amber-300/[0.075] focus:border-amber-200/80 focus:ring-2 focus:ring-amber-300/20"
      : "border-white/[0.08] bg-black/20 focus:border-sky-300/45 focus:ring-2 focus:ring-sky-300/20",
    extra,
  ].join(" ");
}

function parseNumericInput(value: string): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

export function ClipInspector({
  fieldValidationIssues,
  selectedClip,
  selectedClipSlot,
  onApplyDirectorPreset,
  onNudgeClipTiming,
  onUpdateClip,
}: ClipInspectorProps) {
  if (!selectedClip) {
    return (
      <section className="rounded-lg border border-studio-line bg-studio-panel/88 p-4">
        <h2 className="text-sm font-semibold text-studio-text">片段检查</h2>
        <p className="mt-3 text-sm text-studio-muted">未选择片段。</p>
      </section>
    );
  }

  const selectedClipId = selectedClip.id;

  function updateClip(patch: ClipPatch) {
    if (!selectedClip) {
      return;
    }

    onUpdateClip(selectedClip.id, patch);
  }

  function applyPreset(preset: DirectorPreset) {
    if (!selectedClip) {
      return;
    }

    onApplyDirectorPreset(selectedClip.id, preset);
  }

  function nudgeTiming(nudge: ClipTimingNudge) {
    onNudgeClipTiming(selectedClipId, nudge);
  }

  function getFieldIssues(
    field: ClipFieldValidationKey,
  ): ProjectValidationIssue[] {
    return fieldValidationIssues[field] ?? [];
  }

  function hasFieldIssues(field: ClipFieldValidationKey): boolean {
    return getFieldIssues(field).length > 0;
  }

  function getFieldErrorId(field: ClipFieldValidationKey): string {
    return `clip-${selectedClipId}-${field.replaceAll(".", "-")}-error`;
  }

  function getFieldControlProps(field: ClipFieldValidationKey) {
    return hasFieldIssues(field)
      ? {
          "aria-describedby": getFieldErrorId(field),
          "aria-invalid": true as const,
        }
      : {};
  }

  return (
    <section className="rounded-lg border border-studio-line bg-studio-panel/88">
      <div className="flex h-12 items-center justify-between border-b border-studio-line px-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-studio-text">片段检查</h2>
          <p className="truncate text-xs text-studio-muted">{selectedClip.id}</p>
        </div>
        <StatusBadge status={selectedClip.generation.status} />
      </div>

      <div className="px-4">
        {selectedClip.type === "voice" ? (
          <DirectorActionStrip onApplyPreset={applyPreset} />
        ) : null}

        <TimingActionStrip onNudge={nudgeTiming} />

        {selectedClipSlot ? (
          <div className="border-b border-white/[0.06] py-3">
            <GenerationSlotList title="素材槽" slots={[selectedClipSlot]} compact />
          </div>
        ) : null}

        {selectedClip.type === "voice" ? (
          <>
            <InspectorField label="台词">
              <textarea
                value={selectedClip.text}
                onChange={(event) => updateClip({ text: event.target.value })}
                className={controlClassName(
                  "min-h-24 resize-y leading-6",
                  hasFieldIssues("text"),
                )}
                {...getFieldControlProps("text")}
              />
              <FieldError
                id={getFieldErrorId("text")}
                issues={getFieldIssues("text")}
              />
            </InspectorField>
            <InspectorField label="情绪">
              <input
                value={selectedClip.emotion}
                onChange={(event) => updateClip({ emotion: event.target.value })}
                className={controlClassName("", hasFieldIssues("emotion"))}
                {...getFieldControlProps("emotion")}
              />
              <FieldError
                id={getFieldErrorId("emotion")}
                issues={getFieldIssues("emotion")}
              />
            </InspectorField>
            <InspectorField label="风格">
              <input
                value={selectedClip.style}
                onChange={(event) => updateClip({ style: event.target.value })}
                className={controlClassName("", hasFieldIssues("style"))}
                {...getFieldControlProps("style")}
              />
              <FieldError
                id={getFieldErrorId("style")}
                issues={getFieldIssues("style")}
              />
            </InspectorField>
            <InspectorField label="语速">
              <input
                value={selectedClip.pace}
                onChange={(event) => updateClip({ pace: event.target.value })}
                className={controlClassName("", hasFieldIssues("pace"))}
                {...getFieldControlProps("pace")}
              />
              <FieldError
                id={getFieldErrorId("pace")}
                issues={getFieldIssues("pace")}
              />
            </InspectorField>
          </>
        ) : null}

        {selectedClip.type === "breath" ? (
          <InspectorField label="呼吸">
            <input
              value={selectedClip.breath}
              onChange={(event) => updateClip({ breath: event.target.value })}
              className={controlClassName("", hasFieldIssues("breath"))}
              {...getFieldControlProps("breath")}
            />
            <FieldError
              id={getFieldErrorId("breath")}
              issues={getFieldIssues("breath")}
            />
          </InspectorField>
        ) : null}

        {selectedClip.type === "sfx" ? (
          <InspectorField label="音效">
            <input
              value={selectedClip.sfx}
              onChange={(event) => updateClip({ sfx: event.target.value })}
              className={controlClassName("", hasFieldIssues("sfx"))}
              {...getFieldControlProps("sfx")}
            />
            <FieldError
              id={getFieldErrorId("sfx")}
              issues={getFieldIssues("sfx")}
            />
          </InspectorField>
        ) : null}

        {selectedClip.type === "ambience" ? (
          <>
            <InspectorField label="环境">
              <input
                value={selectedClip.ambience}
                onChange={(event) => updateClip({ ambience: event.target.value })}
                className={controlClassName("", hasFieldIssues("ambience"))}
                {...getFieldControlProps("ambience")}
              />
              <FieldError
                id={getFieldErrorId("ambience")}
                issues={getFieldIssues("ambience")}
              />
            </InspectorField>
            <label className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 border-b border-white/[0.06] py-3">
              <span className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
                循环
              </span>
              <span className="flex min-w-0 items-center">
                <input
                  type="checkbox"
                  checked={selectedClip.loop}
                  onChange={(event) => updateClip({ loop: event.target.checked })}
                  className="h-4 w-4 accent-sky-300"
                  {...getFieldControlProps("loop")}
                />
                <FieldError
                  id={getFieldErrorId("loop")}
                  issues={getFieldIssues("loop")}
                />
              </span>
            </label>
          </>
        ) : null}

        <div className="grid grid-cols-2 gap-3 border-b border-white/[0.06] py-3">
          <label>
            <span className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
              开始
            </span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={selectedClip.start}
              onChange={(event) =>
                updateClip({ start: parseNumericInput(event.target.value) })
              }
              className={controlClassName("mt-2", hasFieldIssues("start"))}
              {...getFieldControlProps("start")}
            />
            <FieldError
              id={getFieldErrorId("start")}
              issues={getFieldIssues("start")}
            />
          </label>
          <label>
            <span className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
              时长
            </span>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={selectedClip.duration}
              onChange={(event) =>
                updateClip({ duration: parseNumericInput(event.target.value) })
              }
              className={controlClassName("mt-2", hasFieldIssues("duration"))}
              {...getFieldControlProps("duration")}
            />
            <FieldError
              id={getFieldErrorId("duration")}
              issues={getFieldIssues("duration")}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 border-b border-white/[0.06] py-3">
          <label>
            <span className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
              音量
            </span>
            <input
              type="number"
              step={1}
              value={selectedClip.volume_db}
              onChange={(event) =>
                updateClip({ volume_db: parseNumericInput(event.target.value) })
              }
              className={controlClassName("mt-2", hasFieldIssues("volume_db"))}
              {...getFieldControlProps("volume_db")}
            />
            <FieldError
              id={getFieldErrorId("volume_db")}
              issues={getFieldIssues("volume_db")}
            />
          </label>
          <label>
            <span className="text-xs font-semibold uppercase tracking-normal text-studio-muted">
              声像
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
              className={controlClassName("mt-2", hasFieldIssues("position.pan"))}
              {...getFieldControlProps("position.pan")}
            />
            <FieldError
              id={getFieldErrorId("position.pan")}
              issues={getFieldIssues("position.pan")}
            />
          </label>
        </div>

        <InspectorField label="距离">
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
            className={controlClassName(
              "",
              hasFieldIssues("position.distance"),
            )}
            {...getFieldControlProps("position.distance")}
          >
            {distanceOptions.map((distance) => (
              <option key={distance} value={distance}>
                {getDistanceLabel(distance)}
              </option>
            ))}
          </select>
          <FieldError
            id={getFieldErrorId("position.distance")}
            issues={getFieldIssues("position.distance")}
          />
        </InspectorField>

        <InspectorField label="移动">
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
            className={controlClassName(
              "",
              hasFieldIssues("position.movement"),
            )}
            {...getFieldControlProps("position.movement")}
          >
            {movementOptions.map((movement) => (
              <option key={movement} value={movement}>
                {getMovementLabel(movement)}
              </option>
            ))}
          </select>
          <FieldError
            id={getFieldErrorId("position.movement")}
            issues={getFieldIssues("position.movement")}
          />
        </InspectorField>

        <ReadOnlyRow
          label="时间"
          value={formatTimeRange(selectedClip.start, selectedClip.duration)}
        />
        <ReadOnlyRow
          label="位置"
          value={getLocalizedPositionLabel(selectedClip.position)}
        />
        <ReadOnlyRow label="模型" value={getClipModelDetails(selectedClip)} />
        <ReadOnlyRow
          label="状态"
          value={<StatusBadge status={selectedClip.generation.status} />}
        />
      </div>
    </section>
  );
}
