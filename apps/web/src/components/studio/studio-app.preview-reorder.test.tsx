// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoProject } from "@/lib/asmr/mock-project";
import { createInitialProjectLibrary, getCurrentLibraryEntry, loadProjectLibrary, saveProjectLibrary } from "@/lib/asmr/project-library";
import type { AsmrProject } from "@/lib/asmr/schema";
import { flattenClips } from "@/lib/asmr/view-model";
import { StudioApp } from "./studio-app";

const bridgeFactory = vi.hoisted(() => vi.fn());
vi.mock("@/lib/asmr/local-generation-bridge", () => ({ createLocalGenerationBridge: bridgeFactory }));
vi.mock("./project-workspace", () => ({ ProjectWorkspace: ({ children, project }: { children: ReactNode; project: AsmrProject }) =>
  <div><output data-testid="project">{JSON.stringify(project)}</output>{children}</div> }));
vi.mock("./planner-panel", () => ({ PlannerPanel: () => null }));
vi.mock("./clip-inspector", () => ({ ClipInspector: () => null }));
vi.mock("./timeline-panel", () => ({ TimelinePanel: () => null }));
vi.mock("./validation-panel", () => ({ ValidationPanel: () => null }));
vi.mock("./editor-panels", () => ({ EditorPanels: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("./script-editor-panel", () => ({ ScriptEditorPanel: ({ project, selectedClipId, onMoveClip, onUndo, canUndo, batchActions }: {
  project: AsmrProject; selectedClipId?: string; onMoveClip: (id: string, direction: "up" | "down") => void;
  onUndo: () => void; canUndo: boolean; batchActions: ReactNode;
}) => <div>{batchActions}<output data-testid="selected">{selectedClipId}</output>
  {flattenClips(project).filter(clip => clip.type === "voice").map((clip, index) =>
    <button key={clip.id} onClick={() => onMoveClip(clip.id, "up")}>上移测试第{index + 1}段</button>)}
  <button disabled={!canUndo} onClick={onUndo}>撤回编辑</button></div> }));

function fixture() {
  const project = structuredClone(demoProject);
  project.project_id = "preview_move_fixture";
  project.timeline.tracks = project.timeline.tracks.map(track => track.track_type === "voice" ? { ...track,
    clips: track.clips.slice(0, 3).map((clip, index) => ({ ...clip, start: index * 4, duration: 3, pause_after: 1,
      asset: { asset_id: `adopted_${index}`, uri: `asset://clip/adopted_${index}`, duration: 3 },
      generation: { ...clip.generation, status: "asset_generated" as const } })) }
    : { ...track, clips: [] });
  saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
  return project;
}
function current(): AsmrProject { return JSON.parse(screen.getByTestId("project").textContent!); }
beforeEach(() => {
  window.localStorage.clear(); bridgeFactory.mockReset(); vi.stubEnv("NEXT_PUBLIC_ASMR_GENERATION_MODE", "local");
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url === "/api/generation/clip") return Response.json({ providers: [{ id: "gpt-sovits", label: "test", available: true,
      defaultReferenceId: "default", references: [{ id: "default", label: "test", referenceModes: ["with_reference_text"] }] }] });
    if (url.startsWith("/api/audio-candidates?")) return Response.json({ candidates: [] });
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [10], duration: 3, sampleRate: 48000,
      channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    throw new Error(`Unexpected request: ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("StudioApp adopted voice preview and ordering", () => {
  it("exposes partial-preview actions, preserves adoption and selection when moving another row, persists it and undoes exactly", async () => {
    const project = fixture(); const original = flattenClips(project);
    render(<StrictMode><StudioApp project={project} /></StrictMode>);
    await waitFor(() => expect((screen.getByRole("button", { name: "整体预览" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("selected").textContent).toBe(original[0].id);
    fireEvent.click(screen.getByRole("button", { name: "上移测试第2段" }));
    const moved = flattenClips(current());
    expect(moved.map(clip => clip.id)).toEqual([original[1].id, original[0].id, original[2].id]);
    expect(screen.getByTestId("selected").textContent).toBe(original[0].id);
    for (const clip of moved) {
      const previous = original.find(item => item.id === clip.id)!;
      expect(clip.asset).toEqual(previous.asset); expect(clip.generation).toEqual(previous.generation);
    }
    await waitFor(() => expect(flattenClips(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).map(clip => clip.id))
      .toEqual(moved.map(clip => clip.id)));
    fireEvent.click(screen.getByRole("button", { name: "撤回编辑" }));
    expect(current()).toEqual(project);
    expect(screen.getByTestId("selected").textContent).toBe(original[0].id);
    await waitFor(() => expect(getCurrentLibraryEntry(loadProjectLibrary(window.localStorage, project)).project).toEqual(project));
    expect(bridgeFactory).not.toHaveBeenCalled();
  });
});
