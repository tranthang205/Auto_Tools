const $ = id => document.getElementById(id);
let isRunning = false;
let scenarios = [];
let timerInterval = null;
let timerStart = 0;
let currentUser = null;

// ===== CONFIG =====
const API_URL = 'https://trancongthang.vn/autofb-api'; // Change to your server URL

const DEFAULT_SCENARIOS = [
  { name: 'Seeding nhẹ', settings: { delay:5, maxLikes:15, autoScroll:true, enableComment:false, commentFreq:30, commentsPerPost:1, comments:[], enableStory:false, maxStories:3, storyLikeFreq:50, enableAddFriend:false, maxFriendRequests:5, friendKeywords:[], enableJoinGroup:false, maxGroups:3, groupKeywords:[] }},
  { name: 'Seeding mạnh', settings: { delay:3, maxLikes:50, autoScroll:true, enableComment:true, commentFreq:60, commentsPerPost:2, comments:['Hay quá!','Tuyệt vời!','Nice!','🔥','👍'], enableStory:true, maxStories:5, storyLikeFreq:80, enableAddFriend:true, maxFriendRequests:10, friendKeywords:[], enableJoinGroup:true, maxGroups:5, groupKeywords:[] }},
  { name: 'Chỉ like', settings: { delay:4, maxLikes:30, autoScroll:true, enableComment:false, commentFreq:0, commentsPerPost:1, comments:[], enableStory:false, maxStories:0, storyLikeFreq:0, enableAddFriend:false, maxFriendRequests:0, friendKeywords:[], enableJoinGroup:false, maxGroups:0, groupKeywords:[] }},
];

const FREE_LIMITS = { dailyLikes: 5, dailyStories: 3 };

// ===== THEME =====
function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
  const sun = document.querySelector('.icon-sun');
  const moon = document.querySelector('.icon-moon');
  if (sun) sun.style.display = theme === 'light' ? 'none' : '';
  if (moon) moon.style.display = theme === 'light' ? '' : 'none';
}
chrome.storage.local.get(['theme'], d => applyTheme(d.theme || 'dark'));
$('themeToggle').onclick = () => {
  const next = document.body.classList.contains('light') ? 'dark' : 'light';
  applyTheme(next);
  chrome.storage.local.set({ theme: next });
};

// ===== AUTH =====
let authMode = 'login'; // login | register

function showAuth() {
  $('authScreen').style.display = 'block';
  $('userBar').style.display = 'none';
  $('mainBody').style.display = 'none';
}

function showMain(user) {
  currentUser = user;
  $('authScreen').style.display = 'none';
  $('userBar').style.display = 'flex';
  $('mainBody').style.display = 'block';
  $('userEmail').textContent = user.email;

  const badge = $('planBadge');
  if (user.plan === 'pro') {
    badge.textContent = 'PRO';
    badge.className = 'plan-badge pro';
    $('limitWarn').style.display = 'none';
  } else {
    badge.textContent = 'FREE';
    badge.className = 'plan-badge free';
    $('limitWarn').style.display = 'block';
    $('limitText').textContent = FREE_LIMITS.dailyLikes + ' like + ' + FREE_LIMITS.dailyStories + ' story/ngày';
  }

  // Save plan info for content.js to check
  chrome.storage.local.set({
    userPlan: user.plan,
    dailyLikes: user.dailyLikes || 0,
    dailyStories: user.dailyStories || 0,
    freeLimits: FREE_LIMITS,
  });

  // Limit scenarios for free users
  if (user.plan === 'free') {
    // Free: only first scenario
    const sel = $('scenarioSelect');
    for (let i = 1; i < sel.options.length; i++) {
      sel.options[i].disabled = true;
      sel.options[i].textContent += ' (Pro)';
    }
  }
}

function showAuthError(msg) {
  const el = $('authError');
  el.textContent = msg;
  el.style.display = 'block';
}

$('authSwitchLink').onclick = () => {
  authMode = authMode === 'login' ? 'register' : 'login';
  $('btnAuth').textContent = authMode === 'login' ? 'Đăng nhập' : 'Đăng ký';
  $('authSwitchText').textContent = authMode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?';
  $('authSwitchLink').textContent = authMode === 'login' ? 'Đăng ký' : 'Đăng nhập';
  $('authError').style.display = 'none';
};

$('btnAuth').onclick = async () => {
  const email = $('authEmail').value.trim();
  const pass = $('authPass').value;
  if (!email || !pass) return showAuthError('Nhập email và mật khẩu');

  $('btnAuth').disabled = true;
  $('btnAuth').textContent = 'Đang xử lý...';

  try {
    const resp = await fetch(API_URL + '/api/auth/' + authMode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Lỗi server');

    // Save token
    chrome.storage.local.set({ authToken: data.token, authUser: data.user });
    showMain(data.user);
  } catch (e) {
    showAuthError(e.message);
  } finally {
    $('btnAuth').disabled = false;
    $('btnAuth').textContent = authMode === 'login' ? 'Đăng nhập' : 'Đăng ký';
  }
};

$('btnLogout').onclick = () => {
  chrome.storage.local.remove(['authToken', 'authUser', 'userPlan']);
  currentUser = null;
  showAuth();
};

// Verify token on load
async function verifyAuth() {
  const data = await chrome.storage.local.get(['authToken', 'authUser']);
  if (!data.authToken) { showAuth(); return; }

  try {
    const resp = await fetch(API_URL + '/api/auth/verify', {
      headers: { 'Authorization': 'Bearer ' + data.authToken },
    });
    if (!resp.ok) throw new Error('Token expired');
    const result = await resp.json();
    chrome.storage.local.set({ authUser: result.user });
    showMain(result.user);
  } catch {
    // Offline? Use cached user data
    if (data.authUser) {
      showMain(data.authUser);
    } else {
      chrome.storage.local.remove(['authToken', 'authUser']);
      showAuth();
    }
  }
}

// ===== TIMER =====
function startTimer(saved) {
  timerStart = saved || Date.now();
  $('timerRow').style.display = 'flex';
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
}
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}
function updateTimer() {
  if (!timerStart) return;
  const s = Math.floor((Date.now() - timerStart) / 1000);
  $('runTimer').textContent = String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
}

// ===== UI =====
function setRunUI(on, savedStart) {
  const btn = $('btnRun');
  btn.textContent = on ? 'Dừng lại' : 'Bắt đầu';
  btn.className = 'btn btn-run' + (on ? ' stop' : '');
  $('dot').className = 'dot' + (on ? ' on' : '');
  $('statusText').textContent = on ? 'Đang chạy' : 'Sẵn sàng';
  if (on) startTimer(savedStart); else stopTimer();
}

function updateStats(s) {
  $('sLike').textContent = s.liked || 0;
  $('sCmt').textContent = s.commented || 0;
  $('sFriend').textContent = s.friendsAdded || 0;
  $('sStory').textContent = s.stories || 0;
  $('sGroup').textContent = s.groupsJoined || 0;
}

function populateSelect() {
  const sel = $('scenarioSelect');
  sel.innerHTML = '';
  scenarios.forEach((sc, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = sc.name;
    sel.appendChild(opt);
  });
}

// ===== LOAD STATE =====
chrome.storage.local.get(['scenarios','isRunning','stats','runStartTime','activeScenarioIdx'], data => {
  scenarios = (data.scenarios && data.scenarios.length) ? data.scenarios : [...DEFAULT_SCENARIOS];
  populateSelect();
  if (data.activeScenarioIdx >= 0) $('scenarioSelect').value = data.activeScenarioIdx;
  if (data.stats) updateStats(data.stats);
  if (data.isRunning) {
    isRunning = true;
    setRunUI(true, data.runStartTime || Date.now());
  }
  // Auth check
  verifyAuth();
});

// ===== MESSAGES FROM CONTENT =====
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'stats-update') updateStats(msg);
  if (msg.type === 'stopped') { isRunning = false; setRunUI(false); }
});

// ===== AUTO-STOP =====
let autoStopTimeout = null;

function setupAutoStop() {
  if (autoStopTimeout) { clearTimeout(autoStopTimeout); autoStopTimeout = null; }
  const mins = +$('autoStopSelect').value;
  if (mins > 0 && isRunning) {
    autoStopTimeout = setTimeout(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) { try { await chrome.tabs.sendMessage(tab.id, { type: 'stop' }); } catch {} }
      isRunning = false;
      setRunUI(false);
      chrome.storage.local.set({ isRunning: false, autoStopAt: null });
    }, mins * 60 * 1000);
    chrome.storage.local.set({ autoStopAt: Date.now() + mins * 60 * 1000 });
  }
}

chrome.storage.local.get(['autoStopMins'], d => {
  if (d.autoStopMins) $('autoStopSelect').value = d.autoStopMins;
});
$('autoStopSelect').onchange = () => {
  chrome.storage.local.set({ autoStopMins: $('autoStopSelect').value });
  if (isRunning) setupAutoStop();
};

// ===== RUN / STOP =====
$('btnRun').onclick = async () => {
  // Must be logged in
  if (!currentUser) { showAuth(); return; }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('facebook.com')) {
    alert('Hãy mở Facebook trước!');
    return;
  }

  isRunning = !isRunning;
  const now = Date.now();
  setRunUI(isRunning, isRunning ? now : undefined);

  const idx = +$('scenarioSelect').value;

  // Free users can only use first scenario
  if (currentUser.plan === 'free' && idx > 0) {
    alert('Kịch bản này chỉ dành cho Pro. Nâng cấp để sử dụng.');
    isRunning = false;
    setRunUI(false);
    return;
  }

  const settings = JSON.parse(JSON.stringify(scenarios[idx]?.settings || scenarios[0]?.settings));

  // Inject plan limits into settings
  settings._plan = currentUser.plan;
  settings._freeLimits = FREE_LIMITS;
  settings._dailyLikes = currentUser.dailyLikes || 0;
  settings._dailyStories = currentUser.dailyStories || 0;

  const store = { isRunning, settings, activeScenarioIdx: idx };
  if (isRunning) { store.runStartTime = now; setupAutoStop(); }
  else { if (autoStopTimeout) { clearTimeout(autoStopTimeout); autoStopTimeout = null; } chrome.storage.local.remove('autoStopAt'); }
  chrome.storage.local.set(store);

  const message = { type: isRunning ? 'start' : 'stop', settings };

  let sent = false;
  for (let attempt = 0; attempt < 3 && !sent; attempt++) {
    try {
      await chrome.tabs.sendMessage(tab.id, message);
      sent = true;
    } catch {
      if (attempt === 0) {
        try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch {}
      }
      await new Promise(r => setTimeout(r, 1000 + attempt * 500));
    }
  }

  if (!sent) {
    if (isRunning) {
      chrome.storage.local.set({ isRunning: true, settings, pendingStart: true });
    } else {
      isRunning = false; setRunUI(false); chrome.storage.local.set({ isRunning: false });
    }
  }
};

// ===== UPGRADE LINK =====
$('upgradeLink').onclick = (e) => {
  e.preventDefault();
  // Open contact page or payment page
  chrome.tabs.create({ url: 'https://trancongthang.vn/autofb-pro' });
};

// ===== OPEN DASHBOARD =====
$('btnDash').onclick = () => { chrome.runtime.openOptionsPage(); };
