import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { MAX_VOICE_REFERENCE_BYTES } from "@/lib/asmr/voice-reference-import";
import { transcribeVoiceReference, VoiceReferenceTranscriptionError } from "@/lib/asmr/voice-reference-transcription";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (request.signal.aborted) throw new VoiceReferenceTranscriptionError("已取消识别参考文字。", 499);
    const contentType = request.headers.get("content-type");
    if (!contentType?.toLowerCase().startsWith("multipart/form-data")) throw new VoiceReferenceTranscriptionError("请使用音频文件表单提交。", 415);
    const limit = MAX_VOICE_REFERENCE_BYTES + 65536;
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > limit) throw new VoiceReferenceTranscriptionError("音频文件过大（上限 32 MB）。", 413);
    let form: FormData;
    try {
      if (!request.body) throw new VoiceReferenceTranscriptionError("请提供音频文件表单。", 400);
      let bytes = 0;
      const body = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
        if (request.signal.aborted) throw new VoiceReferenceTranscriptionError("已取消识别参考文字。", 499);
        bytes += chunk.byteLength;
        if (bytes > limit) throw new VoiceReferenceTranscriptionError("音频文件过大（上限 32 MB）。", 413);
        controller.enqueue(chunk);
      } }));
      form = await new Response(body, { headers: { "content-type": contentType } }).formData();
    } catch (error) {
      if (error instanceof VoiceReferenceTranscriptionError) throw error;
      if (request.signal.aborted) throw new VoiceReferenceTranscriptionError("已取消识别参考文字。", 499);
      throw new VoiceReferenceTranscriptionError("无法读取音频文件表单。", 400);
    }
    const allowed = new Set(["file", "startSeconds", "durationSeconds", "language"]);
    for (const key of form.keys()) if (!allowed.has(key) || form.getAll(key).length !== 1) throw new VoiceReferenceTranscriptionError("参考文字识别参数无效。", 400);
    const file = form.get("file"), language = form.get("language");
    if (!(file instanceof Blob) || !file.size || !("name" in file) || typeof file.name !== "string") throw new VoiceReferenceTranscriptionError("请上传非空 MP3 或 WAV 文件。", 400);
    if (file.size > MAX_VOICE_REFERENCE_BYTES) throw new VoiceReferenceTranscriptionError("音频文件过大（上限 32 MB）。", 413);
    if (language !== null && typeof language !== "string") throw new VoiceReferenceTranscriptionError("请选择识别语言。", 400);
    const seconds = (key: string, fallback: number) => {
      const value = form.get(key);
      if (value === null) return fallback;
      if (typeof value !== "string" || !value.trim() || !Number.isFinite(Number(value))) throw new VoiceReferenceTranscriptionError("参考片段的开始时间或时长无效。", 400);
      return Number(value);
    };
    const result = await transcribeVoiceReference({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, startSeconds: seconds("startSeconds", 0), durationSeconds: seconds("durationSeconds", 8), language: language ?? "zh", config: getLocalRuntimeConfig(), signal: request.signal });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const known = error instanceof VoiceReferenceTranscriptionError;
    return Response.json({ error: known ? error.message : "参考文字暂时无法识别，请重试。" }, { status: known ? error.statusCode : 500, headers: { "cache-control": "no-store" } });
  }
}
