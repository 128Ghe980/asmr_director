// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateClipRequest } from "@/lib/asmr/generation-bridge";
import { demoProject } from "@/lib/asmr/mock-project";
import { createInitialProjectLibrary, getCurrentLibraryEntry, PROJECT_LIBRARY_STORAGE_KEY, saveProjectLibrary, type ProjectLibrary } from "@/lib/asmr/project-library";
import { AsmrProjectSchema, type AsmrProject } from "@/lib/asmr/schema";
import { getVoiceGapAfter } from "@/lib/asmr/voice-segments";
import { StudioApp } from "./studio-app";

const options = { provider: "gpt-sovits", voicePackId: "default", referenceMode: "with_reference_text", generationMode: "clip" } as const;
const catalog = { providers: [{ id: "gpt-sovits", label: "GPT-SoVITS", available: true, defaultReferenceId: "default", references: [{ id: "default", label: "原有声音", referenceModes: ["with_reference_text"] }] }] };

function voices(project: AsmrProject) {
  return project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
}

function fixtureProject(): AsmrProject {
  const project = structuredClone(demoProject);
  project.duration = 20;
  project.emotion_curve = [{ start: 0, end: 20, emotion: "gentle" }];
  project.timeline.tracks = project.timeline.tracks.map((track) => track.track_type === "voice" ? {
    ...track,
    clips: track.clips.slice(0, 2).map((clip, index) => ({
      ...clip, start: index * 10, duration: index ? 6 : 8,
      text: index ? "保留原来的第二段。" : "第一句。第二句。第三句。",
      generation: { ...clip.generation, status: "asset_generated" },
      asset: { asset_id: `original_${index}`, uri: `asset://clip/original_${index}`, duration: index ? 6 : 8 },
    })),
  } : { ...track, clips: [] });
  project.exports = [{ type: "wav", status: "exported", uri: "asset://mix/original" }];
  return project;
}

function storedProject(): AsmrProject {
  const library = JSON.parse(window.localStorage.getItem(PROJECT_LIBRARY_STORAGE_KEY)!) as ProjectLibrary;
  return getCurrentLibraryEntry(library).project;
}

function seed(project = fixtureProject()) {
  saveProjectLibrary(window.localStorage, createInitialProjectLibrary(project));
  window.localStorage.setItem("ai-asmr-studio:v1:voice-options", JSON.stringify(options));
  return project;
}

function mockApi() {
  const posts: { request: GenerateClipRequest; signal: AbortSignal | null | undefined }[] = [];
  const responses: Array<(request: GenerateClipRequest) => Promise<Response> | Response> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === "/api/generation/clip") {
      if (init?.method !== "POST") return Response.json(catalog);
      const request = JSON.parse(String(init.body)) as GenerateClipRequest;
      posts.push({ request, signal: init.signal });
      const response = responses.shift();
      if (!response) throw new Error("Unexpected generation in test");
      return response(request);
    }
    if (url.startsWith("/api/audio-candidates?")) return Response.json({ candidates: [] });
    if (url.startsWith("/api/voice-generation-recordings?")) return Response.json({ recordings: [], truncated: false });
    if (url.startsWith("/api/assets/analysis")) return Response.json({ analysis: { bars: [10, 30, 20], duration: 20, sampleRate: 48000, channels: 1, peakDbfs: -12, rmsDbfs: -20, clippedSampleCount: 0 } });
    throw new Error(`Unexpected test request: ${url}`);
  }));
  return {
    posts,
    respond: (response: (request: GenerateClipRequest) => Promise<Response> | Response) => responses.push(response),
  };
}

function audioResponse(duration: number, assetId = "generated_selection") {
  return Response.json({ asset: { assetId, uri: `asset://clip/${assetId}`, duration } });
}

async function mount(project: AsmrProject) {
  const view = render(<StrictMode><StudioApp project={project} /></StrictMode>);
  await waitFor(() => {
    const reference = screen.getByRole("combobox", { name: "参考声音" }) as HTMLSelectElement;
    expect(reference.value).toBe("default");
    expect(reference.disabled).toBe(false);
  });
  return view;
}

function selectText(start: number, end: number) {
  const field = screen.getByRole("textbox", { name: "台词" }) as HTMLTextAreaElement;
  fireEvent.focus(field);
  field.setSelectionRange(start, end);
  fireEvent.select(field);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_ASMR_GENERATION_MODE", "local");
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("StudioApp user-selected script edits with simulated HTTP", () => {
  it("immediately generates only selected text, preserves other original clips and restores original audio with undo", async () => {
    const original = seed();
    const api = mockApi();
    api.respond((request) => {
      const selected = voices(request.project).find((clip) => clip.id === request.clipId)!;
      return audioResponse(selected.duration);
    });
    await mount(original);
    selectText(4, 8);
    fireEvent.click(screen.getByRole("button", { name: "生成选区音频" }));

    await waitFor(() => expect(api.posts).toHaveLength(1));
    const request = api.posts[0].request;
    const selected = voices(request.project).find((clip) => clip.id === request.clipId)!;
    expect(selected.text).toBe("第二句。");
    expect(selected.id).not.toBe(voices(original)[0].id);
    expect(voices(request.project).slice(0, 3).map((clip) => clip.text).join("")).toBe(voices(original)[0].text);
    await waitFor(() => expect(voices(storedProject())[1].asset.asset_id).toBe("generated_selection"));
    expect(voices(storedProject())[3]).toEqual(voices(original)[1]);
    expect(voices(storedProject())[0].asset.uri).toBeNull();
    expect(voices(storedProject())[2].asset.uri).toBeNull();
    expect(storedProject().exports).toEqual(original.exports);
    expect(AsmrProjectSchema.safeParse(storedProject()).success).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "撤回编辑" }));
    await waitFor(() => expect(storedProject()).toEqual(original));
    expect(voices(storedProject())[0].asset.uri).toBe("asset://clip/original_0");
  });

  it("persists an explicit pause through shorter generation and a full remount", async () => {
    const original = seed();
    const api = mockApi();
    api.respond(() => audioResponse(2, "short_take"));
    const view = await mount(original);
    const gap = screen.getByRole("spinbutton", { name: "第 1 段后等待秒数" });
    fireEvent.change(gap, { target: { value: "1.5" } });
    fireEvent.blur(gap);
    await waitFor(() => expect(voices(storedProject())[0].pause_after).toBe(1.5));
    fireEvent.click(screen.getByRole("button", { name: "重生成" }));
    await waitFor(() => expect(voices(storedProject())[0].asset.asset_id).toBe("short_take"));
    expect(voices(storedProject())[0].duration).toBe(2);
    expect(voices(storedProject())[1].start).toBe(3.5);
    expect(getVoiceGapAfter(storedProject(), voices(original)[0].id)).toBe(1.5);
    expect(voices(storedProject())[1].asset).toEqual(voices(original)[1].asset);
    expect(AsmrProjectSchema.safeParse(storedProject()).success).toBe(true);
    view.unmount();

    await mount(original);
    expect((screen.getByRole("spinbutton", { name: "第 1 段后等待秒数" }) as HTMLInputElement).value).toBe("1.5");
    expect(voices(storedProject())[0].asset.asset_id).toBe("short_take");
    expect(getVoiceGapAfter(storedProject(), voices(original)[0].id)).toBe(1.5);
    expect(api.posts).toHaveLength(1);
  });

  it("supports inserting, editing, merging, deleting every paragraph and rebuilding an empty voice track", async () => {
    const original = seed();
    mockApi();
    await mount(original);
    fireEvent.click(screen.getByRole("button", { name: "下方插入" }));
    await waitFor(() => expect(voices(storedProject())).toHaveLength(3));
    fireEvent.change(screen.getByRole("textbox", { name: "台词" }), { target: { value: "插入的新台词。" } });
    await waitFor(() => expect(voices(storedProject())[1].text).toBe("插入的新台词。"));
    expect(voices(storedProject())[0].asset).toEqual(voices(original)[0].asset);
    expect(voices(storedProject())[2].asset).toEqual(voices(original)[1].asset);
    fireEvent.click(screen.getByRole("button", { name: "合并下一段" }));
    await waitFor(() => expect(voices(storedProject())).toHaveLength(2));
    expect(voices(storedProject())[1].text).toBe("插入的新台词。" + voices(original)[1].text);
    expect(voices(storedProject())[1].asset.uri).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "选择第 1 段" }));
    fireEvent.click(screen.getByRole("button", { name: "删除本段" }));
    await waitFor(() => expect(voices(storedProject())).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "删除本段" }));
    await waitFor(() => expect(voices(storedProject())).toHaveLength(0));
    expect(AsmrProjectSchema.safeParse(storedProject()).success).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "新增一段" }));
    await waitFor(() => expect(voices(storedProject())).toHaveLength(1));
    fireEvent.change(screen.getByRole("textbox", { name: "台词" }), { target: { value: "从这里重新开始。" } });
    await waitFor(() => expect(voices(storedProject())[0].text).toBe("从这里重新开始。"));
    expect(AsmrProjectSchema.safeParse(storedProject()).success).toBe(true);
  });

  it("cancels an active original take on text edits and refuses a late original response", async () => {
    const original = seed();
    const api = mockApi();
    let resolve!: (response: Response) => void;
    const delayed = new Promise<Response>((done) => { resolve = done; });
    api.respond(() => delayed);
    await mount(original);
    fireEvent.click(screen.getByRole("button", { name: "重生成" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    fireEvent.change(screen.getByRole("textbox", { name: "台词" }), { target: { value: "生成中重新修改的台词。" } });
    await waitFor(() => expect(api.posts[0].signal?.aborted).toBe(true));
    await act(async () => { resolve(audioResponse(18, "late_original")); await delayed; });
    await waitFor(() => expect(voices(storedProject())[0].text).toBe("生成中重新修改的台词。"));
    expect(voices(storedProject())[0].asset.uri).toBeNull();
    expect(voices(storedProject())[1]).toEqual(voices(original)[1]);
    expect(AsmrProjectSchema.safeParse(storedProject()).success).toBe(true);
  });

  it("retains both concurrent non-Planner generations after the earlier voice shifts the later one", async () => {
    const original = seed();
    const api = mockApi();
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const first = new Promise<Response>((done) => { resolveFirst = done; });
    const second = new Promise<Response>((done) => { resolveSecond = done; });
    api.respond(() => first);
    api.respond(() => second);
    await mount(original);
    fireEvent.click(screen.getByRole("button", { name: "重生成" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "选择第 2 段" }));
    fireEvent.click(screen.getByRole("button", { name: "重生成" }));
    await waitFor(() => expect(api.posts).toHaveLength(2));

    await act(async () => { resolveFirst(audioResponse(12, "first_long")); await first; });
    await waitFor(() => expect(voices(storedProject())[0].asset.asset_id).toBe("first_long"));
    expect(voices(storedProject())[1].start).toBe(14);
    expect(api.posts[1].signal?.aborted).toBe(false);
    await act(async () => { resolveSecond(audioResponse(7, "second_late")); await second; });
    await waitFor(() => expect(voices(storedProject())[1].asset.asset_id).toBe("second_late"));
    expect(voices(storedProject())[0].asset.asset_id).toBe("first_long");
    expect(voices(storedProject())[1].duration).toBe(7);
    expect(AsmrProjectSchema.safeParse(storedProject()).success).toBe(true);
  });
});
