import { appendFileSync } from "node:fs";

export function runFakeAppServer({ scenario, capturePath }) {
  if (process.argv.slice(2).join(" ") !== "app-server --listen stdio://") {
    process.stderr.write("unexpected arguments");
    process.exit(64);
  }

  let input = "";
  let readCount = 0;
  let activeReads = 0;
  const concurrentRequests = [];
  let keepAlive;

  const capture = (event) => {
    appendFileSync(capturePath, `${JSON.stringify(event)}\n`);
  };
  const send = (message) => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  };

  capture({ type: "started", pid: process.pid });
  if (scenario === "slow-stop") {
    keepAlive = setInterval(() => {}, 60_000);
    process.on("SIGTERM", () => {
      capture({ type: "sigterm", pid: process.pid });
      clearInterval(keepAlive);
      process.exit(0);
    });
  }
  const sendInitialize = (id) => {
    const line = `${JSON.stringify({ jsonrpc: "2.0", id, result: { ready: true } })}\n`;
    if (scenario === "concurrent-chunked") {
      const midpoint = Math.floor(line.length / 2);
      process.stdout.write(line.slice(0, midpoint));
      setTimeout(() => process.stdout.write(line.slice(midpoint)), 5);
    } else {
      process.stdout.write(line);
    }
  };
  const rateResult = (slot = readCount) => ({
    rateLimitsByLimitId: {
      codex: {
        limitName: "Fake Codex",
        primary: {
          usedPercent: slot,
          windowDurationMins: 300,
          resetsAt: 1_800_000_000,
        },
        ...(scenario === "filter-multiple" ? {
          secondary: {
            usedPercent: slot + 10,
            windowDurationMins: 10_080,
            resetsAt: 1_800_604_800,
          },
        } : {}),
      },
    },
    slot,
  });

  const handleRead = (message) => {
    readCount += 1;
    capture({ type: "read-start", id: message.id, readCount, activeReads: ++activeReads });

    if (scenario === "rpc-error") {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "synthetic failure" } });
      activeReads -= 1;
      return;
    }
    if (scenario === "auth-error") {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "login required" } });
      activeReads -= 1;
      return;
    }
    if (scenario === "timeout") return;
    if (scenario === "invalid-json") {
      process.stdout.write("not-json\n");
      activeReads -= 1;
      return;
    }
    if (scenario === "exit-stderr") {
      process.stderr.write("synthetic stderr detail\n");
      setTimeout(() => process.exit(7), 5);
      return;
    }
    if (scenario === "concurrent-chunked") {
      concurrentRequests.push(message);
      if (concurrentRequests.length === 2) {
        const [first, second] = concurrentRequests;
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: second.id, result: rateResult(2) })}\n` +
            `${JSON.stringify({ jsonrpc: "2.0", id: first.id, result: rateResult(1) })}\n`,
        );
        activeReads -= 2;
      }
      return;
    }
    if (scenario === "updated-burst" && readCount === 1) {
      for (const delay of [10, 20, 30]) {
        setTimeout(() => send({ jsonrpc: "2.0", method: "account/rateLimits/updated", params: {} }), delay);
      }
      setTimeout(() => {
        activeReads -= 1;
        capture({ type: "read-end", id: message.id, activeReads });
        send({ jsonrpc: "2.0", id: message.id, result: rateResult(1) });
      }, 80);
      return;
    }

    activeReads -= 1;
    capture({ type: "read-end", id: message.id, activeReads });
    send({ jsonrpc: "2.0", id: message.id, result: rateResult() });
    if (scenario === "updated-once") {
      setTimeout(() => send({ jsonrpc: "2.0", method: "account/rateLimits/updated", params: {} }), 5);
    }
  };

  const handleMessage = (message) => {
    capture({ type: "message", message });
    if (message.method === "initialize") {
      sendInitialize(message.id);
      return;
    }
    if (message.method === "initialized") return;
    if (message.method === "account/rateLimits/read") handleRead(message);
  };

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
    let newline;
    while ((newline = input.indexOf("\n")) >= 0) {
      const line = input.slice(0, newline).trim();
      input = input.slice(newline + 1);
      if (line) handleMessage(JSON.parse(line));
    }
  });
  process.stdin.on("end", () => {
    capture({ type: "stdin-ended" });
  });
}
