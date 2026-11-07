CREATE TABLE `body_revisions` (
	`body_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state` blob NOT NULL,
	PRIMARY KEY(`body_id`, `revision`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`body_id` text NOT NULL,
	`body_revision` integer NOT NULL,
	`editor_schema` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_task_id_unique` ON `documents` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_body_id_unique` ON `documents` (`body_id`);--> statement-breakpoint
CREATE TABLE `task_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`operation` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`objective` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_receipts` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`digest` text NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`)
);
