// @vitest-environment jsdom

import { StrictMode, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVoiceCandidateSourceFingerprint, type AudioCandidate } from "@/lib/asmr/audio-candidate";
import { getVoiceGenerationContext } from "@/lib/asmr/voice-generation-context";
import type { GenerationBridge } from "@/lib/asmr/generation-bridge";
import { demoProject } from "@/lib/asmr/mock-project";
import { createInitialProjectLibrary, getCurrentLibraryEntry, loadProjectLibrary, saveProjectLibrary } from "@/lib/asmr/project-library";
import type { AsmrProject, TimelineClip } from "@/lib/asmr/schema";
import { flattenClips } from "@/lib/asmr/view-model";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import type { SelectedClipGenerationControl } from "@/lib/asmr/generation-view";
import { StudioApp } from "./studio-app";

const bridgeFactory = vi.hoisted(() => vi.fn());
const inspector = vi.hoisted(() => ({ generate: undefined as (() => void) | undefined }));
const editor = vi.hoisted(() => ({ update: undefined as ((id: string, updates: Partial<TimelineClip>) => void) | undefined,
  select: undefined as ((id: string) => void) | undefined }));
vi.mock("@/lib/asmr/local-generation-bridge", () => ({ createLocalGenerationBridge: bridgeFactory }));
vi.mock("./project-workspace", () => ({ ProjectWorkspace: ({ children, project, onCreateProject }: {
  children: ReactNode; project: AsmrProject; onCreateProject: () => void;
}) => <div><output data-testid="current-project">{JSON.stringify(project)}</output><button onClick={onCreateProject}>测试新建项目</button>{children}</div> }));
vi.mock("./planner-panel", () => ({ PlannerPanel: () => null }));
vi.mock("./clip-inspector", () => ({ ClipInspector: ({ voiceGenerationPanel, selectedClipGeneration, onGenerateSelectedClip }: {
  voiceGenerationPanel?: (control: ReactNode) => ReactNode; selectedClipGeneration: SelectedClipGenerationControl; onGenerateSelectedClip: () => void;
}) => { inspector.generate = onGenerateSelectedClip; return voiceGenerationPanel?.(<button disabled={selectedClipGeneration.disabled} onClick={onGenerateSelectedClip}>测试生成音频</button>) ?? null; } }));
vi.mock("./script-editor-panel", () => ({ ScriptEditorPanel: ({ project, onSelectClip, onUpdateClip, batchActions }: {
  project: AsmrProject; onSelectClip: (id: string) => void; onUpdateClip: (id: string, updates: Partial<TimelineClip>) => void; batchActions: ReactNode;
}) => { editor.update = onUpdateClip; editor.select = onSelectClip; return <div>{batchActions}{flattenClips(project).filter((clip) => clip.type === "voice").map((clip, index) => <button key={clip.id} onClick={() => onSelectClip(clip.id)}>测试选择第{index + 1}段</button>)}</div>; } }));
vi.mock("./timeline-panel", () => ({ TimelinePanel: () => null }));
vi.mock("./validation-panel", () => ({ ValidationPanel: () => null }));
vi.mock("./emotion-curve", () => ({ EmotionCurve: () => null }));
vi.mock("./editor-panels", () => ({ EditorPanels: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const options = { provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "long_text", analysisProvider: "local" } as const;
const catalog = { providers: [{ id: "voxcpm2", label: "VoxCPM2", available: true, defaultReferenceId: "soft_zh",
  references: [{ id: "soft_zh", label: "原参考声音", referenceModes: ["with_reference_text"] }], longText: { available: true, apiConfigured: true } }] };

function fixture(semantic = false) {
  const project = structuredClone(demoProject);
  project.project_id = "recheck_project";
  project.timeline.tracks = project.timeline.tracks.map((track) => track.track_type === "voice" ? { ...track,
    clips: track.clips.slice(0, 2).map((clip, index) => ({ ...clip, text: `保留第${index + 1}段原台词。`, semantic_unit: semantic,
      asset: { asset_id: `keep_${index}`, uri: `asset://clip/keep_${index}`, duration: clip.duration },
      generation: { ...clip.generation, status: "asset_generated" as const } })) } : { ...track, clips: [] });
  const voice = flattenClips(project).find((clip) => clip.type === "voice")!;
  if (voice.type !== "voice") throw new Error("Voice fixture required");
  const context = getVoiceGenerationContext(project, voice.id);
  const candidate = makeVoiceCandidateFixture({ projectId: project.project_id, clipId: voice.id,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(voice, context), asset: { assetId: voice.asset.asset_id!, uri: voice.asset.uri!, duration: voice.duration } });
  candidate.provenance.generationMode = "long_text";
  candidate.provenance.longText = { version: 1, analysisProvider: "local", loudnessGainDb: 0, asrModel: "fixture-asr", ...(context ? { context } : {}),
    plan: { clauses: [voice.text], groups: [{ start: 0, end: 0, text: voice.text, pauseAfter: "medium" }], clausePauseClasses: [], provider: "rules", warnings: [] },
    groups: [{ index: 0, text: voice.text, inputText: voice.text, paddingClauses: [], isFinal: context?.isFinal ?? true, pauseAfter: "medium", seed: 1234, parameters: {},
      asset: candidate.asset, internalPausesMs: [], internalPauseClasses: [], leadingQuietMs: 0, trailingQuietMs: 0,
      transcript: voice.text, coverage: 1, cutStartSeconds: 0, cutEndSeconds: voice.duration, attempts: 1, checkStatus: "review", diagnosticCode: "unrecognized_continuation" }], joins: [] };
  saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
  window.localStorage.setItem("ai-asmr-studio:v1:voice-options", JSON.stringify(options));
  return { project, candidate, voice };
}

function api(candidate: AudioCandidate) {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/generation/clip" && init?.method !== "POST") return Response.json(catalog);
    if (url.startsWith("/api/audio-candidates?")) {
      const projectId = new URL(url, "http://localhost").searchParams.get("projectId");
      return Response.json({ candidates: candidate.projectId === projectId ? [candidate] : [] });
    }
    if (url.startsWith("/api/audio-candidates/" + candidate.candidateId + "?") && !init?.method) return Response.json({ candidate });
    if (url.startsWith("/api/voice-generation-recordings?")) return Response.json({ recordings: [], nextCursor: null });
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [10], duration: 3, sampleRate: 48000, channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    throw new Error("Unexpected candidate request: " + url);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
function currentProject(): AsmrProject { return JSON.parse(screen.getByTestId("current-project").textContent!); }
async function mount(project: AsmrProject) {
  render(<StrictMode><StudioApp project={project} /></StrictMode>);
  await screen.findByRole("article", { name: "候选 1" });
  await waitFor(() => expect((screen.getByRole("button", { name: "测试生成音频" }) as HTMLButtonElement).disabled).toBe(false));
}
function expectNoRetry(fetcher: ReturnType<typeof api>) {
  expect(screen.queryByRole("button", { name: /重新切分|重新识别|取消切分/ })).toBeNull();
  expect(fetcher.mock.calls.some(([input]) => String(input).endsWith("/recheck"))).toBe(false);
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  expect(bridgeFactory).not.toHaveBeenCalled();
}
beforeEach(() => {
  window.localStorage.clear(); bridgeFactory.mockReset(); vi.stubEnv("NEXT_PUBLIC_ASMR_GENERATION_MODE", "local");
  const bridge: GenerationBridge = { generateClip: vi.fn(), generateProjectMix: vi.fn(), cancelGeneration: vi.fn() };
  bridgeFactory.mockReturnValue(bridge);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("StudioApp saved audio without a manual cutting retry entry", () => {
  it.each(["legacy", "cutting_only"])("keeps %s original playback and generation available without a retry action", async mode => {
    const { project, candidate, voice } = fixture();
    if (mode === "cutting_only") candidate.provenance.longText!.groups[0].recognition = {
      analysisMode: "cutting_only", stage: "boundary_check", expectedText: voice.text, sourceTranscript: voice.text,
    };
    const original = JSON.stringify(candidate); const fetcher = api(candidate); await mount(project);
    expect(screen.getByLabelText("候选 1 试听").getAttribute("src")).toContain("keep_0");
    expect(screen.getByLabelText("候选 1 第 1 组试听").getAttribute("src")).toContain("keep_0");
    expect(currentProject()).toEqual(project); expect(JSON.stringify(candidate)).toBe(original);
    expectNoRetry(fetcher);
  });

  it("still adopts a saved candidate through the ordinary checked GET without retrying ASR or generating audio", async () => {
    const { project, candidate } = fixture();
    candidate.asset = { ...candidate.asset, assetId: "saved_alternative", uri: "asset://clip/saved_alternative" };
    candidate.provenance.longText!.groups[0].asset = candidate.asset;
    candidate.provenance.longText!.groups[0].checkStatus = "passed";
    const fetcher = api(candidate); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "采用候选 1" }));
    await waitFor(() => expect(flattenClips(currentProject()).find(clip => clip.id === candidate.clipId)?.asset.asset_id).toBe("saved_alternative"));
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).toEqual(currentProject());
    expectNoRetry(fetcher);
  });
});
