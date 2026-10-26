// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlannerBriefSchema, type PlannerDraft } from "@/lib/asmr/planner";
import {
  PLANNER_DRAFT_STORAGE_KEY,
  createEmptyPlannerWorkingState,
  loadPlannerDraft,
  savePlannerDraft,
  type PlannerWorkingState,
} from "@/lib/asmr/planner-persistence";

import { PlannerPanel } from "./planner-panel";

const brief = PlannerBriefSchema.parse({ theme: "深夜书店", durationSeconds: 300 });

function makeDraft(title = "书店的最后一盏灯"): PlannerDraft {
  return {
    title,
    scene: "关门前的安静书店",
    character: { role: "熟悉的店员", personality: ["随和"], speechStyle: ["轻声自然"] },
    sections: ["欢迎进来", "翻几页书", "安静收尾"].map((sectionTitle, index) => ({
      id: `section_${index + 1}`,
      title: sectionTitle,
      text: ["外面有点凉，来这里坐一会儿。", "这一页的字很有趣，我翻给你看看。", "不用着急，我们再安静地坐一会儿。"][index],
      emotion: "平静", style: "轻声", pace: "缓慢",
      direction: "停下来，轻轻翻页。", soundSuggestions: "柔和的书页声",
      pauseAfter: "medium",
      position: { pan: 0, distance: "near", movement: "static" },
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mockPlannerApi() {
  const responses: Promise<Response>[] = [];
  const posts: { body: Record<string, unknown>; signal: AbortSignal | null | undefined }[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    expect(String(input)).toBe("/api/planner");
    if (init?.method === "POST") {
      posts.push({ body: JSON.parse(String(init.body)), signal: init.signal });
      const response = responses.shift();
      if (!response) throw new Error("Unexpected planner request in component test");
      // Deliberately allow responses after abort to exercise stale-result guards.
      return await response;
    }
    return Response.json({
      providers: [
        { id: "ollama", label: "本地 Ollama", model: "fixture-local", configured: true },
        { id: "api", label: "外部 API", model: "fixture-api", configured: true },
      ],
      defaultProvider: "ollama",
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    posts,
    respond: (response: Response | Promise<Response>) => { responses.push(Promise.resolve(response)); },
  };
}

function control(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}

function seedWorkingState(patch: Partial<PlannerWorkingState> = {}) {
  const state: PlannerWorkingState = {
    ...createEmptyPlannerWorkingState(), brief, draftBrief: brief, draft: makeDraft(), ...patch,
  };
  expect(savePlannerDraft(window.localStorage, state)).toEqual({ success: true });
  return state;
}

async function mountPanel(onAdopt = vi.fn(), source?: Parameters<typeof PlannerPanel>[0]["source"]) {
  const view = render(<StrictMode><PlannerPanel source={source} onAdopt={onAdopt} /></StrictMode>);
  await waitFor(() => {
    expect(control("今日主题").disabled).toBe(false);
    expect(screen.getByText(/fixture-/)).toBeTruthy();
  });
  return { ...view, onAdopt };
}

async function requestRewrite(api: ReturnType<typeof mockPlannerApi>, response: Response, instruction = "更日常一点") {
  api.respond(response);
  fireEvent.focus(control("第 2 段台词"));
    fireEvent.click(screen.getByRole("button", { name: "AI 改写第 2 段" }));
  fireEvent.change(control("第 2 段改写要求"), { target: { value: instruction } });
  fireEvent.click(screen.getByRole("button", { name: "改写这一段" }));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PlannerPanel interaction with simulated provider responses", () => {
  it("keeps the script readable and exposes editing tools only for the selected sentence", async () => {
    const state = seedWorkingState();
    mockPlannerApi();
    await mountPanel();
    expect(screen.queryByRole("button", { name: /AI 改写第/ })).toBeNull();
    expect(screen.queryByText(/导演与声音/)).toBeNull();
    fireEvent.focus(control("第 2 段台词"));
    expect(screen.getAllByRole("button", { name: /AI 改写第/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "AI 改写第 2 段" })).toBeTruthy();
    fireEvent.focus(control("第 3 段台词"));
    expect(screen.queryByRole("button", { name: "AI 改写第 2 段" })).toBeNull();
    expect(screen.getByRole("button", { name: "AI 改写第 3 段" })).toBeTruthy();
    expect(control("第 2 段台词").value).toBe(state.draft!.sections[1].text);
  });

  it("preserves a restored legacy script until explicit semantic conversion and can undo it", async () => {
    const legacy = makeDraft();
    legacy.sections[0].text = "别着急，我把灯挪过来。这里坐着舒服些，你慢慢挑。".repeat(8);
    seedWorkingState({ draft: legacy });
    mockPlannerApi();
    const { onAdopt } = await mountPanel();
    expect(control("第 1 段台词").value).toBe(legacy.sections[0].text);
    expect(screen.queryByLabelText("第 4 段台词")).toBeNull();
    fireEvent.click(screen.getByText("文案操作"));
    fireEvent.click(screen.getByRole("button", { name: "按语义整理短句" }));
    expect(screen.getByLabelText("第 4 段台词")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    const converted = onAdopt.mock.calls[0][1] as PlannerDraft;
    expect(converted.segmentation).toBe("semantic");
    expect(converted.sections.map((section) => section.text).join("")).toBe(legacy.sections.map((section) => section.text).join(""));
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.draft?.segmentation).toBe("semantic"));
    fireEvent.click(screen.getByRole("button", { name: "撤回修改" }));
    expect(control("第 1 段台词").value).toBe(legacy.sections[0].text);
    expect(screen.queryByLabelText("第 4 段台词")).toBeNull();
  });
  it("rewrites exactly a selected phrase and leaves all other text and metadata untouched", async () => {
    const state = seedWorkingState();
    const api = mockPlannerApi();
    const { onAdopt } = await mountPanel();
    const textarea = control("第 2 段台词") as HTMLTextAreaElement;
    act(() => textarea.focus());
    textarea.setSelectionRange(0, 8);
    fireEvent.select(textarea);
    api.respond(Response.json({ section: { ...state.draft!.sections[1], text: "不应整段替换", direction: "不应修改" }, replacement: "这本书不错，" }));
    fireEvent.focus(control("第 2 段台词"));
    fireEvent.click(screen.getByRole("button", { name: "AI 改写第 2 段" }));
    fireEvent.change(control("第 2 段改写要求"), { target: { value: "更口语" } });
    fireEvent.click(screen.getByRole("button", { name: "改写选中文字" }));
    const expected = "这本书不错，" + state.draft!.sections[1].text.slice(8);
    await waitFor(() => expect(textarea.value).toBe(expected));
    expect(api.posts[0].body).toMatchObject({ range: { start: 0, end: 8 }, sectionId: "section_2" });
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt).toHaveBeenCalledExactlyOnceWith(brief, { ...state.draft, sections: state.draft!.sections.map((section, index) => index === 1 ? { ...section, text: expected } : section) });
  });

  it.each(["generate", "rewrite"] as const)("allows manual edits during %s and discards the canceled late result", async (action) => {
    const state = seedWorkingState();
    const api = mockPlannerApi();
    const late = deferred<Response>();
    api.respond(late.promise);
    await mountPanel();
    if (action === "generate") fireEvent.click(screen.getByRole("button", { name: "重新生成策划稿" }));
    else {
      fireEvent.focus(control("第 2 段台词"));
    fireEvent.click(screen.getByRole("button", { name: "AI 改写第 2 段" }));
      fireEvent.change(control("第 2 段改写要求"), { target: { value: "更口语" } });
      fireEvent.click(screen.getByRole("button", { name: "改写这一段" }));
    }
    await screen.findByRole("button", { name: "取消" });
    fireEvent.change(control("第 2 段台词"), { target: { value: "我在生成中手动修改的句子。" } });
    expect(api.posts[0].signal?.aborted).toBe(true);
    expect(screen.getByText("已停止 AI 生成。")).toBeTruthy();
    await act(async () => {
      late.resolve(Response.json(action === "generate" ? { draft: makeDraft("迟到稿") } : { section: { ...state.draft!.sections[1], text: "迟到改写" } }));
      await late.promise;
    });
    expect(control("第 2 段台词").value).toBe("我在生成中手动修改的句子。");
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.draft?.sections[1].text).toBe("我在生成中手动修改的句子。"));
  });

  it("splits a selection, merges, inserts and deletes sections with undo and persistence", async () => {
    const state = seedWorkingState();
    mockPlannerApi();
    await mountPanel();
    const textarea = control("第 1 段台词") as HTMLTextAreaElement;
    act(() => textarea.focus());
    textarea.setSelectionRange(2, 5);
    fireEvent.select(textarea);
    fireEvent.click(screen.getByRole("button", { name: "拆分第 1 段" }));
    expect(control("第 2 段台词").value).toBe(state.draft!.sections[0].text.slice(2, 5));
    expect(control("第 5 段台词").value).toBe(state.draft!.sections[2].text);
    fireEvent.focus(control("第 1 段台词"));
    fireEvent.click(screen.getByRole("button", { name: "合并第 1 段与下一段" }));
    expect(control("第 1 段台词").value).toBe(state.draft!.sections[0].text.slice(0, 5));
    fireEvent.click(screen.getByRole("button", { name: "在第 1 段后新增" }));
    expect(control("第 2 段台词").value).toBe("");
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.draft?.sections[1].text).toBe(""));
    fireEvent.focus(control("第 2 段台词"));
    fireEvent.click(screen.getByRole("button", { name: "删除第 2 段" }));
    expect(control("第 2 段台词").value).toBe(state.draft!.sections[0].text.slice(5));
    fireEvent.click(screen.getByRole("button", { name: "撤回修改" }));
    expect(control("第 2 段台词").value).toBe("");
  });
  it("generates a draft and rewrites only the selected section before adoption", async () => {
    const api = mockPlannerApi();
    const draft = makeDraft();
    api.respond(Response.json({ draft }));
    const { onAdopt } = await mountPanel();
    fireEvent.change(control("今日主题"), { target: { value: brief.theme } });
    fireEvent.click(screen.getByRole("button", { name: "生成策划稿" }));
    await waitFor(() => expect(control("第 1 段台词").value).toBe(draft.sections[0].text));

    const rewritten = { ...draft.sections[1], text: "你想先看哪一本？这本我刚翻过，还挺有意思。" };
    await requestRewrite(api, Response.json({ section: rewritten }));
    await waitFor(() => expect(control("第 2 段台词").value).toBe(rewritten.text));
    expect(control("第 1 段台词").value).toBe(draft.sections[0].text);
    expect(control("第 3 段台词").value).toBe(draft.sections[2].text);
    expect(api.posts[0].body).toEqual({ action: "generate", provider: "ollama", brief });
    expect(api.posts[1].body).toMatchObject({ action: "rewrite", sectionId: "section_2", draft, brief });

    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt).toHaveBeenCalledExactlyOnceWith(brief, {
      ...draft, sections: [draft.sections[0], rewritten, draft.sections[2]],
    });
  });

  it("cancels a request and ignores its late response after a newer request succeeds", async () => {
    const original = seedWorkingState();
    const api = mockPlannerApi();
    const late = deferred<Response>();
    api.respond(late.promise);
    const { onAdopt } = await mountPanel();
    fireEvent.click(screen.getByRole("button", { name: "重新生成策划稿" }));
    await screen.findByRole("button", { name: "取消" });
    expect(control("第 1 段台词").disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(api.posts[0].signal?.aborted).toBe(true);
    expect(control("文案标题").value).toBe(original.draft?.title);

    const newest = makeDraft("新请求的策划稿");
    api.respond(Response.json({ draft: newest }));
    fireEvent.click(screen.getByRole("button", { name: "重新生成策划稿" }));
    await waitFor(() => expect(control("文案标题").value).toBe(newest.title));
    await act(async () => {
      late.resolve(Response.json({ draft: makeDraft("已取消的过期策划稿") }));
      await late.promise;
    });
    expect(control("文案标题").value).toBe(newest.title);
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt).toHaveBeenCalledExactlyOnceWith(brief, newest);
  });

  it.each(["generate", "rewrite"] as const)("keeps the old draft usable when %s fails", async (action) => {
    const state = seedWorkingState();
    const api = mockPlannerApi();
    const { onAdopt } = await mountPanel();
    const failedResponse = Response.json({ error: "测试服务暂时不可用，请重试。" }, { status: 503 });
    if (action === "rewrite") {
      await requestRewrite(api, failedResponse);
    } else {
      api.respond(failedResponse);
      fireEvent.click(screen.getByRole("button", { name: "重新生成策划稿" }));
    }
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("测试服务暂时不可用"));
    expect(control("第 2 段台词").value).toBe(state.draft?.sections[1].text);
    expect(control("第 2 段台词").disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt).toHaveBeenCalledExactlyOnceWith(brief, state.draft);
  });

  it("adopts manual script edits with the original draft brief after the theme form changes", async () => {
    const state = seedWorkingState();
    mockPlannerApi();
    const { onAdopt } = await mountPanel();
    fireEvent.change(control("第 2 段台词"), { target: { value: "这句是我亲自改过的台词。" } });
    fireEvent.click(screen.getByText(/导演与声音/));
    fireEvent.change(control("第 2 段导演提示"), { target: { value: "此处留白，再翻一页。" } });
    fireEvent.change(control("今日主题"), { target: { value: "雨夜便利店" } });
    fireEvent.change(control("目标时长"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));

    expect(onAdopt).toHaveBeenCalledExactlyOnceWith(brief, {
      ...state.draft,
      sections: state.draft!.sections.map((section, index) => index === 1
        ? { ...section, text: "这句是我亲自改过的台词。", direction: "此处留白，再翻一页。" }
        : section),
    });
  });

  it("undoes a successful AI rewrite to the edited draft that preceded it", async () => {
    const state = seedWorkingState();
    const api = mockPlannerApi();
    const { onAdopt } = await mountPanel();
    fireEvent.change(control("第 1 段台词"), { target: { value: "先保留我改过的开场。" } });
    const rewritten = { ...state.draft!.sections[1], text: "AI 新改的第二段。" };
    await requestRewrite(api, Response.json({ section: rewritten }));
    await waitFor(() => expect(control("第 2 段台词").value).toBe(rewritten.text));
    fireEvent.click(screen.getByRole("button", { name: "撤回修改" }));
    expect(control("第 1 段台词").value).toBe("先保留我改过的开场。");
    expect(control("第 2 段台词").value).toBe(state.draft!.sections[1].text);
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt.mock.calls[0][1].sections[0].text).toBe("先保留我改过的开场。");
    expect(onAdopt.mock.calls[0][1].sections[1]).toEqual(state.draft!.sections[1]);
  });

  it("restores the selected provider and persists manual edits independently of the draft brief", async () => {
    seedWorkingState({ provider: "api", brief: { ...brief, theme: "下一期的新主题" } });
    mockPlannerApi();
    const first = await mountPanel();
    expect(control("文案模型").value).toBe("api");
    expect(control("今日主题").value).toBe("下一期的新主题");
    fireEvent.change(control("第 3 段台词"), { target: { value: "保存后再回来的收尾。" } });
    await waitFor(() => {
      expect(loadPlannerDraft(window.localStorage).state.draft?.sections[2].text).toBe("保存后再回来的收尾。");
    });
    const saved = JSON.parse(window.localStorage.getItem(PLANNER_DRAFT_STORAGE_KEY)!);
    expect(saved.draftBrief).toEqual(brief);
    first.unmount();

    const second = await mountPanel();
    expect(control("第 3 段台词").value).toBe("保存后再回来的收尾。");
    expect(control("文案模型").value).toBe("api");
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(second.onAdopt.mock.calls[0][0]).toEqual(brief);
  });

  it("loads a project source without losing the working draft and can undo the load", async () => {
    const state = seedWorkingState();
    mockPlannerApi();
    const source = { brief: { ...brief, theme: "雨夜车站" }, draft: makeDraft("来自当前工程的策划") };
    const { onAdopt } = await mountPanel(vi.fn(), source);
    fireEvent.click(screen.getByText("项目原稿"));
    fireEvent.click(screen.getByRole("button", { name: "载入当前项目策划稿" }));
    expect(control("文案标题").value).toBe(source.draft.title);
    expect(control("今日主题").value).toBe(source.brief.theme);
    fireEvent.click(screen.getByRole("button", { name: "撤回修改" }));
    expect(control("文案标题").value).toBe(state.draft?.title);
    expect(control("今日主题").value).toBe(brief.theme);
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt).toHaveBeenCalledExactlyOnceWith(brief, state.draft);
  });

  it("rejects a rewrite returned for a different section and preserves the editable draft", async () => {
    const state = seedWorkingState();
    const api = mockPlannerApi();
    const { onAdopt } = await mountPanel();
    await requestRewrite(api, Response.json({ section: { ...state.draft!.sections[0], text: "错误段落的结果" } }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("选中的段落不一致"));
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt).toHaveBeenCalledExactlyOnceWith(brief, state.draft);
  });
});
