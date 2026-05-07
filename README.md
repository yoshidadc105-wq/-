# のびのび歯科・矯正歯科 問診表システム

## 概要

LINE経由で患者に問診表URLを送付し、回答をメール通知・PrintNode経由で自動印刷するシステムです。

---

## PrintNode セットアップ（院内 Windows PC）

### インストール手順

1. [printnode.com](https://www.printnode.com) からクライアントをダウンロード
2. インストーラー（.exeファイル）を**右クリック → 「管理者として実行」**
3. インストール中に **「Install PrintNode as a Windows Service」にチェックを入れる**
4. 「Next」で進めてインストール完了

> **管理者として実行が必要な理由**
> Windowsサービスとして登録するには管理者権限が必要です。
> 通常ダブルクリックで実行すると権限不足エラーが出ます。
> 必ず右クリック→「管理者として実行」で起動してください。

### Windowsサービスとしてインストールする理由

| 項目 | デスクトップアプリ | **Windowsサービス（推奨）** |
|------|-------------------|---------------------------|
| PC起動時の自動起動 | 手動で起動が必要 | **自動で起動** |
| ログインなしで動作 | 不可 | **可** |
| 問診表の自動印刷 | PCログイン後のみ | **PC起動直後から可** |

診察時間中は常時印刷できる状態にしておく必要があるため、Windowsサービスでの運用を推奨します。

### 起動確認

インストール後、PrintNodeの管理画面（printnode.com）にアクセスし、院内PCのプリンターが「Online」と表示されていれば正常です。

---

## 環境変数設定

`.env.example` をコピーして `.env` を作成し、各項目を設定してください。

```
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
PRINTNODE_API_KEY=...
PRINTNODE_PRINTER_ID=...
GMAIL_USER=...
GMAIL_APP_PASSWORD=...
MAIL_TO=...
ADMIN_PASSWORD=...
```

---

## 起動

```bash
npm install
node server.js
```
