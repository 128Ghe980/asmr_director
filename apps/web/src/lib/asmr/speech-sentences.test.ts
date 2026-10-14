import { describe, expect, it } from "vitest";
import { splitSpeechSentences } from "./speech-sentences";

describe("exact natural speech sentences", () => {
  it("makes complete sentences visible without splitting every comma", () => {
    expect(splitSpeechSentences("你回来啦，门口的灯一直亮着。先坐一会儿，我给你倒杯茶。"))
      .toEqual(["你回来啦，门口的灯一直亮着。", "先坐一会儿，我给你倒杯茶。"]);
  });

  it.each([
    "  雨停了。 先喝茶！“晚安。”  ",
    "水温是 36.5 度，价格是 3.50 元。\nTake a breath. Then sit here!",
    "先坐下；我来倒茶。\r\n\r\n别着急？嗯……",
    "请打开 example.com，版本是 v1.2。明天见。",
    "", "  ", "……？！  ", "没有标点也要完整保留",
  ])("keeps all source characters in %j", (text) => {
    expect(splitSpeechSentences(text).join("")).toBe(text);
  });

  it("keeps decimals, names and trailing punctuation with their source sentence", () => {
    expect(splitSpeechSentences("  价格是 3.5 元。\n“等我。”  今天用 example.com！"))
      .toEqual(["  价格是 3.5 元。\n", "“等我。”  ", "今天用 example.com！"]);
    expect(splitSpeechSentences("先坐下；我来倒茶。" )).toEqual(["先坐下；", "我来倒茶。"]);
    expect(splitSpeechSentences('Dr. Lee said "Hello." Then sit here.'))
      .toEqual(['Dr. Lee said "Hello." ', "Then sit here."]);
  });
});
