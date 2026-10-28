import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareVideoPackage, type VideoPackageManifest } from "./local-video-package";
import { demoProject } from "./mock-project";
import { writePcm16Wav } from "./pcm-audio";
import { createClipVideoSourceFingerprint } from "./video-plan";
import { getLocalRuntimeConfig } from "./local-runtime-config";

const python = process.env.ASMR_VIDEO_PACKAGE_TEST_PYTHON;
const spatialPython = process.env.ASMR_VIDEO_PACKAGE_TEST_SPATIAL_PYTHON;

describe.skipIf(!python)("real package to portable Python runner", () => {
  it("extracts the exported single-audio package and dry-runs all speech/ambient/continuation modes without a server", async () => {
    const base = path.resolve(process.env.ASMR_VIDEO_PACKAGE_TEST_ROOT ?? "I:/AI/asmr_director/qa/video-batch/2026-10-15/qa");
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(path.join(base, "portable-smoke-"));
    const assets = path.join(root, "assets"), extracted = path.join(root, "package"), output = path.join(extracted, "outputs");
    const keep = process.env.ASMR_VIDEO_PACKAGE_KEEP_SMOKE === "1";
    try {
      await mkdir(assets);
      const project = structuredClone(demoProject);
      project.project_id = "synthetic_portable_smoke";
      project.title = "合成测试：有声与环境空镜";
      project.duration = 300;
      project.videoPlan = { version: 1, sceneDescription: "窗边的木桌，窗外有细雨。", shots: {} };
      const track = project.timeline.tracks.find(track => track.track_type === "voice")!;
      const template = structuredClone(track.clips[0]);
      track.clips = [0, 1, 2].map(index => ({ ...structuredClone(template), id: `smoke_${index + 1}`, start: 100 + index * 30, duration: index === 1 ? 5 : 20, pause_after: 20 }));
      for (const [index, clip] of track.clips.entries()) {
        clip.text = index === 1 ? "窗外细雨，杯边轻雾。" : "这是合成测试，不是正式配音。";
        if (index === 1) {
          clip.kind = "silent";
          clip.asset = { asset_id: null, uri: null, duration: null };
          clip.generation.status = "asset_pending";
        } else {
          clip.generation.status = "asset_generated";
          clip.asset = { asset_id: clip.id, uri: `asset://clip/${clip.id}`, duration: 99 };
          const samples = Float32Array.from({ length: index === 0 ? 14880 : 21600 }, (_, n) => .05 * Math.sin(2 * Math.PI * 440 * n / 48000));
          await writeFile(path.join(assets, `${clip.id}.wav`), writePcm16Wav(samples, 48000));
        }
        project.videoPlan.shots[clip.id] = {
          version: 1, promptFormat: "minimax-h3", clipId: clip.id,
          sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
          title: "测试分镜", visual: "A cup beside a rain-streaked window.", action: "Steam rises gently.", camera: "Static close-up.",
          ...(clip.kind === "silent" ? { kind: "silent" as const, duration: 5, ambientSound: "Soft rain outside, with a faint indoor room tone." }
            : { audio: { assetId: clip.id, uri: clip.asset.uri!, duration: 99 } }),
          referenceMode: index === 0 ? "new" : "continuous",
        };
      }
      const referencePath = process.env.ASMR_VIDEO_PACKAGE_TEST_REFERENCE;
      await writeFile(path.join(root, "synthetic-source-project.json"), JSON.stringify(project, null, 2));
      const reference = referencePath ? await readFile(referencePath)
        : Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhN8AAAAASUVORK5CYII=", "base64");
      const archive = await prepareVideoPackage(project, {
        runtimeRoot: root, clipAssetRoot: assets, mixAssetRoot: path.join(root, "mixes"),
        gptSovitsBaseUrl: "http://unused", voicePackPath: "unused",
      }, undefined, { reference, tempRoot: path.join(root, "zip-temp"), runnerRoot: path.resolve(process.cwd(), "../../tools/comfy-batch") });
      const zipPath = path.join(root, "synthetic-smoke-package.zip");
      await copyFile(archive.filePath, zipPath);
      await archive.cleanup();
      const unzip = spawnSync(python!, ["-c", "import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zipPath, extracted], { encoding: "utf8", timeout: 10000 });
      expect(unzip.status, unzip.stderr).toBe(0);
      const manifest = JSON.parse(await readFile(path.join(extracted, "project.json"), "utf8")) as VideoPackageManifest;
      expect(manifest.shots.map(shot => shot.durationSeconds)).toEqual([.31, 5, .45]);
      expect(JSON.stringify(manifest)).not.toMatch(/pause_after|startSeconds|previousPromptFingerprint/);
      expect(await readdir(path.join(extracted, "shots/002"))).toEqual(["prompt.txt"]);
      const run = spawnSync(python!, [path.join(extracted, "runner.py"), extracted, "--dry-run", "--output-root", output], {
        encoding: "utf8", timeout: 20000, env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      expect(run.status, run.stderr + run.stdout).toBe(0);
      const payloads = await Promise.all([1, 2, 3].map(async index => JSON.parse(await readFile(path.join(output, `dry-run/${String(index).padStart(3, "0")}.json`), "utf8"))));
      expect(payloads[0].prompt["11"].inputs.audio).toEqual(["24", 0]);
      expect(payloads[0].prompt["4"]).toBeUndefined();
      expect(payloads[1].prompt["11"].inputs.audio).toEqual(["904", 0]);
      expect(payloads[1].prompt["904"].inputs).toEqual({ audio: ["4", 0], start_index: 0, duration: 5 });
      expect(payloads[1].prompt["903"].inputs.length).toBe(120);
      expect(payloads[1].prompt["901"].class_type).toBe("CLFSelectVideoTailFrames");
      expect(payloads[1].prompt["902"].inputs.images).toEqual(["901", 0]);
      expect(payloads[1].prompt["24"]).toBeUndefined();
      expect(payloads[1]._dry_run.targetDurationSeconds).toBeLessThanOrEqual(5);
      expect(payloads[2].prompt["22"].inputs["ref_images.ref_image_1"]).toBeDefined();
      expect(payloads[0].prompt["26"].inputs["format.codec"]).toBe("auto");
      const multiple = spawnSync(python!, [path.join(extracted, "runner.py"), extracted, "--dry-run", "--candidates", "2", "--output-root", output], {
        encoding: "utf8", timeout: 20000, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
      });
      expect(multiple.status, multiple.stderr + multiple.stdout).toBe(0);
      const candidatePayloads = await Promise.all([1, 2, 3].flatMap(order => [1, 2].map(async candidate =>
        JSON.parse(await readFile(path.join(output, `dry-run/${String(order).padStart(3, "0")}_c${String(candidate).padStart(3, "0")}.json`), "utf8")))));
      expect(candidatePayloads.map(item => item._dry_run.candidateIndex)).toEqual([1, 2, 1, 2, 1, 2]);
      expect(new Set(candidatePayloads.map(item => item.prompt["10"].inputs.noise_seed)).size).toBe(6);
      expect(candidatePayloads.filter(item => item._dry_run.shotId === "smoke_2").every(item => item._dry_run.targetDurationSeconds <= 5)).toBe(true);
      expect(candidatePayloads[5].prompt["22"].inputs["ref_images.ref_image_1"]).toBeDefined();
      await writeFile(path.join(root, "smoke-evidence.json"), JSON.stringify({ verified: true, syntheticAudio: true, realH3Calls: 0, shots: manifest.shots.length,
        wavDurations: manifest.shots.map(shot => shot.durationSeconds), dryRun: run.stdout,
        candidatesPerShot: 2, candidatePayloads: candidatePayloads.length, candidateDryRun: multiple.stdout, archiveBytes: archive.size }, null, 2));
    } finally {
      if (!keep && path.dirname(root) === base) await rm(root, { recursive: true, force: true });
    }
  }, 40000);

  it.skipIf(!spatialPython)("exports real D assets and dry-runs dialogue/ambient ASMR sidecars for two candidates", async () => {
    const base = path.resolve(process.env.ASMR_VIDEO_PACKAGE_TEST_ROOT ?? "I:/AI/asmr_director/qa/video-batch/2026-10-28/asmr-sound");
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(path.join(base, "asmr-package-smoke-"));
    const assets = path.join(root, "assets"), extracted = path.join(root, "package");
    const keep = process.env.ASMR_VIDEO_PACKAGE_KEEP_SMOKE === "1";
    try {
      await mkdir(assets);
      const project = structuredClone(demoProject);
      project.project_id = "synthetic_asmr_package_smoke";
      project.title = "合成验证：剧情触发音双候选";
      project.videoPlan = { version: 1, storyboardStyle: "listener_pov", sceneDescription: "听者坐在窗边，角色拿起柔软的布整理桌面。", shots: {} };
      const track = project.timeline.tracks.find(track => track.track_type === "voice")!;
      const template = structuredClone(track.clips[0]);
      track.clips = [0, 1, 2].map(index => ({ ...structuredClone(template), id: `asmr_smoke_${index + 1}`, start: index * 20,
        duration: index === 1 ? 2.5 : 9, pause_after: 12 }));
      const expectedDurations = [.31, 2.5, .45];
      for (const [index, clip] of track.clips.entries()) {
        clip.text = index === 1 ? "角色安静地把布放回桌边。" : "这是合成验证，不是真实配音。";
        if (index === 1) {
          clip.kind = "silent";
          clip.asset = { asset_id: null, uri: null, duration: null };
          clip.generation.status = "asset_pending";
        } else {
          clip.generation.status = "asset_generated";
          clip.asset = { asset_id: clip.id, uri: `asset://clip/${clip.id}`, duration: 99 };
          const samples = Float32Array.from({ length: Math.round(expectedDurations[index] * 48000) }, (_, n) => .03 * Math.sin(2 * Math.PI * 440 * n / 48000));
          await writeFile(path.join(assets, `${clip.id}.wav`), writePcm16Wav(samples, 48000));
        }
        project.videoPlan.shots[clip.id] = {
          version: 1, promptFormat: "minimax-h3", clipId: clip.id,
          sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
          storyboardStyle: "listener_pov", title: "布料触发音", visual: "Listener eye-height view of a soft cloth on the desk.",
          action: "The cloth slides gently over the wood.", camera: "Listener looks down at the cloth without an external cut.",
          ...(clip.kind === "silent" ? { kind: "silent" as const, duration: 2.5, ambientSound: "Quiet room tone." }
            : { audio: { assetId: clip.id, uri: clip.asset.uri!, duration: 99 } }),
          referenceMode: index === 0 ? "new" : "continuous",
          asmrSound: { prompt: `Soft dry cloth friction, action ${index + 1}, gentle natural pauses.`, postProcessing: {
            start: { pan: -.5, distance: "near" }, end: { pan: .25, distance: "close" }, movement: "left_to_right", gainDb: -12,
          } },
        };
      }
      const runtime = getLocalRuntimeConfig();
      const hrtf = process.env.ASMR_VIDEO_PACKAGE_TEST_HRTF ?? runtime.spatialHrtfPath!;
      const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
      const hrtfBefore = hash(await readFile(hrtf));
      await writeFile(path.join(root, "synthetic-source-project.json"), JSON.stringify(project, null, 2));
      const archive = await prepareVideoPackage(project, {
        runtimeRoot: root, clipAssetRoot: assets, mixAssetRoot: path.join(root, "mixes"),
        gptSovitsBaseUrl: "http://unused", voicePackPath: "unused", spatialHrtfPath: hrtf,
      }, undefined, { tempRoot: path.join(root, "zip-temp"), runnerRoot: path.resolve(process.cwd(), "../../tools/comfy-batch") });
      const zipPath = path.join(root, "synthetic-asmr-package.zip");
      await copyFile(archive.filePath, zipPath);
      await archive.cleanup();
      const unzip = spawnSync(python!, ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2])", zipPath, extracted], { encoding: "utf8", timeout: 10000 });
      expect(unzip.status, unzip.stderr).toBe(0);
      const manifest = JSON.parse(await readFile(path.join(extracted, "project.json"), "utf8")) as VideoPackageManifest;
      expect(manifest.shots.map(shot => shot.durationSeconds)).toEqual(expectedDurations);
      expect(manifest.shots.map(shot => shot.asmrSound?.durationSeconds)).toEqual(expectedDurations);
      expect(manifest.shots.map(shot => shot.referenceMode)).toEqual(["new", "continuous", "continuous"]);
      expect(manifest.shots.every(shot => shot.prompt.includes("The camera is the listener's own eyes"))).toBe(true);
      expect(manifest.shots.every(shot => shot.asmrSound?.prompt.includes("No speech") && shot.asmrSound.prompt.includes("non_diegetic_music: N/A"))).toBe(true);
      const nodeRoot = path.join(extracted, "custom_nodes/asmr_director_audio");
      expect(hash(await readFile(path.join(nodeRoot, "data/subj_A.sofa")))).toBe(hrtfBefore);
      for (const [bundled, source] of [
        ["engine/processed_voice.py", "render-processed-voice.py"], ["engine/spatial_d/core.py", "spatial_d/core.py"],
        ["engine/spatial_d/near_field.py", "spatial_d/near_field.py"], ["engine/spatial_d/motion_convolution.py", "spatial_d/motion_convolution.py"],
      ]) expect(hash(await readFile(path.join(nodeRoot, bundled)))).toBe(hash(await readFile(path.resolve("scripts", source))));
      const run = spawnSync(python!, [path.join(extracted, "runner.py"), extracted, "--dry-run", "--candidates", "2"], {
        encoding: "utf8", timeout: 20000, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
      });
      expect(run.status, run.stderr + run.stdout).toBe(0);
      const payloads = await Promise.all([1, 2, 3].flatMap(order => [1, 2].map(async candidate => {
        const file = `${String(order).padStart(3, "0")}_c${String(candidate).padStart(3, "0")}.json`;
        return {
          main: JSON.parse(await readFile(path.join(extracted, "outputs/dry-run", file), "utf8")),
          sound: JSON.parse(await readFile(path.join(extracted, "outputs/asmr/outputs/dry-run", file), "utf8")),
        };
      })));
      for (const [index, item] of payloads.entries()) {
        const duration = expectedDurations[Math.floor(index / 2)];
        expect(item.sound._dry_run.requestedDurationSeconds).toBe(duration);
        expect(item.sound.prompt["904"].inputs.duration).toBe(duration);
        expect(item.sound.prompt["903"].inputs.length).toBe(Math.ceil(duration * 24));
        expect(item.sound.prompt["11"].inputs.audio).toEqual(["904", 0]);
        expect(item.sound.prompt["20"]).toBeUndefined();
        expect(item.sound.prompt["24"]).toBeUndefined();
        expect(item.sound.prompt["902"]).toBeUndefined();
        expect(JSON.stringify(item.sound.prompt["22"].inputs)).not.toMatch(/ref_images|ref_audios/);
      }
      expect(payloads[0].main.prompt["11"].inputs.audio).toEqual(["24", 0]);
      expect(payloads[2].main.prompt["11"].inputs.audio).toEqual(["904", 0]);
      expect(payloads[5].main.prompt["22"].inputs["ref_images.ref_image_1"]).toBeDefined();
      expect(new Set(payloads.flatMap(item => [item.main._dry_run.seed, item.sound._dry_run.seed])).size).toBe(12);
      const verifyScript = path.join(root, "verify-bundled-node.py");
      await writeFile(verifyScript, [
        "import importlib.util,json,sys,pathlib,numpy as np",
        "folder=pathlib.Path(sys.argv[1])",
        "spec=importlib.util.spec_from_file_location('asmr_export_smoke',folder/'__init__.py',submodule_search_locations=[str(folder)])",
        "node=importlib.util.module_from_spec(spec);sys.modules[spec.name]=node;spec.loader.exec_module(node)",
        "assert set(node.NODE_CLASS_MAPPINGS)=={'AsmrDirectorSpatialAudio','AsmrDirectorMixAudio'}",
        "profile=node._profile(); duration=.31; n=round(duration*48000)",
        "source=np.stack([np.sin(2*np.pi*440*np.arange(n)/48000)*.04,np.sin(2*np.pi*440*np.arange(n)/48000)*.02])",
        "output=node.spatial_samples(source,48000,duration,-.5,'near',.25,'close','left_to_right',-12,profile=profile)",
        "assert output.shape==(2,n) and np.isfinite(output).all() and np.any(output)",
        "mixed=node.mix_samples(np.zeros((2,16000)),48000,output,48000)",
        "assert mixed.shape==(2,16000) and np.isfinite(mixed).all() and not np.any(mixed[:,n:])",
        "print(json.dumps({'imported':True,'realHrtf':True,'spatialSamples':output.shape[1],'mixSamples':mixed.shape[1],'truePeak':node.engine.true_peak(mixed.T),'gpuCalls':0}))",
      ].join("\n"));
      const nodeRun = spawnSync(spatialPython!, [verifyScript, nodeRoot], { encoding: "utf8", timeout: 60000,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" } });
      expect(nodeRun.status, nodeRun.stderr + nodeRun.stdout).toBe(0);
      const nodeEvidence = JSON.parse(nodeRun.stdout.trim());
      expect(nodeEvidence.spatialSamples).toBe(14880);
      expect(hash(await readFile(hrtf))).toBe(hrtfBefore);
      await writeFile(path.join(root, "smoke-evidence.json"), JSON.stringify({ verified: true, syntheticAudio: true, realH3Calls: 0,
        networkCalls: 0, shots: 3, candidatesPerShot: 2, mainPayloads: 6, soundPayloads: 6,
        durations: expectedDurations, hrtfSha256: hrtfBefore, archiveBytes: archive.size, dryRun: run.stdout, node: nodeEvidence }, null, 2));
    } finally {
      if (!keep && path.dirname(root) === base) await rm(root, { recursive: true, force: true });
    }
  }, 90000);
});
