-- Source code card: each linked repository can keep its own read-only GitHub token (encrypted, never returned to the browser).
alter table source_repositories add column if not exists access_token_encrypted text;
alter table source_repositories add column if not exists token_updated_at timestamptz;
alter table source_repositories add column if not exists token_updated_by uuid references users(id) on delete set null;
