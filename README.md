# のびのび歯科・矯正歯科 問診表システム

## 概要

LINE経由で患者に問診表URLを送付し、回答をメール通知・PrintNode経由で自動印刷するシステムです。

---

## PrintNode セットアップ（院内 Windows PC）

### インストール手順

1. [printnode.com](https://www.printnode.com) からクライアントをダウンロード
2. インストーラー（.exeファイル）を**右クリック → 「管理者として実行」**
3. インストール中に **「Install PrintNode as a Windows Service」のチェックは外したまま**にする
4. 「Next」で進めてインストール完了

> **Windowsサービスにしない理由**
> PrintNodeインストーラーに以下の警告が表示されます：
> 「Windowsサービスとしてインストールすると LocalSystem アカウントで動作し、
> プリンターの設定やネットワークプリンターへのアクセスで予期しない問題が起きる可能性があります。
> サーバー環境やマルチテナント環境以外ではデスクトップアプリとしてのインストールを推奨します。」
>
> 院内PCはスタッフがログインして使う通常のWindowsのため、**デスクトップアプリが適切**です。

### ログイン時の自動起動設定

デスクトップアプリは毎朝Windowsにログインすると自動で起動するよう設定できます。

1. `Win + R` キーを押して `shell:startup` と入力 → Enter
2. 開いたフォルダに PrintNode のショートカットを置く

これでログイン後すぐに問診表の自動印刷が有効になります。

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
