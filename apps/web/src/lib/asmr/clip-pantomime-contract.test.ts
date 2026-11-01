import { describe, expect, it, vi } from "vitest";
import { generateClipStoryboard, type ClipStoryboardRequest } from "./clip-storyboard-service";
import { demoProject } from "./mock-project";
import { CREATIVE_TEMPLATES } from "./creative-templates";
import { asmrSoundFixture } from "./asmr-sound-test-fixture";
import { hasImaginedPantomimeTarget } from "./camera-pantomime";

const env = { ASMR_PLANNER_API_URL: "https://test.invalid/v1", ASMR_PLANNER_API_MODEL: "test", ASMR_PLANNER_API_KEY: "test" };
const valid = { title: "一次打开", visual: "S1 faces the camera with empty hands and complete head and upper body visible.",
  action: "S1 loosely pinches the air before the lens, draws both hands apart once, relaxes the fingers and lowers the hands.",
  camera: "Fixed frontal medium close-up.", ambientSound: "One soft wrapper-opening foley, then silence.",
  asmrSound: { ...asmrSoundFixture, prompt: "A single real paper wrapper opening softly, followed by quiet room tone." } };
function request(pantomime = true): ClipStoryboardRequest {
  const project = structuredClone(demoProject), track = project.timeline.tracks.find(t => t.track_type === "voice")!;
  const clip = track.clips[0];
  Object.assign(clip, { kind: "silent", duration: 10, text: "一次拆开糖纸，做完便收手。", pause_after: 0,
    asset: { asset_id: null, uri: null, duration: null }, performance: { version: 1, segmentId: "open", purpose: "asmr", direction: "空手轻捏、拉开、收手。", soundIntent: "糖纸打开拟音。" } });
  track.clips = [clip];
  project.videoPlan = { version: 1, sceneDescription: "安静室内。", shots: {},
    ...(pantomime ? { referenceTemplate: structuredClone(CREATIVE_TEMPLATES.find(t => t.id === "intimate-interaction-theatre")!) } : {}) };
  return { provider: "api", project, clipId: clip.id, includePrevious: false, referenceMode: "new", instruction: "" };
}
const reply = (value: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });

describe("pantomime target contract repair", () => {
  it("repairs a model's imaginary wrapper while preserving real sound-only materials and one complete ten-second shot", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ ...valid, action: "S1 holds an invisible candy wrapper and opens the imaginary wrapper." }))
      .mockResolvedValueOnce(reply(valid));
    const result = await generateClipStoryboard(request(), { env, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)).messages.at(-1).content).toContain("真实材料名称只属于声音字段");
    expect(result.storyboard.action).toBe(valid.action);
    expect(result.storyboard.parts).toBeUndefined();
    expect(result.storyboard.duration).toBe(10);
    expect(result.storyboard.asmrSound?.prompt).toBe(valid.asmrSound.prompt);
  });

  it("rejects a still-invalid repair without changing the user's project", async () => {
    const input = request(), before = structuredClone(input.project);
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => reply({ ...valid, visual: "No imaginary object is visible." }));
    await expect(generateClipStoryboard(input, { env, fetchImpl })).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(input.project).toEqual(before);
  });

  it("checks each generated part but leaves material performances without the capability unchanged", async () => {
    expect(hasImaginedPantomimeTarget({ ...valid, parts: [{ ...valid, action: "S1 touches an invisible surface." }] })).toBe(true);
    expect(hasImaginedPantomimeTarget({ ...valid, action: "S1 pulls empty hands apart, as if opening a thin wrapper." })).toBe(true);
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => reply({ ...valid, action: "S1 shows an imaginary scene on the printed box." }));
    const result = await generateClipStoryboard(request(false), { env, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.storyboard.action).toContain("imaginary scene");
  });
});
