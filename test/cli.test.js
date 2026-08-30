import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFakeCodex, readCapturedEvents, waitUntil } from "./helpers/fake-codex.js";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function spawnCli(args) {
  const child = spawn(process.execPath, [cliPath, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, completed, stdout: () => stdout, stderr: () => stderr };
}

test("one-shot JSONはstdoutにJSON一行だけを出し、診断を混ぜない", async (t) => {
  const fake = await createFakeCodex(t, "normal");
  const run = spawnCli(["--json", "--codex-bin", fake.executablePath]);
  const result = await run.completed;
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.limits[0].limitId, "codex");
});

test("filterは大文字・小文字を区別せず、JSONに一致するlimitだけを出す", async (t) => {
  const fake = await createFakeCodex(t, "filter-multiple");
  const run = spawnCli(["--json", "--filter", "fAkE cOdEx / PrImArY", "--codex-bin", fake.executablePath]);
  const result = await run.completed;

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.limits.length, 1);
  assert.equal(parsed.limits[0].limitId, "codex");
  assert.equal(parsed.limits[0].limitName, "Fake Codex");
  assert.equal(parsed.limits[0].window, "primary");
});

test("update burstをdebounceし、pollを重複させず、SIGINTでchild stdinを閉じて130終了する", async (t) => {
  const fake = await createFakeCodex(t, "updated-burst");
  const run = spawnCli(["--watch", "--json", "--interval", "60", "--codex-bin", fake.executablePath]);

  await waitUntil(() => {
    const lines = run.stdout().trim().split("\n").filter(Boolean);
    return lines.length >= 2;
  }, 4_000);
  run.child.kill("SIGINT");
  const result = await run.completed;

  assert.equal(result.code, 130);
  const outputLines = result.stdout.trim().split("\n").filter(Boolean);
  assert.equal(outputLines.length, 2);
  for (const line of outputLines) {
    assert.equal(JSON.parse(line).schemaVersion, 1);
  }
  assert.match(result.stderr, /SIGINT を受信したため終了処理を開始します/);

  const events = await waitUntil(async () => {
    const current = await readCapturedEvents(fake.capturePath);
    return current.some((event) => event.type === "stdin-ended") ? current : undefined;
  });
  const readEvents = events.filter((event) => event.type === "read-start" || event.type === "read-end");
  assert.deepEqual(readEvents.map((event) => event.type), ["read-start", "read-end", "read-start", "read-end"]);
  assert.equal(readEvents.some((event) => event.activeReads > 1), false);
});

test("停止処理中の2回目のSIGINTでforceStopし、130終了後にapp-serverを残さない", async (t) => {
  const fake = await createFakeCodex(t, "slow-stop");
  const run = spawnCli(["--watch", "--json", "--interval", "60", "--codex-bin", fake.executablePath]);
  t.after(() => {
    if (run.child.exitCode === null) run.child.kill("SIGKILL");
  });

  await waitUntil(() => run.stdout().trim().split("\n").filter(Boolean).length >= 1);
  assert.equal(run.child.kill("SIGINT"), true);

  const stoppingEvents = await waitUntil(async () => {
    const current = await readCapturedEvents(fake.capturePath);
    return current.some((event) => event.type === "stdin-ended") ? current : undefined;
  });
  const fakePid = stoppingEvents.find((event) => event.type === "started").pid;
  assert.equal(run.child.kill("SIGINT"), true);

  const finalEvents = await waitUntil(async () => {
    const current = await readCapturedEvents(fake.capturePath);
    return current.some((event) => event.type === "sigterm") ? current : undefined;
  }, 750);
  assert.equal(finalEvents.filter((event) => event.type === "sigterm").length, 1);

  const result = await run.completed;
  assert.equal(result.code, 130);
  assert.equal(result.signal, null);
  assert.match(result.stderr, /SIGINT を受信したため終了処理を開始します/);
  await waitUntil(() => {
    try {
      process.kill(fakePid, 0);
      return false;
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      throw error;
    }
  });
});

test("help/versionと引数エラーのexit codeをCLI境界でも維持する", async () => {
  const help = spawnCli(["--help"]);
  const helpResult = await help.completed;
  assert.equal(helpResult.code, 0);
  assert.match(helpResult.stdout, /既定: 180、60以上の整数/);

  const version = spawnCli(["--version"]);
  const versionResult = await version.completed;
  assert.equal(versionResult.code, 0);
  assert.match(versionResult.stdout, /^0\.1\.0\n$/);

  const invalid = spawnCli(["--interval", "59"]);
  const invalidResult = await invalid.completed;
  assert.equal(invalidResult.code, 2);
  assert.equal(invalidResult.stdout, "");
  assert.match(invalidResult.stderr, /60 以上の整数/);

  const missingFilter = spawnCli(["--filter"]);
  const missingFilterResult = await missingFilter.completed;
  assert.equal(missingFilterResult.code, 2);
  assert.equal(missingFilterResult.stdout, "");
  assert.match(missingFilterResult.stderr, /--filter には値が必要/);
});
