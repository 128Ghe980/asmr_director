// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoProject } from "@/lib/asmr/mock-project";
import type { AsmrProject, TimelineClip } from "@/lib/asmr/schema";
import { flattenClips } from "@/lib/asmr/view-model";
import { ScriptRewrite } from "./script-rewrite";

type Props = Parameters<typeof ScriptRewrite>[0];

function fixture(): Props {
  const project = structuredClone(demoProject);
  const first = flattenClips(project).find((clip) => clip.type === "voice")!;
  if (first.type !== "voice") throw new Error("Missing fixture voice");
  first.text = "  外面有点冷。\n来这里坐一会儿。慢慢挑。  ";
  return {
    project,
    range: { clipId: first.id, text: first.text, start: 9, end: 16 },
    onApply: vi.fn(),
    onClose: vi.fn(),
  };
}

function changeTarget(project: AsmrProject, id: string, map: (clip: TimelineClip) => TimelineClip | undefined): AsmrProject {
  const next = structuredClone(project);
  for (const track of next.timeline.tracks) {
    const index = track.clips.findIndex((clip) => clip.id === id);
    if (index < 0) continue;
    const updated = map(track.clips[index]);
    if (updated) Object.assign(track.clips[index], updated);
    else track.clips.splice(index, 1);
  }
  return next;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mockApi() {
  const responses: Promise<Response>[] = [];
  const posts: { body: Record<string, unknown>; signal: AbortSignal | null | undefined }[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === "POST") {
      posts.push({ body: JSON.parse(String(init.body)), signal: init.signal });
      const reply = responses.shift();
      if (!reply) throw new Error("No queued reply");
      // Resolve even after abort to test the component's own stale guards.
      return reply;
    }
    return Response.json({ providers: [
      { id: "ollama", label: "本地 Ollama", configured: true },
      { id: "api", label: "外部 API", configured: true },
    ], defaultProvider: "api" });
  }));
  return { posts, respond: (response: Response | Promise<Response>) => responses.push(Promise.resolve(response)) };
}

async function mount(input: Props) {
  const view = render(<StrictMode><ScriptRewrite {...input} /></StrictMode>);
  await waitFor(() => expect((screen.getByRole("combobox", { name: "工程改写模型" }) as HTMLSelectElement).value).toBe("api"));
  return { ...view, rerenderProps: (next: Props) => view.rerender(<StrictMode><ScriptRewrite {...next} /></StrictMode>) };
}

function startRewrite() {
  fireEvent.change(screen.getByLabelText("工程选区改写要求"), { target: { value: "说得更自然一些" } });
  fireEvent.click(screen.getByRole("button", { name: "只改写选定文字" }));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("engineering script range rewrite", () => {
  it("sends the user's precise offsets and nearby context, applying only replacement text", async () => {
    const input = fixture();
    const api = mockApi();
    api.respond(Response.json({ replacement: "这边坐吧。", section: { text: "不应采用模型返回的整段", position: { pan: 1 } } }));
    await mount(input);
    startRewrite();
    const expected = input.range.text.slice(0, input.range.start) + "这边坐吧。" + input.range.text.slice(input.range.end);
    await waitFor(() => expect(input.onApply).toHaveBeenCalledExactlyOnceWith(input.range.clipId, input.range.text, expected));
    expect(input.onClose).toHaveBeenCalledOnce();
    expect(api.posts[0].body).toMatchObject({ action: "rewrite", provider: "api", instruction: "说得更自然一些", range: { start: 9, end: 16 } });
    const body = api.posts[0].body as { draft: { sections: { id: string; text: string }[] }; sectionId: string };
    expect(body.draft.sections.find((section) => section.id === body.sectionId)?.text).toBe(input.range.text);
    expect(body.draft.sections.length).toBeLessThanOrEqual(3);
    expect(expected.startsWith("  ")).toBe(true);
    expect(expected.endsWith("  ")).toBe(true);
  });

  it.each(["text", "delete", "project"] as const)("aborts a pending rewrite after a %s change and ignores its late reply", async (change) => {
    const input = fixture();
    const api = mockApi();
    const late = deferred<Response>();
    api.respond(late.promise);
    const view = await mount(input);
    startRewrite();
    await screen.findByRole("button", { name: "取消改写" });
    const project = change === "project" ? { ...input.project, project_id: "another_project" }
      : changeTarget(input.project, input.range.clipId, (clip) => change === "delete" ? undefined : { ...clip, text: "用户刚修改的新内容" });
    view.rerenderProps({ ...input, project });
    expect(api.posts[0].signal?.aborted).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("已取消");
    await act(async () => { late.resolve(Response.json({ replacement: "迟到文本" })); await late.promise; });
    expect(input.onApply).not.toHaveBeenCalled();
    expect(input.onClose).not.toHaveBeenCalled();
  });

  it("invalidates an old request when a new selection uses the same original text", async () => {
    const input = fixture();
    const api = mockApi();
    const late = deferred<Response>();
    api.respond(late.promise);
    const view = await mount(input);
    startRewrite();
    view.rerenderProps({ ...input, range: { ...input.range, start: 2, end: 8 } });
    expect(api.posts[0].signal?.aborted).toBe(true);
    await act(async () => { late.resolve(Response.json({ replacement: "旧选区回复" })); await late.promise; });
    expect(input.onApply).not.toHaveBeenCalled();
  });

  it("cancels immediately and ignores a reply even if the host has not unmounted the panel", async () => {
    const input = fixture();
    const api = mockApi();
    const late = deferred<Response>();
    api.respond(late.promise);
    await mount(input);
    startRewrite();
    fireEvent.click(screen.getByRole("button", { name: "取消改写" }));
    expect(api.posts[0].signal?.aborted).toBe(true);
    expect(input.onClose).toHaveBeenCalledOnce();
    await act(async () => { late.resolve(Response.json({ replacement: "已取消的改写" })); await late.promise; });
    expect(input.onApply).not.toHaveBeenCalled();
    expect(input.onClose).toHaveBeenCalledOnce();
  });

  it("rejects invalid offsets before making a model request", async () => {
    const input = fixture();
    input.range.end = input.range.text.length + 1;
    const api = mockApi();
    await mount(input);
    startRewrite();
    expect(screen.getByRole("alert").textContent).toContain("范围已失效");
    expect(api.posts).toHaveLength(0);
    expect(input.onApply).not.toHaveBeenCalled();
  });

  it("maps a small selection inside a long paragraph to bounded context and preserves the complete original", async () => {
    const input = fixture();
    const original = "前面的句子。".repeat(800) + "需要改的这一句。" + "后面的句子。".repeat(800);
    const start = original.indexOf("需要改");
    input.project = changeTarget(input.project, input.range.clipId, (clip) => ({ ...clip, text: original }));
    input.range = { ...input.range, text: original, start, end: start + "需要改的这一句。".length };
    const api = mockApi();
    api.respond(Response.json({ replacement: "换成日常说法。" }));
    await mount(input);
    startRewrite();
    await waitFor(() => expect(input.onApply).toHaveBeenCalledOnce());
    const body = api.posts[0].body as { draft: { sections: { id: string; text: string }[] }; sectionId: string; range: { start: number; end: number } };
    const section = body.draft.sections.find((item) => item.id === body.sectionId)!;
    expect(section.text).toBe("需要改的这一句。");
    expect(body.range).toEqual({ start: 0, end: "需要改的这一句。".length });
    expect(body.draft.sections.every((item) => item.text.length <= 3000)).toBe(true);
    expect(body.draft.sections.map((item) => item.text.length).reduce((a, b) => a + b)).toBeLessThanOrEqual(6000);
    expect(input.onApply).toHaveBeenCalledExactlyOnceWith(input.range.clipId, original, original.slice(0, start) + "换成日常说法。" + original.slice(input.range.end));
  });

  it("does not require shortening an unrelated long neighbor before rewriting a small target", async () => {
    const input = fixture();
    const neighbor = flattenClips(input.project).find((clip) => clip.type === "voice" && clip.id !== input.range.clipId)!;
    input.project = changeTarget(input.project, neighbor.id, (clip) => ({ ...clip, text: "这是很长的另一段。".repeat(800) }));
    const api = mockApi();
    api.respond(Response.json({ replacement: "这里坐。" }));
    await mount(input);
    startRewrite();
    await waitFor(() => expect(input.onApply).toHaveBeenCalledOnce());
    const body = api.posts[0].body as { draft: { sections: { id: string; text: string }[] }; sectionId: string };
    expect(body.draft.sections.find((item) => item.id === body.sectionId)?.text).toBe(input.range.text);
    expect(body.draft.sections.every((item) => item.text.length <= 3000)).toBe(true);
  });

  it("explains the selected-range limit without sending oversized model input", async () => {
    const input = fixture();
    const original = "整段文案。".repeat(800);
    input.project = changeTarget(input.project, input.range.clipId, (clip) => ({ ...clip, text: original }));
    input.range = { ...input.range, text: original, start: 0, end: original.length };
    const api = mockApi();
    await mount(input);
    startRewrite();
    expect(screen.getByRole("alert").textContent).toContain("单次最多改写 3000 字");
    expect(api.posts).toHaveLength(0);
    expect(input.onApply).not.toHaveBeenCalled();
  });

  it("shows service failure without applying or closing the selected text", async () => {
    const input = fixture();
    const api = mockApi();
    api.respond(Response.json({ error: "模型暂时不可用" }, { status: 503 }));
    await mount(input);
    startRewrite();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("模型暂时不可用"));
    expect(input.onApply).not.toHaveBeenCalled();
    expect(input.onClose).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "只改写选定文字" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("refuses a whole-section response without explicit replacement text", async () => {
    const input = fixture();
    const api = mockApi();
    api.respond(Response.json({ section: { text: "整段替换内容" } }));
    await mount(input);
    startRewrite();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("模型没有返回有效的选区文案，请重试。"));
    expect(input.onApply).not.toHaveBeenCalled();
    expect(input.onClose).not.toHaveBeenCalled();
  });
});
