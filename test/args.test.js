import assert from "node:assert/strict";
import test from "node:test";
import { helpText, parseArgs } from "../dist/args.js";
import { CliUsageError } from "../dist/types.js";

test("引数なしの既定値は one-shot、interval 180秒、timeout 15秒", () => {
  const parsed = parseArgs([]);
  assert.deepEqual(parsed, {
    kind: "run",
    options: {
      watch: false,
      intervalSeconds: 180,
      json: false,
      notifyBelow: undefined,
      codexBin: "codex",
      timeoutSeconds: 15,
    },
  });
  assert.equal(parsed.options.filter, undefined);
});

test("filter は指定した文字列を保持する", () => {
  assert.equal(parseArgs(["--filter", "codex / primary"]).options.filter, "codex / primary");
});

test("interval は60以上の整数を受理する", () => {
  const parsed = parseArgs(["--watch", "--interval", "60", "--json"]);
  assert.equal(parsed.kind, "run");
  assert.equal(parsed.options.intervalSeconds, 60);
  assert.equal(parsed.options.watch, true);
  assert.equal(parsed.options.json, true);
});

for (const value of ["59", "1.5", "abc", "-60", "Infinity"]) {
  test(`interval の不正値 ${value} を拒否する`, () => {
    assert.throws(() => parseArgs(["--interval", value]), CliUsageError);
  });
}

test("timeout、通知閾値、codex-bin を解釈する", () => {
  assert.deepEqual(parseArgs(["--timeout", "1", "--notify-below", "0", "--codex-bin", "/tmp/fake-codex"]), {
    kind: "run",
    options: {
      watch: false,
      intervalSeconds: 180,
      json: false,
      notifyBelow: 0,
      codexBin: "/tmp/fake-codex",
      timeoutSeconds: 1,
    },
  });
  assert.equal(parseArgs(["--notify-below", "100"]).options.notifyBelow, 100);
});

for (const args of [
  ["--timeout", "0"],
  ["--timeout", "1.5"],
  ["--notify-below", "-1"],
  ["--notify-below", "101"],
  ["--notify-below", "1.5"],
  ["--unknown"],
  ["--interval"],
  ["--timeout", "--json"],
  ["--codex-bin"],
  ["--filter"],
]) {
  test(`不正な引数 ${args.join(" ")} を使用法エラーにする`, () => {
    assert.throws(() => parseArgs(args), (error) => error instanceof CliUsageError && error.exitCode === 2);
  });
}

test("help と version は即時結果を返す", () => {
  assert.deepEqual(parseArgs(["--help"]), { kind: "help" });
  assert.deepEqual(parseArgs(["--version"]), { kind: "version" });
  assert.match(helpText(), /既定: 180、60以上の整数/);
  assert.match(helpText(), /--notify-below <percent>\s+残量が指定値以下なら macOS ポップアップ/);
});
