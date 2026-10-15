// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoProject } from "@/lib/asmr/mock-project";
import type { AsmrProject, VoiceClip } from "@/lib/asmr/schema";
import { ensureSpeechWorkspaces, switchSpeechWorkspace } from "@/lib/asmr/speech-workspace";
import { createClipVideoSourceFingerprint, type ClipVideoStoryboard } from "@/lib/asmr/video-plan";
import type { VoiceProviderCatalog } from "@/lib/asmr/voice-provider-catalog";
import { ClipStoryboardEditor } from "./clip-storyboard-editor";
import { VoiceGenerationPanel, type VoiceGenerationPanelProps } from "./voice-generation-panel";

const catalog: VoiceProviderCatalog = { providers: [{ id: "voxcpm2", label: "VoxCPM2", available: true,
  defaultReferenceId: "normal_zh", references: [{ id: "normal_zh", label: "普通参考", referenceModes: ["with_reference_text"] }],
  longText: { available: true, apiConfigured: false } }] };
function voices(project: AsmrProject): VoiceClip[] {
  return project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
}
function panelProps(): VoiceGenerationPanelProps {
  return { workspaceMode: "short", selectedClip: voices(demoProject)[0], catalog,
    options: { provider: "voxcpm2", voicePackId: "normal_zh", referenceMode: "with_reference_text", generationMode: "long_text" },
    onOptionsChange: vi.fn(), busy: false, candidates: [], onAdopt: vi.fn(), onDiscard: vi.fn(), onUndo: vi.fn(), canUndo: false, hasUndo: false };
}
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("dual workspace panels", () => {
  it("retains independent short generation and the existing long-generate/extract option in the short page", () => {
    const props = panelProps();
    render(<VoiceGenerationPanel {...props} />);
    const modes = screen.getByLabelText("生成方式") as HTMLSelectElement;
    expect(Array.from(modes.options, option => option.value)).toEqual(["clip", "long_text"]);
    expect(modes.value).toBe("long_text");
    fireEvent.change(modes, { target: { value: "clip" } });
    expect(props.onOptionsChange).toHaveBeenLastCalledWith({ ...props.options, generationMode: "clip" });
    fireEvent.change(modes, { target: { value: "long_text" } });
    expect(props.onOptionsChange).toHaveBeenLastCalledWith({ ...props.options, generationMode: "long_text", analysisProvider: "local" });
    expect(screen.queryByLabelText("整段生成文案")).toBeNull();
  });

  it("never renders a voice player or generation panel for a silent slot in either page", () => {
    const props = panelProps();
    const selectedClip: VoiceClip = { ...(props.selectedClip as VoiceClip), kind: "silent", text: "停留在窗外雨滴。" };
    const view = render(<VoiceGenerationPanel {...props} selectedClip={selectedClip} />);
    expect(view.container.querySelector("audio")).toBeNull();
    expect(screen.queryByLabelText("人声生成设置")).toBeNull();
    view.rerender(<VoiceGenerationPanel {...props} workspaceMode="paragraph" selectedClip={selectedClip} />);
    expect(view.container.querySelector("audio")).toBeNull();
    expect(screen.queryByLabelText("人声生成设置")).toBeNull();
  });

  it("rejects a late silent storyboard from the other bank even when its shared source fingerprint is identical", async () => {
    const original = structuredClone(demoProject), clip = voices(original)[0];
    clip.kind = "silent"; clip.text = "停留在窗外雨滴。"; clip.duration = 4;
    clip.asset = { asset_id: null, uri: null, duration: null };
    original.videoPlan = { version: 1, sceneDescription: "雨夜木屋。", shots: {} };
    const short = ensureSpeechWorkspaces(original), paragraph = switchSpeechWorkspace(short, "paragraph");
    const fingerprint = createClipVideoSourceFingerprint(short, clip.id);
    expect(createClipVideoSourceFingerprint(paragraph, clip.id)).toBe(fingerprint);
    const shot: ClipVideoStoryboard = { version: 1, promptFormat: "minimax-h3", clipId: clip.id, kind: "silent", duration: 4,
      sourceFingerprint: fingerprint, referenceMode: "new", title: "雨滴", visual: "Rain falls outside the window.", action: "S1 rests beside the window.", camera: "Static view.", ambientSound: "Soft steady rain outside." };
    let resolveFirst!: (response: Response) => void;
    const first = new Promise<Response>(resolve => { resolveFirst = resolve; });
    const signals: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === "/api/planner") return Response.json({ providers: [{ id: "api", label: "测试模型", configured: true, model: "mock" }], defaultProvider: "api" });
      expect(String(input)).toBe("/api/clip-storyboard"); signals.push(init?.signal);
      return signals.length === 1 ? first : Response.json({ storyboard: shot });
    }));
    const onSave = vi.fn().mockReturnValue(true);
    const renderEditor = (project: AsmrProject) => <ClipStoryboardEditor project={project} clipId={clip.id} onSave={onSave}
      onSceneChange={() => {}} onEdit={() => {}} />;
    const view = render(renderEditor(short));
    await screen.findByRole("option", { name: "测试模型" });
    fireEvent.click(screen.getByRole("button", { name: "生成分镜" }));
    await waitFor(() => expect(signals).toHaveLength(1));
    view.rerender(renderEditor(paragraph));
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => { resolveFirst(Response.json({ storyboard: shot })); });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "生成分镜" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith(paragraph.project_id, shot));
    expect(signals).toHaveLength(2);
  });
});
