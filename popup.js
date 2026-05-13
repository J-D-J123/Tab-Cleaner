const DEFAULTS = {
  enabled: true,
  mode: 'all',
  history: true,
  cookies: true,
  cache: true,
  cacheStorage: true,
  formData: true,
  localStorage: true,
  indexedDB: true,
  serviceWorkers: true,
  fileSystems: true,
  webSQL: false,
  passwords: false,
  downloads: true,
  timespanHours: 0,
};

const LABELS = {
  history: 'History', cookies: 'Cookies', cache: 'Cache',
  cacheStorage: 'Cache storage', formData: 'Form data',
  localStorage: 'Local storage', indexedDB: 'IndexedDB',
  serviceWorkers: 'Service workers', fileSystems: 'File systems',
  webSQL: 'Web SQL', passwords: 'Passwords', downloads: 'Downloads',
};

const MODE_LABELS = {
  all: 'Every tab close',
  origin: 'Site data only',
  'last-tab': 'On last tab close',
};

const toggle     = document.getElementById('enabled-toggle');
const statusBar  = document.getElementById('status-bar');
const statusIcon = document.getElementById('status-icon');
const statusText = document.getElementById('status-text');
const modeLabel  = document.getElementById('mode-label');
const chipsEl    = document.getElementById('chips');

// ── Init ─────────────────────────────────────────────────────────────────────

chrome.storage.sync.get(DEFAULTS, (s) => {
  toggle.checked = s.enabled;
  renderStatus(s);
  renderChips(s);
  modeLabel.textContent = MODE_LABELS[s.mode] ?? 'Every tab close';
});

chrome.storage.local.get('clearHistory', ({ clearHistory = [] }) => {
  renderStats(clearHistory);
  renderChart(clearHistory);
});

// ── Events ───────────────────────────────────────────────────────────────────

toggle.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: toggle.checked }, () => {
    chrome.storage.sync.get(DEFAULTS, renderStatus);
  });
});

document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

document.getElementById('clear-now').addEventListener('click', async () => {
  const s = await new Promise((r) => chrome.storage.sync.get(DEFAULTS, r));

  const since = s.timespanHours === 0 ? 0 : Date.now() - s.timespanHours * 3_600_000;

  // Count both BEFORE clearing
  const [cookieCount, historyCount] = await Promise.all([
    s.cookies ? countCookies()         : Promise.resolve(0),
    s.history ? countHistory(since)    : Promise.resolve(0),
  ]);

  const dataTypes = buildDataTypes(s);
  if (Object.keys(dataTypes).length > 0) {
    await safeRemove({ since }, dataTypes);
  }

  // Save record and refresh
  const { clearHistory = [] } = await chrome.storage.local.get('clearHistory');
  clearHistory.push({ ts: Date.now(), cookies: cookieCount, history: historyCount });
  if (clearHistory.length > 100) clearHistory.splice(0, clearHistory.length - 100);
  await chrome.storage.local.set({ clearHistory });

  statusText.textContent = `Cleared — ${cookieCount} cookies, ${fmt(historyCount)} history`;
  renderStats(clearHistory);
  renderChart(clearHistory);
  setTimeout(() => renderStatus(s), 2500);
});

// ── Counting helpers ─────────────────────────────────────────────────────────

async function countCookies() {
  try {
    const all = await chrome.cookies.getAll({});
    return all.length;
  } catch { return 0; }
}

async function countHistory(since) {
  try {
    const items = await chrome.history.search({
      text: '',
      startTime: since > 0 ? since : 1,
      maxResults: 100000,
    });
    return items?.length ?? 0;
  } catch (err) {
    console.error('[Tab Cleaner] history count:', err?.message);
    return 0;
  }
}

// ── Status + chips ───────────────────────────────────────────────────────────

function renderStatus(s) {
  if (s.enabled) {
    statusBar.classList.remove('off');
    statusIcon.textContent = '✓';
    statusText.textContent = `Active — ${MODE_LABELS[s.mode] ?? 'every tab close'}`;
  } else {
    statusBar.classList.add('off');
    statusIcon.textContent = '✕';
    statusText.textContent = 'Disabled — not clearing on close';
  }
}

function renderChips(s) {
  chipsEl.innerHTML = '';
  for (const [key, label] of Object.entries(LABELS)) {
    if (s[key]) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = label;
      chipsEl.appendChild(chip);
    }
  }
}

function buildDataTypes(s) {
  const t = {};
  const keys = ['history','cookies','cache','cacheStorage','formData',
                 'localStorage','indexedDB','serviceWorkers','fileSystems',
                 'webSQL','passwords','downloads'];
  for (const k of keys) if (s[k]) t[k] = true;
  return t;
}

async function safeRemove(options, types) {
  try {
    await chrome.browsingData.remove(options, types);
  } catch (err) {
    const msg = err?.message ?? '';
    if (!msg.includes('not supported')) throw err;
    for (const [k, v] of Object.entries(types)) {
      try { await chrome.browsingData.remove(options, { [k]: v }); } catch { /* skip */ }
    }
  }
}

// ── Stats grid ───────────────────────────────────────────────────────────────

function renderStats(history) {
  const totalCookies  = history.reduce((s, r) => s + (r.cookies  || 0), 0);
  const totalHistory  = history.reduce((s, r) => s + (r.history  || 0), 0);

  document.getElementById('stat-cookies').textContent  = fmt(totalCookies);
  document.getElementById('stat-history').textContent  = fmt(totalHistory);

  const todayStart  = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayClears = history.filter(r => r.ts >= todayStart.getTime()).length;
  document.getElementById('stat-today').textContent = todayClears;

  const last = history[history.length - 1];
  document.getElementById('stat-last').textContent = last ? timeAgo(last.ts) : 'never';
}

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1)     + 'K';
  return String(n);
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Stacked bar chart ────────────────────────────────────────────────────────
// Bottom (indigo) = cookies   Top (amber) = history items

function renderChart(history) {
  const canvas = document.getElementById('chart');
  const wrap   = canvas.parentElement;
  const dpr    = window.devicePixelRatio || 1;
  const W      = wrap.clientWidth;
  const H      = wrap.clientHeight;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, W, H);

  const records = history.slice(-30);

  // Legend
  const legY = 8;
  ctx.font = '8px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#4f46e5'; ctx.fillRect(8, legY - 4, 10, 8);
  ctx.fillStyle = '#6b7280'; ctx.fillText('Cookies', 21, legY);
  ctx.fillStyle = '#f59e0b'; ctx.fillRect(72, legY - 4, 10, 8);
  ctx.fillStyle = '#6b7280'; ctx.fillText('History', 85, legY);

  if (records.length === 0) {
    ctx.fillStyle   = '#9ca3af';
    ctx.font        = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Close a tab to see data', W / 2, H / 2 + 6);
    return;
  }

  const PAD_L = 32, PAD_R = 8, PAD_T = 20, PAD_B = 18;
  const cW = W - PAD_L - PAD_R;
  const cH = H - PAD_T - PAD_B;

  const maxVal = Math.max(...records.map(r => (r.cookies || 0) + (r.history || 0)), 1);

  // Grid lines + Y labels
  ctx.font = '8px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const pct = i / 4;
    const y   = PAD_T + cH - pct * cH;
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + cW, y); ctx.stroke();
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'right';
    ctx.fillText(fmt(Math.round(pct * maxVal)), PAD_L - 3, y);
  }

  // Stacked bars
  const gap  = 2;
  const barW = Math.max(4, Math.floor(cW / records.length) - gap);

  records.forEach((rec, i) => {
    const cookies = rec.cookies || 0;
    const hist    = rec.history || 0;
    const total   = cookies + hist;
    if (total === 0) return;

    const totalH  = Math.max(2, (total   / maxVal) * cH);
    const cookieH = Math.round((cookies  / total)  * totalH);
    const histH   = totalH - cookieH;
    const x       = PAD_L + i * (barW + gap);
    const baseY   = PAD_T + cH;

    const alpha = 0.4 + 0.6 * ((i + 1) / records.length);

    // History segment (top, amber)
    if (histH > 0) {
      ctx.fillStyle = `rgba(245, 158, 11, ${alpha})`;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, baseY - totalH, barW, histH, [2, 2, 0, 0]);
      else ctx.rect(x, baseY - totalH, barW, histH);
      ctx.fill();
    }

    // Cookie segment (bottom, indigo)
    if (cookieH > 0) {
      ctx.fillStyle = `rgba(79, 70, 229, ${alpha})`;
      ctx.beginPath();
      ctx.rect(x, baseY - cookieH, barW, cookieH);
      ctx.fill();
    }
  });

  // X axis caption
  ctx.fillStyle    = '#9ca3af';
  ctx.font         = '9px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Last ${records.length} clears`, W / 2, H - 3);
}
