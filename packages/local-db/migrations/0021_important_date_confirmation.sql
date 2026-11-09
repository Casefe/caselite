ALTER TABLE task_items ADD COLUMN attention_timezone TEXT CONSTRAINT task_attention_timezone_valid CHECK(attention_timezone IS NULL OR (attention_source='custom' AND attention_time IS NOT NULL AND typeof(attention_timezone)='text' AND length(attention_timezone) BETWEEN 1 AND 100));
--> statement-breakpoint
CREATE TABLE task_date_confirmations (workspace_id TEXT NOT NULL,receipt_key TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES task_items(id),run_id TEXT NOT NULL REFERENCES agent_runs(id),task_version INTEGER NOT NULL CHECK(task_version>0),payload TEXT NOT NULL CHECK(json_valid(payload) AND length(payload)<=120000),PRIMARY KEY(workspace_id,receipt_key));
--> statement-breakpoint
CREATE INDEX task_date_confirmation_task ON task_date_confirmations(workspace_id,task_id,task_version);
--> statement-breakpoint
CREATE TRIGGER task_date_confirmation_no_update BEFORE UPDATE ON task_date_confirmations BEGIN SELECT RAISE(ABORT,'Immutable date confirmation'); END;
--> statement-breakpoint
CREATE TRIGGER task_date_confirmation_no_delete BEFORE DELETE ON task_date_confirmations BEGIN SELECT RAISE(ABORT,'Immutable date confirmation'); END;
