/**
 * Database Layer (PostgreSQL)
 * -----------------------
 * Stores story/test-case/results history so Power BI (or anything else)
 * can build dashboards on top of it via a direct PostgreSQL connection.
 *
 * IMPORTANT: persistence is optional, not required for the app to run.
 * If DB_HOST/DB_USER/DB_NAME aren't set in .env, every function here
 * silently no-ops — the chat pipeline keeps working exactly as before,
 * just without history being saved. This is deliberate: a missing or
 * misconfigured database should never break the live testing flow.
 */
let Pool;
try {
  ({ Pool } = require("pg"));
} catch {
  Pool = null; // package not installed yet — treated the same as "not configured"
}

let pool = null;
let dbEnabled = false;

function initDb() {
  if (!Pool) {
    console.log("[db] pg package not installed — run `npm install` after adding it to package.json. Persistence disabled.");
    return;
  }
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
    console.log("[db] DB_HOST/DB_USER/DB_NAME not set in .env — persistence disabled, app runs normally without history storage.");
    return;
  }
  try {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME,
      max: 5,
    });
    dbEnabled = true;
    console.log(`[db] ✅ PostgreSQL persistence enabled (${process.env.DB_HOST}/${process.env.DB_NAME})`);
  } catch (err) {
    console.error("[db] Failed to initialize PostgreSQL pool:", err.message);
  }
}

async function saveRun({ sessionId, story, targetUrl, environment }) {
  if (!dbEnabled) return null;
  try {
    const result = await pool.query(
      "INSERT INTO test_runs (session_id, story_text, target_url, environment) VALUES ($1, $2, $3, $4) RETURNING id",
      [sessionId, story, targetUrl, environment]
    );
    return result.rows[0].id;
  } catch (err) {
    console.error("[db] Failed to save run:", err.message);
    return null;
  }
}

async function saveTestCases(runId, testCases) {
  if (!dbEnabled || !runId) return;
  try {
    for (const tc of testCases) {
      await pool.query(
        "INSERT INTO test_cases (run_id, tc_id, title, type, priority, is_custom) VALUES ($1, $2, $3, $4, $5, $6)",
        [runId, tc.id, tc.title, tc.type, tc.priority, !!tc.custom]
      );
    }
  } catch (err) {
    console.error("[db] Failed to save test cases:", err.message);
  }
}

async function saveResults(runId, tests) {
  if (!dbEnabled || !runId) return;
  try {
    for (const t of tests) {
      const tcId = t.title?.match(/TC(?:\d{3}|-C\d+)/)?.[0] || null;
      await pool.query(
        "INSERT INTO test_results (run_id, tc_id, passed, error_message) VALUES ($1, $2, $3, $4)",
        [runId, tcId, !!t.pass, t.err?.message || null]
      );
    }
  } catch (err) {
    console.error("[db] Failed to save results:", err.message);
  }
}

async function saveFailureAnalyses(runId, analyses) {
  if (!dbEnabled || !runId) return;
  try {
    for (const a of analyses) {
      await pool.query(
        "INSERT INTO failure_analysis (run_id, tc_id, classification, summary, confidence) VALUES ($1, $2, $3, $4, $5)",
        [runId, a.testCase, a.classification, a.summary, a.confidence]
      );
    }
  } catch (err) {
    console.error("[db] Failed to save failure analysis:", err.message);
  }
}

module.exports = {
  initDb,
  saveRun,
  saveTestCases,
  saveResults,
  saveFailureAnalyses,
  isDbEnabled: () => dbEnabled,
};
