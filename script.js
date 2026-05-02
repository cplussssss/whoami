/* ════════════════════════════════════
   CONFIG — 把這裡換成你的 Worker 網址
════════════════════════════════════ */
const WORKER_URL = 'https://whoami.sijialai1473.workers.dev';
const POMODORO_URL = 'https://cplussssss.github.io/Focus/';

/* ════════════════════════════════════
   STATE
════════════════════════════════════ */
let currentState = null;
let currentTask  = null;
let goalText     = '';

const KEY_LOG    = 'ahn_log';
const KEY_WEEKLY = 'ahn_weekly';

/* ════════════════════════════════════
   INIT
════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  const d = new Date();
  document.getElementById('todayDate').textContent =
    `${d.getMonth() + 1}/${d.getDate()} 今天`;

  renderLog();
  renderWeekly();
  updateStats();
  renderInsight();
});

/* ════════════════════════════════════
   SCREEN SWITCHER
════════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.left-screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ════════════════════════════════════
   STATE SELECT
════════════════════════════════════ */
function selectState(btn) {
  document.querySelectorAll('.state-opt').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  currentState = btn.dataset.state;

  document.querySelector('.app').classList.add('layer2');

  const genBtn = document.getElementById('generateBtn');
  genBtn.style.opacity = '1';
  genBtn.style.pointerEvents = 'auto';
}

/* ════════════════════════════════════
   GENERATE TASK via Groq (Cloudflare Workers proxy)
   JITAI 邏輯：根據 tailoring variable（狀態）
   套用 decision rule → 選擇對應的 intervention option
════════════════════════════════════ */
async function generateTask(simplified = false) {
  goalText = document.getElementById('goalInput')?.value?.trim() || '';
  showScreen('screen-loading');

  // 取最近 5 筆完成紀錄，帶入 prompt 做個人化
  const recentLog = getLog()
    .filter(l => l.status === 'done')
    .slice(0, 5)
    .map(l => `・${l.title}（${l.duration}，${l.ts.slice(0, 10)}）`)
    .join('\n');

  // JITAI — Tailoring Variables
  const stateMap = {
    exhausted: '非常疲憊，腦子轉不動，精力只剩 1/5',
    tired:     '有點累，精力約 2-3/5，但想動一下',
    neutral:   '狀態普通，精力 3/5，可以正常執行',
    energized: '精力充沛，狀態很好，精力 4-5/5'
  };

  // JITAI — Decision Rules（任務時間由狀態決定）
  const durationRule = {
    exhausted: '2分鐘（精力太低，只需打開門檻）',
    tired:     '3分鐘（低阻力啟動）',
    neutral:   '5分鐘（正常可執行）',
    energized: '10分鐘（可挑戰稍難的任務）'
  };

  const simplifyNote = simplified
    ? '（使用者說上一個任務太難了，請依據JITAI原則再降低一個難度等級）'
    : '';

  const historySection = recentLog
    ? `使用者最近完成的任務（個人化參考，避免重複，可在此基礎上延伸下一步）：\n${recentLog}`
    : '（尚無歷史紀錄，請給第一次啟動的任務）';

  const prompt = `
你是一個基於 JITAI（Just-In-Time Adaptive Intervention）設計的 AI 習慣導航員。

使用者當下狀態（Tailoring Variable）：${stateMap[currentState] || '普通'}
使用者想做：${goalText || '任何有幫助的事'}
建議任務時間（Decision Rule）：${durationRule[currentState] || '5分鐘'}
${historySection}
${simplifyNote}

請根據 JITAI 原則，在這個「決策點」給出最適合現在開始的最小任務（Intervention Option）。

規則：
- 任務必須非常具體，不能是「讀書」，要是「打開書本翻到上次的頁面」
- 如果有歷史紀錄，請根據上次任務的延伸給出下一步，讓使用者感覺有進度感
- 語氣溫柔，不命令，像朋友建議
- 不使用「你應該」
- 精力越低，任務越小、語氣越輕

只回 JSON，不要其他文字：
{
  "duration": "任務時間（如：3 分鐘）",
  "title": "具體任務名稱",
  "why": "一句為什麼這樣設計的說明（溫柔口吻）",
  "note": "AI 給使用者的一句話（理解狀態，不責備，像朋友）",
  "encouragement": "專注模式中顯示的鼓勵語（15字以內）"
}
`.trim();

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600
      })
    });

    if (!res.ok) throw new Error(`Worker 回應錯誤：${res.status}`);

    const data = await res.json();
    let text = data.choices?.[0]?.message?.content || '';
    text = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(text);
    currentTask = parsed;
    showTaskScreen(parsed);

  } catch (e) {
    console.error('Task generation error:', e);
    useFallbackTask();
  }
}

function useFallbackTask() {
  const fallbacks = {
    exhausted: { duration: '2 分鐘', title: '打開你要做的東西，看一眼就好',         why: '就算只是打開，也比什麼都沒做更好。',       note: '你很累了，沒關係。2 分鐘，隨時可以停。',     encouragement: '打開就是開始了'   },
    tired:     { duration: '3 分鐘', title: '把今天最重要的一件事寫下來',           why: '寫下來能幫大腦卸下記憶的重量。',           note: '有點累但還想動，這樣的你已經很好了。',       encouragement: '寫下來，就輕了一點' },
    neutral:   { duration: '5 分鐘', title: '把桌面清理一下，只留今天要用的東西',   why: '清晰的環境能降低大腦的啟動阻力。',         note: '普通的狀態也能做出好的開始。',               encouragement: '環境清，心也清'   },
    energized: { duration: '10 分鐘', title: '直接開始你最重要的任務，設 10 分鐘計時', why: '動力高的時候，先給大目標一個小開頭。',   note: '你今天狀態很好！把這份能量用對地方。',       encouragement: '現在最適合開始'   },
  };
  currentTask = fallbacks[currentState] || fallbacks.neutral;
  showTaskScreen(currentTask);
}

function showTaskScreen(task) {
  document.getElementById('taskDuration').textContent = task.duration;
  document.getElementById('taskTitle').textContent    = task.title;
  document.getElementById('taskWhy').textContent      = task.why || '';
  document.getElementById('aiNote').innerHTML = `<strong>AI：</strong>${task.note}`;
  showScreen('screen-task');
}

/* ════════════════════════════════════
   SIMPLIFY
════════════════════════════════════ */
function simplifyTask() { generateTask(true); }
async function simplifyAndRestart() { await generateTask(true); }

/* ════════════════════════════════════
   START FOCUS
════════════════════════════════════ */
function startFocus() {
  if (!currentTask) return;
  document.getElementById('focusTaskDisplay').textContent   = currentTask.title;
  document.getElementById('focusEncouragement').textContent = currentTask.encouragement || '你可以的，先試試。';
  hidePomodoro();
  showScreen('screen-focus');
}

/* ════════════════════════════════════
   POMODORO IFRAME
════════════════════════════════════ */
function showPomodoro() {
  const card  = document.getElementById('focusIframeCard');
  const frame = document.getElementById('pomodoroFrame');
  if (frame.src === 'about:blank' || frame.src === '') {
    frame.src = POMODORO_URL;
  }
  card.classList.add('show');
  card.scrollIntoView({ behavior: 'smooth' });
}

function hidePomodoro() {
  document.getElementById('focusIframeCard').classList.remove('show');
}

/* ════════════════════════════════════
   COMPLETE — JITAI 立即回饋（Decision Point：任務完成後）
════════════════════════════════════ */
async function completeTask() {
  const entry = {
    title:    currentTask?.title    || '專注一輪',
    duration: currentTask?.duration || '—',
    ts:       new Date().toISOString(),
    status:   'done'
  };
  saveLog(entry);
  updateStats();
  renderLog();
  renderWeekly();
  renderInsight();

  let msg = '你完成了一輪專注。每一次開始，都是改變的積累。';

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: `使用者剛剛完成了這個任務：「${currentTask?.title}」。請給他一句簡短溫暖的完成回饋（繁體中文，40字以內，語氣像朋友，不要太誇張，不要用「太棒了」或「超讚」）。只回那一句話就好。`
        }],
        max_tokens: 200
      })
    });

    if (res.ok) {
      const data = await res.json();
      msg = data.choices?.[0]?.message?.content || msg;
    }
  } catch (e) {
    console.error('Completion message error:', e);
  }

  document.getElementById('completionMsg').textContent = msg;
  document.getElementById('completionOverlay').classList.add('show');
  updateEncouragement();
}

function closeCompletion() {
  document.getElementById('completionOverlay').classList.remove('show');
  goBackToCheckin();
}

/* ════════════════════════════════════
   RESET
════════════════════════════════════ */
function showReset() { showScreen('screen-reset'); }

function goBackToCheckin() {
  document.querySelectorAll('.state-opt').forEach(b => b.classList.remove('selected'));
  currentState = null;
  currentTask  = null;
  document.getElementById('goalInput').value = '';
  const genBtn = document.getElementById('generateBtn');
  genBtn.style.opacity      = '0.4';
  genBtn.style.pointerEvents = 'none';
  hidePomodoro();
  document.querySelector('.app').classList.remove('layer2');
  showScreen('screen-checkin');
}

/* ════════════════════════════════════
   ENCOURAGEMENT
════════════════════════════════════ */
const encouragements = [
  '打開這裡，就是一個開始。\n不需要完美，只需要一小步。',
  '你已經做到最難的那一步了。\n開始，本來就不容易。',
  '每一輪專注，都在累積屬於你的改變。',
  '不是每天都有動力，但你還是打開了這裡。',
];
const identities = [
  '每天都能重新開始的人',
  '懂得照顧自己節奏的人',
  '把小事做完的人',
  '不放棄的人',
];

function updateEncouragement() {
  const log = getLog();
  const idx = log.length % encouragements.length;
  document.getElementById('encText').textContent      = encouragements[idx];
  document.getElementById('identityWord').textContent = identities[idx % identities.length];
}

/* ════════════════════════════════════
   LOG
════════════════════════════════════ */
function getLog() {
  try { return JSON.parse(localStorage.getItem(KEY_LOG) || '[]'); }
  catch (e) { return []; }
}
function saveLog(entry) {
  const log = getLog();
  log.unshift(entry);
  localStorage.setItem(KEY_LOG, JSON.stringify(log.slice(0, 100)));
}
function clearLog() {
  if (confirm('確定要清除所有紀錄？')) {
    localStorage.removeItem(KEY_LOG);
    localStorage.removeItem(KEY_WEEKLY);
    renderLog(); updateStats(); renderWeekly(); renderInsight();
  }
}

function renderLog() {
  const log = getLog();
  const el  = document.getElementById('taskLogList');
  if (log.length === 0) {
    el.innerHTML = '<div class="task-log-empty">還沒有紀錄。完成第一輪後就會顯示在這裡。</div>';
    return;
  }
  el.innerHTML = log.slice(0, 8).map(item => {
    const d    = new Date(item.ts);
    const time = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    return `
      <div class="task-log-item">
        <div class="task-log-dot ${item.status === 'done' ? 'done' : 'skipped'}"></div>
        <div class="task-log-content">
          <div class="task-log-name">${item.title}</div>
          <div class="task-log-meta">${time} · ${item.duration}</div>
        </div>
      </div>`;
  }).join('');
}

/* ════════════════════════════════════
   STATS
════════════════════════════════════ */
function updateStats() {
  const log     = getLog();
  const today   = new Date().toISOString().slice(0, 10);
  const todayLog = log.filter(l => l.ts.startsWith(today) && l.status === 'done');
  const total    = log.filter(l => l.ts.startsWith(today));

  const done = todayLog.length;
  const mins = todayLog.reduce((s, l) => s + (parseInt(l.duration) || 0), 0);
  const rate = total.length > 0 ? Math.round(done / total.length * 100) : null;

  document.getElementById('statDone').innerHTML  = `${done}<small>輪</small>`;
  document.getElementById('statMins').innerHTML  = `${mins}<small>分</small>`;
  document.getElementById('statRate').textContent = rate !== null ? `${rate}%` : '—';

  document.getElementById('progressFill').style.width      = Math.min(done / 4 * 100, 100) + '%';
  document.getElementById('progressLabel').textContent     = `${done} / 4`;
}

/* ════════════════════════════════════
   WEEKLY CHART
════════════════════════════════════ */
function renderWeekly() {
  const log   = getLog();
  const days  = ['日','一','二','三','四','五','六'];
  const today = new Date();
  const el    = document.getElementById('weekChart');
  el.innerHTML = '';

  for (let i = 6; i >= 0; i--) {
    const d     = new Date(today);
    d.setDate(today.getDate() - i);
    const key   = d.toISOString().slice(0, 10);
    const count = log.filter(l => l.ts.startsWith(key) && l.status === 'done').length;
    const isToday = i === 0;
    const h     = count > 0 ? Math.max(10, Math.min(count * 14, 68)) : 4;

    const wrap = document.createElement('div');
    wrap.className = 'week-bar-wrap';
    wrap.innerHTML = `
      <div class="week-bar ${isToday ? 'today' : (count > 0 ? 'has-data' : '')}"
           style="height:${h}px" title="${count} 輪"></div>
      <div class="week-day ${isToday ? 'today' : ''}">${days[d.getDay()]}</div>`;
    el.appendChild(wrap);
  }
}

/* ════════════════════════════════════
   INSIGHT
════════════════════════════════════ */
function renderInsight() {
  const log      = getLog();
  const insights = [];

  if (log.length === 0) {
    insights.push({ icon: '🌱', text: '每次打開這個頁面，都是你選擇開始的證明。' });
    insights.push({ icon: '🔄', text: '重新開始的次數，比從不停止更重要。' });
  } else {
    const done = log.filter(l => l.status === 'done').length;
    insights.push({ icon: '✨', text: `你已經完成了 ${done} 輪專注。每一輪都算數。` });
    const uniqueDays = new Set(log.map(l => l.ts.slice(0, 10))).size;
    if (uniqueDays >= 2) {
      insights.push({ icon: '📅', text: `你已經 ${uniqueDays} 天打開了這裡，這比你想的更難得。` });
    } else {
      insights.push({ icon: '🔄', text: '重新開始的勇氣，比從來不停更珍貴。' });
    }
    if (done >= 3) insights.push({ icon: '🧭', text: '你開始的次數越來越多了。這就是改變的樣子。' });
  }

  document.getElementById('insightList').innerHTML = insights.map(i => `
    <div class="insight-item">
      <div class="insight-icon">${i.icon}</div>
      <div class="insight-text">${i.text}</div>
    </div>`).join('');
}