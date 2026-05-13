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
  downloads: false,
  timespanHours: 0,
};

const CHECKBOXES = [
  'history','cookies','cache','cacheStorage','formData',
  'localStorage','indexedDB','serviceWorkers','fileSystems',
  'webSQL','passwords','downloads',
];

chrome.storage.sync.get(DEFAULTS, (s) => {
  document.getElementById('enabled').checked = s.enabled;

  for (const r of document.querySelectorAll('input[name=mode]')) {
    r.checked = r.value === s.mode;
  }

  for (const key of CHECKBOXES) {
    const el = document.getElementById(key);
    if (el) el.checked = !!s[key];
  }

  const sel = document.getElementById('timespanHours');
  sel.value = String(s.timespanHours ?? 0);
});

document.getElementById('save-btn').addEventListener('click', () => {
  const modeEl = document.querySelector('input[name=mode]:checked');

  const settings = {
    enabled: document.getElementById('enabled').checked,
    mode: modeEl ? modeEl.value : 'all',
    timespanHours: Number(document.getElementById('timespanHours').value),
  };

  for (const key of CHECKBOXES) {
    const el = document.getElementById(key);
    settings[key] = el ? el.checked : false;
  }

  const statusEl = document.getElementById('save-status');

  chrome.storage.sync.set(settings, () => {
    if (chrome.runtime.lastError) {
      statusEl.className = 'error';
      statusEl.textContent = 'Error saving settings';
    } else {
      statusEl.className = '';
      statusEl.textContent = 'Saved!';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    }
  });
});
