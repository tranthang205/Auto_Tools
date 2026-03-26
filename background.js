// ===== AutoFB Background Service Worker v3.1 =====

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      isRunning: false, phase: 'liking',
      stats: { liked: 0, commented: 0, friendsAdded: 0, stories: 0, groupsJoined: 0 },
      logs: [], commentedPosts: [], scenarios: [], history: [],
    });
  }
});

// ===== SCHEDULE & AUTO-STOP =====
chrome.alarms.create('scheduleCheck', { periodInMinutes: 1 });
let lastScheduleTrigger = '';

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'scheduleCheck') return;

  try {
    const d = await chrome.storage.local.get(['autoStopAt', 'isRunning', 'schedules', 'scenarios']);

    // Auto-stop check
    if (d.isRunning && d.autoStopAt && Date.now() >= d.autoStopAt) {
      const tabs = await chrome.tabs.query({ url: ['*://www.facebook.com/*', '*://web.facebook.com/*'] });
      for (const tab of tabs) {
        try { await chrome.tabs.sendMessage(tab.id, { type: 'stop' }); } catch (e) { /* tab may not have content script */ }
      }
      await chrome.storage.local.set({ isRunning: false, autoStopAt: null });
      return;
    }

    // Schedule check
    if (d.isRunning) return;
    const now = new Date();
    const hhmm = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    if (lastScheduleTrigger === hhmm) return;

    const scheds = d.schedules || [];
    const match = scheds.find(s => s.time === hhmm && s.enabled !== false);
    if (!match) return;

    const scenarios = d.scenarios || [];
    const sc = scenarios[match.scenarioIdx];
    if (!sc) return;

    lastScheduleTrigger = hhmm;
    const tabs = await chrome.tabs.query({ url: ['*://www.facebook.com/*', '*://web.facebook.com/*'] });
    if (tabs.length === 0) return;

    const settings = JSON.parse(JSON.stringify(sc.settings));
    await chrome.storage.local.set({ isRunning: true, settings, runStartTime: Date.now() });

    try {
      await chrome.tabs.sendMessage(tabs[0].id, { type: 'start', settings });
    } catch {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content.js'] });
        await new Promise(r => setTimeout(r, 800));
        await chrome.tabs.sendMessage(tabs[0].id, { type: 'start', settings });
      } catch (e) {
        console.error('[AutoFB] Schedule start failed:', e.message);
      }
    }
  } catch (e) {
    console.error('[AutoFB] Alarm handler error:', e.message);
  }
});

// ===== MESSAGE HANDLER =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'gemini-comment') {
    generateAIComment(msg.postContent, msg.settings || {})
      .then(sendResponse)
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true; // Keep message channel open for async response
  }

  if (msg.type === 'log') {
    chrome.storage.local.get(['logs'], d => {
      const logs = d.logs || [];
      logs.push({ text: msg.text, type: msg.level, time: Date.now() });
      if (logs.length > 500) logs.splice(0, logs.length - 500);
      chrome.storage.local.set({ logs });
    });
  }
});

// ===== GEMINI AI COMMENT GENERATION =====
const TONE_MAP = {
  friendly: 'thân thiện, vui vẻ, tích cực',
  professional: 'chuyên nghiệp, lịch sự, có chiều sâu',
  casual: 'thoải mái, gần gũi, tự nhiên',
  enthusiastic: 'nhiệt tình, hào hứng, động viên',
};

async function generateAIComment(postContent, aiSettings) {
  const apiKey = aiSettings.apiKey;
  if (!apiKey) return { success: false, error: 'Thiếu API key' };
  if (!postContent || postContent.trim().length < 5) return { success: false, error: 'Nội dung bài quá ngắn' };

  const tone = aiSettings.tone || 'friendly';
  const lang = aiSettings.lang || 'auto';
  const maxLen = Math.min(aiSettings.maxLen || 100, 200);
  const toneDesc = TONE_MAP[tone] || TONE_MAP.friendly;

  let langInstruction = 'Nếu bài viết bằng tiếng Việt thì comment tiếng Việt, bài tiếng Anh thì comment tiếng Anh';
  if (lang === 'vi') langInstruction = 'Luôn comment bằng tiếng Việt';
  else if (lang === 'en') langInstruction = 'Luôn comment bằng tiếng Anh';

  const prompt = `Bạn là người dùng Facebook bình thường. Đọc bài viết sau và viết MỘT comment ngắn gọn.

Yêu cầu:
- Giọng điệu: ${toneDesc}
- Tối đa ${maxLen} ký tự
- ${langInstruction}
- Comment phải LIÊN QUAN đến nội dung bài viết
- Viết tự nhiên như người thật, KHÔNG dùng hashtag
- Có thể dùng 1 emoji phù hợp
- KHÔNG lặp lại nội dung bài viết
- CHỈ trả về duy nhất câu comment, không giải thích gì thêm

Bài viết:
"""
${postContent.substring(0, 800)}
"""

Comment:`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9, maxOutputTokens: 80, topP: 0.95 },
        }),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { success: false, error: 'API lỗi ' + resp.status + ': ' + errText.substring(0, 80) };
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { success: false, error: 'Gemini không trả về kết quả' };

    let clean = text.replace(/^["'"""]+|["'"""]+$/g, '').replace(/^Comment:\s*/i, '').trim();
    if (clean.length > maxLen) clean = clean.substring(0, maxLen);
    if (clean.length < 2) return { success: false, error: 'Comment quá ngắn' };

    return { success: true, comment: clean };
  } catch (e) {
    return { success: false, error: 'Lỗi kết nối: ' + e.message };
  }
}
