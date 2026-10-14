import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoProject } from "@/lib/asmr/mock-project";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import { VoiceParagraphConfirmationError } from "@/lib/asmr/voice-paragraph-confirmation";
import { POST } from "./route";

const hooks = vi.hoisted(() => ({ confirm: vi.fn(), config: { runtimeRoot: "isolated-runtime" } }));
vi.mock("@/lib/asmr/local-runtime-config", () => ({ getLocalRuntimeConfig: () => hooks.config }));
vi.mock("@/lib/asmr/voice-paragraph-confirmation", async (original) => ({ ...await original<typeof import("@/lib/asmr/voice-paragraph-confirmation")>(), confirmVoiceParagraphText: hooks.confirm }));
const context = { params: Promise.resolve({ candidateId: "candidate_fixture_1" }) };
const body = { project: demoProject, clipId: "voice_001", confirmedClipIds: ["voice_001"] };
const request = (value: unknown, signal?: AbortSignal) => new Request("http://localhost/api/audio-candidates/candidate_fixture_1/confirm-text", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), signal,
});
beforeEach(() => { hooks.confirm.mockReset(); hooks.confirm.mockResolvedValue({ candidate: makeVoiceCandidateFixture(), candidates: [makeVoiceCandidateFixture()] }); });

describe("POST paragraph listening confirmation", () => {
  it("passes only current source and explicit confirmed sentence IDs to the authoritative service", async () => {
    const input = request(body), response = await POST(input, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(hooks.confirm).toHaveBeenCalledWith({ ...body, candidateId: "candidate_fixture_1", config: hooks.config, signal: input.signal });
  });
  it.each([{}, { ...body, confirmedClipIds: [] }, { ...body, confirmedClipIds: ["../bad"] },
    { ...body, manualTextConfirmation: { confirmedAt: "forged" } }, { ...body, project: { project_id: "invalid" } }])("rejects invalid or client-forged receipt %j", async (value) => {
    expect((await POST(request(value), context)).status).toBe(400);
    expect(hooks.confirm).not.toHaveBeenCalled();
  });
  it("rejects unsafe path IDs, malformed JSON and canceled requests", async () => {
    expect((await POST(request(body), { params: Promise.resolve({ candidateId: "../private" }) })).status).toBe(400);
    expect((await POST(new Request("http://localhost/confirm", { method: "POST", body: "{bad" }), context)).status).toBe(400);
    const controller = new AbortController(); controller.abort();
    expect((await POST(request(body, controller.signal), context)).status).toBe(499);
    expect(hooks.confirm).not.toHaveBeenCalled();
  });
  it.each([400, 404, 409, 422])("retains safe %s rejection and hides unexpected server paths", async (statusCode) => {
    hooks.confirm.mockRejectedValueOnce(new VoiceParagraphConfirmationError("确认未保存", statusCode));
    const response = await POST(request(body), context);
    expect(response.status).toBe(statusCode);
    expect(await response.json()).toEqual({ error: "确认未保存" });
  });
  it("does not disclose filesystem details on unexpected failures", async () => {
    hooks.confirm.mockRejectedValueOnce(new Error("private I:/AI/original.wav"));
    const response = await POST(request(body), context);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("I:/AI");
  });
});
