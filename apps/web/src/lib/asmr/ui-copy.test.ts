import { describe, expect, it } from "vitest";

import {
  getBinauralLabel,
  getClipTypeLabel,
  getDistanceLabel,
  getLanguageLabel,
  getLimiterLabel,
  getMovementLabel,
  getStatusLabel,
  getTrackLabel,
  getValueLabel,
  getValidationIssueMessage,
} from "./ui-copy";

describe("ui copy", () => {
  it("labels project and asset statuses in Chinese", () => {
    expect(getStatusLabel("ready_for_preview")).toBe("可预览");
    expect(getStatusLabel("timeline_invalid")).toBe("时间线错误");
    expect(getStatusLabel("asset_pending")).toBe("待生成");
    expect(getStatusLabel("asset_generated")).toBe("已生成");
  });

  it("labels tracks and clip types in Chinese", () => {
    expect(getTrackLabel("voice")).toBe("人声");
    expect(getTrackLabel("breath")).toBe("呼吸");
    expect(getTrackLabel("sfx")).toBe("音效");
    expect(getTrackLabel("ambience")).toBe("环境");
    expect(getTrackLabel("post_processing")).toBe("后期");
    expect(getClipTypeLabel("voice")).toBe("人声");
  });

  it("labels spatial options in Chinese", () => {
    expect(getDistanceLabel("very_close")).toBe("贴耳");
    expect(getDistanceLabel("far")).toBe("远");
    expect(getMovementLabel("left_to_right")).toBe("左到右");
    expect(getMovementLabel("static")).toBe("静止");
  });

  it("labels common timeline values in Chinese", () => {
    expect(getValueLabel("comforting")).toBe("安抚");
    expect(getValueLabel("sleepy_whisper")).toBe("困倦耳语");
    expect(getValueLabel("rain_room_tone")).toBe("雨夜房间");
    expect(getValueLabel("unknown_value")).toBe("unknown value");
  });

  it("labels header metadata in Chinese while preserving technical units", () => {
    expect(getLanguageLabel("zh")).toBe("中文");
    expect(getLanguageLabel("en")).toBe("EN");
    expect(getBinauralLabel(true)).toBe("双耳");
    expect(getBinauralLabel(false)).toBe("立体声");
    expect(getLimiterLabel(true)).toBe("限制器开");
    expect(getLimiterLabel(false)).toBe("限制器关");
  });

  it("translates common schema validation messages", () => {
    expect(
      getValidationIssueMessage("clip end must be within project duration"),
    ).toBe("片段结束不能超过项目总时长");
    expect(
      getValidationIssueMessage("Too big: expected number to be <=1"),
    ).toBe("数值不能大于 1");
    expect(getValidationIssueMessage("custom message")).toBe("custom message");
  });
});
