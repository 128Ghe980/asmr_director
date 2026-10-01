import { z } from "zod";

import { PlannerDraftSchema } from "./planner";
import { completePlannerJson, PlannerError, PlannerProviderIdSchema } from "./planner-provider";
import { createStoryboardMessages } from "./storyboard-prompt";
import { createStoryboardSourceFingerprint, StoryboardGeneratedSchema, StoryboardSchema, validateStoryboardSourceSections, type PlannerStoryboard } from "./storyboard";

export const StoryboardRequestSchema = z.object({
  provider: PlannerProviderIdSchema,
  draft: PlannerDraftSchema,
  instruction: z.string().trim().max(1200).default(""),
}).strict();

export type StoryboardRequest = z.infer<typeof StoryboardRequestSchema>;
export type StoryboardResult = { storyboard: PlannerStoryboard; provider: "ollama" | "api"; model: string };

const MAX_REQUEST_BYTES = 1024 * 1024;

/** Browser requests follow the Planner's same-origin and bounded JSON policy. */
export async function readStoryboardRequest(request: Request): Promise<StoryboardRequest> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new PlannerError(415, "分镜请求必须使用 JSON 格式。");
  }
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== `${url.protocol}//${request.headers.get("host") || url.host}`) {
    throw new PlannerError(403, "请从当前工作台生成分镜。");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_REQUEST_BYTES) {
    void request.body?.cancel().catch(() => {});
    throw new PlannerError(413, "分镜请求过长，请缩短文案后重试。");
  }
  if (request.signal.aborted) throw new PlannerError(499, "分镜生成已取消。");
  const reader = request.body?.getReader();
  if (!reader) throw new PlannerError(400, "请提供完整文案后生成分镜。");
  let rejectRead: ((error: Error) => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => { rejectRead = reject; });
  void interrupted.catch(() => {});
  const interrupt = (error: Error) => {
    rejectRead?.(error);
    void reader.cancel().catch(() => {});
  };
  const onCancel = () => interrupt(new PlannerError(499, "分镜生成已取消。"));
  request.signal.addEventListener("abort", onCancel, { once: true });
  const timer = setTimeout(() => interrupt(new PlannerError(408, "分镜请求接收超时，请重试。")), 10_000);
  let size = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    if (request.signal.aborted) onCancel();
    while (true) {
      if (request.signal.aborted) throw new PlannerError(499, "分镜生成已取消。");
      const result = await Promise.race([reader.read(), interrupted]);
      if (request.signal.aborted) throw new PlannerError(499, "分镜生成已取消。");
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        throw new PlannerError(413, "分镜请求过长，请缩短文案后重试。");
      }
      text += decoder.decode(result.value, { stream: true });
    }
    text += decoder.decode();
    const parsed = StoryboardRequestSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new PlannerError(400, "分镜请求格式不正确，请检查文案和补充要求。");
    return parsed.data;
  } catch (error) {
    if (error instanceof PlannerError) throw error;
    throw new PlannerError(400, "分镜请求格式不正确，请检查文案和补充要求。");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onCancel);
    reader.releaseLock();
  }
}

export async function generateStoryboard(
  input: StoryboardRequest,
  options: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<StoryboardResult> {
  const parsed = StoryboardRequestSchema.safeParse(input);
  if (!parsed.success) throw new PlannerError(400, "请补全文案后生成分镜。");
  if (options.signal?.aborted) throw new PlannerError(499, "分镜生成已取消。");
  const sourceFingerprint = createStoryboardSourceFingerprint(parsed.data.draft);
  if (sourceFingerprint.length > 64_000) throw new PlannerError(400, "分镜文案过长，请缩短后重试。");
  const configuredTimeout = Number((options.env ?? process.env).ASMR_PLANNER_TIMEOUT_SECONDS || "300");
  const timeoutMs = options.timeoutMs ?? (Number.isFinite(configuredTimeout) ? Math.max(10, Math.min(600, configuredTimeout)) * 1000 : 300_000);
  try {
    const result = await completePlannerJson({
      provider: parsed.data.provider,
      messages: createStoryboardMessages(parsed.data.draft, parsed.data.instruction),
      jsonSchema: z.toJSONSchema(StoryboardGeneratedSchema),
    }, { ...options, timeoutMs, timeoutLimitMs: 600_000, maxTokens: 8192, temperature: 0.5, messageLimit: 66_000, localCpuOnly: false });
    if (options.signal?.aborted) throw new PlannerError(499, "分镜生成已取消。");
    const generated = StoryboardGeneratedSchema.safeParse(result.value);
    if (!generated.success || !validateStoryboardSourceSections(generated.data, parsed.data.draft)) {
      throw new PlannerError(502, "模型分镜结构不正确，或未完整对应原稿，请重试。");
    }
    return { storyboard: StoryboardSchema.parse({ ...generated.data, version: 1, sourceFingerprint, promptFormat: "minimax-h3" }), provider: result.provider, model: result.model };
  } catch (error) {
    if (options.signal?.aborted || (error instanceof PlannerError && error.status === 499)) throw new PlannerError(499, "分镜生成已取消。");
    if (error instanceof PlannerError && error.status === 504) throw new PlannerError(504, "分镜生成超时，请稍后重试。");
    if (error instanceof PlannerError && error.status === 400) throw new PlannerError(400, "分镜文案过长，请缩短后重试。");
    if (error instanceof PlannerError && error.status === 503 && error.message.includes("文本分析")) {
      throw new PlannerError(503, "当前分镜模型尚未配置完整，请检查策划模型设置。");
    }
    if (error instanceof PlannerError && error.message.includes("文本分析回复")) {
      throw new PlannerError(502, "模型分镜回复格式不正确，请重试。");
    }
    if (error instanceof PlannerError) throw error;
    throw new PlannerError(502, "分镜生成暂时失败，请重试。");
  }
}
