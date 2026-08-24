-- AI TestPilot — PostgreSQL schema
-- Run this once against your Postgres database, e.g.:
--   psql -U <user> -d ai_testpilot -f server/db/schema.sql
-- (Unlike MySQL, Postgres wants the database to already exist before you
-- connect to it, so create it first with `createdb ai_testpilot` or
-- `CREATE DATABASE ai_testpilot;` from psql, then run this file against it.)
-- Power BI connects directly to these four tables (Get Data -> PostgreSQL
-- database) to build dashboards.

-- One row per "Generate Test Cases" click
CREATE TABLE IF NOT EXISTS test_runs (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  story_text TEXT,
  target_url VARCHAR(512),
  environment VARCHAR(32),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- One row per generated or custom test case belonging to a run
CREATE TABLE IF NOT EXISTS test_cases (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  tc_id VARCHAR(32),
  title VARCHAR(512),
  type VARCHAR(32),
  priority VARCHAR(16),
  is_custom BOOLEAN DEFAULT FALSE
);

-- One row per executed test, pass or fail
CREATE TABLE IF NOT EXISTS test_results (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  tc_id VARCHAR(32),
  passed BOOLEAN,
  error_message TEXT,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- One row per AI explanation of a failed test
CREATE TABLE IF NOT EXISTS failure_analysis (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  tc_id VARCHAR(32),
  classification VARCHAR(64),
  summary TEXT,
  confidence DECIMAL(4,3)
);
