import { spawn } from "node:child_process";
import type { LimitSnapshot, LimitWindow, NotifyMethod } from "./types.js";

const POPUP_APPLESCRIPT =
  'on run argv\n  display dialog (item 1 of argv) with title (item 2 of argv) buttons {"閉じる"} default button "閉じる"\nend run';
const NOTIFICATION_APPLESCRIPT =
  "on run argv\n  display notification (item 1 of argv) with title (item 2 of argv)\nend run";

export type NotificationExecutor = (file: string, args: string[]) => Promise<unknown>;

const defaultNotificationExecutor: NotificationExecutor = (file, args) =>
  new Promise<void>((resolve, reject) => {
    try {
      const child = spawn(file, args, { detached: true, stdio: "ignore" });
      child.unref();
      child.once("error", reject);
      child.once("spawn", resolve);
    } catch (error) {
      reject(error);
    }
  });

interface NotificationState {
  below: boolean;
  resetsAtEpochSeconds: number | null;
}

export class ThresholdNotifier {
  private readonly states = new Map<string, NotificationState>();
  private hasWarned = false;

  constructor(
    private readonly threshold: number | undefined,
    private readonly warn: (message: string) => void,
    private readonly execute: NotificationExecutor = defaultNotificationExecutor,
    private readonly method: NotifyMethod = "popup",
  ) {}

  async observe(snapshot: LimitSnapshot): Promise<void> {
    if (this.threshold === undefined) return;
    for (const limit of snapshot.limits) {
      await this.maybeNotify(limit);
    }
  }

  private async maybeNotify(limit: LimitWindow): Promise<void> {
    const key = `${limit.limitId}:${limit.window}`;
    const previous = this.states.get(key);
    const below = limit.remainingPercent <= this.threshold!;
    const newWindow = previous !== undefined && previous.resetsAtEpochSeconds !== limit.resetsAtEpochSeconds;
    const shouldNotify = below && (previous === undefined || !previous.below || newWindow);
    this.states.set(key, { below, resetsAtEpochSeconds: limit.resetsAtEpochSeconds });
    if (!shouldNotify) return;

    const name = limit.limitName ?? limit.limitId;
    const message = `${name} / ${limit.window}: 残量 ${limit.remainingPercent}%（通知閾値 ${this.threshold}% 以下）`;
    try {
      await this.execute("/usr/bin/osascript", [
        "-e",
        this.method === "popup" ? POPUP_APPLESCRIPT : NOTIFICATION_APPLESCRIPT,
        message,
        "Codex 利用制限",
      ]);
    } catch (error) {
      if (!this.hasWarned) {
        this.hasWarned = true;
        const detail = error instanceof Error ? error.message : String(error);
        const target = this.method === "popup" ? "macOS ポップアップ" : "macOS 通知センター通知";
        this.warn(`${target}を表示できませんでした。監視は継続します: ${detail}`);
      }
    }
  }
}
