import { z } from "zod";

import { PlannerError } from "./planner-provider";

export type VideoPlanningOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** The new planning APIs share the existing bounded, same-origin JSON contract. */
export async function readVideoPlanningRequest<T>(request: Request, schema: z.ZodType<T>, label: string): Promise<T> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new PlannerError(415, `${label}请求必须使用 JSON 格式。`);
  }
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== `${url.protocol}//${request.headers.get("host") || url.host}`) {
    throw new PlannerError(403, `请从当前工作台${label}。`);
  }
  const maxBytes = 1024 * 1024;
  if (Number(request.headers.get("content-length")) > maxBytes) {
    void request.body?.cancel().catch(() => {});
    throw new PlannerError(413, `${label}请求过长，请缩短内容后重试。`);
  }
  if (request.signal.aborted) throw new PlannerError(499, `${label}已取消。`);
  const reader = request.body?.getReader();
  if (!reader) throw new PlannerError(400, `${label}请求格式不正确。`);
  let rejectRead: ((error: Error) => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => { rejectRead = reject; });
  void interrupted.catch(() => {});
  const interrupt = (error: Error) => {
    rejectRead?.(error);
    void reader.cancel().catch(() => {});
  };
  const onCancel = () => interrupt(new PlannerError(499, `${label}已取消。`));
  request.signal.addEventListener("abort", onCancel, { once: true });
  const timer = setTimeout(() => interrupt(new PlannerError(408, `${label}请求接收超时，请重试。`)), 10_000);
  let size = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    if (request.signal.aborted) onCancel();
    while (true) {
      if (request.signal.aborted) throw new PlannerError(499, `${label}已取消。`);
      const result = await Promise.race([reader.read(), interrupted]);
      if (request.signal.aborted) throw new PlannerError(499, `${label}已取消。`);
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new PlannerError(413, `${label}请求过长，请缩短内容后重试。`);
      }
      text += decoder.decode(result.value, { stream: true });
    }
    text += decoder.decode();
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new PlannerError(400, `${label}请求格式不正确，请检查当前文案或片段。`);
    return parsed.data;
  } catch (error) {
    if (error instanceof PlannerError) throw error;
    throw new PlannerError(400, `${label}请求格式不正确，请检查当前文案或片段。`);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onCancel);
    reader.releaseLock();
  }
}

export function videoPlanningTimeout(options: VideoPlanningOptions): number {
  const configured = Number((options.env ?? process.env).ASMR_PLANNER_TIMEOUT_SECONDS || "300");
  return options.timeoutMs ?? (Number.isFinite(configured) ? Math.max(10, Math.min(600, configured)) * 1000 : 300_000);
}

export function videoPlanningError(error: unknown, label: string, signal?: AbortSignal): PlannerError {
  if (signal?.aborted || (error instanceof PlannerError && error.status === 499)) return new PlannerError(499, `${label}已取消。`);
  if (error instanceof PlannerError && error.status === 504) return new PlannerError(504, `${label}超时，请稍后重试。`);
  if (error instanceof PlannerError && error.status === 503 && error.message.includes("文本分析")) {
    return new PlannerError(503, "当前策划模型尚未配置完整，请检查模型设置。");
  }
  if (error instanceof PlannerError && error.message.includes("文本分析回复")) return new PlannerError(502, `${label}模型回复格式不正确，请重试。`);
  if (error instanceof PlannerError && error.message.includes("文本分析请求过长")) return new PlannerError(400, `${label}内容过长，请缩短后重试。`);
  if (error instanceof PlannerError) return error;
  return new PlannerError(502, `${label}暂时失败，请重试。`);
}
