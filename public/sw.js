/**
 * UOP Attendance — GPS Sample Service Worker
 *
 * Responsibilities:
 *  1. Background Sync: when the main thread buffers a failed GPS sample POST
 *     (network down), it registers the tag "gps-sample-sync". This SW fires
 *     the sync event when connectivity returns — even if the tab is backgrounded
 *     or the browser was briefly closed — and retries all stored samples.
 *
 *  2. Fetch passthrough: non-navigation same-origin requests pass through
 *     unchanged. Navigation requests (e.g. Google OAuth redirect) are NOT
 *     intercepted — letting the browser handle them natively avoids CORS
 *     issues with cross-origin redirects.
 *
 * Limitations:
 *  - The Geolocation API is not available in Service Workers. GPS collection
 *    must run on the main thread. This SW handles network reliability only.
 *  - Background Sync is supported on Chrome/Edge (Android + desktop).
 *    On iOS Safari and Firefox it degrades gracefully: sync events never fire,
 *    but the main-thread 5-second retry loop covers those platforms instead.
 */

const DB_NAME    = 'uop-gps-buffer';
const STORE_NAME = 'samples';
const DB_VERSION = 1;
const SYNC_TAG   = 'gps-sample-sync';
/** Discard buffered samples older than 10 minutes to avoid stale replays. */
const MAX_AGE_MS = 10 * 60 * 1000;

/* ── IndexedDB helpers ────────────────────────────────────────────────────── */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME, { autoIncrement: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = ()  => reject(req.error);
  });
}

function dbGetAll(db) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const items = [];
    const keys  = [];
    tx.objectStore(STORE_NAME).openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) { resolve({ items, keys }); return; }
      items.push(cursor.value);
      keys.push(cursor.key);
      cursor.continue();
    };
    tx.onerror = () => reject(tx.error);
  });
}

function dbDelete(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

/* ── Background Sync ──────────────────────────────────────────────────────── */

async function replaySamples() {
  const db = await openDb();
  const { items, keys } = await dbGetAll(db);
  const now = Date.now();

  for (let i = 0; i < items.length; i++) {
    const entry = items[i];

    // Discard stale samples (older than MAX_AGE_MS)
    if (entry.ts && now - entry.ts > MAX_AGE_MS) {
      await dbDelete(db, keys[i]);
      continue;
    }

    try {
      const resp = await fetch(entry.url, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',       // sends the session cookie
        body:        JSON.stringify(entry.payload),
      });

      if (resp.ok) {
        // 2xx — success, remove from buffer
        await dbDelete(db, keys[i]);
      } else if (resp.status >= 400 && resp.status < 500) {
        // 4xx — auth expired, session ended, bad data; retrying won't help
        await dbDelete(db, keys[i]);
      }
      // 5xx server errors: leave in buffer and retry on next sync event
    } catch {
      // Still offline — leave in buffer for next sync event
    }
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(replaySamples());
  }
});

/* ── Fetch passthrough ────────────────────────────────────────────────────── */

self.addEventListener('fetch', (event) => {
  // Do NOT intercept navigation requests (e.g. Google OAuth redirects to
  // accounts.google.com). Cross-origin navigations through a SW fail with
  // CORS errors; the browser must handle them natively.
  if (event.request.mode === 'navigate') return;

  // Pass all other requests through unchanged. This SW does not cache anything.
  event.respondWith(fetch(event.request));
});

/* ── Install / activate: take control immediately ────────────────────────── */

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
