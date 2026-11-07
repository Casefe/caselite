CREATE TABLE `project_discussion` (
	`sequence` integer PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`matter_id` text NOT NULL,
	`kind` text NOT NULL,
	`update_id` text,
	`body_id` text NOT NULL,
	`body_revision` integer DEFAULT 1 NOT NULL,
	`committed_at` text NOT NULL,
	FOREIGN KEY (`matter_id`) REFERENCES `matters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matter_id`,`update_id`) REFERENCES `project_discussion`(`matter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`body_id`,`body_revision`) REFERENCES `body_revisions`(`body_id`,`revision`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "discussion_target" CHECK(("project_discussion"."kind" IN ('project_comment','update') AND "project_discussion"."update_id" IS NULL) OR ("project_discussion"."kind" = 'update_comment' AND "project_discussion"."update_id" IS NOT NULL)),
	CONSTRAINT "discussion_fixed_revision" CHECK("project_discussion"."body_revision" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_discussion_id_unique` ON `project_discussion` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_discussion_body_id_unique` ON `project_discussion` (`body_id`);--> statement-breakpoint
CREATE INDEX `project_discussion_scope` ON `project_discussion` (`matter_id`,`kind`,`update_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_discussion_matter_id_id_unique` ON `project_discussion` (`matter_id`,`id`);