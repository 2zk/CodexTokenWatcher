import { CliUsageError, type CliOptions } from "./types.js";

const HELP = `使い方: codex-token-watcher [options]

オプション:
  --watch                    Ctrl+C まで定期的に取得する
  --interval <seconds>       取得間隔（既定: 180、60以上の整数）
  --json                     one-shot は JSON、watch は NDJSON で出力する
  --filter <text>            表示名と期間を部分一致で絞り込む（大文字・小文字を区別しない）
  --notify-below <percent>   残量が指定値以下なら macOS 通知（0〜100）
  --codex-bin <path>         Codex 実行ファイル（既定: codex）
  --timeout <seconds>        RPC タイムアウト（既定: 15、正整数）
  --help                     このヘルプを表示する
  --version                  バージョンを表示する`;

export function helpText(): string {
  return HELP;
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new CliUsageError(`${option} には値が必要です。`);
  }
  return value;
}

function integer(value: string, option: string, minimum: number): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new CliUsageError(`${option} は整数で指定してください。`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new CliUsageError(`${option} は ${minimum} 以上の整数で指定してください。`);
  }
  return parsed;
}

export type ParseResult = { kind: "run"; options: CliOptions } | { kind: "help" } | { kind: "version" };

export function parseArgs(args: string[]): ParseResult {
  const options: CliOptions = {
    watch: false,
    intervalSeconds: 180,
    json: false,
    notifyBelow: undefined,
    codexBin: "codex",
    timeoutSeconds: 15,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--help":
        return { kind: "help" };
      case "--version":
        return { kind: "version" };
      case "--watch":
        options.watch = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--filter":
        options.filter = requiredValue(args, index, arg);
        index += 1;
        break;
      case "--interval":
        options.intervalSeconds = integer(requiredValue(args, index, arg), arg, 60);
        index += 1;
        break;
      case "--timeout":
        options.timeoutSeconds = integer(requiredValue(args, index, arg), arg, 1);
        index += 1;
        break;
      case "--notify-below": {
        const value = requiredValue(args, index, arg);
        if (!/^(?:0|[1-9][0-9]?|100)$/.test(value)) {
          throw new CliUsageError(`${arg} は 0〜100 の整数で指定してください。`);
        }
        options.notifyBelow = Number(value);
        index += 1;
        break;
      }
      case "--codex-bin":
        options.codexBin = requiredValue(args, index, arg);
        index += 1;
        break;
      default:
        throw new CliUsageError(`不明なオプションです: ${arg}`);
    }
  }
  return { kind: "run", options };
}
