-- Baseline: database extensions required by the data model (docs/SPEC.md section 8).
-- citext provides case-insensitive email columns.
CREATE EXTENSION IF NOT EXISTS citext;
