'use strict';
// Code Intelligence scan lifecycle (CI-007/008/010/031):
// QUEUED → PREPARING (exact commit + checkout) → RUNNING (one job per scanner) → NORMALIZING (save findings) →
// COMPLETED, PARTIAL (a scanner failed) or FAILED. The checked-out code is always removed at the end.
const crypto = require('crypto');
const db = require('../../db');
const checkoutSvc = require('./checkout');
const { ADAPTERS, CHECK_TO_ADAPTER, NOT_AVAILABLE, VERSION_CMD, detectLanguages, version, captureSnippets } = require('./adapters');
const runner = require('./runner');

const ENABLED = () => /^(1|true|yes|on)$/i.test(String(process.env.CODE_INTELLIGENCE_ENABLED || ''));
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CI_WORKER_CONCURRENCY || 1), 4));
const queue = [];
let active = 0;

// Scans left unfinished by a server restart are marked failed once, at startup.
let recovered = false;
async function recoverInterrupted() {
  if (recovered || !db.isConfigured()) return; recovered = true;
  await db.query("update ci_scan_runs set status='FAILED',error='The server restarted during the scan. Start it again.',completed_at=now() where status in ('QUEUED','PREPARING','RUNNING','NORMALIZING')").catch(() => {});
}

// Which scanner jobs a scan runs: a story runs its ticked checks; a repository scan runs every available scanner.
function plan(checks) {
  const list = checks && checks.length ? checks : ['CODE_SAST', 'CODE_SECRETS', 'CODE_SCA'];
  const jobs = [];
  for (const c of list) {
    if (CHECK_TO_ADAPTER[c]) jobs.push({ category: CHECK_TO_ADAPTER[c], scanner: ADAPTERS[CHECK_TO_ADAPTER[c]].scanner });
    else if (NOT_AVAILABLE[c]) jobs.push({ category: c.replace('CODE_', ''), scanner: NOT_AVAILABLE[c], skip: 'No scanner chosen yet for ' + NOT_AVAILABLE[c] + '.' });
  }
  return jobs;
}

async function createRun({ projectId, repository, storyId, targetType, target, checks, userId }) {
  await recoverInterrupted();
  const busy = await db.query("select scan_number from ci_scan_runs where repository_id=$1 and status in ('QUEUED','PREPARING','RUNNING','NORMALIZING') limit 1", [repository.id]);
  if (busy.rowCount) throw Object.assign(new Error('Scan #' + busy.rows[0].scan_number + ' of this repository is still running. Wait for it to finish.'), { statusCode: 409 });
  const jobs = plan(checks);
  const run = await db.withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['ci-scan-number:' + projectId]);
    // The same thing scanned again (same repository, story and branch / pull request / commit) = the next attempt of
    // that scan, like a test run's attempts. Anything else is a new scan number.
    const same = (await client.query(`select scan_number,max(attempt) attempt from ci_scan_runs
        where project_id=$1 and repository_id=$2 and story_id is not distinct from $3 and target_type=$4 and target is not distinct from $5
        group by scan_number order by scan_number desc limit 1`, [projectId, repository.id, storyId || null, targetType, target || null])).rows[0];
    const n = same ? same.scan_number : (await client.query('select coalesce(max(scan_number),0)+1 n from ci_scan_runs where project_id=$1', [projectId])).rows[0].n;
    const attempt = same ? Number(same.attempt) + 1 : 1;
    const r = (await client.query(`insert into ci_scan_runs(project_id,repository_id,story_id,scan_number,attempt,repo_full_name,target_type,target,categories,created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [projectId, repository.id, storyId || null, n, attempt, repository.repo_full_name, targetType, target, jobs.map((j) => j.category), userId])).rows[0];
    for (const j of jobs) await client.query('insert into ci_scan_jobs(scan_run_id,category,scanner,status,error) values($1,$2,$3,$4,$5)', [r.id, j.category, j.scanner, j.skip ? 'SKIPPED' : 'QUEUED', j.skip || null]);
    await client.query("insert into project_audit_events(project_id,story_id,actor_id,event_type,metadata) values($1,$2,$3,'CODE_SCAN_STARTED',$4::jsonb)",
      [projectId, storyId || null, userId, JSON.stringify({ scan: n, attempt, repository: repository.repo_full_name, targetType, target })]);
    return r;
  });
  queue.push({ run, repository });
  pump();
  return run;
}

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const item = queue.shift(); active++;
    execute(item).catch(() => {}).finally(() => { active--; pump(); });
  }
}

const setRun = (id, fields) => {
  const keys = Object.keys(fields);
  return db.query('update ci_scan_runs set ' + keys.map((k, i) => k + '=$' + (i + 2)).join(',') + ' where id=$1', [id, ...keys.map((k) => fields[k])]);
};

async function execute({ run, repository }) {
  const id = run.id;
  try {
    await setRun(id, { status: 'PREPARING', started_at: new Date() });
    const { sha, label } = await checkoutSvc.resolveCommit(repository, run.target_type, run.target);
    await setRun(id, { commit_sha: sha });
    const co = await checkoutSvc.checkout(repository, sha, id, { type: run.target_type, target: run.target });
    const dir = runner.workDir(id);
    const languages = await detectLanguages(id, dir);
    await setRun(id, { status: 'RUNNING' });
    const jobs = (await db.query("select * from ci_scan_jobs where scan_run_id=$1 and status='QUEUED' order by category", [id])).rows;
    const all = [];
    let failed = 0;
    for (const job of jobs) {
      const adapter = ADAPTERS[job.category];
      await db.query("update ci_scan_jobs set status='RUNNING',started_at=now(),scanner_version=$2 where id=$1", [job.id, await version(dir, VERSION_CMD[job.category]).catch(() => null)]);
      try {
        const res = await adapter.run(id, dir, { languages });
        if (res.skipped) { await db.query("update ci_scan_jobs set status='SKIPPED',error=$2,completed_at=now() where id=$1", [job.id, res.skipped]); continue; }
        all.push(...res.findings);
        await db.query("update ci_scan_jobs set status='COMPLETED',findings_count=$2,error=$3,completed_at=now() where id=$1", [job.id, res.findings.length, res.note || null]);
      } catch (err) {
        failed++;
        await db.query("update ci_scan_jobs set status='FAILED',error=$2,completed_at=now() where id=$1", [job.id, String(err.message).slice(0, 500)]);
      }
    }
    await setRun(id, { status: 'NORMALIZING' });
    // Keep ~10 lines of code around each finding (secrets masked) for "Explain with AI", before the code is deleted.
    await captureSnippets(id, dir, all).catch(() => 0);
    const summary = await persist(run, all);
    summary.commitLabel = label; summary.files = co.files; summary.languages = Object.keys(languages).slice(0, 12);
    const status = failed && failed === jobs.length ? 'FAILED' : failed ? 'PARTIAL' : 'COMPLETED';
    await setRun(id, { status, summary: JSON.stringify(summary), completed_at: new Date(), error: failed ? failed + ' scanner(s) failed; see the scanners list.' : null });
    // Code problems as tasks (like failed tests): new Critical/High problems get a task for the team; fixes are checked.
    if (status !== 'FAILED') {
      try { await require('./findingTasks').afterScan(id); }
      catch (taskErr) { console.error('[code-intelligence] tasks after scan failed', taskErr.message); }
    }
  } catch (err) {
    await setRun(id, { status: 'FAILED', error: String(err.message).slice(0, 500), completed_at: new Date() }).catch(() => {});
  } finally {
    await checkoutSvc.cleanup(id);
  }
}

// CI-031: one finding per stable fingerprint per repository; each scan adds an occurrence.
// A finding that was FIXED and comes back is REOPENED. Returns counts for the scan summary.
async function persist(run, findings) {
  const seen = new Map();
  for (const f of findings) {
    const fp = crypto.createHash('sha256').update([f.category, f.scanner, f.key].join('#')).digest('hex');
    if (!seen.has(fp)) seen.set(fp, { ...f, fingerprint: fp });
  }
  const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }, byCategory = {};
  let created = 0;
  await db.withTransaction(async (client) => {
    for (const f of seen.values()) {
      // Priority starts equal to severity (Info → Low). A priority a person changed (priority_manual) is kept on re-scan.
      const r = await client.query(`insert into ci_findings(project_id,repository_id,fingerprint,category,scanner,rule_id,title,severity,cwe,cve,file_path,line,package_name,installed_version,fixed_version,message,first_seen_scan_id,last_seen_scan_id,priority,code_snippet,snippet_start_line)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,$18,$19,$20)
        on conflict(project_id,repository_id,fingerprint) do update set last_seen_scan_id=excluded.last_seen_scan_id,severity=excluded.severity,title=excluded.title,line=excluded.line,
          code_snippet=coalesce(excluded.code_snippet,ci_findings.code_snippet),snippet_start_line=coalesce(excluded.snippet_start_line,ci_findings.snippet_start_line),
          fixed_version=excluded.fixed_version,message=excluded.message,updated_at=now(),status=case when ci_findings.status='FIXED' then 'REOPENED' else ci_findings.status end,
          priority=case when ci_findings.priority_manual then ci_findings.priority else excluded.priority end
        returning id,(xmax=0) as inserted`,
        [run.project_id, run.repository_id, f.fingerprint, f.category, f.scanner, String(f.ruleId || 'rule').slice(0, 200), String(f.title || f.ruleId).slice(0, 300), f.severity,
          f.cwe || null, f.cve || null, f.filePath || null, f.line || null, f.packageName || null, f.installedVersion || null, f.fixedVersion || null, f.message || null, run.id,
          f.severity === 'INFO' ? 'LOW' : f.severity, f.snippet || null, f.snippetStart || null]);
      if (r.rows[0].inserted) created++;
      await client.query('insert into ci_finding_occurrences(finding_id,scan_run_id,file_path,line) values($1,$2,$3,$4) on conflict do nothing', [r.rows[0].id, run.id, f.filePath || null, f.line || null]);
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
      byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    }
  });
  return { total: seen.size, raw: findings.length, newFindings: created, bySeverity, byCategory };
}

module.exports = { ENABLED, createRun, recoverInterrupted, plan };
