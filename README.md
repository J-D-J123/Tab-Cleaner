# Tab Cleaner

A Chrome / Chromium browser extension that automatically wipes your browsing data every time you close a tab — cookies, cache, history, site storage, permissions, and more.

---

## Features

- **Auto-clears on every tab close** — no manual action needed
- **Tracks what it removes** — live bar chart showing cookies and history items cleared per session
- **Wipes everything Chrome stores on you:**
  - Cookies & site data
  - Cached images & files
  - Cache storage (PWA / service worker cache)
  - Browsing history
  - Autofill form data
  - Local storage
  - IndexedDB databases
  - Service workers
  - File system data
  - Download history
  - Site permissions (camera, microphone, notifications, geolocation, and more)
- **Three clearing modes:**
  - Every tab close *(default)*
  - Site data only — clears only the site you just closed
  - On last tab close — waits until all tabs are gone
- **History time range** — choose how far back history is cleared; cookies and cache always do a full wipe regardless
- **Stats dashboard** — see total cookies removed, total history removed, clears today, and time of last clear

---

## Installation

This is an unpacked extension — Chrome Web Store submission is optional.

1. Download or clone this repository
2. Open Chrome / Chromium and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `Cleaner` folder
6. The Tab Cleaner icon will appear in your toolbar

To update after any file change: go back to `chrome://extensions/` and click the **reload** button on the card.

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `browsingData` | Clear history, cache, cookies, and site storage |
| `cookies` | Count cookies before each clear for the stats graph |
| `history` | Count history items before each clear for the stats graph |
| `contentSettings` | Reset per-site permissions (camera, mic, notifications, etc.) |
| `tabs` | Detect when a tab is closed |
| `storage` | Save your settings and clear history locally |
| `<all_urls>` | Required by Chrome to read cookie counts across all domains |

---

## Project Structure

```
Cleaner/
├── manifest.json        Chrome extension manifest (Manifest V3)
├── background.js        Service worker — listens for tab close, runs the clear
├── popup.html/js/css    Toolbar popup with stats graph and toggle
├── options.html/js/css  Full settings page
└── icons/               PNG + SVG icons at 16, 32, 48, 128px
```

---

## Settings

Open the popup and click **Settings**, or right-click the toolbar icon and choose *Options*.

| Setting | Default | Description |
|---|---|---|
| Browsing history | On | URLs you have visited |
| Cookies & site data | On | Login sessions and all cookies |
| Cached images & files | On | HTTP cache |
| Cache storage | On | PWA / service worker cache |
| Autofill form data | On | Saved names, addresses, searches |
| Local storage | On | Per-site key/value data |
| IndexedDB | On | Site databases |
| Service workers | On | Background scripts |
| File systems | On | File System API data |
| Download history | On | Log of downloaded files |
| Web SQL | Off | Legacy databases (removed in Chrome 119+) |
| Saved passwords | Off | Opt-in — permanently removes all saved passwords |
| History time range | All time | How far back history is cleared |

---

## Notes

- **Passwords are off by default.** Enabling them permanently removes all passwords saved in Chrome. Only turn this on if you know what you're doing.
- **Web SQL is off by default.** It was removed from Chrome 119+ and will silently be skipped if unsupported.
- The extension gracefully skips any data type that your browser version does not support — it will never throw an error and stop the clear mid-way.
- Stats are stored locally in `chrome.storage.local` and never leave your device.
