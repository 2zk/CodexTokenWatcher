import { lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";

/** テスト用のキャッシュパスオーバーライド。null なら自動決定。 */
let _cachePathOverride = null;

/** テストからキャッシュパスを上書きする。null を渡すとリセット。 */
export function _setCachePath(path) {
    _cachePathOverride = path;
}

function defaultCacheDir() {
    // POSIX uid が取れる環境ではそれを、なければ USER 環境変数を使う
    const uid = typeof process.getuid === "function"
        ? String(process.getuid())
        : (process.env.USER ?? "default");
    return join(tmpdir(), `claude-token-watcher-${uid}`);
}

export function cachePath() {
    if (_cachePathOverride !== null) {
        return _cachePathOverride;
    }
    return join(defaultCacheDir(), "cache.json");
}

function ensureDir(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (_cachePathOverride === null) {
        const stats = lstatSync(dir);
        const ownerMatches = typeof process.getuid !== "function" || stats.uid === process.getuid();
        if (!stats.isDirectory() || !ownerMatches || (stats.mode & 0o077) !== 0) {
            throw new Error("キャッシュディレクトリがユーザー専用ではありません。");
        }
    }
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLimit(value) {
    if (!isRecord(value) || value.limitId !== "claude" || value.limitName !== "Claude") {
        return null;
    }
    const durations = { five_hour: 300, seven_day: 10_080 };
    const duration = durations[value.window];
    if (duration === undefined || value.windowDurationMins !== duration ||
        typeof value.usedPercent !== "number" || !Number.isFinite(value.usedPercent) ||
        value.usedPercent < 0 || value.usedPercent > 100) {
        return null;
    }
    const reset = value.resetsAtEpochSeconds;
    if (reset !== null && (!Number.isSafeInteger(reset) || Number.isNaN(new Date(reset * 1000).getTime()))) {
        return null;
    }
    return {
        limitId: "claude",
        limitName: "Claude",
        window: value.window,
        windowDurationMins: duration,
        usedPercent: value.usedPercent,
        remainingPercent: Math.min(100, Math.max(0, 100 - value.usedPercent)),
        resetsAtEpochSeconds: reset,
        resetsAt: reset === null ? null : new Date(reset * 1000).toISOString(),
    };
}

/**
 * キャッシュから snapshot を読む。存在しないか不正な場合は null を返す。
 * receivedAt が数値でない場合も null として扱う。
 */
export function readCache() {
    try {
        const file = cachePath();
        if (_cachePathOverride === null) {
            const dirStats = lstatSync(dirname(file));
            const fileStats = lstatSync(file);
            const ownerMatches = typeof process.getuid !== "function" ||
                (dirStats.uid === process.getuid() && fileStats.uid === process.getuid());
            if (!dirStats.isDirectory() || !fileStats.isFile() || !ownerMatches ||
                (dirStats.mode & 0o077) !== 0 || (fileStats.mode & 0o077) !== 0) {
                return null;
            }
        }
        const raw = readFileSync(file, "utf8");
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed) || parsed.schemaVersion !== 1 ||
            !Number.isSafeInteger(parsed.receivedAt) ||
            typeof parsed.observedAt !== "string" ||
            Number.isNaN(Date.parse(parsed.observedAt)) ||
            !Array.isArray(parsed.limits)) {
            return null;
        }
        const limits = parsed.limits.map(readLimit);
        if (limits.some((limit) => limit === null)) {
            return null;
        }
        return {
            schemaVersion: 1,
            receivedAt: parsed.receivedAt,
            observedAt: parsed.observedAt,
            limits,
        };
    } catch {
        return null;
    }
}

/**
 * snapshot をキャッシュへ原子的に書き込む。
 * トークン、認証情報、元 JSON 全体など不要なフィールドは保存しない。
 */
export function writeCache(snapshot) {
    const file = cachePath();
    const dir = dirname(file);
    ensureDir(dir);
    const tmpFile = join(dir, `cache-${randomBytes(4).toString("hex")}.tmp`);
    const data = JSON.stringify({
        schemaVersion: snapshot.schemaVersion,
        receivedAt: snapshot.receivedAt,
        observedAt: snapshot.observedAt,
        limits: snapshot.limits.map((l) => ({
            limitId: l.limitId,
            limitName: l.limitName,
            window: l.window,
            windowDurationMins: l.windowDurationMins,
            usedPercent: l.usedPercent,
            remainingPercent: l.remainingPercent,
            resetsAtEpochSeconds: l.resetsAtEpochSeconds,
            resetsAt: l.resetsAt,
        })),
    });
    writeFileSync(tmpFile, data, { mode: 0o600 });
    renameSync(tmpFile, file);
}
