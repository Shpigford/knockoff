// Knockoff options page. Textareas hold one brand per line; stored as
// arrays of display names in chrome.storage.sync (normalization happens in
// the detector at lookup time).

var FIELDS = ["enabled", "hideSponsored", "flagChineseMajor", "showKnownBadge", "filterUnrated"];
var SEGS = ["action", "level"];
var save = document.getElementById("save");
var minRatingSelect = document.getElementById("minRating");

// Review count is a non-negative integer, strip other characters
var minReviewsInput = document.getElementById("minReviews");
minReviewsInput.addEventListener("input", function () {
  var cleaned = minReviewsInput.value.replace(/\D/g, "");
  if (cleaned !== minReviewsInput.value) minReviewsInput.value = cleaned;
});

// Same copy as LEVEL_HINTS in content.js (separate scopes, keep in sync).
var LEVEL_HINTS = {
  relaxed: "Only notorious pseudo-brands and your blocklist.",
  standard: "Also filters suspect-looking names and unbranded listings.",
  strict: "Allowlist-only: anything unrecognized is filtered."
};

function segValue(name) {
  var checked = document.querySelector('input[name="' + name + '"]:checked');
  return checked ? checked.value : null;
}

function updateLevelHint() {
  document.getElementById("levelHint").textContent = LEVEL_HINTS[segValue("level")] || "";
}

// Defaults for the sync area, shared by the initial load and the backup export.
var SYNC_DEFAULTS = {
  enabled: true,
  action: "dim",
  level: "standard",
  hideSponsored: false,
  flagChineseMajor: false,
  showKnownBadge: false,
  allow: [],
  block: [],
  minRating: 0,
  minReviews: 0,
  filterUnrated: false
};

// Reflect a stored settings object into every control. Used on load and after
// a successful import.
function fillForm(s) {
  FIELDS.forEach(function (f) {
    document.getElementById(f).checked = s[f];
  });
  SEGS.forEach(function (name) {
    var input = document.querySelector('input[name="' + name + '"][value="' + s[name] + '"]');
    if (input) input.checked = true;
  });
  updateLevelHint();
  document.getElementById("allow").value = s.allow.join("\n");
  document.getElementById("block").value = s.block.join("\n");
  minRatingSelect.value = String(s.minRating);
  minReviewsInput.value = s.minReviews;
}

chrome.storage.sync.get(SYNC_DEFAULTS).then(function (s) {
  fillForm(s);
  save.disabled = false;
});

document.querySelectorAll('input[name="level"]').forEach(function (input) {
  input.addEventListener("change", updateLevelHint);
});

function parseList(id) {
  var seen = new Set();
  return document.getElementById(id).value
    .split("\n")
    .map(function (line) { return line.trim(); })
    .filter(function (line) {
      if (!line) return false;
      // Same normalization as Knockoff.normalize (detector.js): fold
      // diacritics first so "Müller" and "Muller" dedupe onto one key.
      var key = line.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "")
        .replace(/[^a-z0-9]/g, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// ── Community brand list ───────────────────────────────────────────────────
// Mirrors the daily refresh in content.js loadCommunityList (separate scopes,
// keep in sync). The button exists so a curation fix can be pulled on demand
// instead of waiting out the 24-hour cycle; content scripts pick the new list
// up via storage.onChanged.

var BRANDS_URL = "https://api.knockoff.shopping/brands";
var FLAGGED_URL = "https://api.knockoff.shopping/flagged";
var refreshBtn = document.getElementById("refreshList");
var listStatus = document.getElementById("listStatus");

function renderListStatus() {
  chrome.storage.local.get(["communityBrands", "communityFetchedAt"]).then(function (c) {
    listStatus.textContent = c.communityFetchedAt
      ? c.communityBrands.length.toLocaleString() + " brands · updated " +
        new Date(c.communityFetchedAt).toLocaleString()
      : "Using the bundled brand list.";
  });
}
renderListStatus();

refreshBtn.addEventListener("click", function () {
  refreshBtn.disabled = true;
  listStatus.textContent = "Refreshing…";
  Promise.all([
    // "reload" skips the browser's HTTP cache; a force-refresh that serves
    // yesterday's cached response would defeat the point of the button.
    fetch(BRANDS_URL, { cache: "reload" }).then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); }),
    // An empty *successful* response is valid; on an error keep the cached
    // copy (omit the key from the patch) rather than overwrite it with nothing.
    fetch(FLAGGED_URL, { cache: "reload" }).then(function (r) { return r.ok ? r.text() : null; })
  ])
    .then(function (texts) {
      var brands = texts[0].split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      if (brands.length <= 1000) return Promise.reject("short list"); // sanity check, same as content.js
      chrome.storage.local.remove(["abfList", "abfFetchedAt"]); // pre-0.3 cache keys
      var patch = { communityBrands: brands, communityFetchedAt: Date.now() };
      if (texts[1] !== null) {
        patch.remoteFlagged = texts[1].split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      }
      return chrome.storage.local.set(patch);
    })
    .then(renderListStatus)
    .catch(function (err) {
      listStatus.textContent = err === "short list"
        ? "The server sent back an implausibly short list — kept the current one."
        : "Couldn't reach api.knockoff.shopping — try again in a minute.";
    })
    .finally(function () { refreshBtn.disabled = false; });
});

// ── Settings backup ─────────────────────────────────────────────────────────
// Export/import the sync area as a JSON file. Import validates every field:
// unknown keys and malformed values are dropped, never written.

function sanitizeSettings(s) {
  var out = {};
  if (!s || typeof s !== "object") return out;
  ["enabled", "hideSponsored", "flagChineseMajor", "showKnownBadge", "filterUnrated"].forEach(function (k) {
    if (typeof s[k] === "boolean") out[k] = s[k];
  });
  if (["hide", "dim", "label"].indexOf(s.action) >= 0) out.action = s.action;
  if (["relaxed", "standard", "strict"].indexOf(s.level) >= 0) out.level = s.level;
  ["allow", "block"].forEach(function (k) {
    if (Array.isArray(s[k])) {
      out[k] = s[k].filter(function (b) { return typeof b === "string" && b.trim(); })
        .map(function (b) { return b.trim(); }).slice(0, 5000);
    }
  });
  // Rating filter numerics: the UI produces 0 (off) or 3–5 for minRating and a
  // non-negative integer for minReviews; anything else is malformed, drop it.
  if (typeof s.minRating === "number" && (s.minRating === 0 || (s.minRating >= 3 && s.minRating <= 5))) {
    out.minRating = s.minRating;
  }
  if (typeof s.minReviews === "number" && Number.isInteger(s.minReviews) && s.minReviews >= 0) {
    out.minReviews = s.minReviews;
  }
  return out;
}

var backupStatus = document.getElementById("backupStatus");
var importFile = document.getElementById("importFile");

document.getElementById("exportSettings").addEventListener("click", function () {
  chrome.storage.sync.get(SYNC_DEFAULTS).then(function (s) {
    var payload = {
      app: "knockoff",
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      settings: s
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "knockoff-settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
});

document.getElementById("importSettings").addEventListener("click", function () {
  importFile.click();
});

importFile.addEventListener("change", function () {
  var file = importFile.files && importFile.files[0];
  importFile.value = ""; // re-selecting the same file must fire change again
  if (!file) return;
  backupStatus.textContent = "";
  file.text()
    .then(function (text) {
      var patch = sanitizeSettings(JSON.parse(text).settings);
      if (!Object.keys(patch).length) return Promise.reject("empty");
      // Import replaces the current lists wholesale, so confirm before clobbering
      // brands the user may have spent real time curating.
      if (!window.confirm("Replace your current Knockoff settings and lists with this file?")) {
        return Promise.reject("cancel");
      }
      return chrome.storage.sync.set(patch)
        .then(function () { return chrome.storage.sync.get(SYNC_DEFAULTS); });
    })
    .then(function (s) {
      fillForm(s);
      backupStatus.textContent = "Settings imported.";
    })
    .catch(function (err) {
      if (err === "cancel") return;
      backupStatus.textContent = "That file doesn't look like a Knockoff settings export.";
    });
});

// ── Block list subscriptions (the uBlock-style filter lists) ────────────────
// The background worker owns fetching/caching; this pane just reads status and
// posts subscription changes. Each row is a list you can toggle or remove;
// custom lists can be added by URL (which requests host permission to fetch).

var dlList = document.getElementById("detectorLists");
var dlStatus = document.getElementById("dlStatus");
var dlMsg = document.getElementById("dlMsg");
var dlRefresh = document.getElementById("dlRefresh");
var dlAdd = document.getElementById("dlAdd");
var dlUrl = document.getElementById("dlUrl");
var currentSubs = [];

function dlCount(n) { return (n || 0).toLocaleString(); }
function dlDate(t) {
  return t ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}
function stripMeta(s) { var o = Object.assign({}, s); delete o.meta; return o; }

function renderLists(status) {
  if (!status) return;
  currentSubs = status.subs || [];
  dlList.textContent = "";
  currentSubs.forEach(function (sub) {
    var row = document.createElement("div");
    row.className = "dl-row";

    var copy = document.createElement("div");
    copy.className = "dl-copy";
    var name = document.createElement("span");
    name.className = "dl-name";
    name.textContent = sub.name;
    var desc = document.createElement("span");
    desc.className = "dl-sub";
    desc.textContent = sub.desc || sub.url || "";
    var meta = document.createElement("span");
    meta.className = "dl-meta";
    if (sub.meta && sub.meta.ok) {
      meta.textContent = dlCount(sub.meta.n) + " marks" +
        (sub.meta.fetchedAt ? " · updated " + dlDate(sub.meta.fetchedAt) : "");
    } else if (sub.meta && sub.meta.error) {
      meta.textContent = "Not loaded — " + sub.meta.error;
    } else {
      meta.textContent = sub.enabled ? "Downloading…" : "Not applied";
    }
    copy.appendChild(name);
    copy.appendChild(desc);
    copy.appendChild(meta);

    // One three-way rocker folds enable + level into a single control (see the
    // legend under the list): Off = not applied; Soft = applied but established
    // brands are exempt; Strict = applied even to established brands.
    var current = sub.enabled ? (sub.level || "soft") : "off";
    var seg = document.createElement("div");
    seg.className = "dl-mode";
    [["off", "Off"], ["soft", "Soft"], ["strict", "Strict"]].forEach(function (m) {
      var label = document.createElement("label");
      var input = document.createElement("input");
      input.type = "radio";
      input.name = "mode-" + sub.id;
      input.value = m[0];
      if (current === m[0]) input.checked = true;
      input.addEventListener("change", function () { setMode(sub.id, m[0]); });
      var span = document.createElement("span");
      span.textContent = m[1];
      label.appendChild(input);
      label.appendChild(span);
      seg.appendChild(label);
    });

    row.appendChild(copy);
    row.appendChild(seg);
    if (!sub.builtin) {
      var rm = document.createElement("button");
      rm.className = "dl-remove";
      rm.title = "Remove list";
      rm.textContent = "×";
      rm.addEventListener("click", function () { removeSub(sub.id); });
      row.appendChild(rm);
    }
    dlList.appendChild(row);
  });

  var st = status.state || {};
  dlStatus.textContent = st.checkedAt
    ? "Checked " + new Date(st.checkedAt).toLocaleString()
    : "Not checked yet";
}

function loadLists() {
  chrome.runtime.sendMessage({ type: "ko-lists-status" }, renderLists);
}
loadLists();

// Post a new subscription set to the background (which persists, drops removed
// lists' cached data, and refreshes) and re-render from its reply.
function pushSubs(subs, working) {
  dlMsg.textContent = working || "Saving…";
  chrome.runtime.sendMessage({ type: "ko-set-subs", subs: subs }, function (status) {
    if (status && status.error) { dlMsg.textContent = "Error: " + status.error; loadLists(); }
    else { dlMsg.textContent = ""; renderLists(status); }
  });
}

// One rocker sets both enabled and level: "off" disables; "soft"/"strict"
// enable and set the level (keeping the last level when toggled back off/on).
function setMode(id, mode) {
  var subs = currentSubs.map(function (s) {
    var o = stripMeta(s);
    if (s.id !== id) return o;
    if (mode === "off") { o.enabled = false; }
    else { o.enabled = true; o.level = mode; }
    return o;
  });
  pushSubs(subs, mode === "off" ? "Disabling…" : "Saving…");
}

function removeSub(id) {
  var subs = currentSubs.filter(function (s) { return s.id !== id; }).map(stripMeta);
  pushSubs(subs, "Removing…");
}

dlRefresh.addEventListener("click", function () {
  dlRefresh.disabled = true;
  dlStatus.textContent = "Refreshing…";
  dlMsg.textContent = "";
  chrome.runtime.sendMessage({ type: "ko-refresh-lists" }, function (status) {
    dlRefresh.disabled = false;
    if (status && status.error) dlMsg.textContent = "Refresh failed: " + status.error;
    renderLists(status);
  });
});

dlAdd.addEventListener("click", function () {
  var url = (dlUrl.value || "").trim();
  var origin;
  try {
    if (!/^https:\/\//i.test(url)) throw 0;
    origin = new URL(url).origin + "/*";
  } catch (e) {
    dlMsg.textContent = "Enter an https:// URL to a plain-text list.";
    return;
  }
  var id = "custom:" + url;
  if (currentSubs.some(function (s) { return s.id === id; })) {
    dlMsg.textContent = "That list is already added.";
    return;
  }
  // Custom lists live on arbitrary hosts, so ask for permission to fetch them
  // (declared as optional_host_permissions). Must run from this click gesture.
  chrome.permissions.request({ origins: [origin] }, function (granted) {
    if (!granted) { dlMsg.textContent = "Permission denied — can't fetch that host."; return; }
    var host;
    try { host = new URL(url).hostname; } catch (e) { host = url; }
    var subs = currentSubs.map(stripMeta).concat([{
      id: id, name: host, desc: url, url: url, builtin: false, enabled: true
    }]);
    dlUrl.value = "";
    pushSubs(subs, "Adding…");
  });
});

save.addEventListener("click", function () {
  var patch = {
    allow: parseList("allow"),
    block: parseList("block")
  };
  FIELDS.forEach(function (f) {
    patch[f] = document.getElementById(f).checked;
  });
  SEGS.forEach(function (name) {
    var v = segValue(name);
    if (v) patch[name] = v;
  });
  patch.minRating = parseFloat(minRatingSelect.value) || 0;
  patch.minReviews = parseInt(minReviewsInput.value, 10) || 0;
  chrome.storage.sync.set(patch).then(function () {
    var saved = document.getElementById("saved");
    saved.hidden = false;
    setTimeout(function () { saved.hidden = true; }, 1500);
  });
});
