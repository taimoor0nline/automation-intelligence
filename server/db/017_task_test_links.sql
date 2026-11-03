CREATE TABLE IF NOT EXISTS task_test_case_links (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL,
 external_case_id TEXT NOT NULL,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(work_item_id,session_id,external_case_id)
);
CREATE INDEX IF NOT EXISTS idx_task_case_project ON task_test_case_links(project_id,session_id,external_case_id);
INSERT INTO task_test_case_links(project_id,work_item_id,session_id,external_case_id)
SELECT project_id,id,session_id,external_case_id FROM work_items WHERE session_id IS NOT NULL AND external_case_id IS NOT NULL
ON CONFLICT DO NOTHING;
