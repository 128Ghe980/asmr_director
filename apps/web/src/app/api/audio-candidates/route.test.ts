import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AudioCandidate } from "@/lib/asmr/audio-candidate";
import { resolveCandidateManifestPath, saveAudioCandidate } from "@/lib/asmr/local-candidate-store";
import { GET } from "./route";

const runtime = vi.hoisted(() => ({ runtimeRoot: "" }));
vi.mock("@/lib/asmr/local-runtime-config", () => ({ getLocalRuntimeConfig: () => runtime }));

function request(query: string) { return new Request(`http://localhost/api/audio-candidates${query ? `?${query}` : ""}`); }
function candidate(candidateId: string, clipId: string, projectId = "current_project", status: AudioCandidate["status"] = "ready"): AudioCandidate {
  return {
    version: 1, candidateId, projectId, clipId, sourceFingerprint: "source", requestFingerprint: "request",
    asset: { assetId: candidateId, uri: `asset://clip/${candidateId}`, duration: 3 },
    wav: { sampleRate: 48000, channels: 1, bitsPerSample: 16 },
    provenance: { provider: "voxcpm2", model: "VoxCPM2", seed: 42, temperature: 1, voicePackId: "soft_zh", referenceMode: "reference_only", generationMode: "clip", parameters: {} },
    createdAt: "2026-09-08T00:00:00.000Z", qualityWarnings: [], status,
  };
}

beforeEach(async () => { runtime.runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "asmr-candidate-route-")); });

describe("GET /api/audio-candidates", () => {
  it("returns all ready candidates for the requested project with the same per-clip contract and no cache", async () => {
    const records = [
      candidate("ready_a", "voice_1"),
      { ...candidate("ready_b", "voice_2"), createdAt: "2026-09-09T00:00:00.000Z" },
      candidate("discarded", "voice_1", "current_project", "discarded"),
      candidate("foreign", "voice_1", "current_project_extra"),
    ];
    for (const record of records) await saveAudioCandidate({ config: runtime, candidate: record });
    const manifestPath = resolveCandidateManifestPath(runtime);
    const before = await readFile(manifestPath, "utf8");

    const all = await GET(request("projectId=current_project&includeDiscarded=true"));
    expect(all.status).toBe(200);
    expect(all.headers.get("cache-control")).toBe("no-store");
    expect(await all.json()).toEqual({ candidates: [records[1], records[0]] });

    const clip = await GET(request("projectId=current_project&clipId=voice_1"));
    expect(clip.status).toBe(200);
    expect(clip.headers.get("cache-control")).toBe("no-store");
    expect(await clip.json()).toEqual({ candidates: [records[0]] });
    expect(await (await GET(request("projectId=unknown_project"))).json()).toEqual({ candidates: [] });
    expect(await readFile(manifestPath, "utf8")).toBe(before);
  });

  it.each(["", "clipId=voice_1", "projectId=", "projectId=current_project&clipId=", `projectId=${"p".repeat(241)}`, `projectId=current_project&clipId=${"c".repeat(241)}`])("keeps invalid or missing ownership queries rejected: %s", async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "缺少工程或片段信息。" });
  });

  it("returns an empty project list for a new store and hides corrupt manifest details", async () => {
    const empty = await GET(request("projectId=current_project"));
    expect(empty.status).toBe(200);
    expect(empty.headers.get("cache-control")).toBe("no-store");
    expect(await empty.json()).toEqual({ candidates: [] });

    const manifestPath = resolveCandidateManifestPath(runtime);
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, "{broken-private-record");
    for (const query of ["projectId=current_project", "projectId=current_project&clipId=voice_1"]) {
      const response = await GET(request(query));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "候选记录暂时无法读取，请重试。" });
    }
    expect(await readFile(manifestPath, "utf8")).toBe("{broken-private-record");
  });
});
