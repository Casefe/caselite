-- DEV-1934：使用当前 SQLite 原生修改非空约束，保留旧父表、唯一索引与外键。
ALTER TABLE documents ALTER task_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE documents ADD personal_workspace_id text;
--> statement-breakpoint
ALTER TABLE documents ADD personal_title text;
--> statement-breakpoint
ALTER TABLE documents ADD personal_updated_at text;
--> statement-breakpoint
ALTER TABLE documents ADD owner_kind text NOT NULL DEFAULT 'task'
 CHECK ((owner_kind='task' AND task_id IS NOT NULL AND personal_workspace_id IS NULL AND personal_title IS NULL AND personal_updated_at IS NULL)
 OR (owner_kind='personal' AND task_id IS NULL AND typeof(personal_workspace_id)='text' AND length(personal_workspace_id)>0 AND typeof(personal_title)='text' AND length(personal_title) BETWEEN 1 AND 160 AND instr(personal_title,char(0))=0 AND typeof(personal_updated_at)='text' AND length(personal_updated_at)>0));
--> statement-breakpoint
CREATE INDEX documents_personal_workspace ON documents(personal_workspace_id,personal_updated_at);
