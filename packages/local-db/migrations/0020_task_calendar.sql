ALTER TABLE task_items ADD COLUMN planned_date TEXT CONSTRAINT task_calendar_planned_date_valid CHECK(planned_date IS NULL OR (typeof(planned_date)='text' AND length(planned_date)=10 AND planned_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(planned_date,1,4)<>'0000' AND date(planned_date) IS NOT NULL AND date(planned_date)=planned_date));
--> statement-breakpoint
ALTER TABLE task_items ADD COLUMN schedule_date TEXT CONSTRAINT task_calendar_schedule_date_valid CHECK(schedule_date IS NULL OR (typeof(schedule_date)='text' AND length(schedule_date)=10 AND schedule_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(schedule_date,1,4)<>'0000' AND date(schedule_date) IS NOT NULL AND date(schedule_date)=schedule_date));
--> statement-breakpoint
ALTER TABLE task_items ADD COLUMN schedule_start TEXT CONSTRAINT task_calendar_schedule_start_valid CHECK(schedule_start IS NULL OR (typeof(schedule_start)='text' AND schedule_start GLOB '[0-2][0-9]:[0-5][0-9]' AND schedule_start<'24:00'));
--> statement-breakpoint
ALTER TABLE task_items ADD COLUMN schedule_end TEXT CONSTRAINT task_calendar_schedule_end_valid CHECK(schedule_end IS NULL OR (typeof(schedule_end)='text' AND schedule_end GLOB '[0-2][0-9]:[0-5][0-9]' AND schedule_end<'24:00'));
--> statement-breakpoint
ALTER TABLE task_items ADD COLUMN schedule_timezone TEXT CONSTRAINT task_calendar_schedule_complete_valid CHECK((schedule_date IS NULL AND schedule_start IS NULL AND schedule_end IS NULL AND schedule_timezone IS NULL) OR (schedule_date IS NOT NULL AND schedule_start IS NOT NULL AND schedule_end IS NOT NULL AND schedule_start<schedule_end AND typeof(schedule_timezone)='text' AND length(schedule_timezone) BETWEEN 1 AND 100));
--> statement-breakpoint
ALTER TABLE task_items ADD COLUMN is_important INTEGER NOT NULL DEFAULT 0 CONSTRAINT task_calendar_important_flag_valid CHECK(is_important IN (0,1));
--> statement-breakpoint
ALTER TABLE task_items ADD COLUMN important_type_id TEXT CONSTRAINT task_calendar_important_type_valid CHECK((important_type_id IS NULL AND is_important=0) OR (typeof(important_type_id)='text' AND length(important_type_id) BETWEEN 1 AND 80));
--> statement-breakpoint
ALTER TABLE task_items ADD COLUMN attention_source TEXT NOT NULL DEFAULT 'unknown' CONSTRAINT task_calendar_attention_source_valid CHECK(attention_source IN ('unknown','schedule','planned','due','custom'));
--> statement-breakpoint
ALTER TABLE task_items ADD COLUMN attention_date TEXT CONSTRAINT task_calendar_attention_date_valid CHECK(attention_date IS NULL OR (typeof(attention_date)='text' AND length(attention_date)=10 AND attention_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(attention_date,1,4)<>'0000' AND date(attention_date) IS NOT NULL AND date(attention_date)=attention_date));
--> statement-breakpoint
ALTER TABLE task_items ADD COLUMN attention_time TEXT CONSTRAINT task_calendar_attention_complete_valid CHECK((attention_source='custom' OR (attention_date IS NULL AND attention_time IS NULL)) AND (attention_time IS NULL OR (attention_date IS NOT NULL AND (typeof(attention_time)='text' AND attention_time GLOB '[0-2][0-9]:[0-5][0-9]' AND attention_time<'24:00'))));
--> statement-breakpoint
CREATE TABLE calendar_types (workspace_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL CONSTRAINT calendar_type_name CHECK(typeof(name)='text' AND length(trim(name)) BETWEEN 1 AND 30 AND instr(name,char(0))=0),enabled INTEGER NOT NULL,show_home INTEGER NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(workspace_id,id),CONSTRAINT calendar_type_flags CHECK(enabled IN (0,1) AND show_home IN (0,1) AND version>0));
--> statement-breakpoint
CREATE INDEX task_calendar_planned ON task_items(workspace_id,planned_date);
--> statement-breakpoint
CREATE INDEX task_calendar_timed ON task_items(workspace_id,schedule_date);
--> statement-breakpoint
CREATE INDEX task_calendar_important ON task_items(workspace_id,is_important);
