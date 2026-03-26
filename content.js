(() => {
  // ===== STATE =====
  let running = false, loopActive = false, abortCtrl = null;
  let currentPhase = 'liking'; // liking | adding_friends | searching_people | viewing_stories | joining_groups | back_to_feed
  let settings = {
    delay: 3, maxLikes: 20, autoScroll: true,
    enableComment: false, commentFreq: 50, commentsPerPost: 1, comments: [],
    enableStory: false, maxStories: 5, storyLikeFreq: 70,
    enableAddFriend: false, maxFriendRequests: 10,
    friendKeywords: [],
    enableJoinGroup: false, maxGroups: 5, groupKeywords: [],
  };
  let stats = { liked: 0, commented: 0, friendsAdded: 0, stories: 0, groupsJoined: 0, skipped: 0 };
  let clickedBtns = new WeakSet();
  let commentedPostIds = new Set();
  let errorCount = 0; // track consecutive errors for restart limit

  const DEFAULT_COMMENTS = [
    'Hay quá!', 'Tuyệt vời!', 'Nice!', 'Rất hay', 'Like mạnh',
    'Đẹp quá', 'Quá đỉnh', 'Cảm ơn bạn', 'Hay lắm', 'So nice',
  ];

  // ===== AUTO-DISMISS "Leave page?" DIALOG =====
  // Facebook shows this when comment input has text and we try to navigate
  const STAY_LABELS = ['Stay on Page', 'Ở lại trang', 'Stay on page', 'Ở lại', 'Tiếp tục chỉnh sửa'];
  const dialogObserver = new MutationObserver(() => {
    // Look for dialog with "Leave page?" / "Rời khỏi trang?"
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const dialog of dialogs) {
      const text = dialog.innerText || '';
      if (text.includes('Leave page') || text.includes('Rời khỏi trang') || text.includes('haven\'t finished') || text.includes('chưa hoàn tất')) {
        // Find "Stay on Page" button
        const btns = dialog.querySelectorAll('[role="button"], button');
        for (const btn of btns) {
          const btnText = btn.innerText.trim();
          if (STAY_LABELS.some(l => btnText.includes(l))) {
            btn.click();
            console.log('[AutoFB] Auto-clicked "Stay on Page"');
            return;
          }
        }
        // Fallback: click the X/close button
        const closeBtn = dialog.querySelector('[aria-label="Close"], [aria-label="Đóng"]');
        if (closeBtn) { closeBtn.click(); return; }
      }
    }
  });
  dialogObserver.observe(document.body, { childList: true, subtree: true });

  // Track if we're intentionally navigating (side action, back to feed, etc.)
  let intentionalNav = false;

  // Block accidental navigation when comment is in progress
  window.addEventListener('beforeunload', (e) => {
    if (intentionalNav) return; // We want to navigate — don't block
    // Only block if there's an active comment input with text
    const active = document.activeElement;
    if (active && active.getAttribute('contenteditable') === 'true' && active.textContent.trim().length > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ===== MULTI-LANG LABELS =====
  const LIKE_LABELS = ['Thích', 'Like', "J'aime", 'Gefällt mir', 'Me gusta', 'Curtir'];
  const UNLIKE_LABELS = ['Bỏ thích', 'Unlike', "Je n'aime plus", 'Gefällt mir nicht mehr'];
  const COMMENT_LABELS = ['Bình luận', 'Comment', 'Commenter', 'Kommentieren', 'Comentar', 'Comentário'];
  const COMMENT_INPUT_HINTS = [
    'bình luận', 'comment', 'viết phản hồi', 'write a reply',
    'write a comment', 'write a public comment', 'répondre',
  ];
  const ADD_FRIEND_LABELS = [
    'Thêm bạn bè', 'Thêm bạn', 'Kết bạn', 'Add friend', 'Add Friend',
    'Ajouter', 'Freund/in hinzufügen', 'Agregar', 'Adicionar',
  ];
  const CANCEL_FRIEND_LABELS = [
    'Hủy lời mời', 'Hủy yêu cầu', 'Đã gửi lời mời',
    'Cancel request', 'Cancel Request', 'Request sent',
  ];
  const JOIN_GROUP_LABELS = [
    'Tham gia nhóm', 'Tham gia', 'Join group', 'Join Group', 'Join',
    'Rejoindre le groupe', 'Rejoindre', 'Beitreten', 'Unirse', 'Entrar',
  ];
  const ALREADY_JOINED_LABELS = [
    'Đã tham gia', 'Joined', 'Rời nhóm', 'Leave group', 'Đã gửi',
    'Pending', 'Chờ phê duyệt', 'Hủy yêu cầu',
  ];

  // ===== PAGE DETECTION =====
  function detectPage() {
    const p = window.location.pathname;
    const q = window.location.search;
    if (p.includes('/search/groups') || (p.includes('/search') && q.includes('groups'))) return 'search_groups';
    if (p.includes('/search/people') || (p.includes('/search') && q.includes('people'))) return 'search_people';
    if (p.includes('/stories')) return 'stories';
    if (p.includes('/friends')) return 'friends';
    if (p.match(/\/groups\/\d+\/members/)) return 'group_members';
    if (p.includes('/groups')) return 'groups';
    if (p === '/' || p === '' || p.includes('/home') || p === '/?') return 'feed';
    // Facebook feed can have various query params
    if (p === '/' || (p.length <= 2 && !p.includes('/groups'))) return 'feed';
    return 'other';
  }

  function reportPage() {
    const page = detectPage();
    chrome.runtime.sendMessage({ type: 'page-update', page }).catch(() => {});
  }

  // ===== MESSAGE HANDLER =====
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'start') {
      // Silently reset without sending 'stopped' back to popup
      running = false;
      if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
      loopActive = false;

      settings = msg.settings || settings;
      stats = { liked: 0, commented: 0, friendsAdded: 0, stories: 0, groupsJoined: 0 };
      clickedBtns = new WeakSet();
      commentedPostIds = new Set();
      // likedPostIds persists — don't clear
      currentPhase = 'liking';
      running = true;
      createLogPanel();
      chrome.storage.local.set({ phase: 'liking', stats, isRunning: true, activeWorkflow: null });
      reportPage();
      incrementSession();
      startMainLoop();
    }
    if (msg.type === 'start-workflow') {
      running = false;
      if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
      loopActive = false;
      stats = { liked: 0, commented: 0, friendsAdded: 0, stories: 0, groupsJoined: 0 };
      clickedBtns = new WeakSet();
      commentedPostIds = new Set();
      currentPhase = 'workflow';
      running = true;
      chrome.storage.local.set({ phase: 'workflow', stats, isRunning: true, activeWorkflow: msg.workflow });
      reportPage();
      incrementSession();
      runWorkflow(msg.workflow);
    }
    if (msg.type === 'stop') stopAll();

    // Page FB commands
    if (msg.type === 'create-page') handleCreatePage(msg);
    if (msg.type === 'invite-friends-page') handleInviteFriends(msg);
    if (msg.type === 'post-to-page') handlePostToPage(msg);
  });

  // ===== RESUME AFTER PAGE RELOAD =====
  chrome.storage.local.get(['isRunning', 'settings', 'phase', 'stats', 'commentedPosts', 'pendingStart'], (d) => {
    // Check for pending start (popup couldn't reach us, saved intent to storage)
    if (d.pendingStart && d.isRunning && !running) {
      chrome.storage.local.remove('pendingStart');
      settings = d.settings || settings;
      stats = { liked: 0, commented: 0, friendsAdded: 0, stories: 0, groupsJoined: 0 };
      clickedBtns = new WeakSet();
      commentedPostIds = new Set();
      // likedPostIds persists — don't clear
      currentPhase = 'liking';
      running = true;
      chrome.storage.local.set({ phase: 'liking', stats, isRunning: true });
      reportPage();
      incrementSession();
      log('Bắt đầu (từ pending)...', 'info');
      setTimeout(() => startMainLoop(), 2000);
      return;
    }
    const page = detectPage();
    console.log('[AutoFB] Init: isRunning=' + d.isRunning + ' phase=' + d.phase + ' page=' + page + ' url=' + window.location.pathname);

    if (d.isRunning && !running) {
      settings = d.settings || settings;
      stats = d.stats || stats;
      currentPhase = d.phase || 'liking';
      if (d.commentedPosts) commentedPostIds = new Set(d.commentedPosts);
      running = true;
      createLogPanel();
      reportPage();
      log('Resume: phase=' + currentPhase + ' page=' + page);

      if (currentPhase === 'adding_friends') {
        if (page === 'friends') {
          log('Resume: bat dau add friend...', 'info');
          setTimeout(() => doAddFriendOnPage(), 3000);
        } else {
          log('Resume: chua o trang friends, chuyen...', 'warn');
          navigateTo('https://www.facebook.com/friends/suggestions');
        }
      } else if (currentPhase === 'searching_people') {
        if (page === 'search_people' || page === 'group_members') {
          log('Resume: kết bạn từ tìm kiếm...', 'info');
          setTimeout(() => doFriendByKeywordOnPage(), 3000);
        } else {
          // Navigate back
          const kw = (settings.friendKeywords && settings.friendKeywords.length) ? settings.friendKeywords[0] : '';
          if (kw) {
            navigateTo('https://www.facebook.com/search/people?q=' + encodeURIComponent(kw));
          } else {
            currentPhase = 'back_to_feed';
            chrome.storage.local.set({ phase: 'back_to_feed', isRunning: true });
            navigateTo('https://www.facebook.com/');
          }
        }
      } else if (currentPhase === 'joining_groups') {
        if (page === 'search_groups') {
          log('Resume: bat dau join group...', 'info');
          setTimeout(() => doJoinGroupsOnPage(), 3000);
        } else {
          // Navigate to search with first keyword
          const kw = (settings.groupKeywords && settings.groupKeywords.length) ? settings.groupKeywords[0] : '';
          if (kw) {
            navigateTo('https://www.facebook.com/search/groups?q=' + encodeURIComponent(kw));
          } else {
            currentPhase = 'back_to_feed';
            chrome.storage.local.set({ phase: 'back_to_feed', isRunning: true });
            navigateTo('https://www.facebook.com/');
          }
        }
      } else if (currentPhase === 'viewing_stories') {
        if (page === 'stories') {
          setTimeout(() => doViewStoriesOnPage(), 3000);
        } else {
          navigateTo('https://www.facebook.com/stories');
        }
      } else if (currentPhase === 'back_to_feed') {
        currentPhase = 'liking';
        chrome.storage.local.set({ phase: 'liking' });
        log('Quay về feed, tiếp tục like...', 'info');
        if (page === 'feed') {
          setTimeout(() => startMainLoop(), 2000);
        } else {
          navigateTo('https://www.facebook.com/');
        }
      } else {
        // phase = 'liking'
        log('Resume: bắt đầu like trên feed...', 'info');
        setTimeout(() => startMainLoop(), 2000);
      }
    }
  });

  // ===== FLOATING LOG PANEL =====
  let logPanel = null;
  let logBody = null;
  let logVisible = true;

  function createLogPanel() {
    if (logPanel) return;
    logPanel = document.createElement('div');
    logPanel.id = 'autofb-log';
    logPanel.innerHTML = `
      <div id="autofb-log-header">
        <span style="font-weight:600;color:#6366f1">AutoFB</span>
        <span id="autofb-log-status" style="font-size:10px;color:#10b981">● Đang chạy</span>
        <div style="display:flex;gap:4px">
          <button id="autofb-log-min" title="Thu nhỏ">−</button>
          <button id="autofb-log-close" title="Ẩn">×</button>
        </div>
      </div>
      <div id="autofb-log-stats"></div>
      <div id="autofb-log-body"></div>
    `;
    const style = document.createElement('style');
    style.textContent = `
      #autofb-log {
        position: fixed; bottom: 16px; right: 16px; width: 320px; z-index: 99999;
        background: rgba(18,18,24,0.95); border: 1px solid #2c2d32; border-radius: 10px;
        font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size: 11px;
        color: #c9cdd3; box-shadow: 0 4px 24px rgba(0,0,0,0.4); backdrop-filter: blur(8px);
        overflow: hidden; transition: height 0.2s;
      }
      #autofb-log.minimized #autofb-log-body, #autofb-log.minimized #autofb-log-stats { display: none; }
      #autofb-log.minimized { width: 180px; }
      #autofb-log-header {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 8px 12px; background: rgba(30,30,42,0.9); border-bottom: 1px solid #2c2d32;
        cursor: move; user-select: none;
      }
      #autofb-log-header button {
        background: none; border: none; color: #72757e; font-size: 14px; cursor: pointer;
        width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
        border-radius: 4px;
      }
      #autofb-log-header button:hover { background: #2c2d32; color: #fff; }
      #autofb-log-stats {
        display: flex; gap: 2px; padding: 6px 10px; background: rgba(25,25,35,0.8);
        border-bottom: 1px solid #2c2d32;
      }
      .afb-stat { flex:1; text-align:center; padding: 3px 0; }
      .afb-stat-n { font-size: 14px; font-weight: 700; color: #6366f1; }
      .afb-stat-l { font-size: 8px; color: #72757e; }
      #autofb-log-body {
        max-height: 180px; overflow-y: auto; padding: 6px 10px;
        font-family: 'SF Mono','Consolas',monospace; font-size: 10px; line-height: 1.6;
      }
      #autofb-log-body::-webkit-scrollbar { width: 3px; }
      #autofb-log-body::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
      .afb-log { padding: 1px 0; }
      .afb-log.success { color: #10b981; }
      .afb-log.warn { color: #f59e0b; }
      .afb-log.info { color: #72757e; }
      .afb-log .afb-time { color: #4b5563; margin-right: 4px; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(logPanel);
    logBody = document.getElementById('autofb-log-body');

    // Minimize button
    document.getElementById('autofb-log-min').onclick = () => {
      logPanel.classList.toggle('minimized');
    };

    // Close button
    document.getElementById('autofb-log-close').onclick = () => {
      logPanel.style.display = 'none';
      logVisible = false;
    };

    // Draggable
    let dragging = false, dx = 0, dy = 0;
    const header = document.getElementById('autofb-log-header');
    header.onmousedown = (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      dx = e.clientX - logPanel.getBoundingClientRect().left;
      dy = e.clientY - logPanel.getBoundingClientRect().top;
      e.preventDefault();
    };
    document.onmousemove = (e) => {
      if (!dragging) return;
      logPanel.style.left = (e.clientX - dx) + 'px';
      logPanel.style.top = (e.clientY - dy) + 'px';
      logPanel.style.right = 'auto';
      logPanel.style.bottom = 'auto';
    };
    document.onmouseup = () => { dragging = false; };

    updateLogStats();
  }

  function removeLogPanel() {
    if (logPanel) {
      const status = document.getElementById('autofb-log-status');
      if (status) { status.textContent = '● Dừng'; status.style.color = '#ef4444'; }
    }
  }

  function updateLogStats() {
    const el = document.getElementById('autofb-log-stats');
    if (!el) return;
    el.innerHTML = [
      { n: stats.liked, l: 'Like' },
      { n: stats.commented, l: 'Cmt' },
      { n: stats.friendsAdded, l: 'Bạn' },
      { n: stats.stories, l: 'Story' },
      { n: stats.groupsJoined, l: 'Nhóm' },
    ].map(s => `<div class="afb-stat"><div class="afb-stat-n">${s.n}</div><div class="afb-stat-l">${s.l}</div></div>`).join('');
  }

  function appendLogEntry(text, level) {
    if (!logBody) return;
    const div = document.createElement('div');
    div.className = 'afb-log ' + level;
    const t = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.innerHTML = '<span class="afb-time">' + t + '</span>' + text.replace(/</g, '&lt;');
    logBody.appendChild(div);
    // Keep max 50 entries
    while (logBody.children.length > 50) logBody.removeChild(logBody.firstChild);
    logBody.scrollTop = logBody.scrollHeight;
    updateLogStats();
  }

  // ===== UTILS =====
  function log(text, level = 'info') {
    console.log('[AutoFB]', text);
    chrome.runtime.sendMessage({ type: 'log', text, level }).catch(() => {});
    // Also show in floating panel
    if (running || logPanel) {
      if (!logPanel) createLogPanel();
      appendLogEntry(text, level);
    }
  }
  function updateStats() {
    chrome.runtime.sendMessage({ type: 'stats-update', ...stats }).catch(() => {});
    chrome.storage.local.set({ stats });
  }
  function sleep(ms) {
    return new Promise((resolve, reject) => {
      if (abortCtrl && abortCtrl.signal.aborted) return reject(new Error('aborted'));
      const id = setTimeout(resolve, ms);
      if (abortCtrl) abortCtrl.signal.addEventListener('abort', () => { clearTimeout(id); reject(new Error('aborted')); }, { once: true });
    });
  }
  let globalRandomPct = 30;
  // Load global settings once
  chrome.storage.local.get(['globalSettings'], d => {
    if (d.globalSettings) globalRandomPct = d.globalSettings.randomPct || 30;
  });
  function rDelay(sec) {
    const variance = globalRandomPct / 100;
    return Math.max(1500, (sec + (Math.random() - 0.5) * sec * variance * 2) * 1000);
  }
  function scroll() { window.scrollBy({ top: 500 + Math.random() * 500, behavior: 'smooth' }); }
  function matchLabel(btn, labels) {
    const a = (btn.getAttribute('aria-label') || '').trim();
    const t = btn.innerText.trim();
    return labels.some(l => a === l || t === l || a.toLowerCase() === l.toLowerCase() || t.toLowerCase() === l.toLowerCase());
  }

  // ===== GET POST ID (for tracking commented posts) =====
  function getPostId(likeBtn) {
    // Walk up to find a link with a post URL or a unique data attribute
    let el = likeBtn;
    for (let i = 0; i < 20 && el; i++) {
      // Check for any link pointing to a post
      const links = el.querySelectorAll('a[href*="/posts/"], a[href*="/photo"], a[href*="story_fbid"], a[href*="/videos/"], a[href*="permalink"]');
      if (links.length > 0) {
        const href = links[0].getAttribute('href');
        // Extract a unique part
        const match = href.match(/(posts\/|story_fbid=|photo[^/]*\/|videos\/|permalink\/)([^&?/]+)/);
        if (match) return match[2];
        return href.substring(0, 80);
      }
      // Check for aria-label timestamp links (common post identifier)
      const timeLinks = el.querySelectorAll('a[href*="facebook.com"]');
      for (const tl of timeLinks) {
        if (tl.querySelector('span') && tl.getAttribute('href').length > 30) {
          return tl.getAttribute('href').substring(0, 80);
        }
      }
      el = el.parentElement;
    }
    // Fallback: use button position as ID (not great but avoids duplicates during session)
    const r = likeBtn.getBoundingClientRect();
    return 'pos_' + Math.round(r.top) + '_' + Math.round(r.left);
  }

  // Track liked posts — persisted to storage so we never like→unlike
  let likedPostIds = new Set();

  // Load from storage on init
  chrome.storage.local.get(['likedPosts'], d => {
    if (d.likedPosts) likedPostIds = new Set(d.likedPosts);
  });

  function saveLikedPosts() {
    // Keep last 500 to avoid storage bloat
    const arr = [...likedPostIds].slice(-500);
    chrome.storage.local.set({ likedPosts: arr });
  }

  function getBtnHash(btn) {
    // Walk up to find ANY unique link for this post
    let p = btn.parentElement;
    for (let i = 0; i < 12 && p; i++) {
      // Method 1: Post-specific links
      const links = p.querySelectorAll('a[href*="/posts/"], a[href*="story_fbid"], a[href*="/photo"], a[href*="/videos/"], a[href*="permalink"], a[href*="comment_id"]');
      if (links.length > 0) {
        const href = links[0].getAttribute('href');
        const match = href.match(/(posts\/|story_fbid=|photo[^/]*\/|videos\/|permalink\/|comment_id=)([^&?/]+)/);
        if (match) return match[2];
        return href.substring(0, 100);
      }
      // Method 2: Any FB link with unique ID pattern
      const anyLinks = p.querySelectorAll('a[href*="facebook.com"]');
      for (const link of anyLinks) {
        const href = link.getAttribute('href') || '';
        // Match patterns like /username/posts/123, /photo/?fbid=123, etc
        const idMatch = href.match(/[?&/](fbid|id|story_fbid|set|v)=?(\d{10,})/);
        if (idMatch) return idMatch[2];
      }
      p = p.parentElement;
    }
    // Method 3: Use the text content hash as fallback (better than null)
    let textContainer = btn.parentElement;
    for (let i = 0; i < 10 && textContainer; i++) {
      const text = textContainer.innerText || '';
      if (text.length > 50) {
        // Simple hash of first 100 chars of post text
        let hash = 0;
        const sample = text.substring(0, 100);
        for (let j = 0; j < sample.length; j++) {
          hash = ((hash << 5) - hash) + sample.charCodeAt(j);
          hash |= 0;
        }
        return 'txt_' + Math.abs(hash);
      }
      textContainer = textContainer.parentElement;
    }
    return null;
  }

  // ===== FIND LIKE BUTTONS =====
  function findLikeButtons() {
    const results = [];
    for (const btn of document.querySelectorAll('div[role="button"]')) {
      if (clickedBtns.has(btn)) continue;
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Only include buttons in or near the visible viewport
      if (r.top < -200 || r.top > window.innerHeight + 200) continue;
      if (matchLabel(btn, LIKE_LABELS) && !matchLabel(btn, UNLIKE_LABELS)) {
        // Skip if we already liked this post (persisted across sessions)
        const hash = getBtnHash(btn);
        if (hash && likedPostIds.has(hash)) {
          clickedBtns.add(btn); // Mark so we don't check again
          continue;
        }
        results.push(btn);
      }
    }
    return results;
  }

  // ===== FIND LIKE BUTTON IN CURRENT VIEW (dialog or page) =====
  function findLikeButtonInView() {
    // Prefer button inside a dialog (post detail overlay)
    const dialog = document.querySelector('[role="dialog"]');
    const scope = dialog || document;
    for (const btn of scope.querySelectorAll('div[role="button"]')) {
      if (matchLabel(btn, LIKE_LABELS) && !matchLabel(btn, UNLIKE_LABELS)) {
        const r = btn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return btn;
      }
    }
    // Also check for already-liked button (to know state)
    for (const btn of scope.querySelectorAll('div[role="button"]')) {
      if (matchLabel(btn, UNLIKE_LABELS)) {
        const r = btn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return btn; // Return it — caller checks label
      }
    }
    return null;
  }

  // ===== FIND COMMENT BUTTON =====
  function findCommentBtn(likeBtn) {
    let c = likeBtn.parentElement;
    for (let i = 0; i < 12 && c; i++) {
      for (const btn of c.querySelectorAll('div[role="button"]')) {
        if (btn === likeBtn) continue;
        if (matchLabel(btn, COMMENT_LABELS)) return btn;
      }
      c = c.parentElement;
    }
    return null;
  }

  // ===== HELPERS =====
  function sendBg(msg) { return new Promise(r => chrome.runtime.sendMessage(msg, resp => r(resp || { success: false }))); }

  // Safe navigation — set flag so beforeunload doesn't block
  function navigateTo(url) {
    intentionalNav = true;
    navigateTo(url);
  }

  // Type text into Facebook's Lexical editor character by character
  // Lexical only accepts text from proper keyboard event sequences
  async function typeText(element, text) {
    element.focus();
    await sleep(100);

    // Clear existing content
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    await sleep(50);

    // METHOD 1: Type each character via full keyboard event sequence
    // This is what Lexical actually listens to
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const keyProps = { key: char, code: '', bubbles: true, cancelable: true, composed: true };

      // keydown
      element.dispatchEvent(new KeyboardEvent('keydown', keyProps));

      // beforeinput (Lexical's primary input handler)
      element.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: char,
        bubbles: true,
        cancelable: true,
        composed: true,
      }));

      // execCommand for this single character (browser handles DOM mutation)
      document.execCommand('insertText', false, char);

      // input event
      element.dispatchEvent(new InputEvent('input', {
        inputType: 'insertText',
        data: char,
        bubbles: true,
        composed: true,
      }));

      // keyup
      element.dispatchEvent(new KeyboardEvent('keyup', keyProps));

      // Small delay every few chars to simulate human typing
      if (i % 5 === 4) await sleep(30 + Math.random() * 20);
    }

    await sleep(100);

    // Verify text was inserted
    if (element.textContent.includes(text.substring(0, 10))) return true;

    // FALLBACK: execCommand whole string (may work on some FB versions)
    element.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, text);
    await sleep(100);
    if (element.textContent.includes(text.substring(0, 10))) return true;

    // FALLBACK 2: Clipboard paste
    try {
      element.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      element.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt, bubbles: true, cancelable: true,
      }));
      await sleep(100);
      if (element.textContent.includes(text.substring(0, 10))) return true;
    } catch (e) {}

    return false;
  }

  function pressEnter(element) {
    const props = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    element.dispatchEvent(new KeyboardEvent('keydown', props));
    element.dispatchEvent(new KeyboardEvent('keypress', props));
    element.dispatchEvent(new KeyboardEvent('keyup', props));
  }

  // ===== ESCAPE TO FEED =====
  async function escapeOverlays() {
    // First: clear any active comment input to prevent "Leave page?" dialog
    const activeEl = document.activeElement;
    if (activeEl && activeEl.getAttribute('contenteditable') === 'true') {
      // Clear the input text first so FB doesn't think we have unsaved comment
      activeEl.textContent = '';
      activeEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await sleep(300);
    }

    // Blur focus
    if (activeEl && activeEl !== document.body) activeEl.blur();
    await sleep(300);

    // Press Escape to close any overlay/popup
    for (let i = 0; i < 2; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(300);
    }

    // Check for and dismiss any "Leave page?" dialog that appeared
    await sleep(500);
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const dialog of dialogs) {
      const text = dialog.innerText || '';
      if (text.includes('Leave page') || text.includes('Rời khỏi trang') || text.includes('haven\'t finished')) {
        const btns = dialog.querySelectorAll('[role="button"], button');
        for (const btn of btns) {
          if (STAY_LABELS.some(l => btn.innerText.trim().includes(l))) {
            btn.click();
            await sleep(500);
            break;
          }
        }
      }
    }
  }

  // ===== FIND COMMENT INPUT =====
  async function findCommentInput(commentBtn) {
    commentBtn.click();
    await sleep(1500 + Math.random() * 800);

    // 1) Currently focused?
    const active = document.activeElement;
    if (active && active.getAttribute('contenteditable') === 'true') return active;

    // 2) Walk up from button
    let c = commentBtn.parentElement;
    for (let i = 0; i < 15 && c; i++) {
      const f = c.querySelector('div[contenteditable="true"][role="textbox"]')
        || c.querySelector('[contenteditable="true"][data-lexical-editor]')
        || c.querySelector('div[contenteditable="true"]');
      if (f) return f;
      c = c.parentElement;
    }

    // 3) By hint
    await sleep(500);
    for (const box of document.querySelectorAll('div[contenteditable="true"]')) {
      const hint = ((box.getAttribute('aria-label') || '') + ' ' + (box.getAttribute('aria-placeholder') || '')).toLowerCase();
      if (COMMENT_INPUT_HINTS.some(h => hint.includes(h))) return box;
    }

    // 4) Last contenteditable on page
    const all = document.querySelectorAll('div[contenteditable="true"]');
    return all.length > 0 ? all[all.length - 1] : null;
  }

  // ===== EXTRACT POST CONTENT =====
  function extractPostContent(likeBtn) {
    // Walk up from like button to find the post container with text
    let el = likeBtn;
    for (let i = 0; i < 20 && el; i++) {
      // Look for significant text content (post body)
      const textEls = el.querySelectorAll('div[dir="auto"], span[dir="auto"]');
      let texts = [];
      for (const te of textEls) {
        const t = te.innerText?.trim();
        // Skip very short text (names, timestamps), buttons, etc.
        if (t && t.length > 15 && !te.closest('[role="button"]') && !te.closest('a[href]')) {
          texts.push(t);
        }
      }
      if (texts.length > 0) {
        // Return the longest text found (likely the main post content)
        const combined = texts.sort((a, b) => b.length - a.length).slice(0, 3).join('\n');
        return combined.substring(0, 1000);
      }
      el = el.parentElement;
    }

    // Fallback: try getting any visible text near the like button
    let container = likeBtn.parentElement;
    for (let i = 0; i < 15 && container; i++) {
      const text = container.innerText?.trim();
      if (text && text.length > 50) {
        // Extract just the main content, skip action bar text
        const lines = text.split('\n').filter(l => l.trim().length > 10);
        return lines.slice(0, 5).join('\n').substring(0, 1000);
      }
      container = container.parentElement;
    }
    return '';
  }

  // ===== AI COMMENT VIA GEMINI =====
  async function getAIComment(postContent) {
    if (!postContent) return null;
    // Load AI settings fresh from storage each time
    const stored = await new Promise(r => chrome.storage.local.get(['aiSettings'], r));
    const ai = stored.aiSettings || {};
    if (!ai.enabled || !ai.apiKey) return null;
    try {
      const resp = await sendBg({
        type: 'gemini-comment',
        postContent,
        settings: ai,
      });
      if (resp.success && resp.comment) {
        log('AI: "' + resp.comment.substring(0, 40) + '..."', 'info');
        return resp.comment;
      } else {
        log('AI lỗi: ' + (resp.error || 'không rõ'), 'warn');
        return null;
      }
    } catch (e) {
      log('AI lỗi: ' + e.message, 'warn');
      return null;
    }
  }

  // ===== DO COMMENT =====
  function getRandomComment(used) {
    const pool = (settings.comments && settings.comments.length) ? settings.comments : DEFAULT_COMMENTS;
    const avail = pool.filter(c => !used.has(c));
    const src = avail.length ? avail : pool;
    return src[Math.floor(Math.random() * src.length)];
  }

  // Wait until comment input is cleared (= comment posted successfully)
  async function waitForCommentPosted(input, text, maxWaitMs = 20000) {
    const textSnippet = text.substring(0, 10);
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await sleep(1000);
      const currentText = (input.textContent || '').trim();
      // Input cleared = FB accepted the comment
      if (!currentText || currentText.length < 3 || !currentText.includes(textSnippet)) {
        return true;
      }
    }
    return false;
  }

  // Find and like our own comment (the most recent one in the thread)
  async function selfLikeComment(commentBtn) {
    // Look for Like buttons inside the comment section
    let container = commentBtn.parentElement;
    for (let i = 0; i < 15 && container; i++) {
      // Find all small "Like" / "Thích" links/spans in comment area
      const likeEls = container.querySelectorAll('[role="button"]');
      let lastLikeBtn = null;
      for (const el of likeEls) {
        const t = el.innerText.trim();
        const a = (el.getAttribute('aria-label') || '').trim();
        if ((t === 'Thích' || t === 'Like' || a === 'Thích' || a === 'Like') && el.getBoundingClientRect().height < 40) {
          lastLikeBtn = el; // Keep the last one (most recent comment)
        }
      }
      if (lastLikeBtn) {
        lastLikeBtn.click();
        log('Đã tự like bình luận của mình', 'info');
        return true;
      }
      container = container.parentElement;
    }
    return false;
  }

  async function doComment(likeBtn) {
    const postId = getPostId(likeBtn);
    if (commentedPostIds.has(postId)) {
      log('Bài này đã comment, bỏ qua');
      return false;
    }

    try {
      const commentBtn = findCommentBtn(likeBtn);
      if (!commentBtn) { log('Không thấy nút Comment', 'warn'); return false; }

      const num = settings.commentsPerPost || 1;
      const used = new Set();
      let ok = 0;

      // Extract post content for AI
      const postContent = extractPostContent(likeBtn);
      if (postContent) log('Đọc bài: "' + postContent.substring(0, 50) + '..."', 'info');

      for (let i = 0; i < num && running; i++) {
        // Find comment input
        let input;
        if (i === 0) {
          input = await findCommentInput(commentBtn);
        } else {
          await sleep(1000);
          let c = commentBtn.parentElement;
          for (let j = 0; j < 15 && c; j++) {
            input = c.querySelector('div[contenteditable="true"][role="textbox"]') || c.querySelector('div[contenteditable="true"]');
            if (input) break;
            c = c.parentElement;
          }
          if (!input) input = await findCommentInput(commentBtn);
        }
        if (!input) { log('Không thấy ô comment', 'warn'); break; }

        // Get comment text: AI or random
        let text;
        if (postContent) {
          text = await getAIComment(postContent);
        }
        if (!text) {
          text = getRandomComment(used);
          if (postContent) log('Dùng comment mẫu (AI không khả dụng)', 'info');
        }
        used.add(text);

        // Focus and place cursor
        input.focus(); input.click();
        await sleep(300);
        const sel = window.getSelection();
        sel.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(input);
        range.collapse(false);
        sel.addRange(range);
        await sleep(200);

        // Type text
        const typed = await typeText(input, text);
        if (!typed) { log('Không nhập được text vào ô comment', 'warn'); break; }
        log('Đã nhập: "' + text.substring(0, 40) + '"... Đang gửi...', 'info');
        await sleep(800 + Math.random() * 500);

        // Press Enter to submit
        pressEnter(input);

        // WAIT until comment actually posts (input clears)
        const posted = await waitForCommentPosted(input, text, 20000);

        if (!posted) {
          // Retry: press Enter again
          log('Chưa gửi được, thử Enter lần 2...', 'warn');
          pressEnter(input);
          const posted2 = await waitForCommentPosted(input, text, 10000);
          if (!posted2) {
            log('Comment không gửi được sau 30s. Bỏ qua bài này.', 'warn');
            break;
          }
        }

        ok++; stats.commented++; updateStats();
        log('Đã đăng comment ' + (i + 1) + '/' + num + ': "' + text.substring(0, 40) + '"', 'success');

        // Wait for comment to render on page
        await sleep(2000 + Math.random() * 1000);

        // Self-like the comment (optional)
        if (settings.selfLikeComment !== false) {
          await selfLikeComment(commentBtn);
          await sleep(500);
        }

        if (i < num - 1) await sleep(3000 + Math.random() * 2000);
      }

      // Mark as commented
      if (ok > 0) {
        commentedPostIds.add(postId);
        saveCommentedPosts();
      }

      // Wait for everything to fully load before leaving
      await sleep(2000);
      await escapeOverlays();
      return ok > 0;
    } catch (e) {
      if (e.message !== 'aborted') log('Lỗi comment: ' + e.message, 'warn');
      await escapeOverlays().catch(() => {});
      return false;
    }
  }

  function saveCommentedPosts() {
    // Only save last 200 to avoid storage bloat
    const arr = [...commentedPostIds].slice(-200);
    chrome.storage.local.set({ commentedPosts: arr });
  }

  // ===== ADD FRIEND =====
  function findAddFriendBtns() {
    const raw = [];
    for (const btn of document.querySelectorAll('div[role="button"], [role="button"]')) {
      if (clickedBtns.has(btn)) continue;
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (matchLabel(btn, CANCEL_FRIEND_LABELS)) continue;
      if (matchLabel(btn, ADD_FRIEND_LABELS)) raw.push(btn);
    }

    // Deduplicate: each person has multiple "Add friend" buttons (parent + child)
    // Keep only the INNERMOST one (the one with innerText) to avoid clicking twice
    const deduped = [];
    for (const btn of raw) {
      // Skip if this button CONTAINS another Add Friend button (meaning it's a parent container)
      let isParent = false;
      for (const other of raw) {
        if (other !== btn && btn.contains(other)) { isParent = true; break; }
      }
      if (!isParent) deduped.push(btn);
    }

    log('[debug] Add Friend raw=' + raw.length + ' deduped=' + deduped.length);
    return deduped;
  }

  async function doAddFriendOnPage() {
    if (loopActive) return;
    loopActive = true;
    abortCtrl = new AbortController();
    reportPage();

    const page = detectPage();
    log('doAddFriend: page=' + page + ' url=' + window.location.pathname, 'info');

    // Safety: if not on friends page, go there
    if (page !== 'friends') {
      log('Khong o trang friends, chuyen...', 'warn');
      navigateTo('https://www.facebook.com/friends/suggestions');
      loopActive = false;
      return;
    }

    try {
      // Wait for page to render suggestions
      log('Cho trang tai...', 'info');
      await sleep(3000);

      // Scroll to load suggestions
      for (let s = 0; s < 4; s++) { scroll(); await sleep(2000); }

      let btns = findAddFriendBtns();
      log('Tim thay ' + btns.length + ' nut Add Friend', btns.length ? 'success' : 'warn');

      // Retry harder if none found
      if (!btns.length) {
        for (let a = 0; a < 8 && !btns.length && running; a++) {
          scroll(); await sleep(2500);
          btns = findAddFriendBtns();
          log('Retry ' + (a + 1) + ': ' + btns.length + ' nut');
        }
      }

      if (btns.length) {
        const maxToAdd = Math.min(
          1 + Math.floor(Math.random() * 2),
          (settings.maxFriendRequests || 10) - stats.friendsAdded,
          btns.length
        );
        for (let i = 0; i < maxToAdd && running; i++) {
          const btn = btns[i];
          btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(1000 + Math.random() * 500);

          const label = (btn.getAttribute('aria-label') || btn.innerText.trim()).substring(0, 30);
          log('Click: "' + label + '"', 'info');
          btn.click();
          clickedBtns.add(btn);

          // Also mark all sibling buttons in same card to avoid re-clicking
          let card = btn.parentElement;
          for (let j = 0; j < 5 && card; j++) {
            for (const sibling of card.querySelectorAll('div[role="button"]')) {
              if (matchLabel(sibling, ADD_FRIEND_LABELS)) clickedBtns.add(sibling);
            }
            card = card.parentElement;
          }

          stats.friendsAdded++; updateStats();
          log('Da gui loi moi ket ban #' + stats.friendsAdded, 'success');
          await sleep(rDelay(settings.delay));
        }
      } else {
        log('Khong thay nut ket ban nao!', 'warn');
      }

      await sleep(1500);
      currentPhase = 'back_to_feed';
      chrome.storage.local.set({ phase: 'back_to_feed', isRunning: true });
      log('Quay ve News Feed...');
      navigateTo('https://www.facebook.com/');
    } catch (e) {
      if (e.message !== 'aborted') log('Loi add friend: ' + e.message, 'warn');
    } finally { loopActive = false; }
  }

  // ===== STORY VIEWING & LIKING =====
  async function doViewStoriesOnPage() {
    if (loopActive) return;
    loopActive = true;
    abortCtrl = new AbortController();
    reportPage();
    log('Đang xem stories...', 'info');

    try {
      await sleep(3000); // Wait for story to load

      const max = settings.maxStories || 5;
      for (let i = 0; i < max && running; i++) {
        // Watch story for 4-7 seconds (realistic viewing time)
        const watchTime = 4000 + Math.random() * 3000;
        log('Xem story ' + (i + 1) + '/' + max + ' (' + Math.round(watchTime / 1000) + 's)...', 'info');
        await sleep(watchTime);

        // Try to like/react story
        if (Math.random() * 100 < (settings.storyLikeFreq || 70)) {
          const liked = await tryLikeStory();
          if (liked) log('Thả tim story #' + (i + 1), 'success');
        }

        stats.stories++; updateStats();

        // Skip to next story
        if (i < max - 1) {
          const prevUrl = window.location.href;
          await clickNextStory();
          // Wait and check if URL changed (= new story loaded)
          await sleep(2000);
          if (window.location.href === prevUrl && detectPage() !== 'stories') {
            log('Hết story hoặc đã thoát khỏi story viewer', 'info');
            break;
          }
        }
      }

      await sleep(1000);
      currentPhase = 'back_to_feed';
      chrome.storage.local.set({ phase: 'back_to_feed', isRunning: true });
      log('Quay về News Feed...');
      navigateTo('https://www.facebook.com/');
    } catch (e) {
      if (e.message !== 'aborted') {
        log('Lỗi story: ' + e.message + '. Quay về feed...', 'warn');
        currentPhase = 'back_to_feed';
        chrome.storage.local.set({ phase: 'back_to_feed', isRunning: true });
        navigateTo('https://www.facebook.com/');
      }
    } finally { loopActive = false; }
  }

  async function tryLikeStory() {
    // Story reaction buttons — specific to story viewer overlay
    // They're inside the story viewer (dialog/overlay), NOT the feed
    const storyContainer = document.querySelector('[role="dialog"]') || document.body;

    // Look for reaction/heart/like button specific to stories
    const storyLikeHints = ['send a reaction', 'gửi lượt thích', 'react to story', 'phản hồi', 'gửi biểu cảm'];
    const btns = storyContainer.querySelectorAll('[role="button"]');
    for (const btn of btns) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (storyLikeHints.some(h => aria.includes(h))) {
        const r = btn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          btn.click();
          await sleep(800);
          // If a reaction picker appeared, click the heart/love
          const reactions = document.querySelectorAll('[role="button"][aria-label]');
          for (const rb of reactions) {
            const rl = (rb.getAttribute('aria-label') || '').toLowerCase();
            if (rl.includes('love') || rl.includes('yêu') || rl === '❤️' || rl === 'love') {
              rb.click();
              await sleep(300);
              return true;
            }
          }
          return true; // Clicked reaction button even if no picker
        }
      }
    }

    // Fallback: look for any heart/like icon button in story area
    for (const btn of btns) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      // Only match if button is small (story reaction buttons are small, feed Like is large)
      const r = btn.getBoundingClientRect();
      if (r.width > 0 && r.width < 60 && r.height > 0 && r.height < 60) {
        if (aria.includes('like') || aria.includes('thích')) {
          btn.click();
          await sleep(500);
          return true;
        }
      }
    }
    return false;
  }

  async function clickNextStory() {
    // Method 1: Find "Next" button by aria-label
    const nextHints = ['next story', 'next', 'tiếp theo', 'story tiếp'];
    for (const btn of document.querySelectorAll('[role="button"]')) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (nextHints.some(h => aria.includes(h))) {
        const r = btn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          btn.click();
          return;
        }
      }
    }

    // Method 2: ArrowRight key (Facebook stories support this)
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', code: 'ArrowRight', keyCode: 39,
      bubbles: true, cancelable: true,
    }));
    await sleep(300);
    document.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'ArrowRight', code: 'ArrowRight', keyCode: 39,
      bubbles: true,
    }));
  }

  // ===== CLICK FIRST STORY ON FEED =====
  async function clickFirstStory() {
    // Stories are at top of feed, usually in a horizontal scrollable area
    // Look for story elements: they're often links or clickable items with images
    const storySelectors = [
      'a[href*="/stories/"]',
      '[aria-label*="story" i]',
      '[aria-label*="tin" i]',  // Vietnamese for "story"
    ];
    for (const sel of storySelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const r = el.getBoundingClientRect();
        // Story items are near top of page, visible, and have reasonable size
        if (r.width > 30 && r.height > 30 && r.top < 500 && r.top > -10) {
          el.click();
          return true;
        }
      }
    }
    return false;
  }

  // ===== FRIEND BY KEYWORD (search people + group members) =====
  async function doFriendByKeywordOnPage() {
    if (loopActive) return;
    loopActive = true;
    abortCtrl = new AbortController();
    reportPage();

    const page = detectPage();
    log('doFriendByKeyword: page=' + page, 'info');

    try {
      log('Chờ trang tải...', 'info');
      await sleep(3000);
      for (let s = 0; s < 4; s++) { scroll(); await sleep(2000); }

      // Find Add Friend buttons (same logic as suggestions page)
      let btns = findAddFriendBtns();
      log('Tìm thấy ' + btns.length + ' nút kết bạn', btns.length ? 'success' : 'warn');

      if (!btns.length) {
        for (let a = 0; a < 6 && !btns.length && running; a++) {
          scroll(); await sleep(2500);
          btns = findAddFriendBtns();
        }
      }

      if (btns.length) {
        const maxToAdd = Math.min(
          1 + Math.floor(Math.random() * 2),
          (settings.maxFriendRequests || 10) - stats.friendsAdded,
          btns.length
        );
        for (let i = 0; i < maxToAdd && running; i++) {
          const btn = btns[i];
          btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(1000 + Math.random() * 500);
          btn.click();
          clickedBtns.add(btn);
          // Mark siblings
          let card = btn.parentElement;
          for (let j = 0; j < 5 && card; j++) {
            for (const sib of card.querySelectorAll('div[role="button"]')) {
              if (matchLabel(sib, ADD_FRIEND_LABELS)) clickedBtns.add(sib);
            }
            card = card.parentElement;
          }
          stats.friendsAdded++; updateStats();
          log('Đã gửi lời mời kết bạn #' + stats.friendsAdded + ' (từ tìm kiếm)', 'success');
          await sleep(rDelay(settings.delay));
        }
      } else {
        log('Không tìm thấy nút kết bạn trên trang này', 'warn');
      }

      await sleep(1500);
      currentPhase = 'back_to_feed';
      chrome.storage.local.set({ phase: 'back_to_feed', isRunning: true });
      log('Quay về News Feed...');
      navigateTo('https://www.facebook.com/');
    } catch (e) {
      if (e.message !== 'aborted') log('Lỗi kết bạn từ khóa: ' + e.message, 'warn');
    } finally { loopActive = false; }
  }

  // ===== JOIN GROUPS =====
  function findJoinGroupBtns() {
    const raw = [];
    for (const btn of document.querySelectorAll('div[role="button"], [role="button"], a[role="button"]')) {
      if (clickedBtns.has(btn)) continue;
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Skip already joined
      if (matchLabel(btn, ALREADY_JOINED_LABELS)) continue;
      if (matchLabel(btn, JOIN_GROUP_LABELS)) raw.push(btn);
    }
    // Deduplicate (parent/child)
    const deduped = [];
    for (const btn of raw) {
      let isParent = false;
      for (const other of raw) {
        if (other !== btn && btn.contains(other)) { isParent = true; break; }
      }
      if (!isParent) deduped.push(btn);
    }
    log('[debug] Join Group raw=' + raw.length + ' deduped=' + deduped.length);
    return deduped;
  }

  async function doJoinGroupsOnPage() {
    if (loopActive) return;
    loopActive = true;
    abortCtrl = new AbortController();
    reportPage();

    const page = detectPage();
    log('doJoinGroups: page=' + page + ' url=' + window.location.href, 'info');

    try {
      // Wait for search results to load
      log('Cho ket qua tim kiem...', 'info');
      await sleep(3000);

      // Scroll to load more results
      for (let s = 0; s < 4; s++) { scroll(); await sleep(2000); }

      let btns = findJoinGroupBtns();
      log('Tim thay ' + btns.length + ' nut Join', btns.length ? 'success' : 'warn');

      // Retry if none found
      if (!btns.length) {
        for (let a = 0; a < 6 && !btns.length && running; a++) {
          scroll(); await sleep(2500);
          btns = findJoinGroupBtns();
        }
      }

      if (btns.length) {
        const maxJoin = Math.min(
          1 + Math.floor(Math.random() * 2),
          (settings.maxGroups || 5) - stats.groupsJoined,
          btns.length
        );
        for (let i = 0; i < maxJoin && running; i++) {
          const btn = btns[i];
          btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(1000 + Math.random() * 500);

          const label = (btn.getAttribute('aria-label') || btn.innerText.trim()).substring(0, 30);
          log('Click: "' + label + '"', 'info');
          btn.click();
          clickedBtns.add(btn);

          // Mark siblings too
          let card = btn.parentElement;
          for (let j = 0; j < 5 && card; j++) {
            for (const sib of card.querySelectorAll('div[role="button"]')) {
              if (matchLabel(sib, JOIN_GROUP_LABELS)) clickedBtns.add(sib);
            }
            card = card.parentElement;
          }

          stats.groupsJoined++; updateStats();
          log('Da tham gia nhom #' + stats.groupsJoined, 'success');
          await sleep(rDelay(settings.delay));
        }
      } else {
        log('Khong thay nut Join nhom', 'warn');
      }

      await sleep(1500);
      currentPhase = 'back_to_feed';
      chrome.storage.local.set({ phase: 'back_to_feed', isRunning: true });
      log('Quay ve News Feed...');
      navigateTo('https://www.facebook.com/');
    } catch (e) {
      if (e.message !== 'aborted') log('Loi join group: ' + e.message, 'warn');
    } finally { loopActive = false; }
  }

  // ===== PAGE FB MANAGEMENT =====
  async function handleCreatePage(msg) {
    log('Đang tạo Page: ' + msg.name, 'info');
    // Navigate to page creation
    navigateTo('https://www.facebook.com/pages/creation/');
    // After navigation, content script re-inits. We store the intent.
    chrome.storage.local.set({ pendingPageCreate: { name: msg.name, category: msg.category, bio: msg.bio } });
  }

  async function handleInviteFriends(msg) {
    log('Đang mở Page để mời bạn bè...', 'info');
    // Navigate to the page's invite section
    let url = msg.url;
    if (!url.startsWith('http')) url = 'https://www.facebook.com/' + url.replace(/^\//, '');
    // Facebook page invite URL pattern
    navigateTo(url);
    chrome.storage.local.set({ pendingPageInvite: { max: msg.max } });
  }

  async function handlePostToPage(msg) {
    log('Đang mở Page để đăng bài...', 'info');
    let url = msg.url;
    if (!url.startsWith('http')) url = 'https://www.facebook.com/' + url.replace(/^\//, '');
    navigateTo(url);
    chrome.storage.local.set({ pendingPagePost: { content: msg.content } });
  }

  // Check for pending page actions on load
  chrome.storage.local.get(['pendingPageCreate', 'pendingPageInvite', 'pendingPagePost'], async (d) => {
    if (d.pendingPageCreate) {
      chrome.storage.local.remove('pendingPageCreate');
      const pg = d.pendingPageCreate;
      await new Promise(r => setTimeout(r, 3000)); // Wait for page to load
      log('Đang điền form tạo Page...', 'info');

      // Try to find and fill page creation form
      const nameInput = document.querySelector('input[name="page_name"], input[aria-label*="name" i], input[aria-label*="tên" i], input[placeholder*="name" i], input[placeholder*="tên" i]');
      if (nameInput) {
        nameInput.focus();
        nameInput.value = pg.name;
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        nameInput.dispatchEvent(new Event('change', { bubbles: true }));
        log('Đã điền tên: ' + pg.name, 'success');
      } else {
        // Fallback: find any visible text input
        const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
        for (const inp of inputs) {
          const r = inp.getBoundingClientRect();
          if (r.width > 100 && r.height > 0) {
            inp.focus();
            inp.value = pg.name;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            log('Đã điền tên (fallback): ' + pg.name, 'success');
            break;
          }
        }
      }

      // Try to fill category
      if (pg.category) {
        await new Promise(r => setTimeout(r, 1000));
        const catInput = document.querySelector('input[aria-label*="category" i], input[aria-label*="danh mục" i], input[placeholder*="category" i]');
        if (catInput) {
          catInput.focus();
          catInput.value = pg.category;
          catInput.dispatchEvent(new Event('input', { bubbles: true }));
          log('Đã điền danh mục: ' + pg.category, 'info');
        }
      }

      // Try to fill bio
      if (pg.bio) {
        await new Promise(r => setTimeout(r, 500));
        const bioInput = document.querySelector('textarea[aria-label*="bio" i], textarea[aria-label*="mô tả" i], textarea[placeholder*="bio" i]');
        if (bioInput) {
          bioInput.focus();
          bioInput.value = pg.bio;
          bioInput.dispatchEvent(new Event('input', { bubbles: true }));
          log('Đã điền mô tả', 'info');
        }
      }

      log('Kiểm tra form và nhấn tạo Page thủ công.', 'warn');
    }

    if (d.pendingPageInvite) {
      chrome.storage.local.remove('pendingPageInvite');
      const pg = d.pendingPageInvite;
      await new Promise(r => setTimeout(r, 4000));
      log('Đang tìm nút mời bạn bè like Page...', 'info');

      // Look for "Invite friends" / "Mời bạn bè" button
      const inviteLabels = ['Invite friends', 'Invite Friends', 'Mời bạn bè', 'Mời bạn bè thích', 'Invite'];
      let inviteBtn = null;
      for (const btn of document.querySelectorAll('div[role="button"], a[role="button"], [role="button"]')) {
        const aria = (btn.getAttribute('aria-label') || '').trim();
        const text = btn.innerText.trim();
        if (inviteLabels.some(l => aria.includes(l) || text.includes(l))) {
          const r = btn.getBoundingClientRect();
          if (r.width > 0) { inviteBtn = btn; break; }
        }
      }

      if (inviteBtn) {
        inviteBtn.click();
        log('Đã nhấn nút mời bạn bè', 'success');
        await new Promise(r => setTimeout(r, 2000));

        // Click individual invite buttons
        let invited = 0;
        for (let attempt = 0; attempt < 5 && invited < pg.max; attempt++) {
          const btns = document.querySelectorAll('div[role="button"], [role="button"]');
          for (const btn of btns) {
            if (invited >= pg.max) break;
            const text = btn.innerText.trim();
            if (text === 'Invite' || text === 'Mời') {
              btn.click();
              invited++;
              await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
            }
          }
          if (invited > 0) break;
          window.scrollBy({ top: 300, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 1500));
        }
        log('Đã mời ' + invited + ' bạn bè like Page', 'success');
      } else {
        log('Không tìm thấy nút mời. Thử vào Page → ... → Mời bạn bè', 'warn');
      }
    }

    if (d.pendingPagePost) {
      chrome.storage.local.remove('pendingPagePost');
      const pg = d.pendingPagePost;
      await new Promise(r => setTimeout(r, 4000));
      log('Đang tìm ô tạo bài viết trên Page...', 'info');

      // Find the "What's on your mind" / "Bạn đang nghĩ gì" create post area
      const postPrompts = ['create a post', 'write something', 'đang nghĩ gì', 'viết gì đó', 'tạo bài viết'];
      let postArea = null;
      for (const el of document.querySelectorAll('div[role="button"], span, div[tabindex]')) {
        const text = (el.innerText || el.textContent || '').toLowerCase().trim();
        if (postPrompts.some(p => text.includes(p))) {
          const r = el.getBoundingClientRect();
          if (r.width > 50 && r.height > 0) { postArea = el; break; }
        }
      }

      if (postArea) {
        postArea.click();
        await new Promise(r => setTimeout(r, 2000));

        // Find the composer textbox
        const composer = document.querySelector('div[contenteditable="true"][role="textbox"]');
        if (composer) {
          composer.focus();
          document.execCommand('insertText', false, pg.content);
          log('Đã nhập nội dung bài đăng', 'success');
          log('Kiểm tra nội dung và nhấn Đăng thủ công.', 'warn');
        } else {
          log('Không tìm thấy ô soạn bài', 'warn');
        }
      } else {
        log('Không tìm thấy nút tạo bài viết trên Page', 'warn');
      }
    }
  });

  // ===== MAIN LOOP =====
  async function startMainLoop() {
    if (loopActive) return;
    loopActive = true;
    abortCtrl = new AbortController();
    currentPhase = 'liking';
    chrome.storage.local.set({ phase: 'liking' });

    const page = detectPage();
    reportPage();
    log('Bat dau | Trang: ' + page);

    if (page !== 'feed') {
      log('Chuyen ve News Feed...');
      navigateTo('https://www.facebook.com/');
      return;
    }

    let emptyRounds = 0;
    let actionCount = 0; // total actions taken, for auto-mix scheduling

    // Auto-mix: build pool of side actions that can trigger
    function pickSideAction() {
      const pool = [];
      if (settings.enableStory && stats.stories < (settings.maxStories || 5)) pool.push('story');
      if (settings.enableAddFriend && stats.friendsAdded < (settings.maxFriendRequests || 10)) {
        pool.push('friend_suggest');
        if (settings.friendKeywords && settings.friendKeywords.length > 0) pool.push('friend_search');
        // friend_group not yet implemented
      }
      if (settings.enableJoinGroup && settings.groupKeywords && settings.groupKeywords.length > 0
        && stats.groupsJoined < (settings.maxGroups || 5)) pool.push('group');
      // Page actions — only trigger once per session
      if (settings.enablePage && !stats.pageActionDone) pool.push('page');
      if (!pool.length) return null;
      // After every 5-10 likes, 40% chance to pick a side action
      if (actionCount >= 5 && actionCount % 5 === 0 && Math.random() < 0.4) {
        return pool[Math.floor(Math.random() * pool.length)];
      }
      return null;
    }

    async function executeSideAction(action) {
      loopActive = false;
      if (action === 'story') {
        log('Xen kẽ: xem story...', 'info');
        const clicked = await clickFirstStory();
        if (clicked) { await sleep(2000); if (detectPage() === 'stories') { currentPhase = 'viewing_stories'; chrome.storage.local.set({ phase: 'viewing_stories', isRunning: true }); doViewStoriesOnPage(); return true; } }
        currentPhase = 'viewing_stories';
        chrome.storage.local.set({ phase: 'viewing_stories', isRunning: true });
        navigateTo('https://www.facebook.com/stories');
        return true;
      }
      if (action === 'friend_suggest') {
        log('Xen kẽ: kết bạn từ gợi ý...', 'info');
        currentPhase = 'adding_friends';
        chrome.storage.local.set({ phase: 'adding_friends', isRunning: true });
        navigateTo('https://www.facebook.com/friends/suggestions');
        return true;
      }
      if (action === 'friend_search') {
        const kws = settings.friendKeywords;
        const kw = kws[Math.floor(Math.random() * kws.length)];
        log('Xen kẽ: tìm bạn "' + kw + '"...', 'info');
        currentPhase = 'searching_people';
        chrome.storage.local.set({ phase: 'searching_people', isRunning: true });
        navigateTo('https://www.facebook.com/search/people?q=' + encodeURIComponent(kw));
        return true;
      }
      if (action === 'friend_group') {
        log('Xen kẽ: kết bạn từ nhóm (chưa hỗ trợ, dùng gợi ý)...', 'info');
        currentPhase = 'adding_friends';
        chrome.storage.local.set({ phase: 'adding_friends', isRunning: true });
        navigateTo('https://www.facebook.com/friends/suggestions');
        return true;
      }
      if (action === 'group') {
        const kws = settings.groupKeywords;
        const kw = kws[Math.floor(Math.random() * kws.length)];
        log('Xen kẽ: tìm nhóm "' + kw + '"...', 'info');
        currentPhase = 'joining_groups';
        chrome.storage.local.set({ phase: 'joining_groups', isRunning: true });
        navigateTo('https://www.facebook.com/search/groups?q=' + encodeURIComponent(kw));
        return true;
      }
      if (action === 'page') {
        stats.pageActionDone = true;
        const pa = settings.pageAction || 'create';
        if (pa === 'create' && settings.pageName) {
          log('Xen kẽ: tạo Page "' + settings.pageName + '"...', 'info');
          handleCreatePage({ name: settings.pageName, category: settings.pageCategory, bio: settings.pageBio });
          return true;
        } else if (pa === 'invite' && settings.pageUrl) {
          log('Xen kẽ: mời bạn bè like Page...', 'info');
          handleInviteFriends({ url: settings.pageUrl, max: settings.pageInviteMax || 20 });
          return true;
        } else if (pa === 'post' && (settings.pagePostContent || settings.pageUseAI)) {
          log('Xen kẽ: đăng bài lên Page...', 'info');
          handlePostToPage({ url: settings.pagePostUrl || settings.pageUrl, content: settings.pagePostContent });
          return true;
        }
      }
      loopActive = true;
      return false;
    }

    try {
      await sleep(1500);
      while (running) {
        // Check like limit
        if (settings.maxLikes > 0 && stats.liked >= settings.maxLikes) {
          log('Đã đạt giới hạn ' + settings.maxLikes + ' like!', 'warn');
          stopAll(); break;
        }

        // Auto-mix: pick a side action?
        const sideAction = pickSideAction();
        if (sideAction) {
          const navigated = await executeSideAction(sideAction);
          if (navigated) return; // page will reload, script re-inits
        }

        // ===== FIND NEXT POST =====
        const buttons = findLikeButtons();
        if (!buttons.length) {
          emptyRounds++;
          if (emptyRounds >= 40) { log('Không tìm thấy bài mới sau 40 lần cuộn. Dừng.', 'warn'); stopAll(); break; }
          if (emptyRounds % 5 === 1) log('Cuộn tìm bài... (' + emptyRounds + '/40)');
          if (settings.autoScroll) {
            const scrollAmt = 400 + Math.random() * 600 + (emptyRounds > 10 ? 500 : 0);
            window.scrollBy({ top: scrollAmt, behavior: 'smooth' });
            await sleep(2500 + Math.random() * 1500);
          } else { await sleep(3000); }
          continue;
        }
        emptyRounds = 0;

        // ===== PROCESS ONE POST =====
        try {
          const likeBtn = buttons[0];

          // Mark button as processed immediately (WeakSet — prevents re-picking same DOM element)
          clickedBtns.add(likeBtn);

          // Generate a unique ID for this post
          const btnHash = getBtnHash(likeBtn);

          // Check if already liked (from storage — survives page reload)
          if (btnHash && likedPostIds.has(btnHash)) {
            log('Bài đã like trước đó, bỏ qua', 'info');
            if (settings.autoScroll) { scroll(); await sleep(1500); }
            continue;
          }

          // STEP 1: Scroll to post on feed
          likeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(800 + Math.random() * 400);

          // STEP 2: Find and click the post link to open detail view
          let postLink = null;
          let container = likeBtn.parentElement;
          for (let i = 0; i < 15 && container; i++) {
            // Find timestamp link (clicks into post detail)
            const links = container.querySelectorAll('a[href*="/posts/"], a[href*="story_fbid"], a[href*="/photo"], a[href*="/videos/"], a[href*="permalink"]');
            if (links.length > 0) { postLink = links[0]; break; }
            container = container.parentElement;
          }

          // ===== Track post hash before ANY action =====
          if (btnHash) { likedPostIds.add(btnHash); saveLikedPosts(); }

          if (postLink) {
            // ===== OPEN POST DETAIL =====
            log('Mở bài viết #' + (stats.liked + 1) + '...', 'info');
            postLink.click();
            await sleep(2500 + Math.random() * 1500);

            // STEP 3: Comment in detail view (if enabled)
            if (settings.enableComment && Math.random() * 100 < (settings.commentFreq || 50)) {
              try {
                const detailLikeBtn = findLikeButtonInView();
                if (detailLikeBtn) await doComment(detailLikeBtn);
              } catch (ce) {
                if (ce.message !== 'aborted') log('Comment lỗi, bỏ qua: ' + (ce.message || ''), 'warn');
              }
              await sleep(800 + Math.random() * 500);
            }

            // STEP 4: Like in detail view — only if not already liked
            const detailLike = findLikeButtonInView();
            if (detailLike && matchLabel(detailLike, LIKE_LABELS) && !matchLabel(detailLike, UNLIKE_LABELS)) {
              detailLike.click();
              clickedBtns.add(detailLike);
              log('Like bài #' + (stats.liked + 1), 'success');
            } else {
              log('Bài #' + (stats.liked + 1) + ' (đã like sẵn hoặc không tìm thấy nút)', 'info');
            }

            stats.liked++; actionCount++;
            errorCount = 0;
            updateStats();

            // STEP 5: Close detail — wait for dialog to fully close
            await sleep(1500 + Math.random() * 1000);
            for (let closeAttempt = 0; closeAttempt < 3; closeAttempt++) {
              const dialog = document.querySelector('[role="dialog"]');
              if (!dialog) break;
              const closeBtn = dialog.querySelector('[aria-label="Close"], [aria-label="Đóng"]');
              if (closeBtn) {
                closeBtn.click();
              } else {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
              }
              await sleep(800);
            }

            // Wait for feed to stabilize after closing overlay
            await sleep(1500 + Math.random() * 500);

            // Mark ALL visible like buttons near this position as clicked
            // This prevents re-picking the same post even if DOM re-renders
            const feedBtns = findLikeButtons();
            for (const fb of feedBtns.slice(0, 2)) {
              const fbHash = getBtnHash(fb);
              if (fbHash && likedPostIds.has(fbHash)) {
                clickedBtns.add(fb);
              }
            }

            // Scroll well past this post
            window.scrollBy({ top: 700 + Math.random() * 500, behavior: 'smooth' });
            await sleep(1200);

          } else {
            // ===== NO POST LINK — comment + like on feed =====
            await sleep(1500 + Math.random() * 1000);

            // Comment on feed (if enabled)
            if (settings.enableComment && Math.random() * 100 < (settings.commentFreq || 50)) {
              try { await doComment(likeBtn); } catch (ce) {
                if (ce.message !== 'aborted') log('Comment lỗi, bỏ qua', 'warn');
              }
              await sleep(800);
            }

            // Re-check before clicking — button may have changed after comment
            if (document.contains(likeBtn) && matchLabel(likeBtn, LIKE_LABELS) && !matchLabel(likeBtn, UNLIKE_LABELS)) {
              likeBtn.click();
              log('Like bài #' + (stats.liked + 1), 'success');
            } else {
              log('Bài #' + (stats.liked + 1) + ' (bỏ qua - đã like)', 'info');
            }
            stats.liked++; actionCount++;
            errorCount = 0;
            updateStats();

            // Scroll past
            window.scrollBy({ top: 700 + Math.random() * 500, behavior: 'smooth' });
            await sleep(1200);
          }

        } catch (postErr) {
          if (postErr.message === 'aborted') throw postErr;
          log('Lỗi xử lý bài: ' + postErr.message + '. Bỏ qua...', 'warn');
          // Try to close any open dialog
          try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            await sleep(500);
          } catch (e2) {}
        }

        // Move on — delay before next post
        await sleep(rDelay(settings.delay));
      }
    } catch (e) {
      if (e.message !== 'aborted') {
        errorCount++;
        log('Lỗi: ' + e.message + '. Tự khởi động lại...', 'warn');
        loopActive = false;
        if (running) {
          // Always restart — never stop due to errors
          const waitTime = Math.min(3000 + errorCount * 1000, 15000);
          await sleep(waitTime).catch(() => {});
          if (running) startMainLoop();
        }
        return;
      }
    } finally {
      loopActive = false;
    }
  }

  // ===== WORKFLOW RUNNER =====
  async function runWorkflow(wf) {
    if (loopActive) return;
    loopActive = true;
    abortCtrl = new AbortController();
    log('Bat dau workflow: "' + wf.name + '" (' + wf.steps.length + ' buoc)', 'success');

    const page = detectPage();
    if (page !== 'feed') {
      log('Chuyen ve Feed truoc...');
      navigateTo('https://www.facebook.com/');
      return;
    }

    try {
      for (let si = 0; si < wf.steps.length && running; si++) {
        const step = wf.steps[si];
        log('Buoc ' + (si+1) + '/' + wf.steps.length + ': ' + step.type, 'info');

        if (step.type === 'like') {
          const count = step.count || 10;
          let done = 0;
          for (let attempt = 0; done < count && running && attempt < count * 3; attempt++) {
            const btns = findLikeButtons();
            if (btns.length) {
              btns[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
              await sleep(800);
              btns[0].click(); clickedBtns.add(btns[0]);
              done++; stats.liked++; updateStats();
              log('Like #' + done + '/' + count, 'success');
              await sleep(rDelay(step.delay || 3));
            }
            if (settings.autoScroll !== false) { scroll(); await sleep(2000); }
          }
        }

        else if (step.type === 'comment') {
          const count = step.count || 5;
          const freq = (step.freq || 50) / 100;
          let done = 0, scanned = 0;
          for (let attempt = 0; done < count && running && attempt < count * 4; attempt++) {
            const btns = findLikeButtons();
            if (btns.length) {
              const btn = btns[0];
              btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await sleep(800);
              // Like first
              btn.click(); clickedBtns.add(btn); stats.liked++; updateStats();
              scanned++;
              if (Math.random() < freq) {
                await sleep(1200);
                const ok = await doComment(btn);
                if (ok) done++;
              }
              await sleep(rDelay(3));
            }
            scroll(); await sleep(2000);
          }
          log('Comment: ' + done + '/' + count + ' (tu ' + scanned + ' bai)', 'success');
        }

        else if (step.type === 'friend') {
          settings.maxFriendRequests = step.count || 3;
          settings.enableAddFriend = true;
          currentPhase = 'adding_friends';
          chrome.storage.local.set({ phase: 'adding_friends', isRunning: true, activeWorkflow: wf, workflowStepIdx: si + 1 });
          navigateTo('https://www.facebook.com/friends/suggestions');
          loopActive = false;
          return; // Will resume after page reload
        }

        else if (step.type === 'story') {
          settings.maxStories = step.count || 5;
          settings.storyLikeFreq = step.likeFreq || 70;
          settings.enableStory = true;
          currentPhase = 'viewing_stories';
          chrome.storage.local.set({ phase: 'viewing_stories', isRunning: true, activeWorkflow: wf, workflowStepIdx: si + 1 });
          const clicked = await clickFirstStory();
          if (clicked) { await sleep(2000); }
          if (detectPage() !== 'stories') {
            navigateTo('https://www.facebook.com/stories');
          }
          loopActive = false;
          return;
        }

        else if (step.type === 'group') {
          settings.maxGroups = step.count || 2;
          settings.enableJoinGroup = true;
          const kw = (step.keywords || '').split(',')[0]?.trim() || '';
          if (kw) {
            currentPhase = 'joining_groups';
            chrome.storage.local.set({ phase: 'joining_groups', isRunning: true, activeWorkflow: wf, workflowStepIdx: si + 1 });
            navigateTo('https://www.facebook.com/search/groups?q=' + encodeURIComponent(kw));
            loopActive = false;
            return;
          } else { log('Khong co tu khoa nhom', 'warn'); }
        }

        else if (step.type === 'wait') {
          const secs = step.seconds || 30;
          log('Cho ' + secs + ' giay...', 'info');
          await sleep(secs * 1000);
        }
      }

      log('Hoàn thành workflow!', 'success');
      stopAll(); // stopAll already calls saveHistory
    } catch (e) {
      if (e.message !== 'aborted') log('Loi workflow: ' + e.message, 'warn');
    } finally {
      loopActive = false;
      await sleep(100).catch(() => {});
    }
  }

  // ===== SESSION & HISTORY =====
  function incrementSession() {
    chrome.storage.local.get(['sessionCount'], d => {
      chrome.storage.local.set({ sessionCount: (d.sessionCount || 0) + 1, runStartTime: Date.now() });
    });
  }
  function saveHistory() {
    chrome.storage.local.get(['history', 'runStartTime'], d => {
      const h = d.history || [];
      const duration = d.runStartTime ? Date.now() - d.runStartTime : 0;
      h.push({ time: Date.now(), duration, ...stats });
      if (h.length > 30) h.splice(0, h.length - 30);
      chrome.storage.local.set({ history: h });
    });
  }

  function stopAll() {
    if (!running) return; // Prevent double stop
    running = false;
    if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
    saveHistory();
    chrome.storage.local.remove('runStartTime');
    chrome.storage.local.set({ isRunning: false, phase: 'liking', activeWorkflow: null });
    chrome.runtime.sendMessage({ type: 'stopped' }).catch(() => {});
    log('Dừng. ' + stats.liked + ' like, ' + stats.commented + ' cmt, ' + stats.friendsAdded + ' bạn, ' + stats.stories + ' story, ' + stats.groupsJoined + ' nhóm.');
    removeLogPanel();
  }
})();
