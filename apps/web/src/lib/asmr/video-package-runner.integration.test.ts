import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareVideoPackage, type VideoPackageManifest } from "./local-video-package";
import { demoProject } from "./mock-project";
import { writePcm16Wav } from "./pcm-audio";
import { createClipVideoSourceFingerprint } from "./video-plan";

const python = process.env.ASMR_VIDEO_PACKAGE_TEST_PYTHON;

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
});
