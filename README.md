# codex-token-watcher

Codex の app-server から、現在表示できる利用制限の残量を取得する macOS 向け TypeScript CLI。

`primary` と `secondary` を含め、app-server が返したすべての制限期間を表示する。返されなかった期間を推測して表示することはない。

## 前提条件

- macOS
- Node.js 20 以上
- `codex` CLI が PATH 上にあり、ChatGPT 管理認証で `codex login` 済みであること

このツールは認証情報を読まず、`codex app-server` が既存ログイン状態を利用する。API キーのみ、または Bedrock などの認証では、Codex service-backed の利用量を取得できない場合がある。

## インストールとビルド

```sh
npm ci
npm run build
npm link
```

`npm link` 後は `codex-token-watcher` として実行できる。リンクせずに実行する場合は `node dist/cli.js` を使う。

## 使い方

```sh
# 1回だけ、人向けの表示で取得
codex-token-watcher

# JSON で1回取得
codex-token-watcher --json

# 180秒ごと（既定）に表示。Ctrl+C で終了
codex-token-watcher --watch

# 5分ごとに表示
codex-token-watcher --watch --interval 300

# watch と組み合わせて NDJSON を標準出力へ追記
codex-token-watcher --watch --json

# Codex コマンドのパスを明示
codex-token-watcher --codex-bin /opt/homebrew/bin/codex

# app-server 応答の待機時間を30秒にする
codex-token-watcher --timeout 30
```

`--interval` は 60 以上の整数だけを受け付け、既定は 180 秒。`--timeout` は正整数だけを受け付ける。

TTY 上の `--watch` は前回表示を更新する。パイプやリダイレクトなど非TTYでは、スナップショットを追記する。JSON 出力では one-shot は1個の JSON オブジェクト、watch は1行に1個の JSON（NDJSON）になる。診断と警告は標準エラー出力へ出るため、JSON の標準出力には混ざらない。

表示する残量は `100 - usedPercent` を 0〜100 の範囲に丸めたもの。300分の期間は「5時間」、10080分は「7日（週次）」と表示する。

## macOS 通知

残量が指定した値以下になったときに通知する。

```sh
codex-token-watcher --watch --notify-below 20
```

最初の取得時に閾値以下であれば通知する。以後は上から下へ閾値をまたいだときだけ通知し、回復後に再低下した場合、またはリセット時刻が変わった新しい制限期間では再び通知する。同じ状態での繰り返し通知はしない。通知に失敗しても監視は継続する。

初回通知時には macOS から通知許可を求められる場合がある。表示されない場合は「システム設定 → 通知」で、実行元の Terminal と Script Editor（または `osascript` を利用するアプリ）の通知を許可する。

## ショートカットアプリから起動する例

1. ターミナルで `command -v codex-token-watcher` を実行し、表示された絶対パスを控える。
2. ショートカットアプリで新規ショートカットを作り、「シェルスクリプトを実行」を追加する。
3. スクリプトに、控えた絶対パスを使って次を設定する。

   ```sh
   /絶対パス/codex-token-watcher --watch --notify-below 20
   ```

4. ショートカットを実行し、必要に応じて macOS の通知許可を与える。

ショートカットを停止するには、実行中のショートカットを停止する。ターミナルで実行した場合は Ctrl+C を使う。SIGINT/SIGTERM を受けると app-server を終了し、SIGINT 時の終了コードは 130。

## 開発

```sh
npm run typecheck
npm run build
npm test
```

app-server のプロトコルは [OpenAI 公式 app-server ドキュメント](https://learn.chatgpt.com/docs/app-server) に基づく。接続時は `initialize` の成功後に `initialized` を送り、`account/rateLimits/read` と `account/rateLimits/updated` を利用する。
