import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { getVoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";
import { importVoiceReference, MAX_VOICE_REFERENCE_BYTES, VoiceReferenceImportError } from "@/lib/asmr/voice-reference-import";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (request.signal.aborted) throw new VoiceReferenceImportError("已取消添加参考声音。", 499);
    const contentType = request.headers.get("content-type");
    if (!contentType?.toLowerCase().startsWith("multipart/form-data")) throw new VoiceReferenceImportError("请使用音频文件表单提交。", 415);
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_VOICE_REFERENCE_BYTES + 65536) throw new VoiceReferenceImportError("音频文件过大（上限 32 MB）。", 413);
    let form: FormData;
    try {
      if (!request.body) throw new VoiceReferenceImportError("请提供音频文件表单。", 400);
      let bytes = 0;
      const boundedBody = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          if (request.signal.aborted) throw new VoiceReferenceImportError("已取消添加参考声音。", 499);
          bytes += chunk.byteLength;
          if (bytes > MAX_VOICE_REFERENCE_BYTES + 65536) throw new VoiceReferenceImportError("音频文件过大（上限 32 MB）。", 413);
          controller.enqueue(chunk);
        },
      }));
      form = await new Response(boundedBody, { headers: { "content-type": contentType } }).formData();
    } catch (error) {
      if (error instanceof VoiceReferenceImportError) throw error;
      throw new VoiceReferenceImportError("无法读取音频文件表单。", 400);
    }
    const allowed = new Set(["file", "name", "promptText", "startSeconds", "durationSeconds"]);
    for (const key of form.keys()) if (!allowed.has(key) || form.getAll(key).length !== 1) throw new VoiceReferenceImportError("参考声音表单参数无效。", 400);
    const file = form.get("file"), name = form.get("name"), promptText = form.get("promptText");
    if (!(file instanceof Blob) || !file.size || !("name" in file) || typeof file.name !== "string") throw new VoiceReferenceImportError("请上传非空 MP3 或 WAV 文件。", 400);
    if (file.size > MAX_VOICE_REFERENCE_BYTES) throw new VoiceReferenceImportError("音频文件过大（上限 32 MB）。", 413);
    if (typeof name !== "string" || (promptText !== null && typeof promptText !== "string")) throw new VoiceReferenceImportError("参考声音名称或文案无效。", 400);
    const seconds = (key: string, fallback: number) => {
      const value = form.get(key);
      if (value === null) return fallback;
      if (typeof value !== "string" || !value.trim() || !Number.isFinite(Number(value))) throw new VoiceReferenceImportError("参考片段的开始时间或时长无效。", 400);
      return Number(value);
    };
    if (request.signal.aborted) throw new VoiceReferenceImportError("已取消添加参考声音。", 499);
    const config = getLocalRuntimeConfig();
    const reference = await importVoiceReference({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, name, ...(typeof promptText === "string" ? { promptText } : {}), startSeconds: seconds("startSeconds", 0), durationSeconds: seconds("durationSeconds", 15), config, signal: request.signal });
    return Response.json({ reference, catalog: await getVoiceProviderCatalog(config) }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const known = error instanceof VoiceReferenceImportError;
    return Response.json({ error: known ? error.message : "参考声音暂时无法添加，请重试。" }, { status: known ? error.statusCode : 500 });
  }
}
