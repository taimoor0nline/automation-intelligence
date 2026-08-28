const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../services/authService');
const { TEST_CATEGORIES } = require('../services/testCategories');

const ROLE_SET = new Set(['DEV', 'QA', 'MANAGER']);
const OUTCOME_SET = new Set(['PASS', 'FAIL']);
const TARGET_SET = new Set(['WEB', 'REST']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ensureDatabase(_req, res, next) {
  if (!db.isConfigured()) return res.status(409).json({ reply: 'PostgreSQL is required for historical reporting.' });
  next();
}

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizedFilters(query = {}) {
  const from = clean(query.from, 10);
  const to = clean(query.to, 10);
  const projectId = clean(query.projectId, 50);
  const userId = clean(query.userId, 50);
  const role = clean(query.role, 20).toUpperCase();
  const category = clean(query.category, 30).toUpperCase();
  const outcome = clean(query.outcome, 20).toUpperCase();
  const environment = clean(query.environment, 120);
  const targetType = clean(query.targetType, 20).toUpperCase();

  if (from && !DATE_RE.test(from)) throw new Error('from must use YYYY-MM-DD.');
  if (to && !DATE_RE.test(to)) throw new Error('to must use YYYY-MM-DD.');
  if (from && to && from > to) throw new Error('from cannot be later than to.');
  if (projectId && !UUID_RE.test(projectId)) throw new Error('projectId is invalid.');
  if (userId && !UUID_RE.test(userId)) throw new Error('userId is invalid.');
  if (role && !ROLE_SET.has(role)) throw new Error('role must be DEV, QA, or MANAGER.');
  if (category && !TEST_CATEGORIES.includes(category)) throw new Error(`Unknown test category: ${category}.`);
  if (outcome && !OUTCOME_SET.has(outcome)) throw new Error('outcome must be PASS or FAIL.');
  if (targetType && !TARGET_SET.has(targetType)) throw new Error('targetType must be WEB or REST.');

  return { from, to, projectId, userId, role, category, outcome, environment, targetType };
}

function addParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function buildRunScope(req, filters = {}, { includeFilters = true } = {}) {
  const params = [];
  const where = [];
  const viewerRole = String(req.user?.role || '').toUpperCase();
  const viewerId = String(req.user?.sub || '');

  if (viewerRole === 'QA') {
    const p = addParam(params, viewerId);
    where.push(`(
      tr.executed_by=${p}
      OR ts.created_by=${p}
      OR EXISTS (
        SELECT 1 FROM project_members visibility_pm
         WHERE visibility_pm.project_id=tr.project_id
           AND visibility_pm.user_id=${p}
      )
    )`);
  } else if (viewerRole === 'DEV') {
    const p = addParam(params, viewerId);
    where.push(`EXISTS (
      SELECT 1 FROM defect_analyses visibility_da
       WHERE visibility_da.run_id=tr.id
         AND visibility_da.assigned_to=${p}
    )`);
  } else if (viewerRole !== 'MANAGER') {
    where.push('false');
  }

  if (includeFilters) {
    if (filters.from) where.push(`tr.completed_at >= ${addParam(params, filters.from)}::date`);
    if (filters.to) where.push(`tr.completed_at < (${addParam(params, filters.to)}::date + interval '1 day')`);
    if (filters.projectId) where.push(`tr.project_id=${addParam(params, filters.projectId)}::uuid`);
    if (filters.userId) where.push(`tr.executed_by=${addParam(params, filters.userId)}::uuid`);
    if (filters.role) where.push(`coalesce(tr.executed_by_role, runner.role::text)=${addParam(params, filters.role)}`);
    if (filters.environment) where.push(`coalesce(ts.environment,'')=${addParam(params, filters.environment)}`);
    if (filters.targetType) where.push(`coalesce(tr.target_type,'WEB')=${addParam(params, filters.targetType)}`);
  }

  return { params, where: where.length ? where.join(' AND ') : 'true' };
}

function resultFilterSql(filters, params, alias = 'result_row') {
  const where = [];
  if (filters.category) where.push(`${alias}.test_category=${addParam(params, filters.category)}`);
  if (filters.outcome === 'PASS') where.push(`${alias}.passed=true`);
  if (filters.outcome === 'FAIL') where.push(`${alias}.passed=false`);
  return where.length ? where.join(' AND ') : 'true';
}

function baseScopedRunsSql(scopeWhere) {
  return `
    SELECT
      tr.id,
      tr.session_id,
      tr.project_id,
      tr.run_number,
      tr.executed_by,
      coalesce(tr.executed_by_role, runner.role::text) AS executed_by_role,
      tr.total,
      tr.passed,
      tr.failed,
      tr.duration_ms,
      tr.browser,
      coalesce(tr.target_type,'WEB') AS target_type,
      tr.completed_at,
      ts.environment,
      ts.target_url,
      ts.story,
      project.name AS project_name,
      runner.display_name AS executed_by_name,
      runner.email AS executed_by_email
    FROM test_runs tr
    JOIN test_sessions ts ON ts.id=tr.session_id
    LEFT JOIN projects project ON project.id=tr.project_id
    LEFT JOIN users runner ON runner.id=tr.executed_by
    WHERE ${scopeWhere}
  `;
}

router.get('/api/reporting/filters', requireAuth, ensureDatabase, async (req, res) => {
  try {
    const scope = buildRunScope(req, {}, { includeFilters: false });
    const scopedSql = baseScopedRunsSql(scope.where);
    const result = await db.query(`
      WITH scoped_runs AS (${scopedSql})
      SELECT
        coalesce((SELECT jsonb_agg(project_row ORDER BY project_row->>'name') FROM (
          SELECT DISTINCT jsonb_build_object('id', sr.project_id, 'name', coalesce(sr.project_name,'Unassigned')) AS project_row
            FROM scoped_runs sr WHERE sr.project_id IS NOT NULL
        ) projects), '[]'::jsonb) AS projects,
        coalesce((SELECT jsonb_agg(user_row ORDER BY user_row->>'displayName') FROM (
          SELECT DISTINCT jsonb_build_object(
            'id', sr.executed_by,
            'displayName', coalesce(sr.executed_by_name,sr.executed_by_email,'Unknown user'),
            'email', sr.executed_by_email,
            'role', sr.executed_by_role
          ) AS user_row
            FROM scoped_runs sr WHERE sr.executed_by IS NOT NULL
        ) users), '[]'::jsonb) AS users,
        coalesce((SELECT jsonb_agg(environment ORDER BY environment) FROM (
          SELECT DISTINCT environment FROM scoped_runs WHERE coalesce(environment,'')<>''
        ) environments), '[]'::jsonb) AS environments
    `, scope.params);

    const row = result.rows[0] || {};
    res.json({
      ok: true,
      viewer: { id: req.user.sub, role: String(req.user.role || '').toUpperCase(), name: req.user.name || req.user.email || null },
      projects: row.projects || [],
      users: row.users || [],
      environments: row.environments || [],
      categories: TEST_CATEGORIES,
      roles: ['DEV', 'QA', 'MANAGER'],
      outcomes: ['PASS', 'FAIL'],
      targetTypes: ['WEB', 'REST'],
    });
  } catch (err) {
    res.status(422).json({ reply: err.message });
  }
});

router.get('/api/reporting/summary', requireAuth, ensureDatabase, async (req, res) => {
  try {
    const filters = normalizedFilters(req.query || {});
    const scope = buildRunScope(req, filters);
    const params = [...scope.params];
    const resultWhere = resultFilterSql(filters, params, 'result_row');
    const scopedSql = baseScopedRunsSql(scope.where);
    const limit = Math.max(1, Math.min(Number(req.query?.limit || 100) || 100, 500));
    const limitParam = addParam(params, limit);

    const data = await db.query(`
      WITH scoped_runs AS (${scopedSql}),
      filtered_results AS (
        SELECT result_row.*, scoped_runs.completed_at, scoped_runs.project_id,
               scoped_runs.executed_by, scoped_runs.executed_by_role,
               scoped_runs.executed_by_name, scoped_runs.executed_by_email,
               scoped_runs.environment, scoped_runs.project_name,
               scoped_runs.target_type
          FROM test_results result_row
          JOIN scoped_runs ON scoped_runs.id=result_row.run_id
         WHERE ${resultWhere}
      ),
      relevant_run_ids AS (
        SELECT DISTINCT id AS run_id FROM scoped_runs
        WHERE NOT EXISTS (SELECT 1 FROM filtered_results)
          AND ${filters.category || filters.outcome ? 'false' : 'true'}
        UNION
        SELECT DISTINCT run_id FROM filtered_results
      )
      SELECT
        (SELECT jsonb_build_object(
          'runs', count(DISTINCT relevant.run_id),
          'tests', count(fr.id),
          'passed', count(fr.id) FILTER (WHERE fr.passed=true),
          'failed', count(fr.id) FILTER (WHERE fr.passed=false),
          'passRate', CASE WHEN count(fr.id)=0 THEN 0 ELSE round((count(fr.id) FILTER (WHERE fr.passed=true))::numeric * 100 / count(fr.id), 2) END,
          'avgDurationMs', coalesce(round(avg(fr.duration_ms)::numeric,0),0)
        ) FROM relevant_run_ids relevant LEFT JOIN filtered_results fr ON fr.run_id=relevant.run_id) AS metrics,

        coalesce((SELECT jsonb_agg(row_data ORDER BY row_data->>'category') FROM (
          SELECT jsonb_build_object(
            'category', test_category,
            'total', count(*),
            'passed', count(*) FILTER (WHERE passed=true),
            'failed', count(*) FILTER (WHERE passed=false),
            'passRate', CASE WHEN count(*)=0 THEN 0 ELSE round((count(*) FILTER (WHERE passed=true))::numeric*100/count(*),2) END
          ) AS row_data
          FROM filtered_results GROUP BY test_category
        ) category_rows), '[]'::jsonb) AS categories,

        coalesce((SELECT jsonb_agg(row_data ORDER BY row_data->>'displayName') FROM (
          SELECT jsonb_build_object(
            'userId', executed_by,
            'displayName', coalesce(executed_by_name,executed_by_email,'Unknown user'),
            'role', executed_by_role,
            'total', count(*),
            'passed', count(*) FILTER (WHERE passed=true),
            'failed', count(*) FILTER (WHERE passed=false)
          ) AS row_data
          FROM filtered_results GROUP BY executed_by,executed_by_name,executed_by_email,executed_by_role
        ) user_rows), '[]'::jsonb) AS users,

        coalesce((SELECT jsonb_agg(row_data ORDER BY row_data->>'role') FROM (
          SELECT jsonb_build_object(
            'role', coalesce(executed_by_role,'UNKNOWN'),
            'total', count(*),
            'passed', count(*) FILTER (WHERE passed=true),
            'failed', count(*) FILTER (WHERE passed=false)
          ) AS row_data
          FROM filtered_results GROUP BY executed_by_role
        ) role_rows), '[]'::jsonb) AS roles,

        coalesce((SELECT jsonb_agg(row_data ORDER BY row_data->>'date') FROM (
          SELECT jsonb_build_object(
            'date', to_char(completed_at AT TIME ZONE 'UTC','YYYY-MM-DD'),
            'total', count(*),
            'passed', count(*) FILTER (WHERE passed=true),
            'failed', count(*) FILTER (WHERE passed=false)
          ) AS row_data
          FROM filtered_results GROUP BY (completed_at AT TIME ZONE 'UTC')::date
        ) trend_rows), '[]'::jsonb) AS trend,

        coalesce((SELECT jsonb_agg(row_data ORDER BY (row_data->>'completedAt') DESC) FROM (
          SELECT jsonb_build_object(
            'runId', sr.id,
            'sessionId', sr.session_id,
            'runNumber', sr.run_number,
            'projectId', sr.project_id,
            'projectName', coalesce(sr.project_name,'Unassigned'),
            'environment', sr.environment,
            'targetType', sr.target_type,
            'executedBy', sr.executed_by,
            'executedByName', coalesce(sr.executed_by_name,sr.executed_by_email,'Unknown user'),
            'executedByRole', sr.executed_by_role,
            'completedAt', sr.completed_at,
            'durationMs', sr.duration_ms,
            'browser', sr.browser,
            'total', count(fr.id),
            'passed', count(fr.id) FILTER (WHERE fr.passed=true),
            'failed', count(fr.id) FILTER (WHERE fr.passed=false)
          ) AS row_data
          FROM scoped_runs sr
          JOIN relevant_run_ids relevant ON relevant.run_id=sr.id
          LEFT JOIN filtered_results fr ON fr.run_id=sr.id
          GROUP BY sr.id,sr.session_id,sr.run_number,sr.project_id,sr.project_name,sr.environment,sr.target_type,
                   sr.executed_by,sr.executed_by_name,sr.executed_by_email,sr.executed_by_role,sr.completed_at,sr.duration_ms,sr.browser
          ORDER BY sr.completed_at DESC
          LIMIT ${limitParam}
        ) run_rows), '[]'::jsonb) AS runs
    `, params);

    const row = data.rows[0] || {};
    res.json({
      ok: true,
      viewer: { id: req.user.sub, role: String(req.user.role || '').toUpperCase(), name: req.user.name || req.user.email || null },
      appliedFilters: filters,
      metrics: row.metrics || { runs: 0, tests: 0, passed: 0, failed: 0, passRate: 0, avgDurationMs: 0 },
      categoryBreakdown: row.categories || [],
      userBreakdown: row.users || [],
      roleBreakdown: row.roles || [],
      dailyTrend: row.trend || [],
      runs: row.runs || [],
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(422).json({ reply: err.message });
  }
});

module.exports = router;
