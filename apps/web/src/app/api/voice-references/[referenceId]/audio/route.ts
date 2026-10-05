import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { readVoiceReferenceAudio, VoiceReferenceImportError } from "@/lib/asmr/voice-reference-import";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ referenceId: string }> }) {
  try {
    const { referenceId } = await context.params;
    const wav = await readVoiceReferenceAudio(referenceId, getLocalRuntimeConfig(), request.signal);
    return new Response(Buffer.from(wav), { headers: { "content-type": "audio/wav", "content-length": String(wav.byteLength), "cache-control": "no-store", "content-disposition": 'inline; filename="reference.wav"' } });
  } catch (error) {
    const known = error instanceof VoiceReferenceImportError;
    return Response.json({ error: known ? error.message : "参考音频暂时无法试听，请重试。" }, { status: request.signal.aborted ? 499 : known ? error.statusCode : 500 });
  }
}
