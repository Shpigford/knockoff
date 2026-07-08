// ─────────────────────────────────────────────────────────────────────────────
// Knockoff report worker (Cloudflare Worker + D1)
//
// Accepts brand misclassification reports from the extension and stores them
// for review. No accounts, no cookies, no PII. The reporter IP is only ever
// stored as a salted hash, and only to rate-limit abuse.
//
//   POST /report                     one report (JSON body, see below)
//   GET  /brands                     known-brands list (text, one per line;
//                                    served from D1 and edge-cached 6h; the
//                                    extension's daily refresh hits this)
//   GET  /flagged                    curated blocklist additions (text, one
//                                    per line; extensions fetch daily)
//   GET  /review?token=...           HTML triage dashboard: queue of uncurated
//                                    brands + one-click Trust/Block/Dismiss
//   POST /curate?token=...           {brand, list: "flagged"|"known"|"dismissed"}
//                                    to decide, {brand, remove: true} to undo
//   GET  /reports?token=...&days=7   recent reports (JSON, review only)
//   GET  /tallies?token=...          per-brand vote tallies (JSON, review only)
//   GET  /queue?token=...            triage queue, same rows the dashboard
//                                    shows (JSON, review only)
//
// Deploy (from this directory):
//   wrangler d1 create knockoff-reports          # once; put the id in wrangler.toml
//   wrangler d1 execute knockoff-reports --file=schema.sql --remote
//   wrangler d1 execute knockoff-reports --file=migrate-triage.sql --remote  # pre-existing DBs, once
//   wrangler d1 execute knockoff-reports --file=seed-brands.sql --remote  # once
//   wrangler secret put REVIEW_TOKEN             # any long random string
//   wrangler secret put IP_SALT                  # any long random string
//   wrangler deploy
// Then set REPORT_ENDPOINT in the extension's src/content.js to the worker URL.
// ─────────────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const MAX_REPORTS_PER_IP_PER_HOUR = 30;

const BRANDS_CACHE_SECONDS = 6 * 60 * 60;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function handleReport(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const brand = String(body.brand || "").trim().slice(0, 64);
  const brandKey = normalize(brand);
  const suggestion = body.suggestion;
  if (!brandKey) return json({ error: "brand required" }, 400);
  if (suggestion !== "is_junk" && suggestion !== "not_junk") {
    return json({ error: "suggestion must be is_junk or not_junk" }, 400);
  }

  const asin = /^[A-Z0-9]{10}$/.test(body.asin || "") ? body.asin : null;
  const verdict = String(body.verdict || "").slice(0, 20) || null;
  const marketplace = String(body.marketplace || "").slice(0, 40) || null;
  const extVersion = String(body.extVersion || "").slice(0, 20) || null;
  const title = String(body.title || "").slice(0, 150) || null;
  const reason = String(body.reason || "").slice(0, 200) || null;

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await sha256(env.IP_SALT + ip);

  const { count } = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM reports WHERE ip_hash = ?1 AND created_at > datetime('now', '-1 hour')"
  ).bind(ipHash).first();
  if (count >= MAX_REPORTS_PER_IP_PER_HOUR) {
    return json({ error: "rate limited" }, 429);
  }

  // One row per reporter per brand: reporting the same brand again updates
  // the earlier vote instead of stacking the tally. COALESCE keeps context
  // fields (ASIN, title...) from an earlier report when the new one lacks them.
  await env.DB.prepare(
    `INSERT INTO reports (brand, brand_key, suggestion, verdict, asin, marketplace, ext_version, ip_hash, title, reason)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT (ip_hash, brand_key) DO UPDATE SET
       brand = excluded.brand, suggestion = excluded.suggestion,
       verdict = excluded.verdict, asin = COALESCE(excluded.asin, asin),
       marketplace = COALESCE(excluded.marketplace, marketplace),
       ext_version = excluded.ext_version,
       title = COALESCE(excluded.title, title),
       reason = COALESCE(excluded.reason, reason),
       created_at = datetime('now')`
  ).bind(brand, brandKey, suggestion, verdict, asin, marketplace, extVersion, ipHash, title, reason).run();

  return json({ ok: true });
}

// Serve the known-brands allowlist: the seeded base list plus known-brand
// additions curated from the review dashboard, edge-cached. A failed D1 read
// throws and 500s, which clients treat like any bad refresh — they keep
// their last good copy.
async function handleBrands(request, env, ctx) {
  // The Cache API only works on custom-domain zones; touching it with a
  // workers.dev URL dies at the edge with error 1042 (uncatchable), so on
  // the workers.dev alias we just serve uncached.
  const url = new URL(request.url);
  const useCache = !url.hostname.endsWith("workers.dev");
  const cache = caches.default;
  const cacheKey = new Request(url.origin + "/brands-v3");
  if (useCache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const { results } = await env.DB.prepare(
    `SELECT brand FROM brands
     UNION SELECT brand FROM curated WHERE list = 'known'
     ORDER BY brand`
  ).all();

  const res = new Response(results.map((r) => r.brand).join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=" + BRANDS_CACHE_SECONDS,
      ...CORS
    }
  });
  if (useCache) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// Curated blocklist additions. Uncached: traffic is one hit per install per
// day and a new block should propagate immediately.
async function handleFlagged(env) {
  const { results } = await env.DB.prepare(
    "SELECT brand FROM curated WHERE list = 'flagged' ORDER BY brand"
  ).all();
  return new Response(results.map((r) => r.brand).join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS
    }
  });
}

async function handleCurate(request, env, url) {
  if (url.searchParams.get("token") !== env.REVIEW_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const brand = String(body.brand || "").trim().slice(0, 64);
  const key = normalize(brand);
  if (!key) return json({ error: "brand required" }, 400);

  if (body.remove) {
    await env.DB.prepare("DELETE FROM curated WHERE brand_key = ?1").bind(key).run();
    return json({ ok: true });
  }
  if (body.list !== "flagged" && body.list !== "known" && body.list !== "dismissed") {
    return json({ error: "list must be flagged, known or dismissed" }, 400);
  }
  await env.DB.prepare(
    `INSERT INTO curated (brand, brand_key, list) VALUES (?1, ?2, ?3)
     ON CONFLICT(brand_key) DO UPDATE SET list = ?3, brand = ?1`
  ).bind(brand, key, body.list).run();
  return json({ ok: true });
}

// Human-readable review dashboard. Brand strings are reporter-submitted, so
// everything is HTML-escaped on the way out.
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// The queue is only brands with no curation decision yet — Trust, Block and
// Dismiss all clear a brand from it. brand_tallies already excludes reports
// that agree with the verdict shown at report time, so pure noise never
// queues. The latest reported ASIN, product title and detector reason ride
// along as decision context.
const QUEUE_SQL = `SELECT t.*,
  (SELECT r.asin FROM reports r WHERE r.brand_key = t.brand_key
    AND r.asin IS NOT NULL ORDER BY r.id DESC LIMIT 1) AS asin,
  (SELECT r.marketplace FROM reports r WHERE r.brand_key = t.brand_key
    AND r.asin IS NOT NULL ORDER BY r.id DESC LIMIT 1) AS marketplace,
  (SELECT r.title FROM reports r WHERE r.brand_key = t.brand_key
    AND r.title IS NOT NULL ORDER BY r.id DESC LIMIT 1) AS title,
  (SELECT r.reason FROM reports r WHERE r.brand_key = t.brand_key
    AND r.reason IS NOT NULL ORDER BY r.id DESC LIMIT 1) AS reason,
  (SELECT GROUP_CONCAT(DISTINCT r.verdict) FROM reports r
    WHERE r.brand_key = t.brand_key) AS verdicts
FROM brand_tallies t
LEFT JOIN curated c ON c.brand_key = t.brand_key
WHERE c.brand_key IS NULL
ORDER BY t.total DESC, t.last_report DESC LIMIT 500`;

async function handleDashboard(env, url) {
  if (url.searchParams.get("token") !== env.REVIEW_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  const { results: queue } = await env.DB.prepare(QUEUE_SQL).all();
  const { results: recent } = await env.DB.prepare(
    `SELECT brand, suggestion, verdict, asin, marketplace, created_at
     FROM reports ORDER BY id DESC LIMIT 100`
  ).all();
  const { results: curated } = await env.DB.prepare(
    "SELECT brand, brand_key, list, created_at FROM curated ORDER BY created_at DESC"
  ).all();

  // False positives (real brands being filtered) erode trust the most, so
  // brands whose reporters lean "real" triage first.
  const isFp = (t) => t.real_votes > 0 && t.real_votes >= t.junk_votes;
  const fp = queue.filter(isFp)
    .sort((a, b) => b.real_votes - a.real_votes || b.total - a.total);
  const junk = queue.filter((t) => !isFp(t))
    .sort((a, b) => b.junk_votes - a.junk_votes || b.total - a.total);

  const queueRow = (t) => {
    const product = t.asin
      ? `<a href="https://${esc(t.marketplace || "www.amazon.com")}/dp/${esc(t.asin)}" target="_blank" rel="noreferrer">${esc(t.asin)}</a>`
      : `<a href="https://www.amazon.com/s?k=${esc(encodeURIComponent(t.brand))}" target="_blank" rel="noreferrer">search</a>`;
    // Second line: the reported product title (the fastest way for a human to
    // judge a brand), falling back to the detector's reason for old reports.
    const context = t.title || t.reason
      ? `<div class="t" title="${esc(t.reason || "")}">${esc(t.title || t.reason)}</div>` : "";
    // Single, uncorroborated reports start collapsed behind the section's
    // toggle; search still reaches them.
    const single = t.total === 1 ? ' class="single" hidden' : "";
    return `<tr data-brand="${esc(t.brand)}"${single}>` +
      `<td class="sel"><input type="checkbox" class="pick"></td>` +
      `<td class="b">${esc(t.brand)}${context}</td>` +
      `<td class="real">${t.real_votes || ""}</td>` +
      `<td class="junk">${t.junk_votes || ""}</td>` +
      `<td class="dim">${esc((t.verdicts || "").replace(/,/g, ", "))}</td>` +
      `<td class="dim">${esc((t.last_report || "").slice(0, 10))}</td>` +
      `<td class="dim">${product}</td>` +
      `<td class="acts"><button data-act data-list="known">Trust</button>` +
      `<button data-act data-list="flagged">Block</button>` +
      `<button data-act data-list="dismissed">Dismiss</button></td></tr>`;
  };
  const queueHead = `<tr><th class="sel"><input type="checkbox" class="selall" title="Select all"></th>` +
    `<th>Brand</th><th>Real</th><th>Junk</th><th>Reported as</th><th>Last</th><th>Product</th><th></th></tr>`;
  const queueEmpty = `<tr><td colspan="8" class="dim">Queue clear.</td></tr>`;
  const queueTable = (items) => {
    const singles = items.filter((t) => t.total === 1).length;
    const more = singles
      ? `<tr class="more"><td colspan="8"><button data-toggle>Show ${singles} single-report brand${singles === 1 ? "" : "s"}</button></td></tr>`
      : "";
    return `<table class="queue" data-collapsed="1">${queueHead}${items.map(queueRow).join("") || queueEmpty}${more}</table>`;
  };

  const curatedRows = curated.map((c) =>
    `<tr><td class="b">${esc(c.brand)}</td>` +
    `<td class="${c.list === "flagged" ? "junk" : c.list === "known" ? "real" : "dim"}">${c.list}</td>` +
    `<td class="dim">${esc(c.created_at)}</td>` +
    `<td class="acts"><button data-brand="${esc(c.brand)}" data-remove="1">Remove</button></td></tr>`
  ).join("");

  const recentRows = recent.map((r) =>
    `<tr><td class="b">${esc(r.brand)}</td>` +
    `<td class="${r.suggestion === "is_junk" ? "junk" : "real"}">${r.suggestion === "is_junk" ? "junk" : "real brand"}</td>` +
    `<td class="dim">${esc(r.verdict)}</td>` +
    `<td>${r.asin ? `<a href="https://${esc(r.marketplace || "www.amazon.com")}/dp/${esc(r.asin)}" target="_blank" rel="noreferrer">${esc(r.asin)}</a>` : ""}</td>` +
    `<td class="dim">${esc(r.created_at)}</td></tr>`
  ).join("");

  const empty = `<tr><td colspan="5" class="dim">No reports yet.</td></tr>`;
  const html = `<!doctype html><meta charset="utf-8">
<meta name="robots" content="noindex"><title>Knockoff report review</title>
<style>
  body{margin:0;background:#f4f4f5;color:#18181b;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  main{max-width:980px;margin:0 auto;padding:40px 24px 120px}
  h1{font-size:20px;font-weight:600;letter-spacing:-.015em;margin:0 0 4px}
  .sub{color:#71717a;font-size:12.5px;margin:0 0 6px}
  .keys{color:#a1a1aa;font-size:12px;margin:0 0 20px}
  .keys b{font-weight:600;color:#71717a;background:#e9e9eb;border-radius:4px;padding:0 5px}
  #q{width:100%;box-sizing:border-box;margin:0 0 4px;padding:8px 12px;border:1px solid #e4e4e7;
    border-radius:8px;font:inherit;background:#fff}
  h2{font-size:13.5px;font-weight:600;margin:28px 0 10px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  th{font-size:11px;font-weight:500;color:#71717a;text-align:left;padding:9px 14px;border-bottom:1px solid #e4e4e7;background:#fafafa}
  td{padding:9px 14px;border-bottom:1px solid #f0f0f1;font-size:13px}
  tr:last-child td{border-bottom:0}
  .b{font-weight:600}.dim{color:#a1a1aa;font-variant-numeric:tabular-nums}
  .t{color:#71717a;font-weight:400;font-size:12px;max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .count{color:#71717a;font-weight:500;font-size:12px;background:#e9e9eb;border-radius:9px;padding:1px 8px;vertical-align:1px}
  .junk{color:#dc2626;font-weight:600}.real{color:#047857;font-weight:600}
  a{color:#18181b}
  .sel{width:20px}
  input[type=checkbox]{accent-color:#18181b}
  tr.cursor td{background:#f4f7ff}
  tr.cursor td:first-child{box-shadow:inset 3px 0 0 #2563eb}
  tr.busy{opacity:.4;pointer-events:none}
  .acts{white-space:nowrap}
  .more td{padding:6px 14px;background:#fafafa}
  .more button{border:0;background:none;color:#71717a;font:500 12px/1.6 inherit;font-family:inherit;cursor:pointer;padding:2px 0}
  .more button:hover{color:#18181b}
  .acts button{border:1px solid #e4e4e7;background:#fff;border-radius:6px;padding:3px 10px;
    font:500 12px/1.4 inherit;font-family:inherit;color:#18181b;cursor:pointer;margin-right:4px}
  .acts button:hover{border-color:#18181b}
  details{margin:28px 0 0}
  summary{font-size:13.5px;font-weight:600;cursor:pointer;margin:0 0 10px}
  #bulk{position:fixed;left:50%;transform:translateX(-50%);bottom:20px;background:#18181b;color:#fff;
    border-radius:10px;padding:10px 14px;display:flex;gap:8px;align-items:center;font-size:13px;
    box-shadow:0 8px 24px rgba(0,0,0,.25)}
  #bulk button{border:1px solid #3f3f46;background:#27272a;color:#fff;border-radius:6px;padding:4px 12px;
    font:500 12px/1.4 inherit;font-family:inherit;cursor:pointer}
  #bulk button:hover{border-color:#fff}
</style>
<main>
  <h1>Knockoff report review</h1>
  <p class="sub">Trust/Block ship to every install within its next daily refresh —
  no extension release. Dismiss just clears the brand from the queue.</p>
  <p class="keys"><b>j</b>/<b>k</b> move · <b>x</b> select (shift-click for a range) ·
  <b>t</b> trust · <b>b</b> block · <b>d</b> dismiss · <b>o</b> open product · <b>/</b> search</p>
  <input id="q" type="search" placeholder="Filter brands and titles…">
  <h2>Possible false positives <span class="count">${fp.length}</span></h2>
  ${queueTable(fp)}
  <h2>Reported junk <span class="count">${junk.length}</span></h2>
  ${queueTable(junk)}
  <details><summary>Curated <span class="count">${curated.length}</span></summary>
  <table><tr><th>Brand</th><th>List</th><th>Added</th><th></th></tr>
  ${curatedRows || `<tr><td colspan="4" class="dim">Nothing curated yet.</td></tr>`}</table></details>
  <details><summary>Recent reports</summary>
  <table><tr><th>Brand</th><th>Suggestion</th><th>Verdict at report</th><th>ASIN</th><th>When</th></tr>
  ${recentRows || empty}</table></details>
</main>
<div id="bulk" hidden><span id="bn"></span>
  <button data-bulk="known">Trust</button>
  <button data-bulk="flagged">Block</button>
  <button data-bulk="dismissed">Dismiss</button>
  <button data-bulk="clear">Clear</button>
</div>
<script>
  const token = new URLSearchParams(location.search).get("token");
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  async function curate(body) {
    const res = await fetch("/curate?token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return res.ok;
  }

  // Visible queue rows, in page order. Everything (cursor, ranges, bulk)
  // operates on this list so search filtering stays consistent.
  const rows = () => $$("table.queue tr[data-brand]").filter((r) => !r.hidden);
  const picked = () => rows().filter((r) => $(".pick", r).checked);

  let cur = -1;
  function setCur(i) {
    $$("tr.cursor").forEach((r) => r.classList.remove("cursor"));
    const rs = rows();
    if (!rs.length) { cur = -1; return; }
    cur = Math.max(0, Math.min(i, rs.length - 1));
    rs[cur].classList.add("cursor");
    rs[cur].scrollIntoView({ block: "nearest" });
  }

  function removeRow(tr) {
    const table = tr.closest("table");
    tr.remove();
    const count = table.previousElementSibling.querySelector(".count");
    if (count) count.textContent = Math.max(0, (parseInt(count.textContent, 10) || 1) - 1);
  }

  function updateBulk() {
    const n = picked().length;
    $("#bulk").hidden = !n;
    $("#bn").textContent = n + " selected";
  }

  // One place decides row visibility: the search query wins, otherwise
  // single-report rows stay behind their section's toggle.
  function applyVisibility() {
    const q = $("#q").value.trim().toLowerCase();
    $$("table.queue").forEach((table) => {
      const collapsed = table.dataset.collapsed !== "0";
      let singles = 0;
      $$("tr[data-brand]", table).forEach((tr) => {
        const single = tr.classList.contains("single");
        if (single) singles++;
        const match = !q || tr.textContent.toLowerCase().includes(q);
        tr.hidden = !match || (single && collapsed && !q);
      });
      const more = $("tr.more", table);
      if (more) {
        more.hidden = !!q || !singles;
        $("button", more).textContent = collapsed
          ? "Show " + singles + " single-report brand" + (singles === 1 ? "" : "s")
          : "Hide single-report brands";
      }
    });
  }

  // Decide a set of rows. Rows disappear as each request succeeds; a few
  // requests run at once so bulk actions on dozens of brands stay quick.
  async function act(list, trs) {
    trs.forEach((tr) => tr.classList.add("busy"));
    const q = trs.slice();
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (q.length) {
        const tr = q.shift();
        const ok = await curate({ brand: tr.dataset.brand, list });
        if (ok) removeRow(tr); else tr.classList.remove("busy");
      }
    }));
    applyVisibility();
    setCur(cur);
    updateBulk();
  }

  let lastPick = null;
  document.addEventListener("click", async (e) => {
    const pick = e.target.closest("input.pick");
    if (pick) {
      if (e.shiftKey && lastPick) {
        const rs = rows();
        const a = rs.indexOf(pick.closest("tr")), b = rs.indexOf(lastPick.closest("tr"));
        if (a > -1 && b > -1) rs.slice(Math.min(a, b), Math.max(a, b) + 1)
          .forEach((r) => { $(".pick", r).checked = pick.checked; });
      }
      lastPick = pick;
      updateBulk();
      return;
    }
    const selall = e.target.closest("input.selall");
    if (selall) {
      $$("tr[data-brand]", selall.closest("table")).filter((r) => !r.hidden)
        .forEach((r) => { $(".pick", r).checked = selall.checked; });
      updateBulk();
      return;
    }
    const toggle = e.target.closest("button[data-toggle]");
    if (toggle) {
      const table = toggle.closest("table");
      table.dataset.collapsed = table.dataset.collapsed === "0" ? "1" : "0";
      applyVisibility();
      updateBulk();
      return;
    }
    const act1 = e.target.closest("button[data-act]");
    if (act1) { act(act1.dataset.list, [act1.closest("tr")]); return; }
    const bulk = e.target.closest("button[data-bulk]");
    if (bulk) {
      if (bulk.dataset.bulk === "clear") {
        $$("input.pick:checked").forEach((c) => { c.checked = false; });
        updateBulk();
      } else act(bulk.dataset.bulk, picked());
      return;
    }
    // Un-curating re-queues the brand, which needs fresh data — reload is fine
    // there; queue decisions above clear rows in place instead.
    const rm = e.target.closest("button[data-remove]");
    if (rm) {
      rm.disabled = true;
      if (await curate({ brand: rm.dataset.brand, remove: true })) location.reload();
      else rm.disabled = false;
    }
  });

  $("#q").addEventListener("input", () => {
    applyVisibility();
    setCur(0);
    updateBulk();
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input")) {
      if (e.key === "Escape") e.target.blur();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === "j" || k === "ArrowDown") { e.preventDefault(); setCur(cur + 1); }
    else if (k === "k" || k === "ArrowUp") { e.preventDefault(); setCur(cur - 1); }
    else if (k === "/") { e.preventDefault(); $("#q").focus(); }
    else if (k === "x") {
      const r = rows()[cur];
      if (r) { const c = $(".pick", r); c.checked = !c.checked; lastPick = c; updateBulk(); }
    } else if (k === "o") {
      const r = rows()[cur];
      const a = r && $("td a", r);
      if (a) window.open(a.href, "_blank");
    } else if (k === "t" || k === "b" || k === "d") {
      const list = { t: "known", b: "flagged", d: "dismissed" }[k];
      const sel = picked();
      if (sel.length) act(list, sel);
      else if (rows()[cur]) act(list, [rows()[cur]]);
    }
  });
</script>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function handleReview(request, env, url) {
  if (url.searchParams.get("token") !== env.REVIEW_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  if (url.pathname === "/tallies") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM brand_tallies ORDER BY total DESC LIMIT 500"
    ).all();
    return json(results);
  }
  if (url.pathname === "/queue") {
    const { results } = await env.DB.prepare(QUEUE_SQL).all();
    return json(results);
  }
  const days = Math.min(parseInt(url.searchParams.get("days") || "7", 10) || 7, 90);
  const { results } = await env.DB.prepare(
    `SELECT id, brand, brand_key, suggestion, verdict, asin, marketplace, ext_version, created_at
     FROM reports WHERE created_at > datetime('now', ?1) ORDER BY id DESC LIMIT 1000`
  ).bind(`-${days} days`).all();
  return json(results);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method === "POST" && url.pathname === "/report") {
      return handleReport(request, env);
    }
    if (request.method === "GET" && url.pathname === "/brands") {
      return handleBrands(request, env, ctx);
    }
    if (request.method === "GET" && url.pathname === "/flagged") {
      return handleFlagged(env);
    }
    if (request.method === "GET" && url.pathname === "/review") {
      return handleDashboard(env, url);
    }
    if (request.method === "POST" && url.pathname === "/curate") {
      return handleCurate(request, env, url);
    }
    if (request.method === "GET" &&
        (url.pathname === "/reports" || url.pathname === "/tallies" || url.pathname === "/queue")) {
      return handleReview(request, env, url);
    }
    return json({ error: "not found" }, 404);
  }
};
