import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, writeFileSync } from "node:fs";
import { readCache, writeCache, cachePath, _setCachePath } from "../dist/claude-cache.mjs";

// テスト専用のキャッシュパスを設定する
const testCachePath = join(tmpdir(), `claude-cache-test-${process.pid}.json`);

function setup() {
    _setCachePath(testCachePath);
    try { rmSync(testCachePath); } catch {}
}
function teardown() {
    try { rmSync(testCachePath); } catch {}
    _setCachePath(null);
}

const sampleSnapshot = {
    schemaVersion: 1,
    receivedAt: 1720000000,
    observedAt: "2024-07-03T17:46:40.000Z",
    limits: [
        {
            limitId: "claude",
            limitName: "Claude",
            window: "five_hour",
            windowDurationMins: 300,
            usedPercent: 45.5,
            remainingPercent: 54.5,
            resetsAtEpochSeconds: 1720018000,
            resetsAt: "2024-07-03T22:46:40.000Z",
        },
        {
            limitId: "claude",
            limitName: "Claude",
            window: "seven_day",
            windowDurationMins: 10080,
            usedPercent: 23.0,
            remainingPercent: 77.0,
            resetsAtEpochSeconds: 1720500000,
            resetsAt: "2024-07-09T17:46:40.000Z",
        },
    ],
};

test("writeCache → readCache のラウンドトリップ", () => {
    setup();
    try {
        writeCache(sampleSnapshot);
        const loaded = readCache();

        assert.ok(loaded !== null, "readCache が null を返さない");
        assert.equal(loaded.schemaVersion, 1);
        assert.equal(loaded.receivedAt, 1720000000);
        assert.equal(loaded.observedAt, "2024-07-03T17:46:40.000Z");
        assert.equal(loaded.limits.length, 2);

        const fiveHour = loaded.limits[0];
        assert.equal(fiveHour.limitId, "claude");
        assert.equal(fiveHour.window, "five_hour");
        assert.equal(fiveHour.remainingPercent, 54.5);
        assert.equal(fiveHour.resetsAtEpochSeconds, 1720018000);

        const sevenDay = loaded.limits[1];
        assert.equal(sevenDay.window, "seven_day");
        assert.equal(sevenDay.remainingPercent, 77.0);
    } finally {
        teardown();
    }
});

test("readCache: キャッシュが存在しなければ null", () => {
    setup();
    try {
        const result = readCache();
        assert.equal(result, null);
    } finally {
        teardown();
    }
});

test("writeCache は指定外のフィールドを保存しない", () => {
    setup();
    try {
        const snapshotWithExtra = {
            ...sampleSnapshot,
            token: "secret-token",
            authKey: "my-auth-key",
            rawJson: { rate_limits: {} },
        };
        writeCache(snapshotWithExtra);
        const loaded = readCache();

        assert.ok(loaded !== null);
        assert.equal(loaded.token, undefined);
        assert.equal(loaded.authKey, undefined);
        assert.equal(loaded.rawJson, undefined);
    } finally {
        teardown();
    }
});

test("readCache: JSON が破損していれば null", () => {
    setup();
    try {
        writeFileSync(testCachePath, "not valid json");
        const result = readCache();
        assert.equal(result, null);
    } finally {
        teardown();
    }
});

test("readCache: receivedAt が数値でなければ null", () => {
    setup();
    try {
        writeFileSync(testCachePath, JSON.stringify({ schemaVersion: 1, receivedAt: "not-a-number", limits: [] }));
        const result = readCache();
        assert.equal(result, null);
    } finally {
        teardown();
    }
});

test("readCache: limits が壊れていれば null", () => {
    setup();
    try {
        writeFileSync(testCachePath, JSON.stringify({
            schemaVersion: 1,
            receivedAt: 1720000000,
            observedAt: "2024-07-03T17:46:40.000Z",
            limits: { not: "an array" },
        }));
        assert.equal(readCache(), null);
    } finally {
        teardown();
    }
});

test("cachePath: _setCachePath でオーバーライドできる", () => {
    const custom = join(tmpdir(), "custom-cache-test.json");
    _setCachePath(custom);
    try {
        assert.equal(cachePath(), custom);
    } finally {
        _setCachePath(null);
    }
});

test("writeCache 後の limits に必須フィールドがそろっている", () => {
    setup();
    try {
        writeCache(sampleSnapshot);
        const loaded = readCache();
        assert.ok(loaded !== null);
        for (const limit of loaded.limits) {
            assert.ok("limitId" in limit);
            assert.ok("limitName" in limit);
            assert.ok("window" in limit);
            assert.ok("windowDurationMins" in limit);
            assert.ok("usedPercent" in limit);
            assert.ok("remainingPercent" in limit);
            assert.ok("resetsAtEpochSeconds" in limit);
            assert.ok("resetsAt" in limit);
        }
    } finally {
        teardown();
    }
});
