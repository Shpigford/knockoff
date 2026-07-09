// ─────────────────────────────────────────────────────────────────────────────
// Knockoff userscript runtime (Userscripts for Safari / Tampermonkey).
//
// The extension sources (data/*, detector.js, pdp-brand.js, content.js) are
// bundled after this file UNMODIFIED by scripts/build-userscript.js. This
// prelude gives them what the extension platform normally provides:
//
//   - a `chrome` shim: storage.sync/local + onChanged over GM.getValue/
//     GM.setValue (per-key, so bumping a counter never rewrites the big
//     community list), runtime.getManifest/sendMessage/onMessage
//   - injected CSS (the extension's styles.css plus userscript-only chrome)
//   - a floating launcher button standing in for the toolbar button
//   - an in-page "Lists & settings" sheet standing in for the options page
//     (reached from the panel footer, which sends "ko-open-options")
//
// Known tradeoff vs the real extension: GM storage has no cross-tab change
// events, so a settings change applies to other open Amazon tabs on their
// next page load instead of instantly.
// ─────────────────────────────────────────────────────────────────────────────

var KO_US_VERSION = "__KO_VERSION__";

// ── chrome.* shim ────────────────────────────────────────────────────────────

var chrome = (function () {
  "use strict";

  var cache = { sync: {}, local: {} };
  var changedListeners = [];
  var messageListeners = [];

  // GM keys are "<area>.<key>", one value per key: small writes (settings,
  // lifetime counter) must not re-serialize the ~13k-entry community list.
  var ready = GM.listValues().then(function (names) {
    return Promise.all(names.map(function (name) {
      var dot = name.indexOf(".");
      var area = name.slice(0, dot);
      if (!cache[area]) return null;
      return GM.getValue(name).then(function (raw) {
        try { cache[area][name.slice(dot + 1)] = JSON.parse(raw); } catch (e) {}
      });
    }));
  });

  function fireChanged(changes, area) {
    changedListeners.forEach(function (fn) {
      try { fn(changes, area); } catch (e) {}
    });
  }

  function areaApi(area) {
    return {
      get: function (query) {
        return ready.then(function () {
          var out = {};
          if (Array.isArray(query)) {
            query.forEach(function (k) {
              if (k in cache[area]) out[k] = cache[area][k];
            });
          } else if (typeof query === "string") {
            if (query in cache[area]) out[query] = cache[area][query];
          } else if (query && typeof query === "object") {
            Object.keys(query).forEach(function (k) {
              out[k] = k in cache[area] ? cache[area][k] : query[k];
            });
          } else {
            Object.keys(cache[area]).forEach(function (k) { out[k] = cache[area][k]; });
          }
          return out;
        });
      },
      set: function (patch) {
        return ready.then(function () {
          var changes = {};
          var writes = [];
          Object.keys(patch).forEach(function (k) {
            var oldJson = JSON.stringify(cache[area][k]);
            var newJson = JSON.stringify(patch[k]);
            if (oldJson === newJson) return; // parity with chrome.storage.onChanged
            changes[k] = { oldValue: cache[area][k], newValue: patch[k] };
            cache[area][k] = patch[k];
            writes.push(GM.setValue(area + "." + k, newJson));
          });
          return Promise.all(writes).then(function () {
            if (Object.keys(changes).length) fireChanged(changes, area);
          });
        });
      },
      remove: function (keys) {
        return ready.then(function () {
          var list = Array.isArray(keys) ? keys : [keys];
          return Promise.all(list.map(function (k) {
            delete cache[area][k];
            return GM.deleteValue(area + "." + k);
          }));
        });
      }
    };
  }

  return {
    storage: {
      sync: areaApi("sync"),
      local: areaApi("local"),
      onChanged: {
        addListener: function (fn) { changedListeners.push(fn); }
      }
    },
    runtime: {
      getManifest: function () { return { version: KO_US_VERSION }; },
      onMessage: {
        addListener: function (fn) { messageListeners.push(fn); }
      },
      sendMessage: function (msg, cb) {
        if (msg && msg.type === "ko-open-options") { koOpenSheet(); return; }
        messageListeners.forEach(function (fn) {
          try { fn(msg, {}, cb || function () {}); } catch (e) {}
        });
      },
      openOptionsPage: function () { koOpenSheet(); }
    }
  };
})();

// Test hook: tests/userscript-smoke.js drives the storage shim from outside
// the bundle's IIFE. The flag is never set in a real page.
if (typeof __KO_TEST__ !== "undefined" && __KO_TEST__) globalThis.chrome = chrome;

// ── Injected styles: the extension stylesheet + userscript-only chrome ──────

(function () {
  "use strict";
  var css = __KO_CSS__;
  css += "\n" +
    "#ko-launcher{position:fixed;bottom:18px;right:18px;z-index:2147483645;" +
    "display:flex;align-items:center;justify-content:center;width:34px;height:34px;" +
    "padding:0;border:1px solid rgba(17,17,17,.12);border-radius:50%;background:#fff;" +
    "box-shadow:0 4px 12px rgba(0,0,0,.18);cursor:pointer;}" +
    "#ko-launcher:hover{background:#fafafa;}" +
    "#ko-launcher svg{display:block;width:20px;height:20px;border-radius:5px;}" +
    "#ko-pill{right:62px;}" + // make room for the launcher
    "#ko-sheet{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;" +
    "justify-content:center;background:rgba(24,24,27,.4);" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}" +
    ".ko-sheet-card{width:390px;max-width:calc(100vw - 32px);max-height:calc(100vh - 64px);" +
    "overflow:auto;padding:16px;border-radius:14px;background:#fff;color:#18181b;" +
    "border:1px solid rgba(17,17,17,.1);box-shadow:0 10px 38px -10px rgba(22,23,24,.35);}" +
    ".ko-sheet-title{font-size:14px;font-weight:600;margin-bottom:10px;}" +
    ".ko-sheet-row{display:flex;gap:8px;align-items:center;margin:7px 0;font-size:12.5px;cursor:pointer;}" +
    ".ko-sheet-label{margin:12px 0 4px;font-size:11px;font-weight:500;color:#71717a;}" +
    "#ko-sheet textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid #e4e4e7;" +
    "border-radius:8px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical;}" +
    ".ko-sheet-refresh{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;}" +
    ".ko-sheet-status{font-size:11px;color:#71717a;}" +
    ".ko-sheet-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;}" +
    ".ko-sheet-btn{padding:6px 14px;border:1px solid #e4e4e7;border-radius:8px;background:#fff;" +
    "font-size:12.5px;color:#18181b;cursor:pointer;}" +
    ".ko-sheet-btn:hover{background:#f4f4f5;}" +
    ".ko-sheet-btn.ko-primary{background:#18181b;border-color:#18181b;color:#fff;}" +
    ".ko-sheet-btn.ko-primary:hover{background:#27272a;}";
  var style = document.createElement("style");
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
})();

// ── Launcher button (stands in for the toolbar button) ──────────────────────

var KO_LAUNCHER_LOGO =
  '<svg viewBox="0 0 128 128" aria-hidden="true"><rect width="128" height="128" rx="30" fill="#171717"/>' +
  '<g transform="translate(64 66) scale(4.1) translate(-12 -12)">' +
  '<path d="M12.9 2.6 21.4 11.1a2 2 0 0 1 0 2.83l-7.47 7.47a2 2 0 0 1-2.83 0L2.6 12.9A2 2 0 0 1 2 11.49V4a2 2 0 0 1 2-2h7.49a2 2 0 0 1 1.41.6Z" fill="#fff"/>' +
  '<circle cx="6.9" cy="6.9" r="1.55" fill="#171717"/>' +
  '<path d="M4.6 21 21 4.6" stroke="#dc2626" stroke-width="2.4" stroke-linecap="round" fill="none"/></g></svg>';

(function () {
  "use strict";
  var btn = document.createElement("button");
  btn.id = "ko-launcher";
  btn.type = "button";
  btn.title = "Knockoff — filter settings";
  btn.innerHTML = KO_LAUNCHER_LOGO; // static markup only
  btn.addEventListener("click", function () {
    // content.js registers the panel toggle on runtime.onMessage; the
    // background worker isn't bundled, so the launcher plays its part.
    chrome.runtime.sendMessage({ type: "ko-toggle-panel" });
  });
  document.body.appendChild(btn);
})();

// ── Lists & settings sheet (stands in for the options page) ─────────────────

function koOpenSheet() {
  "use strict";
  if (document.getElementById("ko-sheet")) return;

  // Same normalization as Knockoff.normalize / the options page.
  function parseBrandLines(text) {
    var seen = new Set();
    var out = [];
    text.split("\n").forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var key = line.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "")
        .replace(/[^a-z0-9]/g, "");
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(line);
    });
    return out;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  var wrap = el("div", "");
  wrap.id = "ko-sheet";
  var card = el("div", "ko-sheet-card");
  wrap.appendChild(card);
  card.appendChild(el("div", "ko-sheet-title", "Knockoff — Lists & settings"));

  var toggles = {};
  [
    ["flagChineseMajor", "Also flag established Chinese brands (Anker, DJI…)"],
    ["showKnownBadge", "Show a ✓ badge on recognized brands too"]
  ].forEach(function (f) {
    var row = el("label", "ko-sheet-row");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    row.appendChild(cb);
    row.appendChild(el("span", "", f[1]));
    card.appendChild(row);
    toggles[f[0]] = cb;
  });

  function listBox(labelText, placeholder) {
    card.appendChild(el("div", "ko-sheet-label", labelText));
    var ta = document.createElement("textarea");
    ta.rows = 5;
    ta.spellcheck = false;
    ta.placeholder = placeholder;
    card.appendChild(ta);
    return ta;
  }
  var allowTa = listBox("Always trust — one brand per line", "Anker\nSome small maker I like");
  var blockTa = listBox("Always block", "AmazonBasics");

  // Community list refresh, mirroring the options page (same endpoints,
  // same >1000 sanity check, keep cached flags on a /flagged error).
  var refreshRow = el("div", "ko-sheet-refresh");
  var status = el("span", "ko-sheet-status");
  var refreshBtn = el("button", "ko-sheet-btn", "Refresh brand list");
  refreshBtn.type = "button";
  refreshRow.appendChild(status);
  refreshRow.appendChild(refreshBtn);
  card.appendChild(refreshRow);

  function renderStatus() {
    chrome.storage.local.get(["communityBrands", "communityFetchedAt"]).then(function (c) {
      status.textContent = c.communityFetchedAt && c.communityBrands
        ? c.communityBrands.length.toLocaleString() + " brands · updated " +
          new Date(c.communityFetchedAt).toLocaleDateString()
        : "Using the bundled brand list.";
    });
  }
  renderStatus();

  refreshBtn.addEventListener("click", function () {
    refreshBtn.disabled = true;
    status.textContent = "Refreshing…";
    Promise.all([
      fetch("https://api.knockoff.shopping/brands", { cache: "reload" })
        .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); }),
      fetch("https://api.knockoff.shopping/flagged", { cache: "reload" })
        .then(function (r) { return r.ok ? r.text() : null; })
    ])
      .then(function (texts) {
        var brands = texts[0].split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
        if (brands.length <= 1000) return Promise.reject("short list");
        var patch = { communityBrands: brands, communityFetchedAt: Date.now() };
        if (texts[1] !== null) {
          patch.remoteFlagged = texts[1].split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
        }
        return chrome.storage.local.set(patch);
      })
      .then(renderStatus)
      .catch(function () {
        status.textContent = "Couldn't refresh — try again in a minute.";
      })
      .finally(function () { refreshBtn.disabled = false; });
  });

  // Settings backup. This matters more here than in the extension: GM
  // storage never syncs, so the user's lists live in exactly one browser.
  // Same validation shape as options/options.js sanitizeSettings — keep in sync.
  function sanitizeSettings(s) {
    var out = {};
    if (!s || typeof s !== "object") return out;
    ["enabled", "hideSponsored", "flagChineseMajor", "showKnownBadge"].forEach(function (k) {
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
    return out;
  }

  var backupRow = el("div", "ko-sheet-refresh");
  var backupStatus = el("span", "ko-sheet-status", "Backup your settings & lists");
  var backupBtns = el("span", "");
  var exportBtn = el("button", "ko-sheet-btn", "Export…");
  exportBtn.type = "button";
  var importBtn = el("button", "ko-sheet-btn", "Import…");
  importBtn.type = "button";
  importBtn.style.marginLeft = "6px";
  var importFile = document.createElement("input");
  importFile.type = "file";
  importFile.accept = ".json,application/json";
  importFile.hidden = true;
  backupBtns.appendChild(exportBtn);
  backupBtns.appendChild(importBtn);
  backupBtns.appendChild(importFile);
  backupRow.appendChild(backupStatus);
  backupRow.appendChild(backupBtns);
  card.appendChild(backupRow);

  exportBtn.addEventListener("click", function () {
    chrome.storage.sync.get({
      enabled: true, action: "dim", level: "standard", hideSponsored: false,
      flagChineseMajor: false, showKnownBadge: false, allow: [], block: []
    }).then(function (s) {
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

  importBtn.addEventListener("click", function () { importFile.click(); });
  importFile.addEventListener("change", function () {
    var file = importFile.files && importFile.files[0];
    importFile.value = "";
    if (!file) return;
    file.text()
      .then(function (text) {
        var patch = sanitizeSettings(JSON.parse(text).settings);
        if (!Object.keys(patch).length) return Promise.reject("empty");
        return chrome.storage.sync.set(patch); // onChanged → live rescan
      })
      .then(close)
      .catch(function () {
        backupStatus.textContent = "That file doesn't look like a settings export.";
      });
  });

  var actions = el("div", "ko-sheet-actions");
  var cancel = el("button", "ko-sheet-btn", "Cancel");
  cancel.type = "button";
  var save = el("button", "ko-sheet-btn ko-primary", "Save");
  save.type = "button";
  actions.appendChild(cancel);
  actions.appendChild(save);
  card.appendChild(actions);

  function close() {
    wrap.remove();
    document.removeEventListener("keydown", onKey, true);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  cancel.addEventListener("click", close);
  wrap.addEventListener("mousedown", function (e) {
    if (e.target === wrap) close();
  });
  document.addEventListener("keydown", onKey, true);

  save.addEventListener("click", function () {
    var patch = {
      allow: parseBrandLines(allowTa.value),
      block: parseBrandLines(blockTa.value),
      flagChineseMajor: toggles.flagChineseMajor.checked,
      showKnownBadge: toggles.showKnownBadge.checked
    };
    // content.js hears this via the shim's onChanged and rescans live.
    chrome.storage.sync.set(patch).then(close);
  });

  chrome.storage.sync
    .get({ flagChineseMajor: false, showKnownBadge: false, allow: [], block: [] })
    .then(function (s) {
      toggles.flagChineseMajor.checked = s.flagChineseMajor;
      toggles.showKnownBadge.checked = s.showKnownBadge;
      allowTa.value = s.allow.join("\n");
      blockTa.value = s.block.join("\n");
    });

  document.body.appendChild(wrap);
}
