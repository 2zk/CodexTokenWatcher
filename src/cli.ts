#!/usr/bin/env node

import { parseArgs, helpText } from "./args.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CodexAppServer } from "./app-server.js";
import { formatJson, formatSnapshot } from "./format.js";
import { normalizeRateLimits } from "./limits.js";
import { ThresholdNotifier } from "./notifier.js";
import { AppServerError, CliUsageError, type CliOptions, type LimitSnapshot } from "./types.js";

const VERSION = "0.1.0";
const UPDATE_DEBOUNCE_MS = 500;

function writeResult(snapshot: LimitSnapshot, options: CliOptions): void {
  if (options.json) {
    process.stdout.write(`${formatJson(snapshot)}\n`);
    return;
  }
  if (options.watch && process.stdout.isTTY) {
    process.stdout.write("\x1B[2J\x1B[H");
  }
  process.stdout.write(`${formatSnapshot(snapshot)}\n`);
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`エラー: ${message}\n`);
}

async function runWatch(
  server: CodexAppServer,
  options: CliOptions,
  notifier: ThresholdNotifier,
  shouldStop: () => boolean,
  setWake: (wake: (() => void) | undefined) => void,
): Promise<void> {
  let updatePending = false;
  let wakeCurrentWait: (() => void) | undefined;

  const onUpdated = () => {
    updatePending = true;
    wakeCurrentWait?.();
  };
  server.on("rateLimitsUpdated", onUpdated);

  try {
    while (!shouldStop()) {
      const result = await server.readRateLimits();
      const snapshot = normalizeRateLimits(result);
      writeResult(snapshot, options);
      await notifier.observe(snapshot);
      if (shouldStop()) break;

      await new Promise<void>((resolve) => {
        let done = false;
        let timer: NodeJS.Timeout | undefined;
        const finish = () => {
          if (done) return;
          done = true;
          if (timer !== undefined) clearTimeout(timer);
          wakeCurrentWait = undefined;
          setWake(undefined);
          resolve();
        };
        wakeCurrentWait = () => {
          if (!updatePending) return;
          updatePending = false;
          if (timer !== undefined) clearTimeout(timer);
          timer = setTimeout(finish, UPDATE_DEBOUNCE_MS);
        };
        setWake(finish);
        if (updatePending) {
          wakeCurrentWait();
        } else {
          timer = setTimeout(finish, options.intervalSeconds * 1_000);
        }
      });
    }
  } finally {
    server.off("rateLimitsUpdated", onUpdated);
  }
}

export async function runCli(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    if (error instanceof CliUsageError) {
      reportError(error);
      process.stderr.write("--help で使い方を確認できます。\n");
      return error.exitCode;
    }
    throw error;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }
  if (parsed.kind === "version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const options = parsed.options;
  const server = new CodexAppServer(options.codexBin, options.timeoutSeconds * 1_000);
  const notifier = new ThresholdNotifier(options.notifyBelow, (message) => process.stderr.write(`警告: ${message}\n`));
  let stopping = false;
  let exitCode = 0;
  let wake: (() => void) | undefined;
  let receivedSignal = false;

  const onSignal = (signal: NodeJS.Signals) => {
    if (receivedSignal) {
      process.stderr.write(`${signal} を再度受信したため、強制終了します。\n`);
      void server.forceStop();
      process.exit(130);
    }
    receivedSignal = true;
    stopping = true;
    wake?.();
    process.stderr.write(`${signal} を受信したため終了処理を開始します。\n`);
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    await server.start();
    if (options.watch) {
      await runWatch(server, options, notifier, () => stopping, (nextWake) => {
        wake = nextWake;
      });
    } else {
      const result = await server.readRateLimits();
      const snapshot = normalizeRateLimits(result);
      writeResult(snapshot, options);
      await notifier.observe(snapshot);
    }
  } catch (error) {
    if (!stopping) {
      reportError(error instanceof AppServerError ? error : new AppServerError("予期しないエラーが発生しました。", error));
      exitCode = 1;
    }
  } finally {
    await server.stop();
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
  return receivedSignal ? 130 : exitCode;
}

const invokedPath = process.argv[1] === undefined ? undefined : realpathSync(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error: unknown) => {
    reportError(error);
    process.exitCode = 1;
  });
}
