# 歯科在庫管理システム

歯科医院向けのシンプルな在庫管理Webアプリです。スマホ・タブレット・PCで使えます。

## 主な機能

- **写真でAI自動読み取り** — 商品の写真を撮るとClaude AIが商品名・メーカーを自動入力
- **ワンタップで使用記録** — 商品を選んで ＋/－ボタンで数量を記録するだけ
- **入荷記録** — 入荷時に在庫を追加
- **在庫不足アラート** — 設定した閾値を下回ると警告表示
- **ログイン機能** — スタッフごとにアカウント管理

## セットアップ

### 1. 依存関係のインストール

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. 環境変数の設定

```bash
cp .env.example backend/.env
```

`backend/.env` を編集して `ANTHROPIC_API_KEY` を設定してください。

### 3. 起動

**バックエンド（ターミナル1）:**
```bash
cd backend
node server.js
```

**フロントエンド（ターミナル2）:**
```bash
cd frontend
npm run dev
```

ブラウザで `http://localhost:5173` を開く。

## 初期ログイン

- ユーザー名: `admin`
- パスワード: `admin1234`

**最初にログインしてパスワードを変更するか、新しいアカウントを作成することを推奨します。**

## 技術スタック

| 部分 | 技術 |
|------|------|
| フロントエンド | React + Vite |
| バックエンド | Node.js + Express |
| データベース | SQLite (better-sqlite3) |
| AI | Claude API (Haiku) |
| 認証 | JWT |
