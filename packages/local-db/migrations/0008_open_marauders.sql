CREATE TABLE `reminder_attempts` (
	`reminder_id` text NOT NULL,
	`plan_revision` integer NOT NULL,
	`status` text NOT NULL,
	`attempted_at` text NOT NULL,
	PRIMARY KEY(`reminder_id`, `plan_revision`),
	FOREIGN KEY (`reminder_id`) REFERENCES `reminders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reminder_receipts` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`digest` text NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
	`date` text NOT NULL,
	`time` text NOT NULL,
	`timezone` text NOT NULL,
	`instant` text NOT NULL,
	`version` integer NOT NULL,
	`plan_revision` integer NOT NULL,
	`status` text NOT NULL,
	`read_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_task_id_unique` ON `reminders` (`task_id`);