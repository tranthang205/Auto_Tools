const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authMiddleware, signToken } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email và mật khẩu bắt buộc' });
  if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Email đã tồn tại' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email.toLowerCase().trim(), hash);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = signToken(user);

  res.json({ token, user: formatUser(user) });
});

// Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email và mật khẩu bắt buộc' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email hoặc mật khẩu sai' });
  }

  db.prepare('UPDATE users SET last_login = datetime("now") WHERE id = ?').run(user.id);
  const token = signToken(user);

  res.json({ token, user: formatUser(user) });
});

// Verify token + get plan status
router.get('/verify', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Check if pro expired
  let plan = user.plan;
  if (plan === 'pro' && user.plan_expires_at) {
    if (new Date(user.plan_expires_at) < new Date()) {
      db.prepare('UPDATE users SET plan = "free", plan_expires_at = NULL WHERE id = ?').run(user.id);
      plan = 'free';
    }
  }

  // Reset daily counters if new day
  const today = new Date().toISOString().slice(0, 10);
  if (user.daily_reset !== today) {
    db.prepare('UPDATE users SET daily_likes = 0, daily_stories = 0, daily_reset = ? WHERE id = ?').run(today, user.id);
  }

  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);

  res.json({ user: formatUser(u) });
});

// Increment daily usage
router.post('/usage', authMiddleware, (req, res) => {
  const { type } = req.body; // 'like' or 'story'
  const today = new Date().toISOString().slice(0, 10);

  // Reset if new day
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (user.daily_reset !== today) {
    db.prepare('UPDATE users SET daily_likes = 0, daily_stories = 0, daily_reset = ? WHERE id = ?').run(today, req.userId);
  }

  if (type === 'like') {
    db.prepare('UPDATE users SET daily_likes = daily_likes + 1 WHERE id = ?').run(req.userId);
  } else if (type === 'story') {
    db.prepare('UPDATE users SET daily_stories = daily_stories + 1 WHERE id = ?').run(req.userId);
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json({ user: formatUser(updated) });
});

function formatUser(u) {
  return {
    id: u.id,
    email: u.email,
    plan: u.plan,
    planExpiresAt: u.plan_expires_at,
    dailyLikes: u.daily_likes || 0,
    dailyStories: u.daily_stories || 0,
    createdAt: u.created_at,
  };
}

module.exports = router;
