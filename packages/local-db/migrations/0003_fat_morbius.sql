CREATE TABLE `catalog_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`target_id` text NOT NULL,
	`operation` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalog_receipts` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`digest` text NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `matters` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`version` integer NOT NULL,
	`archived_at` text,
	`body_id` text NOT NULL,
	`body_revision` integer DEFAULT 0 NOT NULL,
	`editor_schema` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matters_body_id_unique` ON `matters` (`body_id`);--> statement-breakpoint
CREATE TABLE `task_projects` (
	`task_id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matter_id`) REFERENCES `matters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `documents` ADD `metadata_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `collection` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `favorite` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `in_library` integer DEFAULT false NOT NULL;