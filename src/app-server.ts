import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { AppServerError } from "./types.js";

type JsonObject = Record<string, unknown>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(value: unknown): string {
  if (!isRecord(value)) return "詳細不明の JSON-RPC エラー";
  const message = typeof value.message === "string" ? value.message : "詳細不明の JSON-RPC エラー";
  const lower = message.toLowerCase();
  if (/(login|auth|api.?key|bedrock|credential)/.test(lower)) {
    return `認証または利用量取得に対応しない認証方式のため取得できません: ${message}`;
  }
  return `app-server がエラーを返しました: ${message}`;
}

export class CodexAppServer extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private nextId = 1;
  private closed = false;

  constructor(
    private readonly codexBin: string,
    private readonly timeoutMs: number,
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.child !== undefined) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const child = spawn(this.codexBin, ["app-server", "--listen", "stdio://"], {
        shell: false,
        stdio: "pipe",
      });
      this.child = child;
      child.once("spawn", () => {
        settled = true;
        resolve();
      });
      child.once("error", (error) => {
        if (!settled) {
          settled = true;
          reject(new AppServerError(`Codex app-server を起動できません。--codex-bin を確認してください: ${error.message}`, error));
        }
      });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
      child.stderr.on("data", (chunk: string) => this.consumeStderr(chunk));
      child.on("exit", (code, signal) => this.handleExit(code, signal));
    });

    try {
      await this.request("initialize", {
        clientInfo: { name: "codex-token-watcher", version: "0.1.0" },
        capabilities: {},
      });
      this.notify("initialized", {});
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async readRateLimits(): Promise<unknown> {
    return this.request("account/rateLimits/read", {});
  }

  async stop(graceMs = 1_000): Promise<void> {
    this.closed = true;
    const child = this.child;
    if (child === undefined) return;
    if (child.exitCode !== null || child.killed) {
      this.child = undefined;
      return;
    }
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const finish = () => {
        if (this.child === child) this.child = undefined;
        resolve();
      };
      let signalTimer: NodeJS.Timeout | undefined;
      const killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGTERM");
        signalTimer = setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
          finish();
        }, graceMs);
      }, graceMs);
      child.once("exit", () => {
        clearTimeout(killTimer);
        if (signalTimer !== undefined) clearTimeout(signalTimer);
        finish();
      });
    });
  }

  async forceStop(): Promise<void> {
    this.closed = true;
    const child = this.child;
    this.child = undefined;
    if (child !== undefined && child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }

  private request(method: string, params: JsonObject): Promise<unknown> {
    if (this.closed || this.child === undefined || this.child.stdin.destroyed) {
      return Promise.reject(new AppServerError("Codex app-server との接続が閉じています。"));
    }
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppServerError(`${method} が ${Math.ceil(this.timeoutMs / 1000)} 秒以内に応答しませんでした。`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${body}\n`, (error) => {
        if (error === null || error === undefined) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new AppServerError("Codex app-server への送信に失敗しました。", error));
      });
    });
  }

  private notify(method: string, params: JsonObject): void {
    if (this.child === undefined || this.child.stdin.destroyed) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline: number;
    while ((newline = this.stdoutBuffer.indexOf("\n")) >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.length === 0) continue;
      try {
        this.handleMessage(JSON.parse(line) as unknown);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.failAll(new AppServerError(`Codex app-server から不正な JSONL を受信しました: ${detail}`));
      }
    }
  }

  private consumeStderr(chunk: string): void {
    this.stderrBuffer = (this.stderrBuffer + chunk).slice(-8_192);
  }

  private handleMessage(message: unknown): void {
    if (!isRecord(message)) return;
    if (typeof message.method === "string") {
      if (message.method === "account/rateLimits/updated") this.emit("rateLimitsUpdated");
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (pending === undefined) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if ("error" in message) {
      pending.reject(new AppServerError(errorMessage(message.error)));
    } else {
      pending.resolve(message.result);
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const suffix = this.stderrBuffer.trim() ? ` stderr: ${this.stderrBuffer.trim()}` : "";
    if (!this.closed) {
      this.failAll(new AppServerError(`Codex app-server が途中で終了しました（code: ${code ?? "なし"}, signal: ${signal ?? "なし"}）。${suffix}`));
    }
  }

  private failAll(error: AppServerError): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
