-- DEV-1769：备忘是工作区结构化记录。不绑定 Task、Matter 或计划日期，正文不进入 Document/Yjs。
CREATE TABLE `memos` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "memos_text" CHECK(length("text") BETWEEN 1 AND 4000 AND instr("text", char(0))=0),
	CONSTRAINT "memos_status" CHECK("status" IN ('active', 'done')),
	CONSTRAINT "memos_version" CHECK(typeof("version")='integer' AND "version">0),
	CONSTRAINT "memos_deleted" CHECK("deleted_at" IS NULL OR length("deleted_at")>0)
);
--> statement-breakpoint
CREATE TABLE `memo_receipts` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`digest` text NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `memos_workspace_list` ON `memos` (`workspace_id`,`status`,`deleted_at`,`updated_at`);
