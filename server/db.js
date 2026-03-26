const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'autofb.db'));

// Enable WAL mode for better concurrent reads
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    plan TEXT DEFAULT 'free' CHECK(plan IN ('free', 'pro')),
    plan_expires_at TEXT,
    daily_likes INTEGER DEFAULT 0,
    daily_stories INTEGER DEFAULT 0,
    daily_reset TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
  );
`);

module.exports = db;
