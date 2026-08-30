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

# 表示名と期間で絞り込む（大文字・小文字を区別しない部分一致）
codex-token-watcher --filter "codex / primary"

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

`--filter <text>` を指定すると、各制限の表示名（`limitName` がなければ `limitId`）と期間（`primary` / `secondary`）を連結した文字列に対し、大文字・小文字を区別しない部分一致で絞り込む。省略時はすべての制限を表示する。フィルタは人向け表示、JSON/NDJSON、ポップアップの対象に共通で適用される。

TTY 上の `--watch` は前回表示を更新する。パイプやリダイレクトなど非TTYでは、スナップショットを追記する。JSON 出力では one-shot は1個の JSON オブジェクト、watch は1行に1個の JSON（NDJSON）になる。診断と警告は標準エラー出力へ出るため、JSON の標準出力には混ざらない。

表示する残量は `100 - usedPercent` を 0〜100 の範囲に丸めたもの。300分の期間は「5時間」、10080分は「7日（週次）」と表示する。

## macOS ポップアップ

残量が指定した値以下になったときに、`osascript` でポップアップを表示する。

```sh
codex-token-watcher --watch --notify-below 20
```

最初の取得時に閾値以下であればポップアップを表示する。以後は上から下へ閾値をまたいだときだけ表示し、回復後に再低下した場合、またはリセット時刻が変わった新しい制限期間では再び表示する。同じ状態での繰り返し表示はしない。ポップアップには「閉じる」ボタンがあり、押すまで表示される。表示に失敗しても監視は継続する。

macOS の通知機能は使わないため、「システム設定 → 通知」での許可や通知スタイルの設定は不要。ポップアップの表示中も、監視と1回実行の終了は待たない。

## ショートカットアプリから起動する例

1. ターミナルで `command -v codex-token-watcher` を実行し、表示された絶対パスを控える。
2. ショートカットアプリで新規ショートカットを作り、「シェルスクリプトを実行」を追加する。
3. スクリプトに、控えた絶対パスを使って次を設定する。

   ```sh
   /絶対パス/codex-token-watcher --watch --notify-below 20
   ```

4. ショートカットを実行する。残量が閾値以下になると、閉じるまで残るポップアップが表示される。通知の許可は不要。

ショートカットを停止するには、実行中のショートカットを停止する。ターミナルで実行した場合は Ctrl+C を使う。SIGINT/SIGTERM を受けると app-server を終了し、SIGINT 時の終了コードは 130。

## 開発

```sh
npm run typecheck
npm run build
npm test
```

app-server のプロトコルは [OpenAI 公式 app-server ドキュメント](https://learn.chatgpt.com/docs/app-server) に基づく。接続時は `initialize` の成功後に `initialized` を送り、`account/rateLimits/read` と `account/rateLimits/updated` を利用する。
