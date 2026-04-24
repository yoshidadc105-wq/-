const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dental-inventory-secret-key-2024';

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '認証が必要です' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'トークンが無効です' });
  }
};
