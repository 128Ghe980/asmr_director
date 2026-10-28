// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CREATIVE_TEMPLATES, createTemplateDemo } from "@/lib/asmr/creative-templates";
import { PlannerBriefSchema, type PlannerDraft } from "@/lib/asmr/planner";
import { createEmptyPlannerWorkingState, loadPlannerDraft, savePlannerDraft, type PlannerWorkingState } from "@/lib/asmr/planner-persistence";
import { createStoryboardSourceFingerprint, type PlannerStoryboard } from "@/lib/asmr/storyboard";
import { PlannerPanel } from "./planner-panel";

const template = CREATIVE_TEMPLATES[0];
const brief = PlannerBriefSchema.parse({ theme: "用户自己的书店故事", role: "用户的店员", style: "用户的自然风格" });
const draft: PlannerDraft = {
  title: "已有书店文案", scene: "安静书店", character: { role: "店员", personality: ["随和"], speechStyle: ["轻声"] },
  sections: [{ id: "old_1", title: "开场", text: "这是我已有的文案，先来翻一页书。", emotion: "平静", style: "自然", pace: "缓慢", direction: "翻页后放下书", soundSuggestions: "轻柔的纸张声", pauseAfter: "medium", position: { pan: 0, distance: "near", movement: "static" } }],
};
const storyboard: PlannerStoryboard = { version: 1, title: "书店旧分镜", sourceFingerprint: createStoryboardSourceFingerprint(draft), shots: [{ id: "old_shot", title: "桌边", sourceSectionIds: ["old_1"], visual: "旧画面", action: "旧动作", camera: "旧镜头" }] };

function templateCard() { return within(screen.getByLabelText(`模板：${template.title}`)); }
function control(label: string) { return (label.startsWith("模板") ? templateCard() : screen).getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement; }
function tab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
  if (name === "参考模板") fireEvent.click(screen.getByLabelText(`模板：${template.title}`).querySelector("summary")!);
}
function seed(patch: Partial<PlannerWorkingState> = {}, projectId?: string) {
  const state = { ...createEmptyPlannerWorkingState(), brief, draftBrief: brief, draft, storyboard, sceneDescription: "已有书店背景", ...patch };
  expect(savePlannerDraft(window.localStorage, state, projectId)).toEqual({ success: true });
  return state;
}
function mockApi() {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const responses: Response[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method !== "POST") return Response.json({ providers: [{ id: "ollama", label: "本地模型", model: "fixture-template", configured: true }], defaultProvider: "ollama" });
    posts.push({ path: String(url), body: JSON.parse(String(init.body)) });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected template request");
    return response;
  }));
  return { posts, respond: (response: Response) => responses.push(response) };
}
async function mountPanel(projectId?: string) {
  const onAdopt = vi.fn();
  const view = render(<PlannerPanel projectId={projectId} onAdopt={onAdopt} />);
  await waitFor(() => expect(control("今日主题").disabled).toBe(false));
  await screen.findByText("fixture-template");
  return { ...view, onAdopt };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("reference templates in the creation workspace", () => {
  it("selects the interaction template and locks listener POV without replacing an existing theme or draft", async () => {
    seed(); mockApi(); await mountPanel();
    const interaction = CREATIVE_TEMPLATES.find(item => item.id === "intimate-interaction-theatre")!;
    fireEvent.change(screen.getByRole("combobox", { name: "参考模板" }), { target: { value: interaction.id } });
    const style = screen.getByRole("combobox", { name: "分镜风格" }) as HTMLSelectElement;
    expect(style.disabled).toBe(true);
    expect(style.value).toBe("listener_pov");
    expect(control("今日主题").value).toBe(brief.theme);
    expect(control("第 1 段台词").value).toBe(draft.sections[0].text);
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.brief.referenceTemplate).toEqual(interaction));
    expect(loadPlannerDraft(window.localStorage).state.draftBrief).toEqual(brief);
  });

  it("fills and loads the interaction example independently of the original trading template", async () => {
    mockApi(); const { onAdopt } = await mountPanel();
    const interaction = CREATIVE_TEMPLATES.find(item => item.id === "intimate-interaction-theatre")!;
    const example = createTemplateDemo(interaction);
    fireEvent.change(screen.getByRole("combobox", { name: "参考模板" }), { target: { value: interaction.id } });
    expect(control("今日主题").value).toBe(example.brief.theme);
    expect(control("角色 / 关系").value).toBe(example.brief.role);
    expect(screen.queryByLabelText("文案标题")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "参考模板" }));
    const card = screen.getByLabelText(`模板：${interaction.title}`);
    fireEvent.click(card.querySelector("summary")!);
    fireEvent.click(within(card).getByRole("button", { name: "载入中文示例稿" }));
    expect(control("文案标题").value).toBe(example.draft.title);
    expect(control("第 1 段台词").value).toBe(example.draft.sections[0].text);
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt).toHaveBeenCalledExactlyOnceWith(example.brief, example.draft, undefined, example.sceneDescription);
  });

  it("persists POV selection, locks a template's own style and restores the independent choice when removed", async () => {
    seed(); mockApi(); const view = await mountPanel();
    const style = screen.getByRole("combobox", { name: "分镜风格" }) as HTMLSelectElement;
    expect(style.value).toBe("character_framing");
    fireEvent.change(style, { target: { value: "listener_pov" } });
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.brief.storyboardStyle).toBe("listener_pov"));
    expect(loadPlannerDraft(window.localStorage).state.draftBrief).toEqual(brief);
    fireEvent.change(screen.getByRole("combobox", { name: "参考模板" }), { target: { value: template.id } });
    expect(style.disabled).toBe(true);
    expect(style.value).toBe("character_framing");
    fireEvent.change(screen.getByRole("combobox", { name: "参考模板" }), { target: { value: "" } });
    expect(style.disabled).toBe(false);
    expect(style.value).toBe("listener_pov");
    view.unmount(); await mountPanel();
    expect((screen.getByRole("combobox", { name: "分镜风格" }) as HTMLSelectElement).value).toBe("listener_pov");
    expect(control("第 1 段台词").value).toBe(draft.sections[0].text);
  });

  it("sends selected POV style to generation and retains it in the adopted draft snapshot", async () => {
    seed(); const api = mockApi(); const { onAdopt } = await mountPanel();
    fireEvent.change(screen.getByRole("combobox", { name: "分镜风格" }), { target: { value: "listener_pov" } });
    api.respond(Response.json({ draft }));
    fireEvent.click(screen.getByRole("button", { name: "重新生成表演脚本" }));
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.draftBrief?.storyboardStyle).toBe("listener_pov"));
    expect((api.posts[0].body.brief as { storyboardStyle: string }).storyboardStyle).toBe("listener_pov");
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt.mock.calls[0][0].storyboardStyle).toBe("listener_pov");
  });

  it("applies a template to future creation while preserving the old draft, scene and adoption source", async () => {
    const old = seed(); mockApi(); const { onAdopt } = await mountPanel();
    tab("参考模板");
    expect(screen.queryByText(/分析依据|不是模型现场生成/)).toBeNull();
    expect(control("模板创作 Prompt").value).toBe(template.creativePrompt);
    fireEvent.click(templateCard().getByRole("button", { name: "应用到创作设定" }));
    expect(control("今日主题").value).toBe(brief.theme);
    expect(control("角色 / 关系").value).toBe(brief.role);
    expect(control("说话风格").value).toBe(brief.style);
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.brief.referenceTemplate).toEqual(template));
    expect(loadPlannerDraft(window.localStorage).state.draftBrief).toEqual(brief);
    tab("场景"); expect(control("剧情背景").value).toBe(old.sceneDescription);
    tab("表演脚本"); expect(control("第 1 段台词").value).toBe(draft.sections[0].text);
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt).toHaveBeenCalledExactlyOnceWith(brief, draft, storyboard, old.sceneDescription);
    tab("参考模板"); fireEvent.click(screen.getByRole("button", { name: "取消使用模板" }));
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.brief.referenceTemplate).toBeUndefined());
    expect(loadPlannerDraft(window.localStorage).state.draft).toEqual(draft);
  });

  it("loads the labeled demo with its scene, clears incompatible shots, and restores all prior state with undo", async () => {
    const old = seed(); mockApi(); const { onAdopt } = await mountPanel();
    tab("参考模板"); fireEvent.click(templateCard().getByRole("button", { name: "载入中文示例稿" }));
    const demo = createTemplateDemo(template);
    expect(control("文案标题").value).toBe(demo.draft.title);
    expect(screen.getByText("已载入中文示例稿。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt).toHaveBeenCalledExactlyOnceWith(demo.brief, demo.draft, undefined, demo.sceneDescription);
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.storyboard).toBeNull());
    tab("场景"); expect(control("剧情背景").value).toBe(demo.sceneDescription);
    fireEvent.click(screen.getByRole("button", { name: "撤回修改" }));
    expect(control("剧情背景").value).toBe(old.sceneDescription);
    tab("表演脚本"); expect(control("文案标题").value).toBe(draft.title);
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt.mock.calls[1]).toEqual([brief, draft, storyboard, old.sceneDescription]);
  });

  it("sends edited template instructions to generation and replaces the previous story background on success", async () => {
    seed(); const api = mockApi(); const { onAdopt } = await mountPanel();
    tab("参考模板"); fireEvent.click(templateCard().getByRole("button", { name: "应用到创作设定" }));
    fireEvent.change(control("模板创作 Prompt"), { target: { value: "把禁令改为禁止香氛，保留秘密交易的喜剧结构。" } });
    fireEvent.change(control("模板分镜约束"), { target: { value: "只用一瓶香氛，先放下试香纸再收瓶，始终保持手部连续。" } });
    fireEvent.change(control("模板场景描述"), { target: { value: "巷口小店的同一张桌边，暖灯照着香氛瓶。" } });
    const edited = { ...template, creativePrompt: control("模板创作 Prompt").value, storyboardRules: control("模板分镜约束").value, sceneDescription: control("模板场景描述").value };
    const adaptedScene = "书店禁止翻书，店员在柜台边悄悄打开一本旧书。";
    const newOpening = "这本书要轻轻翻，别让门外的人听见。";
    api.respond(Response.json({ draft: { ...draft, title: "新生成的故事", scene: adaptedScene, sections: [{ ...draft.sections[0], text: newOpening }] } }));
    fireEvent.click(screen.getByRole("button", { name: "重新生成表演脚本" }));
    await waitFor(() => expect(control("文案标题").value).toBe("新生成的故事"));
    expect(control("第 1 段台词").value).toBe(newOpening);
    expect(api.posts[0]).toEqual({ path: "/api/planner", body: { action: "generate", provider: "ollama", brief: { ...brief, referenceTemplate: edited } } });
    tab("场景"); expect(control("剧情背景").value).toBe(adaptedScene);
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt.mock.calls[0][0].referenceTemplate).toEqual(edited);
    expect(onAdopt.mock.calls[0][2]).toBeUndefined();
    expect(onAdopt.mock.calls[0][3]).toBe(adaptedScene);
  });

  it("uses the draft template for scene requests even after future creation settings change", async () => {
    const oldTemplate = { ...template, creativePrompt: "原文案的模板要求" };
    seed({ brief: { ...brief, referenceTemplate: { ...template, creativePrompt: "下一份文案的新要求" } }, draftBrief: { ...brief, referenceTemplate: oldTemplate } });
    const api = mockApi(); await mountPanel();
    api.respond(Response.json({ sceneDescription: "按当前文案生成的背景", sourceFingerprint: createStoryboardSourceFingerprint(draft) }));
    tab("场景"); fireEvent.click(screen.getByRole("button", { name: "重新生成背景" }));
    await waitFor(() => expect(control("剧情背景").value).toBe("按当前文案生成的背景"));
    expect(api.posts[0].body.referenceTemplate).toEqual(oldTemplate);
    tab("参考模板"); fireEvent.click(screen.getByRole("button", { name: "取消使用模板" }));
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.brief.referenceTemplate).toBeUndefined());
    expect(loadPlannerDraft(window.localStorage).state.draftBrief?.referenceTemplate).toEqual(oldTemplate);
  });

  it("fills an empty theme and role without generating a draft, and supports undo before a draft exists", async () => {
    mockApi(); await mountPanel();
    fireEvent.keyDown(screen.getByRole("tab", { name: "表演脚本" }), { key: "End" });
    expect(document.activeElement?.id).toBe("planner-tab-templates");
    fireEvent.click(screen.getByLabelText(`模板：${template.title}`).querySelector("summary")!);
    fireEvent.click(templateCard().getByRole("button", { name: "应用到创作设定" }));
    expect(control("今日主题").value).toBe(createTemplateDemo(template).brief.theme);
    expect(control("角色 / 关系").value).toBe(createTemplateDemo(template).brief.role);
    expect(screen.queryByLabelText("文案标题")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "撤回修改" }));
    expect(control("今日主题").value).toBe("");
    expect(templateCard().getByRole("button", { name: "应用到创作设定" })).toBeTruthy();
  });

  it("keeps template edits and drafts scoped when switching projects", async () => {
    seed({}, "one"); seed({ brief: { ...brief, theme: "另一个项目" }, draftBrief: { ...brief, theme: "另一个项目" } }, "two");
    mockApi(); const view = await mountPanel("one");
    tab("参考模板"); fireEvent.click(templateCard().getByRole("button", { name: "应用到创作设定" }));
    fireEvent.change(control("模板创作 Prompt"), { target: { value: "只属于项目一的模板" } });
    view.rerender(<PlannerPanel projectId="two" onAdopt={view.onAdopt} />);
    await waitFor(() => expect(control("今日主题").value).toBe("另一个项目"));
    tab("参考模板"); expect(screen.queryByRole("button", { name: "取消使用模板" })).toBeNull();
    view.rerender(<PlannerPanel projectId="one" onAdopt={view.onAdopt} />);
    await waitFor(() => expect(control("今日主题").value).toBe(brief.theme));
    tab("参考模板"); expect(control("模板创作 Prompt").value).toBe("只属于项目一的模板");
    expect(loadPlannerDraft(window.localStorage, "two").state.brief.referenceTemplate).toBeUndefined();
    expect(loadPlannerDraft(window.localStorage, "one").state.draft).toEqual(draft);
  });

  it("saves a temporarily empty prompt without losing the editor and prevents generation until it is restored", async () => {
    seed({ brief: { ...brief, referenceTemplate: template } }); const api = mockApi();
    const first = await mountPanel(); tab("参考模板");
    fireEvent.change(control("模板创作 Prompt"), { target: { value: "" } });
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.brief.referenceTemplate?.creativePrompt).toBe(""));
    first.unmount(); await mountPanel(); tab("参考模板");
    expect(control("模板创作 Prompt").value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "重新生成表演脚本" }));
    expect(screen.getByText(/模板创作 Prompt需要检查/)).toBeTruthy();
    expect(api.posts).toHaveLength(0);
  });

  it("downloads the draft's template and shot guidance without attaching next-generation edits", async () => {
    const oldTemplate = { ...template, creativePrompt: "当前文案使用的模板 Prompt" };
    seed({ brief: { ...brief, referenceTemplate: { ...template, creativePrompt: "尚未应用到文案的新要求" } }, draftBrief: { ...brief, referenceTemplate: oldTemplate } });
    mockApi(); await mountPanel();
    let exported: Blob | undefined;
    vi.stubGlobal("URL", { createObjectURL: vi.fn((blob: Blob) => { exported = blob; return "blob:test"; }), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "下载" }));
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(exported!);
    });
    expect(content).toContain(oldTemplate.creativePrompt);
    expect(content).not.toContain("尚未应用到文案的新要求");
    expect(content).toContain(oldTemplate.storyboardRules);
    expect(content).toContain(oldTemplate.beats[0].continuity);
    expect(content).toContain("已有书店背景");
    expect(content).not.toContain("分析依据");
    expect(content).not.toContain(oldTemplate.source.analysisBasis);
  });

  it("selects and clears templates from the creation sidebar without changing the open tab or user's theme", async () => {
    seed(); mockApi(); await mountPanel();
    expect(screen.queryByRole("button", { name: "浏览参考模板" })).toBeNull();
    const selector = screen.getByRole("combobox", { name: "参考模板" });
    expect(screen.getAllByRole("option").some((option) => option.textContent === template.title)).toBe(true);
    fireEvent.change(selector, { target: { value: template.id } });
    expect(control("今日主题").value).toBe(brief.theme);
    expect(screen.getByRole("tab", { name: "表演脚本" }).getAttribute("aria-selected")).toBe("true");
    expect(control("第 1 段台词").value).toBe(draft.sections[0].text);
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.brief.referenceTemplate?.id).toBe(template.id));
    fireEvent.change(selector, { target: { value: "" } });
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.brief.referenceTemplate).toBeUndefined());
    expect(control("今日主题").value).toBe(brief.theme);
  });

  it("starts with all template content collapsed and keeps script controls in the document flow", async () => {
    seed(); mockApi(); const { container, onAdopt } = await mountPanel();
    expect(screen.queryByText("文案设置")).toBeNull();
    expect(container.querySelector(".fixed")).toBeNull();
    const actions = screen.getByText("文案操作").closest("details")!;
    fireEvent.click(screen.getByText("文案操作")); expect(actions.open).toBe(true);
    fireEvent.click(screen.getByText("文案操作")); expect(actions.open).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "参考模板" }));
    const panel = screen.getByRole("tabpanel");
    expect(panel.querySelectorAll("details").length).toBeGreaterThan(3);
    expect(panel.querySelectorAll("details[open]")).toHaveLength(0);
    expect((screen.getByLabelText(`模板：${template.title}`) as HTMLDetailsElement).open).toBe(false);
    tab("场景");
    fireEvent.change(control("文案角色"), { target: { value: "修改后的书店店员" } });
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt.mock.calls[0][1].character.role).toBe("修改后的书店店员");
    expect(onAdopt.mock.calls[0][0]).toEqual(brief);
  });

  it("keeps a 3000-character template scene intact when applying and loading its example", async () => {
    seed(); mockApi(); const { onAdopt } = await mountPanel(); tab("参考模板");
    const longScene = "暖灯照亮小店，桌面上的香氛排列整齐。".repeat(150);
    expect(longScene.length).toBeGreaterThan(2000); expect(longScene.length).toBeLessThanOrEqual(4000);
    fireEvent.change(control("模板场景描述"), { target: { value: longScene } });
    fireEvent.click(templateCard().getByRole("button", { name: "应用到创作设定" }));
    await waitFor(() => expect(loadPlannerDraft(window.localStorage).state.brief.referenceTemplate?.sceneDescription).toBe(longScene));
    fireEvent.click(templateCard().getByRole("button", { name: "载入中文示例稿" }));
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt.mock.calls[0][1].scene).toBe(longScene);
    expect(onAdopt.mock.calls[0][3]).toBe(longScene);
  });

  it("shows a legacy scene and sends the updated scene with subsequent rewrites and adoption", async () => {
    seed({ sceneDescription: null }); const api = mockApi(); const { onAdopt } = await mountPanel();
    tab("场景"); expect(control("剧情背景").value).toBe(draft.scene);
    const updatedScene = "深夜小巷的书摊，店员在暖灯下整理唯一的一本旧书。";
    fireEvent.change(control("剧情背景"), { target: { value: updatedScene } });
    tab("表演脚本"); fireEvent.focus(control("第 1 段台词"));
    fireEvent.click(screen.getByRole("button", { name: "AI 改写第 1 段" }));
    fireEvent.change(control("第 1 段改写要求"), { target: { value: "改得更像巷口交谈" } });
    api.respond(Response.json({ section: { ...draft.sections[0], text: "这本书，我替你留到现在。" } }));
    fireEvent.click(screen.getByRole("button", { name: "改写这一段" }));
    await waitFor(() => expect(control("第 1 段台词").value).toBe("这本书，我替你留到现在。"));
    expect((api.posts[0].body.draft as PlannerDraft).scene).toBe(updatedScene);
    fireEvent.click(screen.getByRole("button", { name: "采用并创建工程" }));
    expect(onAdopt.mock.calls[0][1].scene).toBe(updatedScene);
    expect(onAdopt.mock.calls[0][3]).toBe(updatedScene);
  });
});
