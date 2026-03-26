const $ = id => document.getElementById(id);
let scenarios = [];
let sessionHistory = [];
let allLogs = [];
let editingIdx = -1;
let isRunning = false;
let timerInterval = null;
let timerStart = 0;

const DEFAULT_SCENARIOS = [
  { name: 'Seeding nhẹ', settings: { delay:5, maxLikes:15, autoScroll:true, enableComment:false, commentFreq:30, commentsPerPost:1, comments:[], enableStory:false, maxStories:3, storyLikeFreq:50, enableAddFriend:false, maxFriendRequests:5, friendKeywords:[], enableJoinGroup:false, maxGroups:3, groupKeywords:[] }},
  { name: 'Seeding mạnh', settings: { delay:3, maxLikes:50, autoScroll:true, enableComment:true, commentFreq:60, commentsPerPost:2, comments:['Hay quá!','Tuyệt vời!','Nice!','🔥','👍'], enableStory:true, maxStories:5, storyLikeFreq:80, enableAddFriend:true, maxFriendRequests:10, friendKeywords:[], enableJoinGroup:true, maxGroups:5, groupKeywords:[] }},
  { name: 'Chỉ like', settings: { delay:4, maxLikes:30, autoScroll:true, enableComment:false, commentFreq:0, commentsPerPost:1, comments:[], enableStory:false, maxStories:0, storyLikeFreq:0, enableAddFriend:false, maxFriendRequests:0, friendKeywords:[], enableJoinGroup:false, maxGroups:0, groupKeywords:[] }},
];

// ===== THEME =====
function applyTheme(t) {
  document.body.classList.toggle('light', t === 'light');
  const sun = document.querySelector('.icon-sun'), moon = document.querySelector('.icon-moon');
  if (sun) sun.style.display = t === 'light' ? 'none' : '';
  if (moon) moon.style.display = t === 'light' ? '' : 'none';
}
chrome.storage.local.get(['theme'], d => applyTheme(d.theme || 'dark'));
$('themeToggle').onclick = () => {
  const next = document.body.classList.contains('light') ? 'dark' : 'light';
  applyTheme(next); chrome.storage.local.set({ theme: next });
};

// ===== TABS =====
document.querySelectorAll('.tab').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('tab-' + t.dataset.tab).classList.add('active');
  };
});

// ===== TIMER =====
function startTimer(saved) {
  timerStart = saved || Date.now();
  const el = $('runTimer');
  if (el) el.style.display = '';
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
}
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const el = $('runTimer');
  if (el) el.style.display = 'none';
}
function updateTimer() {
  if (!timerStart) return;
  const s = Math.floor((Date.now() - timerStart) / 1000);
  const el = $('runTimer');
  if (el) el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// ===== LOAD STATE =====
chrome.storage.local.get(['scenarios', 'workflows', 'history', 'stats', 'isRunning', 'runStartTime', 'logs', 'aiSettings'], data => {
  scenarios = (data.scenarios && data.scenarios.length) ? data.scenarios : [...DEFAULT_SCENARIOS];
  workflows = data.workflows || [];
  history = data.history || [];
  allLogs = data.logs || [];

  if (data.isRunning) {
    isRunning = true;
    $('dot').className = 'dot on';
    $('statusText').textContent = 'Đang chạy';
    startTimer(data.runStartTime);
  }

  renderScenarios();
  renderDashboard();
  renderLogs();

  // AI settings
  if (data.aiSettings) {
    $('aiEnabled').checked = data.aiSettings.enabled || false;
    $('aiApiKey').value = data.aiSettings.apiKey || '';
    $('aiTone').value = data.aiSettings.tone || 'friendly';
    $('aiLang').value = data.aiSettings.lang || 'vi';
    $('aiMaxLen').value = data.aiSettings.maxLen || 100;
    $('aiSection').classList.toggle('visible', $('aiEnabled').checked);
  }
});

// ===== MESSAGES =====
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'stats-update') {
    const map = { dLike: 'liked', dCmt: 'commented', dFriend: 'friendsAdded', dStory: 'stories', dGroup: 'groupsJoined' };
    for (const [id, key] of Object.entries(map)) {
      const el = $(id);
      if (el) {
        const total = sessionHistory.reduce((a, h) => a + (h[key] || 0), 0) + (msg[key] || 0);
        el.textContent = total;
      }
    }
  }
  if (msg.type === 'log') {
    allLogs.push({ text: msg.text, type: msg.level, time: Date.now() });
    if (allLogs.length > 500) allLogs.splice(0, allLogs.length - 500);
    renderLogs();
  }
  if (msg.type === 'stopped') {
    isRunning = false;
    $('dot').className = 'dot';
    $('statusText').textContent = 'Sẵn sàng';
    stopTimer();
    // Reload history
    chrome.storage.local.get(['history'], d => { history = d.history || []; renderDashboard(); });
  }
});

// ===== DASHBOARD =====
function renderDashboard() {
  const totals = history.reduce((a, h) => ({
    liked: a.liked + (h.liked || 0),
    commented: a.commented + (h.commented || 0),
    friendsAdded: a.friendsAdded + (h.friendsAdded || 0),
    stories: a.stories + (h.stories || 0),
    groupsJoined: a.groupsJoined + (h.groupsJoined || 0),
  }), { liked: 0, commented: 0, friendsAdded: 0, stories: 0, groupsJoined: 0 });

  $('dLike').textContent = totals.liked;
  $('dCmt').textContent = totals.commented;
  $('dFriend').textContent = totals.friendsAdded;
  $('dStory').textContent = totals.stories;
  $('dGroup').textContent = totals.groupsJoined;
  $('dSessions').textContent = history.length;

  // Line chart (YouTube Studio style)
  drawLineChart(history.slice(-10));

  // Session history list
  const list = $('sessionList');
  if (history.length === 0) {
    list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:20px">Chưa có dữ liệu</div>';
    return;
  }
  list.innerHTML = '';
  [...history].reverse().slice(0, 20).forEach(h => {
    const item = document.createElement('div');
    item.className = 'session-item';
    const d = new Date(h.date || h.time || Date.now());
    const dateStr = d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    // duration is in milliseconds — convert to minutes
    const durMs = h.duration || 0;
    const durMin = Math.floor(durMs / 60000);
    const durSec = Math.floor((durMs % 60000) / 1000);
    const dur = durMs > 0 ? (durMin > 0 ? durMin + ' phút ' + durSec + 's' : durSec + ' giây') : '--';
    item.innerHTML = '<span class="session-date">' + dateStr + '</span>' +
      '<span class="session-stats">' + (h.liked || 0) + ' like · ' + (h.commented || 0) + ' cmt · ' + (h.friendsAdded || 0) + ' bạn · ' + (h.stories || 0) + ' story · ' + (h.groupsJoined || 0) + ' nhóm</span>' +
      '<span class="session-duration">' + dur + '</span>';
    list.appendChild(item);
  });
}

// ===== LINE CHART (Canvas, YouTube Studio style) =====
function drawLineChart(data) {
  const canvas = $('chartCanvas');
  if (!canvas || !data.length) {
    if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text3'); ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Chưa có dữ liệu', canvas.width / 2, canvas.height / 2); }
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  const padL = 35, padR = 10, padT = 10, padB = 24;
  const cW = W - padL - padR, cH = H - padT - padB;

  const cs = getComputedStyle(document.body);
  const textColor = cs.getPropertyValue('--text3').trim();
  const gridColor = cs.getPropertyValue('--border').trim();

  const series = [
    { key: 'liked', color: '#6366f1', label: 'Like' },
    { key: 'commented', color: '#10b981', label: 'Comment' },
    { key: 'friendsAdded', color: '#f59e0b', label: 'Kết bạn' },
    { key: 'stories', color: '#3b82f6', label: 'Story' },
    { key: 'groupsJoined', color: '#a78bfa', label: 'Nhóm' },
  ];

  // Find max value across all series
  let maxVal = 1;
  data.forEach(d => { series.forEach(s => { maxVal = Math.max(maxVal, d[s.key] || 0); }); });
  maxVal = Math.ceil(maxVal * 1.15); // 15% headroom

  // Grid lines
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const y = padT + (cH / gridSteps) * i;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillStyle = textColor; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal - (maxVal / gridSteps) * i), padL - 4, y + 3);
  }

  // X labels
  ctx.fillStyle = textColor; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  data.forEach((d, i) => {
    const x = padL + (cW / (data.length - 1 || 1)) * i;
    const dt = new Date(d.date || d.time || Date.now());
    ctx.fillText(dt.getDate() + '/' + (dt.getMonth() + 1), x, H - 4);
  });

  // Draw lines
  series.forEach(s => {
    const vals = data.map(d => d[s.key] || 0);
    if (vals.every(v => v === 0)) return; // skip empty series

    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = padL + (cW / (data.length - 1 || 1)) * i;
      const y = padT + cH - (v / maxVal) * cH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill area under line (subtle)
    ctx.fillStyle = s.color + '18'; // alpha
    ctx.lineTo(padL + cW, padT + cH);
    ctx.lineTo(padL, padT + cH);
    ctx.closePath();
    ctx.fill();

    // Dots
    vals.forEach((v, i) => {
      if (v === 0) return;
      const x = padL + (cW / (data.length - 1 || 1)) * i;
      const y = padT + cH - (v / maxVal) * cH;
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    });
  });
}

// ===== SCENARIOS =====
function renderScenarios() {
  const el = $('scenarioList');
  el.innerHTML = '';
  scenarios.forEach((sc, i) => {
    const item = document.createElement('div');
    item.className = 'scenario-item' + (i === editingIdx ? ' selected' : '');
    const s = sc.settings || {};
    const desc = [];
    desc.push('Like ' + (s.maxLikes || 0));
    if (s.enableComment) desc.push('Cmt ' + (s.commentFreq || 0) + '%');
    if (s.enableAddFriend) desc.push('KB ' + (s.maxFriendRequests || 0));
    if (s.enableStory) desc.push('Story ' + (s.maxStories || 0));
    if (s.enableJoinGroup) desc.push('Nhóm ' + (s.maxGroups || 0));
    if (s.enablePage) {
      const pa = { create: 'Tạo Page', invite: 'Mời like', post: 'Đăng bài' };
      desc.push(pa[s.pageAction] || 'Page');
    }
    const infoDiv = document.createElement('div');
    infoDiv.className = 'scenario-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'scenario-name';
    nameEl.textContent = sc.name;
    const descEl = document.createElement('div');
    descEl.className = 'scenario-desc';
    descEl.textContent = desc.join(' · ') + ' · delay ' + (s.delay || 3) + 's';
    infoDiv.appendChild(nameEl);
    infoDiv.appendChild(descEl);
    item.appendChild(infoDiv);
    const actDiv = document.createElement('div');
    actDiv.className = 'scenario-actions';
    actDiv.innerHTML = '<button class="btn btn-ghost btn-sm" data-dup="' + i + '">Nhân bản</button><button class="btn btn-ghost btn-sm" data-edit="' + i + '">Sửa</button><button class="btn btn-danger btn-sm" data-del="' + i + '">Xóa</button>';
    item.appendChild(actDiv);
    el.appendChild(item);
  });

  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editScenario(+b.dataset.edit));
  el.querySelectorAll('[data-dup]').forEach(b => b.onclick = () => {
    const src = scenarios[+b.dataset.dup];
    scenarios.push({ name: src.name + ' (bản sao)', settings: { ...src.settings } });
    saveScenarios(); renderScenarios();
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (confirm('Xóa kịch bản "' + scenarios[+b.dataset.del].name + '"?')) {
      scenarios.splice(+b.dataset.del, 1); saveScenarios(); renderScenarios();
    }
  });
}

function editScenario(idx) {
  editingIdx = idx;
  const sc = scenarios[idx];
  const s = sc.settings || {};
  $('scenarioEditor').style.display = '';
  $('scenarioPlaceholder').style.display = 'none';
  $('scName').value = sc.name;
  $('scMaxLikes').value = s.maxLikes || 15;
  $('scDelay').value = s.delay || 3;
  $('scAutoScroll').checked = s.autoScroll !== false;
  $('scEnableComment').checked = s.enableComment || false;
  $('scCommentFreq').value = s.commentFreq || 50;
  $('scCommentsPerPost').value = s.commentsPerPost || 1;
  $('scCommentList').value = (s.comments || []).join('\n');
  $('scSelfLikeComment').checked = s.selfLikeComment !== false;
  $('scCommentSection').classList.toggle('visible', $('scEnableComment').checked);
  $('scEnableStory').checked = s.enableStory || false;
  $('scMaxStories').value = s.maxStories || 5;
  $('scStoryLikeFreq').value = s.storyLikeFreq || 70;
  $('scStorySection').classList.toggle('visible', $('scEnableStory').checked);
  $('scEnableAddFriend').checked = s.enableAddFriend || false;
  $('scMaxFriends').value = s.maxFriendRequests || 10;
  $('scFriendKeywords').value = (s.friendKeywords || []).join('\n');
  $('scFriendSection').classList.toggle('visible', $('scEnableAddFriend').checked);
  $('scEnableJoinGroup').checked = s.enableJoinGroup || false;
  $('scMaxGroups').value = s.maxGroups || 5;
  $('scGroupKeywords').value = (s.groupKeywords || []).join('\n');
  $('scGroupSection').classList.toggle('visible', $('scEnableJoinGroup').checked);
  // Page settings
  $('scEnablePage').checked = s.enablePage || false;
  $('scPageAction').value = s.pageAction || 'create';
  $('scPageName').value = s.pageName || '';
  $('scPageCategory').value = s.pageCategory || '';
  $('scPageBio').value = s.pageBio || '';
  $('scPageUrl').value = s.pageUrl || '';
  $('scPageInviteMax').value = s.pageInviteMax || 20;
  $('scPagePostUrl').value = s.pagePostUrl || '';
  $('scPagePostContent').value = s.pagePostContent || '';
  $('scPageUseAI').checked = s.pageUseAI || false;
  $('scPageAITopic').value = s.pageAITopic || '';
  $('scPageSection').classList.toggle('visible', $('scEnablePage').checked);
  $('scPageAISection').classList.toggle('visible', $('scPageUseAI').checked);
  updatePageActionFields();
  renderScenarios();
}

$('scEnableComment').onchange = () => $('scCommentSection').classList.toggle('visible', $('scEnableComment').checked);
$('scEnableStory').onchange = () => $('scStorySection').classList.toggle('visible', $('scEnableStory').checked);
$('scEnableAddFriend').onchange = () => $('scFriendSection').classList.toggle('visible', $('scEnableAddFriend').checked);
$('scEnableJoinGroup').onchange = () => $('scGroupSection').classList.toggle('visible', $('scEnableJoinGroup').checked);
$('scEnablePage').onchange = () => $('scPageSection').classList.toggle('visible', $('scEnablePage').checked);
$('scPageUseAI').onchange = () => $('scPageAISection').classList.toggle('visible', $('scPageUseAI').checked);

// Toggle page action sub-fields
function updatePageActionFields() {
  const action = $('scPageAction').value;
  $('scPageCreateFields').style.display = action === 'create' ? '' : 'none';
  $('scPageInviteFields').style.display = action === 'invite' ? '' : 'none';
  $('scPagePostFields').style.display = action === 'post' ? '' : 'none';
}
$('scPageAction').onchange = updatePageActionFields;

$('btnSaveScenario').onclick = () => {
  if (editingIdx < 0) return;
  scenarios[editingIdx] = {
    name: $('scName').value || 'Kịch bản',
    settings: {
      delay: Math.max(2, +$('scDelay').value || 3),
      maxLikes: +$('scMaxLikes').value || 0,
      autoScroll: $('scAutoScroll').checked,
      enableComment: $('scEnableComment').checked,
      commentFreq: +$('scCommentFreq').value || 50,
      commentsPerPost: +$('scCommentsPerPost').value || 1,
      selfLikeComment: $('scSelfLikeComment').checked,
      comments: $('scCommentList').value.split('\n').map(l => l.trim()).filter(Boolean),
      enableStory: $('scEnableStory').checked,
      maxStories: +$('scMaxStories').value || 5,
      storyLikeFreq: +$('scStoryLikeFreq').value || 70,
      enableAddFriend: $('scEnableAddFriend').checked,
      maxFriendRequests: +$('scMaxFriends').value || 10,
      friendKeywords: $('scFriendKeywords').value.split('\n').map(l => l.trim()).filter(Boolean),
      enableJoinGroup: $('scEnableJoinGroup').checked,
      maxGroups: +$('scMaxGroups').value || 5,
      groupKeywords: $('scGroupKeywords').value.split('\n').map(l => l.trim()).filter(Boolean),
      enablePage: $('scEnablePage').checked,
      pageAction: $('scPageAction').value,
      pageName: $('scPageName').value.trim(),
      pageCategory: $('scPageCategory').value,
      pageBio: $('scPageBio').value.trim(),
      pageUrl: $('scPageUrl').value.trim(),
      pageInviteMax: +$('scPageInviteMax').value || 20,
      pagePostUrl: $('scPagePostUrl').value.trim(),
      pagePostContent: $('scPagePostContent').value.trim(),
      pageUseAI: $('scPageUseAI').checked,
      pageAITopic: $('scPageAITopic').value.trim(),
    },
  };
  saveScenarios();
  renderScenarios();
  closeScenarioEditor();
};

$('btnCancelScenario').onclick = closeScenarioEditor;
function closeScenarioEditor() {
  editingIdx = -1;
  $('scenarioEditor').style.display = 'none';
  $('scenarioPlaceholder').style.display = '';
  renderScenarios();
}

$('btnNewScenario').onclick = () => {
  scenarios.push({ name: 'Kịch bản mới', settings: { ...DEFAULT_SCENARIOS[0].settings } });
  saveScenarios();
  editScenario(scenarios.length - 1);
};

function saveScenarios() { chrome.storage.local.set({ scenarios }); }

// Page FB is now part of scenario editor - actions handled by content.js via auto-mix

// ===== AI COMMENT =====
$('aiEnabled').onchange = () => {
  $('aiSection').classList.toggle('visible', $('aiEnabled').checked);
  saveAISettings();
};
['aiApiKey', 'aiTone', 'aiLang', 'aiMaxLen'].forEach(id => {
  $(id).onchange = saveAISettings;
  $(id).oninput = saveAISettings;
});

function saveAISettings() {
  const aiSettings = {
    enabled: $('aiEnabled').checked,
    apiKey: $('aiApiKey').value,
    tone: $('aiTone').value,
    lang: $('aiLang').value,
    maxLen: +$('aiMaxLen').value || 100,
  };
  chrome.storage.local.set({ aiSettings });
}

$('btnTestAI').onclick = async () => {
  const key = $('aiApiKey').value;
  if (!key) { $('aiTestResult').textContent = 'Chưa nhập API key'; $('aiTestResult').style.color = 'var(--red)'; return; }
  $('aiTestResult').textContent = 'Đang kiểm tra...';
  $('aiTestResult').style.color = 'var(--text3)';
  try {
    const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Trả lời "OK" nếu bạn nhận được tin nhắn này.' }] }] }),
    });
    if (resp.ok) {
      $('aiTestResult').textContent = 'Kết nối thành công!';
      $('aiTestResult').style.color = 'var(--green)';
    } else {
      const err = await resp.json();
      $('aiTestResult').textContent = 'Lỗi: ' + (err.error?.message || resp.status);
      $('aiTestResult').style.color = 'var(--red)';
    }
  } catch (e) {
    $('aiTestResult').textContent = 'Lỗi kết nối: ' + e.message;
    $('aiTestResult').style.color = 'var(--red)';
  }
};

// ===== LOGS =====
function renderLogs() {
  const area = $('logArea');
  const search = ($('logSearch').value || '').toLowerCase();
  const filter = $('logFilter').value;
  const filtered = allLogs.filter(l => {
    if (filter !== 'all' && l.type !== filter) return false;
    if (search && !l.text.toLowerCase().includes(search)) return false;
    return true;
  });
  if (!filtered.length) {
    area.innerHTML = '<div class="log-entry info">Không có nhật ký phù hợp</div>';
    return;
  }
  area.innerHTML = '';
  filtered.slice(-200).forEach(l => {
    const div = document.createElement('div');
    div.className = 'log-entry ' + (l.type || 'info');
    const t = new Date(l.time || Date.now()).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.textContent = '[' + t + '] ' + l.text;
    area.appendChild(div);
  });
  area.scrollTop = area.scrollHeight;
}

$('logSearch').oninput = renderLogs;
$('logFilter').onchange = renderLogs;
$('btnClearLog').onclick = () => { allLogs = []; chrome.storage.local.set({ logs: [] }); renderLogs(); };
$('btnExportLog').onclick = () => {
  const text = allLogs.map(l => {
    const t = new Date(l.time || Date.now()).toLocaleString('vi-VN');
    return '[' + t + '] [' + (l.type || 'info') + '] ' + l.text;
  }).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'autofb-log-' + new Date().toISOString().slice(0, 10) + '.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ===== SETTINGS TAB =====
// Load global settings
chrome.storage.local.get(['globalSettings'], d => {
  const g = d.globalSettings || {};
  if ($('gPauseCaptcha')) $('gPauseCaptcha').checked = g.pauseCaptcha !== false;
  if ($('gAutoScroll')) $('gAutoScroll').checked = g.autoScroll !== false;
  if ($('gRandomPct')) $('gRandomPct').value = g.randomPct || 30;
});

function saveGlobalSettings() {
  chrome.storage.local.set({ globalSettings: {
    pauseCaptcha: $('gPauseCaptcha').checked,
    autoScroll: $('gAutoScroll').checked,
    randomPct: +$('gRandomPct').value || 30,
  }});
}
['gPauseCaptcha', 'gAutoScroll'].forEach(id => { if ($(id)) $(id).onchange = saveGlobalSettings; });
if ($('gRandomPct')) $('gRandomPct').onchange = saveGlobalSettings;

// Clear history
if ($('btnClearHistory')) $('btnClearHistory').onclick = () => {
  if (confirm('Xóa toàn bộ lịch sử phiên chạy?')) {
    history = [];
    chrome.storage.local.set({ history: [] });
    renderDashboard();
  }
};

// Clear all logs
if ($('btnClearAllLogs')) $('btnClearAllLogs').onclick = () => {
  if (confirm('Xóa toàn bộ nhật ký?')) {
    allLogs = [];
    chrome.storage.local.set({ logs: [] });
    renderLogs();
  }
};

// Export config
if ($('btnExportConfig')) $('btnExportConfig').onclick = () => {
  chrome.storage.local.get(null, data => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'autofb-config-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
};

// Import config
if ($('btnImportConfig')) $('btnImportConfig').onclick = () => $('importFile').click();
if ($('importFile')) $('importFile').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      // Validate: only allow known keys
      const allowed = ['scenarios','workflows','schedules','aiSettings','globalSettings','history','logs','commentedPosts'];
      const clean = {};
      for (const k of allowed) { if (data[k] !== undefined) clean[k] = data[k]; }
      if (Object.keys(clean).length === 0) { alert('File không chứa dữ liệu AutoFB hợp lệ'); return; }
      if (confirm('Nhập cấu hình sẽ ghi đè cài đặt hiện tại. Tiếp tục?')) {
        chrome.storage.local.set(clean, () => location.reload());
      }
    } catch { alert('File JSON không hợp lệ'); }
  };
  reader.readAsText(file);
};
