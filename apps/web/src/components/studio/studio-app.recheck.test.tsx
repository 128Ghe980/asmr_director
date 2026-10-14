// @vitest-environment jsdom

import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

type RecheckPost = { url: string; body: { project: AsmrProject; clipId: string }; signal?: AbortSignal | null;
  resolve: (response: Response) => void; reject: (reason?: unknown) => void };
function api(candidate: AudioCandidate) {
  const posts: RecheckPost[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/generation/clip" && init?.method !== "POST") return Response.json(catalog);
    if (url.startsWith("/api/audio-candidates?")) {
      const projectId = new URL(url, "http://localhost").searchParams.get("projectId");
      return Response.json({ candidates: candidate.projectId === projectId ? [candidate] : [] });
    }
    if (url.startsWith("/api/voice-generation-recordings?")) return Response.json({ recordings: [], nextCursor: null });
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [10], duration: 3, sampleRate: 48000, channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    if (url.endsWith("/recheck") && init?.method === "POST") return await new Promise<Response>((resolve, reject) => {
      posts.push({ url, body: JSON.parse(String(init.body)), signal: init.signal, resolve, reject });
    });
    throw new Error(`Unexpected re-recognition request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return { posts, fetcher };
}
function checked(candidate: AudioCandidate, candidateId = "rechecked_candidate"): AudioCandidate {
  return { ...structuredClone(candidate), candidateId, asset: { assetId: "rechecked_audio", uri: "asset://clip/rechecked_audio", duration: 3 } };
}
function currentProject(): AsmrProject { return JSON.parse(screen.getByTestId("current-project").textContent!); }
async function mount(project: AsmrProject) {
  const view = render(<StrictMode><StudioApp project={project} /></StrictMode>);
  await waitFor(() => expect((screen.getByRole("button", { name: "重新识别候选 1" }) as HTMLButtonElement).disabled).toBe(false));
  return view;
}
beforeEach(() => {
  window.localStorage.clear(); bridgeFactory.mockReset(); vi.stubEnv("NEXT_PUBLIC_ASMR_GENERATION_MODE", "local");
  const bridge: GenerationBridge = { generateClip: vi.fn(), generateProjectMix: vi.fn(), cancelGeneration: vi.fn() };
  bridgeFactory.mockReturnValue(bridge);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("StudioApp saved candidate re-recognition", () => {
  it("posts the selected saved take, adds a new candidate and preserves the adopted project without TTS", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    const original = JSON.stringify(candidate);
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    expect(mock.posts).toHaveLength(1);
    expect(mock.posts[0].url).toBe(`/api/audio-candidates/${candidate.candidateId}/recheck`);
    expect(mock.posts[0].body).toEqual({ project, clipId: candidate.clipId });
    expect(screen.getByRole("button", { name: "重新识别候选 1" }).textContent).toBe("重新识别中…");
    expect((screen.getByRole("button", { name: "音频全部重新生成" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "添加参考音频" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => inspector.generate?.());
    expect(bridgeFactory).not.toHaveBeenCalled();
    await act(async () => mock.posts[0].resolve(Response.json({ candidate: checked(candidate) })));
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(2);
    expect(JSON.stringify(candidate)).toBe(original);
    expect(currentProject()).toEqual(project);
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).toEqual(project);
    expect(screen.getByRole("article", { name: "候选 2" }).textContent).toContain("已采用");
    expect(screen.getByRole("article", { name: "候选 1" }).textContent).toContain("保留完整原音，未采用裁剪。");
    expect(screen.getByRole("article", { name: "候选 1" }).querySelector("audio")?.getAttribute("src")).toContain("rechecked_audio");
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    expect(mock.posts[1].url).toBe("/api/audio-candidates/rechecked_candidate/recheck");
    await act(async () => mock.posts[1].resolve(Response.json({ candidate: checked(checked(candidate), "rechecked_again") })));
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(3);
    expect(currentProject()).toEqual(project);
    expect((screen.getByRole("combobox", { name: "生成方式" }) as HTMLSelectElement).value).toBe("long_text");
    expect(window.localStorage.getItem("ai-asmr-studio:v1:voice-options")).toBe(JSON.stringify(options));
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it.each([
    { status: 422, error: "完整原音定位失败，请保留原候选。" },
    { status: 503, error: "本地识别服务暂不可用，请稍后重试；原候选已保留。" },
  ])("retains old content and the server error for HTTP $status recognition failures", async ({ status, error }) => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    await act(async () => mock.posts[0].resolve(Response.json({ error }, { status })));
    expect(screen.getByText(error)).toBeTruthy();
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(1);
    expect(currentProject()).toEqual(project);
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it("keeps the original candidate, project and options after a network rejection and permits retry without TTS", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    const originalCandidate = JSON.stringify(candidate);
    const optionsBefore = window.localStorage.getItem("ai-asmr-studio:v1:voice-options");
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    await act(async () => mock.posts[0].reject(new TypeError("Failed to fetch")));
    expect(screen.getByText("无法连接本地服务，请确认 3001 服务正在运行后重试；原候选已保留。")).toBeTruthy();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(1);
    expect(screen.getByRole("article", { name: "候选 1" }).textContent).toContain("已采用");
    expect(screen.getByRole("article", { name: "候选 1" }).querySelector("audio")?.getAttribute("src")).toContain(candidate.asset.assetId);
    expect(JSON.stringify(candidate)).toBe(originalCandidate);
    expect(currentProject()).toEqual(project);
    expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).toEqual(project);
    expect(window.localStorage.getItem("ai-asmr-studio:v1:voice-options")).toBe(optionsBefore);
    expect((screen.getByRole("button", { name: "重新识别候选 1" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "添加参考音频" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "取消重新识别" })).toBeNull();
    expect(bridgeFactory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    expect(mock.posts).toHaveLength(2);
    expect(mock.posts[1].signal?.aborted).toBe(false);
    await act(async () => mock.posts[1].resolve(Response.json({ candidate: checked(candidate) })));
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(2);
    expect(screen.queryByText("无法连接本地服务，请确认 3001 服务正在运行后重试；原候选已保留。")).toBeNull();
    expect(currentProject()).toEqual(project);
    expect(window.localStorage.getItem("ai-asmr-studio:v1:voice-options")).toBe(optionsBefore);
    expect(mock.fetcher.mock.calls.some(([input, init]) => String(input) === "/api/generation/clip" && init?.method === "POST")).toBe(false);
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it.each(["invalid_json", "null", "http502"])("shows a clear retained-original error for a %s protocol failure", async (kind) => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    const response = kind === "null" ? Response.json(null) : kind === "http502"
      ? new Response("<html><body>Bad gateway detail</body></html>", { status: 502, headers: { "content-type": "text/html" } })
      : new Response("invalid response");
    await act(async () => mock.posts[0].resolve(response));
    expect(screen.getByText("重新识别服务未返回有效结果，请刷新页面后重试；原候选已保留。")).toBeTruthy();
    expect(screen.queryByText(/Bad gateway detail|invalid response/)).toBeNull();
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(1);
    expect(currentProject()).toEqual(project);
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it.each(["invalid", "project", "clip", "source", "same_id", "context"])("rejects a %s response without adding or adopting it", async (kind) => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    const result = checked(candidate);
    if (kind === "project") result.projectId = "foreign";
    if (kind === "clip") result.clipId = "foreign_clip";
    if (kind === "source") result.sourceFingerprint = "different";
    if (kind === "same_id") result.candidateId = candidate.candidateId;
    if (kind === "context") { result.provenance.longText!.context = { version: 1, followingClauses: ["别的后文。"], isFinal: false }; result.provenance.longText!.groups[0].isFinal = false; }
    await act(async () => mock.posts[0].resolve(Response.json({ candidate: kind === "invalid" ? { ...result, privatePath: "unsafe" } : result })));
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(1);
    expect(screen.getByText("重新识别结果与当前片段不一致，原候选已保留。" )).toBeTruthy();
    expect(currentProject()).toEqual(project);
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it("rejects a late result after the source text changes", async () => {
    const { project, candidate, voice } = fixture(); const mock = api(candidate); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    act(() => editor.update?.(voice.id, { text: "手动修改后的目标台词。" }));
    await act(async () => mock.posts[0].resolve(Response.json({ candidate: checked(candidate) })));
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(1);
    expect(screen.getByText("文案或后续上下文已修改，重新识别结果未加入；原候选已保留。")).toBeTruthy();
    expect(currentProject().timeline.tracks.find((track) => track.track_type === "voice")?.clips[0].text).toBe("手动修改后的目标台词。");
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it("uses the current semantic following context and rejects a reply after only that context changes", async () => {
    const { project, candidate } = fixture(true); const mock = api(candidate); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    expect(mock.posts[0].body).toEqual({ project, clipId: candidate.clipId });
    const second = flattenClips(project).filter((clip) => clip.type === "voice")[1];
    act(() => { editor.update?.(second.id, { text: "下一段已被手动修改。" }); editor.select?.(candidate.clipId); });
    await act(async () => mock.posts[0].resolve(Response.json({ candidate: checked(candidate) })));
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(1);
    expect(screen.getByText("文案或后续上下文已修改，重新识别结果未加入；原候选已保留。")).toBeTruthy();
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it("aborts on clip switching and keeps a newer pending recheck protected from the old reply", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    fireEvent.click(screen.getByRole("button", { name: "测试选择第2段" }));
    expect(mock.posts[0].signal?.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "测试选择第1段" }));
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    expect(mock.posts).toHaveLength(2);
    await act(async () => mock.posts[0].resolve(Response.json({ candidate: checked(candidate, "late_old") })));
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "重新识别候选 1" }).textContent).toBe("重新识别中…");
    expect(mock.posts[1].signal?.aborted).toBe(false);
    await act(async () => mock.posts[1].resolve(Response.json({ candidate: checked(candidate, "new_current") })));
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(2);
    expect(currentProject()).toEqual(project);
  });

  it("aborts on project switching and ignores the old project's reply", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    fireEvent.click(screen.getByRole("button", { name: "测试新建项目" }));
    expect(mock.posts[0].signal?.aborted).toBe(true);
    const newProject = currentProject();
    expect(newProject.project_id).not.toBe(project.project_id);
    await act(async () => mock.posts[0].resolve(Response.json({ candidate: checked(candidate) })));
    expect(screen.queryByRole("article", { name: /候选 \d/ })).toBeNull();
    expect(currentProject()).toEqual(newProject);
  });

  it.each(["cancel", "unmount"])("aborts on %s and ignores a successful late reply", async (action) => {
    const { project, candidate } = fixture(); const mock = api(candidate); const view = await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    if (action === "cancel") fireEvent.click(screen.getByRole("button", { name: "取消重新识别" }));
    else view.unmount();
    expect(mock.posts[0].signal?.aborted).toBe(true);
    await act(async () => mock.posts[0].resolve(Response.json({ candidate: checked(candidate) })));
    if (action === "cancel") { expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(1); expect(currentProject()).toEqual(project); }
    expect(bridgeFactory).not.toHaveBeenCalled();
  });

  it("ignores a canceled request's late network rejection while protecting the newer recheck", async () => {
    const { project, candidate } = fixture(); const mock = api(candidate); await mount(project);
    const optionsBefore = window.localStorage.getItem("ai-asmr-studio:v1:voice-options");
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    fireEvent.click(screen.getByRole("button", { name: "取消重新识别" }));
    expect(mock.posts[0].signal?.aborted).toBe(true);
    expect((screen.getByRole("button", { name: "重新识别候选 1" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "重新识别候选 1" }));
    expect(mock.posts).toHaveLength(2);
    await act(async () => mock.posts[0].reject(new TypeError("Failed to fetch")));
    expect(screen.queryByText("无法连接本地服务，请确认 3001 服务正在运行后重试；原候选已保留。")).toBeNull();
    expect(screen.getByRole("button", { name: "重新识别候选 1" }).textContent).toBe("重新识别中…");
    expect(mock.posts[1].signal?.aborted).toBe(false);
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(1);
    expect(currentProject()).toEqual(project);
    expect(window.localStorage.getItem("ai-asmr-studio:v1:voice-options")).toBe(optionsBefore);
    await act(async () => mock.posts[1].resolve(Response.json({ candidate: checked(candidate) })));
    expect(screen.getAllByRole("article", { name: /候选 \d/ })).toHaveLength(2);
    expect(currentProject()).toEqual(project);
    expect(bridgeFactory).not.toHaveBeenCalled();
  });
});
