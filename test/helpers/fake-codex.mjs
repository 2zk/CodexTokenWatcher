import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtureUrl = new URL("../fixtures/fake-app-server.mjs", import.meta.url).href;

export async function createFakeCodex(testContext, scenario) {
  const directory = await mkdtemp(join(tmpdir(), "codex-token-watcher-test-"));
  const executablePath = join(directory, "fake-codex");
  const capturePath = join(directory, "events.jsonl");
  const source = `#!/usr/bin/env node
import { runFakeAppServer } from ${JSON.stringify(fixtureUrl)};
runFakeAppServer(${JSON.stringify({ scenario, capturePath })});
`;
  await writeFile(executablePath, source, { mode: 0o700 });
  await chmod(executablePath, 0o700);
  testContext.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return { executablePath, capturePath };
}

export async function readCapturedEvents(capturePath) {
  try {
    const body = await readFile(capturePath, "utf8");
    return body
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function waitUntil(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${timeoutMs}ms 以内に条件が成立しませんでした。`);
}
