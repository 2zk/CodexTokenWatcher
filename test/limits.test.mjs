import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRateLimits } from "../dist/limits.mjs";

const observedAt = new Date("2026-08-30T00:00:00.000Z");

test("rateLimitsByLimitId の全entryと primary/secondary を正規化する", () => {
  const snapshot = normalizeRateLimits(
    {
      ignoredTopLevel: true,
      rateLimitsByLimitId: {
        codex: {
          limitName: "Codex",
          unknown: "ignored",
          primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 1_788_050_000, extra: 1 },
          secondary: { usedPercent: 45.5, windowDurationMins: 10_080, resetsAt: "2026-08-31T00:00:00Z" },
        },
        review: {
          limitId: "review-override",
          primary: { usedPercent: 10, windowDurationMins: 60, resetsAt: null },
        },
      },
    },
    observedAt,
  );

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.observedAt, "2026-08-30T00:00:00.000Z");
  assert.deepEqual(
    snapshot.limits.map(({ limitId, limitName, window, remainingPercent }) => ({ limitId, limitName, window, remainingPercent })),
    [
      { limitId: "codex", limitName: "Codex", window: "primary", remainingPercent: 77 },
      { limitId: "codex", limitName: "Codex", window: "secondary", remainingPercent: 54.5 },
      { limitId: "review-override", limitName: null, window: "primary", remainingPercent: 90 },
    ],
  );
  assert.equal(snapshot.limits[0].resetsAt, "2026-08-30T00:33:20.000Z");
  assert.equal(snapshot.limits[1].resetsAtEpochSeconds, 1_788_134_400);
  assert.equal(snapshot.limits[2].resetsAt, null);
});

test("map keyがprimary/secondaryでも各bucketの全windowを脱落させない", () => {
  const snapshot = normalizeRateLimits(
    {
      rateLimitsByLimitId: {
        primary: {
          limitId: "primary",
          primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null },
          secondary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: null },
        },
        secondary: {
          limitId: "secondary",
          primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: null },
          secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: null },
        },
      },
    },
    observedAt,
  );

  assert.deepEqual(
    snapshot.limits.map(({ limitId, window, usedPercent }) => ({ limitId, window, usedPercent })),
    [
      { limitId: "primary", window: "primary", usedPercent: 10 },
      { limitId: "primary", window: "secondary", usedPercent: 20 },
      { limitId: "secondary", window: "primary", usedPercent: 30 },
      { limitId: "secondary", window: "secondary", usedPercent: 40 },
    ],
  );
});

test("旧形式 rateLimits のbucketへフォールバックする", () => {
  const snapshot = normalizeRateLimits(
    {
      rateLimits: {
        limitId: "legacy",
        limitName: "Legacy",
        primary: { usedPercent: 5, windowDurationMins: 15, resetsAt: 1_800_000_000 },
        secondary: null,
      },
    },
    observedAt,
  );
  assert.equal(snapshot.limits.length, 1);
  assert.equal(snapshot.limits[0].limitId, "legacy");
  assert.equal(snapshot.limits[0].window, "primary");
});

test("新形式に有効なwindowがあれば旧形式より優先する", () => {
  const snapshot = normalizeRateLimits(
    {
      rateLimitsByLimitId: {
        current: { primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: null } },
      },
      rateLimits: {
        primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: null },
      },
    },
    observedAt,
  );
  assert.deepEqual(snapshot.limits.map((limit) => limit.limitId), ["current"]);
});

test("新形式mapが存在する場合は空でも旧形式を混ぜない", () => {
  const snapshot = normalizeRateLimits(
    {
      rateLimitsByLimitId: {},
      rateLimits: {
        primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: null },
      },
    },
    observedAt,
  );
  assert.deepEqual(snapshot.limits, []);
});

test("null、欠落、型不正のwindowと未知フィールドを安全に無視する", () => {
  const snapshot = normalizeRateLimits(
    {
      rateLimitsByLimitId: {
        nulls: { primary: null, secondary: undefined, unknown: { usedPercent: 10 } },
        bad: {
          primary: { usedPercent: "12", windowDurationMins: "300", resetsAt: "not-a-date" },
          secondary: { usedPercent: Number.NaN },
        },
      },
    },
    observedAt,
  );
  assert.deepEqual(snapshot.limits, []);
});

for (const input of [null, undefined, [], "bad", 42, { rateLimitsByLimitId: [] }, { rateLimits: "bad" }]) {
  test(`不正なレスポンス形状 ${JSON.stringify(input)} は空配列になる`, () => {
    assert.deepEqual(normalizeRateLimits(input, observedAt).limits, []);
  });
}

test("usedPercent と remainingPercent を0〜100へ丸める", () => {
  const snapshot = normalizeRateLimits(
    {
      rateLimitsByLimitId: {
        low: { primary: { usedPercent: -20 } },
        high: { secondary: { usedPercent: 125 } },
      },
    },
    observedAt,
  );
  assert.deepEqual(
    snapshot.limits.map(({ usedPercent, remainingPercent }) => ({ usedPercent, remainingPercent })),
    [
      { usedPercent: 0, remainingPercent: 100 },
      { usedPercent: 100, remainingPercent: 0 },
    ],
  );
});

test("Date範囲外のnumber/string resetsAtはepochとISOをnullにする", () => {
  const snapshot = normalizeRateLimits(
    {
      rateLimits: {
        primary: { usedPercent: 20, resetsAt: Number.MAX_VALUE },
        secondary: { usedPercent: 30, resetsAt: "+999999-01-01T00:00:00.000Z" },
      },
    },
    observedAt,
  );
  assert.deepEqual(
    snapshot.limits.map(({ resetsAtEpochSeconds, resetsAt }) => ({ resetsAtEpochSeconds, resetsAt })),
    [
      { resetsAtEpochSeconds: null, resetsAt: null },
      { resetsAtEpochSeconds: null, resetsAt: null },
    ],
  );
});

test("JSON化したsnapshotは固定schemaとISO日時を保つ", () => {
  const snapshot = normalizeRateLimits(
    { rateLimits: { primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 1_788_050_000 } } },
    observedAt,
  );
  const json = JSON.parse(JSON.stringify(snapshot));
  assert.deepEqual(Object.keys(json), ["schemaVersion", "observedAt", "limits"]);
  assert.match(json.observedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(json.limits[0]), [
    "limitId",
    "limitName",
    "window",
    "windowDurationMins",
    "usedPercent",
    "remainingPercent",
    "resetsAtEpochSeconds",
    "resetsAt",
  ]);
  assert.match(json.limits[0].resetsAt, /^\d{4}-\d{2}-\d{2}T/);
});
