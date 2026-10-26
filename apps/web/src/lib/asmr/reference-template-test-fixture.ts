import type { CreativeTemplate } from "./reference-template";

export const referenceTemplateFixture: CreativeTemplate = {
  id: "secret-shop", version: 1, title: "秘密小店", summary: "安静的道具交易角色扮演。",
  source: { filename: "reference.mp4", durationSeconds: 64.46, analysisBasis: "画面与字幕人工观察" },
  creativePrompt: "用小声商量和逐件展示推进原创剧情。", sceneDescription: "巷口的安静小店。",
  storyboardRules: "固定近景，一次一件道具，先放下再取下一件。",
  beats: [{ id: "greet", title: "警戒", referenceRange: "00:00–00:08", story: "确认周围安静。", visual: "近景。", action: "轻轻示意。", camera: "固定。", sound: "自然轻声。", continuity: "双手空闲。" }],
};
