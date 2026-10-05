// @vitest-environment jsdom

import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationBridge } from "@/lib/asmr/generation-bridge";
import { demoProject } from "@/lib/asmr/mock-project";
import { createInitialProjectLibrary, getCurrentLibraryEntry, loadProjectLibrary, saveProjectLibrary } from "@/lib/asmr/project-library";
import type { AsmrProject } from "@/lib/asmr/schema";
import type { SelectedClipGenerationControl } from "@/lib/asmr/generation-view";
import type { VoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";
import { StudioApp } from "./studio-app";

const bridgeFactory = vi.hoisted(() => vi.fn());
const inspector = vi.hoisted(() => ({ onGenerate: undefined as (() => void) | undefined }));
vi.mock("@/lib/asmr/local-generation-bridge", () => ({ createLocalGenerationBridge: bridgeFactory }));
vi.mock("./project-workspace", () => ({ ProjectWorkspace: ({ children, project }: { children: ReactNode; project: AsmrProject }) => <div><output data-testid="current-project">{JSON.stringify(project)}</output>{children}</div> }));
vi.mock("./planner-panel", () => ({ PlannerPanel: () => null }));
vi.mock("./clip-inspector", () => ({ ClipInspector: ({ voiceGenerationPanel, selectedClipGeneration, onGenerateSelectedClip }: {
  voiceGenerationPanel: (control: ReactNode) => ReactNode; selectedClipGeneration: SelectedClipGenerationControl; onGenerateSelectedClip: () => void;
}) => { inspector.onGenerate = onGenerateSelectedClip; return voiceGenerationPanel(<button type="button" disabled={selectedClipGeneration.disabled} onClick={onGenerateSelectedClip}>生成当前音频</button>); } }));
vi.mock("./script-editor-panel", () => ({ ScriptEditorPanel: ({ batchActions }: { batchActions: ReactNode }) => <div>{batchActions}</div> }));
vi.mock("./timeline-panel", () => ({ TimelinePanel: () => null }));
vi.mock("./validation-panel", () => ({ ValidationPanel: () => null }));
vi.mock("./emotion-curve", () => ({ EmotionCurve: () => null }));
vi.mock("./editor-panels", () => ({ EditorPanels: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const originalOptions = { provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "clip", analysisProvider: "local" } as const;
const originalCatalog: VoiceProviderCatalog = { providers: [
  { id: "gpt-sovits", label: "GPT-SoVITS", available: true, defaultReferenceId: "default", references: [{ id: "default", label: "旧声音", referenceModes: ["with_reference_text"] }] },
  { id: "voxcpm2", label: "VoxCPM2", available: true, defaultReferenceId: "soft_zh", references: [{ id: "soft_zh", label: "当前参考声音", referenceModes: ["with_reference_text"] }], longText: { available: true, apiConfigured: true } },
] };
const importedReference = { id: "user_reference", label: "正太音", referenceModes: ["reference_only"] as ("reference_only")[], audioUrl: "/api/voice-references/user_reference/audio", durationSeconds: 15 };
const importedCatalog: VoiceProviderCatalog = { providers: originalCatalog.providers.map((provider) => provider.id === "voxcpm2" ? { ...provider, references: [...provider.references, importedReference] } : provider) };

function projectFixture() {
  const project = structuredClone(demoProject);
  project.project_id = "reference_import_project";
  project.timeline.tracks = project.timeline.tracks.map((track) => track.track_type === "voice" ? {
    ...track, clips: track.clips.slice(0, 2).map((clip, index) => ({ ...clip, semantic_unit: false, text: `保留原有第 ${index + 1} 段台词。`,
      asset: { asset_id: `keep_${index}`, uri: `asset://clip/keep_${index}`, duration: clip.duration },
      generation: { ...clip.generation, status: "asset_generated" as const } })),
  } : { ...track, clips: [] });
  return project;
}
function seed(project: AsmrProject) {
  saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
  window.localStorage.setItem("ai-asmr-studio:v1:voice-options", JSON.stringify(originalOptions));
}
function mockApi() {
  let catalog = originalCatalog;
  let resolveImport!: (response: Response) => void;
  const importResponse = new Promise<Response>((done) => { resolveImport = done; });
  const requests: { body: FormData; signal?: AbortSignal | null }[] = [];
  let resolveTranscription!: (response: Response) => void;
  const transcriptionResponse = new Promise<Response>((done) => { resolveTranscription = done; });
  const transcriptions: { body: FormData; signal?: AbortSignal | null }[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/generation/clip" && init?.method !== "POST") return Response.json(catalog);
    if (url.startsWith("/api/audio-candidates?")) return Response.json({ candidates: [] });
    if (url.startsWith("/api/voice-generation-recordings?")) return Response.json({ recordings: [], nextCursor: null });
    if (url === "/api/voice-references" && init?.method === "POST") { requests.push({ body: init.body as FormData, signal: init.signal }); return importResponse; }
    if (url === "/api/voice-references/transcribe" && init?.method === "POST") { transcriptions.push({ body: init.body as FormData, signal: init.signal }); return transcriptionResponse; }
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [10, 20], duration: 3, sampleRate: 48000, channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    throw new Error(`Unexpected reference integration request: ${url}`);
  }));
  return { requests, transcriptions,
    finishTranscription() { resolveTranscription(Response.json({ transcript: "识别出来的参考原话。", language: "zh", startSeconds: 0, durationSeconds: 8 })); },
    finish() { catalog = importedCatalog; resolveImport(Response.json({ reference: importedReference, catalog })); } };
}
function mockBridge() {
  const bridge: GenerationBridge = {
    generateClip: vi.fn(async () => ({ jobId: "test_generation_job" })),
    generateProjectMix: vi.fn(async () => ({ jobId: "test_mix_job" })), cancelGeneration: vi.fn(async () => undefined),
  };
  bridgeFactory.mockReturnValue(bridge); return bridge;
}
async function mount(project: AsmrProject, referenceId = "soft_zh") {
  const view = render(<StrictMode><StudioApp project={project} /></StrictMode>);
  await waitFor(() => expect((screen.getByRole("combobox", { name: "参考声音" }) as HTMLSelectElement).value).toBe(referenceId));
  await waitFor(() => expect((screen.getByRole("button", { name: "音频全部重新生成" }) as HTMLButtonElement).disabled).toBe(false));
  return view;
}
function startImport() {
  fireEvent.click(screen.getByRole("button", { name: "添加参考音频" }));
  fireEvent.change(screen.getByLabelText("参考音频文件"), { target: { files: [new File(["audio"], "正太音.mp3", { type: "audio/mpeg" })] } });
  fireEvent.click(screen.getByRole("button", { name: "保存并选用参考音频" }));
}

beforeEach(() => {
  window.localStorage.clear(); bridgeFactory.mockReset(); inspector.onGenerate = undefined;
  vi.stubEnv("NEXT_PUBLIC_ASMR_GENERATION_MODE", "local");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:reference-app-test") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("StudioApp reference audio import", () => {
  it("blocks native generation during reference recognition without publishing or changing the project", async () => {
    const project = projectFixture(); seed(project); const api = mockApi(); const bridge = mockBridge(); await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "添加参考音频" }));
    fireEvent.change(screen.getByLabelText("参考音频文件"), { target: { files: [new File(["audio"], "正太音.mp3", { type: "audio/mpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: "识别所选片段文字" }));
    expect(api.transcriptions).toHaveLength(1); expect(api.requests).toHaveLength(0);
    expect((screen.getByRole("button", { name: "生成当前音频" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "音频全部重新生成" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => inspector.onGenerate?.()); expect(bridge.generateClip).not.toHaveBeenCalled();
    await act(async () => api.finishTranscription());
    await waitFor(() => expect((screen.getByLabelText("参考片段原话") as HTMLTextAreaElement).value).toBe("识别出来的参考原话。"));
    expect((screen.getByRole("button", { name: "生成当前音频" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "音频全部重新生成" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("combobox", { name: "参考声音" }) as HTMLSelectElement).value).toBe("soft_zh");
    expect(screen.getByTestId("current-project").textContent).toBe(JSON.stringify(project));
    expect(api.requests).toHaveLength(0); expect(bridge.generateClip).not.toHaveBeenCalled();
  });

  it("refuses recognition when generation starts before the busy controls render", async () => {
    const project = projectFixture(); seed(project); const api = mockApi(); const bridge = mockBridge();
    vi.mocked(bridge.generateClip).mockImplementation(async (request, onUpdate) => {
      onUpdate({ type: "snapshot", job: { jobId: "test_generation_job", clipId: request.clipId,
        status: "generating", progress: 1, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" } });
      return { jobId: "test_generation_job" };
    });
    await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "添加参考音频" }));
    fireEvent.change(screen.getByLabelText("参考音频文件"), { target: { files: [new File(["audio"], "正太音.mp3", { type: "audio/mpeg" })] } });
    const recognize = screen.getByRole("button", { name: "识别所选片段文字" });
    act(() => { inspector.onGenerate?.(); fireEvent.click(recognize); });
    expect(bridge.generateClip).toHaveBeenCalledOnce(); expect(api.transcriptions).toHaveLength(0);
    expect(screen.getByTestId("current-project").textContent).toBe(JSON.stringify(project));
  });

  it("refuses import when generation starts in the same turn before React renders its busy controls", async () => {
    const project = projectFixture(); seed(project); const api = mockApi(); const bridge = mockBridge();
    vi.mocked(bridge.generateClip).mockImplementation(async (request, onUpdate) => {
      onUpdate({ type: "snapshot", job: { jobId: "test_generation_job", clipId: request.clipId,
        status: "generating", progress: 1, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" } });
      return { jobId: "test_generation_job" };
    });
    await mount(project);
    fireEvent.click(screen.getByRole("button", { name: "添加参考音频" }));
    fireEvent.change(screen.getByLabelText("参考音频文件"), { target: { files: [new File(["audio"], "正太音.mp3", { type: "audio/mpeg" })] } });
    const save = screen.getByRole("button", { name: "保存并选用参考音频" });
    act(() => { inspector.onGenerate?.(); fireEvent.click(save); });
    expect(bridge.generateClip).toHaveBeenCalledOnce(); expect(api.requests).toHaveLength(0);
    expect(screen.queryByText("正在添加参考音频…")).toBeNull();
    expect(screen.getByTestId("current-project").textContent).toBe(JSON.stringify(project));
  });

  it("selects and persists a new reference while preserving dialogue, adopted audio and the saved project", async () => {
    const project = projectFixture(); seed(project); const api = mockApi(); const bridge = mockBridge(); const view = await mount(project);
    const before = JSON.stringify(project); startImport();
    expect((screen.getByRole("button", { name: "生成当前音频" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "音频全部重新生成" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: "参考声音" }) as HTMLSelectElement).disabled).toBe(true);
    act(() => inspector.onGenerate?.()); expect(bridge.generateClip).not.toHaveBeenCalled();
    await act(async () => api.finish());
    await waitFor(() => expect((screen.getByRole("combobox", { name: "参考声音" }) as HTMLSelectElement).value).toBe(importedReference.id));
    expect((screen.getByRole("combobox", { name: "参考模式" }) as HTMLSelectElement).value).toBe("reference_only");
    expect(screen.getByLabelText("参考声音试听").getAttribute("src")).toBe(importedReference.audioUrl);
    expect(JSON.parse(window.localStorage.getItem("ai-asmr-studio:v1:voice-options")!)).toEqual({ ...originalOptions, voicePackId: importedReference.id, referenceMode: "reference_only" });
    expect(screen.getByTestId("current-project").textContent).toBe(before);
    expect(JSON.stringify(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project)).toBe(before);
    expect(bridge.generateClip).not.toHaveBeenCalled(); expect(bridge.generateProjectMix).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "生成当前音频" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "音频全部重新生成" }) as HTMLButtonElement).disabled).toBe(false);
    view.unmount(); await mount(project, importedReference.id);
    expect((screen.getByRole("combobox", { name: "参考声音" }) as HTMLSelectElement).value).toBe(importedReference.id);
    expect((screen.getByRole("combobox", { name: "参考模式" }) as HTMLSelectElement).value).toBe("reference_only");
    expect(bridge.generateClip).not.toHaveBeenCalled();
  });

  it("does not select cancelled late imports and allows refreshing the saved reference for explicit selection", async () => {
    const project = projectFixture(); seed(project); const api = mockApi(); const bridge = mockBridge(); await mount(project); startImport();
    fireEvent.click(screen.getByRole("button", { name: "取消等待" })); expect(api.requests[0].signal?.aborted).toBe(true);
    expect((screen.getByRole("button", { name: "音频全部重新生成" }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => api.finish());
    expect((screen.getByRole("combobox", { name: "参考声音" }) as HTMLSelectElement).value).toBe("soft_zh");
    fireEvent.click(screen.getByRole("button", { name: "刷新参考列表" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "正太音" })).toBeTruthy());
    expect((screen.getByRole("combobox", { name: "参考声音" }) as HTMLSelectElement).value).toBe("soft_zh");
    fireEvent.change(screen.getByRole("combobox", { name: "参考声音" }), { target: { value: importedReference.id } });
    expect((screen.getByRole("combobox", { name: "参考模式" }) as HTMLSelectElement).value).toBe("reference_only");
    expect(screen.getByTestId("current-project").textContent).toBe(JSON.stringify(project)); expect(bridge.generateClip).not.toHaveBeenCalled();
  });
});
