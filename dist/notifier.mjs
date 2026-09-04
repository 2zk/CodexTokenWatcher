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
    notifyEvery;
    states = new Map();
    hasWarned = false;
    constructor(threshold, warn, execute = defaultNotificationExecutor, method = "popup", notifyEvery = undefined) {
        this.threshold = threshold;
        this.warn = warn;
        this.execute = execute;
        this.method = method;
        this.notifyEvery = notifyEvery;
    }
    async observe(snapshot) {
        if (this.threshold === undefined && this.notifyEvery === undefined)
            return;
        for (const limit of snapshot.limits) {
            await this.maybeNotify(limit);
        }
    }
    async maybeNotify(limit) {
        const key = `${limit.limitId}:${limit.window}`;
        const previous = this.states.get(key);
        const reachedThresholds = this.reachedThresholds(limit.remainingPercent);
        const newWindow = previous !== undefined && previous.resetsAtEpochSeconds !== limit.resetsAtEpochSeconds;
        const newlyReached = previous === undefined
            ? this.threshold !== undefined && reachedThresholds.includes(this.threshold)
                ? [this.threshold]
                : []
            : newWindow
                ? reachedThresholds
                : reachedThresholds.filter((threshold) => !previous.reachedThresholds.includes(threshold));
        this.states.set(key, { reachedThresholds, resetsAtEpochSeconds: limit.resetsAtEpochSeconds });
        const notificationThreshold = newlyReached.length === 0 ? undefined : Math.min(...newlyReached);
        if (notificationThreshold === undefined)
            return;
        const name = limit.limitName ?? limit.limitId;
        const description = notificationThreshold === this.threshold
            ? `通知閾値 ${notificationThreshold}% 以下`
            : `通知段階 ${notificationThreshold}% 以下`;
        const message = `${name} / ${limit.window}: 残量 ${limit.remainingPercent}%（${description}）`;
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
    reachedThresholds(remainingPercent) {
        const thresholds = new Set();
        if (this.threshold !== undefined) {
            thresholds.add(this.threshold);
        }
        if (this.notifyEvery !== undefined) {
            for (let threshold = 100 - this.notifyEvery; threshold > 0; threshold -= this.notifyEvery) {
                thresholds.add(threshold);
            }
        }
        return [...thresholds].filter((threshold) => remainingPercent <= threshold);
    }
}
