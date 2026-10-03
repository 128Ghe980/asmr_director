import { describe, expect, it, vi } from "vitest";

import { readGenerationResponse } from "./generation-response";
import { LocalStorageError } from "./local-storage-error";

const encoder = new TextEncoder();
const contentType = { "content-type": "application/x-ndjson; charset=utf-8" };
function streamed(chunks: Uint8Array[], options: { close?: boolean; cancel?: () => void } = {}) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (options.close !== false) controller.close();
    },
    cancel: options.cancel,
  }), { headers: contentType });
}

describe("generation NDJSON reader", () => {
  it("decodes split UTF-8, coalesced events, heartbeat and the final line without a newline", async () => {
    const result = { candidate: { text: "慢慢休息🌙", groups: ["夜已经很深了", "晚安"] } };
    const body = [
      JSON.stringify({ type: "heartbeat" }),
      "",
      JSON.stringify({ type: "progress", progress: 12, message: "正在分析语义组" }),
      JSON.stringify({ type: "progress", progress: 56, message: "生成第 2 组" }),
      JSON.stringify({ type: "result", result }),
    ].join("\r\n");
    // Every individual byte is a packet, including the middle of Chinese and
    // four-byte emoji codepoints. The reader must carry decoder state forward.
    const response = streamed([...encoder.encode(body)].map((byte) => Uint8Array.of(byte)));
    const progress = vi.fn();
    expect(await readGenerationResponse(response, progress)).toEqual(result);
    expect(progress.mock.calls).toEqual([[12, "正在分析语义组"], [56, "生成第 2 组"]]);
    expect(response.body?.locked).toBe(false);
  });

  it("preserves the existing JSON response path", async () => {
    const payload = { asset: { assetId: "voice_test", uri: "asset://clip/voice_test", duration: 4 } };
    const progress = vi.fn();
    expect(await readGenerationResponse(Response.json(payload), progress)).toEqual(payload);
    expect(progress).not.toHaveBeenCalled();
  });

  it("surfaces a safe server error and cancels the remaining stream", async () => {
    const cancel = vi.fn();
    const response = streamed([encoder.encode(JSON.stringify({ type: "error", error: "第 2 组未通过完整性检查，请重试。" }) + "\n")], { close: false, cancel });
    await expect(readGenerationResponse(response, vi.fn())).rejects.toThrow("第 2 组未通过完整性检查");
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
    await expect(readGenerationResponse(streamed([encoder.encode(JSON.stringify({ type: "error", error: "x".repeat(500) }))]), vi.fn())).rejects.toThrow("长文生成失败");
  });

  it("preserves a storage error code from NDJSON and closes the stream before any later result", async () => {
    const cancel = vi.fn();
    const response = streamed([encoder.encode(JSON.stringify({ type: "error", error: "failed to save source.wav", code: "INSUFFICIENT_STORAGE" }) + "\n")], { close: false, cancel });
    const error = await readGenerationResponse(response, vi.fn()).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(LocalStorageError);
    expect(error).toMatchObject({ code: "INSUFFICIENT_STORAGE", statusCode: 507, message: "音频保存空间不足，请释放存储空间后重试。" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it("retains the meaning of HTTP 507 even if its body is not valid JSON", async () => {
    const response = new Response("insufficient storage", { status: 507 });
    await expect(readGenerationResponse(response, vi.fn())).rejects.toMatchObject({ code: "INSUFFICIENT_STORAGE", statusCode: 507, message: "音频保存空间不足，请释放存储空间后重试。" });
    expect(response.body?.locked).toBe(false);
  });

  it("rejects an EOF or network disconnection without a final candidate", async () => {
    const response = streamed([encoder.encode('{"type":"progress","progress":50,"message":"生成中"}\n')]);
    await expect(readGenerationResponse(response, vi.fn())).rejects.toThrow("未收到完整候选");
    const failed = new Response(new ReadableStream({ start(controller) { controller.error(new Error("connection lost")); } }), { headers: contentType });
    await expect(readGenerationResponse(failed, vi.fn())).rejects.toThrow("connection lost");
    expect(failed.body?.locked).toBe(false);
  });

  it("rejects oversized streams and duplicate results before returning any candidate", async () => {
    const cancel = vi.fn();
    const oversized = streamed([new Uint8Array(2 * 1024 * 1024 + 1)], { close: false, cancel });
    await expect(readGenerationResponse(oversized, vi.fn())).rejects.toThrow("生成响应过大");
    expect(cancel).toHaveBeenCalledOnce();
    const result = JSON.stringify({ type: "result", result: { candidate: { id: "one" } } });
    await expect(readGenerationResponse(streamed([encoder.encode(result + "\n" + result + "\n")]), vi.fn())).rejects.toThrow("重复生成结果");
  });

  it.each([
    { type: "progress", progress: -1, message: "生成中" },
    { type: "progress", progress: 101, message: "生成中" },
    { type: "progress", progress: "10", message: "生成中" },
    { type: "progress", progress: 10, message: "x".repeat(181) },
    { type: "unknown" },
  ])("rejects invalid stream events without reporting progress", async (event) => {
    const progress = vi.fn();
    await expect(readGenerationResponse(streamed([encoder.encode(JSON.stringify(event) + "\n")]), progress)).rejects.toThrow();
    expect(progress).not.toHaveBeenCalled();
  });

  it("rejects empty or malformed stream bodies", async () => {
    await expect(readGenerationResponse(new Response(null, { headers: contentType }), vi.fn())).rejects.toThrow("生成响应为空");
    await expect(readGenerationResponse(streamed([encoder.encode('{"type":"result"')]), vi.fn())).rejects.toThrow();
  });
});
