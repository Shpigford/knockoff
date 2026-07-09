#!/usr/bin/env node
// Smoke test for the userscript bundle: boots dist/knockoff.user.js in a
// stub DOM and checks the whole pipeline end-to-end — GM-backed storage
// shim loads, indexes build, a junk search tile gets a verdict and the
// configured action, a known brand is left alone, and a settings write
// through the shim fires onChanged and triggers a rescan.
//
//   node scripts/build-userscript.js && node tests/userscript-smoke.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const bundlePath = path.join(__dirname, "..", "dist", "knockoff.user.js");
if (!fs.existsSync(bundlePath)) {
  console.error("dist/knockoff.user.js not built — run scripts/build-userscript.js first");
  process.exit(1);
}

// ── Minimal DOM ─────────────────────────────────────────────────────────────

class FakeEl {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.classes = new Set();
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
    this.classList = {
      add: (...cs) => cs.forEach((c) => this.classes.add(c)),
      remove: (...cs) => cs.forEach((c) => this.classes.delete(c)),
      toggle: (c, force) => {
        const on = force === undefined ? !this.classes.has(c) : force;
        on ? this.classes.add(c) : this.classes.delete(c);
        return on;
      },
      contains: (c) => this.classes.has(c)
    };
  }
  appendChild(c) { this.children.push(c); return c; }
  insertAdjacentElement() {}
  remove() {}
  addEventListener() {}
  removeEventListener() {}
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get clientWidth() { return 300; }
}

// A search tile: <div data-asin><h2>title</h2></div>
function makeTile(asin, title) {
  const tile = new FakeEl("div");
  tile.setAttribute("data-asin", asin);
  const h2 = new FakeEl("h2");
  h2.textContent = title;
  tile.querySelector = (sel) => (sel === "h2" ? h2 : null);
  return tile;
}

const tiles = [
  makeTile("B0JUNK", "SZHLUX Screwdriver Set, 144-in-1 Precision Kit"),
  makeTile("B0REAL", "DEWALT Screwdriver Bit Set with Tough Case, 45-Piece")
];

const documentStub = {
  head: new FakeEl("head"),
  body: new FakeEl("body"),
  documentElement: new FakeEl("html"),
  createElement: (tag) => new FakeEl(tag),
  createTextNode: (t) => ({ text: t }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: (sel) => {
    if (sel.indexOf("s-search-result") >= 0) return tiles;
    if (sel.indexOf("[data-ko-verdict]") >= 0) return tiles.filter((t) => t.hasAttribute("data-ko-verdict"));
    return [];
  },
  addEventListener: () => {},
  removeEventListener: () => {}
};

// ── GM storage stub (async, like Userscripts for Safari) ────────────────────

const gmStore = new Map();
const GM = {
  listValues: async () => Array.from(gmStore.keys()),
  getValue: async (k, d) => (gmStore.has(k) ? gmStore.get(k) : d),
  setValue: async (k, v) => { gmStore.set(k, v); },
  deleteValue: async (k) => { gmStore.delete(k); }
};

const ctx = vm.createContext({
  document: documentStub,
  location: { hostname: "www.amazon.com", href: "https://www.amazon.com/s?k=x", search: "?k=x" },
  MutationObserver: class { observe() {} disconnect() {} },
  fetch: () => Promise.reject(new Error("offline")), // bundled lists must carry the day
  URL, URLSearchParams, GM,
  setTimeout, clearTimeout, console, __KO_TEST__: true
});

vm.runInContext(fs.readFileSync(bundlePath, "utf8"), ctx, { filename: "knockoff.user.js" });

// ── Checks ──────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; } else { fail++; console.log(`✗ ${name}${detail ? ` (${detail})` : ""}`); }
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await settle(400); // boot: shim ready → indexes → initial scan

  const [junk, real] = tiles;
  check("junk tile got a verdict", junk.getAttribute("data-ko-verdict") === "flagged",
    `got ${junk.getAttribute("data-ko-verdict")}`);
  check("junk tile acted on (dim default)", junk.classes.has("ko-act") && junk.classes.has("ko-dim"),
    [...junk.classes].join(","));
  check("junk tile badged", junk.children.some((c) => /ko-badge/.test(c.className || "")));
  check("known brand untouched", real.getAttribute("data-ko-verdict") === "known" && !real.classes.has("ko-act"),
    `got ${real.getAttribute("data-ko-verdict")}`);
  check("launcher present", documentStub.body.children.some((c) => c.id === "ko-launcher"));

  // A settings write through the shim must fire onChanged → rescan → re-act.
  await vm.runInContext("chrome.storage.sync.set({ action: 'hide' })", ctx);
  await settle(250);
  check("settings write persisted to GM", gmStore.get("sync.action") === '"hide"', gmStore.get("sync.action"));
  check("rescan applied new action", junk.classes.has("ko-hide"), [...junk.classes].join(","));

  console.log(`${pass}/${pass + fail} userscript smoke checks pass`);
  process.exit(fail ? 1 : 0);
})();
