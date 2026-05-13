const DEFAULTS = {
  enabled: true,
  mode: 'all',        // 'all' | 'origin' | 'last-tab'
  history: true,
  cookies: true,
  cache: true,
  cacheStorage: true,
  formData: true,
  localStorage: true,
  indexedDB: true,
  serviceWorkers: true,
  fileSystems: true,
  webSQL: false,      // removed in Chrome 119+; off by default
  downloads: true,
  passwords: false,   // opt-in only
  timespanHours: 0,
};

const ORIGIN_SCOPED = new Set([
  'cookies', 'cache', 'cacheStorage', 'localStorage',
  'indexedDB', 'serviceWorkers', 'webSQL', 'fileSystems',
]);

// ── Tab URL tracking ─────────────────────────────────────────────────────────

async function saveTabUrl(tabId, url) {
  if (!url || url.startsWith('chrome') || url.startsWith('about')) return;
  await chrome.storage.session.set({ [`t_${tabId}`]: url });
}

async function popTabUrl(tabId) {
  const key = `t_${tabId}`;
  const res = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  return res[key] ?? null;
}

function seedTabUrls() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) saveTabUrl(tab.id, tab.url);
  });
}

chrome.runtime.onStartup.addListener(seedTabUrls);
chrome.runtime.onInstalled.addListener(seedTabUrls);
chrome.tabs.onUpdated.addListener((tabId, _c, tab) => { if (tab?.url) saveTabUrl(tabId, tab.url); });
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => { if (tab?.url) saveTabUrl(tabId, tab.url); });
});

// ── Main clear trigger ───────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const [settings, tabUrl] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    popTabUrl(tabId),
  ]);

  if (!settings.enabled) return;

  if (settings.mode === 'last-tab') {
    const remaining = await chrome.tabs.query({});
    if (remaining.length > 0) return;
  }

  const { siteTypes, historyTypes } = splitDataTypes(settings);
  const anySite    = Object.keys(siteTypes).length > 0;
  const anyHistory = Object.keys(historyTypes).length > 0;
  if (!anySite && !anyHistory) return;

  const historySince = settings.timespanHours === 0
    ? 0
    : Date.now() - settings.timespanHours * 3_600_000;

  // Count BEFORE clearing so the numbers are accurate
  const [cookieCount, historyCount] = await Promise.all([
    settings.cookies ? countCookies()              : Promise.resolve(0),
    settings.history ? countHistory(historySince)  : Promise.resolve(0),
  ]);

  try {
    if (settings.mode === 'origin' && tabUrl) {
      await clearByOrigin(tabUrl, siteTypes, historyTypes, historySince);
    } else {
      if (anySite)    await safeRemove({ since: 0 }, siteTypes);
      if (anyHistory) await safeRemove({ since: historySince }, historyTypes);
    }
    await clearContentSettings();
    await saveRecord({ ts: Date.now(), cookies: cookieCount, history: historyCount });
  } catch (err) {
    console.error('[Tab Cleaner]', err.message);
  }
});

// ── Pre-clear counters ───────────────────────────────────────────────────────

async function countCookies() {
  try {
    const all = await chrome.cookies.getAll({});
    return all.length;
  } catch { return 0; }
}

async function countHistory(since) {
  try {
    // startTime:0 is falsy — Chrome treats it as "unset" and defaults to 24h ago.
    // Use 1 to mean "from the very beginning of time".
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

// ── Safe browsingData.remove ─────────────────────────────────────────────────
// If any type is unsupported by this Chrome build, removes it and retries
// rather than failing the entire clear.

async function safeRemove(options, types) {
  try {
    await chrome.browsingData.remove(options, types);
  } catch (err) {
    const msg = err?.message ?? '';
    if (!msg.includes('not supported')) throw err;

    // Extract the unsupported type names from the error message and retry
    const bad = new Set(
      (msg.match(/appcache|passwords|webSQL|fileSystems|pluginData/g) ?? [])
    );
    // If we can't parse which ones, just try each key individually
    if (bad.size === 0) {
      for (const [k, v] of Object.entries(types)) {
        try { await chrome.browsingData.remove(options, { [k]: v }); } catch { /* skip */ }
      }
      return;
    }
    const safe = Object.fromEntries(Object.entries(types).filter(([k]) => !bad.has(k)));
    if (Object.keys(safe).length > 0) await chrome.browsingData.remove(options, safe);
  }
}

// ── Content settings (site permissions) ─────────────────────────────────────

const CONTENT_SETTING_KEYS = [
  'automaticDownloads', 'camera', 'clipboard', 'cookies',
  'fullscreen', 'geolocation', 'images', 'javascript',
  'microphone', 'midi', 'notifications', 'popups',
  'protectedContent', 'sensors', 'sound', 'unsandboxedPlugins',
];

async function clearContentSettings() {
  const tasks = CONTENT_SETTING_KEYS
    .filter(k => chrome.contentSettings?.[k])
    .map(k => new Promise((res) => {
      try { chrome.contentSettings[k].clear({}, res); } catch { res(); }
    }));
  await Promise.all(tasks);
}

// ── Stats history ────────────────────────────────────────────────────────────

async function saveRecord(record) {
  const { clearHistory = [] } = await chrome.storage.local.get('clearHistory');
  clearHistory.push(record);
  if (clearHistory.length > 100) clearHistory.splice(0, clearHistory.length - 100);
  await chrome.storage.local.set({ clearHistory });
}

// ── Data type splitting ──────────────────────────────────────────────────────

function splitDataTypes(s) {
  const siteTypes    = {};
  const historyTypes = {};

  if (s.cookies)        siteTypes.cookies        = true;
  if (s.cache)          siteTypes.cache          = true;
  if (s.cacheStorage)   siteTypes.cacheStorage   = true;
  if (s.localStorage)   siteTypes.localStorage   = true;
  if (s.indexedDB)      siteTypes.indexedDB      = true;
  if (s.serviceWorkers) siteTypes.serviceWorkers = true;
  if (s.fileSystems)    siteTypes.fileSystems    = true;
  if (s.webSQL)         siteTypes.webSQL         = true;
  if (s.downloads)      siteTypes.downloads      = true;

  if (s.history)   historyTypes.history   = true;
  if (s.formData)  historyTypes.formData  = true;
  if (s.passwords) historyTypes.passwords = true;

  return { siteTypes, historyTypes };
}

async function clearByOrigin(rawUrl, siteTypes, historyTypes, historySince) {
  let origin;
  try { origin = new URL(rawUrl).origin; } catch { return; }
  if (!origin || origin === 'null') return;

  const scopedSite = {};
  const globalSite = {};
  for (const [k, v] of Object.entries(siteTypes)) {
    if (ORIGIN_SCOPED.has(k)) scopedSite[k] = v;
    else globalSite[k] = v;
  }

  if (Object.keys(scopedSite).length > 0)
    await safeRemove({ since: 0, origins: [origin] }, scopedSite);
  if (Object.keys(globalSite).length > 0)
    await safeRemove({ since: 0 }, globalSite);
  if (Object.keys(historyTypes).length > 0)
    await safeRemove({ since: historySince }, historyTypes);
}
