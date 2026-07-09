// ==UserScript==
// @name         Knockoff — Amazon Brand Filter
// @namespace    https://github.com/Shpigford/knockoff
// @version      0.3.0
// @description  Filters pseudo-brand junk out of Amazon and can hide sponsored listings. Buy from real, established brands. Userscript build; the browser extension is preferred where available.
// @author       Josh Pigford & contributors
// @homepageURL  https://knockoff.shopping
// @supportURL   https://github.com/Shpigford/knockoff/issues
// @match        https://www.amazon.com/*
// @match        https://www.amazon.ca/*
// @match        https://www.amazon.com.mx/*
// @match        https://www.amazon.com.br/*
// @match        https://www.amazon.co.uk/*
// @match        https://www.amazon.ie/*
// @match        https://www.amazon.de/*
// @match        https://www.amazon.fr/*
// @match        https://www.amazon.it/*
// @match        https://www.amazon.es/*
// @match        https://www.amazon.nl/*
// @match        https://www.amazon.se/*
// @match        https://www.amazon.pl/*
// @match        https://www.amazon.com.be/*
// @match        https://www.amazon.com.tr/*
// @match        https://www.amazon.ae/*
// @match        https://www.amazon.sa/*
// @match        https://www.amazon.eg/*
// @match        https://www.amazon.co.za/*
// @match        https://www.amazon.in/*
// @match        https://www.amazon.co.jp/*
// @match        https://www.amazon.sg/*
// @match        https://www.amazon.com.au/*
// @run-at       document-end
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.listValues
// ==/UserScript==

(function () {

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

var KO_US_VERSION = "0.3.0";

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
  var css = "/* ─────────────────────────────────────────────────────────────────────────────\n   Knockoff: injected page styles.\n\n   Discipline over decoration: these surfaces should feel like native OS\n   chrome that happens to live on Amazon. One background per surface, dense\n   quiet rows, monochrome icons, verdict color used exactly once per surface.\n   Everything prefixed ko- to stay out of Amazon's way.\n\n   Filter actions:\n     .ko-hide : remove from view (floating pill offers reveal)\n     .ko-dim  : fade + desaturate, restore on hover\n     .ko-label: badge only\n   ──────────────────────────────────────────────────────────────────────────── */\n\n.ko-act.ko-hide {\n  display: none !important;\n}\n\n/* Sponsored-listing hide (opt-in). Sponsored is a DOM property, not a brand\n   verdict, so it lives outside the ko-act pipeline and hides silently: no\n   reveal pill, no filtered count. The user asked to never see ads.\n   Scoped to the \"Sponsored\" aria-label *inside* the label so Amazon's own\n   \"Featured from Amazon brands\" tiles — which reuse .puis-sponsored-label-text\n   with a different label — are left untouched. Amazon localizes the label, so\n   match each marketplace's word for \"Sponsored\". */\nhtml.ko-hide-sponsored div[data-component-type=\"s-search-result\"]:has(.puis-sponsored-label-text :is(\n  [aria-label*=\"Sponsored\" i], [aria-label*=\"Gesponsert\" i], [aria-label*=\"Sponsoris\" i],\n  [aria-label*=\"Sponsorizzat\" i], [aria-label*=\"Patrocinad\" i], [aria-label*=\"Gesponsord\" i],\n  [aria-label*=\"Sponsrad\" i], [aria-label*=\"Sponsorowan\" i], [aria-label*=\"Sponsorlu\" i],\n  [aria-label*=\"スポンサー\" i])) {\n  display: none !important;\n}\n\n/* Sponsored *modules* — full-width widget rows, not search-result tiles, so\n   the rule above never matches them: \"Shop X by type\" (SHOPPING_ADVISER),\n   \"Picks from Amazon Influencers\" (FEATURED_ASINS_LIST), sponsored video rows\n   (VIDEO_SINGLE_PRODUCT). Matched by Amazon's ad-disclosure classes, which\n   unlike the label text are not localized, so no aria-label list here:\n   .s-widget-sponsored-label-text is the widget-level \"Sponsored\" link, and\n   the video row's only reliable marker is its label wrapper (its \"Sponsored\"\n   is plain text with no aria-label). Hide the .s-result-item row, not the\n   inner .s-widget-container, or an empty grid row is left behind. */\nhtml.ko-hide-sponsored .s-result-item.s-widget:has(\n  .s-widget-sponsored-label-text, .sponsored-brand-label-info-desktop) {\n  display: none !important;\n}\n\n/* \"Show\" was clicked: hidden items come back in the dim treatment. No\n   borders or outlines here: Amazon's tile elements extend into the grid\n   gutters, so any ring drawn on them clips and merges between cards. The\n   badge chip identifies the item; the fade says why it was hidden. */\n.ko-revealed .ko-act.ko-hide {\n  display: revert !important;\n}\n\n/* Dim Amazon's content but never our own chrome: opacity on the tile\n   itself would wash out the badge and menu with it. */\n.ko-act.ko-dim > :not(.ko-badge):not(.ko-menu),\n.ko-revealed .ko-act.ko-hide > :not(.ko-badge):not(.ko-menu) {\n  opacity: 0.32;\n  filter: grayscale(0.85);\n  transition: opacity 0.18s ease, filter 0.18s ease;\n}\n\n.ko-act.ko-dim:hover > :not(.ko-badge):not(.ko-menu),\n.ko-revealed .ko-act.ko-hide:hover > :not(.ko-badge):not(.ko-menu) {\n  opacity: 1;\n  filter: none;\n}\n\n/* ── Verdict colors: the only color these surfaces use ──────────────────\n   --ko-tint     fill color (chip background, menu dot)\n   --ko-on-tint  text/icon color on top of the fill\n   --ko-text     the verdict color as readable text on white               */\n\n.ko-v-flagged,\n.ko-v-blocked   { --ko-tint: #dc2626; --ko-on-tint: #fff;    --ko-text: #dc2626; }\n.ko-v-suspect,\n.ko-v-unbranded { --ko-tint: #f59e0b; --ko-on-tint: #221503; --ko-text: #b45309; }\n.ko-v-unknown   { --ko-tint: #52525b; --ko-on-tint: #fff;    --ko-text: #52525b; }\n.ko-v-known,\n.ko-v-allowed   { --ko-tint: #047857; --ko-on-tint: #fff;    --ko-text: #047857; }\n\n/* ── Badge chip ─────────────────────────────────────────────────────────────\n   Filled with the verdict color: a status chip must be readable at a\n   glance from across the page. Top-right corner: Amazon owns the top-left\n   (\"Sponsored\", \"Overall Pick\") and our chip must not sit on top of theirs. */\n.ko-badge {\n  position: absolute;\n  top: 8px;\n  right: 8px;\n  z-index: 50;\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  max-width: 82%;\n  padding: 3px 9px 3px 16px;\n  border: 0;\n  border-radius: 6px;\n  background: var(--ko-tint, #52525b);\n  font: 600 11px/1.5 -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n  letter-spacing: 0.01em;\n  color: var(--ko-on-tint, #fff);\n  cursor: pointer;\n  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(0, 0, 0, 0.08);\n  /* the punched hole: the chip is a price tag; the page shows through it */\n  -webkit-mask: radial-gradient(circle 2.5px at 8.5px 50%, transparent 96%, #000 100%);\n          mask: radial-gradient(circle 2.5px at 8.5px 50%, transparent 96%, #000 100%);\n  transition: transform 0.1s ease, filter 0.12s ease;\n}\n\n.ko-badge:hover {\n  filter: brightness(1.08);\n}\n\n.ko-badge:active {\n  transform: scale(0.96);\n}\n\n.ko-badge svg {\n  width: 12px;\n  height: 12px;\n  flex-shrink: 0;\n  color: var(--ko-on-tint, #fff);\n  opacity: 0.95;\n}\n\n.ko-badge span {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* Product-page chip sits in normal flow beside the byline */\n.ko-pdp-badge {\n  position: static;\n  margin-left: 10px;\n  vertical-align: middle;\n  font-size: 12px;\n}\n\n/* Seller chip is informational only: no menu behind it, so no pointer */\n.ko-pdp-seller {\n  cursor: default;\n}\n\n/* ── Popover menu ───────────────────────────────────────────────────────── */\n\n.ko-menu {\n  position: absolute;\n  top: 34px;\n  right: 8px;\n  z-index: 60;\n  width: 232px;\n  padding: 4px;\n  border-radius: 10px;\n  background: #fff;\n  border: 1px solid rgba(17, 17, 17, 0.1);\n  box-shadow:\n    0 10px 38px -10px rgba(22, 23, 24, 0.32),\n    0 10px 20px -15px rgba(22, 23, 24, 0.2);\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n  letter-spacing: 0;\n  transform-origin: top right;\n}\n\n@media (prefers-reduced-motion: no-preference) {\n  .ko-menu {\n    animation: ko-menu-in 0.12s cubic-bezier(0.2, 0.9, 0.3, 1);\n  }\n}\n\n@keyframes ko-menu-in {\n  from { opacity: 0; transform: scale(0.97) translateY(-2px); }\n  to   { opacity: 1; transform: scale(1) translateY(0); }\n}\n\n.ko-menu-head {\n  padding: 8px 10px 2px;\n}\n\n.ko-menu-brand {\n  display: flex;\n  align-items: baseline;\n  justify-content: space-between;\n  gap: 10px;\n  font-size: 13px;\n  font-weight: 600;\n  line-height: 1.4;\n  color: #18181b;\n  overflow: hidden;\n}\n\n.ko-menu-brand > span:first-child {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* verdict, right-aligned: a 6px dot + label in the verdict color */\n.ko-menu-verdict {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  flex-shrink: 0;\n  font-size: 11px;\n  font-weight: 500;\n  color: var(--ko-text, #71717a);\n}\n\n.ko-menu-verdict::before {\n  content: \"\";\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--ko-tint, #71717a);\n}\n\n.ko-menu-reason {\n  padding: 1px 10px 8px;\n  font-size: 11.5px;\n  line-height: 1.45;\n  color: #71717a;\n}\n\n.ko-menu-sep {\n  height: 1px;\n  margin: 4px -4px;\n  background: rgba(17, 17, 17, 0.07);\n}\n\n.ko-menu-group {\n  display: flex;\n  flex-direction: column;\n}\n\n.ko-menu-btn {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: 100%;\n  height: 30px;\n  padding: 0 8px;\n  border: 0;\n  border-radius: 6px;\n  background: none;\n  text-align: left;\n  font: 400 13px/1 -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n  letter-spacing: 0;\n  color: #18181b;\n  cursor: pointer;\n}\n\n.ko-menu-btn svg {\n  width: 14px;\n  height: 14px;\n  flex-shrink: 0;\n  color: #71717a;\n}\n\n.ko-menu-btn:hover {\n  background: #f4f4f5;\n}\n\n.ko-menu-btn:hover svg {\n  color: #18181b;\n}\n\n.ko-menu-label {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* Report row: same register, just quieter text */\n.ko-menu-foot .ko-menu-btn,\n.ko-menu-foot .ko-menu-btn:hover svg + .ko-menu-label {\n  color: #52525b;\n}\n\n.ko-menu-btn:disabled,\n.ko-menu-btn:disabled:hover {\n  color: #047857;\n  background: none;\n  cursor: default;\n}\n\n.ko-menu-btn:disabled svg {\n  color: #047857;\n}\n\n/* ── Control panel ──────────────────────────────────────────────────────────\n   Toggled by the toolbar button. Same visual system as the popover menu:\n   white card, hairline structure, zinc neutrals, one red accent. */\n\n#ko-panel {\n  position: fixed;\n  top: 12px;\n  right: 12px;\n  z-index: 2147483647;\n  width: 296px;\n  padding: 14px;\n  border-radius: 14px;\n  background: #fff;\n  border: 1px solid rgba(17, 17, 17, 0.1);\n  box-shadow:\n    0 10px 38px -10px rgba(22, 23, 24, 0.32),\n    0 10px 20px -15px rgba(22, 23, 24, 0.2);\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n  letter-spacing: 0;\n  color: #18181b;\n  transform-origin: top right;\n}\n\n@media (prefers-reduced-motion: no-preference) {\n  #ko-panel {\n    animation: ko-menu-in 0.14s cubic-bezier(0.2, 0.9, 0.3, 1);\n  }\n}\n\n.ko-panel-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  margin-bottom: 12px;\n  padding: 0 2px;\n}\n\n.ko-panel-brand {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.ko-panel-logo svg {\n  display: block;\n  width: 22px;\n  height: 22px;\n  border-radius: 5px;\n}\n\n.ko-panel-name {\n  font-size: 13.5px;\n  font-weight: 600;\n  letter-spacing: -0.01em;\n}\n\n.ko-panel-stats {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  margin-bottom: 10px;\n  padding: 10px 13px;\n  border-radius: 10px;\n  border: 1px solid #e4e4e7;\n  background: #fafafa;\n}\n\n.ko-panel-num {\n  font-size: 24px;\n  font-weight: 600;\n  line-height: 1;\n  letter-spacing: -0.02em;\n  color: #dc2626;\n  font-variant-numeric: tabular-nums;\n  min-width: 24px;\n  text-align: center;\n}\n\n.ko-panel-statcopy {\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n  border-left: 1px solid #e4e4e7;\n  padding-left: 12px;\n}\n\n.ko-panel-overline {\n  font-size: 12px;\n  font-weight: 500;\n}\n\n.ko-panel-sub {\n  font-size: 11px;\n  color: #71717a;\n  font-variant-numeric: tabular-nums;\n}\n\n.ko-panel-card {\n  border: 1px solid #e4e4e7;\n  border-radius: 10px;\n  padding: 11px;\n  margin-bottom: 10px;\n}\n\n/* ── Filtered-brands list: per-search breakdown with one-click fixes ────── */\n\n.ko-panel-brands {\n  border: 1px solid #e4e4e7;\n  border-radius: 10px;\n  padding: 8px 11px;\n  margin-bottom: 10px;\n  max-height: 176px;\n  overflow-y: auto;\n}\n\n.ko-panel-brands .ko-panel-label {\n  margin-bottom: 2px;\n}\n\n.ko-brand-row {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  height: 26px;\n  font-size: 12px;\n  color: #18181b;\n}\n\n.ko-brand-dot {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--ko-tint, #71717a);\n  flex-shrink: 0;\n}\n\n.ko-brand-name {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.ko-brand-count {\n  font-size: 11px;\n  color: #71717a;\n  font-variant-numeric: tabular-nums;\n}\n\n.ko-brand-trust {\n  display: flex;\n  padding: 3px;\n  border: 0;\n  border-radius: 5px;\n  background: none;\n  color: #71717a;\n  cursor: pointer;\n}\n\n.ko-brand-trust:hover {\n  background: #f4f4f5;\n  color: #047857;\n}\n\n.ko-brand-trust svg {\n  width: 13px;\n  height: 13px;\n}\n\n.ko-brand-more {\n  padding-top: 3px;\n  font-size: 11px;\n  color: #a1a1aa;\n}\n\n#ko-panel.ko-panel-off .ko-panel-stats,\n#ko-panel.ko-panel-off .ko-panel-card {\n  opacity: 0.45;\n  pointer-events: none;\n}\n\n.ko-panel-rule {\n  height: 1px;\n  background: #e4e4e7;\n  margin: 11px -11px;\n}\n\n.ko-panel-label {\n  margin-bottom: 6px;\n  font-size: 11px;\n  font-weight: 500;\n  color: #71717a;\n}\n\n.ko-seg {\n  display: flex;\n  gap: 2px;\n  padding: 2px;\n  border-radius: 8px;\n  background: #f4f4f5;\n}\n\n.ko-seg button {\n  flex: 1;\n  height: 25px;\n  border: 1px solid transparent;\n  border-radius: 6px;\n  background: transparent;\n  font: 450 12px/1 -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n  letter-spacing: 0;\n  color: #71717a;\n  cursor: pointer;\n}\n\n.ko-seg button:hover {\n  color: #18181b;\n}\n\n.ko-seg button.ko-seg-active {\n  background: #fff;\n  border-color: #e4e4e7;\n  color: #18181b;\n  font-weight: 500;\n  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);\n}\n\n.ko-panel-hint {\n  margin: 7px 1px 0;\n  font-size: 11px;\n  line-height: 1.45;\n  color: #71717a;\n}\n\n/* Hide-sponsored toggle: label left, switch right. Same register as the\n   header master switch, sharing .ko-switch. */\n.ko-panel-toggle {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  cursor: pointer;\n}\n\n.ko-panel-toggle-label {\n  font-size: 12px;\n  font-weight: 500;\n  color: #18181b;\n}\n\n.ko-panel-foot {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 0 2px;\n}\n\n.ko-panel-link {\n  border: 0;\n  background: none;\n  padding: 4px 6px;\n  margin-left: -6px;\n  border-radius: 6px;\n  font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n  color: #52525b;\n  cursor: pointer;\n}\n\n.ko-panel-link:hover {\n  color: #18181b;\n  background: #f4f4f5;\n}\n\n.ko-panel-version {\n  font-size: 10.5px;\n  color: #a1a1aa;\n  font-variant-numeric: tabular-nums;\n}\n\n.ko-switch {\n  position: relative;\n  width: 36px;\n  height: 21px;\n  flex-shrink: 0;\n  display: inline-block;\n}\n\n.ko-switch input {\n  opacity: 0;\n  width: 0;\n  height: 0;\n  position: absolute;\n}\n\n.ko-switch-slider {\n  position: absolute;\n  inset: 0;\n  border-radius: 999px;\n  background: #e4e4e7;\n  transition: background 0.15s;\n  cursor: pointer;\n}\n\n.ko-switch-slider::before {\n  content: \"\";\n  position: absolute;\n  top: 2px;\n  left: 2px;\n  width: 17px;\n  height: 17px;\n  border-radius: 50%;\n  background: #fff;\n  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);\n  transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);\n}\n\n.ko-switch input:checked + .ko-switch-slider {\n  background: #059669;\n}\n\n.ko-switch input:checked + .ko-switch-slider::before {\n  transform: translateX(15px);\n}\n\n/* ── Floating count pill ────────────────────────────────────────────────── */\n\n#ko-pill {\n  position: fixed;\n  right: 18px;\n  bottom: 18px;\n  z-index: 2147483646;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  padding: 8px 14px 8px 11px;\n  border: 0;\n  border-radius: 999px;\n  background: #18181b;\n  color: #fafafa;\n  font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n  letter-spacing: 0;\n  cursor: pointer;\n  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);\n}\n\n#ko-pill:hover {\n  background: #27272a;\n}\n\n#ko-pill svg {\n  width: 12px;\n  height: 12px;\n  color: #a1a1aa;\n}\n\n#ko-pill b {\n  display: inline-block;\n  font-weight: 600;\n  font-variant-numeric: tabular-nums;\n}\n\n/* the count springs when it climbs */\n@media (prefers-reduced-motion: no-preference) {\n  #ko-pill b.ko-tick {\n    animation: ko-tick 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.4);\n  }\n}\n\n@keyframes ko-tick {\n  0%   { transform: scale(1); }\n  40%  { transform: scale(1.3); }\n  100% { transform: scale(1); }\n}\n\n#ko-pill i {\n  font-style: normal;\n  color: #a1a1aa;\n}\n";
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

// ── data/community-brands.js ──────────────────────────────────────────────────

// Knockoff — bundled snapshot of the curated community allowlist (3798 brands).
// Generated by scripts/update-bundled-brands.sh — do not edit by hand.
// Originally seeded from https://github.com/chris-mosley/AmazonBrandFilterList
// (MIT License, Copyright (c) 2023 Chris Mosley).
var KO_COMMUNITY_BRANDS = ["13 Fishing", "1st Gen", "1st Phorm", "3-IN-ONE", "303 Products", "360 Electrical", "365 Everyday Value", "365 by Whole Foods Market", "3D", "3M", "4711", "4C", "5.11", "5.11 Tactical", "5th Element", "686", "6th Sense", "7UP", "8Bitdo", "A LA MAISON", "A&R", "A-Premium", "A-Tech", "A. Lange & Sohne", "AC Infinity", "ACC Crappie", "ACDelco", "ACEBEAM", "AEG", "AEROPOSTALE", "AFMAT", "AG", "AG Adriano Goldschmied", "AG Jeans", "AGV", "AINOPE", "AIRCAT", "AJC", "AK Interactive", "AKG", "ALLMAX", "ALPHA LION", "AMD", "AN PERFORMANCE", "ANEX", "ANGCURE", "ANOVA", "AOC", "APA", "APC", "ARCTIC", "ARIAT", "AROMA®", "ASICS", "ASRock", "ASRock Rack", "ASUS", "ATN", "ATTITUDE", "AVM", "AVON", "AWF PRO", "AXE", "AZdelivery", "Abercrombie & Fitch", "Abu Garcia", "Abus", "Accelera", "Accu Cull", "Accu-Shot", "Accusize Industrial Tools", "Acer", "Acme", "Acme Tackle", "Acqua Panna", "Adam & Eve", "Adam's", "Adam's Polishes", "Adata", "Adiva Intimates", "Advanced Clinicals", "Advil", "Aero", "AeroJig", "Aeropress", "Aeroxon", "Aervoe", "Affresh", "Aftco", "Ahi", "Ahi USA", "Airheads", "Airome", "Airomé", "Airplus", "Airpura", "Airwalk", "Airwaves", "Akademiks", "Akk", "Akona", "Alani Nu", "Alba Botanica", "Albanese", "Aleve", "Alex Mill", "Alexander Del Rossa", "Alienware", "All Terrain", "All-Clad", "Allegra", "Allen Company", "Aller-Ease", "Allstar Innovations", "Almay", "Alo", "Alo Yoga", "Aloe Cadabra", "Alphacool", "Alpina", "Alpine", "Alpine Industries", "Alpine Swiss", "Alpinestars", "Alvera", "Alvin's Cables", "Always", "Always Discreet", "AmLactin", "Amana", "Amarine Made", "Amazfit", "Amazing Abby", "Amazing Grass", "Amazon Basic Care", "Amazon Basics", "Amazon Echo", "Amazon Elements", "Amazon Essentials", "Amazon Fire", "Amazon Fresh", "Amazon.com", "AmazonCommercial", "Ambi", "AmbiEscents", "Amco", "Amdro", "American Apparel", "American Baitworks", "American Crew", "American Eagle", "American Standard", "Americanflat", "Amerock", "Amoretti", "Amphenol", "Anchor Hocking", "Anderson Power", "Andrew Marc", "Angel Soft", "Angelus", "Angler's Choice", "Animal", "Anker", "Ankerkraut", "Anne Klein", "Anon", "Ansmann", "Antarctic Star", "Antec", "Anthony's", "Anti Social Social Club", "Antigravity Batteries", "Anycubic", "Apeks", "Apex", "Apple", "Apple Barrel", "Aqua-Vu", "AquaSonic", "Aquacomputer", "Aquaphor", "Aquasana", "Aquatec", "AquatekO", "Arai", "Arbogast", "Arc'teryx", "ArcMate", "Arctic Zone", "Arctix", "Ardent", "Ariel", "Arizona", "Arlo", "Arm & Hammer", "Armaf", "Armasight", "Armor All", "Armstong", "Aroma Housewares", "Arrid", "Arrow", "Arsenal", "Arus", "Ascend", "Ascent", "Astro", "Astro Pneumatic Tool", "Astro Tools", "AstroAI", "Astroglide", "Athlon Optics", "Atlantic Safety Products", "Atlas", "Atlas Mike's", "Atomic", "Attwood", "Atwood", "Audemars Piguet", "Audi", "Audio-Technica", "Audioengine", "Aune", "Aurifil", "Auromere", "Aurora", "Aus Vio", "Austin Air", "Australian Botanical Soap", "Autel", "Auto Finesse", "Auto Parts Avenue", "Autofiber", "Aveeno", "Aveeno Baby", "Avid Angler Solution", "Azzaro", "Azzy's", "B&W Trailer Hitches", "BALLISTOL", "BAOFENG", "BASF", "BBQ Butler", "BCBGMAXAZRIA", "BENNING", "BFGoodrich", "BIC", "BIOPURE", "BKK", "BKK Hooks", "BLACKLABEL Supplements", "BLACKSTONE", "BLUETTI", "BODYARMOR", "BOSCH", "BOSS", "BRINKS", "BSN", "BUG-A-SALT", "BUM Energy", "BUNN", "BURG-WÄCHTER", "BUZZPATCH", "BVLGARI", "BYOMA", "Babish", "BabyGanics", "Bad Birdie", "Badia", "Bahco", "Bait Buttons", "Bait-Pop", "BaitFuel", "Bajio", "Baldwin", "Bale Tuff", "Balega", "Ballard Products", "BallcapBuddy", "Balzout", "Bandit", "Bandit Lures", "Bandolino", "Bang & Olufsen", "Banjo Minnow", "Bar Keeper", "Bar Keepers Friend", "Baratza", "Barbie", "Bare Performance Nutrition", "Barebells", "Barkbone", "Barkbox", "Barrow", "Barska", "Baseus", "Bass Assassin", "Bass Boat Saver", "Bass Mafia", "Bass Medics", "BassReaper Baits", "Basstrix", "Bath & Body Works", "Battery Tender", "Battlestar", "Battlestar Tackle Co", "Bauker", "Bauknecht", "Baume & Mercier", "Baume et Mercier", "Bay de Noc", "Bayer", "Bayou Rattler", "Bazooka Candy Brands", "Bear Balanced", "Bear Paws", "Beast Bites", "Beast Coast Fishing", "BeatDown Outdoors", "Beats", "Beau Mac", "Beauty Power", "BeaverCraft", "Bebe", "Beck/Arnley", "Beckham", "Beckman", "Bed Head", "Bedsure", "Bee Naturals", "Beekman", "Behringer", "Beierdorf", "Beko", "Belk", "Belkin", "Bell", "Bell+Howell", "Bellroy", "Ben Sherman", "Ben's", "BenQ", "BenchPro", "Benchmade", "Benebone", "Beneful", "Benevolence LA", "Bentgo", "Beretta", "Berghaus", "Bergson", "Berkey", "Berkley", "Bernard", "Bessey", "Best Lock", "Best Pet Supplies", "Better Homes and Gardens", "BetterHomes&Gardens", "Betty Crocker", "Beurer", "Beverly Hills Polo Club", "Beyerdynamic", "Beyond Braid", "Beyond Gourmet", "Bialetti", "Bickmore", "Big Bite Baits", "Big Cock Ranch", "Big Hammer", "Big Train", "Bigelow Tea", "Bikehand", "Bill Lewis", "Billabong", "Billie", "Biltwell", "Bingfu", "BioAdvanced", "BioKleen", "BioLite", "Biobizz", "Bioenno Power", "Biolage", "Biostar", "Biotherm", "BirdRock Home", "Birkenstock", "Biscoff", "Bissell", "Biwaa", "Black Bart", "Black Diamond", "Black Diamond Stoneworks", "Black Flag", "Black Wolf", "Black+Decker", "Blackhawk", "Blackwing", "Blakemore", "Blancpain", "Blendtec", "Blenko", "Blind Barber", "Blink", "Bliss Kiss", "Blistex", "Blitz", "Bloom Nutrition", "Bloomingville", "Blue Buffalo", "Blue Diamond", "Blue Fox", "Blue Ridge", "Blue Rose Pottery", "Blue Sea Systems", "BlueSea", "Blueair", "Bluestorm", "Blum", "Blumat", "BnR", "Boat Bling", "Boat Buckle", "Boat Drip", "Boat Juice", "Boatlife", "Bob's Machine", "Bob's Machine Shop", "Bob's Red Mill", "Bobby Garland", "Boca Bearings", "BodiLove", "Bodum", "Body Fortress", "Body Glove", "BodyBio", "BodyTech", "BodyTech Elite", "Bodyprox", "BogaGrip", "Bogey Bros", "Boka", "Bomann", "Bomber Lures", "Bona Professional", "Bonavita", "Boncare", "Bonehead Tackle", "Bonne Maman", "Boogerman Buzzbaits", "Boomerang Tool Company", "Boonedox", "Boot Bananas", "Booyah", "Bormioli", "Bormioli Rocco", "Bosch Automotive", "Bosche", "Bose", "Boss Office Products", "Bostik", "Bostitch", "Boston International", "Bosu", "Boucheron", "Bounce", "Bounty", "Boveda", "Bowers & Wilkins", "Bowflex", "Brach's", "Brad's", "Branch", "Braun", "Brawny", "Brecknell", "Breitling", "Brembo", "Brequet", "Bresser", "Breville", "Brickell", "Brickell Men's Products", "Bridgestone", "Briggs & Stratton", "Bright Way Group", "Brightech", "Brightown", "Brio", "Brita", "Brixton", "Brondell", "Brooklinen", "Brooks", "Brooks Brothers", "Brother", "Browning", "Brunnen", "Bruno Marc", "Bryton", "BrüMate", "Brüder Mannesmann", "Bubba", "Bucca Brand", "Buck Knives", "Bucked Up", "Buckeye Lures", "Buddy Biscuits", "Buddy Wash", "Buff", "Bug Soother", "BugMD", "Buggins", "Built", "BulkSupplements.com", "Bull Bay Rods", "Bullet Weights", "Bulova", "Burberry", "Burlap & Barrel", "Burris", "Burt's Bees", "Burton", "Bushnell", "Bussmann", "Butter Buds", "Butterfinger", "Buzbe", "Buzzbait", "BuzzerRocks", "ByronStatics", "Byski", "BÖKER PLUS", "Büchel", "C-MAP", "C.C", "C.C Beanie", "C2G", "C4", "CAMPLUX ENJOY OUTDOOR LIFE", "CANADA WEATHER GEAR", "CANAWELD", "CAP Barbell", "CAPiTA", "CAROTE", "CARPRO", "CASETiFY", "CAT", "CATEYE", "CELSIUS", "CIVIVI", "CLEARALIF", "CMP", "COROS", "COSORI", "COSRX", "COUNTRY TIME", "COVERGIRL", "CRC", "CRKT", "CS Coatings", "CST/berger", "CUTTER & BUCK", "Cabela's", "Cable Matters", "CableCreation", "CableMod", "Cablz", "Caboodles", "Cadet", "Café", "Cake", "Cal Coast", "CalDigit", "Caldwell", "Califia Farms", "Califone", "California Design Den", "California Exotic Novelties", "Callaway", "Calphalon", "Calvin Klein", "Camay", "Cambridge Audio", "Camco", "Camelbak", "Campbell", "Campbell Hausfeld", "Camplux", "Candle Warmers", "Candle-lite", "Canon", "Canson", "Caperlan", "Capresso", "Caraway", "Carefree", "Caress", "Carhartt", "Cariloha", "Carlinkit", "Carnation Breakfast Essentials", "Carolina Herrera", "Cartier", "Casabrews", "Cascade", "Cascadian Farm", "Case Logic", "Caseology", "Cashion", "Casio", "Caspari", "Casper", "Castaic", "Castaway Rods", "Castrol", "Caswell-Massey", "Catch Co.", "Caution Wear", "Cecotec", "Cedercide", "Celestron", "Cellucor", "Celtic Sea Salt", "CeraVe", "Certain Dri", "Certina", "Cesar", "Cetaphil", "Chair Master", "Champion", "Champion Chamois", "Chanel", "Channel Well", "Channellock", "ChapStick", "Chapman", "Char-Broil", "Charlie's Soap", "Charmin", "Chasebaits", "Chaumet", "Cheerios", "Cheetos", "Chef Craft", "Chef'n", "Chefman", "Chef’s Choice", "Chemex", "Chemlink", "Cherry", "Chesapeake Bay Candle", "Chew King", "Chex", "Chicago Metallic", "Chicago Pneumatic", "Children's Factory", "Chobani", "Chocolove", "Chompers", "Chrysler", "Chubbies", "Chubbies Shorts", "ChubbyCable", "Chuckit!", "Chupa Chups", "Chéri Bliss", "Cinnamon Toast Crunch", "Circulon", "Cisco", "Citizen", "Clairefontaine", "Clarks", "Clatronic", "Clatronik", "Cleco", "Clementoni", "Cleveland Golf", "CleverMade", "Clif Bar", "Cliff Outdoors", "Cliganic", "Clinere", "Clinique", "Cloralen", "CloroxPro", "Coach", "Coast", "Coats", "Coats & Clark", "Cobra", "Cocoons", "Coghlan's", "Cold Steel", "Cole & Mason", "Cole Haan", "Cole National", "Coleman", "Colonial Candle", "Colorfast Industries", "Columbia", "Columbia Sportswear", "Combat", "Comeon", "Comet", "Comfort Colors", "Command", "Compo", "Conair", "Condor", "Connecting Threads", "Contigo", "Continental", "Converse", "Coolbaits", "Cooler Master", "Coop Home Goods", "Cooper", "Copco", "Copper Fit", "Coral", "Core Power", "Core Tackle", "Corelle", "Corkcicle", "Corning", "Corning Ware", "Corsair", "Cortland", "Cosclay", "Costa Del Mar", "Cotton Cordell", "Cottonelle", "Coway", "Craft", "Craft & Kin", "Craftsman", "Craig", "Craig Frames", "Crankbrothers", "Crappie Magnet", "Crate 61 Organics", "Crayola", "Cream of Wheat", "Create", "Createx", "Creative", "Creative Co-Op", "Creative Mark", "Credor", "Cree", "Cree Lighting", "Creek Chub", "Creme", "Creme Lures", "Cremo", "Crescent", "Cressi", "Cretacolor", "Cricut", "Crock Pot", "Crocs", "Crofters", "Cross", "Crucial", "Crush", "Crystal Essence", "Crystal Light", "Cuda", "Cuisinart", "Cullen", "Culligan", "Culprit", "Culprit Surf", "Curaprox", "Curel", "Curve", "Curver", "Cush It", "Custom Shop", "Cutter", "CyberPower", "D-Link", "DALI", "DAP", "DASH", "DAVIDOFF", "DC", "DD26 Fishing", "DELTA FAUCET", "DEPSTECH", "DICTUM", "DII", "DJI", "DKNY", "DNA Motoring", "DOA", "DOME GLASS", "DOTCO", "DOVE MEN + CARE", "DRYGUY", "DU-BRO", "DURATECH", "DYMO", "DYNAFIT", "DYNAFLEX 230", "Daiichi", "Daisy", "Daiwa", "Dakine", "Dakota Lithium", "Damiki", "Dan-O's", "Danby", "Danco", "Danielson", "Danley", "Darn Tough", "David Beckham", "David Protein", "Davis Baits", "Dawn", "Daylite", "De Buyer", "De'Longhi", "DeLallo", "DeWalt", "Dean Jacob's", "Dearfoams", "Death Wish Coffee", "Deathgrip", "Debrox", "DecoArt", "Decoy", "DeepCool", "Deer Valley", "Degree", "Degree Men", "Dehner", "Dell", "Delong Lures", "Delphi", "Delta", "Demeyere", "Demon", "Demon United", "DenTek", "Denali", "Denon", "Denso", "Departure Outdoors", "Depend", "Deps", "Der8auer", "Desert Essence", "Design Engineering", "Design Master", "Detail Dudes", "Detail Factory", "Deuter", "Deutsch", "Devolo", "Devon", "Dexter", "Dexter Russell", "Diablo", "Dial", "Dickies", "Diesel", "Digilent", "Digitus", "Dior", "Dirt Devil", "Dirty Jigs", "Diurex", "Diversey", "Divinus Lab", "Dixie", "Dixon", "Do it", "Dobyns Rods", "Doc's Diesel", "Dock D-Fender", "Dockers", "Dolce & Gabbana", "Dole", "Dolphin Tackle", "Dometic", "Don Aslett", "Donna Karan", "Dooney & Bourke", "Dooney and Bourke", "Dorcy", "Doritos", "Dorman", "Dove", "Dow Corning", "Dr Pepper", "Dr Teal's", "Dr. Beasley's", "Dr. Beckmann", "Dr. Bronner's", "Dr. Elsey's", "Dr. Hauschka Skin Care", "Dr. Neuhaus", "Dr. Oetker", "Dr. Scholl's", "Dr. Scholl's Shoes", "Dr. Slick", "Dr. Squatch", "Dr. Woods", "DrTung's", "Drake", "Drake Waterfowl", "Drano", "Dreame", "Dreamies", "Dreft", "Dremel", "Dreo", "Dritz", "Drop Zone Tackle", "Dry Creek", "Dry Idea", "Dräger", "Dual Electronics", "Dubinik", "Duck", "Duck Commander", "Duckett Fishing", "Dude", "Dude Wipes", "Duel", "Duke", "Duke Cannon", "Duke Cannon Supply Co.", "Dunhill", "Dunlop", "Duo", "Duo Realis", "Duo-Fast", "Dupli-Color", "Duracell", "Duralex", "Durasafe", "Durex", "Dymatize", "Dynamat", "Dynamic Wax", "Dynamo", "Dyson", "EBL", "ECOFLOW", "ECOGARD", "ECOS", "ECOXGEAR", "ED HARDY", "EF ECOFLOW", "EGIS", "EHP Labs", "EKWB", "ELTEN", "EO", "EPOMAKER", "ESR", "EUREKA", "EVEREST", "EVGA", "EVL", "EVOLV", "EZ-POUR", "EZ-Sweetz", "EZE-LAP", "EZY DOSE", "Each & Every", "Eagle", "Eagle Claw", "Eargasm", "Earth Rated", "Easton", "Eastpak", "Eastwood", "Eberhard Faber", "Eberlestock", "Ebros Gift", "Echo", "Eco Pro Tungsten", "Eco-Dent", "EcoWise", "Ecolab", "Ecover", "Eddie Bauer", "Edifier", "Edward Tools", "Ego Power+", "Eichhorn", "Einhell", "Elecbee", "Element", "Elgato", "Elite Gourmet", "Eliza J", "Ello", "Elmer's", "Emergen-C", "Emeril Lagasse", "Emerson", "Empava", "Empire", "Emsa", "Emsco Group", "EnGenius", "Enbrighten", "Endura", "Energizer", "Engelbert Strauss", "Enrico Puglisi", "Epoch Batteries", "Eppendorf", "Epson", "Equate", "Erem", "Ergodyne", "Ernst", "Ernst Manufacturing", "Escort", "Essie", "Estwing", "Etekcity", "Ethos", "Ethos Handcrafted Car Care", "Ettore", "Eubos", "Eucerin", "Eurotackle", "Eurow", "Euthymol", "Eve", "EverBrite", "Eveready", "Everest Media Solutions", "Everflo", "Evergreen", "Everlast", "Every Man Jack", "Everyone", "EvoShield", "Evolution", "Evolution Fishing", "Exacompta", "Excel Blades", "Expo", "Extech", "F. P. JOURNE", "FEIN", "FIFTY-FIFTY", "FIJI", "FINAL", "FLYDIGI", "FOCO", "FOOTMATTERS", "FOXBC", "FREE SOLDIER", "FRITZ", "FROGTAPE", "FSA", "FSP", "FXR", "FXR Pro Fish", "Fab", "Faber-Castell", "Fabuloso", "Fackelmann", "Falcon", "Falken", "Fantastik", "Fanttik", "Faraday Defense", "Farberware", "Fast Wax", "Fatmat", "Favorite", "Favorite Fishing", "Febreze", "Feethit", "Feit Electric", "Fel-Pro", "Felix", "Fellow", "Fender", "Fenix", "Fenwick", "Ferrero", "Ferrero Rocher", "Festool", "Fiber One", "Fida", "FiiO", "Fila", "Fimo", "Fin Gear", "Finch + Fennel", "Finish", "Firefly", "First Alert", "Fischer", "Fish Arrow", "Fish Monkey", "Fish Sticks", "Fish-n-Map", "Fisher Space Pen", "Fisher-Price", "Fisherman Sidekick", "Fishing Hot Spots", "Fishlab", "Fishpond", "Fiskars", "Fissler", "FitVille", "Fitbit", "Fitz & Floyd", "Fitz and Floyd", "Fitzgerald", "Fjallraven", "Fjällräven", "Flambeau", "Flame King", "Flash Furniture", "Flatiron Spice", "Flex", "Flex Seal", "Flex Shot", "Flexible Flyer", "FlipKlip", "Flojet", "Flowtron", "Fluff & Tuff", "Fluke", "Fly Racing", "Flying Fisherman", "Flymo", "Foam King", "Focal", "Folgers", "Folia", "FolkArt", "FoodSaver", "Force Factor", "ForceField", "Ford", "Forever 21", "Formula 409", "Formulamod", "Forney", "Fortessa", "Fosi Audio", "Fossil", "Fowler", "Fox Racing", "Fox Run", "Fox Trot", "Frabill", "Fractal Design", "Fram", "Frame Amo", "Franklin Brass", "Franklin Sports", "Franzis", "Frederique Constant", "Free People", "FreshJax", "FreshPet", "Freud", "Frida Baby", "Frigidaire", "Fringe", "Fringe Studio", "Frito Lay", "Frog Factory", "Frogg Toggs", "Fromm", "Fromm International", "Frontier Co-op", "Froot Loops", "Frost King", "Fruity PEBBLES", "Frye", "Fuji", "Fujifilm", "Fujinon", "Fujitsu", "Full Speed Ahead", "Fulling MIll", "Fulton", "Funko", "Furrion", "G Skill", "G-Force", "G-Force Racing Gear", "G-III Sports", "G-Ratt", "G-Ratt Baits", "G-nius Project", "G. Loomis", "G.H. Bass", "G.H. Bass & Co", "G7", "GAP", "GAT SPORT", "GCI Outdoor", "GE", "GE PROFILE", "GEARWRENCH", "GEDORE", "GERBER", "GERmanikure", "GHOST", "GHome Smart", "GILDEN TREE", "GIORGIO ARMANI", "GIRO", "GL.iNet", "GLIDE", "GLYDE", "GM", "GOLDEN", "GOLDTOE", "GONSO", "GPO", "GPX", "GRACE KARIN", "GREASE MONKEY", "GROHE", "GUESS", "GYS", "Gaggia", "Gaiam", "Gain", "Gainful", "Galanz", "Gamakatsu", "Gambler Lures", "GameSir", "Gamma2", "Gan Craft", "Garden of Life", "Gardena", "Gardner Bender", "Garmin", "Garnier", "Gary Yamamoto", "Gasoila", "Gator Grip", "Gator Guards", "Gator Patch", "Gatorade", "GearIT", "Geecrack", "Geekworm", "Gene Larew", "General Mills", "General Motors", "General Pencil Company", "Gentex", "Gentle Souls", "Genuine Fred", "Geocel", "Georgia-Pacific", "Geox", "Gerber Gear", "GermGuardian", "German Precision Optics", "Gevi", "Gevi Household", "Ghirardelli", "Gibson Home", "Giftable World", "Gigabyte", "Gildan", "Gill", "Gillette", "Girard Perregaux", "Gitzit", "Givenchy", "Gizeh", "Gizmo Dorks", "Glacier Glove", "Glad", "Glade", "Gladiator", "Gliss", "Glisten", "Globe Electric", "Glock", "Gloria", "Glorious", "Glorious PC Gaming Race", "Gloveworks", "GoPro", "Gold BJJ", "Gold Bond", "Gomexus", "Goo Gone", "Good Clean Love", "Good Cook", "Goodyear", "Googan", "Google", "Gordini", "Gore Wear", "Gorenje", "Gorilant", "Gorilla", "Gorilla Grip", "Got2b", "Gotham Steel", "Gourmanity", "Gourmia", "Govee", "Grand Seiko", "GrandeBass", "Granite Gold", "Granitestone", "Grave Before Shave", "Gravity Defyer", "Great Grains", "Great Lakes Finesse", "Great Stuff", "Great Value", "Greater Goods", "GreenPan", "Greenception", "Greenies", "Greenlite", "Greens Steel", "Greenworks", "Greg Norman", "Greys", "Grin", "Griot's Garage", "Grizzly Industrial", "Grundens", "Grundéns", "Gruv", "Gtechniq", "Gucci", "Guilford of Maine", "GuliKit", "Gum", "Gun Craft", "GuruNanda", "Gustus Vitae", "Gutermann", "Guy Laroche", "Gyeon", "Gütermann", "H&H", "HADEN", "HANKOOK", "HARRIS", "HART SCHAFFNER MARX", "HAWAIIAN PUNCH", "HERMA", "HERSHEY'S", "HESTRA", "HI-SEAS", "HIC Kitchen", "HIFIMAN", "HIKOKI", "HJC", "HKP", "HOKA", "HOKA ONE ONE", "HON", "HORI", "HOT SHOT", "HP", "HTC", "HUGGIES", "HUGO BOSS", "HYTE", "HYUNDAI", "Haba", "Hacksaw", "Haflinger", "Hag's Baits", "Haggar", "Haier", "Hairitage", "Hakko", "Hakle", "Halberd", "Halco", "Hallmark", "Halo", "Halo Fishing", "Halston", "Hama", "Hamilton", "Hamilton Beach", "Hamilton Buhl", "HammerHead Showers", "Hammermill", "Handmade Heroes", "Hanes", "Hansaplast", "Hansgrohe", "Hantek", "Happy Belly", "HappyNorwegian", "Harbinger", "Hardcore", "Hardy", "Hareline", "Haribo", "Harman Kardon", "Harmony Fishing", "Harney & Sons", "Harry Winston", "Harry's", "Hart", "Hartz", "Hasbro", "Haute Diggity Dog", "Hawke", "Hayabusa", "Hayward", "Hazet", "HeadHunter", "Headbanger", "Healing Solutions", "Heat Storm", "Heddon", "Hefty", "Heinz", "Heitmann", "Helimix", "Hello Bello", "Helly Hansen", "Hempz", "Henckels", "Henderson", "Hengst", "Henkel", "Henry", "Henson Shaving", "Herb Guard", "Herbal Essences", "Herlitz", "Herman Miller", "Herschel", "Hertel", "Herve Leger", "Hewlett Packard", "HexClad", "Hey Dude", "HiKOKIPowerToolsDeutschland", "Hibbent", "Hickey Freeman", "Hickory Hardware", "Hideup", "High Peak", "High Sierra", "Hikenture", "Hiketron", "Hildebrandt", "Hill's Prescription Diet", "Hill's Science Diet", "Hillman", "Hiltex", "Hilti", "Himalaya", "Hipp", "Hisense", "Hobart", "Hobie", "Hoffritz", "Hog Farmer", "Hoist", "Holikme", "Hollis", "Hollister", "Hollow", "Holstein Housewares", "Homax", "Home Basics", "Homelite", "Honda", "Honest Amish", "Honey-Can-Do", "Honeywell", "Hook up", "Hoosier", "Hoover", "Hopkins", "Hot Topic", "HotHands", "Hotel Spa", "House of Kolor", "Household Essentials", "Huawei", "Hublot", "Huddleston Deluxe", "Huffy", "HuggleHounds", "Hugo", "Huion", "Huk", "Hum Dinger", "Humminbird", "Hunter", "Hurley", "HushMat", "Husky", "Husqvarna", "Huxley & Kent", "Hybrid", "Hyde", "Hydro Flask", "HydroJug", "Hydrotools", "Hydrowave", "HyperPet", "HyperX", "ID Lubricants", "ID-COOLING", "IDEAL", "IDEAL Electrical", "IDEAL Industries", "IGOSKI", "ILLUME", "ILM", "INABA", "INBUS", "INIU", "INSIGNIA", "INSL-X", "ION", "IRIS USA", "IRON °FLASK", "IRWIN", "IVY Classic", "IWISS", "IZOD", "Iams", "Ice Breakers", "Icebreaker", "Ichikawa", "IchikawaFishing", "Igloo", "Illinois Glove Company", "Image Wash Products", "Imakatsu", "Imarku", "Impresan", "Indigo Wild", "Industry Nine", "Ingersoll Rand", "Inland", "Inspired Nutraceuticals", "Insta360", "Instant", "Instant Pot", "Integrix", "Intel", "Intellinet", "International Silver", "Intex", "Invisible Glass", "Irish Spring", "Ironclad", "Island Optics", "Isopure", "Isotoner", "It's Just!", "Ivory", "Iwata", "Izorline", "J-B Weld", "J.R. Watkins", "JASON", "JBL", "JCPenney", "JENSEN", "JIMMY CHOO", "JLab", "JOCKO FUEL", "JOKARI", "JONATHAN Y", "JOOLA", "JOYCA & CO.", "JSAUX", "JW", "JW Pet", "JYM", "Jabra", "Jabsco", "Jack Link's", "Jack Wolfskin", "Jackall", "Jacked Factory", "Jackery", "Jackpot Candles", "Jackson Safety", "Jacobs", "Jacobs Chuck", "Jaeger LeCoultre", "JanSport", "Jell-O", "Jenko", "Jergens", "Jerzees", "Jessica Howard", "Jessica Simpson", "Jet", "Jewel Bait Company", "Jim Beam", "JobSite", "Jobox", "Jocko", "John Deere", "John Paul Mitchell Systems", "Johnny B", "Johnny Slicks", "Johnson", "Johnson & Johnson", "Johnson Pump", "Jolly Pets", "Jolly Rancher", "Jonard Tools", "Jones", "Jones New York", "Jonsered", "Jordan", "Jose Cuervo", "Joseph Joseph", "Jovan", "JoyJolt", "Juicy Couture", "June Moon Spice Company", "Jungle Powders", "Jura", "Justrite", "K&N", "K-9", "K-Edge", "K-Y", "K2", "K9 Fishing", "KAHLES", "KARRICO", "KD Supplies", "KGB", "KILMAT", "KIND", "KIOXIA", "KIRSCHEN", "KLEVV", "KNIPEX", "KOCH-CHEMIE", "KOHLER", "KONG", "KP KOOL PRODUCTS", "KREG", "KROIL", "KRUPS", "KUTSUWA", "KVD", "KVD Line & Lure", "KVD Line and Lure", "KYOCERA", "KabelDirekt", "Kaboom", "Kaged", "Kakuri", "Kalin's", "Kamenstein", "Kangol", "Karl Lagerfeld", "Karl Lagerfeld Paris", "Kasa Smart", "KastKing", "KasumiDesign", "Kate Spade New York", "Kate and Laurel", "Keebler", "KeepDry", "Keitech", "Kellogg's", "Kenetrek", "Kenmore", "Kenneth Cole", "Kensington", "Kenwood", "Keoker", "Kershaw", "Kester", "Ketch", "Keter", "Ketone-IQ", "Kettle Brand", "Keurig", "Keychron", "Kibbles 'n Bits", "Kick'n Bass", "Kimberly Clark", "Kinco", "Kinder Bueno", "King Koil", "King Size", "King of Christmas", "Kingfisher Fly Fishing", "Kingsford", "Kingston", "Kipling", "Kirk's", "Kirkland", "Kirkland Signature", "Kit Kat", "Kitchenaid", "Kitsch", "Kix", "Kizmos", "Klass Aguas Frescas", "Kleenex", "Klein", "Klein Tools", "Klipsch", "Knauf", "Kneipp", "Koala Lifestyle", "Kobalt", "Kobo", "Kodak", "Kodiak Cakes", "Kohree", "Koken", "Kokett", "Kool-Aid", "Koolance", "Kopari", "Korkers", "Kosmos", "Koss", "Kowa", "Kraft", "Kraus", "Kress", "Krud Kutter", "Krylon", "Kryptonite", "Kumho", "Kurt S. Adler", "Kwikset", "Kärcher", "L'Occitane", "L'Oreal Paris", "L'Oréal", "L.", "L.L. Bean", "LANEIGE", "LANON Protection", "LATCH.IT", "LAURA GELLER NEW YORK", "LD Products", "LEGIT DESIGN", "LEM", "LEM Products", "LEONIS", "LEUCHTTURM1917", "LEVOIT", "LEXUS", "LEZYNE", "LG", "LINDY", "LINOVISION", "LIVE TARGET", "LIZ CLAIBORNE", "LOLA", "LONDON FOG", "LOVEVOOK", "LS2", "LTRA", "LU", "LUBELAB", "LUBILICIOUS PERSONAL WATER BASED LUBRICANT", "LUCAS", "LUXRITE", "La Fresh", "La Jolie Muse", "La Pavoni", "La Roche-Posay", "La Rochere", "La-Z-Boy", "LaCrosse", "Labrada Nutrition", "Lacoste", "Lactaid", "Lacura", "Ladder-Max", "Lady Speed Stick", "Laffy Taffy", "Lagunamoon", "Lake Fork", "Lakewood", "Lamiglas", "Lamy", "Lancom", "Lancôme", "Land Rover", "Lands End", "Lange & Söhne", "Lasko", "Laticrete", "Laura Ashley", "Laura Davidson Furniture", "Lavazza", "Lawrence Frames", "Lawry's", "Le Blanc", "Le Creuset", "LeCroy", "Leapers", "Leather Honey", "Leatherman", "Leatt", "Ledlenser", "Lee", "Legendary Whitetails", "Legion", "Lego", "Leica", "Leifheit", "Leina", "Leitz", "Leland's Lures", "Lenor", "Lenovo", "Lenox", "Lethal Weapon", "Leupold", "Level", "Levelok", "Lever 2000", "Levi Strauss", "Levi's", "Leviton", "Lew's", "Lexar", "Lexivon", "Lexmark", "Lexol", "LiCB", "Lian Li", "Lian Lian", "Libbey", "Librett Durables", "Liebert", "Life", "Life Savers", "LifeStraw", "LifeStyles", "Lifetime Brands Inc.", "Lime-A-Way", "Lincoln Electric", "Lindt", "Line Cutterz", "Linksys", "Linsoul", "Lippert", "Lippert Components", "Lipton", "Liqui Moly", "Liquid Death", "Liquid Mayhem", "Liquid Nails", "Liquid Rubber", "Liquitex", "Lisle", "Listerine", "Lite-On", "Little Hotties", "Little Joe", "Livingston Lures", "Loaded Gear", "Loc-R-Bar", "Lock & Lock", "LocknLock", "Loctite", "Lodge", "Logilink", "Logitech", "Logitech G", "Longines", "Loon", "Loon Outdoors", "Los Angeles Apparel", "Lotus Biscoff", "Louis Vuitton", "Louisville Ladder", "Loungefly", "Lowrance", "Luber-finer", "Lubriderm", "Lucas Oil", "Luck E Strike", "Lucky Brand", "Lucky Craft", "Lufkin", "Luhr Jensen", "Luigi Bormioli", "Lululemon", "Lume", "Lumify", "Luna", "Luna Sea", "Lunker City", "Lunkerhunt", "Lutron", "Lysol", "Läufer", "Löffler", "M&M", "M&M'S", "M-D Building Products", "MACKENZIE-CHILDS", "MAHLE", "MANNKITCHEN", "MANSCAPED", "MARIPOSA", "MARQUESS", "MARTHA STEWART", "MASTERSON'S CAR CARE", "MATEIN", "MAXWELL HOUSE", "MAYBELLINE", "MCR Safety", "MCTi", "MEAN WELL", "MED PRIDE", "MG Chemicals", "MIDO", "MINIX", "MONTANA", "MOUTHWATCHERS", "MOXIE", "MPD Digital", "MR.SIGA", "MRS. MEYER'S CLEAN DAY", "MSI", "MTD Holdings", "MTN Hardcore Spray Paint", "Maars Drinkware", "Mac Cat", "Mac Tools", "Mach", "Mack's Lure", "Mackie", "Mad Catz", "Made In", "MadeGood", "Madness", "Magbak", "Magid", "Magid Glove & Safety", "Maglite", "Magnavox", "Magpul", "Makita", "Malden", "Mallory", "Malt-O-Meal", "Mama Bear", "Mammoth", "Mammoth Pet Products", "Mammut", "Manhattan", "Mann Filter", "Mann's", "Mannol", "Maple Grove Farms", "Marabu", "Marantz", "Marc Anthony", "Marc Jacobs", "March", "Mares", "Marfix", "Margaritaville", "Maria Nila", "Mario Badescu", "Marmot", "Marquis By Waterford", "Mars", "Mars Hydro", "Marshall", "Maruchan", "Marvel", "Master", "Master Lock", "Master Power", "MasterChef", "Matfer", "Mattel", "Maui Jim", "Mauviel", "Maven", "Max Factor", "Maxell", "Maxima", "McCULLOCH", "McCormick", "McCormick Culinary", "McCormick Gourmet", "McCormick Grill Mates", "McCoy", "McKee's 37", "McKesson", "McKillans", "Mead", "Mechanix Wear", "Mediabridge", "Medion", "Medisana", "Medline", "Megababe", "Megabass", "Megachef", "Megastrike", "Megaware Keelguard", "Meguiar's", "Meiho", "Meister", "Melannco", "Melin", "Melitta", "Member's Mark", "Memphis Glove", "Mend-It", "Mentos", "Meopta", "Mepps", "Meraki", "Mercedes-Benz", "Mercer Culinary", "Mercury", "Merrell", "Merrick", "Merten & Storck", "Meta", "Metabo", "Metabo HPT", "Method", "Michael Jordan", "Michael Kors", "Michel Design Works", "Michelin", "Micro Center", "Micro-Scientific", "Microflex", "Micron", "Microsoft", "Midea", "Midland", "Midwest Can", "Miele", "Mielle Organics", "Mighty Max Battery", "MightyGood", "Mikasa", "Mike’s", "MikroTik", "Milfra", "Milka", "Millennium", "Miller", "Miller Electric", "Millertech", "Milwaukee", "Minn Kota", "Minnetonka", "Minox", "Minus33", "Minwax", "Mio", "Miracase", "Miracle II", "MiracleWipes", "MirrOlure", "Misen", "Missile Baits", "Mission Darkness", "Mister Twister", "Misto", "Mistral", "Mitchell", "Mitchum", "Miti", "Mitutoyo", "Mixxtape", "Mizmo", "Mizuno", "Mobil 1", "Modway", "Moen", "Moffat", "Molex", "Molto", "Mondelez International", "Monoprice", "Monster", "Monster Energy", "Mont Blanc", "Montana Colors", "Montana Fly Company", "Montana Gold", "Montana West", "Mopar", "Mophie", "Morakniv", "Moroccanoil", "Morton", "Morton & Bassett", "Moskinto", "Mosser", "Mosser Glass", "Mossy Oak", "Motherhood Maternity", "Motic", "MotorGuide", "Motorcraft", "Motormate", "Motorola", "Motorola Solutions", "Motsenbocker's Lift Off", "Motul", "Moulinex", "Mountain Fruit Co.", "Mountain Hardwear", "Mozi Wash", "Mr. Christmas", "Mr. Clean", "Mr. Coffee", "Mr. Crappie", "Mr. Heater", "Mr. Pen", "Mrs. MEYER'S", "Muc-Off", "Mueller", "Mueller Austria", "Mueller Living", "Multipet", "Munchkin", "Murphy", "Muscle Milk", "MuscleTech", "Mustad", "Mustang Survival", "Mutt Tools", "MxVol", "My Weigh", "MyGift", "NACON", "NATPAT", "NEMIX RAM", "NETGEAR", "NGK", "NICETOWN", "NINAMAR", "NKT", "NOCO", "NOMAD", "NOTTY BOY", "NOW", "NPP", "NRS", "NT Cutter", "NUTRI FIT", "NV", "NVIDIA", "NYX PROFESSIONAL MAKEUP", "NZXT", "Nabisco", "Nail Care Headquarters", "Naked", "Nako", "Nambe", "Nanoskin", "Napapijri", "Napoleon", "National Allergy", "National Hardware", "Native", "Native Union", "Natrapel", "Natural Balance", "Naturalamb", "Nature Made", "Nature Valley", "Nature's Bakery", "Nature's Path", "Nature's Recipe", "Naturehike", "Naturepedic", "Nautica", "NavePoint", "Navionics", "Navitas Organics", "Neff", "Neiko", "Nellie's", "Nerf", "Nerf Dog", "Nescafé", "Nesco", "Nespresso", "Nesquik", "Nestlé", "NetBait", "Neudorff", "Neutrogena", "New Balance", "New Britain Machine Company", "New Pro Products", "New brothread", "NewYork Cables", "Newair", "Newport", "Nexa Lotte", "Next Level Racing", "Nextmug", "Nexx", "Nexxus", "Nichols Lures", "Nigrin", "Nike", "Nikko", "Nikon", "Nilight", "Nine West", "NinetoFiveLife", "Ninja", "Ninja Grass Blade", "Nintendo", "Nishine", "Nissan", "Nite Ize", "Nitecore", "Nitro", "Nitto", "Nivea", "Nizoral", "No Natz", "No7", "Nocco", "Noctua", "Nokia", "Nomad Design", "Nomos", "NooElec", "Noosa", "Nordic Naturals", "Nordic Ware", "Nories", "Norman", "Norsk Lithium", "North", "North Brothers", "NorthStar", "Northland", "Northlight", "Nostalgia", "Novus", "Now and Later", "Nu Calgon", "NuTrail", "Nubian Heritage", "Nugo", "Nuk", "Nuova", "NutriBullet", "NutriChef", "NutriSource", "Nutricost", "Nutristore", "Nutro", "Nuwave", "Nylabone", "O Naturals", "O'Keeffe's", "O'NEAL", "O-Cedar", "OCB", "OFF", "OFF!", "OGIO", "OGX", "OLDE THOMPSON SINCE 1944", "OLFA", "OLIGHT", "OMP", "ONE Condoms", "OPI", "OPST", "ORORO", "OTC", "OTTOCAST", "OVALWARE", "OVERTURE", "OXO", "OZARK TRAIL", "Oakley", "Oars + Alps", "Oatey", "Oats Overnight", "Ocean Potion", "Ocean Spray", "Oceanic", "OdoBan", "Office Depot", "Office Star", "Officine Panerai", "Okai", "Okuma", "Olaplex", "Olay", "Old Bay", "Old School Labs", "Old Spice", "Olde Thompson", "Oliver Peoples", "Omano", "Omega", "Omie", "Omnicharge", "Omron", "On", "One Ball", "One Degree", "One Degree Organic Foods", "One Mfg", "One With Nature", "OnePlus", "OneUp Components", "Onkyo", "Onsen", "Onsen Secret", "Ontel", "Onyx", "Opinel", "Oppo", "Optimum", "Optimum Nutrition", "Oral B", "Oransi", "Orbit", "Oreck", "Oreo", "Orgain", "Orient", "Origin8", "Ornativity", "Orolay", "Oros", "Ortho", "Ortlieb", "Osprey", "Oster", "OttLite", "Otterbox", "Our Own Candle Company", "Oura", "Outcast", "Outdoor Research", "OutdoorMaster", "Outkast", "Outward Hound", "Owala", "Owner", "Owon", "Oxford", "OxiClean", "P & S PROFESSIONAL DETAIL PRODUCTS", "P&G PROFESSIONAL", "P&S Detail Products", "P-Line", "PARA'KITO", "PAYDAY", "PB ParfumsBelcam", "PB Swiss", "PCCOOLER", "PCI", "PCIE", "PEET", "PENN", "PEScience", "PETZL", "PG", "PIAA", "PILOT", "PINE64", "PIONEER", "PNW", "PNY", "POLO RALPH LAUREN", "POWERMASTER", "PPD", "PRE JYM", "PRESTIGE", "PRIME", "PRIME HYDRATION", "PRIME-LINE", "PRO BIKE TOOL", "PROFISHIENCY", "PROJE'", "PROcise Outdoors", "PS", "PUR", "PURL", "Pacer", "Paco Rabanne", "Palladium", "Palladium Boots", "Palmer's", "Palmolive", "Pampers", "PanOxyl", "Panasonic", "Panduit", "Panther Martin", "Paper Mate", "Parachute", "Paramount Outdoors", "Park Designs", "Park Tool", "Parker", "Parodontax", "Paslode", "Passion Lube", "Patagonia", "Patek Philippe", "Patriot", "Patriot Memory", "Pattex", "Paudin", "Paul Fredrick", "Paul Mitchell", "Paul Sebastian", "Paul Smith", "Pautzke", "Peach Perfect", "Peak Design", "Peaktech", "Pearhead", "Pedigree", "Pedro's", "Peet's Coffee", "Pelican", "Pelikan", "Peloton", "Penaten", "Penchant", "Pencil Guy", "Pendleton", "Penn Scale", "Pennzoil", "Pentair", "Pentax", "Pentel", "Pepsi", "PepsiCo", "Perfect", "Perfection Lures", "Performance Tool", "PermaFLOW", "Permatex", "Persil", "Perwoll", "Pet Qwerks", "PetSafe", "PetSpy", "Petmate", "Pets First", "Peugeot", "Pfaltzgraff", "Pfister", "Pflueger", "Phanteks", "Phenix", "Philips", "Philips Hue", "Philips Norelco", "Philips Sonicare", "Photo Paper Direct", "Piaget", "Pic", "Pica", "Picasso", "Piksters", "Pine-Sol", "Piranha", "Pirelli", "Pit Boss", "Pittman", "Pittman Outdoors", "Plackers", "Planet Bike", "PlanetBox", "Plano", "Plantura", "Play-Doh", "PlayStation", "Playmobil", "Playology", "Playtex", "Pledge", "Plugable", "Plusivo", "Pokémon™", "Polar", "Polaris", "Polaroid", "Poo-Pourri", "Poolzilla", "Poor Boy's Baits", "PopSockets", "Porsche", "Porter-Cable", "Post Foods", "Post Foods LLC", "Post-it", "Poulan PRO", "Power Pole", "Power Pro", "PowerA", "PowerColor", "PowerMax", "Powerade", "Powermatic", "Practicon", "Prada", "Pre de Provence", "PreSonus", "Premier Protein", "Premium Guard", "Prepworks by Progressive", "Preserve", "Prestacycle", "Presto", "Primary Arms", "PrimoChill", "Primula", "Prince", "Pringles", "Prismacolor", "Pritt", "Pro Charging Systems", "Pro Knot", "Pro-Cure", "Pro-Tec", "ProEtrade", "Procter & Gamble", "Proctor Silex", "Progressive International", "Promar", "Promixx Inc", "Propel", "Protect-A-Bed", "Protectli", "Proto", "Proxxon", "Psychedelic Water", "Pucci", "Pulsar", "Puma", "PurSteam", "Puracy", "Pure Encapsulations", "Pure Leaf", "PureGear", "Purell", "Purely Elizabeth", "Pureology", "Purex", "Purina", "Purina ONE", "Purina Pro Plan", "Purple", "Push Pop", "Pyle", "Pyrex", "PÜR", "Q-Tips", "QNAP", "Qaestfy", "Qranc", "Quaker", "Quantum", "Queen Tackle", "Quest Nutrition", "Quicksilver", "Quikrete", "Quiksilver", "Quip", "R&B Wire", "R&B Wire Products", "RADIUS", "RAID Japan", "RAILBLAZA", "RASASI", "RATT", "RCA", "RDX", "REDMOND", "RESCUE!", "RICOH", "RIEDEL", "RITZ", "RJ's Licorice", "RK ROYAL KLUDGE", "RMR Brands", "ROCCAT", "ROCKBROS", "ROCKET ESPRESSO MILANO", "ROMAN", "RSP NUTRITION", "RTIC", "RVCA", "Rabbit", "Rabid Baits", "RaceFace", "RaceWax", "Racequip", "Rachael Ray", "Rachael Ray Nutrish", "Rachel Ray", "Rack 'Em", "Rackstuds", "Radians", "Rado", "Raid", "Rain-X", "Rainy's", "Ralcam", "Ralph Lauren", "Ram Mount", "Rancilio", "Range Kleen", "Ranger", "Ranger Net", "Rapala", "Rapid Fishing", "Raven Fightwear", "Ravensburger", "Raw", "Rawlings", "Ray Ban", "Raycon", "Rayovac", "Razer", "Reach", "Reaction Innovations", "Reaction Tackle", "Real Essentials", "Rebel", "Rectorseal", "Red Devil", "Red Duck", "Red Head", "Red Land Cotton", "Red Lion", "RedCon", "RedCon1", "RedMax", "Redken", "Redragon", "Reebok", "Reed & Barton", "Reel snot", "Reese Fishing", "Reese's", "Refresh", "Regency Wraps", "Reins", "Relaxdays", "Remco", "Remington", "Renegade", "Repel", "Replens", "Restaurantware", "Retique It", "Retrax", "RetroSound", "Retrospec", "Revell", "Revic", "Revlon", "Rexona", "Reynolds", "Reynolds Kitchens", "Rheos", "RhinoShield", "Rhone", "Ride", "Ridgid", "Rieker", "Right Guard", "Rigol", "Ring", "Ring Pop", "Rinse & Robust", "Ripple", "Rite in the Rain", "Rituals", "Rival Nutrition", "River2Sea", "Robitussin", "Roborock", "Roboworm", "Rock Fish", "RockTape", "Rockler", "Rockport", "Rockville", "Rockwell", "Rode", "Roger Dubuis", "Roku", "Rolex", "Rolf Glass", "Rolling Square", "Rolo", "Ronson", "Rosco", "Roseart", "Rosewood", "Rossignol", "Rotho", "RotoZip", "RotopaX", "Rotring", "Rowenta", "Roxy", "Royal", "Royal Canin", "Royal Purple", "Rubbermaid", "Ruf", "Rug Doctor", "Ruger", "Rule One", "Rush Creek Creations", "Russell Athletic", "Russell Hobbs", "Rust-Oleum", "Rutland Products", "Ryobi", "Ryse Noel", "Ryugi", "Rösle", "Røde", "S&F STEAD & FAST", "S'well", "S.M.S.L", "SABRENT", "SAMSUNG", "SARO LIFESTYLE", "SATECHI", "SAVILAND", "SC Johnson", "SDolphin", "SEAFLO", "SEVIIN", "SHEEPSKIN ELITE", "SHIMANO", "SHOKZ", "SHOUT", "SIG SAUER", "SIKA", "SIMPLY", "SINGLES TO GO!", "SITKA", "SK Hynix", "SKB", "SKB Cases", "SKLZ", "SKYN", "SLK", "SLNT", "SNOW", "SONOFF", "SPAX", "SPECIALIZED", "SPICE TRAIN", "SPLENDA", "SPRO", "SPTA", "SPY", "STAHLWILLE", "STEM", "STIER", "STLHD", "STOPBOX", "STORMR", "STUBAI", "STX International", "SUNLU", "SUPERDANNY", "SWISS NAVY", "Sabatier", "Safer", "SafetyCare", "Saft", "Sagrotan", "Sailwind", "Saitek", "Sakura", "Sally's Organics", "Salomon", "Salt Life", "Salton", "Salty Crew", "Sammic", "Sammons Preston", "Sampo", "Samsonite", "Sand Castle Games", "Sandisk", "Saniflo", "Sanlight", "Santa Cruz ORGANIC", "Sapphire", "Sapphire Technology", "Sappho from lesbos", "Sappo Hill", "Sashco", "Satch", "Saucony", "Savage Gear", "Save Phace", "SawStop", "Scalextric", "ScentSationals", "Sceptre", "Schick", "Schick Hydro Silk", "Schiit", "Schlage", "Schleich", "Schmetz", "Schmidt & Bender", "Schmidt Spiele", "Schmidt's", "Schneider", "Schneider Electric", "Schott", "Schwalbe", "Schwarzkopf", "Schwinn", "Schwinn Fitness", "Schöffel", "Scientific Anglers", "ScorpionEXO", "Scosche", "Scotch", "Scotch Painter's Tape", "Scotch Porter", "Scotch-Brite", "Scotch-Mount", "Scott", "Scotts", "Scottsboro", "Scotty", "Scrub Daddy", "Scrubbing Bubbles", "Scubapro", "Scum Frog", "Scunci", "Sea Clear Power", "Sea Falcon", "Seac", "Seagate", "Seaguar", "Seasonic", "Seaworthy Innovations", "Sebamed", "Sebastian", "Sebastian Professional", "Secret", "Secretlab", "Seiko", "Selkirk", "Selsun Blue", "Sennheiser", "Sennheiser Consumer Audio", "Sensodyne", "SentrySafe", "Seramis", "Serta", "Seventh Generation", "Severin", "Seville Classics", "SexyHair", "Seymour", "Shakespeare", "ShamWow", "Shane's Baits", "Shardor", "Shark", "SharkBite", "Sharp", "Sharpie", "SheaMoisture", "Shearwater", "Sheba", "Shelly", "Shindaiwa", "Shine Armor", "Shoei", "Shop-Vac", "ShowerShroom", "Shure", "Shurflo", "Shuttle Art", "Sia Abrasives", "Sidas", "Sidchrome", "Siemens", "Siglent Technologies", "Sigma", "SigmasTek", "Signature Design by Ashley", "Silent Pocket", "Siless", "Silicon Power", "Silit", "Silonn", "Silva", "SilverStone Technology", "Silverstone", "Simax", "Simms", "Simon", "Simple Green", "Simple Mills", "Simple Modern", "Simple Solution", "Simple&Opulence", "SimpliSafe", "Simply Organic", "Simpson", "Simpson Strong-Tie", "Simrad", "Singer", "SinkShroom", "Sistema", "Six Star", "Sjobergs", "Sjöbergs", "Skater", "Skechers", "Skeeter Screen", "Skil", "Skilsaw", "Skittles", "Skullcandy", "Skunk", "Sky Organics", "Sleek Socket", "Slice", "SlimFast", "Slippery Stuff", "Sliquid", "SlumberPod", "Smart Weigh", "Smartish", "Smartwool", "Smeg", "Smelly Jelly", "SmileGoods", "Smith", "Smith & Nephew", "Smith & Wesson", "Smithwick", "Smucker's", "Snag Proof", "SnapSafe", "Sneaker Balls", "Snickers", "Snow Joe", "Snow MOOver", "Soapbox", "Soehnle", "Soeos", "Sof Sole", "Soft Scrub", "Softsoap", "Solaris", "Solidigm", "Somat", "Sonar Shield", "Sonax", "Sonia Rykiel", "Sonnet", "Sonos", "Sony", "Soudal", "Sound Assured", "Soundcore", "Sour Patch Kids", "Southpole", "Southwire", "SpaceAid", "Spalding", "Sparco", "SparkPod", "Sparkle", "Sparkling ICE", "Speakman", "Spearpoint", "Speck", "Spectracide", "Spectrum", "Spectrum Diversified", "Spee", "Speed Freak", "Speed Stick", "Speed and Strength", "Speedo", "Speedway Motors", "Spenco", "Sperry", "Spic And Span", "Spice Classics", "Spice Hunter", "Spice Islands", "Spiceology", "Spicy Shelf", "Spider Farmer", "SpiderWire", "Spigen", "Spike", "Spike-It", "Spinbrush", "Spit", "Sport Brella", "Spray max", "Sprayco", "Sprite", "Sprite Industries", "Spyder", "Spyderco", "Squatty Potty", "Srixon", "St Croix", "St. Croix Rods", "St. Dalfour", "St. Ives", "Stabila", "Stabilo", "Staedtler", "Stalwart", "Stance", "Standard Motor Products", "Standout", "Stanley", "Stanley Black & Decker", "Stanly Hand Tools", "Stansport", "Staples", "Star Brite", "Star Rods", "StarTech", "StarTech.com", "Starbucks", "Starburst", "Stardrops", "Starling Games", "Starmark", "Starrett", "Staub", "Stayfree", "SteadMax", "SteelSeries", "Steelshad", "Steiner", "Steiner Optics", "Steiner-Optik", "Sterilite", "Sterillium", "Stetson", "Steve Madden", "Stick Jacket", "Stihl", "Stiletto", "Stilo", "Stjarnagloss", "Stolzle Lausitz", "Stoner Car Care", "Storacell", "StorageWorks", "StoreYourBoard", "Storm", "Stormguard", "StoveShelf", "Streamlight", "Stren", "Stretch Island", "Strike King", "Striker", "Studebaker", "Stur", "Suave", "Suavecito", "Subaru", "Substral", "Subzero", "Sufix", "Suja", "Sulky", "Sumitomo", "Sun Joe", "Sunbeam", "Sunco", "Sunco Lighting", "Sunex", "Sungator", "Sunil", "Sunline", "Sunny Health & Fitness", "Super Sculpey", "SuperStick", "Superio", "Superior Threads", "Supermicro", "Supershieldz", "SupplyTiger", "Sure", "Sure Life", "SureGuard", "SureGuard Mattress Protectors", "Surecan", "Surefire", "Suunto", "Swann", "Swarovski", "Swatch", "SweeTARTS", "Sweet Baby Ray's", "Sweet Water Decor", "Swiffer", "Swift Auto Care", "SwiftGrip", "SwiftJet", "Swiss Eagle", "Swiss Miss", "SwissGear", "Swissdigital", "SwitchBot", "Swix", "Sylvania", "Synology", "Systane", "System Jo", "T-H Marine", "T-Reign", "T-fal", "T.W . Evans Cordage Co.", "TALES", "TAMIYA", "TCL", "TCP Global", "TDK", "TEAMGROUP", "TEPE", "TERA PUMP", "TFA Dostmann", "THAYERS", "THERABAND", "THRUSTMASTER", "TIF", "TIGI", "TIKI", "TIMEMORE", "TOKO", "TOMY", "TONOR", "TORIC", "TOX", "TP-Link", "TRACT", "TRAKK", "TREMCLAD", "TRENDnet", "TRESemmé", "TRETORN", "TRIGGERPOINT", "TROJAN", "TRUE CABLE", "TUF Line", "TUFFY", "TUL", "TUSA", "TYLER", "TYR", "Tackle HD", "Tackle House", "Tag Heuer", "Talentcell", "Tampax", "Tangent Theta", "Tanos", "Tap Out", "Tapcon", "Targus", "Tassimo", "Taurus", "Taylor", "TaylorMade", "Taytools", "Tea Tree", "TechniSat", "Technicians Choice", "Technivorm", "Technol", "Tecnu", "Tecnu Extreme", "Ted Baker", "Teekanne", "Tefal", "Tekton", "Tektronics", "Telex", "Temple Fork Outfitters", "Tempur-Pedic", "Tenda", "Tenergy", "Terminator", "Terramar", "Terro", "Tervis", "Tesa", "Teslong", "Testors", "Tetesept", "Teufel", "Texas Tackle", "The Army Painter", "The Body Shop", "The Bottle Depot", "The Ginger People", "The Good Crisp Company", "The Hillman Group", "The Honest Company", "The Honey Pot Company", "The Humble Co.", "The Lakeside Collection", "The North Face", "The Original Fish Formula", "The Rag Company", "The Ridge", "The Rod Glove", "The Ryker Bag", "The Spice Lab", "The Spice Way", "TheraBreath", "Theragun", "Therm-ic", "Thermacell", "Thermajane", "Thermajohn", "Thermal Grizzly", "Thermalright", "Thermaltake", "Thermopro", "Thetford", "Thill", "ThirtyTwo", "ThisWorx", "Thomas & Betts", "Thomasville", "Thomy", "Thorne", "Thousand Lakes", "Thread Wallets", "ThruNite", "Thule", "Thymes", "Ticonderoga", "Tide", "Tiffany & Co", "Tightlines UV", "Tile", "Tilex", "Timberland", "Timbuk2", "Timetec", "Timex", "Tipp-Ex", "Tipsy Elves", "Tissot", "Titan", "Titan by Arctic Zone", "Titebond", "Titleist", "Tolino", "Tom Ford", "Tom's of Maine", "Tombow", "Tommy Bahama", "Tommy Hilfiger", "Tool Daily", "Tootsie Roll", "Top Brass", "Top Water", "Topeak", "Topo Chico", "Torani", "Tork", "Tory Burch", "Toshiba", "Totes", "TouchUpDirect", "Towle", "Towle Living", "Toyota", "Traditional Medicinals", "Traeger", "Trail maker", "Tramontina", "Transcend", "Transitions", "Transparent Labs", "Trapper Tackle", "TravisMathew", "Traxxas", "Tree Hut", "TrekStor", "Treva", "Trico", "Trident", "Trigema", "Trijicon", "Trik Fish", "Trika", "Triple Paste", "Tripp Lite", "Trokar", "Trolli", "Trout Hunter", "Trout Magnet", "Troy Lee Designs", "Troy-Bilt", "Tru-Tension", "Tru-Turn", "True Citrus", "True Classic", "True Organic", "True Religion", "Tub O' Towels", "TubShroom", "Tudor", "Tupperware", "Turtle Beach", "Turtle Wax", "TurtleBox", "TuxMat", "Tweezerman", "Twix", "Twizzlers", "Tylenol", "Tyre Glider", "U by Kotex", "U-Haul", "U-POL", "U.S. Art Supply", "UGG", "UGREEN", "UHU", "UMIACOUSTICS", "UNIONBAY", "UPS Battery Center", "URBAN DECAY", "USAOPOLY", "UTG", "UTG Pro", "Uberlube", "Ubiquiti", "Ugee", "Ugly Stik", "Ultra Fresh", "UltraPro", "Ultrasource", "Ulysse Nardin", "Umami", "Umbra", "Umbro", "Umpqua", "Uncaged", "Uncle Henry", "Uncle Josh", "Under Armour", "Under the Weather", "Undrdog", "Unger", "Uni-T", "Uni-ball", "Unicorn", "Uniden", "Unilever", "Unitec", "Universal", "Unmatched", "Utopia", "Utopia Bedding", "Utopia Towels", "Uvex", "V & M Baits", "V&M", "VAHDAM", "VALVE", "VAUDE", "VAULTEK", "VEET", "VELCRO Brand", "VEVOR", "VHT", "VIKING", "VINTAGE HAVANA", "VIZIO", "VMC", "VP Racing", "VTOMAN", "VViViD", "Vacheron Constantin", "Vagisil", "Valentino", "Valkental", "Vallejo", "Valley Hill", "Valspar", "Valterra", "Valvoline", "Van Cleef & Arpels", "Van Heusen", "Van Staal", "Vanicream", "Vanish", "Vans", "Vantrue", "Varta", "Vaseline", "Vashe", "Vatic", "Vaultz", "Vax", "Vector KGM", "Vectronix", "Vega", "Velcro", "Venom Power", "Venom Steel", "Ventures Fly Co.", "Vera Bradley", "Verbatim", "Vermont American", "Versace", "Vertiv", "Vetriscience", "Vgo...", "Vicious", "Vickerman", "Vicks", "Vicrez", "Victoria's Secret", "Victorinox", "Victory", "Victrola", "ViewSonic", "Viking Revolution", "Vikings Blade", "Viktor & Rolf", "Vilebrequin", "Vileda", "Villeroy & Boch", "Vince", "Vince Camuto", "Vineyard Vines", "Viofo", "Viparspectra", "Viquel", "VisionTek", "Visser", "Vitafit", "Vitakraft", "Vitamix", "Vittle Vault", "Vivifying", "Volcom", "Volkswagen", "Vollrath", "Voltcraft", "Vortex", "Vorwerk", "Vtech", "Vulcano", "Vuori", "WACACO", "WAVLINK", "WD Blue", "WD Green", "WD-40", "WD_BLACK", "WEICON", "WELCH ALLYN", "WEN", "WEST PAW", "WMF", "WOLF GOURMET", "WORKPRO", "WSD", "WYZE", "Wacom", "Wago", "Wahl", "Wahoo", "Wahoo Fitness", "Walker Edison", "Walker's", "Wallace", "Wapsi", "War Eagle", "Waring", "Waring Commercial", "WaterWipes", "Waterford", "Waterman", "Waterpik", "Watkins", "Wave Away", "Wavian", "Wayne", "WeatherPod", "Weatherproof Vintage", "Weber", "Wedi", "Weed Eater", "Weiman", "Weißer Riese", "Weldbond", "Weldpro", "Weleda", "Wella", "Weller", "Wellness Natural Pet Food", "Wells Lamont", "Wera", "Werner", "Wesco", "West Bend", "West Coast Tackle", "Western Digital", "Westinghouse", "Westinghouse Outdoor Power Equipment", "Weston", "Weston Brands", "Wet", "Wet & Forget", "Wet Ones", "Wet n Wild", "Wexel Art", "Whale", "Whiplash Factory", "Whirlpool", "Whiskas", "White Lightning", "Whitemorph", "Whitestone", "Whitmor", "Whole Foods Market", "WiZ", "WiZ Connected", "Wiha", "Wild Eats", "WildHorn Outfitters", "Wildhorn", "Wiley X", "Wilkinson Sword", "Williams", "Williamson", "Wilson", "Wilsonart", "Wilton", "Wilton Armetale", "Wilwood", "Winbest", "Winco", "Windex", "Windhager", "Windsor & Newton", "Winix", "Winterial", "Wirefy", "Wiseorb", "Wiss", "Withings", "Wix", "Wolf Garten", "Wolf Tooth", "Wolfcraft", "Wonka", "WoodWick", "Woolite", "Worcester", "Worx", "Worx Professional", "Wrangler", "Wrangler Authentics", "Wright Products", "Writech", "Wyler's Light", "WypAll", "WÜSTHOF", "Würth", "X Zone", "X-Acto", "X-Sense", "X-Tronic", "XBraid", "XCMAN", "XCeed", "XESSO", "XFX", "XLC", "XPEL", "XSPC", "XTRATUF", "XXIO", "Xbox", "Xcelite", "Xdro Shoes", "Xencelabs", "Xerox", "Xiaomi", "Xp-Pen", "Y-Brush", "YAMAHA", "YAMAZAKI", "YARDLEY LONDON", "YGK", "YOLOtek", "YORK", "YVES SAINT LAURENT", "Yabano", "Yak Power", "YakAttack", "Yakima", "Yakima Bait", "Yaktrax", "Yale", "Yamamoto", "Yankee Candle", "Yardley", "Year & Day", "Year and Day", "Yellow Magic", "Yeti", "Yo-Zuri", "Yokohama", "Yubico", "Yum", "YumEarth", "Z Man", "ZARA", "ZEBRA", "ZEISS", "ZIOXX", "ZOTA", "ZOTAC", "ZUMWax", "ZWILLING", "Zagg", "Zak Designs", "Zalman", "Zalt's", "Zamp", "Zap-A-Gap", "Zappu", "Zeagle", "Zeal Optics", "Zebco", "Zebra Pen", "Zebralight", "Zeke's", "Zenith", "Zenoah", "Zep", "Zero Friction", "Zevia", "Zinsser", "Zipfizz", "Ziploc", "ZippyPaws", "Zodiac", "Zojirushi", "Zoo Med", "Zoom", "Zote", "Zulay Kitchen", "Zum", "Zyliss", "ZÜMWAX", "adidas", "adidas Originals", "alaway", "all", "alpen", "altoids", "amFilm", "ands", "apa AUTO PARTS AVENUE", "apple & eve", "aqara", "arcan", "arteza", "band-aid", "bareMinerals", "be quiet!", "bella", "bolle", "bollé", "brennenstuhl", "bugatti", "bumble", "chemical guys", "clorox", "colgate", "crest", "curad", "deleyCON", "di Oro Living", "e-cloth", "e.l.f.", "eGo", "eSUN", "eco-eco", "ecobee", "ecotowel", "edding", "edel+white", "eero", "ella+mila", "eneloop", "eos", "eufy", "eufy Security", "everyhero", "eye mea", "fruit of the loom", "glerups", "goDog", "hOmeLabs", "hello", "iBuyPower", "iFixit", "iHome", "iProven", "iProvèn", "iRestore", "iRobot", "iSpice", "ima", "jig", "madesmart", "moleskine", "monbento", "mountainFLOW", "nextzett", "nuphy", "orbitalum", "parat", "pjur", "poppi", "reid", "ringke", "siggi's", "simplehuman", "sodastream", "sofirn", "steelcase", "sur la table", "talenti", "uni", "uvexSports", "wirsh"];

// ── data/known-brands.js ──────────────────────────────────────────────────────

// Knockoff: curated list of established brands.
// "Established" = real company with a track record, warranty, and reputation to lose.
// Matching is case-insensitive on normalized keys (lowercase alphanumeric).
// Multi-word entries are matched longest-first against title prefixes.
var KO_KNOWN_BRANDS = [
  // ── Tools & hardware ──────────────────────────────────────────
  "3M", "Abus", "Amana Tool", "American Lock", "Ares", "Ares Tool", "Arrow",
  "Astro Pneumatic", "Bahco", "Baldwin", "Behr", "Benchmade", "Benjamin Moore",
  "Bessey", "Black & Decker", "Black and Decker", "Black+Decker", "Boker",
  "Bondhus", "Bosch", "Bosch Accessories", "Brinks", "Buck Knives",
  "Capri Tools", "Case", "Channellock", "Chapman", "Civivi", "CMT",
  "Cold Steel", "Cornwell", "Corona", "Craftsman", "CRC", "Crescent", "CRKT",
  "DAP", "Deckmate", "DeltaLock", "DeWalt", "Diablo", "Dremel", "Eastwood",
  "Eklind", "Emerson", "Empire", "Engineer", "ESEE", "Estwing", "Everbilt",
  "Facom", "Fallkniven", "Fein", "Felco", "Felo", "Festool", "Fiskars", "Flex",
  "Fluke", "Forrest", "Freud", "Fujiya", "Gardner Bender", "GearWrench",
  "Gedore", "Gerber", "Gorilla", "Gorilla Glue", "Gorilla Ladders", "Greenlee",
  "Grip-Rite", "GRK", "Hart", "Hazet", "Hillman", "Hilti", "Husky", "Ideal",
  "iGaging", "Incra", "Irwin", "J-B Weld", "JessEm", "Johnson Level", "Ka-Bar",
  "Kershaw", "Kilz", "Klein", "Klein Tools", "Klein-Kurve", "Klenk", "Knipex",
  "Kobalt", "Kreg", "Krylon", "Kwikset", "Leatherman", "Lenox", "Lisle",
  "Little Giant", "Loctite", "Louisville Ladder", "Mac Tools", "Mafell",
  "Makita", "Malco", "Master Lock", "Matco", "Medeco", "Metabo", "Metabo HPT",
  "Microtech", "Midwest", "Milwaukee", "Minwax", "Mitutoyo", "Morakniv",
  "National Hardware", "Neiko", "Norton", "Old Timer", "Ontario Knife",
  "Opinel", "OTC", "PB Swiss", "PB Swiss Tools", "Performance Tool", "Permatex",
  "Powerbuilt", "Proto", "Purdy", "Ridgid", "Rockwell", "Rust-Oleum", "Ryobi",
  "Schlage", "Sherwin-Williams", "Shur-Line", "Silky", "Simpson Strong-Tie",
  "SK Hand Tools", "SK Tools", "Skil", "Snap-on", "SOG", "Southwire", "Spax",
  "Spyderco", "Stabila", "Stahlwille", "Stanley", "Starrett", "Stiletto",
  "Sunex", "Swanson", "Tekton", "Titan", "Titan Tools", "Titebond", "Varathane",
  "Vaughan", "Vessel", "Victorinox", "Vise-Grip", "Wago", "WD-40", "Wera",
  "Werner", "Whiteside", "Wiha", "Wilton", "Wiss", "Witte", "Woodpeckers",
  "Wooster", "Worx", "Yale", "Yost", "Zero Tolerance",
  // ── Electronics & computers ───────────────────────────────────
  "Acer", "Adafruit", "Amazon", "Amazon Basics", "AmazonBasics", "AMD", "AOC",
  "APC", "Apple", "Arduino", "Arlo", "ASRock", "Asus", "Belkin", "BenQ",
  "Blink", "Broan", "Brother", "Cable Matters", "CalDigit", "Canon", "Casetify",
  "Cherry", "Coros", "Corsair", "Crucial", "CyberPower", "Das Keyboard", "Dell",
  "Doxie", "Ducky", "Eaton", "Echo", "Ecobee", "Elgato", "Emerson", "Epson",
  "Ergodox", "EVGA", "Filco", "Fire TV", "First Alert", "Fitbit", "Fujitsu",
  "Garmin", "GE", "Gigabyte", "Google", "Honeywell", "HP", "HTC", "Hubbell",
  "Huion", "HyperX", "iFixit", "Insignia", "Intel", "JVC", "Kensington",
  "Keychron", "Kidde", "Kindle", "Kinesis", "Kingston", "Kioxia", "Legrand",
  "Lenovo", "Leopold", "Leviton", "LG", "Linksys", "Logitech", "Lutron", "Meta",
  "Microsoft", "Monoprice", "Mophie", "MSI", "Nanuk", "Nest", "Netgear",
  "Nintendo", "NuTone", "Nvidia", "Oculus", "Onn", "OtterBox", "Oura", "OWC",
  "Panasonic", "Panasonic WhisperFit", "Pelican", "Philips", "PlayStation",
  "Plustek", "PNY", "Polar", "QNAP", "Raspberry Pi", "Razer", "Realforce",
  "Ring", "Rocketbook", "Roku", "Samsung", "SanDisk", "Satechi", "Sceptre",
  "Seagate", "Sharp", "Siemens", "SKB", "Sony", "SparkFun", "Spigen",
  "Square D", "StarTech", "SteelSeries", "Stream Deck", "Surface", "Suunto",
  "Synology", "Targus", "TomTom", "Topre", "Toshiba", "Tripp Lite",
  "Twelve South", "Ubiquiti", "Valve", "Vertiv", "ViewSonic", "Vive", "Vizio",
  "Wacom", "WD", "Western Digital", "Whoop", "Withings", "Wyze", "Xbox",
  "Xerox", "XP-Pen", "ZSA",
  // ── Audio ─────────────────────────────────────────────────────
  "Akai", "AKG", "Alesis", "Apogee", "Arturia", "Audio-Technica", "Audioengine",
  "Audioquest", "B&W", "Beats", "Behringer", "Beyerdynamic", "Blue",
  "Blue Yeti", "Bose", "Bowers & Wilkins", "Cambridge Audio",
  "Definitive Technology", "Denon", "Dynaudio", "Elac", "EPOS", "Fluance",
  "Focal", "Focusrite", "Grado", "Harman Kardon", "Hosa", "Jabra", "JBL",
  "JLab", "Kanto", "KEF", "Klipsch", "M-Audio", "Mackie", "Marantz",
  "MartinLogan", "Mogami", "MOTU", "Native Instruments", "Neutrik", "Numark",
  "Onkyo", "Pioneer", "Plantronics", "Polk", "Polk Audio", "Poly", "PreSonus",
  "Q Acoustics", "QSC", "Rane", "Rel", "RME", "Rode", "Sennheiser", "Shure",
  "Skullcandy", "Sonos", "Steinberg", "SVS", "Tascam", "Technics",
  "Universal Audio", "Wharfedale", "Yamaha", "Zoom",
  // ── Photo & video ─────────────────────────────────────────────
  "Atomos", "B+W", "Billingham", "Blackmagic", "Domke", "Fujifilm", "Gitzo",
  "GoPro", "Hasselblad", "Hoya", "Impact", "Lee Filters", "Leica", "Lowepro",
  "Manfrotto", "Nikon", "Olympus", "OM System", "Peak Design", "Pentax",
  "PolarPro", "Profoto", "Ricoh", "Rode Wireless", "Sigma", "Tamron", "Tenba",
  "Think Tank", "Tiffen", "Westcott", "Zeiss",
  // ── Kitchen & dining ──────────────────────────────────────────
  "AeroPress", "All-Clad", "Anchor Hocking", "Anova", "Aroma", "Ball",
  "Baratza", "Berkey", "Bialetti", "Blendtec", "Bodum", "Bonavita", "Braun",
  "Breville", "Brita", "Brumate", "Calphalon", "Cambro", "CamelBak", "Caraway",
  "Chemex", "Coleman", "Comandante", "Contigo", "Corelle", "CorningWare",
  "Crock-Pot", "Cuckoo", "Cuisinart", "Dash", "de Buyer", "De'Longhi",
  "DeLonghi", "Demeyere", "Dexter-Russell", "Duralex", "Escali", "Excalibur",
  "F. Dick", "Fellow", "Gaggia", "Global", "GreenPan", "Hamilton Beach",
  "Hario", "Henckels", "Hestan", "Hydro Flask", "Igloo", "Instant",
  "Instant Pot", "J.A. Henckels", "Keurig", "KitchenAid", "Klean Kanteen",
  "Krups", "La Marzocco", "Le Creuset", "Lelit", "Libbey", "Lodge", "Mac Knife",
  "Made In", "Magic Bullet", "Matfer", "Matfer Bourgeat", "Mauviel", "Mercer",
  "Mercer Culinary", "Messermeister", "Misen", "Miyabi", "Moccamaster",
  "Nalgene", "Nesco", "Nespresso", "Ninja", "Nordic Ware", "NutriBullet",
  "Oster", "Our Place", "Owala", "OXO", "OXO Good Grips", "Presto", "PUR",
  "Pyrex", "Rancilio", "Robot Coupe", "Rocket Espresso", "RTIC", "Rubbermaid",
  "S'well", "Salter", "Shun", "Simple Modern", "SodaStream", "Stanley 1913",
  "Staub", "Sterilite", "Sunbeam", "T-fal", "Takeya", "Taylor", "Technivorm",
  "Thermapen", "Thermos", "ThermoWorks", "Tiger", "Tojiro", "Tramontina",
  "USA Pan", "Vitamix", "Vollrath", "Waring", "Weck", "Wilton", "Winco",
  "Wusthof", "Wüsthof", "Yeti", "ZeroWater", "Zojirushi", "Zwilling",
  // ── Home, cleaning & organization ─────────────────────────────
  "Akro-Mils", "Arm & Hammer", "Bar Keepers Friend", "Bissell", "Bon Ami",
  "Brabantia", "Casabella", "Clorox", "ClosetMaid", "Command",
  "Container Store", "Cosco", "DeWalt ToughSystem", "Dirt Devil", "Dyson",
  "Edsal", "Elfa", "Eureka", "Full Circle", "Gladiator", "Goo Gone",
  "Honey-Can-Do", "Hoover", "Household Essentials", "Husky Storage", "iDesign",
  "InterDesign", "iRobot", "Joseph Joseph", "Keter", "Kirby", "Krud Kutter",
  "Libman", "Lifetime", "Lysol", "mDesign", "Method", "Miele",
  "Milwaukee Packout", "Mr. Clean", "Mrs. Meyer's", "Muscle Rack",
  "Nature's Miracle", "NewAge Products", "O-Cedar", "OdoBan", "Oreck", "Pledge",
  "ProTeam", "Rainbow", "Rejuvenate", "Riccar", "Ridgid Pro", "Roomba",
  "Rubbermaid Commercial", "Sanitaire", "Scotch-Brite", "Sebo",
  "Seventh Generation", "Seville Classics", "Shark", "Simple Green",
  "SimpleHuman", "Simplehuman", "Simplicity", "Stanley FatMax", "Suncast",
  "Swiffer", "Trinity", "Umbra", "Weiman", "Whitmor", "Windex", "Yamazaki",
  "Zep",
  // ── Bed, bath & textiles ──────────────────────────────────────
  "Avocado", "Beautyrest", "Birch", "Boll & Branch", "Brooklinen",
  "Brooklyn Bedding", "Casper", "Coop Home Goods", "Coyuchi", "DreamCloud",
  "Faribault", "Frontgate", "Garnet Hill", "Helix", "L.L.Bean", "Lands' End",
  "Leesa", "Linenspa", "Lucid", "Malouf", "Mellanni", "MyPillow", "Nectar",
  "Onsen", "Parachute", "Pendleton", "Pinzon", "Purple", "Riley", "Saatva",
  "Sealy", "Serta", "Simmons", "Sleep Number", "Stearns & Foster",
  "Tempur-Pedic", "Towel Spa", "Tuft", "Tuft & Needle", "Turkish Towel",
  "Utopia Bedding", "Woolrich", "Zinus",
  // ── Furniture & office ────────────────────────────────────────
  "Alera", "Article", "Ashley", "Ashley Furniture", "Branch", "Burrow",
  "Bush Business", "Bush Furniture", "Crate & Barrel", "Floyd", "Fully",
  "Haworth", "Herman Miller", "HON", "Humanscale", "Ikea", "Joybird", "Knoll",
  "La-Z-Boy", "Lorell", "Pottery Barn", "Realspace", "Room & Board", "Safco",
  "Sauder", "Serena & Lily", "Steelcase", "Thuma", "Uplift", "Uplift Desk",
  "Vari", "Varidesk", "West Elm",
  // ── Outdoor, camping & sport ──────────────────────────────────
  "1UP", "1UP USA", "Adidas", "Altra", "Aqua Sphere", "Aqua-Bound", "Aqualung",
  "ARB", "Arc'teryx", "Arena", "Ariat", "Asics", "Astral", "Athlon", "Bell",
  "Bells of Steel", "Bending Branches", "Big Agnes", "Billabong", "BioLite",
  "Birkenstock", "Black Diamond", "Blundstone", "Body Glove", "Bogs", "Bombas",
  "Bowflex", "Break-Free", "Brooks", "BSN", "Burley", "Burris", "Bushnell",
  "Caldwell", "Callaway", "Campagnolo", "Cannondale", "CAP Barbell", "Carhartt",
  "Carolina", "Celestron", "Cellucor", "Cervelo", "Chaco", "Chariot",
  "Cleveland Golf", "Coast", "Cobra Golf", "Coleman",
  "Columbia", "Concept2", "Continental", "Cramer", "Crankbrothers", "Cressi",
  "Crocs", "Danner", "Darn Tough", "DeMarini", "Deuter", "Dickies",
  "Doctor's Best", "Dometic", "Duluth", "Duluth Trading", "Duracell",
  "Dymatize", "Easton", "Eleiko", "Elite", "Energizer", "Engel", "Esbit",
  "Eveready", "Everlast", "Farm to Feet", "Feedback Sports", "Filson", "FINIS",
  "Flambeau", "FootJoy", "Fox River", "Franklin", "Frogg Toggs", "Gaiam",
  "Garden of Life", "Gatorade", "Georgia Boot", "Ghost", "Giant", "Gill",
  "Giro", "Goal Zero", "Golf Pride", "Gore-Tex", "Gossamer Gear",
  "Granite Gear", "Gregory", "Grundens", "GSI",
  "GSI Outdoors", "Harbinger", "Helly Hansen", "Hobie", "Hoka", "Hoppe's",
  "Hugger Mugger", "Hunter", "Hurley", "Hyperice", "Hyperlite", "Ibex",
  "Icebreaker", "Irish Setter", "Ironmaster", "Jade Yoga", "Jarrow", "Jetboil",
  "Justin", "Kask", "Keen", "Kelty", "Kenda", "Kinetic", "KleenBore", "Kona",
  "Kuat", "La Sportiva", "Ledlenser", "Legion", "Leupold", "Levi's", "Lezyne",
  "Life Extension", "Liforme", "Louisville Slugger", "Lowa", "Maglite",
  "Magpul", "Mammut", "Manduka", "Mares", "Marin", "Marmot", "Marucci", "Maven",
  "Maxxis", "McDavid", "Meade", "Merrell", "Michelin", "Minus33", "Mizuno",
  "Mizuno Sports", "Mountain Hardwear", "MSR", "MTI", "MTM", "Muck Boot",
  "Mueller", "MuscleTech", "Musto", "Mystery Ranch", "Nature Made", "Nemo",
  "New Balance", "Nike", "Nikon Sport Optics", "Norco", "Nordic Naturals",
  "NordicTrack", "NOW Foods", "NRS", "O'Neill", "Oboz", "Oceanic", "Odyssey",
  "Old Town", "On", "On Running", "Onnit", "Optimum Nutrition", "Orion",
  "Orvis", "Osprey",
  "Otis", "OtterBox Venture", "Outdoor Research", "Park Tool", "Patagonia",
  "Pelican Coolers", "Pelican Kayak", "Peloton", "Perception", "Petzl",
  "Pinarello", "Pirelli", "Plano", "POC", "PowerBlock", "Primus",
  "Princeton Tec", "ProForm", "Pure Encapsulations", "PXG", "Quiksilver",
  "Rawlings",
  "Rayovac", "Real Avid", "Red Wing", "Rehband", "REI", "REI Co-op",
  "Rep Fitness", "Riddell", "Rip Curl", "Rocky", "RockyMounts", "Rogue",
  "Rogue Fitness", "Salewa", "Salomon", "Salsa", "Santa Cruz", "Saris",
  "Saucony", "SBD", "Scarpa", "Schiek", "Schutt", "Schwalbe", "Scotty Cameron",
  "Scubapro", "Sea to Summit", "Shimano", "Shock Doctor", "Sig Sauer", "Simms",
  "Sky-Watcher", "Smartwool", "Smith", "Smith Optics", "Snow Peak", "Solgar",
  "Solo Stove", "Sorel", "Soto", "Spalding", "Specialized", "Speedo",
  "Sports Research", "Spud Inc", "SRAM", "Srixon", "Stanley Adventure",
  "Steiner", "Stohlquist", "Streamlight", "SuperStroke", "SureFire", "Surly",
  "Swarovski", "Tacx", "TaylorMade", "Teva",
  "The North Face", "Therabody", "Theragun", "Therm-a-Rest", "Thorne",
  "Thorogood", "Thule", "Timberland", "Timberland PRO", "Tipton",
  "Titan Fitness", "Titleist", "Topeak", "Topo Athletic", "Trangia", "Trek",
  "TriggerPoint",
  "Trijicon", "TRX", "TYR", "ULA", "Under Armour", "Vasque", "Vittoria",
  "Vivobarefoot", "Vortex", "Vortex Optics", "Wahoo", "Werner Paddles",
  "Wheeler", "Wigwam", "Wilderness Systems", "Wilson", "Wolverine", "Wrangler",
  "Xero Shoes", "Xtratuf", "Yakima", "Yeti Cycles", "YOLO", "York",
  "Zeiss Sport Optics", "Zoggs", "Zpacks",
  // ── Grills & lawn/garden ──────────────────────────────────────
  "Ames", "AR Blue Clean", "Ariens", "B&B Charcoal", "Bayer Advanced",
  "Big Green Egg", "Blackstone", "Bonide", "Broil King", "Bully Tools",
  "Camp Chef", "Central Pneumatic", "Champion", "Chapin", "Char-Broil",
  "Char-Griller", "Craftsman Hose", "Cub Cadet", "Cuisinart Grill", "Dr. Earth",
  "Dramm", "DuroMax", "Earthwise", "Echo", "Ego", "Eley", "Espoma", "Exmark",
  "Firman", "Flexzilla", "Fogo", "FoxFarm", "Gardena", "Generac", "Gilmour",
  "Greenworks", "GrillGrate", "Harbor Freight", "Honda", "Hoselink", "Hudson",
  "Husqvarna", "Jobe's", "John Deere", "Kamado Joe", "Karcher", "Kingsford",
  "Kärcher", "Liberty Garden", "Masterbuilt", "Meater", "Melnor", "Miracle-Gro",
  "Napoleon", "Neptune's Harvest", "Oklahoma Joe's", "Orbit", "Ortho",
  "Osmocote", "Pit Boss", "Predator", "Radius Garden", "Rain Bird", "Recteq",
  "Roundup", "Royal Oak", "Scag", "Scotts", "Simpson", "Snapper", "Solo",
  "Spectracide", "Stihl", "Sun Joe", "Suncast Hose", "Toro", "Traeger",
  "Troy-Bilt", "True Temper", "Weber", "Wen", "Westinghouse", "Zero-G",
  // ── Auto ──────────────────────────────────────────────────────
  "ACDelco", "Adam's", "Adam's Polishes", "Akebono", "Amsoil", "Armor All",
  "B&W Hitches", "Battery Tender", "Bendix", "BFGoodrich", "Bilstein", "Brembo",
  "Bridgestone", "CarPro", "Castrol", "Centric", "Chemical Guys", "Chevron",
  "Collinite", "Continental Belts", "Cooper", "Covercraft", "CTEK", "Curt",
  "Dayco", "Denso", "DieHard", "Dorman", "Draw-Tite", "EBC", "Falken",
  "Firestone", "Fox", "Fram", "Gabriel", "Gates", "General Tire", "Goodyear",
  "Griot's Garage", "Gtechniq", "Gumout", "Hankook", "Hawk", "Hella",
  "Husky Liners", "Interstate", "K&N", "King", "Kumho", "KYB", "Liqui Moly",
  "Lucas", "Lucas Oil", "Mahle", "Mann", "Meguiar's", "Michelin Tires",
  "Mobil 1", "Monroe", "Moog", "Mopar", "Mothers", "Motorcraft", "Motul",
  "National", "NGK", "Nitto", "NOCO", "Nokian", "Odyssey", "Old Man Emu",
  "Optima", "P&S", "Pennzoil", "PIAA", "PowerStop", "Purolator", "Rain-X",
  "Rancho", "Raybestos", "Red Line", "Reese", "Rotella", "Rough Country",
  "Royal Purple", "Schumacher", "Sea Foam", "Shell", "SKF", "Smittybilt",
  "Sonax", "Standard Motor Products", "StopTech", "STP", "Sylvania", "Techron",
  "Timken", "Toyo", "Turtle Wax", "Valvoline", "Viair", "Vredestein", "Wagner",
  "Warn", "WeatherTech", "Wix", "Yokohama",
  // ── Health, personal care & grooming ──────────────────────────
  "3M Medical", "Advil", "Airborne", "Aleve", "Align", "Allegra",
  "American Crew", "Andis", "Aquaphor", "Astra", "Aveeno", "Babyliss",
  "BaBylissPRO", "Band-Aid", "Baxter of California", "Bayer", "Benefiber",
  "Blistex", "Braun Thermometer", "Burt's Bees", "Carmex", "CeraVe", "Cetaphil",
  "Claritin", "Clinique", "Colgate", "Conair", "CoverGirl", "Cremo", "Crest",
  "Culturelle", "Curad", "Curel", "Degree", "Derby", "Dove", "Dr. Bronner's",
  "e.l.f.", "Edwin Jagger", "Emergen-C", "EOS", "Essie", "Estee Lauder",
  "Eucerin", "Eucerin Advanced", "Every Man Jack", "Excedrin", "Exergen",
  "Feather", "Flonase", "Florastor", "Gillette", "Gold Bond", "Harry's",
  "iHealth", "Imodium", "Jack Black", "Jergens", "Kiehl's", "Kinsa", "L'Oreal",
  "La Roche-Posay", "Lancome", "Lubriderm", "Maybelline", "Merkur", "Metamucil",
  "Milani", "Mitchum", "Motrin", "Mucinex", "Native", "Neutrogena", "Nexcare",
  "Nivea", "Norelco", "NyQuil", "NYX", "O'Keeffe's", "Olay", "Old Spice",
  "Omron", "OPI", "Oral-B", "Oster Pro", "Palmer's", "Parker Safety Razor",
  "Paul Mitchell", "Paula's Choice", "Pepcid", "Pepto-Bismol", "Personna",
  "Philips Norelco", "Philips Sonicare", "Prilosec", "Proraso", "Redken",
  "Remington", "Revlon", "Revlon Cosmetics", "Sally Hansen", "Schmidt's",
  "Secret", "Sensodyne", "Sonicare", "The Ordinary", "Tom's of Maine", "Tums",
  "Tylenol", "Vaseline", "Vichy", "Vicks", "Wahl", "Waterpik", "Wet n Wild",
  "Zyrtec",
  // ── Baby & kids ───────────────────────────────────────────────
  "4moms", "Aquaphor Baby", "Avent", "Baby Bjorn", "Baby Brezza", "Baby Jogger",
  "BabyBjorn", "Babyganics", "Barbie", "BOB", "BOB Gear", "Boba", "Boon",
  "Boudreaux's", "Britax", "Bruder", "Bugaboo", "Bumbo", "Cetaphil Baby",
  "Chicco", "Clek", "Comotomo", "Coterie", "Crayola", "Cybex", "Desitin",
  "Diono", "Dr. Brown's", "Ergobaby", "Eufy Baby", "Evenflo", "Fisher-Price",
  "Graco", "Green Toys", "Guardian Bikes", "Haakaa", "Halo", "Happiest Baby",
  "Hasbro", "Hatch", "Honest", "Hot Wheels", "Huggies", "Infant Optics",
  "Johnson's", "K2", "Lansinoh", "Lego", "LILLEbaby", "Little Tikes", "Luvs",
  "Mattel", "Maxi-Cosi", "Medela", "Melissa & Doug", "Micro Kickboard", "Moby",
  "Motorola Baby", "Munchkin", "Nanit", "Nanobebe", "Nerf", "Nuna", "Owlet",
  "OXO Tot", "Pampers", "Philips Avent", "Play-Doh", "Playmobil", "Priority",
  "Puracy", "Radio Flyer", "Ravensburger", "Razor", "Rollerblade", "Safety 1st",
  "Schleich", "Schwinn", "Seventh Generation Baby", "Skip Hop", "Snoo",
  "Solly Baby", "Spectra", "Step2", "Strider", "The Honest Company",
  "Thule Chariot", "Tommee Tippee", "Tula", "UPPAbaby", "VTech", "WaterWipes",
  "Woom",
  // ── Office & stationery ───────────────────────────────────────
  "Ampad", "Arches", "Avery", "Bic", "Bostitch", "Brother ScanNCut",
  "Cambridge", "Canson", "Casio Calculator", "Clairefontaine", "Copic",
  "Cricut", "Cross", "Dixon Ticonderoga", "Faber-Castell", "Fellowes",
  "Field Notes", "Five Star", "Golden", "Kaweco", "Kokuyo", "Lamy",
  "Leuchtturm1917", "Liquitex", "Maruman", "Mead", "Micron", "Midori",
  "Moleskine", "Montblanc", "Oxford", "Paper Mate", "Parker Pen", "Pelikan",
  "Pendaflex", "Pentel", "Pilot", "Platinum", "Post-it", "Prismacolor",
  "Rhodia", "Sailor", "Sakura", "Scotch", "Scotch-Brite Office", "Sharpie",
  "Silhouette", "Smead", "Speedball", "Staedtler", "Strathmore", "Swingline",
  "Texas Instruments", "Ticonderoga", "Tombow", "TOPS", "TWSBI", "Uni-ball",
  "Uniball", "Victor", "Waterman", "Westcott", "Winsor & Newton", "X-Acto",
  "Zebra",
  // ── Pets ──────────────────────────────────────────────────────
  "Acana", "Advantage", "Andis Pet", "API", "AquaClear", "Aqueon",
  "Arm & Hammer Litter", "Benebone", "Blue Buffalo", "Blue Wilderness",
  "Bravecto", "Burt's Bees Pets", "Cesar", "Chuckit", "Dentastix",
  "Dr. Elsey's", "Earthbath", "Eheim", "Exo Terra", "Fancy Feast", "Fi",
  "Fluval", "Fresh Step", "Frisco", "Friskies", "Frontline", "Furbo",
  "Furminator", "Greenies", "Hikari", "Hill's", "Hill's Science Diet", "Iams",
  "Instinct", "Kaytee", "Kong", "Litter-Robot", "Marineland", "Merrick",
  "Milk-Bone", "New Life Spectrum", "NexGard", "Nylabone", "Omega One",
  "Orijen", "Outward Hound", "Oxbow", "Pedigree", "Penn-Plax", "PetFusion",
  "PetSafe", "Primal", "Purina", "Purina Pro Plan", "Python", "Royal Canin",
  "Seachem", "Seresto", "Sheba", "Sicce", "Stella & Chewy's",
  "Taste of the Wild", "Temptations", "Tetra", "Tidy Cats", "Tiki Cat",
  "Vet's Best", "Wahl Pet", "Wellness", "Weruva", "West Paw", "Whistle",
  "Wholehearted", "World's Best", "Zilla", "Zoo Med", "Zuke's",
  // ── Music instruments ─────────────────────────────────────────
  "Alvarez", "Ampeg", "Aquarian", "Boss", "Casio", "Charvel", "Cordoba",
  "D'Addario", "DR Strings", "Dunlop", "DW", "EarthQuaker", "Electro-Harmonix",
  "Elixir", "Epiphone", "Ernie Ball", "ESP", "Evans", "Fender", "Fender Amps",
  "Gallien-Krueger", "Gator", "GHS", "Gibson", "Godin", "Gretsch",
  "Gretsch Drums", "Guild", "Hartke", "Hercules", "Hohner", "Ibanez",
  "Istanbul", "Jackson", "JHS", "K&M", "Kala", "Keeley", "Korg", "Korg Tuner",
  "Lanikai", "Lee Oskar", "Levy's", "Line 6", "LTD", "Ludwig", "Mapex",
  "Marshall", "Martin", "Martin Strings", "Meinl", "Mesa Boogie", "Mono",
  "Moog", "MXR", "Nord", "Novation", "On-Stage", "Orange", "Paiste", "Pearl",
  "Peavey", "Peterson", "Promark", "PRS", "Remo", "Roland", "Sabian", "Savarez",
  "Schecter", "Seagull", "Sequential", "SKB Cases", "Snark", "Sonor", "Squier",
  "Strymon", "Suzuki", "Takamine", "Tama", "Taylor", "TC Electronic",
  "Thomastik", "Vater", "Vic Firth", "Vox", "Walrus Audio", "Wampler",
  "Washburn", "Yamaha Music", "Zildjian",
  // ── Watches, eyewear & accessories ────────────────────────────
  "Bulova", "Casio Watch", "Citizen", "Costa", "Costa Del Mar", "Fossil",
  "Foster Grant", "G-Shock", "Goodr", "Hamilton", "Julbo", "Knockaround",
  "Luminox", "Marathon", "Maui Jim", "MVMT", "Nixon", "Oakley", "Orient",
  "Persol", "Ray-Ban", "Seiko", "Suncloud", "Swatch", "Tifosi", "Timex",
  "Tissot", "Vaer", "Warby Parker", "Zenni",
  // ── Luggage & bags ────────────────────────────────────────────
  "Aer", "American Tourister", "Away", "Baggallini", "Bellroy",
  "Briggs & Riley", "Chrome", "Chrome Industries", "Cotopaxi", "Delsey",
  "Eagle Creek", "Eastpak", "Evergoods", "Fjallraven", "Fjällräven", "Hartmann",
  "Herschel", "High Sierra", "JanSport", "Kenneth Cole", "Kipling",
  "London Fog", "Monos", "Ogio", "Pacsafe", "Peak Design Bags", "Ricardo",
  "Samsonite", "Solo New York", "Timbuk2", "Tom Bihn", "Topo Designs",
  "Travelon", "Travelpro", "Tumi", "Victorinox Travel",
  // ── Appliances ────────────────────────────────────────────────
  "A.O. Smith", "Alen", "Amana", "AO Smith", "Aprilaire", "Austin Air",
  "Avanti", "Bertazzoni", "Big Ass Fans", "Blueair", "Bosch Thermotechnology",
  "Bradford White", "Cadet", "Cafe", "Carrier", "Casablanca", "Coway", "Dacor",
  "Danby", "DeLonghi Heater", "Dimplex", "Dr Infrared", "EcoSmart",
  "Electrolux", "Empava", "Fanimation", "Fisher & Paykel", "Friedrich",
  "Frigidaire", "Frigidaire AC", "GE Profile", "Goodman", "Honeywell Fans",
  "Honeywell Home", "Hunter", "Ilve", "IQAir", "JennAir", "King Electric",
  "Kucht", "Lasko", "Lennox", "Levoit", "Magic Chef", "Maytag", "Minka-Aire",
  "Monogram", "Navien", "Noritz", "Perlick", "Rheem", "Rinnai", "Rinnai Heater",
  "Smeg", "Speed Queen", "Stiebel Eltron", "Sub-Zero", "Summit", "Takagi",
  "Thermador", "Trane", "U-Line", "Verona", "Viking", "Vornado", "Whirlpool",
  "Winix", "Wolf", "Zline"
];

// ── data/chinese-major.js ─────────────────────────────────────────────────────

// Knockoff: established brands that are Chinese-owned/operated.
// These are real companies with reputations (not trademark-squat pseudo-brands),
// so they count as "known" by default. A setting lets users flag them anyway.
var KO_CHINESE_MAJOR = [
  "1More", "70mai", "Acebeam", "Amaran", "Amazfit", "Anbernic", "Anker",
  "AnkerWork", "Anycubic", "Aputure", "Aqara", "Aventon", "Bambu Lab", "Baseus",
  "Beelink", "BigTreeTech", "Bluetti", "Choetech", "Chuwi", "Convoy", "Cosori",
  "Creality", "DJI", "Dongcheng", "Dreame", "Dreame Hair", "Dreo", "EcoFlow",
  "Ecovacs", "Edifier", "Elegoo", "Engwe", "Eufy", "EUY", "FeiyuTech", "Fenix",
  "Fiido", "FiiO", "Flashforge", "GMKtec", "Godox", "Gotrax", "Govee", "Gree",
  "Haier", "Hiboy", "Hidizs", "Hisense", "Hollyland", "Holy Stone", "Honor",
  "Hoto", "Huawei", "Hubsan", "Hychika", "ILIFE", "Imalent", "Insta360",
  "Jackery", "Kasa", "Kimo", "Kingroon", "KZ", "Laifen", "Lectric", "Lenovo",
  "Makeblock", "Mercusys", "Meross", "Midea", "Minisforum", "Miyoo", "Moondrop",
  "Moza", "Narwal", "Nebula", "Neewer", "Ninebot", "Nitecore", "Niu", "Olight",
  "OnePlus", "Onn China", "Oppo", "Orico", "Potensic", "Proscenic", "QIDI",
  "Rad Power", "Realme", "Redmi", "Retroid", "Ride1Up", "Roborock", "Ruko",
  "Segway", "Shanling", "Skilhunt", "Slick Gorilla China", "SmallRig", "SMSL",
  "Sofirn", "Sonoff", "Soundcore", "Sovol", "Switchbot", "Tapo", "TCL",
  "Teclast", "Tineco", "Topping", "Tozo", "TP-Link", "Tronsmart", "Tymo",
  "Ugreen", "Ulanzi", "Ultrean", "Vantrue", "Vention", "Viofo", "Vivo", "Wemo",
  "Wolfbox", "WORKPRO", "Wuben", "Wurkkos", "Xiaomi", "Yeelight", "Zhiyun",
  "ZTE"
];

// ── data/flagged-brands.js ────────────────────────────────────────────────────

// Knockoff: seed blocklist of known pseudo-brands / trademark-squat brands.
// Many of these were banned from Amazon in the 2021 review-abuse purge
// (Aukey, Mpow, RavPower, TaoTronics, VicTsing...) or are prolific
// gibberish-name sellers. The heuristic scorer catches the long tail;
// this list guarantees the notorious ones.
var KO_FLAGGED_BRANDS = [
  // 2021 Amazon review-abuse ban wave
  "Atmoko", "Aukey", "Austor", "HOMASY", "Homitt", "Mpow", "OMORC", "RavPower",
  "Sable", "Tacklife", "TaoTronics", "TopElek", "Vava", "Victony", "VicTsing",
  "Vtin",
  // Prolific pseudo-brands
  "Acouto", "Aeun", "Ailun", "AIRAJ", "Airshi", "Alomejor", "Annadue", "Aramox",
  "AUXITO", "BEAMTECH", "Bediffer", "Blackview", "BORDSTRACT", "BOVKE",
  "Chiciris", "Cougar Motor", "Cubot", "Dilwe", "Dioche", "Doact", "DODOCOOL",
  "Doogee", "DOSS", "DOZAWA", "EBTOOLS", "EHEYCIGA", "Ejoyous", "Emoshayoga",
  "Entatial", "Eosnow", "Fahren", "Fdit", "Fintie", "Fockety", "Gedourain",
  "GOOACC", "HAOBAIMEI", "Hilitand", "HOLIFE", "HORUSDY", "Hztyyier", "Jectse",
  "Keenso", "KKmoon", "LASFIT", "LATTOOK", "LETSCOM", "LK", "MAGT", "Mgaxyff",
  "Mkeke", "MoKo", "MOSFiATA", "Naola", "Naroote", "NOCOEX", "Okuyonic",
  "OMOTON", "ORIA", "Oukitel", "Oumefar", "Pilipane", "Plyisty", "ProCase",
  "Pwshymi", "Qiilu", "QWORK", "Salutuy", "SEALIGHT", "Septpenta", "Shanrya",
  "Sonew", "SPYMINNPOO", "Suchinm", "Syncwire", "SZHLUX", "Tbest", "TEKPREM",
  "TiMOVO", "Tnfeeon", "Trianium", "Ulefone", "UMIDIGI", "VANKYO", "VGEBY",
  "Vikye", "Walfront", "WNPETHOME", "Xhuangtech", "YITAMOTOR", "Ymiko", "Yosoo",
  "Yosooo", "Zerone", "Zyyini"
];

// ── data/generic-words.js ─────────────────────────────────────────────────────

// Knockoff: common product-title words. If a title *starts* with one of
// these (or a number/measurement), the listing has no brand up front,
// itself a strong junk signal on Amazon.
var KO_GENERIC_WORDS = [
  "a", "aa", "aaa", "adapter", "adjustable", "adult", "aid", "air", "airpods",
  "alloy", "aluminum", "an", "and", "android", "anti", "anti-slip", "art",
  "artificial", "authentic", "auto", "automatic", "baby", "backpack", "bag",
  "bags", "bamboo", "basket", "bathroom", "batteries", "battery", "bbq", "bed",
  "bedroom", "beer", "belt", "best", "bicycle", "big", "bike", "bin",
  "birthday", "bit", "bits", "black", "blanket", "blue", "bluetooth", "board",
  "boat", "body", "bolts", "boots", "bottle", "bowl", "bowls", "box", "boxes",
  "boys", "bracelet", "brass", "brown", "brush", "brushes", "bulb", "bulbs",
  "bulk", "bundle", "by", "cabinet", "cable", "calendar", "camera", "camping",
  "candle", "candles", "canvas", "cap", "car", "carbide", "carbon", "case",
  "cat", "ceramic", "certified", "chair", "charger", "charging", "children",
  "childrens", "christmas", "chromebook", "clamp", "classic", "cleaner",
  "cleaning", "clear", "cm", "coat", "cobalt", "coffee", "collapsible", "comb",
  "comfortable", "compact", "computer", "container", "converter", "cooler",
  "cooling", "copper", "cord", "cordless", "cotton", "count", "cover", "cream",
  "creative", "ct", "cup", "cups", "curtain", "curtains", "custom", "cute",
  "cutting", "cycling", "decor", "decoration", "decorations", "decorative",
  "deluxe", "desk", "desktop", "diesel", "digital", "disposable", "diy", "dog",
  "double", "drawer", "dress", "drill", "driver", "dual", "durable",
  "dustproof", "duty", "earbuds", "earrings", "easy", "eco", "eco-friendly",
  "electric", "electronic", "emergency", "envelope", "envelopes", "ergonomic",
  "extendable", "extra", "face", "family", "fan", "feet", "first", "fishing",
  "flexible", "flower", "flowers", "foldable", "folder", "folders", "folding",
  "food", "foot", "for", "fork", "frame", "frames", "from", "ft", "funny",
  "galaxy", "gallon", "game", "games", "garage", "garden", "gas", "genuine",
  "gift", "gifts", "girls", "glass", "glasses", "gloves", "glue", "gold",
  "gray", "great", "green", "grey", "grill", "grilling", "grip", "gym", "hair",
  "halloween", "hammer", "hand", "handbag", "handmade", "hanger", "hangers",
  "hardware", "hat", "hdmi", "headphones", "heat", "heater", "heavy", "heavy-duty",
  "high", "hiking", "holder", "home", "hoodie", "hook", "hooks", "hub",
  "hunting", "hydraulic", "ice", "imac", "improved", "in", "inch", "inches",
  "indoor", "instant", "ipad", "iphone", "ipod", "jacket", "jewelry", "journal",
  "keyboard", "kids", "kids'", "kit", "kitchen", "knife", "label", "labels",
  "lamp", "laptop", "large", "lb", "lbs", "leather", "led", "level", "lid",
  "lids", "light", "lighting", "lights", "lightweight", "long", "lotion",
  "luggage", "luxury", "macbook", "magnetic", "makeup", "manual", "marker",
  "markers", "mat", "mats", "mattress", "max", "medical", "medium", "men",
  "men's", "mens", "mesh", "metal", "meter", "microfiber", "midi", "mini",
  "mirror", "mm", "modern", "monitor", "motorcycle", "mount", "mouse", "mug",
  "mugs", "multi", "multifunction", "multifunctional", "multipurpose", "nail",
  "nails", "natural", "necklace", "new", "non", "non-slip", "nonslip",
  "notebook", "novelty", "nuts", "nylon", "of", "office", "official", "oil",
  "on", "or", "orange", "organic", "organizer", "original", "outdoor", "oz",
  "pack", "pair", "pan", "pans", "pants", "paper", "party", "pcs", "pen",
  "pencil", "pencils", "pens", "perfect", "personalized", "pet", "phone",
  "piece", "pieces", "pillow", "pink", "pixel", "planner", "plant", "plants",
  "plastic", "plate", "plates", "pliers", "plus", "pneumatic", "portable",
  "pot", "pots", "power", "powered", "premium", "pro", "professional",
  "propane", "protector", "purple", "purse", "puzzle", "quality", "quart",
  "quick", "rack", "ratchet", "razor", "rechargeable", "red", "removable",
  "repair", "replacement", "resistant", "retractable", "retro", "reusable",
  "ring", "rings", "rubber", "rug", "ruler", "running", "rv", "sae", "safety",
  "sandals", "saw", "scarf", "scissors", "screen", "screwdriver", "screws",
  "security", "set", "shampoo", "sheet", "sheets", "shelf", "shelves", "shirt",
  "shirts", "shockproof", "shoes", "short", "shorts", "silicone", "silver",
  "single", "size", "skin", "skirt", "sleeve", "slim", "slippers", "small",
  "smart", "soap", "socket", "socks", "sofa", "soft", "solar", "spare",
  "speaker", "spoon", "sports", "spray", "stainless", "stand", "steel",
  "sticker", "stickers", "storage", "strong", "sturdy", "sunglasses", "super",
  "survival", "sweater", "t-shirt", "table", "tablet", "tactical", "tape",
  "tea", "the", "thick", "thin", "titanium", "to", "toddler", "tool", "tools",
  "top", "tough", "towel", "towels", "toy", "toys", "transparent", "travel",
  "tray", "triple", "truck", "tungsten", "type-c", "ultra", "unisex",
  "universal", "updated", "upgraded", "usb", "utensil", "utensils", "value",
  "vase", "vintage", "vise", "wall", "wallet", "washable", "watch", "water",
  "waterproof", "wedding", "white", "wide", "windproof", "wine", "wipes",
  "wired", "wireless", "with", "women", "women's", "womens", "wood", "wooden",
  "wrench", "xl", "xlr", "xs", "xxl", "yellow", "yoga"
];

// ── src/detector.js ───────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Knockoff detection engine (pure logic, no DOM access, unit-testable)
//
// How a product gets a verdict, in priority order:
//
//   1. user allowlist        → "allowed"   (never touched)
//   2. user blocklist        → "blocked"   (always acted on)
//   3. seed blocklist        → "flagged"   (data/flagged-brands.js)
//   4. Chinese-major list    → "known" or "flagged" (depends on setting)
//   5. known-brands lists    → "known"     (data/known-brands.js + data/community-brands.js)
//   6. name heuristics       → "flagged" (score ≥ 6) / "suspect" (score ≥ 3) / "unknown"
//   -  no brand in title     → "unbranded"
//   -  non-Latin script      → "foreign"    (fail open: acted on by no level)
//
// Which verdicts get acted on depends on the filter level:
//
//   relaxed  → blocked, flagged
//   standard → blocked, flagged, suspect, unbranded
//   strict   → blocked, flagged, suspect, unbranded, unknown
//              (strict = allowlist-only: anything not recognized is filtered)
//
// The curated allowlist always vetoes the heuristics. Plenty of legitimate
// brands look "gibberish" (ASICS, HOKA, RYOBI), so they must live in a list.
// ─────────────────────────────────────────────────────────────────────────────

var Knockoff = (function () {
  "use strict";

  // Normalize a brand string to a lookup key: lowercase alphanumeric only.
  // "Black+Decker" → "blackdecker", "L'Oreal" → "loreal", "PB Swiss" → "pbswiss"
  // Diacritics are folded, not dropped, so accented spellings collapse onto the
  // plain key: "Müller"/"Muller" → "muller", "Nestlé"/"Nestle" → "nestle". This
  // matters on non-US stores (Wüsthof, Kärcher) and helps the US store too.
  function normalize(s) {
    return (s || "").toLowerCase()
      .normalize("NFD").replace(/\p{Mn}/gu, "")          // fold diacritics: é→e, ü→u
      .replace(/[^a-z0-9]/g, "");
  }

  // ── Script detection ─────────────────────────────────────────────────────
  // The name heuristics assume a Latin-script brand at the front of the title.
  // A title that *leads* with non-Latin script (Japanese, Arabic, Cyrillic — or
  // an English-default store a user switched to such a language) can't be scored
  // that way, so callers only trust the blocklist there and otherwise fail open.
  // We key off the leading brand token, not a whole-title character ratio, so a
  // Latin brand ahead of a local-language description still reads ("3M スコッチ",
  // "Anker モバイルバッテリー" → the brand, not "foreign").

  function firstLetter(s) {
    var chars = Array.from(s || "");
    for (var i = 0; i < chars.length; i++) {
      if (/\p{L}/u.test(chars[i])) return chars[i];
    }
    return "";
  }

  function hasLatinLetters(s) {
    return /\p{Script=Latin}/u.test(s || "");
  }

  // A letter from another script inside an otherwise-Latin name: CJK, or a
  // Cyrillic/Greek homoglyph ("НORUSDY"). Latin accents (ü, é, ñ) are Latin
  // script, so they never count here.
  function hasNonLatinLetter(s) {
    return Array.from(s || "").some(function (c) {
      return /\p{L}/u.test(c) && !/\p{Script=Latin}/u.test(c);
    });
  }

  // Does the title lead with a script we can't score? Decided by the first
  // token that carries a letter (numbers/punctuation are skipped), so a Latin
  // brand ahead of local-language text is NOT treated as foreign.
  function startsWithLocalScript(title) {
    var tokens = (title || "").trim().split(/\s+/);
    for (var i = 0; i < tokens.length; i++) {
      var letter = firstLetter(tokens[i]);
      if (letter) {
        if (/\p{Script=Latin}/u.test(letter)) return false; // Latin brand leads
        // A Greek/Cyrillic first letter on an otherwise-Latin word is a
        // homoglyph trick — let the heuristics score it, don't fail open.
        if ((/\p{Script=Greek}/u.test(letter) || /\p{Script=Cyrillic}/u.test(letter)) &&
            hasLatinLetters(tokens[i])) return false;
        return true; // genuine local-script lead
      }
      var key = normalize(tokens[i]); // no letters: number or punctuation
      if (key && !/^\d+$/.test(key)) return false; // an ASCII code leads ("A4")
      // pure digits / punctuation ("2024", "【") — keep scanning
    }
    return false;
  }

  // ── Indexes ────────────────────────────────────────────────────────────────
  // Sets of normalized keys, built once at startup from the bundled data files
  // plus user lists / refreshed community list from storage.

  var idx = {
    known: new Set(),        // established brands (curated + community list)
    knownMaxWords: 1,        // longest multi-word brand, for title matching
    chineseMajor: new Set(), // established Chinese-owned brands
    flagged: new Set(),      // seed blocklist
    generic: new Set(),      // common title words (unbranded detection)
    // key → display name, so badges can show "DeWalt" not "dewalt"
    display: new Map()
  };

  function addBrands(set, brands) {
    for (var i = 0; i < brands.length; i++) {
      var key = normalize(brands[i]);
      if (!key) continue;
      set.add(key);
      if (!idx.display.has(key)) idx.display.set(key, brands[i]);
      var words = brands[i].trim().split(/\s+/).length;
      if (words > idx.knownMaxWords) idx.knownMaxWords = words;
    }
  }

  // extraKnown / extraFlagged: remotely refreshed lists (arrays of names)
  // from storage: the community allowlist and our curated blocklist.
  function buildIndexes(extraKnown, extraFlagged) {
    idx.known.clear();
    idx.chineseMajor.clear();
    idx.flagged.clear();
    idx.generic.clear();
    idx.display.clear();
    idx.knownMaxWords = 1;

    addBrands(idx.known, KO_KNOWN_BRANDS);
    addBrands(idx.known, KO_COMMUNITY_BRANDS);
    if (extraKnown && extraKnown.length) addBrands(idx.known, extraKnown);
    addBrands(idx.chineseMajor, KO_CHINESE_MAJOR);
    idx.chineseMajor.forEach(function (k) { idx.known.add(k); });
    addBrands(idx.flagged, KO_FLAGGED_BRANDS);
    if (extraFlagged && extraFlagged.length) addBrands(idx.flagged, extraFlagged);
    for (var i = 0; i < KO_GENERIC_WORDS.length; i++) {
      idx.generic.add(normalize(KO_GENERIC_WORDS[i]));
    }
  }

  // ── Brand extraction ───────────────────────────────────────────────────────
  // Amazon search cards have no structured brand field; the brand is the first
  // word(s) of the title, when there is one at all. Strategy:
  //
  //   1. Slide a window (longest first) over the leading title words and look
  //      for a match in any list; catches "Klein Tools", "PB Swiss Tools".
  //   2. No list match → take the first word as a brand *candidate*, unless it
  //      is a number/measurement or a generic word ("2-Piece...", "Magnetic...")
  //      → those listings are "unbranded".
  //
  // Ambiguity guard: words like Case, Shark, Ball are both real brands and
  // ordinary words. If the first word is in BOTH the generic list and a brand
  // list, we only call it a brand when the following word is not generic
  // ("Shark Navigator" → brand, "Case for iPhone" → unbranded).

  function tokenKey(tokens, n) {
    return normalize(tokens.slice(0, n).join(""));
  }

  // Scan the leading ASCII tokens of a local-script title for a *listed*
  // pseudo-brand ("任天堂 … HORUSDY" → HORUSDY). Only the blocklist/user lists
  // count — a known brand mentioned mid-title is usually just compatibility text
  // ("charger for Samsung"), so we don't greenlight those.
  function flaggedBrandInTokens(tokens, userKeys) {
    var ascii = tokens.filter(function (t) { return normalize(t).length > 0; });
    var maxStart = Math.min(3, ascii.length - 1);
    for (var start = 0; start <= maxStart; start++) {
      var maxWin = Math.min(idx.knownMaxWords, 4, ascii.length - start);
      for (var n = maxWin; n >= 1; n--) {
        var key = normalize(ascii.slice(start, start + n).join(""));
        if (!key) continue;
        if (idx.flagged.has(key) || (userKeys && userKeys.has(key))) {
          return { name: ascii.slice(start, start + n).join(" "), key: key, listed: true };
        }
      }
    }
    return null;
  }

  function extractBrand(title, userKeys) {
    if (!title) return null;

    // Local-script lead (Japanese, Arabic, …): the leading brand can't be read
    // or scored, so only the blocklist is reliable here. Find a listed
    // pseudo-brand if one appears; otherwise let classify() fail open.
    if (startsWithLocalScript(title)) {
      return flaggedBrandInTokens(title.trim().split(/\s+/).slice(0, 8), userKeys);
    }

    var tokens = title.trim().split(/\s+/).filter(function (t) {
      return normalize(t).length > 0; // drop lone punctuation ("WERA - 0505...")
    }).slice(0, 8);
    if (!tokens.length) return null;

    var maxWin = Math.min(idx.knownMaxWords, 4, tokens.length);
    for (var n = maxWin; n >= 1; n--) {
      var key = tokenKey(tokens, n);
      if (!key) continue;
      var listed = idx.known.has(key) || idx.flagged.has(key) ||
                   (userKeys && userKeys.has(key));
      if (!listed) continue;
      // ambiguity guard for single ordinary-word brands
      if (n === 1 && idx.generic.has(key)) {
        var next = normalize(tokens[1] || "");
        if (!next || idx.generic.has(next) || /^\d/.test(tokens[1])) continue;
      }
      return { name: tokens.slice(0, n).join(" "), key: key, listed: true };
    }

    // No list match: first word as candidate, or unbranded.
    var first = tokens[0].replace(/[,:;!]+$/, "");
    var fkey = normalize(first);
    if (!fkey || fkey.length < 2) return null;
    if (/^\d/.test(first)) return null;             // "2-Piece", "26Pcs", "1/4"
    // Model/spec codes ("CR2032", "MR16", "ESP32") and metric fastener sizes
    // ("M6x1.0", "M6/M8/M10", "M6*20mm" → "m6x10", "m6m8m10", "m620mm") are
    // parts, not brands: a short letter prefix then digits, with at most
    // 2-letter runs between digit groups. Real brands of this shape (WD-40,
    // K2, No7) are on the lists, which matched above; this only rejects
    // unlisted candidates.
    if (/^[a-z]{1,3}\d+(?:[a-z]{0,2}\d+)*[a-z]{0,2}$/.test(fkey)) return null;
    if (idx.generic.has(fkey)) return null;         // "Magnetic Bit Driver..."
    return { name: first, key: fkey, listed: false };
  }

  // ── Name heuristics ────────────────────────────────────────────────────────
  // Scores how much an *unknown* brand name looks like a trademark-squat
  // pseudo-brand (SZHLUX, HORUSDY, TEKPREM...). These names exist because
  // unique nonsense strings sail through the USPTO and unlock Amazon Brand
  // Registry. Signature: 4-10 chars, ALL CAPS, consonant-heavy.
  //
  // Score ≥ 6 → "flagged" (high confidence junk)
  // Score ≥ 3 → "suspect" (probably junk; filtered at standard level and up)
  //
  // Never applied to brands on any known list; the allowlist is the veto.

  function scoreBrand(name) {
    var s = 0;
    var reasons = [];
    var letters = name.replace(/[^a-zA-Z]/g, "");
    if (!letters) return { score: 0, reasons: reasons };

    // A non-Latin-script letter inside an otherwise-Latin name (CJK, or a
    // Cyrillic/Greek homoglyph like "НORUSDY") is near-certain junk. Latin
    // accents (ü, é, ñ) are Latin script and exempt, so real brands don't trip it.
    if (hasNonLatinLetter(name)) { s += 4; reasons.push("non-Latin characters"); }

    var isAllCaps = letters === letters.toUpperCase() && letters.length >= 3;
    if (isAllCaps) {
      s += 3; reasons.push("all-caps name");
      if (letters.length >= 5 && letters.length <= 9) {
        s += 1; reasons.push("typical squat-name length");
      }
    }

    var vowels = (letters.match(/[aeiouyAEIOUY]/g) || []).length;
    var ratio = vowels / letters.length;
    if (ratio < 0.18) { s += 3; reasons.push("almost no vowels"); }
    else if (ratio < 0.28) { s += 1; reasons.push("few vowels"); }
    else if (ratio > 0.62) { s += 1; reasons.push("mostly vowels"); }

    // A run spanning a lowercase→uppercase seam is a compound of two
    // pronounceable words ("SuperStroke" → r|Str), not gibberish — break at
    // the seams first. Squat names are all-caps or all-lower, so no seams.
    var seamed = letters.replace(/([a-z])([A-Z])/g, "$1 $2");
    if (/[bcdfghjklmnpqrstvwxz]{4,}/i.test(seamed)) {
      s += 3; reasons.push("unpronounceable consonant run");
    }

    if (/q(?!u)|[jvwx]x|x[jkqz]|z[xjq]|[bcdfgp]z/i.test(letters)) {
      s += 2; reasons.push("un-English letter pairs");
    }

    if (/\d/.test(name) && !/^\d/.test(name)) {
      s += 1; reasons.push("digits inside name");
    }

    // iBeGoo / eSynic style random internal capitalization
    var flips = (name.match(/[a-z][A-Z]/g) || []).length;
    if (flips >= 2) { s += 2; reasons.push("random capitalization"); }

    return { score: s, reasons: reasons };
  }

  // ── Compatibility bait ─────────────────────────────────────────────────────
  // Accessory junk courts the big ecosystems by name ("Compatible with
  // Samsung Galaxy S24, iPhone 16..."). Established accessory brands write
  // identical titles, but they sit on the known lists, which short-circuit
  // before the heuristics run — so this only has to be safe for unlisted
  // brands, and an unlisted brand name-dropping Apple/Samsung hardware is
  // the pseudo-brand signature.
  var COMPAT_BAIT = new Set([
    "apple", "iphone", "ipad", "ipod", "macbook", "airpods",
    "samsung", "galaxy"
  ]);

  var COMPAT_MARKERS = new Set([
    "compatible", "for", "fits", "fit", "with", "works", "support", "supports"
  ]);

  function hasCompatMarker(words, index) {
    var start = Math.max(0, index - 3);
    for (var i = start; i < index; i++) {
      if (COMPAT_MARKERS.has(words[i].toLowerCase())) return true;
    }
    return false;
  }

  // First ecosystem word in a compatibility phrase that isn't the brand itself,
  // as written in the title ("iPhone"), or null. Split on non-alphanumerics so
  // "iPhone/iPad" and "(Samsung)" still read.
  function compatBait(title, brandKey) {
    var words = (title || "").split(/[^A-Za-z0-9]+/);
    for (var i = 0; i < words.length; i++) {
      var key = words[i].toLowerCase();
      if (COMPAT_BAIT.has(key) && key !== brandKey && hasCompatMarker(words, i)) return words[i];
    }
    return null;
  }

  // ── Media categories ───────────────────────────────────────────────────────
  // In creator-titled and digital categories (books, music, movies, apps...)
  // the tile title is the work, not a brand-led product name, so the whole
  // extraction model misfires ("The Midnight Library" → unbranded, "SPQR" →
  // flagged). The content script skips scanning entirely when the page's
  // search alias is one of these. Alias strings are identical across
  // marketplaces (verified on .com/.co.uk/.de/.co.jp); only Movies & TV
  // varies ("movies-tv" US, "dvd" elsewhere). "videogames" is deliberately
  // absent: it's dominated by physical accessories, prime pseudo-brand
  // territory.

  var MEDIA_ALIASES = new Set([
    "english-books",  // foreign-language books (.co.jp)
    "digital-text",   // Kindle Store
    "audible",
    "popular",        // CDs & Vinyl (historic alias)
    "digital-music",
    "movies-tv",
    "dvd",
    "instant-video",  // Prime Video
    "magazines",
    "mobile-apps",
    "software",
    "gift-cards"
  ]);

  function isMediaAlias(alias) {
    if (!alias) return false;
    // prefix match covers "stripbooks" and "stripbooks-intl-ship"
    return alias.indexOf("stripbooks") === 0 || MEDIA_ALIASES.has(alias);
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  // settings: { level, flagChineseMajor }
  // userAllow / userBlock: Sets of normalized keys.

  function classify(title, settings, userAllow, userBlock) {
    var userKeys = new Set();
    userAllow.forEach(function (k) { userKeys.add(k); });
    userBlock.forEach(function (k) { userKeys.add(k); });

    var b = extractBrand(title, userKeys);
    if (!b) {
      // Local-script title with no listed pseudo-brand: we can't read it, so
      // fail open. "foreign" is acted on by no filter level (unlike "unbranded",
      // which standard would filter — dimming whole pages on .co.jp/.sa/.eg).
      if (startsWithLocalScript(title)) {
        return { verdict: "foreign", brand: null, key: null,
                 reason: "listing isn't in a script Knockoff can read yet" };
      }
      return { verdict: "unbranded", brand: null, key: null,
               reason: "no brand at the front of the listing title" };
    }

    var r = { brand: b.name, key: b.key };

    if (userAllow.has(b.key)) {
      r.verdict = "allowed"; r.reason = "on your allowlist"; return r;
    }
    if (userBlock.has(b.key)) {
      r.verdict = "blocked"; r.reason = "on your blocklist"; return r;
    }
    if (idx.flagged.has(b.key)) {
      r.verdict = "flagged"; r.reason = "on the known pseudo-brand list"; return r;
    }
    if (idx.chineseMajor.has(b.key)) {
      if (settings.flagChineseMajor) {
        r.verdict = "flagged"; r.reason = "established Chinese brand (flagged by your settings)";
      } else {
        r.verdict = "known"; r.reason = "established brand (Chinese-owned)";
      }
      return r;
    }
    if (idx.known.has(b.key)) {
      r.verdict = "known"; r.reason = "established brand"; return r;
    }

    var h = scoreBrand(b.name);
    // An unlisted brand whose title name-drops ecosystem hardware it doesn't
    // make ("...for iPhone 16, Samsung Galaxy") is selling compatibility
    // bait. Worth "suspect" on its own, but never "flagged": small legit
    // makers write these titles too, so hiding at relaxed level still
    // requires name-shape evidence from scoreBrand().
    var bait = compatBait(title, b.key);
    if (bait && h.score < 6) {
      h.score = Math.min(h.score + 3, 5);
      h.reasons.push("name-drops " + bait + " for compatibility");
    }
    r.score = h.score;
    if (h.score >= 6) {
      r.verdict = "flagged"; r.reason = "looks like a pseudo-brand: " + h.reasons.join(", ");
    } else if (h.score >= 3) {
      r.verdict = "suspect"; r.reason = "unrecognized brand: " + h.reasons.join(", ");
    } else {
      r.verdict = "unknown"; r.reason = "brand not on any list";
    }
    return r;
  }

  // ── Seller names (product pages) ───────────────────────────────────────────
  // The "Sold by" line speaks the same language as pseudo-brand names: junk
  // sellers are usually "<gibberish> Direct/Official Store/US". Score the
  // distinctive tokens with the same engine, ignoring commerce boilerplate.
  // Conservative on purpose (false positives are worse): a known brand
  // anywhere in the seller name vetoes the heuristics, and callers should
  // only surface suspect/flagged/blocked — never nag about clean sellers.

  var SELLER_NOISE = new Set([
    "co", "ltd", "inc", "llc", "limited", "company", "corp", "gmbh",
    "store", "shop", "shops", "mall", "outlet", "retail", "market",
    "direct", "official", "authorized", "flagship", "online", "global",
    "international", "trading", "trade", "technology", "tech", "group",
    "industry", "industries", "supply", "supplies", "service", "services",
    "seller", "sales", "warehouse", "depot", "express", "home", "life",
    "us", "usa", "uk", "eu", "ca", "de", "fr", "jp", "na", "the", "and"
  ]);

  function classifySeller(name, userAllow, userBlock) {
    var key = normalize(name);
    if (!key) return { verdict: "unknown", name: name, reason: "no readable seller name" };
    var r = { name: name.trim() };
    if (userAllow && userAllow.has(key)) {
      r.verdict = "allowed"; r.reason = "seller is on your allowlist"; return r;
    }
    if (userBlock && userBlock.has(key)) {
      r.verdict = "blocked"; r.reason = "seller is on your blocklist"; return r;
    }
    if (idx.flagged.has(key)) {
      r.verdict = "flagged"; r.reason = "seller name is on the known pseudo-brand list"; return r;
    }
    if (idx.known.has(key)) {
      r.verdict = "known"; r.reason = "storefront of an established brand"; return r;
    }

    var tokens = name.trim().split(/\s+/);
    var best = { score: 0, reasons: [] };
    for (var i = 0; i < tokens.length; i++) {
      var tkey = normalize(tokens[i]);
      if (!tkey || SELLER_NOISE.has(tkey) || /^\d+$/.test(tkey)) continue;
      // Per-token list checks: "SZHLUX Direct" → flagged token; a known-brand
      // token ("Anker Direct") vetoes, same as the title pipeline.
      if (idx.flagged.has(tkey) || (userBlock && userBlock.has(tkey))) {
        r.verdict = "flagged"; r.reason = "seller name contains a listed pseudo-brand"; return r;
      }
      if (idx.known.has(tkey) || (userAllow && userAllow.has(tkey))) {
        r.verdict = "known"; r.reason = "storefront of an established brand"; return r;
      }
      var h = scoreBrand(tokens[i]);
      if (h.score > best.score) best = h;
    }
    r.score = best.score;
    if (best.score >= 6) {
      r.verdict = "flagged"; r.reason = "seller name looks like a pseudo-brand: " + best.reasons.join(", ");
    } else if (best.score >= 3) {
      r.verdict = "suspect"; r.reason = "unrecognized seller: " + best.reasons.join(", ");
    } else {
      r.verdict = "unknown"; r.reason = "seller not on any list";
    }
    return r;
  }

  // Which verdicts get acted on at each filter level.
  var ACT_ON = {
    relaxed:  { blocked: 1, flagged: 1 },
    standard: { blocked: 1, flagged: 1, suspect: 1, unbranded: 1 },
    strict:   { blocked: 1, flagged: 1, suspect: 1, unbranded: 1, unknown: 1 }
  };

  function shouldAct(verdict, level) {
    return !!(ACT_ON[level] || ACT_ON.standard)[verdict];
  }

  function displayName(key) {
    return idx.display.get(key) || key;
  }

  return {
    normalize: normalize,
    buildIndexes: buildIndexes,
    extractBrand: extractBrand,
    scoreBrand: scoreBrand,
    classify: classify,
    classifySeller: classifySeller,
    shouldAct: shouldAct,
    isMediaAlias: isMediaAlias,
    displayName: displayName,
    _idx: idx // exposed for tests/debugging
  };
})();

// ── src/pdp-brand.js ──────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Knockoff product-detail-page brand extraction
//
// Amazon localizes the visible byline text ("Visit the ... Store",
// "Besuche den ...-Store", "Marca: ..."), but the byline link usually carries
// a stable brand signal. Prefer URL parameters, keep English text as a legacy
// fallback, and use /stores/<brand>/ as a final locale-agnostic fallback.
// ─────────────────────────────────────────────────────────────────────────────

var KnockoffPdp = (function () {
  "use strict";

  function cleanUrlBrand(s) {
    var decoded = (s || "").replace(/\+/g, " ");
    try {
      decoded = decodeURIComponent(decoded);
    } catch (e) {
      // Keep the original text if a marketplace ever emits a literal "%".
    }
    return decoded.replace(/[-_]+/g, " ").trim();
  }

  function bylineUrl(byline, baseHref) {
    var href = byline && byline.getAttribute ? byline.getAttribute("href") : "";
    if (!href) return null;
    try {
      return new URL(href, baseHref || location.href);
    } catch (e) {
      return null;
    }
  }

  function brandFromBylineBrandParam(url) {
    if (!url) return "";
    var brand = url.searchParams.get("field-brandtextbin");
    if (brand) return cleanUrlBrand(brand);
    var rh = url.searchParams.get("rh") || "";
    var m = rh.match(/(?:^|,)p_89:([^,]+)/);
    if (m) return cleanUrlBrand(m[1]);
    brand = url.searchParams.get("field-keywords");
    return brand ? cleanUrlBrand(brand) : "";
  }

  function brandFromBylineText(byline) {
    var text = (byline && byline.textContent || "").trim();
    // Legacy fallback for bylines whose href doesn't expose the brand:
    // "Brand: LATTOOK" or "Visit the LATTOOK Store".
    var m = text.match(/^(?:Brand:\s*|Visit the\s+)(.+?)(?:\s+Store)?$/);
    return m ? m[1].trim() : "";
  }

  function brandFromBylineStoreHref(url) {
    if (!url) return "";
    var parts = url.pathname.split("/").filter(Boolean);
    var stores = parts.indexOf("stores");
    if (stores >= 0 && parts[stores + 1] && !/^(?:page|storefront)$/i.test(parts[stores + 1])) {
      return cleanUrlBrand(parts[stores + 1]); // /stores/CACOE/page/...
    }
    return "";
  }

  function brandFromByline(byline, baseHref) {
    var url = bylineUrl(byline, baseHref);
    return brandFromBylineBrandParam(url) ||
      brandFromBylineText(byline) ||
      brandFromBylineStoreHref(url);
  }

  return {
    brandFromByline: brandFromByline,
    _test: {
      cleanUrlBrand: cleanUrlBrand,
      brandFromBylineBrandParam: brandFromBylineBrandParam,
      brandFromBylineText: brandFromBylineText,
      brandFromBylineStoreHref: brandFromBylineStoreHref
    }
  };
})();

// ── src/content.js ────────────────────────────────────────────────────────────

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
  var BRANDS_URL = "https://api.knockoff.shopping/brands";
  var BRANDS_REFRESH_MS = 24 * 60 * 60 * 1000;

  // One-click misclassification reports (see report-worker/). Set this to your
  // deployed worker URL. Leave empty to fall back to opening a GitHub issue.
  var REPORT_ENDPOINT = "https://api.knockoff.shopping";
  var REPO_URL = "https://github.com/Shpigford/knockoff";

  var DEFAULTS = {
    enabled: true,
    action: "dim",            // hide | dim | label
    level: "standard",        // relaxed | standard | strict
    flagChineseMajor: false,  // also flag established Chinese brands
    showKnownBadge: false,    // show a ✓ badge on recognized brands too
    hideSponsored: false,     // hide Amazon "Sponsored" search tiles (opt-in)
    allow: [],                // user allowlist (display names)
    block: []                 // user blocklist (display names)
  };

  var settings = Object.assign({}, DEFAULTS);
  var userAllow = new Set();
  var userBlock = new Set();
  // brands: normalized key → { name, verdict, count } for tiles acted on,
  // feeding the panel's "Filtered brands" list.
  var stats = { scanned: 0, filtered: 0, byVerdict: {}, brands: {} };
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
    return chrome.storage.local.get(["communityBrands", "remoteFlagged", "communityFetchedAt"]).then(function (c) {
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
    var h2 = tile.querySelector("h2");
    var text = h2
      ? h2.textContent || h2.getAttribute("aria-label") || ""
      : (tile.querySelector("a.a-text-normal") || {}).textContent || "";
    return text.replace(SPONSORED_PREFIX, "");
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
      if (result.brand) {
        var entry = stats.brands[result.key] ||
          (stats.brands[result.key] = { name: result.brand, verdict: result.verdict, count: 0 });
        entry.count++;
      }
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
          sendReport(result, suggestion, tile.getAttribute("data-asin"), tileTitle(tile));
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
  function sendReport(result, suggestion, asin, productTitle) {
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
        extVersion: chrome.runtime.getManifest().version,
        // Review context: what the product was and why it got that verdict.
        title: (productTitle || "").slice(0, 150) || null,
        reason: (result.reason || "").slice(0, 200) || null
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
    processPdpByline();
    processPdpSeller();
  }

  function processPdpByline() {
    var byline = document.getElementById("bylineInfo");
    if (!byline || document.querySelector(".ko-pdp-brand")) return;
    var brandName = KnockoffPdp.brandFromByline(byline, location.href);
    if (!brandName) return;
    var result = Knockoff.classify(brandName, settings, userAllow, userBlock);
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
    flagged: { icon: "tagSlash", label: "Likely junk seller" },
    suspect: { icon: "alert",    label: "Suspect seller" }
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
    el.insertAdjacentElement("afterend", badge);
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

    // filtered-brands list (rendered by updatePanelState; hidden when empty)
    var brandList = el("div", "ko-panel-brands");
    brandList.id = "ko-panel-brands";
    panel.appendChild(brandList);

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

  // The panel's per-search breakdown: which brands were filtered, how often,
  // with a one-click way to fix a false positive in place (trust the brand,
  // or unblock it if the user's own blocklist caught it). Only rebuilt when
  // its content actually changes — our MutationObserver watches the whole
  // body, and an unconditional rebuild would re-trigger it forever.
  function renderPanelBrands(list) {
    var entries = Object.keys(stats.brands).map(function (k) {
      return { key: k, name: stats.brands[k].name, verdict: stats.brands[k].verdict,
               count: stats.brands[k].count };
    }).sort(function (a, b) { return b.count - a.count || (a.name < b.name ? -1 : 1); });

    var state = entries.map(function (e) { return e.key + ":" + e.count + ":" + e.verdict; }).join("|");
    if (list.getAttribute("data-ko-state") === state) return;
    list.setAttribute("data-ko-state", state);
    list.textContent = "";
    list.style.display = entries.length ? "" : "none";
    if (!entries.length) return;

    var heading = el("div", "ko-panel-label");
    heading.textContent = "Filtered brands";
    list.appendChild(heading);
    var MAX_ROWS = 8;
    entries.slice(0, MAX_ROWS).forEach(function (e) {
      var row = el("div", "ko-brand-row ko-v-" + e.verdict);
      row.appendChild(el("span", "ko-brand-dot"));
      var name = el("span", "ko-brand-name");
      name.textContent = e.name;
      name.title = e.name;
      row.appendChild(name);
      var count = el("span", "ko-brand-count");
      count.textContent = "×" + e.count;
      row.appendChild(count);
      var blocked = userBlock.has(e.key);
      var fix = document.createElement("button");
      fix.type = "button";
      fix.className = "ko-brand-trust";
      fix.innerHTML = ICONS[blocked ? "ban" : "shield"]; // static markup only
      fix.title = blocked ? "Unblock " + e.name : "Trust " + e.name;
      fix.addEventListener("click", function () {
        if (blocked) setListMembership("block", e.name, false);
        else setListMembership("allow", e.name, true);
        // storage.onChanged reloads settings and rescans; the row disappears.
      });
      row.appendChild(fix);
      list.appendChild(row);
    });
    if (entries.length > MAX_ROWS) {
      var more = el("div", "ko-brand-more");
      more.textContent = "+" + (entries.length - MAX_ROWS) + " more";
      list.appendChild(more);
    }
  }

  // Refresh the panel's numbers and control states from current settings,
  // called after every scan so the count ticks live while scrolling.
  function updatePanelState() {
    var panel = document.getElementById("ko-panel");
    if (!panel) return;
    renderPanelBrands(document.getElementById("ko-panel-brands"));
    panel.classList.toggle("ko-panel-off", !settings.enabled);
    document.getElementById("ko-panel-enabled").checked = settings.enabled;
    document.getElementById("ko-panel-sponsored").checked = settings.hideSponsored;
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

  // Wipe all Knockoff marks from the page. Used before re-applying from
  // scratch, and when an in-page navigation lands on a media category where
  // previously-badged tiles must be released.
  function clearMarks() {
    stats = { scanned: 0, filtered: 0, byVerdict: {}, brands: {} };
    document.querySelectorAll("[data-ko-verdict]").forEach(function (tile) {
      tile.removeAttribute("data-ko-verdict");
      tile.removeAttribute("data-ko-brand");
      tile.classList.remove("ko-act", "ko-hide", "ko-dim", "ko-label");
    });
    document.querySelectorAll(".ko-badge, .ko-menu, #ko-pill").forEach(function (el) {
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
        document.querySelectorAll(TILE_SELECTORS).forEach(processTile);
      }
      // Product pages stay badged regardless: the dropdown can carry a stale
      // department onto a PDP, and book PDPs are inherently safe (their
      // byline is an author div the brand extractor returns nothing for).
      processProductPage();
    }
    updatePill();
    updatePanelState();
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
    if (area === "local" && (changes.communityBrands || changes.remoteFlagged)) {
      chrome.storage.local.get(["communityBrands", "remoteFlagged"]).then(function (c) {
        Knockoff.buildIndexes(c.communityBrands || null, c.remoteFlagged || null);
        rescan();
      });
      return;
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

  loadSettings()
    .then(loadCommunityList)
    .then(function (cached) {
      Knockoff.buildIndexes(cached.communityBrands || null, cached.remoteFlagged || null);
      scan();
      new MutationObserver(scheduleScan).observe(document.body, {
        childList: true,
        subtree: true
      });
    });
})();

})();
