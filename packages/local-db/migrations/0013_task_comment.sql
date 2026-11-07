CREATE TABLE `task_comment` (
	`sequence` integer PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`task_id` text NOT NULL,
	`body_id` text NOT NULL,
	`body_revision` integer DEFAULT 1 NOT NULL,
	`committed_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`body_id`,`body_revision`) REFERENCES `body_revisions`(`body_id`,`revision`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_comment_fixed_revision" CHECK("task_comment"."body_revision" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_comment_id_unique` ON `task_comment` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_comment_body_id_unique` ON `task_comment` (`body_id`);--> statement-breakpoint
CREATE INDEX `task_comment_scope` ON `task_comment` (`task_id`);