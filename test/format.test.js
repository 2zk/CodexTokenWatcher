import assert from "node:assert/strict";
import test from "node:test";
import { formatJson, formatSnapshot } from "../dist/format.js";

function snapshotWithDurations(durations) {
  return {
    schemaVersion: 1,
    observedAt: "2026-08-30T00:00:00.000Z",
    limits: durations.map((windowDurationMins, index) => ({
      limitId: `id-${index}`,
      limitName: index === 0 ? "Named limit" : null,
      window: index % 2 === 0 ? "primary" : "secondary",
      windowDurationMins,
      usedPercent: 23.5,
      remainingPercent: 76.5,
      resetsAtEpochSeconds: index === 0 ? 1_788_050_000 : null,
      resetsAt: index === 0 ? "2026-08-30T09:53:20.000Z" : null,
    })),
  };
}

test("5時間、週次、任意の分・時間・日を表示する", () => {
  const output = formatSnapshot(snapshotWithDurations([300, 10_080, 45, 120, 2_880, null]));
  assert.match(output, /Named limit \/ primary \/ 5時間/);
  assert.match(output, /id-1 \/ secondary \/ 7日（週次）/);
  assert.match(output, /id-2 \/ primary \/ 45分/);
  assert.match(output, /id-3 \/ secondary \/ 2時間/);
  assert.match(output, /id-4 \/ primary \/ 2日/);
  assert.match(output, /id-5 \/ secondary \/ 不明/);
});

test("human表示に取得日時、label、window、残量、使用率、ローカルresetを含める", () => {
  const output = formatSnapshot(snapshotWithDurations([300]));
  assert.match(output, /^取得日時: /);
  assert.match(output, /Named limit \/ primary/);
  assert.match(output, /残量 76\.5%（使用 23\.5%）/);
  assert.match(output, /リセット (?!不明)/);
});

test("制限がない場合は明示する", () => {
  const snapshot = snapshotWithDurations([]);
  assert.match(formatSnapshot(snapshot), /表示可能な利用制限は返されませんでした/);
});

test("JSON出力はsnapshotを1行でそのまま表現する", () => {
  const snapshot = snapshotWithDurations([300]);
  const output = formatJson(snapshot);
  assert.equal(output.includes("\n"), false);
  assert.deepEqual(JSON.parse(output), snapshot);
});
