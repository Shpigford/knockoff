-- One-time migration for deployments created before the triage dashboard.
-- Run BEFORE deploying the worker from this commit (its /report upsert needs
-- the unique index to exist):
--   wrangler d1 execute knockoff-reports --file=migrate-triage.sql --remote
--
-- 1. One row per reporter per brand, keeping each reporter's latest vote.
-- 2. curated.list gains 'dismissed' (reviewed, no action). SQLite can't alter
--    a CHECK constraint, so the table is rebuilt.
-- 3. brand_tallies drops reports that agree with the verdict shown at report
--    time — nothing to curate there.

DELETE FROM reports WHERE id NOT IN (
  SELECT MAX(id) FROM reports GROUP BY ip_hash, brand_key
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_voter_brand ON reports (ip_hash, brand_key);

CREATE TABLE curated_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  brand_key TEXT NOT NULL UNIQUE,
  list TEXT NOT NULL CHECK (list IN ('flagged', 'known', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO curated_new (id, brand, brand_key, list, created_at)
  SELECT id, brand, brand_key, list, created_at FROM curated;
DROP TABLE curated;
ALTER TABLE curated_new RENAME TO curated;

DROP VIEW IF EXISTS brand_tallies;
CREATE VIEW brand_tallies AS
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
