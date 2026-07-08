-- One-time migration: reports carry the product title and detector reason so
-- the /review dashboard can show what a brand actually sells. Run before
-- deploying the worker that writes these columns:
--   wrangler d1 execute knockoff-reports --file=migrate-report-context.sql --remote

ALTER TABLE reports ADD COLUMN title TEXT;
ALTER TABLE reports ADD COLUMN reason TEXT;
