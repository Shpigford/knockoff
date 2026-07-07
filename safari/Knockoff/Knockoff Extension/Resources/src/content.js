// ─────────────────────────────────────────────────────────────────────────────
// Knockoff content script (all DOM work lives here; logic is in detector.js)
//
// Runs on Amazon pages. Finds product tiles, asks the detector for a verdict
// on each, then hides / dims / labels them per the user's settings. Also
// badges the brand byline on product detail pages.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  "use strict";

  // Community allowlist refresh: once a day, re-fetch the AmazonBrandFilterList
  // snapshot so new brands don't require an extension update. Served from our
  // own API (which proxies + edge-caches the upstream GitHub list) so the
  // extension has exactly one first-party network dependency.
  var ABF_URL = "https://api.knockoff.shopping/brands";
  var ABF_REFRESH_MS = 24 * 60 * 60 * 1000;

  // One-click misclassification reports (see report-worker/). Set this to your
  // deployed worker URL. Leave empty to fall back to opening a GitHub issue.
  var REPORT_ENDPOINT = "https://api.knockoff.shopping";
  var REPO_URL = "https://github.com/Shpigford/knockoff";

  var DEFAULTS = {
    enabled: true,
    action: "hide",           // hide | dim | label
    level: "standard",        // relaxed | standard | strict
    flagChineseMajor: false,  // also flag established Chinese brands
    showKnownBadge: false,    // show a ✓ badge on recognized brands too
    allow: [],                // user allowlist (display names)
    block: []                 // user blocklist (display names)
  };

  var settings = Object.assign({}, DEFAULTS);
  var userAllow = new Set();
  var userBlock = new Set();
  var stats = { scanned: 0, filtered: 0, byVerdict: {} };
  var revealed = false; // session-only "show hidden items" toggle

  // Lifetime tally shown in the popup. Deduped per ASIN per page load so
  // rescans (settings changes) don't double-count; drift across concurrent
  // tabs is fine; it's a running tally, not accounting.
  var countedKeys = new Set();
  var lifetimePending = 0;
  var lifetimeTimer = null;

  function bumpLifetime(key) {
    if (!key || countedKeys.has(key)) return;
    countedKeys.add(key);
    lifetimePending++;
    if (lifetimeTimer) return;
    lifetimeTimer = setTimeout(function () {
      var add = lifetimePending;
      lifetimePending = 0;
      lifetimeTimer = null;
      chrome.storage.local.get({ lifetimeFiltered: 0 }).then(function (s) {
        chrome.storage.local.set({ lifetimeFiltered: s.lifetimeFiltered + add });
      });
    }, 800);
  }

  // Product tiles across Amazon layouts. data-asin anchoring has survived
  // every redesign since ~2019. Add new layouts here (see CONTRIBUTING.md).
  var TILE_SELECTORS = [
    'div[data-component-type="s-search-result"]', // search results
    'div.octopus-pc-item[data-asin]',             // category "octopus" pages
    'li[class*="ProductGridItem"][data-asin]'     // some browse grids
  ].join(",");

  // Engraved-line SVG glyphs (24 viewBox, 2px round stroke). Static strings
  // authored here; never interpolate page content into these.
  var S = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var ICONS = {
    tag:      S + '<path d="M12.9 2.6 21.4 11.1a2 2 0 0 1 0 2.83l-7.47 7.47a2 2 0 0 1-2.83 0L2.6 12.9A2 2 0 0 1 2 11.49V4a2 2 0 0 1 2-2h7.49a2 2 0 0 1 1.41.6Z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/></svg>',
    tagSlash: S + '<path d="M12.9 2.6 21.4 11.1a2 2 0 0 1 0 2.83l-7.47 7.47a2 2 0 0 1-2.83 0L2.6 12.9A2 2 0 0 1 2 11.49V4a2 2 0 0 1 2-2h7.49a2 2 0 0 1 1.41.6Z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/><path d="M4.2 21.5 21.5 4.2"/></svg>',
    alert:    S + '<path d="M13.73 4.4 21.6 18a2 2 0 0 1-1.73 3H4.13A2 2 0 0 1 2.4 18L10.27 4.4a2 2 0 0 1 3.46 0Z"/><path d="M12 9.4v4.2"/><circle cx="12" cy="17.2" r="1.1" fill="currentColor" stroke="none"/></svg>',
    dashed:   S + '<circle cx="12" cy="12" r="9" stroke-dasharray="3.9 3.9"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
    seal:     S + '<circle cx="12" cy="12" r="9"/><path d="m8.4 12.4 2.5 2.5 4.9-5.4"/></svg>',
    shield:   S + '<path d="M12 2.8 19 5.4v5.2c0 4.6-2.9 7.8-7 9.6-4.1-1.8-7-5-7-9.6V5.4Z"/><path d="m8.8 11.9 2.3 2.3 4.3-4.7"/></svg>',
    ban:      S + '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/></svg>',
    x:        S + '<path d="m6 6 12 12M18 6 6 18"/></svg>',
    flag:     S + '<path d="M5 21V4.5C7.7 3 10.3 3 13 4.5c2 1.1 4 1.3 6 .6V15c-2 .7-4 .5-6-.6-2.7-1.5-5.3-1.5-8 0"/></svg>'
  };

  var VERDICT_META = {
    blocked:   { icon: "tagSlash", label: "On your blocklist" },
    flagged:   { icon: "tagSlash", label: "Likely pseudo-brand" },
    suspect:   { icon: "alert",    label: "Suspect brand" },
    unbranded: { icon: "alert",    label: "Unbranded" },
    unknown:   { icon: "dashed",   label: "Unrecognized" },
    known:     { icon: "seal",     label: "Established" },
    allowed:   { icon: "seal",     label: "Trusted by you" }
  };

  // ── Storage ────────────────────────────────────────────────────────────────

  function loadSettings() {
    return chrome.storage.sync.get(DEFAULTS).then(function (stored) {
      settings = Object.assign({}, DEFAULTS, stored);
      userAllow = new Set(settings.allow.map(Knockoff.normalize));
      userBlock = new Set(settings.block.map(Knockoff.normalize));
    });
  }

  function parseLines(text) {
    return text.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function loadCommunityList() {
    return chrome.storage.local.get(["abfList", "remoteFlagged", "abfFetchedAt"]).then(function (c) {
      var stale = !c.abfFetchedAt || Date.now() - c.abfFetchedAt > ABF_REFRESH_MS;
      if (stale) {
        Promise.all([
          fetch(ABF_URL).then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); }),
          // curated blocklist additions; empty response is a valid state
          fetch(REPORT_ENDPOINT + "/flagged").then(function (r) { return r.ok ? r.text() : ""; })
        ])
          .then(function (texts) {
            var brands = parseLines(texts[0]);
            var flagged = parseLines(texts[1]);
            if (brands.length > 1000) { // sanity check before trusting the fetch
              chrome.storage.local.set({
                abfList: brands,
                remoteFlagged: flagged,
                abfFetchedAt: Date.now()
              });
              Knockoff.buildIndexes(brands, flagged);
              rescan();
            }
          })
          .catch(function () { /* offline or rate-limited; bundled snapshot still works */ });
      }
      return c;
    });
  }

  function saveUserLists() {
    chrome.storage.sync.set({ allow: settings.allow, block: settings.block });
  }

  // Add/remove a brand on a user list, dedped by normalized key.
  function setListMembership(list, brandName, member) {
    var key = Knockoff.normalize(brandName);
    var arr = settings[list].filter(function (b) { return Knockoff.normalize(b) !== key; });
    if (member) arr.push(brandName);
    settings[list] = arr;
    if (list === "allow") userAllow = new Set(arr.map(Knockoff.normalize));
    else userBlock = new Set(arr.map(Knockoff.normalize));
    saveUserLists();
  }

  // ── Tile processing ────────────────────────────────────────────────────────

  function tileTitle(tile) {
    // textContent, not aria-label: sponsored tiles prefix their aria-label
    // with "Sponsored Ad – ..." which would be read as the brand.
    var h2 = tile.querySelector("h2");
    var text = h2
      ? h2.textContent || h2.getAttribute("aria-label") || ""
      : (tile.querySelector("a.a-text-normal") || {}).textContent || "";
    return text.replace(/^Sponsored Ad [–-]\s*/i, "");
  }

  // Some layouts render the brand in its own row above the title. When that
  // row exists it is authoritative, so prepend it so extraction sees it first.
  function tileBrandRow(tile) {
    var el = tile.querySelector(
      '[data-cy="title-recipe"] .a-size-base-plus.a-color-base:not(a *), h2 + .a-row .a-size-base-plus'
    );
    var text = el && el.textContent ? el.textContent.trim() : "";
    return text && text.length <= 30 && !/\d{3,}/.test(text) ? text : "";
  }

  function processTile(tile) {
    if (tile.hasAttribute("data-ko-verdict")) return;
    var title = (tileBrandRow(tile) + " " + tileTitle(tile)).trim();
    if (!title) return;

    var result = Knockoff.classify(title, settings, userAllow, userBlock);
    var act = Knockoff.shouldAct(result.verdict, settings.level);

    tile.setAttribute("data-ko-verdict", result.verdict);
    if (result.brand) tile.setAttribute("data-ko-brand", result.brand);
    stats.scanned++;
    stats.byVerdict[result.verdict] = (stats.byVerdict[result.verdict] || 0) + 1;

    if (act) {
      stats.filtered++;
      bumpLifetime(tile.getAttribute("data-asin") || result.key || title.slice(0, 40));
      tile.classList.add("ko-act", "ko-" + settings.action);
      addBadge(tile, result);
    } else if (settings.showKnownBadge || result.verdict === "allowed") {
      if (result.verdict === "known" || result.verdict === "allowed") {
        addBadge(tile, result);
      }
    }
  }

  function addBadge(tile, result) {
    if (tile.querySelector(".ko-badge")) return;
    var meta = VERDICT_META[result.verdict];
    var badge = document.createElement("button");
    badge.className = "ko-badge ko-v-" + result.verdict;
    badge.type = "button";
    badge.innerHTML = ICONS[meta.icon]; // static markup; brand text goes in via textContent below
    var label = document.createElement("span");
    label.textContent = result.brand || "No brand";
    badge.appendChild(label);
    badge.title = "Knockoff: " + meta.label + " · " + result.reason + " (click for options)";
    badge.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu(badge, tile, result);
    });
    tile.style.position = "relative";
    tile.appendChild(badge);
  }

  // Badge click menu: verdict header, reason, actions, report footer.
  function toggleMenu(badge, tile, result) {
    var existing = tile.querySelector(".ko-menu");
    if (existing) { existing.remove(); return; }
    document.querySelectorAll(".ko-menu").forEach(function (m) { m.remove(); });

    var meta = VERDICT_META[result.verdict];
    var menu = el("div", "ko-menu");

    // Search tiles anchor the menu at the tile's top-right, under the chip.
    // On product pages the chip sits inline mid-page inside a full-width
    // container, so anchor to the chip itself instead.
    if (badge.classList.contains("ko-pdp-badge")) {
      var left = Math.max(0, Math.min(badge.offsetLeft, tile.clientWidth - 244));
      menu.style.left = left + "px";
      menu.style.right = "auto";
      menu.style.top = (badge.offsetTop + badge.offsetHeight + 6) + "px";
      menu.style.transformOrigin = "top left";
    }

    // Header: brand name with the verdict (dot + label) right-aligned
    var head = el("div", "ko-menu-head");
    var brandRow = el("div", "ko-menu-brand");
    var name = document.createElement("span");
    name.textContent = result.brand || "This listing";
    var verdictEl = el("span", "ko-menu-verdict ko-v-" + result.verdict);
    verdictEl.textContent = meta.label;
    brandRow.appendChild(name);
    brandRow.appendChild(verdictEl);
    head.appendChild(brandRow);
    menu.appendChild(head);

    var reason = el("div", "ko-menu-reason");
    reason.textContent = sentence(result.reason);
    menu.appendChild(reason);
    menu.appendChild(el("div", "ko-menu-sep"));

    var group = el("div", "ko-menu-group");
    if (result.brand) {
      var allowed = userAllow.has(result.key);
      var blocked = userBlock.has(result.key);
      group.appendChild(menuButton("shield",
        allowed ? "Stop trusting this brand" : "Trust this brand",
        function () { setListMembership("allow", result.brand, !allowed);
                      if (!allowed) setListMembership("block", result.brand, false); }
      ));
      group.appendChild(menuButton("ban",
        blocked ? "Unblock this brand" : "Block this brand",
        function () { setListMembership("block", result.brand, !blocked);
                      if (!blocked) setListMembership("allow", result.brand, false); }
      ));
    }
    // Clears the flag on this one item for the session: un-dims/un-hides it
    // and removes the chip, without touching the brand's standing.
    group.appendChild(menuButton("x", "Dismiss for this item", function () {
      tile.classList.remove("ko-act", "ko-hide", "ko-dim", "ko-label");
      var chip = tile.querySelector(".ko-badge");
      if (chip) chip.remove();
      menu.remove();
    }));
    menu.appendChild(group);

    if (result.brand) {
      var filtered = Knockoff.shouldAct(result.verdict, settings.level);
      var suggestion = filtered ? "not_junk" : "is_junk";
      menu.appendChild(el("div", "ko-menu-sep"));
      var foot = el("div", "ko-menu-foot");
      var reportBtn = menuButton("flag",
        filtered ? "Report as a real brand" : "Report as junk",
        function () {
          sendReport(result, suggestion, tile.getAttribute("data-asin"));
          reportBtn.innerHTML = ICONS.seal;
          var thanks = el("span", "ko-menu-label");
          thanks.textContent = "Reported. Thank you";
          reportBtn.appendChild(thanks);
          reportBtn.disabled = true;
        });
      foot.appendChild(reportBtn);
      menu.appendChild(foot);
    }

    tile.appendChild(menu);
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    node.className = className;
    return node;
  }

  // First letter up, terminal period; detector reasons are fragments.
  function sentence(s) {
    if (!s) return "";
    s = s.charAt(0).toUpperCase() + s.slice(1);
    return /[.!?]$/.test(s) ? s : s + ".";
  }

  // Misclassification reports keep the shared lists honest. With a deployed
  // report-worker this is a fire-and-forget POST; without one it opens a
  // prefilled GitHub issue instead.
  function sendReport(result, suggestion, asin) {
    if (!REPORT_ENDPOINT) {
      var title = (suggestion === "is_junk" ? "Junk brand: " : "Real brand: ") + result.brand;
      var body = "Brand: " + result.brand +
        "\nCurrent verdict: " + result.verdict +
        (asin ? "\nExample ASIN: " + asin : "") +
        "\nMarketplace: " + location.hostname;
      window.open(REPO_URL + "/issues/new?title=" + encodeURIComponent(title) +
        "&body=" + encodeURIComponent(body), "_blank");
      return;
    }
    fetch(REPORT_ENDPOINT + "/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand: result.brand,
        suggestion: suggestion,
        verdict: result.verdict,
        asin: asin || null,
        marketplace: location.hostname,
        extVersion: chrome.runtime.getManifest().version
      })
    }).catch(function () { /* fire-and-forget */ });
  }

  function menuButton(icon, text, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ko-menu-btn";
    b.innerHTML = ICONS[icon]; // static markup only; label goes in as text
    var labelWrap = el("span", "ko-menu-label");
    labelWrap.textContent = text;
    b.appendChild(labelWrap);
    b.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  // ── Filtered-count pill ────────────────────────────────────────────────────
  // Floating pill so hidden results are never silently gone.

  function updatePill() {
    var pill = document.getElementById("ko-pill");
    if (!settings.enabled || settings.action !== "hide" || stats.filtered === 0) {
      if (pill) pill.remove();
      return;
    }
    if (!pill) {
      pill = document.createElement("button");
      pill.id = "ko-pill";
      pill.type = "button";
      pill.title = "Filtered by Knockoff";
      pill.addEventListener("click", function () {
        revealed = !revealed;
        document.documentElement.classList.toggle("ko-revealed", revealed);
        updatePill();
      });
      document.body.appendChild(pill);
    }
    // Only rewrite on change; our own MutationObserver watches the whole
    // body, and an unconditional write would re-trigger it forever.
    var state = stats.filtered + ":" + revealed;
    if (pill.getAttribute("data-ko-state") === state) return;
    var grew = stats.filtered > parseInt(pill.getAttribute("data-ko-count") || "0", 10);
    pill.setAttribute("data-ko-state", state);
    pill.setAttribute("data-ko-count", stats.filtered);
    pill.innerHTML = ICONS.tagSlash; // static markup; counts added as text nodes
    var count = document.createElement("b");
    if (grew) count.className = "ko-tick"; // spring the number when it climbs
    count.textContent = stats.filtered;
    pill.appendChild(count);
    pill.appendChild(document.createTextNode(" filtered"));
    var action = document.createElement("i");
    action.textContent = revealed ? "· Re-hide" : "· Show";
    pill.appendChild(action);
  }

  // ── Product detail page byline ─────────────────────────────────────────────

  function processProductPage() {
    var byline = document.getElementById("bylineInfo");
    if (!byline || document.querySelector(".ko-pdp-badge")) return;
    // "Brand: LATTOOK" or "Visit the LATTOOK Store"
    var m = (byline.textContent || "").match(/^(?:Brand:\s*|Visit the\s+)(.+?)(?:\s+Store)?$/);
    if (!m) return;
    var brandName = m[1].trim();
    var result = Knockoff.classify(brandName, settings, userAllow, userBlock);
    // On the product page, always label, never hide the page out from under
    // the user, and include known/unknown verdicts for context.
    var meta = VERDICT_META[result.verdict];
    var badge = document.createElement("button");
    badge.type = "button";
    badge.className = "ko-badge ko-pdp-badge ko-v-" + result.verdict;
    badge.innerHTML = ICONS[meta.icon]; // static markup; label added as text node
    var pdpLabel = document.createElement("span");
    pdpLabel.textContent = meta.label;
    badge.appendChild(pdpLabel);
    badge.title = "Knockoff: " + result.reason + " (click for options)";
    badge.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu(badge, byline.parentElement, result);
    });
    byline.parentElement.style.position = "relative";
    byline.insertAdjacentElement("afterend", badge);
  }

  // ── Control panel ──────────────────────────────────────────────────────────
  // Toggled by the toolbar button (via the background worker). Lives in the
  // page, next to the results it changes, so settings apply live as you flip
  // them, and the counts tick in place while you scroll.

  var PANEL_LOGO = '<svg viewBox="0 0 128 128" aria-hidden="true"><rect width="128" height="128" rx="30" fill="#171717"/><g transform="translate(64 66) scale(4.1) translate(-12 -12)"><path d="M12.9 2.6 21.4 11.1a2 2 0 0 1 0 2.83l-7.47 7.47a2 2 0 0 1-2.83 0L2.6 12.9A2 2 0 0 1 2 11.49V4a2 2 0 0 1 2-2h7.49a2 2 0 0 1 1.41.6Z" fill="#fff"/><circle cx="6.9" cy="6.9" r="1.55" fill="#171717"/><path d="M4.6 21 21 4.6" stroke="#dc2626" stroke-width="2.4" stroke-linecap="round" fill="none"/></g></svg>';

  var LEVEL_HINTS = {
    relaxed: "Only notorious pseudo-brands and your blocklist.",
    standard: "Also filters suspect-looking names and unbranded listings.",
    strict: "Allowlist-only: anything unrecognized is filtered."
  };

  function togglePanel() {
    if (document.getElementById("ko-panel")) closePanel();
    else buildPanel();
  }

  function closePanel() {
    var p = document.getElementById("ko-panel");
    if (p) p.remove();
    document.removeEventListener("mousedown", panelOutsideClick, true);
    document.removeEventListener("keydown", panelEscape, true);
  }

  function panelOutsideClick(e) {
    var p = document.getElementById("ko-panel");
    if (p && !p.contains(e.target)) closePanel();
  }

  function panelEscape(e) {
    if (e.key === "Escape") closePanel();
  }

  function segControl(key, options) {
    var track = el("div", "ko-seg");
    track.setAttribute("data-ko-seg", key);
    options.forEach(function (opt) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = opt.label;
      b.setAttribute("data-v", opt.value);
      b.addEventListener("click", function () {
        var patch = {};
        patch[key] = opt.value;
        chrome.storage.sync.set(patch); // onChanged re-applies + re-renders
      });
      track.appendChild(b);
    });
    return track;
  }

  function buildPanel() {
    var panel = el("div", "");
    panel.id = "ko-panel";

    // header: mark, name, master switch
    var head = el("div", "ko-panel-head");
    var brand = el("div", "ko-panel-brand");
    var logo = el("span", "ko-panel-logo");
    logo.innerHTML = PANEL_LOGO; // static markup
    var name = el("span", "ko-panel-name");
    name.textContent = "Knockoff";
    brand.appendChild(logo);
    brand.appendChild(name);
    var sw = el("label", "ko-switch");
    var swInput = document.createElement("input");
    swInput.type = "checkbox";
    swInput.id = "ko-panel-enabled";
    swInput.addEventListener("change", function () {
      chrome.storage.sync.set({ enabled: swInput.checked });
    });
    sw.appendChild(swInput);
    sw.appendChild(el("span", "ko-switch-slider"));
    head.appendChild(brand);
    head.appendChild(sw);
    panel.appendChild(head);

    // stat row
    var statsRow = el("div", "ko-panel-stats");
    var num = el("span", "ko-panel-num");
    num.id = "ko-panel-num";
    var copy = el("span", "ko-panel-statcopy");
    var over = el("span", "ko-panel-overline");
    over.textContent = "Filtered on this page";
    var sub = el("span", "ko-panel-sub");
    sub.id = "ko-panel-sub";
    copy.appendChild(over);
    copy.appendChild(sub);
    statsRow.appendChild(num);
    statsRow.appendChild(copy);
    panel.appendChild(statsRow);

    // controls
    var card = el("div", "ko-panel-card");
    var l1 = el("div", "ko-panel-label");
    l1.textContent = "Flagged items are";
    card.appendChild(l1);
    card.appendChild(segControl("action", [
      { value: "hide", label: "Hidden" },
      { value: "dim", label: "Dimmed" },
      { value: "label", label: "Labeled" }
    ]));
    card.appendChild(el("div", "ko-panel-rule"));
    var l2 = el("div", "ko-panel-label");
    l2.textContent = "Filter level";
    card.appendChild(l2);
    card.appendChild(segControl("level", [
      { value: "relaxed", label: "Relaxed" },
      { value: "standard", label: "Standard" },
      { value: "strict", label: "Strict" }
    ]));
    var hint = el("p", "ko-panel-hint");
    hint.id = "ko-panel-hint";
    card.appendChild(hint);
    panel.appendChild(card);

    // footer
    var foot = el("div", "ko-panel-foot");
    var optLink = document.createElement("button");
    optLink.type = "button";
    optLink.className = "ko-panel-link";
    optLink.textContent = "Brand lists & settings";
    optLink.addEventListener("click", function () {
      chrome.runtime.sendMessage({ type: "ko-open-options" });
    });
    var version = el("span", "ko-panel-version");
    version.textContent = "v" + chrome.runtime.getManifest().version;
    foot.appendChild(optLink);
    foot.appendChild(version);
    panel.appendChild(foot);

    document.body.appendChild(panel);
    document.addEventListener("mousedown", panelOutsideClick, true);
    document.addEventListener("keydown", panelEscape, true);
    updatePanelState();
  }

  // Refresh the panel's numbers and control states from current settings,
  // called after every scan so the count ticks live while scrolling.
  function updatePanelState() {
    var panel = document.getElementById("ko-panel");
    if (!panel) return;
    panel.classList.toggle("ko-panel-off", !settings.enabled);
    document.getElementById("ko-panel-enabled").checked = settings.enabled;
    document.getElementById("ko-panel-num").textContent = stats.filtered;
    document.getElementById("ko-panel-hint").textContent = LEVEL_HINTS[settings.level];
    panel.querySelectorAll("[data-ko-seg]").forEach(function (track) {
      var key = track.getAttribute("data-ko-seg");
      track.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("ko-seg-active", b.getAttribute("data-v") === settings[key]);
      });
    });
    chrome.storage.local.get({ lifetimeFiltered: 0 }).then(function (s) {
      var sub = document.getElementById("ko-panel-sub");
      if (sub) {
        sub.textContent = "of " + stats.scanned + " listings · " +
          s.lifetimeFiltered.toLocaleString() + " all-time";
      }
    });
  }

  // ── Scanning ───────────────────────────────────────────────────────────────

  function scan() {
    if (settings.enabled) {
      document.querySelectorAll(TILE_SELECTORS).forEach(processTile);
      processProductPage();
    }
    updatePill();
    updatePanelState();
  }

  // Wipe all Knockoff state from the page and re-apply from scratch.
  // Used when settings or lists change.
  function rescan() {
    stats = { scanned: 0, filtered: 0, byVerdict: {} };
    document.querySelectorAll("[data-ko-verdict]").forEach(function (tile) {
      tile.removeAttribute("data-ko-verdict");
      tile.removeAttribute("data-ko-brand");
      tile.classList.remove("ko-act", "ko-hide", "ko-dim", "ko-label");
    });
    document.querySelectorAll(".ko-badge, .ko-menu, #ko-pill").forEach(function (el) {
      el.remove();
    });
    scan();
  }

  var scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () { scanTimer = null; scan(); }, 150);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "sync") return;
    loadSettings().then(rescan);
  });

  // Toolbar button (relayed by the background worker) toggles the panel.
  // Respond explicitly; a silent listener closes the port with lastError
  // set, which the background reads as "no content script here".
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === "ko-toggle-panel") {
      togglePanel();
      sendResponse({ ok: true });
    }
  });

  loadSettings()
    .then(loadCommunityList)
    .then(function (cached) {
      Knockoff.buildIndexes(cached.abfList || null, cached.remoteFlagged || null);
      scan();
      new MutationObserver(scheduleScan).observe(document.body, {
        childList: true,
        subtree: true
      });
    });
})();
