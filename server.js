const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fs = require('fs');

const { initializeDb } = require('./src/db');
const authRoutes = require('./src/routes/auth');
const manualRoutes = require('./src/routes/manuals');
const categoryRoutes = require('./src/routes/categories');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// アップロードディレクトリの確保
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const sessionDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

// ミドルウェア
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// セッション設定
app.use(session({
  store: new FileStore({ path: sessionDir, retries: 1 }),
  secret: process.env.SESSION_SECRET || 'manual-system-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7日間
    httpOnly: true,
    secure: false // HTTPSを使う場合はtrueに変更
  }
}));

// ルーティング
app.use('/api/auth', authRoutes);
app.use('/api/manuals', manualRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/admin', adminRoutes);

// PDFファイルの配信（認証済みのみ）
app.use('/uploads', (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '認証が必要です' });
  }
  next();
}, express.static(uploadDir));

// SPAのフォールバック（認証チェック付き）
app.get(['/', '/index.html'], (req, res) => {
  if (!req.session.userId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get(['/view.html', '/create.html'], (req, res) => {
  if (!req.session.userId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', req.path.slice(1)));
});

app.get('/admin.html', (req, res) => {
  if (!req.session.userId) return res.redirect('/login.html');
  if (req.session.role !== 'admin') return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// DB初期化してサーバー起動
initializeDb();
app.listen(PORT, () => {
  console.log(`\nマニュアルシステム起動中...`);
  console.log(`アクセスURL: http://localhost:${PORT}`);
  console.log(`初期管理者アカウント: admin / admin123\n`);
});
