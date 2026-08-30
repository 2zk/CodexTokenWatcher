import type { LimitSnapshot, LimitWindow, NotifyMethod } from "./types.js";

function percent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function duration(value: number | null): string {
  if (value === null) return "不明";
  if (value === 300) return "5時間";
  if (value === 10_080) return "7日（週次）";
  if (value % 1_440 === 0) return `${value / 1_440}日`;
  if (value % 60 === 0) return `${value / 60}時間`;
  return `${value}分`;
}

function resetAt(value: string | null): string {
  if (value === null) return "不明";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function label(limit: LimitWindow): string {
  return limit.limitName ?? limit.limitId;
}

export function formatSnapshot(
  snapshot: LimitSnapshot,
  notifyBelow: number | undefined = undefined,
  notifyMethod: NotifyMethod = "popup",
): string {
  const lines = [`取得日時: ${resetAt(snapshot.observedAt)}`];
  if (notifyBelow !== undefined) {
    const method = notifyMethod === "popup" ? "ポップアップ" : "通知センター";
    lines.push(`通知設定: 残量 ${notifyBelow}% 以下 / 方法: ${method}`);
  }
  if (snapshot.limits.length === 0) {
    lines.push("表示可能な利用制限は返されませんでした。");
    return lines.join("\n");
  }
  for (const limit of snapshot.limits) {
    lines.push(
      `${label(limit)} / ${limit.window} / ${duration(limit.windowDurationMins)}: 残量 ${percent(limit.remainingPercent)}（使用 ${percent(limit.usedPercent)}）/ リセット ${resetAt(limit.resetsAt)}`,
    );
  }
  return lines.join("\n");
}

export function formatJson(snapshot: LimitSnapshot): string {
  return JSON.stringify(snapshot);
}
