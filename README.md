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

# 残量20%以下でMac 通知センターに通知を出す
./codex-token-watcher --watch --notify-below 20 --notify-method notification

# 残量が20%減るごとに通知する（80%、60%、40%、20%）
./codex-token-watcher --watch --notify-every 20

# 固定閾値と刻み通知を併用する
./codex-token-watcher --watch --notify-below 30 --notify-every 20
```

`--interval` は 60 以上の整数だけを受け付け、既定は 180 秒。`--timeout` は正整数だけを受け付ける。利用量取得に失敗した場合は 10 秒、20 秒、30 秒後に計 3 回再試行し、初回を含む最大 4 回がすべて失敗した場合は既存どおりエラー終了する。`--notify-below` は 0〜100 の整数、`--notify-every` は 1〜99 の整数を受け付ける。

`--filter <text>` を指定すると、各制限の表示名（`limitName` がなければ `limitId`）と期間（`primary` / `secondary`）を連結した文字列に対し、大文字・小文字を区別しない部分一致で絞り込む。省略時はすべての制限を表示する。フィルタは人向け表示、JSON/NDJSON、通知の対象に共通で適用される。

TTY 上の `--watch` は前回表示を更新する。パイプやリダイレクトなど非TTYでは、スナップショットを追記する。`--notify-below` または `--notify-every` 指定時の人向け表示には、各スナップショットに通知設定と方式を表示する。JSON 出力では one-shot は1個の JSON オブジェクト、watch は1行に1個の JSON（NDJSON）になる。JSON/NDJSON で通知を指定した場合、通知設定は起動時に1回だけ標準エラー出力へ表示する。診断と警告も標準エラー出力へ出るため、JSON の標準出力には混ざらない。

表示する残量は `100 - usedPercent` を 0〜100 の範囲に丸めたもの。300分の期間は「5時間」、10080分は「7日（週次）」と表示する。

## 通知

`--notify-below <percent>` を指定すると、残量が指定値以下になったときに `osascript` で通知する。`--notify-method <popup|notification>` で通知方式を選べ、既定は `popup`。

`--notify-every <percent>` を指定すると、100% から指定値を繰り返し引いた正の段階ごとに通知する。たとえば `--notify-every 20` の通知段階は 80%、60%、40%、20% となる。`--notify-below` と併用した場合は両方の閾値の和集合を使い、同じ段階は1回だけ通知する。

```sh
# 閉じるまで残るポップアップ（既定）
./codex-token-watcher --watch --notify-below 20

# ディスプレイ右上のMac 通知センター通知
./codex-token-watcher --watch --notify-below 20 --notify-method notification
```

`--notify-every` の最初の取得時は、到達済みの通知段階を基準として記録するだけで通知しない。以後は上から下へ段階をまたいだときだけ通知し、複数段階を飛び越えた場合も最も低い到達段階を1回だけ通知する。`--notify-below` を指定した場合は、最初の取得時でも固定閾値以下なら通知する。監視中は、前回提示されたリセット日時を過ぎて残量が回復した場合にも1回通知する。リセット時刻の変動だけ、日時の通過だけ、リセット前の残量回復では通知しない。残量が通知段階より上へ回復してから再低下した場合は再通知する。同じ段階内での繰り返し通知はしない。`popup` は「閉じる」ボタンを押すまで表示される。`notification` は Mac 通知センターへ表示され、通知の許可や表示スタイルは「システム設定 → 通知」で設定できる。表示に失敗しても監視は継続する。

どちらの方式でも、通知表示中に監視と1回実行の終了を待たない。

## 開発とテスト

テストはNode.js標準のテストランナーで実行する。

```sh
node --test
```

直接CLIを実行する場合は `node dist/cli.mjs` を使う。

app-server のプロトコルは [OpenAI 公式 app-server ドキュメント](https://learn.chatgpt.com/docs/app-server) に基づく。接続時は `initialize` の成功後に `initialized` を送り、`account/rateLimits/read` と `account/rateLimits/updated` を利用する。

---

## claude-token-watcher

Claude Code Pro/Max の公式 `statusLine` 機能を使って利用制限の残量を表示・監視する macOS 向けコマンド。

### 前提条件

- macOS、Node.js 20 以上
- **Claude Code v2.1.251 以降**
- **Claude Pro または Max プラン**（`statusLine` の利用量データが提供されるプラン）

### statusLine の設定

Claude Code の `~/.claude/settings.json` に以下の `statusLine` キーを追加し、Claude Code を再起動する。既存の設定キーは残す。`<PATH>` はこのリポジトリの絶対パスに置き換える。

```json
{
  "statusLine": {
    "type": "command",
    "command": "<PATH>/claude-token-watcher --statusline"
  }
}
```

この設定により、Claude Code が `claude-token-watcher --statusline` を呼び出し、利用状況 JSON を stdin に渡す。コマンドは stdout に短い残量表示を返し、値が変わったときに内部キャッシュを更新する。同じ値の再送だけでは受信時刻を更新せず、古い値を新鮮な情報として扱わない。

> **注意**: このツールは `~/.claude/settings.json` や認証情報を読まず、編集もしない。

### 使い方

```sh
# 最後に受信した利用量を1回表示
./claude-token-watcher

# JSON で1回表示
./claude-token-watcher --json

# 表示名と期間で絞り込む（大文字・小文字を区別しない部分一致）
./claude-token-watcher --filter "five_hour"

# 180秒ごとに表示を更新する（Ctrl+C で終了）
./claude-token-watcher --watch

# 5分ごとに表示を更新する
./claude-token-watcher --watch --interval 300

# watch + NDJSON
./claude-token-watcher --watch --json

# 残量20%以下でポップアップ通知（--watch と組み合わせて使う）
./claude-token-watcher --watch --notify-below 20

# 残量20%以下で Mac 通知センターへ通知
./claude-token-watcher --watch --notify-below 20 --notify-method notification

# 残量が20%減るごとに通知する（80%、60%、40%、20%）
./claude-token-watcher --watch --notify-every 20

# 固定閾値と刻み通知を併用する
./claude-token-watcher --watch --notify-below 30 --notify-every 20
```

### 表示形式

```
最終受信日時: 2026-09-22 10:30:00
Claude / five_hour / 5時間: 残量 54.5%（使用 45.5%）/ リセット 2026-09-22 15:00:00
Claude / seven_day / 7日（週次）: 残量 77%（使用 23%）/ リセット 2026-09-29 10:30:00
```

キャッシュが 300 秒以上古い、またはいずれかの期間のリセット時刻を過ぎている場合は「参考値・情報が古い可能性あり」と注記する。stale 値では通知しない。JSON 出力には `stale` フラグ（boolean）が含まれる。

ヘッダ行は「最終受信日時」であり現在のリアルタイム取得値ではない。

### キャッシュの制限

- キャッシュは `--statusline` が呼ばれたときだけ更新される。**Claude Code が停止中・アイドル中（会話していない状態）は更新されない。**
- キャッシュは Node.js のユーザー用一時ディレクトリ配下の `claude-token-watcher-<uid>/cache.json` に保存される（ディレクトリ 0700、ファイル 0600）。
- キャッシュには使用率・リセット時刻・受信日時のみ保存する。トークンや認証情報は含まない。

直接CLIを実行する場合は `node dist/claude-cli.mjs` を使う。
