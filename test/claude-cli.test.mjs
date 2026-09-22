import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runStatusLineFromText, runCli } from "../dist/claude-cli.mjs";
import { formatClaudeSnapshot } from "../dist/claude-format.mjs";
import { readCache, writeCache, _setCachePath } from "../dist/claude-cache.mjs";

const cliPath = fileURLToPath(new URL("../dist/claude-cli.mjs", import.meta.url));

// --- テスト用ユーティリティ ---

function makeCachePath() {
    return join(tmpdir(), `claude-cli-test-${process.pid}-${Date.now()}.json`);
}

async function captureStdoutAsync(fn) {
    const output = [];
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    const errOutput = [];
    process.stdout.write = (chunk) => { output.push(String(chunk)); return true; };
    process.stderr.write = (chunk) => { errOutput.push(String(chunk)); return true; };
    let code;
    try {
        code = await fn();
    } finally {
        process.stdout.write = originalOut;
        process.stderr.write = originalErr;
    }
    return { stdout: output.join(""), stderr: errOutput.join(""), code };
}

function spawnCli(args, stdinData, envOverrides = {}) {
    const child = spawn(process.execPath, [cliPath, ...args], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...envOverrides },
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    if (stdinData !== undefined) {
        child.stdin.write(stdinData);
        child.stdin.end();
    } else {
        child.stdin.end();
    }
    const completed = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    return { child, completed };
}

function nextStdoutLine(child, timeoutMs = 8_000) {
    return new Promise((resolve, reject) => {
        let output = "";
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error("watch の出力が時間内に届きませんでした"));
        }, timeoutMs);
        const onData = (chunk) => {
            output += chunk;
            const newline = output.indexOf("\n");
            if (newline < 0) return;
            cleanup();
            resolve(output.slice(0, newline));
        };
        const onExit = () => {
            cleanup();
            reject(new Error("watch が出力前に終了しました"));
        };
        const cleanup = () => {
            clearTimeout(timer);
            child.stdout.off("data", onData);
            child.off("exit", onExit);
        };
        child.stdout.on("data", onData);
        child.once("exit", onExit);
    });
}

// --- --statusline モード ---

test("--statusline: 有効な JSON で statusLine 出力とキャッシュ書き込み", async () => {
    const cachePath = makeCachePath();
    _setCachePath(cachePath);
    try {
        const json = JSON.stringify({
            rate_limits: {
                five_hour: { used_percentage: 45.5, resets_at: 1720018000 },
                seven_day: { used_percentage: 23.0, resets_at: 1720500000 },
            },
        });
        const { stdout, stderr, code } = await captureStdoutAsync(() => runStatusLineFromText(json));
        assert.equal(code, 0);
        assert.equal(stderr, "");
        assert.match(stdout, /^Claude 5h:/);
        assert.match(stdout, /7d:/);

        // キャッシュが書き込まれていること
        const cached = readCache();
        assert.ok(cached !== null);
        assert.equal(cached.limits.length, 2);
        assert.equal(cached.limits[0].window, "five_hour");
    } finally {
        try { rmSync(cachePath); } catch {}
        _setCachePath(null);
    }
});

test("--statusline: 不正な JSON はエラー終了", async () => {
    const { stderr, code } = await captureStdoutAsync(() => runStatusLineFromText("not json"));
    assert.equal(code, 1);
    assert.match(stderr, /JSON/);
});

test("--statusline: rate_limits が空なら 'Claude: --' を出力しキャッシュを更新しない", async () => {
    const cachePath = makeCachePath();
    _setCachePath(cachePath);
    try {
        const json = JSON.stringify({});
        const { stdout, code } = await captureStdoutAsync(() => runStatusLineFromText(json));
        assert.equal(code, 0);
        assert.match(stdout, /Claude: --/);

        // キャッシュが作成されていないこと
        const cached = readCache();
        assert.equal(cached, null);
    } finally {
        try { rmSync(cachePath); } catch {}
        _setCachePath(null);
    }
});

test("--statusline: 同じ値の再送ではキャッシュの受信時刻を新しくしない", async () => {
    const cachePath = makeCachePath();
    _setCachePath(cachePath);
    try {
        const oldTime = Math.floor(Date.now() / 1000) - 400;
        const resetTime = Math.floor(Date.now() / 1000) + 10_000;
        writeCache({
            schemaVersion: 1,
            receivedAt: oldTime,
            observedAt: new Date(oldTime * 1000).toISOString(),
            limits: [{
                limitId: "claude",
                limitName: "Claude",
                window: "five_hour",
                windowDurationMins: 300,
                usedPercent: 30,
                remainingPercent: 70,
                resetsAtEpochSeconds: resetTime,
                resetsAt: new Date(resetTime * 1000).toISOString(),
            }],
        });
        const json = JSON.stringify({
            rate_limits: { five_hour: { used_percentage: 30, resets_at: resetTime } },
        });
        const { code } = await captureStdoutAsync(() => runStatusLineFromText(json));
        assert.equal(code, 0);
        assert.equal(readCache().receivedAt, oldTime);
    } finally {
        try { rmSync(cachePath); } catch {}
        _setCachePath(null);
    }
});

// --- one-shot モード ---

test("Claude の通知設定を短く表示する", () => {
    const snapshot = { observedAt: "2026-09-22T00:00:00.000Z", limits: [] };
    const every = formatClaudeSnapshot(snapshot, false, undefined, "popup", 5);
    assert.match(every.split("\n")[0], /^最終受信日時: [^\n]+ 【通知設定: 残量 5% 毎 \/ ポップアップ】$/);

    const combined = formatClaudeSnapshot(snapshot, false, 10, "notification", 5);
    assert.match(combined.split("\n")[0], /^最終受信日時: [^\n]+ 【通知設定: 残量 10% 以下 \+ 5% 毎 \/ Mac 通知センター】$/);
});

test("one-shot: キャッシュなしはエラー + 終了コード 1", async () => {
    const cachePath = makeCachePath();
    _setCachePath(cachePath);
    try {
        const { stdout, stderr, code } = await captureStdoutAsync(() => runCli([]));
        assert.equal(code, 1);
        assert.equal(stdout, "");
        assert.match(stderr, /キャッシュがありません/);
    } finally {
        try { rmSync(cachePath); } catch {}
        _setCachePath(null);
    }
});

test("one-shot: 新鮮なキャッシュを人向けに表示する", async () => {
    const cachePath = makeCachePath();
    _setCachePath(cachePath);
    try {
        const now = Math.floor(Date.now() / 1000);
        writeCache({
            schemaVersion: 1,
            receivedAt: now,
            observedAt: new Date(now * 1000).toISOString(),
            limits: [{
                limitId: "claude",
                limitName: "Claude",
                window: "five_hour",
                windowDurationMins: 300,
                usedPercent: 45.5,
                remainingPercent: 54.5,
                resetsAtEpochSeconds: now + 10000,
                resetsAt: new Date((now + 10000) * 1000).toISOString(),
            }],
        });
        const { stdout, code } = await captureStdoutAsync(() => runCli([]));
        assert.equal(code, 0);
        assert.match(stdout, /最終受信日時:/);
        assert.doesNotMatch(stdout, /参考値/);
        assert.match(stdout, /five_hour/);
        assert.match(stdout, /54\.5%/);
    } finally {
        try { rmSync(cachePath); } catch {}
        _setCachePath(null);
    }
});

test("one-shot: stale なキャッシュは参考値注記を含む", async () => {
    const cachePath = makeCachePath();
    _setCachePath(cachePath);
    try {
        const oldTime = Math.floor(Date.now() / 1000) - 400;
        writeCache({
            schemaVersion: 1,
            receivedAt: oldTime,
            observedAt: new Date(oldTime * 1000).toISOString(),
            limits: [{
                limitId: "claude",
                limitName: "Claude",
                window: "five_hour",
                windowDurationMins: 300,
                usedPercent: 60,
                remainingPercent: 40,
                resetsAtEpochSeconds: oldTime + 10000,
                resetsAt: new Date((oldTime + 10000) * 1000).toISOString(),
            }],
        });
        const { stdout, code } = await captureStdoutAsync(() => runCli([]));
        assert.equal(code, 0);
        assert.match(stdout, /参考値/);
    } finally {
        try { rmSync(cachePath); } catch {}
        _setCachePath(null);
    }
});

test("one-shot: --json でキャッシュを JSON 出力し stale フラグが含まれる", async () => {
    const cachePath = makeCachePath();
    _setCachePath(cachePath);
    try {
        const now = Math.floor(Date.now() / 1000);
        writeCache({
            schemaVersion: 1,
            receivedAt: now,
            observedAt: new Date(now * 1000).toISOString(),
            limits: [{
                limitId: "claude",
                limitName: "Claude",
                window: "seven_day",
                windowDurationMins: 10080,
                usedPercent: 10,
                remainingPercent: 90,
                resetsAtEpochSeconds: now + 500000,
                resetsAt: new Date((now + 500000) * 1000).toISOString(),
            }],
        });
        const { stdout, stderr, code } = await captureStdoutAsync(() => runCli([
            "--json", "--notify-below", "30", "--notify-every", "20", "--notify-method", "notification",
        ]));
        assert.equal(code, 0);
        assert.equal(stderr, "通知設定: 残量 30% 以下 + 20% 毎 / Mac 通知センター\n");
        const parsed = JSON.parse(stdout.trim());
        assert.equal(parsed.schemaVersion, 1);
        assert.equal(typeof parsed.stale, "boolean");
        assert.equal(parsed.stale, false);
        assert.equal(parsed.limits.length, 1);
    } finally {
        try { rmSync(cachePath); } catch {}
        _setCachePath(null);
    }
});

test("one-shot: --json で stale なキャッシュは stale:true を含む", async () => {
    const cachePath = makeCachePath();
    _setCachePath(cachePath);
    try {
        const oldTime = Math.floor(Date.now() / 1000) - 500;
        writeCache({
            schemaVersion: 1,
            receivedAt: oldTime,
            observedAt: new Date(oldTime * 1000).toISOString(),
            limits: [],
        });
        const { stdout, code } = await captureStdoutAsync(() => runCli(["--json"]));
        assert.equal(code, 0);
        const parsed = JSON.parse(stdout.trim());
        assert.equal(parsed.stale, true);
    } finally {
        try { rmSync(cachePath); } catch {}
        _setCachePath(null);
    }
});

// --- CLI プロセス境界テスト ---

test("help と version の exit code は CLI 境界でも正しい", async () => {
    const help = spawnCli(["--help"]);
    const helpResult = await help.completed;
    assert.equal(helpResult.code, 0);
    assert.match(helpResult.stdout, /--statusline/);
    assert.match(helpResult.stdout, /v2\.1\.251/);

    const version = spawnCli(["--version"]);
    const versionResult = await version.completed;
    assert.equal(versionResult.code, 0);
    assert.match(versionResult.stdout, /^0\.1\.0\n$/);

    const invalid = spawnCli(["--interval", "59"]);
    const invalidResult = await invalid.completed;
    assert.equal(invalidResult.code, 2);
    assert.equal(invalidResult.stdout, "");
    assert.match(invalidResult.stderr, /60 以上の整数/);
});

test("--statusline は CLI プロセスで stdin を読んでキャッシュし出力する", async () => {
    const isolatedTmpDir = mkdtempSync(join(tmpdir(), "claude-statusline-test-"));
    const statuslineJson = JSON.stringify({
        rate_limits: {
            five_hour: { used_percentage: 30, resets_at: Math.floor(Date.now() / 1000) + 10000 },
        },
    });
    try {
        const run = spawnCli(["--statusline"], statuslineJson, { TMPDIR: isolatedTmpDir });
        const result = await run.completed;
        assert.equal(result.code, 0);
        assert.equal(result.stderr, "");
        assert.match(result.stdout, /^Claude 5h:/);
        assert.match(result.stdout.trim(), /70%/);

        const oneShot = spawnCli(["--json"], undefined, { TMPDIR: isolatedTmpDir });
        const oneShotResult = await oneShot.completed;
        assert.equal(oneShotResult.code, 0);
        assert.equal(JSON.parse(oneShotResult.stdout).limits[0].remainingPercent, 70);

        const cacheDir = join(isolatedTmpDir, `claude-token-watcher-${process.getuid()}`);
        assert.equal(statSync(cacheDir).mode & 0o077, 0);
        assert.equal(statSync(join(cacheDir, "cache.json")).mode & 0o077, 0);

        const filtered = spawnCli(["--json", "--filter", "seven_day"], undefined, { TMPDIR: isolatedTmpDir });
        const filteredResult = await filtered.completed;
        assert.equal(filteredResult.code, 0);
        assert.deepEqual(JSON.parse(filteredResult.stdout).limits, []);
    } finally {
        rmSync(isolatedTmpDir, { recursive: true, force: true });
    }
});

test("--statusline に不正 JSON を渡すと終了コード 1", async () => {
    const run = spawnCli(["--statusline"], "invalid json here");
    const result = await run.completed;
    assert.equal(result.code, 1);
    assert.match(result.stderr, /JSON/);
});

test("watch はキャッシュを待ち、受信後と次の更新後に NDJSON を出す", { timeout: 20_000 }, async () => {
    const isolatedTmpDir = mkdtempSync(join(tmpdir(), "claude-watch-test-"));
    const env = { TMPDIR: isolatedTmpDir };
    const watcher = spawnCli(["--watch", "--json", "--interval", "60"], undefined, env);
    try {
        const firstLine = nextStdoutLine(watcher.child);
        const firstStatus = spawnCli(["--statusline"], JSON.stringify({
            rate_limits: {
                five_hour: { used_percentage: 10, resets_at: Math.floor(Date.now() / 1000) + 10_000 },
            },
        }), env);
        assert.equal((await firstStatus.completed).code, 0);
        assert.equal(JSON.parse(await firstLine).limits[0].remainingPercent, 90);

        const secondLine = nextStdoutLine(watcher.child);
        const secondStatus = spawnCli(["--statusline"], JSON.stringify({
            rate_limits: {
                five_hour: { used_percentage: 30, resets_at: Math.floor(Date.now() / 1000) + 10_000 },
            },
        }), env);
        assert.equal((await secondStatus.completed).code, 0);
        assert.equal(JSON.parse(await secondLine).limits[0].remainingPercent, 70);
    } finally {
        watcher.child.kill("SIGINT");
        await watcher.completed;
        rmSync(isolatedTmpDir, { recursive: true, force: true });
    }
});
