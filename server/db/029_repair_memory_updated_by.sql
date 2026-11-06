-- Who last changed an AI learning (e.g. switched it between Project-specific and Global).
alter table ai_repair_memory add column if not exists updated_by uuid references users(id) on delete set null;
