import { randomUUID } from "node:crypto";
import { VoicePreviewError, type PreparedVoicePreview } from "./local-voice-preview";

export const VOICE_PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_PREVIEWS = 3;
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Session = { preview: PreparedVoicePreview; expiresAt: number; leases: number; retired: boolean;
  timer: ReturnType<typeof setTimeout>; cleanup?: Promise<void> };
const state = globalThis as typeof globalThis & { __asmrVoicePreviewSessions?: Map<string, Session>; __asmrVoicePreviewOwned?: Set<Session> };
const sessions = state.__asmrVoicePreviewSessions ??= new Map<string, Session>();
const owned = state.__asmrVoicePreviewOwned ??= new Set<Session>();

function cleanRetired(session: Session): Promise<void> {
  if (!session.retired || session.leases) return Promise.resolve();
  return session.cleanup ??= Promise.resolve().then(() => session.preview.cleanup()).finally(() => { owned.delete(session); });
}
function checkedToken(token: string | null): string {
  if (!token || !tokenPattern.test(token)) throw new VoicePreviewError("预览链接无效，请重新生成预览。", 400);
  return token;
}
export function assertVoicePreviewCapacity() {
  if (owned.size >= MAX_PREVIEWS) throw new VoicePreviewError("已有 3 份预览，请关闭旧预览后重试。", 429);
}
export function registerVoicePreview(preview: PreparedVoicePreview) {
  assertVoicePreviewCapacity();
  const token = randomUUID(), expiresAt = Date.now() + VOICE_PREVIEW_TTL_MS;
  const timer = setTimeout(() => { void removeVoicePreview(token).catch(() => {}); }, VOICE_PREVIEW_TTL_MS);
  timer.unref();
  const session: Session = { preview, expiresAt, timer, leases: 0, retired: false };
  sessions.set(token, session); owned.add(session);
  return { audioUrl: `/api/assets/voice-preview?token=${token}`, filename: preview.filename, clipCount: preview.clipCount,
    skippedCount: preview.skippedCount, duration: preview.duration, size: preview.size, expiresAt };
}
/** Tokens are reusable by media range requests and the later native download. */
export async function acquireVoicePreview(token: string | null) {
  const key = checkedToken(token), session = sessions.get(key);
  if (!session) throw new VoicePreviewError("预览链接已失效，请重新生成预览。", 404);
  if (session.expiresAt <= Date.now()) {
    await removeVoicePreview(key);
    throw new VoicePreviewError("预览链接已失效，请重新生成预览。", 404);
  }
  session.leases++;
  let released = false;
  return { preview: session.preview, release: async () => {
    if (released) return;
    released = true; session.leases--;
    await cleanRetired(session);
  } };
}
/** Remove lookup immediately, but defer file cleanup until active streams close. */
export async function removeVoicePreview(token: string | null): Promise<void> {
  const key = checkedToken(token), session = sessions.get(key);
  if (!session) return;
  sessions.delete(key); clearTimeout(session.timer); session.retired = true;
  await cleanRetired(session);
}
