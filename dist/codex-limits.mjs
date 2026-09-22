function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function stringOrNull(value) {
    return typeof value === "string" ? value : null;
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
function asEpochSeconds(value) {
    const numeric = numberOrNull(value);
    if (numeric !== null) {
        return numeric;
    }
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
    }
    return null;
}
function readWindow(value, limitId, limitName, window) {
    if (!isRecord(value)) {
        return null;
    }
    const usedPercent = numberOrNull(value.usedPercent);
    if (usedPercent === null) {
        return null;
    }
    const resetsAtCandidate = asEpochSeconds(value.resetsAt);
    const resetDate = resetsAtCandidate === null ? null : new Date(resetsAtCandidate * 1000);
    const resetsAtEpochSeconds = resetDate === null || Number.isNaN(resetDate.getTime())
        ? null
        : resetsAtCandidate;
    return {
        limitId,
        limitName,
        window,
        windowDurationMins: numberOrNull(value.windowDurationMins),
        usedPercent: clamp(usedPercent, 0, 100),
        remainingPercent: clamp(100 - usedPercent, 0, 100),
        resetsAtEpochSeconds,
        resetsAt: resetsAtEpochSeconds === null ? null : resetDate.toISOString(),
    };
}
function readBucket(value, fallbackLimitId) {
    if (!isRecord(value)) {
        return [];
    }
    const limitId = stringOrNull(value.limitId) ?? fallbackLimitId;
    const limitName = stringOrNull(value.limitName);
    return ["primary", "secondary"]
        .map((window) => readWindow(value[window], limitId, limitName, window))
        .filter((window) => window !== null);
}
function readRateLimitsByLimitId(value) {
    if (!isRecord(value)) {
        return [];
    }
    return Object.entries(value).flatMap(([limitId, bucket]) => readBucket(bucket, limitId));
}
function readLegacyRateLimits(value) {
    if (!isRecord(value)) {
        return [];
    }
    if ("primary" in value || "secondary" in value) {
        return readBucket(value, stringOrNull(value.limitId) ?? "default");
    }
    return Object.entries(value).flatMap(([limitId, bucket]) => readBucket(bucket, limitId));
}
/** app-server の未知フィールドは無視し、表示に必要な安定フィールドだけを読む。 */
export function normalizeRateLimits(result, observedAt = new Date()) {
    const record = isRecord(result) ? result : {};
    const limits = "rateLimitsByLimitId" in record
        ? readRateLimitsByLimitId(record.rateLimitsByLimitId)
        : readLegacyRateLimits(record.rateLimits);
    return {
        schemaVersion: 1,
        observedAt: observedAt.toISOString(),
        limits,
    };
}
