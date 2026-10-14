import { describe, expect, it, vi } from "vitest";
import { AudioCandidateSchema, getVoiceCandidateRequestFingerprint, getVoiceCandidateSourceFingerprint } from "./audio-candidate";
import type { GenerationJobUpdate } from "./generation-bridge";
import { createLocalGenerationBridge } from "./local-generation-bridge";
import { demoProject } from "./mock-project";
import { makeVoiceCandidateFixture } from "./voice-candidate-fixture";
import { getVoiceParagraphContext } from "./voice-paragraph-context";
import { ensureSpeechWorkspaces, switchSpeechWorkspace } from "./speech-workspace";

const options = { provider: "voxcpm2" as const, voicePackId: "soft_zh", referenceMode: "with_reference_text" as const, generationMode: "paragraph" as const };
function fixture() {
  const initial = structuredClone(demoProject);
  const initialClips = initial.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
  initialClips[0].text = "先坐下吧。"; initialClips[1].text = "我替你倒杯茶。";
  const project = switchSpeechWorkspace(ensureSpeechWorkspaces(initial), "paragraph");
  const clips = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
  project.speechWorkspace!.groups = [{ id: "paragraph-01", clipIds: clips.slice(0, 2).map((clip) => clip.id) },
    ...clips.slice(2).map((clip) => ({ id: `paragraph-${clip.id}`, clipIds: [clip.id] }))];
  const context = getVoiceParagraphContext(project, clips[0].id)!;
  const base = makeVoiceCandidateFixture();
  const candidate = AudioCandidateSchema.parse({ ...base, projectId: project.project_id, clipId: clips[0].id,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(clips[0], undefined, context),
    requestFingerprint: getVoiceCandidateRequestFingerprint(clips[0], options, undefined, undefined, context),
    provenance: { ...base.provenance, generationMode: "paragraph", paragraph: { version: 1, groupId: context.groupId,
      text: context.text, clipIds: context.clips.map((clip) => clip.clipId), checkStatus: "review", sourceAsset: base.asset, segments: [] } } });
  return { project, clips, candidate };
}

describe("paragraph generation bridge", () => {
  it("requests streamed paragraph progress and validates full-group request identity", async () => {
    const f = fixture();
    const fetchImpl = vi.fn(async () => new Response([
      { type: "progress", progress: 65, message: "正在核对第 2 个短句" }, { type: "result", result: { candidate: f.candidate } },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n", { headers: { "Content-Type": "application/x-ndjson" } }));
    const bridge = createLocalGenerationBridge({ fetchImpl });
    const updates: GenerationJobUpdate[] = [];
    await bridge.generateClip({ project: f.project, clipId: f.clips[0].id, reason: "generate", voiceOptions: options }, (update) => updates.push(update));
    expect(fetchImpl).toHaveBeenCalledWith("/api/generation/clip", expect.objectContaining({ headers: expect.objectContaining({ accept: "application/x-ndjson" }) }));
    expect(updates).toContainEqual(expect.objectContaining({ type: "snapshot", job: expect.objectContaining({ progress: 65 }) }));
    expect(updates.at(-1)).toMatchObject({ type: "candidate", candidate: f.candidate });
  });
  it("rejects a paragraph candidate after any sibling source changes", async () => {
    const f = fixture(); f.clips[1].text = "换了后半句。";
    const bridge = createLocalGenerationBridge({ fetchImpl: vi.fn(async () => Response.json({ candidate: f.candidate })) });
    const updates: GenerationJobUpdate[] = [];
    await bridge.generateClip({ project: f.project, clipId: f.clips[0].id, reason: "generate", voiceOptions: options }, (update) => updates.push(update));
    expect(updates.at(-1)).toMatchObject({ type: "failed", error: "候选与本次生成请求不匹配，请重试。" });
  });
  it("refuses a paragraph request from the short workspace without dispatching HTTP", async () => {
    const f = fixture(); f.project = switchSpeechWorkspace(f.project, "short");
    const fetchImpl = vi.fn();
    const updates: GenerationJobUpdate[] = [];
    await createLocalGenerationBridge({ fetchImpl }).generateClip({ project: f.project, clipId: f.clips[0].id, reason: "generate", voiceOptions: options }, (update) => updates.push(update));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({ type: "failed", error: "请切换到整段工作区后生成整段语音。" });
  });
});
