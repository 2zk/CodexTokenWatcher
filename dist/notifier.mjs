import { spawn } from "node:child_process";
const POPUP_APPLESCRIPT = 'on run argv\n  display dialog (item 1 of argv) with title (item 2 of argv) buttons {"閉じる"} default button "閉じる"\nend run';
const NOTIFICATION_APPLESCRIPT = "on run argv\n  display notification (item 1 of argv) with title (item 2 of argv)\nend run";
const defaultNotificationExecutor = (file, args) => new Promise((resolve, reject) => {
    try {
        const child = spawn(file, args, { detached: true, stdio: "ignore" });
        child.unref();
        child.once("error", reject);
        child.once("spawn", resolve);
    }
    catch (error) {
        reject(error);
    }
});
export class ThresholdNotifier {
    threshold;
    warn;
    execute;
    method;
    states = new Map();
    hasWarned = false;
    constructor(threshold, warn, execute = defaultNotificationExecutor, method = "popup") {
        this.threshold = threshold;
        this.warn = warn;
        this.execute = execute;
        this.method = method;
    }
    async observe(snapshot) {
        if (this.threshold === undefined)
            return;
        for (const limit of snapshot.limits) {
            await this.maybeNotify(limit);
        }
    }
    async maybeNotify(limit) {
        const key = `${limit.limitId}:${limit.window}`;
        const previous = this.states.get(key);
        const below = limit.remainingPercent <= this.threshold;
        const newWindow = previous !== undefined && previous.resetsAtEpochSeconds !== limit.resetsAtEpochSeconds;
        const shouldNotify = below && (previous === undefined || !previous.below || newWindow);
        this.states.set(key, { below, resetsAtEpochSeconds: limit.resetsAtEpochSeconds });
        if (!shouldNotify)
            return;
        const name = limit.limitName ?? limit.limitId;
        const message = `${name} / ${limit.window}: 残量 ${limit.remainingPercent}%（通知閾値 ${this.threshold}% 以下）`;
        try {
            await this.execute("/usr/bin/osascript", [
                "-e",
                this.method === "popup" ? POPUP_APPLESCRIPT : NOTIFICATION_APPLESCRIPT,
                message,
                "Codex 利用制限",
            ]);
        }
        catch (error) {
            if (!this.hasWarned) {
                this.hasWarned = true;
                const detail = error instanceof Error ? error.message : String(error);
                const target = this.method === "popup" ? "macOS ポップアップ" : "macOS 通知センター通知";
                this.warn(`${target}を表示できませんでした。監視は継続します: ${detail}`);
            }
        }
    }
}
