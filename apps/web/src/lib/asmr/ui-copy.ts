import type {
  AssetStatus,
  ProjectStatus,
  TimelineClip,
  TrackType,
} from "./schema";

type StatusLabelStatus = AssetStatus | ProjectStatus;

const statusLabels: Record<StatusLabelStatus, string> = {
  draft: "草稿",
  planning_failed: "规划失败",
  timeline_invalid: "时间线错误",
  ready_for_preview: "可预览",
  export_failed: "导出失败",
  asset_pending: "待生成",
  asset_generating: "生成中",
  asset_generated: "已生成",
  asset_failed: "生成失败",
};

const trackLabels: Record<TrackType, string> = {
  voice: "人声",
  breath: "呼吸",
  sfx: "音效",
  ambience: "环境",
  post_processing: "后期",
};

const clipTypeLabels: Record<TimelineClip["type"], string> = {
  voice: "人声",
  breath: "呼吸",
  sfx: "音效",
  ambience: "环境",
};

const distanceLabels: Record<TimelineClip["position"]["distance"], string> = {
  far: "远",
  mid: "中",
  near: "近",
  close: "贴近",
  very_close: "贴耳",
};

const movementLabels: Record<TimelineClip["position"]["movement"], string> = {
  static: "静止",
  approach: "靠近",
  recede: "远离",
  left_to_right: "左到右",
  right_to_left: "右到左",
  orbit: "定距环绕",
  orbit_approach: "环绕靠近",
};

const valueLabels: Record<string, string> = {
  gentle_intro: "温柔开场",
  comforting: "安抚",
  gentle: "温柔",
  sleepy_whisper: "困倦耳语",
  fade_out: "淡出",
  whisper: "耳语",
  soft: "轻柔",
  "soft whisper": "轻柔耳语",
  slow: "慢速",
  soft_breath: "轻呼吸",
  tiny_laugh: "轻笑",
  blanket_rustle: "被褥摩擦",
  cloth_rustle: "布料摩擦",
  rain_room_tone: "雨夜房间",
};

const validationMessageLabels: Record<string, string> = {
  "Import JSON could not be parsed.": "JSON 解析失败。",
  "clip end must be within project duration": "片段结束不能超过项目总时长",
  "clip start must be within project duration": "片段开始不能超过项目总时长",
  "emotion_curve point end must be greater than start":
    "情绪段结束必须晚于开始",
  "emotion_curve point end must be within project duration":
    "情绪段结束不能超过项目总时长",
  "emotion_curve point start must be within project duration":
    "情绪段开始不能超过项目总时长",
  "timeline.tracks must include exactly one of each required track type":
    "时间线必须包含每种固定轨道且只能包含一次",
  "Too big: expected number to be <=1": "数值不能大于 1",
  "Too small: expected number to be >=-1": "数值不能小于 -1",
  "Too small: expected number to be >0": "数值必须大于 0",
};

export function getStatusLabel(status: StatusLabelStatus): string {
  return statusLabels[status];
}

export function getTrackLabel(track: TrackType): string {
  return trackLabels[track];
}

export function getClipTypeLabel(type: TimelineClip["type"]): string {
  return clipTypeLabels[type];
}

export function getDistanceLabel(
  distance: TimelineClip["position"]["distance"],
): string {
  return distanceLabels[distance];
}

export function getMovementLabel(
  movement: TimelineClip["position"]["movement"],
): string {
  return movementLabels[movement];
}

export function getValueLabel(value: string): string {
  return valueLabels[value] ?? value.replaceAll("_", " ");
}

export function getLanguageLabel(language: string): string {
  return language === "zh" ? "中文" : language.toUpperCase();
}

export function getBinauralLabel(isBinaural: boolean): string {
  return isBinaural ? "双耳" : "立体声";
}

export function getLimiterLabel(isEnabled: boolean): string {
  return isEnabled ? "限制器开" : "限制器关";
}

export function getValidationIssueMessage(message: string): string {
  return validationMessageLabels[message] ?? message;
}
