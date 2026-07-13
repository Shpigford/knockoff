// ─────────────────────────────────────────────────────────────────────────────
// Knockoff content script (all DOM work lives here; logic is in detector.js)
//
// Runs on Amazon pages. Finds product tiles, asks the detector for a verdict
// on each, then hides / dims / labels them per the user's settings. Also
// badges the brand byline on product detail pages.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  "use strict";

  // Community allowlist refresh: once a day, re-fetch our curated brand list
  // so new brands don't require an extension update. Served from our own API,
  // so the extension has exactly one first-party network dependency.
  var BRANDS_URL = "https://api.knockoff.co/brands";
  var BRANDS_REFRESH_MS = 24 * 60 * 60 * 1000;

  // Runtime config (DOM selectors + parsing tunables) refreshed daily alongside
  // the brand list, so an Amazon layout fix ships as a config push, not a
  // release. Bundled default in data/config.js; the remote copy replaces it only
  // after mergeConfig validates it.
  var CONFIG_URL = "https://api.knockoff.co/config";
  var CONFIG = KO_DEFAULT_CONFIG;

  // One-click misclassification reports. Set this to your deployed endpoint.
  // Leave empty to fall back to opening a GitHub issue.
  var REPORT_ENDPOINT = "https://api.knockoff.co";
  var REPO_URL = "https://github.com/Shpigford/knockoff";

  var DEFAULTS = {
    enabled: true,
    action: "dim",            // hide | dim | label
    level: "standard",        // relaxed | standard | strict
    flagChineseMajor: false,  // also flag established Chinese brands
    showKnownBadge: false,    // show a ✓ badge on recognized brands too
    hideSponsored: false,     // hide Amazon "Sponsored" search tiles (opt-in)
    sellerCountry: true,      // flag listings with the seller's country (all
                              // browsers; Firefox manifest declares
                              // data_collection_permissions "websiteContent")
    allow: [],                // user allowlist (display names)
    block: [],                // user blocklist (display names)
    minRating: 0,             // rating filter: 0 = off, else 3.0–5.0
    minReviews: 0,            // review filter: 0 = off, else min review count
    filterUnrated: false      // also filter listings with no rating at all
  };

  var settings = Object.assign({}, DEFAULTS);
  var userAllow = new Set();
  var userBlock = new Set();
  var searchAllow = new Set(); // normalized tokens from the current search query
  var stats = { scanned: 0, filtered: 0, byVerdict: {} };
  var revealed = false; // session-only "show hidden items" toggle
  var introShown = true; // one-time first-catch toast; true until storage says otherwise

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

  // Tile / title / brand-row selectors live in CONFIG (data/config.js), so a
  // layout fix can ship as a config push. First element matching any selector
  // in a priority list, in order (longest-lived layout last); null if none.
  function firstMatch(root, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

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
    flag:     S + '<path d="M5 21V4.5C7.7 3 10.3 3 13 4.5c2 1.1 4 1.3 6 .6V15c-2 .7-4 .5-6-.6-2.7-1.5-5.3-1.5-8 0"/></svg>',
    star:     S + '<path d="M12 3.2l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 16.9l-5.2 2.73.99-5.8-4.21-4.1 5.82-.85z"/></svg>',
    share:    S + '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m8 6 4-4 4 4"/><path d="M12 2v13"/></svg>'
  };

  var VERDICT_META = {
    blocked:   { icon: "tagSlash", label: "On your blocklist" },
    flagged:   { icon: "tagSlash", label: "Likely pseudo-brand" },
    suspect:   { icon: "alert",    label: "Suspect brand" },
    unbranded: { icon: "alert",    label: "Unbranded" },
    unknown:   { icon: "dashed",   label: "Unrecognized" },
    known:     { icon: "seal",     label: "Established" },
    allowed:   { icon: "seal",     label: "Trusted by you" },
    lowrated:  { icon: "star",     label: "Low rating" }
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

  // Fold an untrusted remote config over the bundled defaults, key by key,
  // keeping each remote value only when it validates and the default otherwise.
  // Every selector is syntax-checked (a bad selector throws in querySelector)
  // and every list/number is bounded, so a malformed or hostile /config push
  // can only ever fall back to data/config.js — it can't break the page, and
  // nothing here is code: selectors are strings the shipped querySelector runs.
  function isSelector(s) {
    if (typeof s !== "string" || !s || s.length > 200) return false;
    try { document.querySelector(s); return true; } catch (e) { return false; }
  }
  function selectorList(v, fallback) {
    if (!Array.isArray(v) || !v.length || v.length > 20) return fallback;
    var out = v.filter(isSelector);
    return out.length ? out : fallback;
  }
  // Plain-string lists (labels, seller IDs): bounded in count and length,
  // and optionally shape-checked. Same fail-to-default posture as selectors.
  function stringList(v, fallback, re) {
    if (!Array.isArray(v) || !v.length || v.length > 40) return fallback;
    var out = v.filter(function (s) {
      return typeof s === "string" && s && s.length <= 60 && (!re || re.test(s));
    });
    return out.length ? out : fallback;
  }
  function mergeConfig(remote) {
    var d = KO_DEFAULT_CONFIG;
    if (!remote || typeof remote !== "object") return d;
    var rs = remote.selectors || {};
    var maxLen = (remote.limits || {}).brandRowMaxLen;
    return {
      selectors: {
        tiles: selectorList(rs.tiles, d.selectors.tiles),
        title: selectorList(rs.title, d.selectors.title),
        titleFallback: selectorList(rs.titleFallback, d.selectors.titleFallback),
        brandRow: selectorList(rs.brandRow, d.selectors.brandRow),
        mediaWork: isSelector(rs.mediaWork) ? rs.mediaWork : d.selectors.mediaWork,
        merchantId: selectorList(rs.merchantId, d.selectors.merchantId),
        sellerInfoRow: selectorList(rs.sellerInfoRow, d.selectors.sellerInfoRow),
        sellerAddressRow: selectorList(rs.sellerAddressRow, d.selectors.sellerAddressRow),
        sellerName: selectorList(rs.sellerName, d.selectors.sellerName),
        merchantChipAnchor: selectorList(rs.merchantChipAnchor, d.selectors.merchantChipAnchor)
      },
      limits: {
        brandRowMaxLen: (typeof maxLen === "number" && maxLen >= 5 && maxLen <= 200)
          ? maxLen : d.limits.brandRowMaxLen
      },
      sellerBizLabels: stringList(remote.sellerBizLabels, d.sellerBizLabels),
      amazonSellerIds: stringList(remote.amazonSellerIds, d.amazonSellerIds, /^A[0-9A-Z]{9,20}$/)
    };
  }

  function loadCommunityList() {
    return chrome.storage.local.get(
      ["communityBrands", "remoteFlagged", "communityFetchedAt", "koConfig", "koConfigAt"]
    ).then(function (c) {
      // Apply the cached remote config (if any) before the first scan.
      CONFIG = mergeConfig(c.koConfig);

      var stale = !c.communityFetchedAt || Date.now() - c.communityFetchedAt > BRANDS_REFRESH_MS;
      if (stale) {
        Promise.all([
          fetch(BRANDS_URL).then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); }),
          // curated blocklist additions; an empty *successful* response is a
          // valid state, but on an error keep the cached copy rather than
          // overwrite it with nothing until the next refresh.
          fetch(REPORT_ENDPOINT + "/flagged").then(function (r) { return r.ok ? r.text() : null; })
        ])
          .then(function (texts) {
            var brands = parseLines(texts[0]);
            var flagged = texts[1] === null ? (c.remoteFlagged || []) : parseLines(texts[1]);
            if (brands.length > 1000) { // sanity check before trusting the fetch
              chrome.storage.local.set({
                communityBrands: brands,
                remoteFlagged: flagged,
                communityFetchedAt: Date.now()
              });
              // pre-0.3 versions cached under these keys
              chrome.storage.local.remove(["abfList", "abfFetchedAt"]);
              Knockoff.buildIndexes(brands, flagged);
              rescan();
            }
          })
          .catch(function () { /* offline or rate-limited; bundled snapshot still works */ });
      }

      // Config refresh is independent of the brand list (its own clock), so a
      // bad/absent config never blocks a brand refresh or vice versa. Stored raw
      // and validated on apply, so an install always has the bundled fallback.
      var cfgStale = !c.koConfigAt || Date.now() - c.koConfigAt > BRANDS_REFRESH_MS;
      if (cfgStale) {
        fetch(CONFIG_URL).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
          .then(function (cfg) {
            chrome.storage.local.set({ koConfig: cfg, koConfigAt: Date.now() });
            CONFIG = mergeConfig(cfg);
            rescan();
          })
          .catch(function () { /* offline or bad config; bundled selectors hold */ });
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

  // Localized "Sponsored ... –" prefix Amazon puts on sponsored-tile aria-labels.
  var SPONSORED_PREFIX =
    /^(Sponsored|Gesponsert|Sponsoris|Sponsorizzat|Patrocinad|Gesponsord|Sponsrad|Sponsorowan|Sponsorlu|スポンサー)[^–-]*[–-]\s*/i;

  function tileTitle(tile) {
    // textContent, not aria-label: sponsored tiles prefix their aria-label
    // with a localized "Sponsored Ad – ..." which would be read as the brand.
    // The title is the line inside the product link (its <h2> carries
    // a-text-normal); the brand-byline layouts add a second, smaller <h2> for
    // the brand ahead of it, so CONFIG.selectors.title is ordered to skip it.
    var h2 = firstMatch(tile, CONFIG.selectors.title);
    var text = h2
      ? h2.textContent || h2.getAttribute("aria-label") || ""
      // p13n "faceout" tiles carry no h2: the title is a non-bold
      // .a-size-base-plus span (its bold siblings are the brand row and an
      // "In cart" status). The brand is embedded at the front of this title,
      // so classify() reads it from there like any other layout.
      : (firstMatch(tile, CONFIG.selectors.titleFallback) || {}).textContent || "";
    return text.replace(SPONSORED_PREFIX, "");
  }

  // Some layouts render the brand in its own row above the title. When that
  // row exists it is authoritative: Amazon has been stripping the brand out of
  // the title itself, so this is the only place the brand survives. Selectors
  // live in CONFIG so a layout change is a config push, not a release.
  function tileBrandRow(tile) {
    var el = tile.querySelector(CONFIG.selectors.brandRow.join(","));
    var text = el && el.textContent ? el.textContent.trim() : "";
    return text && text.length <= CONFIG.limits.brandRowMaxLen &&
      !/\d{3,}/.test(text) ? text : "";
  }

  // A book / music / movie tile carries Amazon's format-swatch links
  // (Paperback, Kindle Edition, Audiobook, Blu-ray, Prime Video, Audio CD...).
  // The label text is localized-ish, but the element's class pair is stable
  // across marketplaces, so we key off the element, not the word — physical
  // goods tiles never render it (verified 0/60 on a "screwdriver set" search).
  // This catches media works on an all-departments (search-alias=aps) search,
  // where the page-level department skip in scan() can't fire because there's
  // no book/music/movie alias to match. Skipping is the safe direction: a tile
  // we sit out is simply left unfiltered, never mislabeled.
  function tileIsMediaWork(tile) {
    return !!tile.querySelector(CONFIG.selectors.mediaWork);
  }

  // Get product rating. Prefer alt text as star icons increment by half stars
  function tileRating(tile) {
    var alt = tile.querySelector(".a-icon-alt");
    var fromAlt = alt ? Knockoff.parseRating(alt.textContent) : null;
    if (fromAlt !== null) return fromAlt;
    var star = tile.querySelector('i[class*="a-star-"]');
    var m = star && star.className.match(/a-star-(?:[a-z]+-)?(\d)(?:-(\d))?/);
    return m ? parseFloat(m[1] + (m[2] ? "." + m[2] : "")) : null;
  }

  // Get review count. Prefer the count link's aria-label / text (it carries the
  // exact number even when the visible text is abbreviated). querySelector on a
  // comma list returns the first match in DOM order, not the first selector, so
  // try the trustworthy link selectors first and only then the generic span —
  // and gate that span on count-shaped text so a stray number (price, rank,
  // "20% off") can't be misread as a review count.
  function tileReviews(tile) {
    var link = tile.querySelector(
      'a[href*="customerReviews"], a[aria-label$="ratings"], a[aria-label$="rating"]'
    );
    if (link) {
      var n = Knockoff.parseReviewCount(link.getAttribute("aria-label") || link.textContent || "");
      if (n !== null) return n;
    }
    var span = tile.querySelector("span.a-size-base.s-underline-text");
    var text = span ? span.textContent.trim() : "";
    if (/^\(?\s*[\d.,]+\s*[kKmM]?\+?\s*\)?$/.test(text)) return Knockoff.parseReviewCount(text);
    return null;
  }

  // Rating verdict for products that pass the brand pipeline.
  // Carries the brand so the badge menu's Trust/Block still act on it.
  function ratingResult(rating, reviews, failures, brandResult) {
    var bits = failures.map(function (f) {
      if (f === "unrated") return "no ratings yet";
      if (f === "rating") return "rated " + rating + ", below your " + settings.minRating + " minimum";
      return "only " + reviews + " review" + (reviews === 1 ? "" : "s") +
        ", below your " + settings.minReviews + " minimum";
    });
    return { verdict: "lowrated", brand: brandResult.brand, key: brandResult.key, reason: bits.join("; ") };
  }

  function processTile(tile) {
    if (tile.hasAttribute("data-ko-verdict")) return;
    // Books/music/movies on an all-departments search: the title is the work,
    // not a brand-led product name, so classification misfires ("The Canterbury
    // Tales" → unbranded). Mark it media and sit out, same as a media category.
    if (tileIsMediaWork(tile)) {
      tile.setAttribute("data-ko-verdict", "media");
      return;
    }
    // A dedicated brand byline is authoritative — classify it as the brand
    // directly, so a real brand whose name opens with an ordinary word
    // ("Pet Junkie") isn't misread as unbranded once Amazon strips it from the
    // title. No byline row: read the brand from the front of the title.
    var brandRow = tileBrandRow(tile);
    var title = tileTitle(tile);
    if (!brandRow && !title.trim()) return;

    var result = brandRow
      ? Knockoff.classifyBrand(brandRow, settings, userAllow, userBlock, title)
      : Knockoff.classify(title, settings, userAllow, userBlock);
    var brandAct = Knockoff.shouldAct(result.verdict, settings.level);

    // A tile whose extracted brand is exactly a word the shopper searched for
    // is probably the category noun they asked for. Spare heuristic-only
    // catches, but keep explicit user/seed blocklists enforced.
    if (brandAct && result.key && searchAllow.has(result.key) &&
        (result.verdict === "suspect" || result.verdict === "unknown")) {
      brandAct = false;
    }

    // The rating gate is independent of the brand verdict (spared tiles
    // included); only a user-allowlisted brand bypasses it.
    var rating = tileRating(tile);
    var reviews = tileReviews(tile);
    var ratingFails = result.verdict !== "allowed"
      ? Knockoff.ratingFailures(rating, reviews, settings)
      : [];
    var act = brandAct || ratingFails.length > 0;

    // Filtered for rating alone: badge as low-rated; otherwise keep the brand verdict.
    var displayResult = (act && !brandAct) ? ratingResult(rating, reviews, ratingFails, result) : result;

    tile.setAttribute("data-ko-verdict", displayResult.verdict);
    if (result.brand) tile.setAttribute("data-ko-brand", result.brand);
    stats.scanned++;
    stats.byVerdict[displayResult.verdict] = (stats.byVerdict[displayResult.verdict] || 0) + 1;

    if (act) {
      stats.filtered++;
      bumpLifetime(tile.getAttribute("data-asin") || result.key || title.slice(0, 40));
      tile.classList.add("ko-act", "ko-" + settings.action);
      addBadge(tile, displayResult);
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

    // Report footer: name the brand and set the shared lists straight. Built
    // (and gated) by reportFoot — it also covers a filtered tile we read no
    // brand from, so a real brand we missed can still be named.
    var foot = reportFoot(tile, result);
    if (foot) {
      menu.appendChild(el("div", "ko-menu-sep"));
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

  // Misclassification reports keep the shared lists honest. `brand` is the name
  // the shopper confirmed — edited when we truncated ("Geometric" → "Geometric
  // Future") or missed it. With a report endpoint configured this is a
  // fire-and-forget POST; without one it opens a prefilled GitHub issue instead.
  function sendReport(brand, suggestion, verdict, asin, productTitle, reason) {
    if (!REPORT_ENDPOINT) {
      var title = (suggestion === "is_junk" ? "Junk brand: " : "Real brand: ") + brand;
      var body = "Brand: " + brand +
        "\nCurrent verdict: " + verdict +
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
        brand: brand,
        suggestion: suggestion,
        verdict: verdict,
        asin: asin || null,
        marketplace: location.hostname,
        extVersion: chrome.runtime.getManifest().version,
        // Review context: what the product was and why it got that verdict.
        title: (productTitle || "").slice(0, 150) || null,
        reason: (reason || "").slice(0, 200) || null
      })
    }).catch(function () { /* fire-and-forget */ });
  }

  // Leading n words of a string — a brand prefill for tiles we read no brand from.
  function firstWords(s, n) {
    return (s || "").trim().split(/\s+/).slice(0, n).join(" ");
  }

  // Report footer: name the brand, then tell the shared lists we got it wrong.
  // Two steps, so the shopper can fix a truncated or missed brand before it
  // ships: the button reveals a prefilled, editable field; confirming sends it.
  // A filtered tile asserts "this is actually real" — and we trust the corrected
  // name locally so it stops being hidden right away, even on an unbranded tile
  // we never read a name from (the case issue #95 is about). An unfiltered
  // branded tile reports the reverse ("this is junk"). Rating-only filtering
  // isn't a brand call, so it gets no report path.
  function reportFoot(tile, result) {
    if (result.verdict === "lowrated") return null;
    var filtered = Knockoff.shouldAct(result.verdict, settings.level);
    if (!filtered && !result.brand) return null;

    var isReal = filtered;
    var suggestion = isReal ? "not_junk" : "is_junk";
    var foot = el("div", "ko-menu-foot");

    var form = el("div", "ko-report-form");
    var input = document.createElement("input");
    input.type = "text";
    input.className = "ko-report-input";
    input.maxLength = 64;
    input.placeholder = "Brand name";
    input.value = result.brand || firstWords(tileTitle(tile), 2);
    // Keep typing/clicking in the field from bubbling to the tile link.
    input.addEventListener("click", function (e) { e.stopPropagation(); });
    input.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });

    var send = document.createElement("button");
    send.type = "button";
    send.className = "ko-menu-btn ko-report-send";
    send.innerHTML = ICONS.seal; // static markup only
    send.title = "Send report";
    send.setAttribute("aria-label", "Send report");
    send.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation(); submit();
    });

    form.appendChild(input);
    form.appendChild(send);

    foot.appendChild(menuButton("flag",
      isReal ? "Report as a real brand" : "Report as junk",
      function () {
        foot.textContent = "";
        foot.appendChild(form);
        input.focus();
        input.select();
      }));

    function submit() {
      var brand = input.value.trim();
      if (!brand) { input.focus(); return; }
      sendReport(brand, suggestion, result.verdict,
        tile.getAttribute("data-asin"), tileTitle(tile), result.reason);
      // Naming a real brand also trusts it for you, so the tile stops being
      // hidden (storage change → rescan). Clear any stale block on the name.
      if (isReal) {
        setListMembership("block", brand, false);
        setListMembership("allow", brand, true);
      }
      foot.textContent = "";
      var done = menuButton("seal",
        isReal ? "Reported — trusted for you" : "Reported. Thank you",
        function () {});
      done.disabled = true;
      foot.appendChild(done);
    }

    return foot;
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

  // ── First-catch toast ──────────────────────────────────────────────────────
  // Once ever: the first time a page actually has something filtered, confirm
  // the extension is working and point at the toolbar button — the moment the
  // panel becomes relevant is the moment to teach it.

  function maybeShowIntroToast() {
    if (introShown || stats.filtered === 0) return;
    introShown = true;
    chrome.storage.local.set({ introShown: true });
    var toast = el("div", "");
    toast.id = "ko-intro";
    toast.setAttribute("role", "status"); // announce once to screen readers
    var logo = el("span", "ko-intro-logo");
    logo.innerHTML = PANEL_LOGO; // static markup only
    toast.appendChild(logo);
    var msg = document.createElement("span");
    var count = document.createElement("b");
    count.textContent = stats.filtered;
    msg.appendChild(document.createTextNode("Knockoff filtered "));
    msg.appendChild(count);
    msg.appendChild(document.createTextNode(
      " listing" + (stats.filtered === 1 ? "" : "s") + " on this page. " +
      "The toolbar button opens the\u00a0panel.")); // nbsp: no widow word
    var ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "Got it";
    ok.addEventListener("click", function () { toast.remove(); });
    toast.appendChild(msg);
    toast.appendChild(ok);
    // Sit above the count pill when both are up (hide mode).
    if (document.getElementById("ko-pill")) toast.classList.add("ko-intro-raised");
    document.body.appendChild(toast);
  }

  // ── Product detail page byline ─────────────────────────────────────────────

  function processProductPage() {
    processPdpByline();
    processPdpSeller();
    processPdpSellerCountry();
  }

  function processPdpByline() {
    var byline = document.getElementById("bylineInfo");
    if (!byline || document.querySelector(".ko-pdp-brand")) return;
    var brandName = KnockoffPdp.brandFromByline(byline, location.href);
    if (!brandName) return;
    // The byline text IS the brand, so classify it authoritatively (never
    // "unbranded") — same as the search-tile brand row.
    var result = Knockoff.classifyBrand(brandName, settings, userAllow, userBlock);
    // On the product page, always label, never hide the page out from under
    // the user, and include known/unknown verdicts for context.
    var meta = VERDICT_META[result.verdict];
    if (!meta) return; // e.g. "foreign": a non-Latin byline we don't badge

    var badge = document.createElement("button");
    badge.type = "button";
    badge.className = "ko-badge ko-pdp-badge ko-pdp-brand ko-v-" + result.verdict;
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

  // "Sold by" seller check. Warn-only: a chip appears when the seller name
  // reads like a pseudo-brand (or is listed/blocked); clean or merely
  // unrecognized sellers get nothing — a warning that fires on every
  // marketplace seller would just be noise. The chip is informational, not
  // a menu: user lists are brand-keyed, and quietly feeding seller names
  // into them from a click would muddy what those lists mean.
  var SELLER_META = {
    blocked: { icon: "tagSlash", label: "Seller on your blocklist" },
    flagged: { icon: "tagSlash", label: "Likely junk seller" }
  };

  function processPdpSeller() {
    // #sellerProfileTriggerId is Amazon's marketplace-global id for the
    // third-party "Sold by" link; absent when Amazon itself is the seller.
    var el = document.getElementById("sellerProfileTriggerId") ||
      document.querySelector('#merchant-info a[href*="seller="]');
    if (!el || document.querySelector(".ko-pdp-seller")) return;
    var name = (el.textContent || "").trim();
    if (!name) return;
    var result = Knockoff.classifySeller(name, userAllow, userBlock);
    var meta = SELLER_META[result.verdict];
    if (!meta) return; // known/unknown/allowed: stay quiet
    var badge = document.createElement("span");
    badge.className = "ko-badge ko-pdp-badge ko-pdp-seller ko-v-" + result.verdict;
    badge.innerHTML = ICONS[meta.icon]; // static markup; label added as text node
    var label = document.createElement("span");
    label.textContent = meta.label;
    badge.appendChild(label);
    badge.title = "Knockoff: " + sentence(result.reason);
    // The byline row under the title, beside the brand chip — all Knockoff
    // chrome on one line. The buy box's narrow Sold-by column (where the
    // seller link itself lives) can't fit a chip without wrecking its
    // label/value grid; the link stays as the fallback for bylineless pages.
    var anchor = document.querySelector(".ko-pdp-brand") ||
      document.getElementById("bylineInfo") || el;
    anchor.insertAdjacentElement("afterend", badge);
  }

  // ── Seller country ─────────────────────────────────────────────────────────
  // Community-sourced seller→country map: tiles carry the featured offer's
  // seller ID, so we batch-look it up (GET /merchants) and put a flag on
  // listings whose seller is resolved. The same IDs are batch-reported once
  // per page (POST /merchants/seen) so the backfill queue knows which sellers
  // people actually encounter, and a seller page a user organically visits
  // reports the country printed in its business address (POST
  // /merchants/report). On by default; the only things ever sent or stored
  // are seller IDs and countries — nothing about the user, the search, or the
  // products. Display-only: never an input to the filter verdict.

  var MERCHANTS_URL = REPORT_ENDPOINT + "/merchants";
  var MERCHANT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // sellers relocate rarely
  var MERCHANT_BATCH = 60;                       // server's per-request cap
  var MERCHANT_CACHE_MAX = 3000;                 // koMerchants entry cap

  // Amazon retail sells on a large share of tiles, and each marketplace has
  // its own retail seller ID — a flag on half the page is noise, so all of
  // them (CONFIG.amazonSellerIds) are skipped client-side: no chip, no
  // lookup, no sighting.
  function isAmazonSeller(id) {
    return CONFIG.amazonSellerIds.indexOf(id) !== -1;
  }

  var merchantCountries = {};      // id → ISO code (cache + this session's lookups)
  var merchantLookupPending = new Set();
  var merchantQueried = new Set(); // looked up this page load (resolved or not)
  var merchantUnresolved = new Set(); // looked up and came back with no country
  var merchantSeenPending = new Set();
  var merchantSeenSent = new Set(); // sighted-reported this page load
  var merchantFlushTimer = null;
  var sellerPageReported = false;

  function loadMerchantCache() {
    return chrome.storage.local.get({ koMerchants: {} }).then(function (s) {
      var now = Date.now();
      Object.keys(s.koMerchants).forEach(function (id) {
        var e = s.koMerchants[id];
        if (e && e.at > now - MERCHANT_TTL_MS) merchantCountries[id] = e.c;
      });
    });
  }

  // Fold fresh resolutions into the persisted cache; prune stale entries and
  // cap the map so it can't grow without bound. Concurrent-tab drift is fine —
  // it's a cache, the server is the source of truth.
  function saveMerchantCache(resolved) {
    chrome.storage.local.get({ koMerchants: {} }).then(function (s) {
      var map = s.koMerchants;
      var now = Date.now();
      Object.keys(resolved).forEach(function (id) { map[id] = { c: resolved[id], at: now }; });
      var ids = Object.keys(map);
      ids.forEach(function (id) { if (!(map[id].at > now - MERCHANT_TTL_MS)) delete map[id]; });
      ids = Object.keys(map);
      if (ids.length > MERCHANT_CACHE_MAX) {
        ids.sort(function (a, b) { return map[a].at - map[b].at; })
          .slice(0, ids.length - MERCHANT_CACHE_MAX)
          .forEach(function (id) { delete map[id]; });
      }
      chrome.storage.local.set({ koMerchants: map });
    });
  }

  // The featured offer's seller ID from a tile: an add-to-cart hidden input's
  // value, or a csa-instrumented element's data attribute. Selectors live in
  // CONFIG; both carry the same "A..." ID.
  function tileMerchantId(tile) {
    for (var i = 0; i < CONFIG.selectors.merchantId.length; i++) {
      var node = tile.querySelector(CONFIG.selectors.merchantId[i]);
      var v = node && (node.value || node.getAttribute("data-csa-c-merchant-id"));
      if (v && Knockoff.isMerchantId(v)) return v;
    }
    return null;
  }

  function countryName(cc) {
    try {
      var n = new Intl.DisplayNames(undefined, { type: "region" }).of(cc);
      if (n && n !== cc) return n;
    } catch (e) { /* rare locale data gap; the code alone still reads */ }
    return cc;
  }

  function flagChip(country, inline) {
    var chip = el("span", "ko-flag" + (inline ? " ko-pdp-flag" : ""));
    chip.textContent = Knockoff.flagEmoji(country) + " " + country;
    chip.title = "Knockoff: seller based in " + countryName(country) +
      " (community-sourced)";
    return chip;
  }

  // Unknown-seller chip: the map is crowd-built, so the empty state IS the
  // ask. A labeled link to the seller's own page — visiting it is literally
  // all it takes: the content script there reads the country off the business
  // address, contributes it, and confirms with a toast (showOriginToast).
  function helpChip(id, inline) {
    var chip = document.createElement("a");
    chip.className = "ko-flag ko-flag-unknown" + (inline ? " ko-pdp-flag" : "");
    chip.href = "/sp?seller=" + id;
    chip.target = "_blank";
    chip.rel = "noopener noreferrer";
    chip.innerHTML = ICONS.dashed; // static markup only; label added as text
    var label = document.createElement("span");
    label.textContent = "Where from?";
    chip.appendChild(label);
    chip.title = "Nobody's checked where this seller is based yet. Open their " +
      "seller page and Knockoff will read the country off it, for everyone.";
    // Keep the click ours; Amazon binds handlers on the tile around us.
    chip.addEventListener("click", function (e) { e.stopPropagation(); });
    return chip;
  }

  // Chip every annotated node: a flag once the seller has resolved, the
  // help-us chip once a lookup has confirmed nobody knows yet (never before —
  // flashing "unknown" ahead of the answer would be wrong half the time).
  // Tiles get a corner chip; the PDP "Sold by" line (data-ko-inline) gets an
  // inline chip after the seller link. A help chip upgrades to a flag in
  // place when the country arrives (e.g. back from the seller page).
  function renderMerchantChips() {
    document.querySelectorAll("[data-ko-merchant]").forEach(function (node) {
      var id = node.getAttribute("data-ko-merchant");
      var inline = node.hasAttribute("data-ko-inline");
      var country = merchantCountries[id];
      // The PDP chip renders on the byline row, outside the tracked buy-box
      // node, so its dedupe guard is document-wide (one PDP, one chip).
      var existing = inline
        ? document.querySelector(".ko-pdp-flag")
        : node.querySelector(".ko-flag");
      var chip;
      if (country) {
        if (existing && !existing.classList.contains("ko-flag-unknown")) return;
        if (existing) existing.remove();
        chip = flagChip(country, inline);
      } else if (!existing && merchantUnresolved.has(id)) {
        chip = helpChip(id, inline);
      } else {
        return;
      }
      if (inline) {
        // Last spot on the byline row, after the brand-verdict and junk-seller
        // chips, so all Knockoff chrome reads as one line under the title.
        // Fallback for bylineless pages: beside the buy box's Sold-by link
        // (:not(.ko-flag) — the help chip is itself a seller= link).
        var anchor = document.querySelector(".ko-pdp-seller") ||
          document.querySelector(".ko-pdp-brand") ||
          document.getElementById("bylineInfo") ||
          node.querySelector('a[href*="seller="]:not(.ko-flag)');
        if (anchor) anchor.insertAdjacentElement("afterend", chip);
      } else {
        // The chip sits over the product image's top-left (like Amazon's
        // "Overall Pick"), but it must be a DIRECT child of the tile, same
        // as the verdict badge: the dim treatment fades every other tile
        // child, and ancestor opacity can't be undone from inside — a chip
        // nested in the image container would fade with the product. So
        // measure the image's corner and place the chip there from outside.
        var anchor = firstMatch(node, CONFIG.selectors.merchantChipAnchor);
        node.style.position = "relative";
        if (anchor) {
          var aRect = anchor.getBoundingClientRect();
          var tRect = node.getBoundingClientRect();
          if (aRect.width) { // hidden tiles measure 0: leave the CSS default
            chip.style.top = Math.round(aRect.top - tRect.top + 8) + "px";
            chip.style.left = Math.round(aRect.left - tRect.left + 8) + "px";
          }
        }
        node.appendChild(chip);
      }
    });
  }

  function scheduleMerchantFlush() {
    if (merchantFlushTimer) return;
    merchantFlushTimer = setTimeout(function () {
      merchantFlushTimer = null;
      flushMerchants();
    }, 800);
  }

  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function flushMerchants() {
    // The toggle may have flipped off during the debounce window; once it's
    // off, nothing leaves the browser.
    if (!settings.sellerCountry) {
      merchantSeenPending.clear();
      merchantLookupPending.clear();
      return;
    }
    var seen = Array.from(merchantSeenPending);
    merchantSeenPending.clear();
    seen.forEach(function (id) { merchantSeenSent.add(id); });
    chunk(seen, MERCHANT_BATCH).forEach(function (ids) {
      fetch(MERCHANTS_URL + "/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ids })
      }).catch(function () { /* fire-and-forget */ });
    });

    var lookup = Array.from(merchantLookupPending);
    merchantLookupPending.clear();
    // Marked queried before the fetch: a failed lookup waits for the next
    // page load rather than retrying on every rescan.
    lookup.forEach(function (id) { merchantQueried.add(id); });
    chunk(lookup, MERCHANT_BATCH).forEach(function (ids) {
      fetch(MERCHANTS_URL + "?ids=" + ids.join(","))
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (resolved) {
          var fresh = {};
          ids.forEach(function (id) {
            if (typeof resolved[id] === "string" && /^[A-Z]{2}$/.test(resolved[id])) {
              merchantCountries[id] = resolved[id];
              fresh[id] = resolved[id];
            } else {
              merchantUnresolved.add(id); // confirmed unknown → show the ask
            }
          });
          if (Object.keys(fresh).length) saveMerchantCache(fresh);
          renderMerchantChips();
        })
        .catch(function () { /* offline; flags just don't show this page */ });
    });
  }

  // Annotate a node with its seller and queue the network work it needs.
  function trackMerchant(node, id) {
    node.setAttribute("data-ko-merchant", id);
    if (!merchantSeenSent.has(id)) { merchantSeenPending.add(id); scheduleMerchantFlush(); }
    if (!merchantCountries[id] && !merchantQueried.has(id)) {
      merchantLookupPending.add(id);
      scheduleMerchantFlush();
    }
  }

  function scanSellerCountry() {
    if (!settings.sellerCountry) return;
    document.querySelectorAll(CONFIG.selectors.tiles.join(",")).forEach(function (tile) {
      if (tile.hasAttribute("data-ko-merchant")) return;
      var id = tileMerchantId(tile);
      if (id && !isAmazonSeller(id)) trackMerchant(tile, id);
    });
    renderMerchantChips();
  }

  // The PDP "Sold by" link carries the seller ID in its href; flag it inline.
  function processPdpSellerCountry() {
    if (!settings.sellerCountry) return;
    var link = document.getElementById("sellerProfileTriggerId") ||
      document.querySelector('#merchant-info a[href*="seller="]');
    var host = link && link.parentElement;
    if (!host || host.hasAttribute("data-ko-merchant")) return;
    var m = (link.getAttribute("href") || "").match(/[?&]seller=([0-9A-Z]+)/);
    if (!m || !Knockoff.isMerchantId(m[1]) || isAmazonSeller(m[1])) return;
    host.setAttribute("data-ko-inline", "1");
    trackMerchant(host, m[1]);
    renderMerchantChips();
  }

  // ── Contribution rewards ──────────────────────────────────────────────────
  // Milestones + a country "passport" + pioneer moments, all from the local
  // contribution log ({at, c: country, f: first-ever}). Uncapped cumulative
  // progress by design: collections and counts never saturate, and countries
  // (novelty) are celebrated over raw clicks.

  var SELLER_MILESTONES = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

  // Countries collected, ordered by when each was first pinned down.
  function passportCountries(log) {
    var firstSeen = {};
    Object.keys(log).forEach(function (k) {
      var e = log[k];
      if (!e || !e.c) return;
      if (!(e.c in firstSeen) || e.at < firstSeen[e.c]) firstSeen[e.c] = e.at;
    });
    return Object.keys(firstSeen).sort(function (a, b) {
      return firstSeen[a] - firstSeen[b];
    });
  }

  function helpedLine(n) {
    if (n === 1) return "That's your first seller pinned down — thanks!";
    if (SELLER_MILESTONES.indexOf(n) !== -1) {
      return "🎉 " + n.toLocaleString() + " sellers pinned down — milestone!";
    }
    var next = null;
    for (var i = 0; i < SELLER_MILESTONES.length; i++) {
      if (SELLER_MILESTONES[i] > n) { next = SELLER_MILESTONES[i]; break; }
    }
    return "That's " + n.toLocaleString() + " sellers you've helped pin down" +
      (next ? " — " + (next - n) + " more to " + next + "." : ".");
  }

  // The one line under the toast title, picked by how special this visit was:
  // a first-ever mapping beats a new passport country beats the running count.
  function contribLine(log, opts) {
    var n = Object.keys(log).length;
    if (opts.repeat) return "Already on Knockoff's community map. " + helpedLine(n);
    if (opts.first) {
      return "You're the first person anywhere to map this seller. " + helpedLine(n);
    }
    if (opts.newCountry) {
      var c = passportCountries(log).length;
      return "New country in your collection — that's " + c + ". " + helpedLine(n);
    }
    return "Added to Knockoff's community map. " + helpedLine(n);
  }

  // Community aggregates for the "your N of the community's M" framing.
  // Anonymous two-number endpoint, cached an hour; stale beats absent, and
  // absent (old worker, offline) just means the copy stays personal-only.
  var STATS_TTL_MS = 60 * 60 * 1000;
  // Failures are throttled per tab: without this, a failing endpoint would be
  // re-fetched on every scan tick while the panel is open (Amazon pages
  // mutate constantly — deal countdowns tick once a second).
  var STATS_RETRY_MS = 5 * 60 * 1000;
  var statsLastAttempt = 0;
  // Last known aggregates, kept in memory so share clicks never wait on the
  // network (a fetch between click and clipboard write can outlive the
  // user-activation window that clipboard access requires).
  var communityStats = null;
  function getCommunityStats() {
    return chrome.storage.local.get({ koStats: null }).then(function (s) {
      // A cached blob without `reported` predates that field — treat as stale.
      if (s.koStats && s.koStats.reported != null &&
          s.koStats.at > Date.now() - STATS_TTL_MS) {
        communityStats = s.koStats;
        return s.koStats;
      }
      if (Date.now() - statsLastAttempt < STATS_RETRY_MS) return s.koStats;
      statsLastAttempt = Date.now();
      return fetch(MERCHANTS_URL + "/stats")
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (j) {
          var stats = { total: j.total, resolved: j.resolved, reported: j.reported, at: Date.now() };
          chrome.storage.local.set({ koStats: stats });
          communityStats = stats;
          return stats;
        })
        .catch(function () { return s.koStats; });
    });
  }

  // The Wordle lesson: the lowest-friction share is plain text + emoji that
  // reads well pasted anywhere. Built only from stats the user chooses to
  // publish; nothing else rides along.
  function buildShareText(log, communityMapped) {
    var n = Object.keys(log).length;
    var countries = passportCountries(log);
    var firsts = Object.keys(log).filter(function (k) { return log[k] && log[k].f; }).length;
    var lines = [];
    lines.push("🕵️ I've mapped " + n.toLocaleString() + " Amazon seller" + (n === 1 ? "" : "s") +
      " for Knockoff's community map" +
      (communityMapped ? " (" + communityMapped.toLocaleString() + " and counting)" : ""));
    if (countries.length) {
      lines.push(countries.slice(0, 8).map(Knockoff.flagEmoji).join("") +
        (countries.length > 8 ? " +" + (countries.length - 8) : "") +
        " — " + countries.length + (countries.length === 1 ? " country" : " countries") + " collected" +
        (firsts ? " · " + firsts + " first-ever find" + (firsts === 1 ? "" : "s") : ""));
    }
    lines.push("https://knockoff.co");
    return lines.join("\n");
  }

  // Clipboard with the un-permissioned fallback; both need the user gesture
  // we always have (share is click-only).
  // Resolves true only when a copy actually happened, so buttons never
  // claim "Copied!" over an empty clipboard.
  function copyText(text) {
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { /* stays false */ }
      ta.remove();
      return ok;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return fallback(); }
      );
    }
    return Promise.resolve(fallback());
  }

  // The payoff for checking a seller page: confirm on the spot that the visit
  // did something. Without this, a shopper who clicked "Where from?" lands on
  // a seller page with zero sign anything happened. The running count +
  // passport + share button are the collector loop that keeps people
  // clicking the chips. Auto-dismisses.
  function showOriginToast(country, subText) {
    if (document.getElementById("ko-origin")) return;
    var toast = el("div", "");
    toast.id = "ko-origin";
    toast.setAttribute("role", "status");
    var flag = el("span", "ko-origin-flag");
    flag.textContent = Knockoff.flagEmoji(country);
    toast.appendChild(flag);
    var msg = el("span", "");
    var title = document.createElement("b");
    title.textContent = "Seller based in " + countryName(country);
    msg.appendChild(title);
    var sub = el("span", "ko-origin-sub");
    sub.textContent = subText;
    msg.appendChild(sub);
    toast.appendChild(msg);
    function out() {
      toast.classList.add("ko-origin-out");
      setTimeout(function () { toast.remove(); }, 400);
    }
    var dismiss = setTimeout(out, 10000);
    getCommunityStats(); // prime the in-memory aggregates before any click
    var share = document.createElement("button");
    share.type = "button";
    share.className = "ko-origin-share";
    share.textContent = "Copy stats";
    share.title = "Copies your mapping stats to the clipboard, ready to paste anywhere";
    share.addEventListener("click", function () {
      clearTimeout(dismiss);
      // Storage read only — a network fetch here could outlive the
      // user-activation window the clipboard write needs.
      chrome.storage.local.get({ koMerchantReported: {} }).then(function (s) {
        var total = communityStats && communityStats.reported;
        copyText(buildShareText(s.koMerchantReported, total)).then(function (ok) {
          if (ok) share.textContent = "Copied!";
          dismiss = setTimeout(out, 2000);
        });
      });
    });
    toast.appendChild(share);
    document.body.appendChild(toast);
  }

  // Proof-of-work for /merchants/report: fetch a signed challenge, grind
  // nonces with WebCrypto until the digest clears the server's difficulty
  // (sub-second at the current 14 bits), bound to this exact report so a
  // solution can't be replayed for a different seller or country. Bounded:
  // gives up after ~8x the expected work or 15s and reports without proof —
  // the server then declines the vote, and the local experience (toast,
  // passport, counts) is untouched. This is what makes bare-curl spam cost
  // an implementation instead of a one-liner.
  function sha256Hex(str) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str))
      .then(function (buf) {
        var b = new Uint8Array(buf);
        var out = "";
        for (var i = 0; i < b.length; i++) out += (b[i] < 16 ? "0" : "") + b[i].toString(16);
        return out;
      });
  }

  function solvePow(payload) {
    return fetch(MERCHANTS_URL + "/challenge")
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (ch) {
        if (typeof ch.c !== "string" || typeof ch.bits !== "number" || ch.bits > 24) {
          return null;
        }
        var deadline = Date.now() + 15000;
        var maxTries = Math.pow(2, ch.bits) * 8;
        var n = 0;
        function attempt() {
          if (n > maxTries || Date.now() > deadline) return null;
          var nonce = (n++).toString(36);
          return sha256Hex(ch.c + ":" + nonce + ":" + payload).then(function (digest) {
            return Knockoff.hexLeadingZeroBits(digest) >= ch.bits
              ? { c: ch.c, n: nonce }
              : attempt();
          });
        }
        return attempt();
      })
      .catch(function () { return null; }); // old worker/offline: report unproofed
  }

  // Seller profile pages (/sp?seller=...) print the business address; each
  // address block's last line is an ISO country code. Report it once per
  // seller per while — this is the crowd source the whole map is built from.
  // Also trust it locally right away: the user is looking at the ground truth.
  function processSellerProfilePage() {
    if (!settings.sellerCountry || sellerPageReported) return;
    var id = new URLSearchParams(location.search).get("seller") || "";
    if (!Knockoff.isMerchantId(id) || isAmazonSeller(id)) return;
    var rows = document.querySelectorAll(CONFIG.selectors.sellerInfoRow.join(","));
    if (!rows.length) return;
    // Label rows vs address lines, so the parser can tell the business
    // address from an EU customer-services address in another country.
    var addressSel = CONFIG.selectors.sellerAddressRow.join(",");
    var country = Knockoff.countryFromSellerRows(
      Array.prototype.map.call(rows, function (r) {
        return { text: r.textContent || "", indent: r.matches(addressSel) };
      }),
      CONFIG.sellerBizLabels
    );
    sellerPageReported = true; // detail section seen; don't re-parse every rescan
    if (!country) return;
    var fresh = {};
    fresh[id] = country;
    merchantCountries[id] = country;
    saveMerchantCache(fresh);
    // koMerchantReported doubles as the local contribution history (per
    // seller: when, which country, whether it was a first-ever mapping —
    // never sent anywhere): its size is the "sellers you've helped" stat,
    // its countries are the passport, and its timestamps throttle re-reports
    // to one per seller per TTL. Never pruned — one entry per manually
    // visited seller page can't grow past what a human can click.
    chrome.storage.local.get({ koMerchantReported: {} }).then(function (s) {
      var log = s.koMerchantReported;
      var now = Date.now();
      var entry = log[id];
      if (entry && entry.at > now - MERCHANT_TTL_MS) {
        showOriginToast(country, contribLine(log, { repeat: true }));
        return;
      }
      var newCountry = passportCountries(log).indexOf(country) === -1;
      log[id] = { at: now, c: country };
      chrome.storage.local.set({ koMerchantReported: log });
      // The storefront name rides along so the backfill queue shows who a
      // seller ID is. It's the page's own h1 — no user data.
      var nameEl = firstMatch(document, CONFIG.selectors.sellerName);
      var name = (nameEl && nameEl.textContent || "").replace(/\s+/g, " ").trim()
        .slice(0, 100) || null;
      // The response says whether this seller was unmapped by everyone —
      // the pioneer moment. Toast waits on the proof-of-work grind (sub-
      // second) plus one round-trip; on failure (offline, old worker) it
      // degrades to the plain celebration.
      solvePow(id + ":" + country).then(function (pow) {
        return fetch(MERCHANTS_URL + "/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: id, country: country, name: name, pow: pow || undefined })
        });
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (resp) {
          var first = !!(resp && resp.first);
          if (first) {
            log[id].f = 1;
            chrome.storage.local.set({ koMerchantReported: log });
          }
          showOriginToast(country, contribLine(log, { first: first, newCountry: newCountry }));
        })
        .catch(function () {
          showOriginToast(country, contribLine(log, { newCountry: newCountry }));
        });
    });
  }

  // ── Control panel ──────────────────────────────────────────────────────────
  // Toggled by the toolbar button (via the background worker). Lives in the
  // page, next to the results it changes, so settings apply live as you flip
  // them, and the counts tick in place while you scroll.

  var PANEL_LOGO = '<svg viewBox="0 0 56.29 63.3" aria-hidden="true"><path d="M46.83,11.46L29.85,1.55C25.13-1.21,19.11-.2,15.55,3.95L2.74,18.86C.54,21.42-.4,24.79.16,28.12l3.79,22.58c1.38,8.21,9.18,13.77,17.4,12.39l22.34-3.75c8.21-1.38,13.77-9.18,12.39-17.4l-3.79-22.58c-.56-3.33-2.55-6.21-5.46-7.9h0ZM25.71,20.65c-2.57.43-5-1.3-5.44-3.87s1.3-5,3.87-5.44,5,1.3,5.44,3.87c.43,2.57-1.3,5-3.87,5.44Z" fill="#e01024"/><path d="M42.83,44.9l-8.64-6.16c-.44-.32-.55-.93-.23-1.38l6.16-8.64c.32-.44.21-1.06-.23-1.38l-3.77-2.68c-.44-.32-1.06-.21-1.38.23l-6.16,8.64c-.32.44-.93.55-1.38.23l-8.64-6.16c-.44-.32-1.06-.21-1.38.23l-2.68,3.77c-.32.44-.21,1.06.23,1.38l8.64,6.16c.44.32.55.93.23,1.38l-6.16,8.64c-.32.44-.21,1.06.23,1.38l3.77,2.68c.44.32,1.06.21,1.38-.23l6.16-8.64c.32-.44.93-.55,1.38-.23l8.64,6.16c.44.32,1.06.21,1.38-.23l2.68-3.77c.32-.44.21-1.06-.23-1.38Z" fill="#fff"/></svg>';

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

    // Community contribution: a different kind of stat than the filter
    // counts, so it gets its own card — same anatomy as the stats row (big
    // number + overline + sub) so the panel reads as a stack of matching
    // stat tiles. Hidden until they've mapped one.
    var mapped = el("div", "ko-panel-stats ko-panel-mapped");
    mapped.id = "ko-panel-mapped";
    mapped.style.display = "none";
    var mappedNum = el("span", "ko-panel-num");
    mappedNum.id = "ko-panel-mapped-num";
    var mappedCopy = el("span", "ko-panel-statcopy");
    var mappedOver = el("span", "ko-panel-overline");
    mappedOver.textContent = "Sellers mapped";
    // Two deliberate sub-lines, not one wrapping sentence: the community
    // count (shown once stats arrive) and the tagline (nbsp keeps its break
    // clean at the narrow width).
    var mappedSub = el("span", "ko-panel-sub");
    mappedSub.id = "ko-panel-mapped-sub";
    mappedSub.style.display = "none";
    var mappedTag = el("span", "ko-panel-sub");
    mappedTag.textContent = "Helping everyone shop\u00a0smarter";
    // The passport: one flag per country collected, in discovery order.
    var mappedFlags = el("span", "ko-panel-flags");
    mappedFlags.id = "ko-panel-flags";
    mappedCopy.appendChild(mappedOver);
    mappedCopy.appendChild(mappedSub);
    mappedCopy.appendChild(mappedTag);
    mappedCopy.appendChild(mappedFlags);
    // Labeled, honest: this copies text to the clipboard, so say so — before
    // (label) and after (Copied!).
    function setShareBtn(btn, icon, text) {
      btn.innerHTML = ICONS[icon]; // static markup; label added as text node
      var label = document.createElement("span");
      label.textContent = text;
      btn.appendChild(label);
    }
    var mappedShare = document.createElement("button");
    mappedShare.type = "button";
    mappedShare.className = "ko-mapped-share";
    setShareBtn(mappedShare, "share", "Copy stats");
    mappedShare.title = "Copies your mapping stats to the clipboard, ready to paste anywhere";
    mappedShare.addEventListener("click", function () {
      // Storage read only — a network fetch here could outlive the
      // user-activation window the clipboard write needs. The community
      // total comes from the in-memory copy updatePanelState keeps fresh.
      chrome.storage.local.get({ koMerchantReported: {} }).then(function (st) {
        var total = communityStats && communityStats.reported;
        copyText(buildShareText(st.koMerchantReported, total)).then(function (ok) {
          if (!ok) return;
          mappedShare.classList.add("ko-share-done");
          setShareBtn(mappedShare, "seal", "Copied!");
          setTimeout(function () {
            mappedShare.classList.remove("ko-share-done");
            setShareBtn(mappedShare, "share", "Copy stats");
          }, 2000);
        });
      });
    });
    // The button lives inside the copy column as its own row: sharing the
    // flex row with the text squeezes every line into wrapping.
    mappedCopy.appendChild(mappedShare);
    mapped.appendChild(mappedNum);
    mapped.appendChild(mappedCopy);
    panel.appendChild(mapped);

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
    // Hide-sponsored is orthogonal to the brand filter (it's a DOM property,
    // not a verdict), so it gets its own toggle rather than a segmented control.
    card.appendChild(el("div", "ko-panel-rule"));
    var spRow = el("label", "ko-panel-toggle");
    var spText = el("span", "ko-panel-toggle-label");
    spText.textContent = "Hide sponsored listings";
    var spSwitch = el("span", "ko-switch");
    var spInput = document.createElement("input");
    spInput.type = "checkbox";
    spInput.id = "ko-panel-sponsored";
    spInput.addEventListener("change", function () {
      chrome.storage.sync.set({ hideSponsored: spInput.checked });
    });
    spSwitch.appendChild(spInput);
    spSwitch.appendChild(el("span", "ko-switch-slider"));
    spRow.appendChild(spText);
    spRow.appendChild(spSwitch);
    card.appendChild(spRow);
    // Seller country is display-only (a flag on listings), grouped here with
    // the other non-verdict toggle.
    card.appendChild(el("div", "ko-panel-rule"));
    var scRow = el("label", "ko-panel-toggle");
    var scText = el("span", "ko-panel-toggle-label");
    scText.textContent = "Show seller country";
    var scSwitch = el("span", "ko-switch");
    var scInput = document.createElement("input");
    scInput.type = "checkbox";
    scInput.id = "ko-panel-seller-country";
    scInput.addEventListener("change", function () {
      chrome.storage.sync.set({ sellerCountry: scInput.checked });
    });
    scSwitch.appendChild(scInput);
    scSwitch.appendChild(el("span", "ko-switch-slider"));
    scRow.appendChild(scText);
    scRow.appendChild(scSwitch);
    card.appendChild(scRow);

    // Rating & review cutoffs: coarse presets for honing results while
    // shopping. Exact thresholds live on the options page. Values are numeric
    // (0 = off) so they round-trip with the detector and the options controls.
    card.appendChild(el("div", "ko-panel-rule"));
    var l3 = el("div", "ko-panel-label");
    l3.textContent = "Minimum rating";
    card.appendChild(l3);
    card.appendChild(segControl("minRating", [
      { value: 0, label: "Off" },
      { value: 4, label: "4★" },
      { value: 4.5, label: "4.5★" }
    ]));
    card.appendChild(el("div", "ko-panel-rule"));
    var l4 = el("div", "ko-panel-label");
    l4.textContent = "Minimum reviews";
    card.appendChild(l4);
    card.appendChild(segControl("minReviews", [
      { value: 0, label: "Off" },
      { value: 100, label: "100+" },
      { value: 1000, label: "1K+" }
    ]));
    card.appendChild(el("div", "ko-panel-rule"));
    var unRow = el("label", "ko-panel-toggle");
    var unText = el("span", "ko-panel-toggle-label");
    unText.textContent = "Filter unrated listings";
    var unSwitch = el("span", "ko-switch");
    var unInput = document.createElement("input");
    unInput.type = "checkbox";
    unInput.id = "ko-panel-unrated";
    unInput.addEventListener("change", function () {
      chrome.storage.sync.set({ filterUnrated: unInput.checked });
    });
    unSwitch.appendChild(unInput);
    unSwitch.appendChild(el("span", "ko-switch-slider"));
    unRow.appendChild(unText);
    unRow.appendChild(unSwitch);
    card.appendChild(unRow);

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
    document.getElementById("ko-panel-sponsored").checked = settings.hideSponsored;
    document.getElementById("ko-panel-seller-country").checked = settings.sellerCountry;
    document.getElementById("ko-panel-unrated").checked = settings.filterUnrated;
    document.getElementById("ko-panel-num").textContent = stats.filtered;
    document.getElementById("ko-panel-hint").textContent = LEVEL_HINTS[settings.level];
    panel.querySelectorAll("[data-ko-seg]").forEach(function (track) {
      var key = track.getAttribute("data-ko-seg");
      track.querySelectorAll("button").forEach(function (b) {
        // data-v is a string; minRating/minReviews are numbers, so compare as
        // strings. A custom options-set value (e.g. 250) matches no preset and
        // simply leaves the segment unhighlighted.
        b.classList.toggle("ko-seg-active", b.getAttribute("data-v") === String(settings[key]));
      });
    });
    chrome.storage.local.get({ lifetimeFiltered: 0, koMerchantReported: {} }).then(function (s) {
      var sub = document.getElementById("ko-panel-sub");
      if (!sub) return;
      sub.textContent = "of " + stats.scanned + " listings · " +
        s.lifetimeFiltered.toLocaleString() + " all-time";
      var mapped = document.getElementById("ko-panel-mapped");
      var helped = Object.keys(s.koMerchantReported).length;
      if (mapped) {
        mapped.style.display = helped ? "" : "none";
        document.getElementById("ko-panel-mapped-num").textContent = helped.toLocaleString();
        var countries = passportCountries(s.koMerchantReported);
        var flagsEl = document.getElementById("ko-panel-flags");
        flagsEl.style.display = countries.length ? "" : "none";
        flagsEl.textContent = countries.slice(0, 12).map(Knockoff.flagEmoji).join(" ") +
          (countries.length > 12 ? "  +" + (countries.length - 12) : "");
        if (helped) {
          // "Your N of the community's M": the pairing that makes a collective
          // total motivating instead of diluting. Silent when unavailable.
          getCommunityStats().then(function (stats) {
            var subEl = document.getElementById("ko-panel-mapped-sub");
            // `reported` counts distinct sellers with at least one crowd vote —
            // the same universe as the personal count above it, so this line
            // can never read smaller than the big number (unlike `resolved`,
            // which lags on the two-reporter consensus rule).
            if (subEl && stats && stats.reported) {
              subEl.textContent = "of the community's " +
                stats.reported.toLocaleString();
              subEl.style.display = "";
            }
          });
        }
      }
    });
  }

  // ── Scanning ───────────────────────────────────────────────────────────────

  // The page's department, as a search alias ("stripbooks", "tools", ...).
  // The search dropdown is the authoritative signal: it reflects the current
  // department on every path — i= searches, left-nav rh=n: refinements (whose
  // node IDs are marketplace-specific), and /b?node= browse pages. The URL i=
  // param is only a fallback for layouts without the dropdown.
  function pageSearchAlias() {
    var dd = document.getElementById("searchDropdownBox");
    if (dd && dd.value) return dd.value.replace("search-alias=", "");
    return new URLSearchParams(location.search).get("i") || "";
  }

  // The current search query, as a Set of normalized tokens. A title whose
  // extracted brand IS a word the shopper searched for isn't a pseudo-brand —
  // it's the category noun ("headboard", "HEADBOARD") they asked for — so
  // processTile spares it. `k` is the modern query param; `field-keywords` is
  // the legacy fallback still used on some locales/paths.
  function pageSearchTokens() {
    var p = new URLSearchParams(location.search);
    var q = p.get("k") || p.get("field-keywords") || "";
    var set = new Set();
    q.trim().split(/\s+/).forEach(function (w) {
      var key = Knockoff.normalize(w);
      if (key) set.add(key);
    });
    return set;
  }

  // Wipe all Knockoff marks from the page. Used before re-applying from
  // scratch, and when an in-page navigation lands on a media category where
  // previously-badged tiles must be released.
  function clearMarks() {
    stats = { scanned: 0, filtered: 0, byVerdict: {} };
    document.querySelectorAll("[data-ko-verdict]").forEach(function (tile) {
      tile.removeAttribute("data-ko-verdict");
      tile.removeAttribute("data-ko-brand");
      tile.classList.remove("ko-act", "ko-hide", "ko-dim", "ko-label");
    });
    document.querySelectorAll("[data-ko-merchant]").forEach(function (node) {
      node.removeAttribute("data-ko-merchant");
      node.removeAttribute("data-ko-inline");
    });
    document.querySelectorAll(".ko-badge, .ko-menu, .ko-flag, #ko-pill").forEach(function (el) {
      el.remove();
    });
  }

  function hasSearchState() {
    return stats.scanned || stats.filtered ||
      document.querySelector("[data-ko-verdict], #ko-pill");
  }

  function scan() {
    // Sponsored-hiding is a DOM property, not a brand verdict, so it's a plain
    // CSS toggle (see styles.css) that stays active even in media categories.
    document.documentElement.classList.toggle(
      "ko-hide-sponsored", settings.enabled && settings.hideSponsored);
    if (settings.enabled) {
      if (Knockoff.isMediaAlias(pageSearchAlias())) {
        // Books, music, movies...: titles are works, not brand-led product
        // names, so classification is skipped wholesale (see detector.js).
        // Clearing marks handles in-page flips into a media category; the
        // wipe re-triggers the observer once, then finds nothing and settles.
        if (hasSearchState()) clearMarks();
      } else {
        searchAllow = pageSearchTokens();
        document.querySelectorAll(CONFIG.selectors.tiles.join(",")).forEach(processTile);
        scanSellerCountry();
      }
      // Product pages stay badged regardless: the dropdown can carry a stale
      // department onto a PDP, and book PDPs are inherently safe (their
      // byline is an author div the brand extractor returns nothing for).
      processProductPage();
      processSellerProfilePage();
    }
    updatePill();
    updatePanelState();
    maybeShowIntroToast();
  }

  // Wipe all Knockoff state from the page and re-apply from scratch.
  // Used when settings or lists change.
  function rescan() {
    clearMarks();
    scan();
  }

  var scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () { scanTimer = null; scan(); }, 150);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  chrome.storage.onChanged.addListener(function (changes, area) {
    // The options page's "Refresh now" (or another tab's daily refresh)
    // wrote a fresh community list; fold it in without waiting for a reload.
    // A fresh remote config and a fresh brand list can arrive in the SAME
    // storage write — the options "Refresh now" sets both keys at once — so
    // handle them together, not as mutually-exclusive branches. Apply the
    // config first (validated in mergeConfig; a bad push falls back to
    // defaults) so any rescan below runs with the new selectors.
    if (area === "local") {
      // A seller page (this tab or another) just learned a country; upgrade
      // any waiting help chips to flags in place — the visit paying off right
      // where the shopper is looking is what makes contributing feel worth it.
      if (changes.koMerchants && settings.sellerCountry) {
        var merchants = changes.koMerchants.newValue || {};
        Object.keys(merchants).forEach(function (id) {
          if (merchants[id] && merchants[id].c) merchantCountries[id] = merchants[id].c;
        });
        renderMerchantChips();
      }
      if (changes.koConfig) CONFIG = mergeConfig(changes.koConfig.newValue);
      if (changes.communityBrands || changes.remoteFlagged) {
        chrome.storage.local.get(["communityBrands", "remoteFlagged"]).then(function (c) {
          Knockoff.buildIndexes(c.communityBrands || null, c.remoteFlagged || null);
          rescan();
        });
        return;
      }
      if (changes.koConfig) { rescan(); return; }
    }
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

  // Close any open badge menu on an outside click.
  document.addEventListener("mousedown", function (event) {
    if (event.target.closest && (event.target.closest(".ko-menu") || event.target.closest(".ko-badge"))) return;
    document.querySelectorAll(".ko-menu").forEach(function (menu) { menu.remove(); });
  }, true);

  chrome.storage.local.get({ introShown: false }).then(function (s) {
    introShown = s.introShown;
  });

  Promise.all([loadSettings().then(loadCommunityList), loadMerchantCache()])
    .then(function (results) {
      var cached = results[0];
      Knockoff.buildIndexes(cached.communityBrands || null, cached.remoteFlagged || null);
      scan();
      new MutationObserver(scheduleScan).observe(document.body, {
        childList: true,
        subtree: true
      });
    });
})();
