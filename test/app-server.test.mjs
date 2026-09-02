import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { CodexAppServer } from "../dist/app-server.mjs";
import { AppServerError } from "../dist/types.mjs";
import { createFakeCodex, readCapturedEvents, waitUntil } from "./helpers/fake-codex.mjs";

async function startedServer(testContext, scenario, timeoutMs = 2_000) {
  const fake = await createFakeCodex(testContext, scenario);
  const server = new CodexAppServer(fake.executablePath, timeoutMs);
  testContext.after(() => server.stop(20));
  await server.start();
  return { server, ...fake };
}

test("initialize応答後に initialized、続いてrateLimits/readを送る", async (t) => {
  const { server, capturePath } = await startedServer(t, "normal");
  await server.readRateLimits();
  const events = await waitUntil(async () => {
    const current = await readCapturedEvents(capturePath);
    return current.filter((event) => event.type === "message").length >= 3 ? current : undefined;
  });
  const messages = events.filter((event) => event.type === "message").map((event) => event.message);
  const methods = messages.map((message) => message.method);
  assert.deepEqual(methods, ["initialize", "initialized", "account/rateLimits/read"]);
  assert.equal(messages[0].jsonrpc, "2.0");
});

test("分割chunkと同一chunkの複数JSONLを解析し、逆順応答をID相関する", async (t) => {
  const { server } = await startedServer(t, "concurrent-chunked");
  const first = server.readRateLimits();
  const second = server.readRateLimits();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.slot, 1);
  assert.equal(secondResult.slot, 2);
});

test("JSON-RPC errorを日本語のAppServerErrorにする", async (t) => {
  const { server } = await startedServer(t, "rpc-error");
  await assert.rejects(server.readRateLimits(), (error) => {
    assert.ok(error instanceof AppServerError);
    assert.match(error.message, /app-server がエラーを返しました: synthetic failure/);
    return true;
  });
});

test("認証系JSON-RPC errorを区別する", async (t) => {
  const { server } = await startedServer(t, "auth-error");
  await assert.rejects(server.readRateLimits(), /認証または利用量取得に対応しない認証方式/);
});

test("応答timeoutをmethod名付きで報告する", async (t) => {
  const { server } = await startedServer(t, "timeout", 1_000);
  await assert.rejects(server.readRateLimits(), /account\/rateLimits\/read が 1 秒以内に応答しませんでした/);
});

test("不正JSONLを待機中requestのエラーにする", async (t) => {
  const { server } = await startedServer(t, "invalid-json");
  await assert.rejects(server.readRateLimits(), /不正な JSONL/);
});

test("child途中終了にcodeとstderr診断を含める", async (t) => {
  const { server } = await startedServer(t, "exit-stderr");
  await assert.rejects(server.readRateLimits(), (error) => {
    assert.match(error.message, /code: 7/);
    assert.match(error.message, /synthetic stderr detail/);
    return true;
  });
});

test("account/rateLimits/updatedをイベントとして通知する", async (t) => {
  const { server } = await startedServer(t, "updated-once");
  const updated = once(server, "rateLimitsUpdated");
  await server.readRateLimits();
  await updated;
});
