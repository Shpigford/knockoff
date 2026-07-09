// Knockoff background service worker.
//
// Two jobs:
//  1. Toolbar button toggles the in-page control panel on Amazon tabs;
//     anywhere else (no content script to answer) it opens the settings page.
//  2. Detector-list subscriptions — the uBlock-style filter lists. This worker
//     owns fetching them from Hugging Face, caching them in chrome.storage.local
//     (content scripts can read that; they cannot read the extension's
//     IndexedDB), and refreshing them monthly. The lists are the base flagging
//     layer; the content script reads the cached text and builds its indexes.

// ── Detector-list subscriptions ──────────────────────────────────────────────

// The published dataset. The lists rebuild monthly; _manifest.json carries a
// `built_at` stamp and per-tier `n_marks`, and every file resolve carries an
// X-Repo-Commit header — either lets us skip re-downloading when nothing changed.
var DATASET =
  "https://huggingface.co/datasets/illeatmyhat/uspto-trademarks-detector/resolve/main/";

// Shipped defaults. All three on by default; users can toggle, remove, or drag
// in their own list URLs (see options page). `builtin` lists can be re-enabled
// but not deleted (no remove button in the options pane).
var DEFAULT_SUBS = [
  // level: "soft" applies below the established-brands veto (real brands exempt);
  // "strict" applies above it (catches even established brands). Junk tiers are
  // soft by default; the origin filter is strict (filter by origin regardless).
  { id: "tier1", name: "USPTO Trademark Radar Tier 1 - USPTO-adjudicated",
    desc: "Marks sanctioned by the USPTO.",
    url: DATASET + "tier1.txt", builtin: true, kind: "block", level: "soft", enabled: true },
  { id: "tier2", name: "USPTO Trademark Radar Tier 2 - Screened candidates",
    desc: "Marks with bulk-filing behavior.",
    url: DATASET + "tier2.txt", builtin: true, kind: "block", level: "soft", enabled: true },
  { id: "tier3", name: "USPTO Trademark Radar Tier 3 - Large filing operation",
    desc: "Marks filed by a large, high-churn operation.",
    url: DATASET + "tier3.txt", builtin: true, kind: "block", level: "soft", enabled: true },
  // Origin filter - opt-in, off by default. A country-of-origin preference
  // (registered owner country of record), not a junk signal.
  { id: "origin_cn", name: "Origin - China",
    desc: "Marks registered to a China owner of record. An origin filter, not a junk signal.",
    url: DATASET + "origin_cn.txt", builtin: true, kind: "origin", level: "strict", enabled: false }
];

var MANIFEST_URL = DATASET + "_manifest.json";
var REFRESH_ALARM = "ko-refresh-lists";
var REFRESH_PERIOD_MIN = 30 * 24 * 60; // ~monthly; lists rebuild monthly

// storage.local keys: koListData:<id> = raw newline text (the mark keys),
// koListMeta:<id> = { etag, builtAt, n, bytes, fetchedAt, ok, error }.
// storage.sync: koSubs = the subscription list (small, syncs across devices);
// koListsState = { builtAt, commit, checkedAt } from the last manifest probe.
function dataKey(id) { return "koListData:" + id; }
function metaKey(id) { return "koListMeta:" + id; }

function getSubs() {
  return chrome.storage.sync.get({ koSubs: null }).then(function (s) {
    if (!Array.isArray(s.koSubs) || !s.koSubs.length) return DEFAULT_SUBS.slice();
    // Merge in any builtin default shipped since these subs were saved (e.g. a
    // new origin list), so it appears for existing installs without a reset.
    // onInstalled persists the merged set on update.
    var subs = s.koSubs.slice();
    var have = {};
    subs.forEach(function (x) { have[x.id] = 1; });
    DEFAULT_SUBS.forEach(function (d) { if (!have[d.id]) subs.push(d); });
    return subs;
  });
}

function saveSubs(subs) {
  return chrome.storage.sync.set({ koSubs: subs });
}

function countLines(text) {
  // The files are one key per line; count non-empty lines without allocating
  // a giant array for the 900k-row tier.
  var n = 0, i = 0;
  while (i < text.length) {
    var nl = text.indexOf("\n", i);
    if (nl === -1) { if (i < text.length) n++; break; }
    if (nl > i) n++;
    i = nl + 1;
  }
  return n;
}

// Fetch one list. Conditional GET with the stored ETag so an unchanged file
// comes back 304 (empty body). Returns a status string for the UI.
function fetchOne(sub, meta) {
  var headers = {};
  if (meta && meta.etag) headers["If-None-Match"] = meta.etag;
  return fetch(sub.url, { headers: headers, cache: "no-cache" }).then(function (r) {
    if (r.status === 304) {
      var kept = Object.assign({}, meta, { fetchedAt: Date.now(), ok: true, error: null });
      return chrome.storage.local.set(objFor(metaKey(sub.id), kept)).then(function () { return "unchanged"; });
    }
    if (!r.ok) {
      var bad = Object.assign({}, meta || {}, { ok: false, error: "HTTP " + r.status, fetchedAt: Date.now() });
      return chrome.storage.local.set(objFor(metaKey(sub.id), bad)).then(function () { return "error"; });
    }
    var etag = r.headers.get("ETag");
    return r.text().then(function (text) {
      var newMeta = {
        etag: etag, builtAt: currentBuiltAt, n: countLines(text),
        bytes: text.length, fetchedAt: Date.now(), ok: true, error: null
      };
      var patch = {};
      patch[dataKey(sub.id)] = text;
      patch[metaKey(sub.id)] = newMeta;
      return chrome.storage.local.set(patch).then(function () { return "updated"; });
    });
  }).catch(function (e) {
    var bad = { ok: false, error: String(e && e.message || e), fetchedAt: Date.now() };
    return chrome.storage.local.set(objFor(metaKey(sub.id), Object.assign({}, meta || {}, bad)))
      .then(function () { return "error"; });
  });
}

function objFor(k, v) { var o = {}; o[k] = v; return o; }

var currentBuiltAt = null; // set from the manifest during a refresh

// Refresh all enabled subscriptions. Cheap path: probe _manifest.json; if the
// dataset's built_at hasn't moved since our last download and we're not forcing,
// touch checkedAt and skip every file. Otherwise conditional-GET each enabled
// list (ETag still spares the files that didn't actually change in the rebuild).
function refreshLists(force) {
  return getSubs().then(function (subs) {
    return fetch(MANIFEST_URL, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("manifest HTTP " + r.status);
      var commit = r.headers.get("X-Repo-Commit");
      return r.json().then(function (man) { return { man: man, commit: commit }; });
    }).then(function (probe) {
      currentBuiltAt = probe.man.built_at || null;
      return chrome.storage.sync.get({ koListsState: {} }).then(function (s) {
        var prev = s.koListsState || {};
        var unchanged = !force && prev.builtAt && prev.builtAt === currentBuiltAt;
        var state = { builtAt: currentBuiltAt, commit: probe.commit, checkedAt: Date.now(), manifest: probe.man };
        if (unchanged) {
          return chrome.storage.sync.set({ koListsState: state }).then(function () {
            return { changed: false, builtAt: currentBuiltAt };
          });
        }
        var enabled = subs.filter(function (x) { return x.enabled; });
        return chrome.storage.local.get(enabled.map(function (x) { return metaKey(x.id); })).then(function (metas) {
          return enabled.reduce(function (p, sub) {
            return p.then(function () { return fetchOne(sub, metas[metaKey(sub.id)]); });
          }, Promise.resolve()).then(function () {
            return chrome.storage.sync.set({ koListsState: state });
          }).then(function () {
            notifyTabsListsChanged();
            return { changed: true, builtAt: currentBuiltAt };
          });
        });
      });
    });
  });
}

// Tell open Amazon tabs to rebuild their indexes and rescan after a refresh,
// so a monthly update lands without a page reload.
function notifyTabsListsChanged() {
  // Amazon's many TLDs can't be one valid match pattern, so query all tabs and
  // message each; tabs without our content script just answer with lastError.
  chrome.tabs.query({}, function (tabs) {
    (tabs || []).forEach(function (t) {
      chrome.tabs.sendMessage(t.id, { type: "ko-lists-updated" }, function () { void chrome.runtime.lastError; });
    });
  });
}

// Status payload for the options page: subscriptions joined with their cached meta.
function listsStatus() {
  return getSubs().then(function (subs) {
    var keys = subs.map(function (x) { return metaKey(x.id); });
    return Promise.all([
      chrome.storage.local.get(keys),
      chrome.storage.sync.get({ koListsState: {} })
    ]).then(function (r) {
      var metas = r[0], state = r[1].koListsState || {};
      return {
        subs: subs.map(function (x) { return Object.assign({}, x, { meta: metas[metaKey(x.id)] || null }); }),
        state: state
      };
    });
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(function (details) {
  // First install: open settings so new users meet the controls, and seed the
  // lists in the background so the extension works on the first Amazon page.
  if (details.reason === "install") chrome.runtime.openOptionsPage();
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MIN });
  // Persist the default subscriptions so the content script and options page
  // read a real list (not just the in-code fallback), then seed the data.
  getSubs().then(saveSubs)
    .then(function () { return refreshLists(true); })
    .catch(function () { /* offline; retry on next alarm */ });
});

chrome.runtime.onStartup.addListener(function () {
  refreshLists(false).catch(function () {});
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === REFRESH_ALARM) refreshLists(false).catch(function () {});
});

// ── Messages ─────────────────────────────────────────────────────────────────

chrome.action.onClicked.addListener(function (tab) {
  chrome.tabs.sendMessage(tab.id, { type: "ko-toggle-panel" }, function () {
    if (chrome.runtime.lastError) chrome.runtime.openOptionsPage();
  });
});

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return;
  if (msg.type === "ko-open-options") { chrome.runtime.openOptionsPage(); return; }

  if (msg.type === "ko-lists-status") {
    listsStatus().then(sendResponse);
    return true; // async response
  }
  if (msg.type === "ko-refresh-lists") {
    refreshLists(true).then(function () { return listsStatus(); }).then(sendResponse)
      .catch(function (e) { sendResponse({ error: String(e && e.message || e) }); });
    return true;
  }
  if (msg.type === "ko-set-subs") {
    // Options page saved a new subscription list (toggled / added / removed).
    // Diff against the old subs to drop only removed lists' cached data (don't
    // load the whole 10MB store to enumerate keys). Then refresh: unchanged
    // enabled lists validate as 304, newly-enabled ones download.
    getSubs().then(function (oldSubs) {
      var newIds = {};
      msg.subs.forEach(function (x) { newIds[x.id] = 1; });
      var dropKeys = [];
      oldSubs.forEach(function (x) {
        if (!newIds[x.id]) dropKeys.push(dataKey(x.id), metaKey(x.id));
      });
      return saveSubs(msg.subs)
        .then(function () { return dropKeys.length ? chrome.storage.local.remove(dropKeys) : null; })
        .then(function () { return refreshLists(true); });
    }).then(function () { return listsStatus(); }).then(sendResponse)
      .catch(function (e) { sendResponse({ error: String(e && e.message || e) }); });
    return true;
  }
});
