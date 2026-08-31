create table if not exists application_behavior_rules (
  application_key varchar(320) not null,
  rule_id varchar(160) not null,
  version integer not null default 1,
  rule_json jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(application_key,rule_id)
);

create table if not exists application_behavior_rule_history (
  id bigserial primary key,
  application_key varchar(320) not null,
  rule_id varchar(160) not null,
  version integer not null,
  snapshot_json jsonb not null,
  recorded_at timestamptz not null default now(),
  unique(application_key,rule_id,version)
);

create table if not exists application_behavior_conflicts (
  application_key varchar(320) not null,
  conflict_id varchar(160) not null,
  conflict_json jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(application_key,conflict_id)
);
