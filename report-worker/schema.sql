-- Knockoff report worker — D1 schema.
-- Apply with: wrangler d1 execute knockoff-reports --file=schema.sql --remote

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,            -- brand as displayed ("SZHLUX")
  brand_key TEXT NOT NULL,        -- normalized key ("szhlux")
  suggestion TEXT NOT NULL,       -- "is_junk" | "not_junk"
  verdict TEXT,                   -- what the extension decided at report time
  asin TEXT,                      -- product the report came from, if any
  marketplace TEXT,               -- "www.amazon.com" etc.
  ext_version TEXT,               -- extension version, for triage
  title TEXT,                     -- product title at report time (review context)
  reason TEXT,                    -- detector's reason string at report time
  ip_hash TEXT NOT NULL,          -- salted SHA-256 of reporter IP (rate limiting only)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reports_brand_key ON reports (brand_key);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports (created_at);
CREATE INDEX IF NOT EXISTS idx_reports_ip ON reports (ip_hash, created_at);

-- One row per reporter per brand: re-reporting updates the earlier vote (see
-- the /report upsert) instead of letting one person stack a brand's tally.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_voter_brand ON reports (ip_hash, brand_key);

-- Base known-brands allowlist, served via GET /brands. Seeded once from
-- seed-brands.sql; ongoing additions land in `curated` instead so they stay
-- visible (and removable) on the /review dashboard.
CREATE TABLE IF NOT EXISTS brands (
  brand TEXT NOT NULL,            -- brand as displayed ("Black+Decker")
  brand_key TEXT NOT NULL PRIMARY KEY  -- normalized key ("blackdecker")
);

-- Curated verdicts, maintained from the /review dashboard. 'flagged' and
-- 'known' are served to every extension install via GET /flagged and
-- GET /brands, so a curation decision reaches users within their next daily
-- refresh — no extension release. 'dismissed' means reviewed-no-action: it
-- only clears the brand from the review queue and is never served.
CREATE TABLE IF NOT EXISTS curated (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  brand_key TEXT NOT NULL UNIQUE,
  list TEXT NOT NULL CHECK (list IN ('flagged', 'known', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Triage view: which brands are reported most, and which way? Reports that
-- agree with the verdict the extension showed at report time are no-ops —
-- there is nothing to curate — so they never reach the queue.
CREATE VIEW IF NOT EXISTS brand_tallies AS
SELECT
  brand_key,
  MAX(brand) AS brand,
  SUM(CASE WHEN suggestion = 'is_junk' THEN 1 ELSE 0 END) AS junk_votes,
  SUM(CASE WHEN suggestion = 'not_junk' THEN 1 ELSE 0 END) AS real_votes,
  COUNT(*) AS total,
  MAX(created_at) AS last_report
FROM reports
WHERE NOT (suggestion = 'not_junk' AND COALESCE(verdict, '') IN ('known', 'allowed'))
  AND NOT (suggestion = 'is_junk' AND COALESCE(verdict, '') IN ('flagged', 'blocked'))
GROUP BY brand_key;
