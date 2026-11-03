-- TestNexus project workspace; no LearnIQ dependencies.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS reference_no TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS objectives TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scope_in TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scope_out TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS business_rules TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS acceptance_criteria TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS technology_stack TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_reference_no ON projects(lower(reference_no)) WHERE reference_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_environments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL, base_url TEXT NOT NULL, stage_type TEXT NOT NULL DEFAULT 'QA',
 is_default BOOLEAN NOT NULL DEFAULT FALSE,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(project_id,name)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_default_environment ON project_environments(project_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS project_stories (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
 reference_no TEXT, title TEXT NOT NULL, story TEXT NOT NULL,
 acceptance_criteria TEXT, page_paths TEXT, priority TEXT NOT NULL DEFAULT 'MEDIUM',
 status TEXT NOT NULL DEFAULT 'DRAFT',
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_stories_project ON project_stories(project_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS project_documents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 filename TEXT NOT NULL, mime_type TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'OTHER',
 file_size INTEGER NOT NULL CHECK(file_size BETWEEN 1 AND 5242880),
 file_data BYTEA NOT NULL,
 version TEXT NOT NULL DEFAULT '1.0',
 uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id,created_at DESC);

ALTER TABLE work_items ADD COLUMN IF NOT EXISTS parent_work_item_id UUID REFERENCES work_items(id) ON DELETE SET NULL;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS eta_at TIMESTAMPTZ;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS deferred_until TIMESTAMPTZ;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS deferred_reason TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_parent ON work_items(parent_work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_items_active ON work_items(project_id,updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS work_item_attachments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
 filename TEXT NOT NULL, mime_type TEXT NOT NULL,
 file_size INTEGER NOT NULL CHECK(file_size BETWEEN 1 AND 5242880),
 file_data BYTEA NOT NULL,
 uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_attachments_item ON work_item_attachments(work_item_id,created_at DESC);