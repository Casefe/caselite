ALTER TABLE `task_items` ADD `subscribed` integer DEFAULT 0 NOT NULL CHECK (`subscribed` IN (0, 1));
--> statement-breakpoint
CREATE INDEX `task_activity_created_scope` ON `task_activity` (`task_id`, `operation`, `created_at`);
