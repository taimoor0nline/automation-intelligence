create table if not exists behavior_rules (
  session_id text not null references test_sessions(id) on delete cascade,
  rule_id varchar(160) not null,
  version integer not null default 1,
  scope_type varchar(30) not null,
  scope_ref varchar(240) not null,
  page_ref varchar(180),
  form_ref varchar(180),
  element_ref varchar(180),
  rule_type varchar(80) not null,
  rule_value jsonb,
  trigger_type varchar(40) not null default 'AUTO',
  expected_state varchar(80),
  error_element_ref varchar(180),
  source varchar(40) not null,
  approved boolean not null default false,
  enabled boolean not null default true,
  notes text,
  updated_at timestamptz not null default now(),
  primary key(session_id, rule_id)
);
create index if not exists ix_behavior_rules_scope on behavior_rules(session_id,scope_type,scope_ref);
create index if not exists ix_behavior_rules_element on behavior_rules(session_id,element_ref);

create table if not exists behavior_rule_history (
  id bigserial primary key,
  session_id text not null references test_sessions(id) on delete cascade,
  rule_id varchar(160) not null,
  version integer not null,
  snapshot_json jsonb not null,
  recorded_at timestamptz not null default now(),
  unique(session_id,rule_id,version)
);

create table if not exists behavior_rule_conflicts (
  session_id text not null references test_sessions(id) on delete cascade,
  conflict_id varchar(160) not null,
  rule_id varchar(160),
  status varchar(40) not null default 'REVIEW_REQUIRED',
  conflict_json jsonb not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key(session_id, conflict_id)
);

create table if not exists test_case_rule_links (
  session_id text not null references test_sessions(id) on delete cascade,
  external_case_id varchar(40) not null,
  rule_id varchar(160) not null,
  rule_version integer not null default 1,
  linked_at timestamptz not null default now(),
  primary key(session_id,external_case_id,rule_id)
);
create index if not exists ix_test_case_rule_links_rule on test_case_rule_links(session_id,rule_id);
