export interface LimitWindow {
  limitId: string;
  limitName: string | null;
  window: "primary" | "secondary";
  windowDurationMins: number | null;
  usedPercent: number;
  remainingPercent: number;
  resetsAtEpochSeconds: number | null;
  resetsAt: string | null;
}

export interface LimitSnapshot {
  schemaVersion: 1;
  observedAt: string;
  limits: LimitWindow[];
}

export type NotifyMethod = "popup" | "notification";

export interface CliOptions {
  watch: boolean;
  intervalSeconds: number;
  json: boolean;
  filter?: string;
  notifyBelow: number | undefined;
  notifyMethod: NotifyMethod;
  codexBin: string;
  timeoutSeconds: number;
}

export class CliUsageError extends Error {
  readonly exitCode = 2;
}

export class AppServerError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AppServerError";
  }
}
