function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
/** statusLine JSON の1期間エントリを読む。必須フィールドが欠ければ null を返す。 */
function readPeriod(raw, window, windowDurationMins) {
    if (!isRecord(raw)) {
        return null;
    }
    const usedPct = numberOrNull(raw.used_percentage);
    if (usedPct === null) {
        return null;
    }
    const resetsAtRaw = numberOrNull(raw.resets_at);
    const resetDate = resetsAtRaw === null ? null : new Date(Math.floor(resetsAtRaw) * 1000);
    const resetsAtEpochSeconds = resetDate !== null && !Number.isNaN(resetDate.getTime())
        ? Math.floor(resetsAtRaw)
        : null;
    return {
        limitId: "claude",
        limitName: "Claude",
        window,
        windowDurationMins,
        usedPercent: clamp(usedPct, 0, 100),
        remainingPercent: clamp(100 - usedPct, 0, 100),
        resetsAtEpochSeconds,
        resetsAt: resetsAtEpochSeconds !== null
            ? new Date(resetsAtEpochSeconds * 1000).toISOString()
            : null,
    };
}
/**
 * Claude Code statusLine JSON を内部 snapshot 形式へ正規化する。
 * 存在する期間だけを limits に含め、欠落フィールドは推測しない。
 */
export function normalizeStatusLine(json, receivedAt = new Date()) {
    const record = isRecord(json) ? json : {};
    const rl = isRecord(record.rate_limits) ? record.rate_limits : {};
    const limits = [];
    const fiveHour = readPeriod(rl.five_hour, "five_hour", 300);
    if (fiveHour !== null) {
        limits.push(fiveHour);
    }
    const sevenDay = readPeriod(rl.seven_day, "seven_day", 10080);
    if (sevenDay !== null) {
        limits.push(sevenDay);
    }
    return {
        schemaVersion: 1,
        receivedAt: Math.floor(receivedAt.getTime() / 1000),
        observedAt: receivedAt.toISOString(),
        limits,
    };
}
/**
 * キャッシュ済み snapshot が stale かを判定する。
 * 受信から 300 秒以上経過、またはいずれかの期間のリセット時刻を過ぎていれば stale。
 */
export function isStale(snapshot, nowEpochSeconds = Math.floor(Date.now() / 1000)) {
    if (!Number.isFinite(snapshot.receivedAt) || !Array.isArray(snapshot.limits)) {
        return true;
    }
    if (nowEpochSeconds - snapshot.receivedAt >= 300) {
        return true;
    }
    for (const limit of snapshot.limits) {
        if (limit.resetsAtEpochSeconds !== null && nowEpochSeconds >= limit.resetsAtEpochSeconds) {
            return true;
        }
    }
    return false;
}
