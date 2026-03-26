const express = require('express');
const db = require('../db');

const router = express.Router();
const ADMIN_PASS = process.env.ADMIN_PASS || 'autofb-admin-2026';

// Simple admin auth
function adminAuth(req, res, next) {
  // Check cookie or query param
  const pass = req.cookies?.admin_pass || req.query.pass || req.body?.admin_pass;
  if (pass === ADMIN_PASS) {
    next();
  } else if (req.method === 'GET' && !req.query.pass) {
    // Show login form
    res.send(loginPage());
  } else {
    res.status(403).send('Sai mật khẩu admin');
  }
}

router.use(adminAuth);

// Dashboard
router.get('/', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  const total = users.length;
  const proCount = users.filter(u => u.plan === 'pro').length;

  res.send(dashboardPage(users, total, proCount));
});

// Activate Pro
router.post('/activate', (req, res) => {
  const { userId, months } = req.body;
  const m = parseInt(months) || 1;
  const expires = new Date();
  expires.setMonth(expires.getMonth() + m);

  db.prepare('UPDATE users SET plan = "pro", plan_expires_at = ? WHERE id = ?')
    .run(expires.toISOString(), userId);

  res.redirect('/admin?pass=' + ADMIN_PASS);
});

// Deactivate Pro
router.post('/deactivate', (req, res) => {
  const { userId } = req.body;
  db.prepare('UPDATE users SET plan = "free", plan_expires_at = NULL WHERE id = ?').run(userId);
  res.redirect('/admin?pass=' + ADMIN_PASS);
});

// Delete user
router.post('/delete', (req, res) => {
  const { userId } = req.body;
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  res.redirect('/admin?pass=' + ADMIN_PASS);
});

function loginPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>AutoFB Admin</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#0f0f0f;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:40px;width:340px;text-align:center}
h1{color:#6366f1;margin-bottom:20px;font-size:22px}
input{width:100%;padding:12px;border:1px solid #333;border-radius:8px;background:#111;color:#e0e0e0;font-size:14px;margin-bottom:16px}
button{width:100%;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
button:hover{opacity:.9}</style></head><body>
<div class="card"><h1>AutoFB Admin</h1>
<form method="GET"><input type="password" name="pass" placeholder="Mật khẩu admin" required>
<button type="submit">Đăng nhập</button></form></div></body></html>`;
}

function dashboardPage(users, total, proCount) {
  const rows = users.map(u => {
    const expired = u.plan === 'pro' && u.plan_expires_at && new Date(u.plan_expires_at) < new Date();
    const expStr = u.plan_expires_at ? new Date(u.plan_expires_at).toLocaleDateString('vi-VN') : '--';
    const planBadge = u.plan === 'pro'
      ? (expired ? '<span style="color:#f59e0b">HẾT HẠN</span>' : '<span style="color:#10b981">PRO</span>')
      : '<span style="color:#9ca3af">FREE</span>';

    return `<tr>
      <td>${u.id}</td><td>${u.email}</td><td>${planBadge}</td><td>${expStr}</td>
      <td>${u.daily_likes || 0}</td><td>${new Date(u.created_at).toLocaleDateString('vi-VN')}</td>
      <td>
        ${u.plan !== 'pro' ? `
        <form method="POST" action="/admin/activate?pass=${ADMIN_PASS}" style="display:inline">
          <input type="hidden" name="userId" value="${u.id}"><input type="hidden" name="admin_pass" value="${ADMIN_PASS}">
          <select name="months" style="padding:4px;background:#222;color:#e0e0e0;border:1px solid #444;border-radius:4px">
            <option value="1">1 tháng</option><option value="3">3 tháng</option>
            <option value="6">6 tháng</option><option value="12">1 năm</option>
          </select>
          <button type="submit" style="padding:4px 8px;background:#10b981;border:none;color:#fff;border-radius:4px;cursor:pointer;font-size:12px">Kích hoạt</button>
        </form>` : `
        <form method="POST" action="/admin/deactivate?pass=${ADMIN_PASS}" style="display:inline">
          <input type="hidden" name="userId" value="${u.id}"><input type="hidden" name="admin_pass" value="${ADMIN_PASS}">
          <button type="submit" style="padding:4px 8px;background:#ef4444;border:none;color:#fff;border-radius:4px;cursor:pointer;font-size:12px">Hủy Pro</button>
        </form>`}
        <form method="POST" action="/admin/delete?pass=${ADMIN_PASS}" style="display:inline" onsubmit="return confirm('Xóa user này?')">
          <input type="hidden" name="userId" value="${u.id}"><input type="hidden" name="admin_pass" value="${ADMIN_PASS}">
          <button type="submit" style="padding:4px 8px;background:#333;border:1px solid #555;color:#999;border-radius:4px;cursor:pointer;font-size:12px">Xóa</button>
        </form>
      </td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>AutoFB Admin</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#0f0f0f;color:#e0e0e0;padding:30px}
h1{color:#6366f1;margin-bottom:6px;font-size:24px}.subtitle{color:#666;margin-bottom:24px;font-size:14px}
.stats{display:flex;gap:16px;margin-bottom:24px}.stat-card{background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:20px;flex:1;text-align:center}
.stat-num{font-size:28px;font-weight:700;color:#6366f1}.stat-lbl{color:#888;font-size:12px;margin-top:4px}
table{width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:10px;overflow:hidden}
th{background:#222;padding:12px;text-align:left;font-size:12px;color:#888;text-transform:uppercase}
td{padding:10px 12px;border-top:1px solid #2a2a2a;font-size:13px}
tr:hover td{background:#1f1f1f}</style></head><body>
<h1>AutoFB Admin</h1><p class="subtitle">Quản lý người dùng & subscription</p>
<div class="stats">
  <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-lbl">Tổng users</div></div>
  <div class="stat-card"><div class="stat-num" style="color:#10b981">${proCount}</div><div class="stat-lbl">Pro users</div></div>
  <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${total - proCount}</div><div class="stat-lbl">Free users</div></div>
</div>
<table><thead><tr><th>#</th><th>Email</th><th>Plan</th><th>Hết hạn</th><th>Like hôm nay</th><th>Ngày tạo</th><th>Hành động</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
}

module.exports = router;
