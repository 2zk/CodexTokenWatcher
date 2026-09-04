# codex-token-watcher

Codex の app-server から、現在表示できる利用制限の残量を取得する macOS 向け Node.js CLI。

`primary` と `secondary` を含め、app-server が返したすべての制限期間を表示する。返されなかった期間を推測して表示することはない。

## 前提条件

- macOS
- Node.js 20 以上
- `codex` CLI が PATH 上にあり、ChatGPT 管理認証で `codex login` 済みであること

このツールは認証情報を読まず、`codex app-server` が既存ログイン状態を利用する。API キーのみ、または Bedrock などの認証では、Codex service-backed の利用量を取得できない場合がある。

## 使い始める

```sh
git clone https://github.com/2zk/CodexTokenWatcher.git
cd CodexTokenWatcher
./codex-token-watcher
```

clone 後のパッケージインストールやビルドは不要。リポジトリに含まれるNode.js実装を直接実行する。

## 使い方

```sh
# 1回だけ、人向けの表示で取得
./codex-token-watcher

# JSON で1回取得
./codex-token-watcher --json

# 表示名と期間で絞り込む（大文字・小文字を区別しない部分一致）
./codex-token-watcher --filter "codex / primary"

# 180秒ごと（既定）に表示。Ctrl+C で終了
./codex-token-watcher --watch

# 5分ごとに表示
./codex-token-watcher --watch --interval 300

# watch と組み合わせて NDJSON を標準出力へ追記
./codex-token-watcher --watch --json

# Codex コマンドのパスを明示
./codex-token-watcher --codex-bin /opt/homebrew/bin/codex

# app-server 応答の待機時間を30秒にする
./codex-token-watcher --timeout 30

# 残量20%以下でポップアップを表示（既定の通知方式）
./codex-token-watcher --watch --notify-below 20

# 残量20%以下で通知センターに通知を出す
./codex-token-watcher --watch --notify-below 20 --notify-method notification

# 残量が20ポイント減るごとに通知する（80%、60%、40%、20%）
./codex-token-watcher --watch --notify-every 20

# 固定閾値と刻み通知を併用する
./codex-token-watcher --watch --notify-below 30 --notify-every 20
```

`--interval` は 60 以上の整数だけを受け付け、既定は 180 秒。`--timeout` は正整数だけを受け付ける。`--notify-below` は 0〜100 の整数、`--notify-every` は 1〜99 の整数を受け付ける。

`--filter <text>` を指定すると、各制限の表示名（`limitName` がなければ `limitId`）と期間（`primary` / `secondary`）を連結した文字列に対し、大文字・小文字を区別しない部分一致で絞り込む。省略時はすべての制限を表示する。フィルタは人向け表示、JSON/NDJSON、通知の対象に共通で適用される。

TTY 上の `--watch` は前回表示を更新する。パイプやリダイレクトなど非TTYでは、スナップショットを追記する。`--notify-below` または `--notify-every` 指定時の人向け表示には、各スナップショットに通知設定と方式を表示する。JSON 出力では one-shot は1個の JSON オブジェクト、watch は1行に1個の JSON（NDJSON）になる。JSON/NDJSON で通知を指定した場合、通知設定は起動時に1回だけ標準エラー出力へ表示する。診断と警告も標準エラー出力へ出るため、JSON の標準出力には混ざらない。

表示する残量は `100 - usedPercent` を 0〜100 の範囲に丸めたもの。300分の期間は「5時間」、10080分は「7日（週次）」と表示する。

## 通知

`--notify-below <percent>` を指定すると、残量が指定値以下になったときに `osascript` で通知する。`--notify-method <popup|notification>` で通知方式を選べ、既定は `popup`。

`--notify-every <percent>` を指定すると、100% から指定値を繰り返し引いた正の段階ごとに通知する。たとえば `--notify-every 20` の通知段階は 80%、60%、40%、20% となる。`--notify-below` と併用した場合は両方の閾値の和集合を使い、同じ段階は1回だけ通知する。

```sh
# 閉じるまで残るポップアップ（既定）
./codex-token-watcher --watch --notify-below 20

# ディスプレイ右上の通知センター通知
./codex-token-watcher --watch --notify-below 20 --notify-method notification
```

`--notify-every` の最初の取得時は、到達済みの通知段階を基準として記録するだけで通知しない。以後は上から下へ段階をまたいだときだけ通知し、複数段階を飛び越えた場合も最も低い到達段階を1回だけ通知する。`--notify-below` を指定した場合は、最初の取得時でも固定閾値以下なら通知する。リセット時刻が変わった新しい制限期間では、到達済みの段階を再び通知する。回復後に再低下した場合も再通知し、同じ段階内での繰り返し通知はしない。`popup` は「閉じる」ボタンを押すまで表示される。`notification` は macOS の通知センターへ表示され、通知の許可や表示スタイルは「システム設定 → 通知」で設定できる。表示に失敗しても監視は継続する。

どちらの方式でも、通知表示中に監視と1回実行の終了を待たない。

## 開発とテスト

テストはNode.js標準のテストランナーで実行する。

```sh
node --test
```

直接CLIを実行する場合は `node dist/cli.mjs` を使う。

app-server のプロトコルは [OpenAI 公式 app-server ドキュメント](https://learn.chatgpt.com/docs/app-server) に基づく。接続時は `initialize` の成功後に `initialized` を送り、`account/rateLimits/read` と `account/rateLimits/updated` を利用する。
