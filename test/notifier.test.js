import assert from "node:assert/strict";
import test from "node:test";
import { ThresholdNotifier } from "../dist/notifier.js";

function makeLimit({
  limitId = "codex",
  limitName = null,
  window = "primary",
  remainingPercent = 90,
  resetsAtEpochSeconds = 1_800_000_000,
} = {}) {
  return {
    limitId,
    limitName,
    window,
    windowDurationMins: 300,
    usedPercent: 100 - remainingPercent,
    remainingPercent,
    resetsAtEpochSeconds,
    resetsAt: resetsAtEpochSeconds === null ? null : new Date(resetsAtEpochSeconds * 1_000).toISOString(),
  };
}

function makeSnapshot(...limits) {
  return {
    schemaVersion: 1,
    observedAt: "2026-08-30T00:00:00.000Z",
    limits,
  };
}

function recordingExecutor({ failure } = {}) {
  const calls = [];
  return {
    calls,
    execute: async (file, args) => {
      calls.push({ file, args });
      if (failure !== undefined) throw failure;
    },
  };
}

test("閾値未指定ならexecutorも警告も呼ばない", async () => {
  const warnings = [];
  const recorder = recordingExecutor();
  const notifier = new ThresholdNotifier(undefined, (message) => warnings.push(message), recorder.execute);
  await notifier.observe(makeSnapshot(makeLimit({ remainingPercent: 0 })));
  assert.deepEqual(recorder.calls, []);
  assert.deepEqual(warnings, []);
});

test("初回観測が閾値以下なら1回通知し、同じbelow状態では重複通知しない", async () => {
  const recorder = recordingExecutor();
  const notifier = new ThresholdNotifier(20, () => {}, recorder.execute);
  const below = makeSnapshot(makeLimit({ remainingPercent: 20 }));

  await notifier.observe(below);
  await notifier.observe(below);

  assert.equal(recorder.calls.length, 1);
});

test("aboveからbelowへ閾値を跨いだときだけ通知する", async () => {
  const recorder = recordingExecutor();
  const notifier = new ThresholdNotifier(20, () => {}, recorder.execute);

  await notifier.observe(makeSnapshot(makeLimit({ remainingPercent: 21 })));
  assert.equal(recorder.calls.length, 0);
  await notifier.observe(makeSnapshot(makeLimit({ remainingPercent: 19 })));
  assert.equal(recorder.calls.length, 1);
});

test("回復後に再びbelowになれば再通知する", async () => {
  const recorder = recordingExecutor();
  const notifier = new ThresholdNotifier(20, () => {}, recorder.execute);

  await notifier.observe(makeSnapshot(makeLimit({ remainingPercent: 10 })));
  await notifier.observe(makeSnapshot(makeLimit({ remainingPercent: 80 })));
  await notifier.observe(makeSnapshot(makeLimit({ remainingPercent: 15 })));

  assert.equal(recorder.calls.length, 2);
});

test("belowのままでもresetsAtが変わった新期間では再通知する", async () => {
  const recorder = recordingExecutor();
  const notifier = new ThresholdNotifier(20, () => {}, recorder.execute);

  await notifier.observe(makeSnapshot(makeLimit({ remainingPercent: 10, resetsAtEpochSeconds: 1_800_000_000 })));
  await notifier.observe(makeSnapshot(makeLimit({ remainingPercent: 10, resetsAtEpochSeconds: 1_800_003_600 })));

  assert.equal(recorder.calls.length, 2);
});

test("閉じるまで残るAppleScriptダイアログへ通知値をargvで渡す", async () => {
  const recorder = recordingExecutor();
  const notifier = new ThresholdNotifier(13, () => {}, recorder.execute);
  await notifier.observe(
    makeSnapshot(makeLimit({ limitId: "codex", limitName: "Named Codex", remainingPercent: 12 })),
  );

  assert.equal(recorder.calls.length, 1);
  const [{ file, args }] = recorder.calls;
  assert.equal(file, "/usr/bin/osascript");
  assert.equal(args[0], "-e");
  assert.match(args[1], /on run argv/);
  assert.match(args[1], /display dialog \(item 1 of argv\) with title \(item 2 of argv\)/);
  assert.doesNotMatch(args[1], /display notification/);
  assert.match(args[1], /buttons \{"閉じる"\} default button "閉じる"/);
  assert.doesNotMatch(args[1], /giving up after/);
  assert.equal(args[1].includes("Named Codex"), false);
  assert.equal(args[1].includes("12%"), false);
  assert.equal(args[2], "Named Codex / primary: 残量 12%（通知閾値 13% 以下）");
  assert.equal(args[3], "Codex 利用制限");
  assert.equal(args.length, 4);
});

test("executor失敗は一度だけ警告し、残りのwindow観測を継続する", async () => {
  const warnings = [];
  const recorder = recordingExecutor({ failure: new Error("synthetic executor failure") });
  const notifier = new ThresholdNotifier(20, (message) => warnings.push(message), recorder.execute);
  const snapshot = makeSnapshot(
    makeLimit({ limitId: "codex", window: "primary", remainingPercent: 10 }),
    makeLimit({ limitId: "codex", window: "secondary", remainingPercent: 5 }),
  );

  await assert.doesNotReject(notifier.observe(snapshot));
  assert.equal(recorder.calls.length, 2);
  assert.equal(warnings.length, 1);
  assert.match(
    warnings[0],
    /^macOS ポップアップを表示できませんでした。監視は継続します: synthetic executor failure$/,
  );

  await assert.doesNotReject(
    notifier.observe(
      makeSnapshot(makeLimit({ limitId: "review", window: "primary", remainingPercent: 1 })),
    ),
  );
  assert.equal(recorder.calls.length, 3);
  assert.equal(warnings.length, 1);
});
