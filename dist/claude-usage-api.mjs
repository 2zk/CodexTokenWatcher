import { execFile } from "node:child_process";

/**
 * Claude Code の利用量 API（非公式）から利用制限を取得する。
 * エンドポイントや応答形式は公開仕様ではなく、予告なく変わる可能性がある。
 */
export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const REQUEST_TIMEOUT_MS = 15_000;
const SECURITY_TIMEOUT_MS = 30_000;
const WINDOWS = [
    { key: "five_hour", window: "five_hour", windowDurationMins: 300 },
    { key: "seven_day", window: "seven_day", windowDurationMins: 10_080 },
];

export class UsageApiError extends Error {
    constructor(message, retryAfterSeconds = undefined) {
        super(message);
        this.name = "UsageApiError";
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** macOS キーチェーンから Claude Code の認証情報 JSON 文字列を読む。 */
function readKeychain() {
    return new Promise((resolve, reject) => {
        execFile(
            "/usr/bin/security",
            ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
            { timeout: SECURITY_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
            (error, stdout) => {
                if (error) {
                    // stderr にはトークンが含まれないが、念のためメッセージには含めない
                    reject(new UsageApiError(
                        "キーチェーンから Claude Code の認証情報を読めませんでした。Claude Code にログインしているか、キーチェーンへのアクセスを許可したか確認してください。",
                    ));
                    return;
                }
                resolve(stdout);
            },
        );
    });
}

/**
 * 認証情報 JSON からアクセストークンを取り出す。
 * トークンの更新（refresh）は行わない。期限切れなら案内付きのエラーにする。
 */
export function parseCredentials(text, nowMs = Date.now()) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new UsageApiError("Claude Code の認証情報の形式を解釈できませんでした。");
    }
    const oauth = isRecord(parsed) ? parsed.claudeAiOauth : undefined;
    if (!isRecord(oauth) || typeof oauth.accessToken !== "string" || oauth.accessToken === "") {
        throw new UsageApiError("Claude Code の認証情報に OAuth トークンがありません。Pro/Max プランでログインしてください。");
    }
    if (typeof oauth.expiresAt === "number" && Number.isFinite(oauth.expiresAt) && oauth.expiresAt <= nowMs) {
        throw new UsageApiError("Claude Code の OAuth トークンが期限切れです。ターミナル版 Claude Code（claude コマンド）を起動すると更新されます（デスクトップアプリの利用では更新されません）。");
    }
    return oauth.accessToken;
}

function parseRetryAfter(value) {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (/^[0-9]+$/.test(value.trim())) {
        return Number(value.trim());
    }
    const date = Date.parse(value);
    if (Number.isNaN(date)) {
        return undefined;
    }
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/** 利用量 API を呼び、応答 JSON を返す。 */
export async function requestUsage(token, fetchImpl = fetch) {
    let response;
    try {
        response = await fetchImpl(USAGE_URL, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
                "anthropic-beta": OAUTH_BETA,
                Accept: "application/json",
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new UsageApiError(`利用量 API に接続できませんでした: ${reason}`);
    }
    if (response.status === 401 || response.status === 403) {
        throw new UsageApiError(
            `利用量 API の認証に失敗しました（HTTP ${response.status}）。ターミナル版 Claude Code（claude コマンド）で再ログインしてください。`,
        );
    }
    if (response.status === 429) {
        const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
        throw new UsageApiError("利用量 API の呼び出し回数制限に達しました（HTTP 429）。", retryAfterSeconds);
    }
    if (!response.ok) {
        throw new UsageApiError(`利用量 API がエラーを返しました（HTTP ${response.status}）。`);
    }
    try {
        return await response.json();
    } catch {
        throw new UsageApiError("利用量 API の応答が JSON ではありません。");
    }
}

function readWindow(raw, spec) {
    if (!isRecord(raw)) {
        return null;
    }
    const used = raw.utilization;
    if (typeof used !== "number" || !Number.isFinite(used)) {
        return null;
    }
    const usedPercent = Math.min(100, Math.max(0, used));
    let resetsAtEpochSeconds = null;
    if (typeof raw.resets_at === "string") {
        const ms = Date.parse(raw.resets_at);
        if (!Number.isNaN(ms)) {
            resetsAtEpochSeconds = Math.floor(ms / 1000);
        }
    }
    return {
        limitId: "claude",
        limitName: "Claude",
        window: spec.window,
        windowDurationMins: spec.windowDurationMins,
        usedPercent,
        remainingPercent: Math.min(100, Math.max(0, 100 - usedPercent)),
        resetsAtEpochSeconds,
        resetsAt: resetsAtEpochSeconds === null ? null : new Date(resetsAtEpochSeconds * 1000).toISOString(),
    };
}

/**
 * 利用量 API の応答を内部 snapshot 形式へ正規化する。
 * statusLine と同じ five_hour / seven_day だけを扱い、欠けた期間は推測しない。
 */
export function normalizeUsageResponse(json, receivedAt = new Date()) {
    const record = isRecord(json) ? json : {};
    const limits = [];
    for (const spec of WINDOWS) {
        const limit = readWindow(record[spec.key], spec);
        if (limit !== null) {
            limits.push(limit);
        }
    }
    return {
        schemaVersion: 1,
        receivedAt: Math.floor(receivedAt.getTime() / 1000),
        observedAt: receivedAt.toISOString(),
        limits,
    };
}

/** キーチェーンのトークンで利用量 API を呼び、snapshot を返す。 */
export async function fetchUsageSnapshot(dependencies = {}) {
    const readCredentials = dependencies.readCredentials ?? readKeychain;
    const token = parseCredentials(await readCredentials());
    const json = await requestUsage(token, dependencies.fetchImpl ?? fetch);
    const snapshot = normalizeUsageResponse(json);
    if (snapshot.limits.length === 0) {
        throw new UsageApiError("利用量 API の応答に 5時間・7日の利用制限が含まれていません。");
    }
    return snapshot;
}
