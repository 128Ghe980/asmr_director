import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { VoiceAnalysisWorker } from "./voice-analysis-worker";

function fixture(options: { timeoutMs?: number; exitWaitMs?: number } = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), { pid: 2468, stdin, stdout,
    kill: vi.fn(() => { queueMicrotask(() => child.emit("close", null)); return true; }) });
  const session = { runtimeRoot: ".", processStarted: vi.fn(), processExited: vi.fn() };
  const spawnImpl = vi.fn(() => child);
  const worker = new VoiceAnalysisWorker({ pythonPath: "python", modelPath: "model", helper: "helper.py", cwd: ".",
    runtimeSession: session, spawnImpl, timeoutMs: options.timeoutMs ?? 1000, exitWaitMs: options.exitWaitMs ?? 20 });
  const requests: string[] = [];
  stdin.on("data", (chunk: Buffer) => requests.push(JSON.parse(chunk.toString()).requestPath));
  stdin.on("end", () => child.emit("close", 0));
  const respond = (requestPath: string) => stdout.write(JSON.stringify({ requestPath, code: 0 }) + "\n");
  return { worker, child, requests, respond, session, spawnImpl };
}

describe("persistent voice analysis worker", () => {
  it("reuses a single child, serializes requests and closes it after the candidate", async () => {
    const { worker, requests, respond, session, spawnImpl } = fixture();
    const first = worker.run("first.json");
    const second = worker.run("second.json");
    await new Promise((resolve) => setImmediate(resolve));
    expect(requests).toEqual(["first.json"]);
    respond("first.json");
    await first;
    await new Promise((resolve) => setImmediate(resolve));
    expect(requests).toEqual(["first.json", "second.json"]);
    respond("second.json");
    await second;
    expect(spawnImpl).toHaveBeenCalledOnce();
    expect(session.processStarted).toHaveBeenCalledWith(2468);
    expect(session.processExited).not.toHaveBeenCalled();
    await worker.close();
    expect(worker.exitConfirmed).toBe(true);
    expect(session.processExited).toHaveBeenCalledExactlyOnceWith(2468);
  });

  it("cancellation waits for actual exit before allowing scratch cleanup", async () => {
    const { worker, child, session } = fixture({ exitWaitMs: 1000 });
    child.kill.mockImplementation(() => true);
    const controller = new AbortController();
    const running = worker.run("first.json", controller.signal);
    const assertion = expect(running).rejects.toMatchObject({ statusCode: 499 });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(worker.exitConfirmed).toBe(false);
    expect(session.processExited).not.toHaveBeenCalled();
    child.emit("close", null);
    await assertion;
    expect(worker.exitConfirmed).toBe(true);
    await worker.close();
  });

  it("retains the process reservation when a timed-out child has not confirmed exit", async () => {
    const { worker, child, session } = fixture({ timeoutMs: 5, exitWaitMs: 5 });
    child.kill.mockImplementation(() => false);
    child.stdin.removeAllListeners("end");
    await expect(worker.run("first.json")).rejects.toMatchObject({ statusCode: 503 });
    expect(worker.exitConfirmed).toBe(false);
    expect(session.processExited).not.toHaveBeenCalled();
    await worker.close();
    expect(session.processExited).not.toHaveBeenCalled();
    child.emit("close", null);
    expect(session.processExited).toHaveBeenCalledWith(2468);
  });

  it("does not mistake another request's completion for the active group", async () => {
    const { worker, respond, child } = fixture();
    const running = worker.run("first.json");
    const assertion = expect(running).rejects.toMatchObject({ statusCode: 503 });
    await new Promise((resolve) => setImmediate(resolve));
    respond("unrelated.json");
    await assertion;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await worker.close();
  });
});
