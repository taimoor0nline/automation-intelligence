ALTER TABLE defect_analyses
  ADD COLUMN IF NOT EXISTS source_guidance_level TEXT NOT NULL DEFAULT 'BLACK_BOX',
  ADD COLUMN IF NOT EXISTS source_candidate_files JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_defects_source_guidance ON defect_analyses(source_guidance_level);
