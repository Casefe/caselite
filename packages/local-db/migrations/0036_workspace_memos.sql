CREATE TABLE `memo_receipts` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`digest` text NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `memo_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`text` text NOT NULL,
	`lifecycle` text NOT NULL DEFAULT 'active',
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`scratched_at` text,
	`deleted_at` text,
	CONSTRAINT "memo_text_valid" CHECK(typeof("memo_items"."text")='text' AND length(trim("memo_items"."text")) BETWEEN 1 AND 2000 AND instr("memo_items"."text", char(0))=0),
	CONSTRAINT "memo_lifecycle_valid" CHECK("memo_items"."lifecycle" IN ('active','scratched','deleted')),
	CONSTRAINT "memo_version_valid" CHECK("memo_items"."version">0),
	CONSTRAINT "memo_lifecycle_timestamps_valid" CHECK(
		("memo_items"."lifecycle"='active' AND "memo_items"."scratched_at" IS NULL AND "memo_items"."deleted_at" IS NULL)
		OR ("memo_items"."lifecycle"='scratched' AND "memo_items"."scratched_at" IS NOT NULL AND "memo_items"."deleted_at" IS NULL)
		OR ("memo_items"."lifecycle"='deleted' AND "memo_items"."deleted_at" IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE INDEX `memo_workspace_daily` ON `memo_items` (`workspace_id`,`lifecycle`,`updated_at`);