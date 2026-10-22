// @vitest-environment jsdom

import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerateClipRequest, GenerationBridge } from "@/lib/asmr/generation-bridge";
import { demoProject } from "@/lib/asmr/mock-project";
import { createInitialProjectLibrary, saveProjectLibrary } from "@/lib/asmr/project-library";
import type { AsmrProject } from "@/lib/asmr/schema";
import type { SelectedClipGenerationControl } from "@/lib/asmr/generation-view";
import type { VoiceGenerationOptions } from "@/lib/asmr/voice-generation-options";
import type { VoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";
import { StudioApp } from "./studio-app";

const bridgeFactory = vi.hoisted(() => vi.fn());
vi.mock("@/lib/asmr/local-generation-bridge", () => ({ createLocalGenerationBridge: bridgeFactory }));
vi.mock("./project-workspace", () => ({
  ProjectWorkspace: ({ children, project }: { children: ReactNode; project: AsmrProject }) =>
    <div><output data-testid="current-project">{JSON.stringify(project)}</output>{children}</div>,
}));
vi.mock("./planner-panel", () => ({ PlannerPanel: () => null }));
vi.mock("./timeline-panel", () => ({ TimelinePanel: () => null }));
vi.mock("./validation-panel", () => ({ ValidationPanel: () => null }));
vi.mock("./clip-storyboard-editor", () => ({ ClipStoryboardEditor: () => null }));
vi.mock("./script-editor-panel", () => ({
  ScriptEditorPanel: ({ batchActions }: { batchActions: ReactNode }) => <div>{batchActions}</div>,
}));
vi.mock("./editor-panels", () => ({
  EditorPanels: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./clip-inspector", () => ({
  ClipInspector: ({ voiceGenerationPanel, selectedClipGeneration, onGenerateSelectedClip }: {
    voiceGenerationPanel?: (control: ReactNode) => ReactNode;
    selectedClipGeneration: SelectedClipGenerationControl;
    onGenerateSelectedClip: () => void;
  }) => voiceGenerationPanel?.(<button type="button" disabled={selectedClipGeneration.disabled}
    onClick={onGenerateSelectedClip}>生成当前音频</button>) ?? null,
}));
// Observe the real App's restored settings, without invoking settings controls or
// making initialization depend on mounting the full voice settings implementation.
vi.mock("./voice-generation-panel", () => ({
  VoiceGenerationPanel: ({ options, catalog, catalogError, error, generationControl }: {
    options: VoiceGenerationOptions; catalog: VoiceProviderCatalog | null;
    catalogError?: string; error?: string; generationControl?: ReactNode;
  }) => <div>
    <output data-testid="restored-voice-options">{JSON.stringify(options)}</output>
    <output data-testid="voice-catalog-phase">{catalog ? "ready" : catalogError ? "error" : "loading"}</output>
    {catalogError ? <p role="alert">{catalogError}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {generationControl}
  </div>,
}));

const optionsKey = "ai-asmr-studio:v1:voice-options";
const savedOptions: VoiceGenerationOptions = {
  provider: "voxcpm2", voicePackId: "saved_reference", referenceMode: "reference_only",
  generationMode: "clip", analysisProvider: "local",
};
const catalogFixture: VoiceProviderCatalog = { providers: [
  { id: "gpt-sovits", label: "GPT-SoVITS", available: true, defaultReferenceId: "gpt_default",
    references: [{ id: "gpt_default", label: "另一可用引擎", referenceModes: ["with_reference_text"] }] },
  { id: "voxcpm2", label: "VoxCPM2", available: true, defaultReferenceId: "catalog_default",
    references: [
      { id: "catalog_default", label: "目录默认参考", referenceModes: ["with_reference_text"] },
      { id: "saved_reference", label: "原先保存的测试参考", referenceModes: ["reference_only", "with_reference_text"] },
    ], longText: { available: true, apiConfigured: true } },
] };

function projectFixture(): AsmrProject {
  const project = structuredClone(demoProject);
  project.project_id = "voice_readiness_fixture";
  project.title = "初始化测试工程";
  project.duration = 10;
  project.emotion_curve = [{ start: 0, end: 10, emotion: "gentle" }];
  project.videoPlan = { version: 1, sceneDescription: "温暖的小屋内，两段安静的台词。", shots: {} };
  project.timeline.tracks = project.timeline.tracks.map(track => track.track_type === "voice" ? {
    ...track, clips: track.clips.slice(0, 2).map((clip, index) => ({
      ...clip, text: `初始化测试第${index + 1}段台词。`, start: index * 5, duration: 3, semantic_unit: false,
      asset: index === 0 ? { asset_id: "readiness_adopted", uri: "asset://clip/readiness_adopted", duration: 3 }
        : { asset_id: null, uri: null, duration: null },
      generation: { ...clip.generation, status: index === 0 ? "asset_generated" as const : "asset_pending" as const },
    })),
  } : { ...track, clips: [] });
  return project;
}
function seed(project: AsmrProject, options = savedOptions) {
  saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
  window.localStorage.setItem(optionsKey, JSON.stringify(options));
}
function restoredOptions(): VoiceGenerationOptions {
  return JSON.parse(screen.getByTestId("restored-voice-options").textContent!);
}
function audioButton() {
  return screen.getByRole("button", { name: "生成未生成" }) as HTMLButtonElement;
}
function storyboardButton() {
  return screen.getByRole("button", { name: "分镜全部生成" }) as HTMLButtonElement;
}

type CatalogRequest = {
  signal?: AbortSignal | null;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  resolveBody?: (catalog: VoiceProviderCatalog) => void;
  headersSent: boolean;
  completed: boolean;
};
function mockApi(immediateCatalog?: VoiceProviderCatalog) {
  const catalogRequests: CatalogRequest[] = [];
  const candidateQueries: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/generation/clip" && init?.method !== "POST") {
      if (immediateCatalog) return Response.json(immediateCatalog);
      return await new Promise<Response>((resolve, reject) => {
        catalogRequests.push({ signal: init?.signal, resolve, reject, headersSent: false, completed: false });
      });
    }
    if (url.startsWith("/api/audio-candidates?")) {
      candidateQueries.push(url);
      return Response.json({ candidates: [] });
    }
    if (url.startsWith("/api/voice-generation-recordings?")) return Response.json({ recordings: [], nextCursor: null });
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: {
      bars: [10, 20], duration: 3, sampleRate: 48000, channels: 1,
      peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0,
    } });
    throw new Error(`Unexpected readiness fixture request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  function activeRequests() {
    return catalogRequests.filter(request => !request.signal?.aborted && !request.completed);
  }
  return {
    fetcher, catalogRequests, candidateQueries,
    deliverActiveHeaders() {
      for (const request of activeRequests()) {
        if (request.headersSent) continue;
        request.headersSent = true;
        const body = new Promise<VoiceProviderCatalog>(resolve => { request.resolveBody = resolve; });
        const response = new Response(null, { status: 200 });
        vi.spyOn(response, "json").mockImplementation(async () => await body);
        request.resolve(response);
      }
    },
    finishActiveCatalog(catalog = catalogFixture) {
      for (const request of activeRequests()) {
        request.completed = true;
        if (request.resolveBody) request.resolveBody(catalog);
        else request.resolve(Response.json(catalog));
      }
    },
    rejectActiveCatalog() {
      for (const request of activeRequests()) {
        request.completed = true;
        request.reject(new Error("fixture catalog network failure"));
      }
    },
    finishAbortedCatalog(catalog: VoiceProviderCatalog) {
      for (const request of catalogRequests.filter(request => request.signal?.aborted && !request.completed)) {
        request.completed = true; request.resolve(Response.json(catalog));
      }
    },
  };
}
function mockBridge() {
  const calls: GenerateClipRequest[] = [];
  const bridge: GenerationBridge = {
    generateClip: vi.fn(async (request, onUpdate) => {
      calls.push(structuredClone(request));
      const jobId = `readiness_job_${calls.length}`;
      onUpdate({ type: "snapshot", job: {
        jobId, clipId: request.clipId, target: { type: "clip", clipId: request.clipId },
        status: "generating", progress: 0.1,
        createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z",
      } });
      return { jobId };
    }),
    generateProjectMix: vi.fn(async () => { throw new Error("Readiness must not generate a project mix"); }),
    cancelGeneration: vi.fn(async () => undefined),
  };
  bridgeFactory.mockReturnValue(bridge);
  return { bridge, calls };
}
async function mountOnStoryboard(project: AsmrProject) {
  const view = render(<StrictMode><StudioApp project={project} /></StrictMode>);
  // No click, selection or settings-change event is ever sent to the sound tab.
  fireEvent.click(screen.getByRole("tab", { name: "分镜" }));
  await waitFor(() => expect(screen.getByRole("status", {
    name: "已采用 1 段，待生成 1 段，已生成未采用 0 段，共 2 段",
  })).toBeTruthy());
  expect(screen.getByRole("tab", { name: "声音" }).getAttribute("aria-selected")).toBe("false");
  return view;
}

beforeEach(() => {
  window.localStorage.clear(); bridgeFactory.mockReset();
  vi.stubEnv("NEXT_PUBLIC_ASMR_GENERATION_MODE", "local");
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("StudioApp initial voice settings readiness", () => {
  it("keeps audio disabled through delayed catalog headers and JSON, then dispatches with restored options", async () => {
    const project = projectFixture(); seed(project);
    const api = mockApi(); const generation = mockBridge();
    await mountOnStoryboard(project);
    expect(api.candidateQueries.length).toBeGreaterThan(0);
    expect(audioButton().disabled).toBe(true);
    expect(storyboardButton().disabled).toBe(false);
    expect(screen.getByText("正在读取声音设置…")).toBeTruthy();
    fireEvent.click(audioButton());
    expect(generation.calls).toHaveLength(0);
    expect(screen.queryByText("当前人声引擎尚未就绪，请先检查声音设置。")).toBeNull();
    await act(async () => api.deliverActiveHeaders());
    expect(audioButton().disabled).toBe(true);
    expect(screen.getByTestId("voice-catalog-phase").textContent).toBe("loading");
    await act(async () => api.finishActiveCatalog());
    await waitFor(() => expect(audioButton().disabled).toBe(false));
    expect(restoredOptions()).toEqual(savedOptions);
    fireEvent.click(audioButton());
    await waitFor(() => expect(generation.calls).toHaveLength(1));
    expect(generation.calls[0].voiceOptions).toEqual(savedOptions);
    expect(generation.calls[0].project).toEqual(project);
    expect(JSON.parse(window.localStorage.getItem(optionsKey)!)).toEqual(savedOptions);
  });

  it("starts the first batch from storyboard view without visiting sound settings or replacing a valid saved reference", async () => {
    const project = projectFixture();
    const options: VoiceGenerationOptions = { ...savedOptions, generationMode: "long_text", analysisProvider: "local" };
    seed(project, options); mockApi(catalogFixture); const generation = mockBridge();
    await mountOnStoryboard(project);
    await waitFor(() => expect(audioButton().disabled).toBe(false));
    expect(restoredOptions()).toEqual(options);
    fireEvent.click(audioButton());
    await waitFor(() => expect(generation.calls).toHaveLength(1));
    expect(generation.calls[0].voiceOptions).toEqual(options);
    expect(generation.calls[0].voiceOptions?.voicePackId).not.toBe(catalogFixture.providers[1].defaultReferenceId);
    expect(screen.getByRole("tab", { name: "声音" }).getAttribute("aria-selected")).toBe("false");
    expect(generation.bridge.generateProjectMix).not.toHaveBeenCalled();
  });

  it("keeps audio disabled after catalog failure and reports a read error while storyboards remain available", async () => {
    const project = projectFixture(); seed(project);
    const api = mockApi(); const generation = mockBridge();
    await mountOnStoryboard(project);
    await act(async () => api.rejectActiveCatalog());
    await waitFor(() => expect(screen.getAllByText("无法读取人声配置，请刷新重试。").length).toBeGreaterThan(0));
    expect(audioButton().disabled).toBe(true);
    expect(storyboardButton().disabled).toBe(false);
    fireEvent.click(audioButton());
    expect(generation.calls).toHaveLength(0);
    expect(screen.queryByText("当前人声引擎尚未就绪，请先检查声音设置。")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(optionsKey)!)).toEqual(savedOptions);
  });

  it("rejects a known unavailable selected provider instead of falling back to the available engine", async () => {
    const project = projectFixture(); seed(project);
    const unavailable = structuredClone(catalogFixture);
    unavailable.providers[1].available = false;
    unavailable.providers[1].unavailableReason = "测试 Vox 模型尚未配置";
    mockApi(unavailable); const generation = mockBridge();
    await mountOnStoryboard(project);
    await waitFor(() => expect(screen.getByTestId("voice-catalog-phase").textContent).toBe("ready"));
    expect(restoredOptions()).toEqual(savedOptions);
    fireEvent.click(audioButton());
    await waitFor(() => expect(screen.getByText(/当前人声引擎尚未就绪|测试 Vox 模型尚未配置/)).toBeTruthy());
    expect(generation.calls).toHaveLength(0);
    expect(restoredOptions()).toEqual(savedOptions);
    expect(JSON.parse(window.localStorage.getItem(optionsKey)!)).toEqual(savedOptions);
    expect(storyboardButton().disabled).toBe(false);
  });

  it("ignores an aborted StrictMode catalog arriving after the active response restored the saved reference", async () => {
    const project = projectFixture(); seed(project);
    const api = mockApi(); const generation = mockBridge();
    await mountOnStoryboard(project);
    expect(api.catalogRequests.some(request => request.signal?.aborted)).toBe(true);
    await act(async () => api.finishActiveCatalog());
    await waitFor(() => expect(audioButton().disabled).toBe(false));
    expect(restoredOptions()).toEqual(savedOptions);
    const staleCatalog = structuredClone(catalogFixture);
    staleCatalog.providers[1].references = [staleCatalog.providers[1].references[0]];
    await act(async () => api.finishAbortedCatalog(staleCatalog));
    expect(restoredOptions()).toEqual(savedOptions);
    fireEvent.click(audioButton());
    await waitFor(() => expect(generation.calls).toHaveLength(1));
    expect(generation.calls[0].voiceOptions).toEqual(savedOptions);
  });
});
