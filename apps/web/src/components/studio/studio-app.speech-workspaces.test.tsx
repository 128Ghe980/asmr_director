// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateClipRequest, GenerationBridge, GenerationJobSnapshot, GenerationJobUpdate } from "@/lib/asmr/generation-bridge";
import { getProjectMixFingerprint } from "@/lib/asmr/generation-fingerprint";
import type { ProjectMixControl } from "@/lib/asmr/generation-view";
import { getVoiceCandidateSourceFingerprint, type AudioCandidate } from "@/lib/asmr/audio-candidate";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import { getVoiceParagraphContext } from "@/lib/asmr/voice-paragraph-context";
import { demoProject } from "@/lib/asmr/mock-project";
import { PlannerBriefSchema, type PlannerBrief, type PlannerDraft } from "@/lib/asmr/planner";
import { createInitialProjectLibrary, getCurrentLibraryEntry, loadProjectLibrary, saveProjectLibrary } from "@/lib/asmr/project-library";
import { AsmrProjectSchema, type AsmrProject, type TimelineClip } from "@/lib/asmr/schema";
import { captureSpeechWorkspace, ensureSpeechWorkspaces, getSpeechWorkspaceProject, switchSpeechWorkspace } from "@/lib/asmr/speech-workspace";
import { splitSpeechSentences } from "@/lib/asmr/speech-sentences";
import type { VoiceGenerationPanelProps } from "./voice-generation-panel";
import { StudioApp } from "./studio-app";

const bridgeFactory = vi.hoisted(() => vi.fn());
vi.mock("@/lib/asmr/local-generation-bridge", () => ({ createLocalGenerationBridge: bridgeFactory }));
vi.mock("./project-workspace", () => ({ ProjectWorkspace: ({ children, project, projectMixControl, onGenerateProjectMix }: {
  children: ReactNode; project: AsmrProject; projectMixControl: ProjectMixControl; onGenerateProjectMix: () => void;
}) => <div><output data-testid="project">{JSON.stringify(project)}</output>
  <output data-testid="mix-control">{JSON.stringify(projectMixControl)}</output>
  <button onClick={onGenerateProjectMix}>生成测试混音</button>{children}</div> }));
vi.mock("./planner-panel", () => ({ PlannerPanel: ({ onAdopt }: { onAdopt: (brief: PlannerBrief, draft: PlannerDraft) => void }) =>
  <button onClick={() => onAdopt(plannerBrief, plannerDraft)}>采用测试 AI 创意</button> }));
vi.mock("./timeline-panel", () => ({ TimelinePanel: () => null }));
vi.mock("./validation-panel", () => ({ ValidationPanel: () => null }));
vi.mock("./editor-panels", () => ({ EditorPanels: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("./clip-inspector", () => ({ ClipInspector: ({ voiceGenerationPanel, onGenerateSelectedClip, selectedClip }: {
  voiceGenerationPanel?: (control: ReactNode) => ReactNode; onGenerateSelectedClip: () => void; selectedClip?: TimelineClip;
}) => <div>{selectedClip?.type === "voice" && selectedClip.kind !== "silent"
  ? voiceGenerationPanel?.(<button onClick={onGenerateSelectedClip}>生成测试音频</button>) : null}</div> }));
vi.mock("./voice-generation-panel", () => ({ VoiceGenerationPanel: ({ options, generationControl, candidates }: VoiceGenerationPanelProps) =>
  <div><output data-testid="voice-options">{JSON.stringify(options)}</output>
    <output data-testid="candidate-ids">{candidates.map((candidate) => candidate.candidateId).join(",")}</output>{generationControl}</div> }));
vi.mock("./clip-storyboard-editor", () => ({ ClipStoryboardEditor: ({ clipId }: { clipId: string }) =>
  <output data-testid="storyboard-clip">{clipId}</output> }));

const plannerBrief = PlannerBriefSchema.parse({ theme: "雨夜喝茶" });
const plannerDraft: PlannerDraft = { title: "测试 AI 创意", scene: "雨夜客厅", character: { role: "朋友", personality: ["温柔"], speechStyle: ["轻声"] },
  sections: ["先坐一会儿。我给你倒一杯茶。", "雨停了，窗外很安静。你先喝茶。"].map((text, index) => ({ id: `section_${index}`, title: "欢迎", text,
    emotion: "gentle", style: "whisper", pace: "slow", direction: "", soundSuggestions: "", pauseAfter: "short",
    position: { pan: 0, distance: "near", movement: "static" } })) };
const shortOptions = { provider: "gpt-sovits", voicePackId: "default", referenceMode: "with_reference_text", generationMode: "clip" } as const;
const catalog = { providers: [
  { id: "gpt-sovits", label: "GPT-SoVITS", available: true, defaultReferenceId: "default", references: [{ id: "default", label: "旧声音", referenceModes: ["with_reference_text"] }] },
  { id: "voxcpm2", label: "VoxCPM2", available: true, defaultReferenceId: "soft_zh", references: [{ id: "soft_zh", label: "固定参考", referenceModes: ["with_reference_text"] }], longText: { available: true, apiConfigured: true } },
] };

function voices(project: AsmrProject) { return project.timeline.tracks.find((track) => track.track_type === "voice")!.clips; }
function fixture(): AsmrProject {
  const project = structuredClone(demoProject);
  const source = voices(project)[0];
  project.project_id = "two_workspace_fixture";
  project.duration = 15;
  project.emotion_curve = [{ start: 0, end: 15, emotion: "gentle" }];
  project.timeline.tracks = project.timeline.tracks.map((track) => track.track_type === "voice" ? { ...track,
    clips: ["先坐一会儿。", "我给你倒茶。"].map((text, index) => ({ ...structuredClone(source), id: `voice_${index}`, text,
      start: index * 5, duration: 4, pause_after: 1, generation: { ...source.generation, status: "asset_generated" as const },
      asset: { asset_id: `short_${index}`, uri: `asset://clip/short_${index}`, duration: 4 } })) } : { ...track, clips: [] });
  let initialized = ensureSpeechWorkspaces(project);
  const paragraph = getSpeechWorkspaceProject(initialized, "paragraph");
  voices(paragraph).forEach((clip, index) => { clip.asset = { asset_id: `paragraph_${index}`, uri: `asset://clip/paragraph_${index}`, duration: 4 }; clip.generation.status = "asset_generated"; });
  initialized = switchSpeechWorkspace(captureSpeechWorkspace(paragraph), "short");
  saveProjectLibrary(window.localStorage, createInitialProjectLibrary(initialized));
  window.localStorage.setItem("ai-asmr-studio:v1:voice-options", JSON.stringify(shortOptions));
  return initialized;
}
function current(): AsmrProject { return JSON.parse(screen.getByTestId("project").textContent!); }
function mixControl(): ProjectMixControl { return JSON.parse(screen.getByTestId("mix-control").textContent!); }
function mockApi() {
  const candidates: AudioCandidate[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === "/api/generation/clip") return Response.json(catalog);
    if (url.startsWith("/api/audio-candidates?")) {
      const mode = new URL(url, "http://localhost").searchParams.get("workspaceMode");
      return Response.json({ candidates: candidates.filter((candidate) => (candidate.provenance.generationMode === "paragraph" ? "paragraph" : "short") === mode) });
    }
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [10], duration: 4, sampleRate: 48000,
      channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    throw new Error(`Unexpected two-workspace test request: ${url}`);
  }));
  return candidates;
}
async function mount(project: AsmrProject) {
  render(<StrictMode><StudioApp project={project} /></StrictMode>);
  await waitFor(() => expect(screen.getByRole("tab", { name: "短句" }).getAttribute("aria-selected")).toBe("true"));
  await waitFor(() => expect(JSON.parse(screen.getByTestId("voice-options").textContent!).voicePackId).toBe("default"));
}
beforeEach(() => {
  window.localStorage.clear(); bridgeFactory.mockReset(); vi.stubEnv("NEXT_PUBLIC_ASMR_GENERATION_MODE", "local");
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("StudioApp paged speech workspaces", () => {
  it("creates both workspaces together when the user adopts AI creative copy", async () => {
    const project = fixture(); mockApi(); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "AI 创意策划" }));
    fireEvent.click(screen.getByRole("button", { name: "采用测试 AI 创意" }));
    await waitFor(() => expect(current().title).toBe("测试 AI 创意"));
    expect(current().speechWorkspace!.activeMode).toBe("short");
    expect(current().speechWorkspace!.short.clips.map((clip) => clip.text)).toEqual(plannerDraft.sections.flatMap((section) => splitSpeechSentences(section.text)));
    expect(voices(current())).toHaveLength(4);
    expect(current().speechWorkspace!.paragraph.clips.map((clip) => clip.id)).toEqual(current().speechWorkspace!.short.clips.map((clip) => clip.id));
    expect(current().speechWorkspace!.paragraph.clips.every((clip) => clip.asset.uri === null)).toBe(true);
    expect(current().speechWorkspace!.groups).toHaveLength(1);
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it("actually splits a legacy long source in both pages and protects complete original takes in history", async () => {
    const project = fixture();
    voices(project)[0].text = "先坐一会儿。我给你倒茶。";
    project.speechWorkspace!.short.clips[0].text = voices(project)[0].text;
    project.speechWorkspace!.paragraph.clips[0].text = voices(project)[0].text;
    saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
    mockApi(); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "切短句" }));
    expect(voices(current()).map((clip) => clip.text)).toEqual(["先坐一会儿。", "我给你倒茶。", "我给你倒茶。"]);
    expect(voices(current()).slice(0, 2).every((clip) => clip.asset.uri === null)).toBe(true);
    expect(voices(current())[2].asset.asset_id).toBe("short_1");
    fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    expect(voices(current()).slice(0, 2).every((clip) => clip.asset.uri === null)).toBe(true);
    expect(voices(current())[2].asset.asset_id).toBe("paragraph_1");
    expect(screen.getByRole("textbox", { name: "整段 1 文案" })).toHaveProperty("value", "先坐一会儿。我给你倒茶。我给你倒茶。");
    const saved = getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project));
    expect(saved.revisions.at(-1)!.project.speechWorkspace!.short.clips[0].asset.asset_id).toBe("short_0");
    expect(saved.revisions.at(-1)!.project.speechWorkspace!.paragraph.clips[0].asset.asset_id).toBe("paragraph_0");
    fireEvent.click(screen.getByRole("button", { name: "撤回编辑" }));
    expect(voices(current())).toHaveLength(2);
    expect(current().speechWorkspace!.short.clips[0].asset.asset_id).toBe("short_0");
    expect(current().speechWorkspace!.paragraph.clips[0].asset.asset_id).toBe("paragraph_0");
  });

  it("syncs short-page typing immediately and commits new sentence boundaries after editing ends", async () => {
    const project = fixture(); mockApi(); await mount(project);
    const field = screen.getByRole("textbox", { name: "台词" });
    fireEvent.change(field, { target: { value: "先坐一会儿。雨停了。" } });
    expect(voices(current())).toHaveLength(2);
    expect(current().speechWorkspace!.paragraph.clips[0].text).toBe("先坐一会儿。雨停了。");
    fireEvent.blur(field);
    expect(voices(current()).map((clip) => clip.text)).toEqual(["先坐一会儿。", "雨停了。", "我给你倒茶。"]);
    expect(current().speechWorkspace!.paragraph.clips.map((clip) => clip.text)).toEqual(voices(current()).map((clip) => clip.text));
    expect(voices(current())[2].asset.asset_id).toBe("short_1");
    expect(current().speechWorkspace!.paragraph.clips[2].asset.asset_id).toBe("paragraph_1");
  });

  it("syncs short and paragraph copy in both directions while retaining each workspace's adopted assets", async () => {
    const project = fixture(); mockApi(); await mount(project);
    fireEvent.change(screen.getByRole("textbox", { name: "台词" }), { target: { value: "先安心坐下来。" } });
    expect(voices(current())[0].asset.asset_id).toBe("short_0");
    expect(voices(current())[0].audio_stale).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "整段 1 文案" }) as HTMLTextAreaElement).value).toBe("先安心坐下来。我给你倒茶。"));
    expect(voices(current()).map((clip) => clip.asset.asset_id)).toEqual(["paragraph_0", "paragraph_1"]);
    fireEvent.change(screen.getByRole("textbox", { name: "整段 1 文案" }), { target: { value: "先安心坐下来。我给你倒一杯热茶。" } });
    fireEvent.click(screen.getByRole("tab", { name: "短句" }));
    await waitFor(() => expect(voices(current()).map((clip) => clip.text)).toEqual(["先安心坐下来。", "我给你倒一杯热茶。"]));
    expect(voices(current()).map((clip) => clip.asset.asset_id)).toEqual(["short_0", "short_1"]);
    expect(voices(current()).every((clip) => clip.audio_stale)).toBe(true);
    expect(AsmrProjectSchema.safeParse(current()).success).toBe(true);
    await waitFor(() => expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project.speechWorkspace?.paragraph.clips[1].text).toBe("我给你倒一杯热茶。"));
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it("navigates pages without splitting, clearing results or starting generation", async () => {
    const project = fixture(); mockApi(); await mount(project);
    for (const label of ["整段", "短句", "整段", "短句"]) fireEvent.click(screen.getByRole("tab", { name: label }));
    expect(current().speechWorkspace!.short.clips).toEqual(project.speechWorkspace!.short.clips);
    expect(current().speechWorkspace!.paragraph.clips).toEqual(project.speechWorkspace!.paragraph.clips);
    expect(current().speechWorkspace!.groups).toEqual(project.speechWorkspace!.groups);
    expect(voices(current())).toEqual(voices(project));
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it("merges a late short-generation response into the short bank after navigation to paragraph", async () => {
    const project = fixture(); mockApi();
    let onUpdate!: (update: GenerationJobUpdate) => void;
    let job!: GenerationJobSnapshot;
    let request!: GenerateClipRequest;
    const bridge: GenerationBridge = {
      generateClip: vi.fn(async (input, callback) => {
        request = structuredClone(input); onUpdate = callback;
        job = { jobId: "short_pending", clipId: input.clipId, target: { type: "clip", clipId: input.clipId }, status: "generating", progress: 0.1,
          createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z" };
        callback({ type: "snapshot", job }); return { jobId: job.jobId };
      }),
      generateProjectMix: vi.fn(async () => { throw new Error("Unexpected mix"); }),
      cancelGeneration: vi.fn(async () => undefined),
    };
    bridgeFactory.mockReturnValue(bridge);
    await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "生成测试音频" }));
    await waitFor(() => expect(bridge.generateClip).toHaveBeenCalledOnce());
    expect(request.voiceOptions?.provider).toBe("gpt-sovits");
    fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    expect(current().speechWorkspace!.activeMode).toBe("paragraph");
    await act(async () => { onUpdate({ type: "succeeded", job: { ...job, status: "succeeded", progress: 1 }, asset: { assetId: "late_short", uri: "asset://clip/late_short", duration: 2 } }); });
    await waitFor(() => expect(current().speechWorkspace!.short.clips[0].asset.asset_id).toBe("late_short"));
    expect(current().speechWorkspace!.activeMode).toBe("paragraph");
    expect(voices(current()).map((clip) => clip.asset.asset_id)).toEqual(["paragraph_0", "paragraph_1"]);
    expect(bridge.cancelGeneration).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "短句" }));
    expect(voices(current())[0].asset.asset_id).toBe("late_short");
  });

  it("shares silent-shot insertion across both views while retaining speech audio", async () => {
    const project = fixture(); mockApi(); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "下方插入无对白" }));
    await waitFor(() => expect(voices(current())).toHaveLength(3));
    const silent = voices(current())[1];
    expect(silent.kind).toBe("silent");
    expect(screen.getByTestId("storyboard-clip").textContent).toBe(silent.id);
    expect(current().speechWorkspace!.paragraph.clips[1].id).toBe(silent.id);
    expect(current().speechWorkspace!.paragraph.clips[1].kind).toBe("silent");
    fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    expect(screen.getByRole("textbox", { name: "无对白镜头描述" })).toBeTruthy();
    expect(voices(current()).filter((clip) => clip.kind !== "silent").map((clip) => clip.asset.asset_id)).toEqual(["paragraph_0", "paragraph_1"]);
    expect(voices(current()).filter((clip) => clip.kind !== "silent").every((clip) => !clip.audio_stale)).toBe(true);
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it("marks the old mix stale after shared source edits and source undo while retaining its exported audio", async () => {
    let project = fixture();
    project.exports = [{ type: "wav", status: "exported", uri: "asset://mix/original_short" }];
    project = captureSpeechWorkspace(project, { mixFingerprint: getProjectMixFingerprint(project) });
    saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
    mockApi(); await mount(project);
    expect(mixControl().statusLabel).toBe("可试听");
    fireEvent.change(screen.getByRole("textbox", { name: "台词" }), { target: { value: "源文修改后保留旧混音。" } });
    expect(current().speechWorkspace!.short.mixFingerprint).toBeUndefined();
    expect(current().exports[0].uri).toBe("asset://mix/original_short");
    expect(mixControl().statusLabel).toBe("需重混");
    expect(mixControl().canPlay).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "撤回编辑" }));
    expect(voices(current())[0].text).toBe(voices(project)[0].text);
    expect(current().speechWorkspace!.short.mixFingerprint).toBeUndefined();
    expect(current().exports[0].uri).toBe("asset://mix/original_short");
    expect(mixControl().statusLabel).toBe("需重混");
    fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    fireEvent.click(screen.getByRole("tab", { name: "短句" }));
    expect(current().speechWorkspace!.short.mixFingerprint).toBeUndefined();
    expect(mixControl().statusLabel).toBe("需重混");
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it("finishes a short mix in the background without changing the paragraph mix and restores the new short mix on return", async () => {
    let project = fixture();
    let paragraph = getSpeechWorkspaceProject(project, "paragraph");
    paragraph.exports = [{ type: "wav", status: "exported", uri: "asset://mix/original_paragraph" }];
    paragraph = captureSpeechWorkspace(paragraph, { mixFingerprint: getProjectMixFingerprint(paragraph) });
    project = switchSpeechWorkspace(paragraph, "short");
    saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
    const paragraphBefore = structuredClone(project.speechWorkspace!.paragraph);
    mockApi();
    let onUpdate!: (update: GenerationJobUpdate) => void;
    let job!: GenerationJobSnapshot;
    const bridge: GenerationBridge = {
      generateClip: vi.fn(async () => { throw new Error("Unexpected clip generation"); }),
      generateProjectMix: vi.fn(async (request, callback) => {
        onUpdate = callback;
        job = { jobId: "background_short_mix", clipId: "mix_short", target: { type: "project_mix", exportType: "wav" }, status: "generating", progress: .1,
          createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z" };
        expect(request.project.speechWorkspace?.activeMode).toBe("short");
        callback({ type: "snapshot", job }); return { jobId: job.jobId };
      }),
      cancelGeneration: vi.fn(async () => undefined),
    };
    bridgeFactory.mockReturnValue(bridge);
    await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "生成测试混音" }));
    await waitFor(() => expect(bridge.generateProjectMix).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    await act(async () => { onUpdate({ type: "succeeded", job: { ...job, status: "succeeded", progress: 1 }, asset: { assetId: "finished_short_mix", uri: "asset://mix/finished_short_mix", duration: 15 } }); });
    await waitFor(() => expect(current().speechWorkspace!.short.exports.find((entry) => entry.type === "wav")?.uri).toBe("asset://mix/finished_short_mix"));
    expect(current().speechWorkspace!.activeMode).toBe("paragraph");
    expect(current().speechWorkspace!.paragraph).toEqual(paragraphBefore);
    expect(mixControl().uri).toBe("asset://mix/original_paragraph");
    expect(mixControl().statusLabel).toBe("可试听");
    fireEvent.click(screen.getByRole("tab", { name: "短句" }));
    expect(mixControl().uri).toBe("asset://mix/finished_short_mix");
    expect(mixControl().statusLabel).toBe("可试听");
    expect(current().speechWorkspace!.short.mixFingerprint).toBe(getProjectMixFingerprint(current()));
    expect(bridge.cancelGeneration).not.toHaveBeenCalled();
  });

  it("undoes a short-page gap edit without losing the other page's later results", async () => {
    const project = fixture(); mockApi(); await mount(project);
    const gap = screen.getByRole("spinbutton", { name: "第 1 段后等待秒数" });
    fireEvent.change(gap, { target: { value: "2.5" } }); fireEvent.blur(gap);
    expect(voices(current())[0].pause_after).toBe(2.5);
    expect(voices(current())[1].start).toBe(6.5);
    fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    const paragraphAfter = structuredClone(current().speechWorkspace!.paragraph);
    fireEvent.click(screen.getByRole("button", { name: "撤回编辑" }));
    expect(current().speechWorkspace!.activeMode).toBe("paragraph");
    expect(current().speechWorkspace!.short.clips[0].pause_after).toBe(1);
    expect(current().speechWorkspace!.short.clips[1].start).toBe(5);
    expect(current().speechWorkspace!.paragraph).toEqual(paragraphAfter);
  });

  it("keeps a paragraph task running across unrelated short-gap edits and undo, then lists its result only on paragraph", async () => {
    const project = fixture(); const candidates = mockApi();
    let onUpdate!: (update: GenerationJobUpdate) => void;
    let job!: GenerationJobSnapshot;
    let request!: GenerateClipRequest;
    const bridge: GenerationBridge = {
      generateClip: vi.fn(async (input, callback) => {
        request = structuredClone(input); onUpdate = callback;
        job = { jobId: "paragraph_live", clipId: input.clipId, target: { type: "clip", clipId: input.clipId }, status: "generating", progress: .1,
          createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z" };
        callback({ type: "snapshot", job }); return { jobId: job.jobId };
      }),
      generateProjectMix: vi.fn(async () => { throw new Error("Unexpected mix"); }),
      cancelGeneration: vi.fn(async () => undefined),
    };
    bridgeFactory.mockReturnValue(bridge);
    await mount(project);
    fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    fireEvent.click(screen.getByRole("button", { name: "生成测试音频" }));
    await waitFor(() => expect(bridge.generateClip).toHaveBeenCalledOnce());
    expect(request.voiceOptions?.generationMode).toBe("paragraph");
    fireEvent.click(screen.getByRole("tab", { name: "短句" }));
    const gap = screen.getByRole("spinbutton", { name: "第 1 段后等待秒数" });
    fireEvent.change(gap, { target: { value: "2.5" } }); fireEvent.blur(gap);
    fireEvent.click(screen.getByRole("button", { name: "撤回编辑" }));
    expect(voices(current())[0].pause_after).toBe(1);
    expect(bridge.cancelGeneration).not.toHaveBeenCalled();
    const context = getVoiceParagraphContext(request.project, request.clipId)!;
    const clip = voices(request.project).find((item) => item.id === request.clipId)!;
    const candidate = makeVoiceCandidateFixture({ candidateId: "background_paragraph_take", projectId: project.project_id, clipId: clip.id,
      sourceFingerprint: getVoiceCandidateSourceFingerprint(clip, undefined, context),
      asset: { assetId: "background_paragraph_0", uri: "asset://clip/background_paragraph_0", duration: 1 },
      provenance: { provider: "voxcpm2", model: "VoxCPM2", seed: 7, temperature: 1, voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "paragraph", parameters: {},
        paragraph: { version: 1, groupId: context.groupId, text: context.text, clipIds: context.clips.map((item) => item.clipId),
          sourceAsset: { assetId: "background_paragraph_source", uri: "asset://clip/background_paragraph_source", duration: context.clips.length }, checkStatus: "passed",
          segments: context.clips.map((item, index) => ({ clipId: item.clipId, text: item.text,
            asset: { assetId: `background_paragraph_${index}`, uri: `asset://clip/background_paragraph_${index}`, duration: 1 },
            cutStartSeconds: index, cutEndSeconds: index + 1 })) } },
    });
    candidates.push(candidate);
    await act(async () => { onUpdate({ type: "candidate", job: { ...job, status: "succeeded", progress: 1 }, candidate }); });
    await waitFor(() => expect((screen.getByRole("button", { name: "音频全部重新生成" }) as HTMLButtonElement).disabled).toBe(false));
    expect(current().speechWorkspace!.activeMode).toBe("short");
    expect(screen.getByTestId("candidate-ids").textContent).toBe("");
    expect(voices(current()).map((item) => item.asset.asset_id)).toEqual(["short_0", "short_1"]);
    fireEvent.click(screen.getByRole("tab", { name: "整段" }));
    await waitFor(() => expect(screen.getByTestId("candidate-ids").textContent).toBe("background_paragraph_take"));
    expect(bridge.cancelGeneration).not.toHaveBeenCalled();
    expect(voices(current()).map((item) => item.asset.asset_id)).toEqual(["paragraph_0", "paragraph_1"]);
  });
});
