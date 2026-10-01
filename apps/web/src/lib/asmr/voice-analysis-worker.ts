import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { VoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";
import type { VoiceRecognition } from "./voice-recognition";

export class VoiceGroupAnalysisError extends Error {
  constructor(message: string, public readonly statusCode = 502, public readonly diagnosticCode?: string, public readonly recognition?: VoiceRecognition) {
    super(message);
    this.name = "VoiceGroupAnalysisError";
  }
}

export type VoiceAnalysisWorkerChild = {
  pid?: number;
  stdin: Writable | null;
  stdout: Readable | null;
  once(event: "error", callback: (error: Error) => void): unknown;
  once(event: "close", callback: (code: number | null) => void): unknown;
  kill(signal: NodeJS.Signals): unknown;
};

export type VoiceAnalysisWorkerSpawn = (command: string, args: readonly string[], options: {
  cwd: string; shell: false; windowsHide: true;
  stdio: ["pipe", "pipe", "ignore"]; env: NodeJS.ProcessEnv;
}) => VoiceAnalysisWorkerChild;

const unavailable = () => new VoiceGroupAnalysisError("本机长文语音检查尚未就绪，请检查语音分析环境。", 503);
type Pending = { requestPath: string; finish: (error?: VoiceGroupAnalysisError) => void };

/** One CPU model per candidate; requests are serial even when TTS runs ahead. */
export class VoiceAnalysisWorker {
  private readonly child: VoiceAnalysisWorkerChild;
  private readonly exited: Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private active?: Pending;
  private stopped?: VoiceGroupAnalysisError;
  private closing?: Promise<void>;
  private buffer = "";
  private closed = false;
  private confirmed = false;

  constructor(options: {
    pythonPath: string; helper: string; modelPath: string; cwd: string;
    runtimeSession: VoxCpm2RuntimeSession; spawnImpl?: VoiceAnalysisWorkerSpawn;
    timeoutMs: number; exitWaitMs: number;
  }) {
    this.options = options;
    try {
      this.child = (options.spawnImpl ?? spawn)(options.pythonPath, [options.helper, "--worker", "--model", options.modelPath], {
        cwd: options.cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
        env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" },
      });
    } catch { throw unavailable(); }
    options.runtimeSession.processStarted(this.child.pid);
    this.exited = new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this.confirmed = true;
        this.closed = true;
        this.stopped ??= unavailable();
        options.runtimeSession.processExited(this.child.pid);
        this.active?.finish(this.stopped);
        resolve();
      };
      this.child.once("close", finish);
      this.child.once("error", () => {
        if (!this.child.pid) finish(); else this.stop(unavailable());
      });
    });
    this.child.stdin?.on("error", () => this.stop(unavailable()));
    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 65_536) { this.stop(unavailable()); return; }
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        try {
          const result: unknown = JSON.parse(line);
          if (!result || typeof result !== "object" || !("requestPath" in result) || !("code" in result)
              || result.requestPath !== this.active?.requestPath || ![0, 2].includes(result.code as number)) {
            this.stop(unavailable()); return;
          }
          this.active?.finish(result.code === 0 ? undefined : unavailable());
        } catch { this.stop(unavailable()); return; }
      }
    });
  }

  private readonly options: { timeoutMs: number; exitWaitMs: number };

  /** False only if an unconfirmed live child could still touch its request files. */
  get exitConfirmed() { return this.confirmed; }

  private stop(error: VoiceGroupAnalysisError) {
    if (this.stopped) return;
    this.stopped = error;
    try { this.child.kill("SIGKILL"); } catch { /* Keep its reservation until actual exit. */ }
    const pending = this.active;
    if (!pending) return;
    const timer = setTimeout(() => pending.finish(new VoiceGroupAnalysisError("语音检查进程尚未退出，请稍后再试。", 503)), this.options.exitWaitMs);
    void this.exited.then(() => clearTimeout(timer));
  }

  run(requestPath: string, signal?: AbortSignal): Promise<void> {
    const task = this.queue.then(() => new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new VoiceGroupAnalysisError("已取消生成。", 499)); return; }
      if (this.stopped || this.closed || this.closing || !this.child.stdin || !this.child.stdout) { reject(this.stopped ?? unavailable()); return; }
      let finished = false;
      const finish = (error?: VoiceGroupAnalysisError) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.active = undefined;
        if (error) reject(error); else resolve();
      };
      const abort = () => this.stop(new VoiceGroupAnalysisError("已取消生成。", 499));
      const timer = setTimeout(() => this.stop(new VoiceGroupAnalysisError("语音检查超时，请稍后重试。", 504)), this.options.timeoutMs);
      this.active = { requestPath, finish };
      signal?.addEventListener("abort", abort, { once: true });
      try { this.child.stdin.write(JSON.stringify({ requestPath }) + "\n"); }
      catch { this.stop(unavailable()); }
      if (signal?.aborted) abort();
    }));
    this.queue = task.catch(() => {});
    return task;
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      if (this.active) this.stop(new VoiceGroupAnalysisError("已取消生成。", 499));
      else { try { this.child.stdin?.end(); } catch { this.stop(unavailable()); } }
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([this.exited, new Promise<void>((resolve) => {
        timer = setTimeout(() => { this.stop(unavailable()); resolve(); }, this.options.exitWaitMs);
      })]);
      clearTimeout(timer);
      if (!this.confirmed) {
        await Promise.race([this.exited, new Promise<void>((resolve) => { timer = setTimeout(resolve, this.options.exitWaitMs); })]);
        clearTimeout(timer);
      }
    })();
    return this.closing;
  }
}
