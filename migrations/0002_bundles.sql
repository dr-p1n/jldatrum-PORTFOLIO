-- One import can carry several tables (a "bundle"): each table becomes its own
-- batch, with its own industry and region, and they share a bundle_id so
-- analytics can still compare groups that arrived together.
-- 0001_init.sql is never edited.

ALTER TABLE batches ADD COLUMN bundle_id TEXT;

CREATE INDEX IF NOT EXISTS idx_batches_bundle ON batches(bundle_id);
