# のびのび歯科 電話システム

## 構成

```
患者の電話
  ↓
NTT ひかり電話（既存）
  ↓ ボイスワープで転送
Twilio 電話番号
  ↓
このサーバー（Render）
  ↓
営業時間内 → スタッフのスマホへ転送（20秒）→ 不在なら留守電
営業時間外 → 音声メッセージ → 留守電
```

---

## 初期セットアップ手順

### 1. Twilio アカウント作成

1. https://www.twilio.com/ja/ にアクセスしてアカウント登録
2. コンソール画面から **Account SID** と **Auth Token** をメモ
3. **電話番号の取得**：Phone Numbers → Manage → Buy a number
   - 国：Japan
   - 市外局番：任意（例：03, 06 など）
4. 取得した Twilio 番号をメモ

### 2. Render デプロイ

1. https://render.com でアカウント作成
2. 「New Web Service」→ このGitHubリポジトリを接続
3. 設定：
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
4. 環境変数を設定（後述）
5. デプロイ完了後、RenderのURL（例：`https://nobinobi-dental.onrender.com`）をメモ

### 3. 環境変数（Render の Environment タブで設定）

| 変数名 | 内容 |
|--------|------|
| `ADMIN_PASSWORD` | 設定画面のパスワード（自分で決める） |
| `LINE_CHANNEL_SECRET` | LINE Bot シークレット（既存） |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Bot トークン（既存） |
| `GMAIL_USER` | Gmailアドレス（既存） |
| `GMAIL_APP_PASSWORD` | Gmailアプリパスワード（既存） |
| `MAIL_TO` | 問診表の送信先メール（既存） |

### 4. Twilio Webhook 設定

Twilio コンソール → Phone Numbers → 取得した番号を選択

| 項目 | 設定値 |
|------|--------|
| A Call Comes In (Voice) | `https://あなたのRenderURL/twilio/voice` |
| Call Status Changes | `https://あなたのRenderURL/twilio/status` |

### 5. NTT ボイスワープ設定

- NTT に電話 または 116 に電話して「ボイスワープ」を申し込む（月額660円）
- 転送先番号：Twilio で取得した番号

---

## 設定画面

デプロイ後、ブラウザで以下にアクセス：

```
https://あなたのRenderURL/phone-admin
```

- **営業スケジュール**：曜日・時間帯を設定
- **例外日**：臨時休診・臨時診療を追加
- **設定**：転送先スタッフ電話番号（国際番号形式: +819012345678）
- **現在の状態**：手動で強制切替できる
- **着信履歴**：4コール以内の切断も含め全件記録

---

## 電話番号の形式（転送先設定時）

```
090-1234-5678 → +819012345678
03-1234-5678  → +81312345678
```
先頭の 0 を取り除いて +81 を付ける

---

## コスト目安（月額）

| 項目 | 金額 |
|------|------|
| NTT ボイスワープ基本料 | 660円 |
| NTT 転送通話料（500件×3分） | 約5,000円 |
| Twilio 電話番号 | 約170円 |
| Twilio 通話料（着信・転送） | 約8,000〜12,000円 |
| Render（無料プラン） | 0円 |
| **合計** | **約14,000〜18,000円** |

※ 現在のAI電話SaaS（60,000円/月）と比較して約40,000円削減

---

## 転送なしに変更する場合

設定画面の「転送先電話番号」を全て削除して保存するだけ。
その場合、着信はすべて音声メッセージ＋留守電対応になる。
（NTT ボイスワープの転送通話料もなくなる）
