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
//   GET  /review?token=...           HTML review dashboard (tallies + stream
//                                    + one-click Block/Trust curation)
//   POST /curate?token=...           {brand, list: "flagged"|"known"} to add,
//                                    {brand, remove: true} to undo
//   GET  /reports?token=...&days=7   recent reports (JSON, review only)
//   GET  /tallies?token=...          per-brand vote tallies (JSON, review only)
//
// Deploy (from this directory):
//   wrangler d1 create knockoff-reports          # once; put the id in wrangler.toml
//   wrangler d1 execute knockoff-reports --file=schema.sql --remote
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

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await sha256(env.IP_SALT + ip);

  const { count } = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM reports WHERE ip_hash = ?1 AND created_at > datetime('now', '-1 hour')"
  ).bind(ipHash).first();
  if (count >= MAX_REPORTS_PER_IP_PER_HOUR) {
    return json({ error: "rate limited" }, 429);
  }

  await env.DB.prepare(
    `INSERT INTO reports (brand, brand_key, suggestion, verdict, asin, marketplace, ext_version, ip_hash)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(brand, brandKey, suggestion, verdict, asin, marketplace, extVersion, ipHash).run();

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
  if (body.list !== "flagged" && body.list !== "known") {
    return json({ error: "list must be flagged or known" }, 400);
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

async function handleDashboard(env, url) {
  if (url.searchParams.get("token") !== env.REVIEW_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  const { results: tallies } = await env.DB.prepare(
    "SELECT * FROM brand_tallies ORDER BY total DESC, last_report DESC LIMIT 200"
  ).all();
  const { results: recent } = await env.DB.prepare(
    `SELECT brand, suggestion, verdict, asin, marketplace, created_at
     FROM reports ORDER BY id DESC LIMIT 100`
  ).all();
  const { results: curated } = await env.DB.prepare(
    "SELECT brand, brand_key, list, created_at FROM curated ORDER BY created_at DESC"
  ).all();
  const curatedByKey = Object.fromEntries(curated.map((c) => [c.brand_key, c.list]));

  const tallyRows = tallies.map((t) => {
    const cur = curatedByKey[t.brand_key];
    const actions = cur
      ? `<span class="${cur === "flagged" ? "junk" : "real"}">✓ ${cur}</span>`
      : `<button data-brand="${esc(t.brand)}" data-list="flagged">Block</button>
         <button data-brand="${esc(t.brand)}" data-list="known">Trust</button>`;
    return `<tr><td class="b">${esc(t.brand)}</td>` +
      `<td class="junk">${t.junk_votes || ""}</td>` +
      `<td class="real">${t.real_votes || ""}</td>` +
      `<td>${t.total}</td><td class="dim">${esc(t.last_report)}</td>` +
      `<td class="acts">${actions}</td></tr>`;
  }).join("");

  const curatedRows = curated.map((c) =>
    `<tr><td class="b">${esc(c.brand)}</td>` +
    `<td class="${c.list === "flagged" ? "junk" : "real"}">${c.list}</td>` +
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
  main{max-width:860px;margin:0 auto;padding:40px 24px 80px}
  h1{font-size:20px;font-weight:600;letter-spacing:-.015em;margin:0 0 4px}
  .sub{color:#71717a;font-size:12.5px;margin:0 0 28px}
  h2{font-size:13.5px;font-weight:600;margin:28px 0 10px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  th{font-size:11px;font-weight:500;color:#71717a;text-align:left;padding:9px 14px;border-bottom:1px solid #e4e4e7;background:#fafafa}
  td{padding:9px 14px;border-bottom:1px solid #f0f0f1;font-size:13px}
  tr:last-child td{border-bottom:0}
  .b{font-weight:600}.dim{color:#a1a1aa;font-variant-numeric:tabular-nums}
  .junk{color:#dc2626;font-weight:600}.real{color:#047857;font-weight:600}
  a{color:#18181b}
  .acts button{border:1px solid #e4e4e7;background:#fff;border-radius:6px;padding:3px 10px;
    font:500 12px/1.4 inherit;font-family:inherit;color:#18181b;cursor:pointer;margin-right:4px}
  .acts button:hover{border-color:#18181b}
</style>
<main>
  <h1>Knockoff report review</h1>
  <p class="sub">Block/Trust decisions ship to every install within its next daily
  refresh. No extension release needed.</p>
  <h2>Brand tallies</h2>
  <table><tr><th>Brand</th><th>Junk votes</th><th>Real votes</th><th>Total</th><th>Last report</th><th></th></tr>
  ${tallyRows || empty}</table>
  <h2>Curated</h2>
  <table><tr><th>Brand</th><th>List</th><th>Added</th><th></th></tr>
  ${curatedRows || `<tr><td colspan="4" class="dim">Nothing curated yet.</td></tr>`}</table>
  <h2>Recent reports</h2>
  <table><tr><th>Brand</th><th>Suggestion</th><th>Verdict at report</th><th>ASIN</th><th>When</th></tr>
  ${recentRows || empty}</table>
</main>
<script>
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-brand]");
    if (!b) return;
    b.disabled = true;
    const token = new URLSearchParams(location.search).get("token");
    const body = b.dataset.remove
      ? { brand: b.dataset.brand, remove: true }
      : { brand: b.dataset.brand, list: b.dataset.list };
    await fetch("/curate?token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    location.reload();
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
    if (request.method === "GET" && (url.pathname === "/reports" || url.pathname === "/tallies")) {
      return handleReview(request, env, url);
    }
    return json({ error: "not found" }, 404);
  }
};
