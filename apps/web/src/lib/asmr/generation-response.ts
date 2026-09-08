// A bounded NDJSON reader lets the existing generation job receive real group
// progress while retaining a single cancelable request and final candidate.
export async function readGenerationResponse(response: Response, onProgress: (progress: number, message: string) => void): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) return response.json();
  if (!response.body) throw new Error("生成响应为空，请重试。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  let result: unknown;
  let complete = false;
  const line = (value: string) => {
    if (!value.trim()) return;
    const event = JSON.parse(value);
    if (event.type === "progress") {
      if (!Number.isFinite(event.progress) || event.progress < 0 || event.progress > 100 || typeof event.message !== "string" || event.message.length > 180) throw new Error("生成进度无效。");
      onProgress(event.progress, event.message);
    } else if (event.type === "result") { if (complete) throw new Error("重复生成结果。"); result = event.result; complete = true; }
    else if (event.type === "error") throw new Error(typeof event.error === "string" && event.error.length < 500 ? event.error : "长文生成失败，请重试。");
    else if (event.type !== "heartbeat") throw new Error("生成响应无效。");
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { buffer += decoder.decode(); if (buffer) line(buffer); break; }
      total += value.byteLength;
      if (total > 2 * 1024 * 1024) throw new Error("生成响应过大。");
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1); }
    }
    if (!complete) throw new Error("生成连接中断，未收到完整候选，请重试。");
    return result;
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
