// Knockoff options page. Textareas hold one brand per line; stored as
// arrays of display names in chrome.storage.sync (normalization happens in
// the detector at lookup time).

var FIELDS = ["enabled", "hideSponsored", "sellerCountry", "flagChineseMajor", "showKnownBadge", "filterUnrated"];

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
  sellerCountry: true,
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

var BRANDS_URL = "https://api.knockoff.co/brands";
var FLAGGED_URL = "https://api.knockoff.co/flagged";
var CONFIG_URL = "https://api.knockoff.co/config";
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
    fetch(FLAGGED_URL, { cache: "reload" }).then(function (r) { return r.ok ? r.text() : null; }),
    // Runtime config (selectors). Swallow its own errors so a config hiccup
    // can't fail the brand refresh; the content script validates it on apply.
    fetch(CONFIG_URL, { cache: "reload" }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
  ])
    .then(function (texts) {
      var brands = texts[0].split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      if (brands.length <= 1000) return Promise.reject("short list"); // sanity check, same as content.js
      chrome.storage.local.remove(["abfList", "abfFetchedAt"]); // pre-0.3 cache keys
      var patch = { communityBrands: brands, communityFetchedAt: Date.now() };
      if (texts[1] !== null) {
        patch.remoteFlagged = texts[1].split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      }
      if (texts[2]) { patch.koConfig = texts[2]; patch.koConfigAt = Date.now(); }
      return chrome.storage.local.set(patch);
    })
    .then(renderListStatus)
    .catch(function (err) {
      listStatus.textContent = err === "short list"
        ? "The server sent back an implausibly short list — kept the current one."
        : "Couldn't reach api.knockoff.co — try again in a minute.";
    })
    .finally(function () { refreshBtn.disabled = false; });
});

// ── Settings backup ─────────────────────────────────────────────────────────
// Export/import the sync area as a JSON file. Import validates every field:
// unknown keys and malformed values are dropped, never written.

function sanitizeSettings(s) {
  var out = {};
  if (!s || typeof s !== "object") return out;
  ["enabled", "hideSponsored", "sellerCountry", "flagChineseMajor", "showKnownBadge", "filterUnrated"].forEach(function (k) {
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
