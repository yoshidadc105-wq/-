const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fs = require('fs');
const os = require('os');
const { initializeDb } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), 'ManualSystemData');
const SESSION_DIR = path.join(DATA_DIR, 'sessions');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

initializeDb();

app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(session({
  store: new FileStore({ path: SESSION_DIR, ttl: 86400, retries: 0 }),
  secret: process.env.SESSION_SECRET || 'manual-system-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
app.use('/uploads', (req, res, next) => {
  if (!req.session || !req.session.userId) return res.status(401).send('Unauthorized');
  next();
}, express.static(UPLOAD_DIR));

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/manuals', require('./src/routes/manuals'));
app.use('/api/categories', require('./src/routes/categories'));
app.use('/api/groups', require('./src/routes/groups'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/progress', require('./src/routes/progress'));
app.use('/api/settings', require('./src/routes/settings'));
app.use('/api/url-redirects', require('./src/routes/url-redirects'));
app.use('/api/quiz', require('./src/routes/quiz-api'));
app.use('/api/restore', require('./src/routes/restore'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 全APIエラーをJSONで返す（HTML返却を防止）
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) {
    return res.status(err.status || err.statusCode || 500).json({ error: err.message || '予期せぬエラーが発生しました' });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log('マニュアルシステム起動: port=' + PORT);
});
