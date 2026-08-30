import type { LimitSnapshot, LimitWindow } from "./types.js";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function asEpochSeconds(value: unknown): number | null {
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

function readWindow(
  value: unknown,
  limitId: string,
  limitName: string | null,
  window: "primary" | "secondary",
): LimitWindow | null {
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
    resetsAt: resetsAtEpochSeconds === null ? null : resetDate!.toISOString(),
  };
}

function readBucket(value: unknown, fallbackLimitId: string): LimitWindow[] {
  if (!isRecord(value)) {
    return [];
  }
  const limitId = stringOrNull(value.limitId) ?? fallbackLimitId;
  const limitName = stringOrNull(value.limitName);
  return (["primary", "secondary"] as const)
    .map((window) => readWindow(value[window], limitId, limitName, window))
    .filter((window): window is LimitWindow => window !== null);
}

function readRateLimitsByLimitId(value: unknown): LimitWindow[] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([limitId, bucket]) => readBucket(bucket, limitId));
}

function readLegacyRateLimits(value: unknown): LimitWindow[] {
  if (!isRecord(value)) {
    return [];
  }
  if ("primary" in value || "secondary" in value) {
    return readBucket(value, stringOrNull(value.limitId) ?? "default");
  }
  return Object.entries(value).flatMap(([limitId, bucket]) => readBucket(bucket, limitId));
}

/** app-server の未知フィールドは無視し、表示に必要な安定フィールドだけを読む。 */
export function normalizeRateLimits(result: unknown, observedAt = new Date()): LimitSnapshot {
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
