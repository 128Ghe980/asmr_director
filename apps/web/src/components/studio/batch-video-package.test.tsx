// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoProject } from "@/lib/asmr/mock-project";
import { getVideoPackageFilename } from "@/lib/asmr/video-package";
import { createClipVideoSourceFingerprint } from "@/lib/asmr/video-plan";
import type { AsmrSound } from "@/lib/asmr/asmr-sound";
import { BatchAudioDownload } from "./batch-audio-download";

function fixture() {
  const project = structuredClone(demoProject);
  const track = project.timeline.tracks.find(track => track.track_type === "voice")!;
  track.clips.splice(1);
  const clip = track.clips[0];
  clip.generation.status = "asset_generated";
  clip.asset = { asset_id: "video_adopted", uri: "asset://clip/video_adopted", duration: 2 };
  project.videoPlan = { version: 1, sceneDescription: "木屋窗边。", shots: {} };
  project.videoPlan.shots[clip.id] = {
    version: 1, promptFormat: "minimax-h3", clipId: clip.id,
    sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
    audio: { assetId: "video_adopted", uri: "asset://clip/video_adopted", duration: 2 },
    title: "窗边", visual: "S1 sits by a window.", action: "S1 sets down a cup.", camera: "Static medium shot.",
  };
  return project;
}

const downloadUrl = "/api/assets/batch-download?token=1f9ab138-5013-49cf-9f8d-9ba81c5c097a";
function ready(project = fixture()) {
  return Response.json({ downloadUrl, filename: getVideoPackageFilename(project), clipCount: 1, size: 512 });
}
function openVideo() {
  fireEvent.click(screen.getByRole("button", { name: "批量下载" }));
  fireEvent.click(screen.getByRole("tab", { name: "视频包" }));
}

function silentFixture(expanded = false) {
  const project = fixture(), clip = project.timeline.tracks.find(track => track.track_type === "voice")!.clips[0];
  clip.kind = "silent"; clip.duration = 6; clip.text = "慢慢做整理领口的空手手势。";
  clip.asset = { asset_id: null, uri: null, duration: null }; clip.generation.status = "asset_pending";
  const shot = project.videoPlan!.shots[clip.id]; delete shot.audio;
  const sound: AsmrSound = { prompt: "Soft cotton folding.", postProcessing: { start: { pan: 0, distance: "near" }, end: { pan: 0, distance: "near" }, movement: "static", gainDb: -12 } };
  Object.assign(shot, { kind: "silent", duration: 6, ambientSound: "Soft cloth foley.", asmrSound: sound,
    sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id) });
  if (expanded) shot.parts = [1, 2].map(() => ({ durationSeconds: 3, visual: shot.visual, action: shot.action, camera: shot.camera,
    ambientSound: shot.ambientSound!, asmrSound: structuredClone(sound) }));
  return project;
}

beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("portable video package export", () => {
  it("exports action-first as a separate choice without guessing a continuation from adjacency", async () => {
    const project = silentFixture(), before = structuredClone(project);
    vi.mocked(fetch).mockImplementation(async () => ready(project));
    render(<BatchAudioDownload project={project} />); openVideo();
    const mode = screen.getByRole("combobox", { name: "声音生成方式" }) as HTMLSelectElement;
    fireEvent.change(mode, { target: { value: "action-first" } });
    expect(mode.value).toBe("action-first");
    expect(screen.getByText(/无台词画面直接生成动作与声音/)).toBeTruthy();
    expect(screen.getByText(/已安排 0 段边做边说/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下载视频项目包" }));
    await screen.findByText("下载已发起，解压后在生成主机打开 run.bat。");
    const form = vi.mocked(fetch).mock.calls[0][1]!.body as FormData;
    expect(form.get("silentAudioMode")).toBe("action-first");
    expect(JSON.parse(form.get("project") as string)).toEqual(before);
    expect(project).toEqual(before);
  });

  it("blocks action-first with a missing native sound design and allows switching back", () => {
    const project = silentFixture(); delete Object.values(project.videoPlan!.shots)[0].asmrSound;
    render(<BatchAudioDownload project={project} />); openVideo();
    const mode = screen.getByRole("combobox", { name: "声音生成方式" });
    fireEvent.change(mode, { target: { value: "action-first" } });
    expect(screen.getByRole("alert").textContent).toContain("补齐 1 个无台词片段的 ASMR 声音设计");
    expect((screen.getByRole("button", { name: "下载视频项目包" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(mode, { target: { value: "native" } });
    expect((screen.getByRole("button", { name: "下载视频项目包" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("counts explicit continuations and blocks a changed source only in the action-first export", () => {
    const project = silentFixture(), track = project.timeline.tracks.find(track => track.track_type === "voice")!, silent = track.clips[0];
    const speechProject = fixture(), speech = structuredClone(speechProject.timeline.tracks.find(track => track.track_type === "voice")!.clips[0]);
    const speechShot = structuredClone(speechProject.videoPlan!.shots[speech.id]);
    speech.id += "_continuing"; speech.start = silent.start + silent.duration;
    track.clips.push(speech);
    const source = project.videoPlan!.shots[silent.id]; source.asmrSound!.role = "trigger";
    project.videoPlan!.shots[speech.id] = { ...speechShot, clipId: speech.id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, speech.id),
      asmrSound: { ...structuredClone(source.asmrSound!), mixMode: "overlay", continuation: "previous-silent" } };
    const view = render(<BatchAudioDownload project={project} />); openVideo();
    fireEvent.change(screen.getByRole("combobox", { name: "声音生成方式" }), { target: { value: "action-first" } });
    expect(screen.getByText(/已安排 1 段边做边说/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "下载视频项目包" }) as HTMLButtonElement).disabled).toBe(false);
    const changed = structuredClone(project); changed.videoPlan!.shots[silent.id].asmrSound!.role = "ambience";
    view.rerender(<BatchAudioDownload project={changed} />);
    expect(screen.getByRole("alert").textContent).toContain("第 2 段");
    expect((screen.getByRole("button", { name: "下载视频项目包" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "声音生成方式" }), { target: { value: "native" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "下载视频项目包" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps sound-first opt-in and clears completed status when its option changes", async () => {
    const project = silentFixture(), before = structuredClone(project);
    vi.mocked(fetch).mockImplementation(async () => ready(project));
    render(<BatchAudioDownload project={project} />); openVideo();
    const option = screen.getByRole("combobox", { name: "声音生成方式" }) as HTMLSelectElement;
    expect(option.value).toBe("native");
    fireEvent.click(screen.getByRole("button", { name: "下载视频项目包" }));
    await screen.findByText("下载已发起，解压后在生成主机打开 run.bat。");
    expect((vi.mocked(fetch).mock.calls[0][1]!.body as FormData).has("silentAudioMode")).toBe(false);
    fireEvent.change(option, { target: { value: option.value === "native" ? "asmr-first" : "native" } });
    expect(screen.queryByRole("status")).toBeNull();
    expect(option.value).toBe("asmr-first");
    fireEvent.click(screen.getByRole("button", { name: "下载视频项目包" }));
    await screen.findByText("下载已发起，解压后在生成主机打开 run.bat。");
    const form = vi.mocked(fetch).mock.calls[1][1]!.body as FormData;
    expect(form.get("silentAudioMode")).toBe("asmr-first");
    expect(JSON.parse(form.get("project") as string)).toEqual(before);
    expect(project).toEqual(before);
  });

  it.each([false, true])("blocks sound-first when a silent sound design is missing, expanded=%s", expanded => {
    const project = silentFixture(expanded), shot = Object.values(project.videoPlan!.shots)[0];
    if (expanded) Reflect.deleteProperty(shot.parts![1], "asmrSound");
    else delete shot.asmrSound;
    render(<BatchAudioDownload project={project} />); openVideo();
    fireEvent.change(screen.getByRole("combobox", { name: "声音生成方式" }), { target: { value: "asmr-first" } });
    expect(screen.getByRole("alert").textContent).toContain("补齐 1 个无台词片段的 ASMR 声音设计");
    const button = screen.getByRole("button", { name: "下载视频项目包" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); fireEvent.click(button);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("locks the option during preparation and discards a cancelled result after changing it", async () => {
    let finish!: (response: Response) => void;
    const project = silentFixture();
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(fetch).mockResolvedValueOnce(ready(project));
    render(<BatchAudioDownload project={project} />); openVideo();
    const option = screen.getByRole("combobox", { name: "声音生成方式" }) as HTMLSelectElement;
    fireEvent.change(option, { target: { value: option.value === "native" ? "asmr-first" : "native" } }); fireEvent.click(screen.getByRole("button", { name: "下载视频项目包" }));
    expect(option.disabled).toBe(true);
    const oldSignal = vi.mocked(fetch).mock.calls[0][1]!.signal;
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(oldSignal!.aborted).toBe(true); expect(option.disabled).toBe(false);
    fireEvent.change(option, { target: { value: option.value === "native" ? "asmr-first" : "native" } });
    await act(async () => { finish(ready(project)); });
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "下载视频项目包" }));
    await screen.findByText("下载已发起，解压后在生成主机打开 run.bat。");
    expect((vi.mocked(fetch).mock.calls[1][1]!.body as FormData).has("silentAudioMode")).toBe(false);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  });

  it.each([5, 3])("validates the generated task count, while displaying three logical performance sections: %s", async (clipCount) => {
    const project = fixture(), track = project.timeline.tracks.find(track => track.track_type === "voice")!, first = track.clips[0];
    const sound: AsmrSound = { prompt: "Soft dry taps on the same wooden box.", mixMode: "replace",
      postProcessing: { start: { pan: 0, distance: "near" }, end: { pan: 0, distance: "near" }, movement: "static", gainDb: -6 } };
    const silent = { ...structuredClone(first), id: "wooden_box_performance", kind: "silent" as const, text: "保持同一机位轻敲木盒。",
      start: first.start + first.duration, duration: 15, asset: { asset_id: null, uri: null, duration: null },
      generation: { ...first.generation, status: "asset_pending" as const } };
    const last = { ...structuredClone(first), id: "closing_line", start: silent.start + silent.duration, text: "这次听清楚了吗？" };
    track.clips.push(silent, last);
    project.videoPlan!.shots[silent.id] = { version: 1, promptFormat: "minimax-h3", clipId: silent.id, kind: "silent", duration: 15,
      sourceFingerprint: createClipVideoSourceFingerprint(project, silent.id), title: "轻敲木盒", visual: "The same box rests on the table.",
      action: "S1 softly taps the box.", camera: "Keep the same stable listener viewpoint.", ambientSound: "Gentle wooden taps.", asmrSound: sound,
      parts: Array.from({ length: 3 }, () => ({ durationSeconds: 5, visual: "The box remains in the same position.", action: "Continue the gentle taps.",
        camera: "Keep the same stable listener viewpoint.", ambientSound: "Gentle wooden taps.", asmrSound: sound })) };
    project.videoPlan!.shots[last.id] = { ...project.videoPlan!.shots[first.id], clipId: last.id, sourceFingerprint: createClipVideoSourceFingerprint(project, last.id) };
    vi.mocked(fetch).mockResolvedValue(Response.json({ downloadUrl, filename: getVideoPackageFilename(project), clipCount, size: 1024 }));
    render(<BatchAudioDownload project={project} />); openVideo();
    expect(screen.getByText(/当前项目共 3 段表演/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "下载视频项目包" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false); fireEvent.click(button);
    if (clipCount === 5) {
      await screen.findByText("下载已发起，解压后在生成主机打开 run.bat。");
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    } else {
      await screen.findByRole("alert");
      expect(screen.getByRole("alert").textContent).toContain("下载文件暂不可用");
      expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    }
  });

  it("shows missing ASMR planning without blocking a legacy video package", async () => {
    const project = fixture(); vi.mocked(fetch).mockResolvedValue(ready(project));
    render(<BatchAudioDownload project={project} />); openVideo();
    expect(screen.getByText("ASMR 触发音：0 / 1 镜已规划")).toBeTruthy();
    expect(screen.getByText(/补齐剩余 1 镜的 ASMR 规划/)).toBeTruthy();
    const download = screen.getByRole("button", { name: "下载视频项目包" }) as HTMLButtonElement;
    expect(download.disabled).toBe(false);
    fireEvent.click(download);
    await screen.findByText("下载已发起，解压后在生成主机打开 run.bat。");
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1]!.body as FormData).get("project") as string)).toEqual(project);
  });

  it("counts current ASMR plans for dialogue and silent shots and distinguishes a complete overlay package", () => {
    const project = fixture(), track = project.timeline.tracks.find(track => track.track_type === "voice")!, first = track.clips[0];
    const sound: AsmrSound = { prompt: "Soft fabric sliding.", postProcessing: { start: { pan: 0, distance: "near" }, end: { pan: 0, distance: "near" }, movement: "static", gainDb: -12 } };
    const silent = { ...first, id: "silent_asmr", kind: "silent" as const, text: "衣料滑过桌面。", start: first.start + first.duration, duration: 3,
      asset: { asset_id: null, uri: null, duration: null }, generation: { ...first.generation, status: "asset_pending" as const } };
    track.clips.push(silent);
    project.videoPlan!.shots[first.id].asmrSound = sound;
    project.videoPlan!.shots[silent.id] = { version: 1, promptFormat: "minimax-h3", clipId: silent.id, kind: "silent", duration: 3,
      sourceFingerprint: createClipVideoSourceFingerprint(project, silent.id), title: "衣料", visual: "Cloth on a table.", action: "Cloth slides.", camera: "Fixed view.", ambientSound: "Quiet room." };
    const view = render(<BatchAudioDownload project={project} />); openVideo();
    expect(screen.getByText("ASMR 触发音：1 / 2 镜已规划")).toBeTruthy();
    expect((screen.getByRole("button", { name: "下载视频项目包" }) as HTMLButtonElement).disabled).toBe(false);
    const complete = structuredClone(project); complete.videoPlan!.shots[silent.id].asmrSound = sound;
    view.rerender(<BatchAudioDownload project={complete} />);
    expect(screen.getByText("ASMR 触发音：2 / 2 镜已规划")).toBeTruthy();
    expect(screen.getByText("勾选合并顺序预览后，输出原版与 ASMR 叠加版。")).toBeTruthy();
    const stale = structuredClone(complete); stale.timeline.tracks.find(track => track.track_type === "voice")!.clips[1].text = "新的空镜动作。";
    view.rerender(<BatchAudioDownload project={stale} />);
    expect(screen.getByText("ASMR 触发音：1 / 2 镜已规划")).toBeTruthy();
    expect((screen.getByRole("button", { name: "下载视频项目包" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("posts one current project snapshot and an optional replaceable reference without audio-version controls", async () => {
    const project = fixture();
    vi.mocked(fetch).mockResolvedValue(ready(project));
    render(<BatchAudioDownload project={project} />); openVideo();
    expect(screen.queryByText("无后处理")).toBeNull();
    expect(screen.queryByText("后处理")).toBeNull();
    const image = new File([new Uint8Array([255, 216, 255])], "character.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("角色参考图（可选）"), { target: { files: [image] } });
    fireEvent.click(screen.getByRole("button", { name: "下载视频项目包" }));
    await screen.findByText("下载已发起，解压后在生成主机打开 run.bat。");
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/assets/video-package");
    const body = options!.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(JSON.parse(body.get("project") as string)).toEqual(project);
    expect((body.get("reference") as File).name).toBe("character.jpg");
    expect(options!.headers).toEqual({ accept: "application/json" });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it("allows the generation host to supply its own reference and prevents incomplete packages", async () => {
    const project = fixture();
    delete project.videoPlan!.shots[project.timeline.tracks.find(track => track.track_type === "voice")!.clips[0].id];
    const view = render(<BatchAudioDownload project={project} />); openVideo();
    expect((screen.getByRole("button", { name: "下载视频项目包" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/第 1 镜/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    view.rerender(<BatchAudioDownload project={fixture()} />);
    vi.mocked(fetch).mockResolvedValue(ready());
    fireEvent.click(screen.getByRole("button", { name: "下载视频项目包" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect((vi.mocked(fetch).mock.calls[0][1]!.body as FormData).has("reference")).toBe(false);
  });

  it("rejects oversized reference files and lets the user remove them", () => {
    render(<BatchAudioDownload project={fixture()} />); openVideo();
    const image = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("角色参考图（可选）"), { target: { files: [image] } });
    expect(screen.getByRole("alert").textContent).toContain("8 MiB");
    expect((screen.getByRole("button", { name: "下载视频项目包" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "移除参考图" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "下载视频项目包" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the chosen reference visible after changing tabs and reopening the popover", () => {
    render(<BatchAudioDownload project={fixture()} />); openVideo();
    const image = new File([new Uint8Array([255, 216, 255])], "my-reference.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("角色参考图（可选）"), { target: { files: [image] } });
    fireEvent.click(screen.getByRole("tab", { name: "画面与声音" }));
    fireEvent.click(screen.getByRole("tab", { name: "视频包" }));
    expect(screen.getByText("已选：my-reference.jpg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭批量下载" }));
    fireEvent.click(screen.getByRole("button", { name: "批量下载" }));
    expect(screen.getByText("已选：my-reference.jpg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "移除参考图" }));
    expect(screen.queryByText("已选：my-reference.jpg")).toBeNull();
  });

  it("ignores a cancelled package response and does not download it after switching projects", async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(<BatchAudioDownload project={fixture()} />); openVideo();
    fireEvent.click(screen.getByRole("button", { name: "下载视频项目包" }));
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal;
    expect((screen.getByLabelText("角色参考图（可选）") as HTMLInputElement).disabled).toBe(true);
    const other = fixture(); other.project_id += "_other";
    view.rerender(<BatchAudioDownload project={other} />);
    expect(signal!.aborted).toBe(true);
    await act(async () => { resolve(ready()); });
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });
});
