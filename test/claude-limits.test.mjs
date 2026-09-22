import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStatusLine, isStale } from "../dist/claude-limits.mjs";
import {
    fullStatusLine,
    fiveHourOnly,
    noRateLimits,
    nullPeriods,
    missingUsedPercentage,
    outOfRange,
} from "./fixtures/statusline-samples.mjs";

// --- normalizeStatusLine ---

test("全期間が揃った statusLine を正規化する", () => {
    const receivedAt = new Date(1720000000000);
    const snapshot = normalizeStatusLine(fullStatusLine, receivedAt);

    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.receivedAt, 1720000000);
    assert.equal(snapshot.observedAt, receivedAt.toISOString());
    assert.equal(snapshot.limits.length, 2);

    const fiveHour = snapshot.limits[0];
    assert.equal(fiveHour.window, "five_hour");
    assert.equal(fiveHour.windowDurationMins, 300);
    assert.equal(fiveHour.limitId, "claude");
    assert.equal(fiveHour.limitName, "Claude");
    assert.equal(fiveHour.usedPercent, 45.5);
    assert.equal(fiveHour.remainingPercent, 54.5);
    assert.equal(fiveHour.resetsAtEpochSeconds, 1720018000);
    assert.equal(fiveHour.resetsAt, new Date(1720018000 * 1000).toISOString());

    const sevenDay = snapshot.limits[1];
    assert.equal(sevenDay.window, "seven_day");
    assert.equal(sevenDay.windowDurationMins, 10080);
    assert.equal(sevenDay.usedPercent, 23.0);
    assert.equal(sevenDay.remainingPercent, 77.0);
    assert.equal(sevenDay.resetsAtEpochSeconds, 1720500000);
});

test("five_hour のみの statusLine を正規化する", () => {
    const snapshot = normalizeStatusLine(fiveHourOnly);
    assert.equal(snapshot.limits.length, 1);
    assert.equal(snapshot.limits[0].window, "five_hour");
});

test("rate_limits が欠落していれば limits は空", () => {
    const snapshot = normalizeStatusLine(noRateLimits);
    assert.equal(snapshot.limits.length, 0);
    assert.equal(snapshot.schemaVersion, 1);
    assert.ok(typeof snapshot.receivedAt === "number");
});

test("null の期間はスキップされる", () => {
    const snapshot = normalizeStatusLine(nullPeriods);
    assert.equal(snapshot.limits.length, 0);
});

test("used_percentage が欠落した期間はスキップされる", () => {
    const snapshot = normalizeStatusLine(missingUsedPercentage);
    assert.equal(snapshot.limits.length, 1);
    assert.equal(snapshot.limits[0].window, "seven_day");
});

test("使用率を 0〜100 にクランプする", () => {
    const snapshot = normalizeStatusLine(outOfRange);
    const fiveHour = snapshot.limits.find((l) => l.window === "five_hour");
    const sevenDay = snapshot.limits.find((l) => l.window === "seven_day");

    assert.ok(fiveHour);
    assert.equal(fiveHour.usedPercent, 100);
    assert.equal(fiveHour.remainingPercent, 0);

    assert.ok(sevenDay);
    assert.equal(sevenDay.usedPercent, 0);
    assert.equal(sevenDay.remainingPercent, 100);
});

test("resets_at が null/未定義の場合は resetsAtEpochSeconds と resetsAt が null", () => {
    const snapshot = normalizeStatusLine({
        rate_limits: {
            five_hour: { used_percentage: 50 },
        },
    });
    assert.equal(snapshot.limits.length, 1);
    assert.equal(snapshot.limits[0].resetsAtEpochSeconds, null);
    assert.equal(snapshot.limits[0].resetsAt, null);
});

test("resets_at が Date の範囲外でも正規化を中断しない", () => {
    const snapshot = normalizeStatusLine({
        rate_limits: { five_hour: { used_percentage: 50, resets_at: 1e20 } },
    });
    assert.equal(snapshot.limits.length, 1);
    assert.equal(snapshot.limits[0].resetsAtEpochSeconds, null);
    assert.equal(snapshot.limits[0].resetsAt, null);
});

test("null / 非オブジェクトの入力は空 limits を返す", () => {
    assert.equal(normalizeStatusLine(null).limits.length, 0);
    assert.equal(normalizeStatusLine("string").limits.length, 0);
    assert.equal(normalizeStatusLine(42).limits.length, 0);
});

// --- isStale ---

test("isStale: 新鮮なキャッシュ（受信から 100 秒）は false", () => {
    const now = 1720000000;
    const snapshot = { receivedAt: now - 100, limits: [] };
    assert.equal(isStale(snapshot, now), false);
});

test("isStale: ちょうど 300 秒経過は stale（>=）", () => {
    const now = 1720000000;
    const snapshot = { receivedAt: now - 300, limits: [] };
    assert.equal(isStale(snapshot, now), true);
});

test("isStale: 299 秒経過は still fresh", () => {
    const now = 1720000000;
    const snapshot = { receivedAt: now - 299, limits: [] };
    assert.equal(isStale(snapshot, now), false);
});

test("isStale: リセット時刻を過ぎた制限があれば true", () => {
    const now = 1720000000;
    const snapshot = {
        receivedAt: now - 100,
        limits: [{ resetsAtEpochSeconds: now - 1 }],
    };
    assert.equal(isStale(snapshot, now), true);
});

test("isStale: ちょうどリセット時刻に達した場合も true", () => {
    const now = 1720000000;
    const snapshot = {
        receivedAt: now - 100,
        limits: [{ resetsAtEpochSeconds: now }],
    };
    assert.equal(isStale(snapshot, now), true);
});

test("isStale: リセット時刻が将来なら false", () => {
    const now = 1720000000;
    const snapshot = {
        receivedAt: now - 100,
        limits: [{ resetsAtEpochSeconds: now + 1000 }],
    };
    assert.equal(isStale(snapshot, now), false);
});

test("isStale: resetsAtEpochSeconds が null の制限はリセット判定に影響しない", () => {
    const now = 1720000000;
    const snapshot = {
        receivedAt: now - 100,
        limits: [{ resetsAtEpochSeconds: null }],
    };
    assert.equal(isStale(snapshot, now), false);
});
