const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      maker TEXT,
      item_code TEXT,
      stock INTEGER DEFAULT 0,
      alert_threshold INTEGER DEFAULT 5,
      photo_path TEXT,
      category TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id),
      quantity INTEGER NOT NULL,
      user_id INTEGER REFERENCES users(id),
      note TEXT,
      logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_logs (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id),
      quantity INTEGER NOT NULL,
      expiry_date TEXT,
      user_id INTEGER REFERENCES users(id),
      note TEXT,
      logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_lots (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id),
      expiry_date TEXT,
      quantity INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_url TEXT');
  } catch (e) {}

  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT');
  await pool.query('ALTER TABLE product_lots ADD COLUMN IF NOT EXISTS package_label TEXT');

  // Create default admin user if not exists
  const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
  if (rows.length === 0) {
    const hashed = bcrypt.hashSync('admin1234', 10);
    await pool.query(
      'INSERT INTO users (username, password, display_name) VALUES ($1, $2, $3)',
      ['admin', hashed, '管理者']
    );
  }
}

module.exports = { pool, initDb };
