// Knockoff options page. Textareas hold one brand per line; stored as
// arrays of display names in chrome.storage.sync (normalization happens in
// the detector at lookup time).

var FIELDS = ["enabled", "hideSponsored", "flagChineseMajor", "showKnownBadge"];
var SEGS = ["action", "level"];
var save = document.getElementById("save");

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

chrome.storage.sync
  .get({
    enabled: true,
    action: "dim",
    level: "standard",
    hideSponsored: false,
    flagChineseMajor: false,
    showKnownBadge: false,
    allow: [],
    block: []
  })
  .then(function (s) {
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
      var key = line.toLowerCase().replace(/[^a-z0-9]/g, "");
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
    fetch(FLAGGED_URL, { cache: "reload" }).then(function (r) { return r.ok ? r.text() : ""; })
  ])
    .then(function (texts) {
      var brands = texts[0].split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      var flagged = texts[1].split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      if (brands.length <= 1000) return Promise.reject("short list"); // sanity check, same as content.js
      chrome.storage.local.remove(["abfList", "abfFetchedAt"]); // pre-0.3 cache keys
      return chrome.storage.local.set({
        communityBrands: brands,
        remoteFlagged: flagged,
        communityFetchedAt: Date.now()
      });
    })
    .then(renderListStatus)
    .catch(function () {
      listStatus.textContent = "Couldn't reach api.knockoff.shopping — try again in a minute.";
    })
    .finally(function () { refreshBtn.disabled = false; });
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
  chrome.storage.sync.set(patch).then(function () {
    var saved = document.getElementById("saved");
    saved.hidden = false;
    setTimeout(function () { saved.hidden = true; }, 1500);
  });
});
