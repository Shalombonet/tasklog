-- This migration adds timestamp indexes for report activity queries.
CREATE INDEX IF NOT EXISTS history_task_created_at_idx ON history(task_id, created_at);
CREATE INDEX IF NOT EXISTS notes_task_created_at_idx ON notes(task_id, created_at);
