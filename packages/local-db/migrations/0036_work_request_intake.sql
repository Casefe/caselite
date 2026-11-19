-- DEV-1896：本机工作请求只保存人工分拣。采纳绑定原 Task 行，不另建任务表。
CREATE TABLE `work_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`attachment_draft_id` text,
	`target_task_id` text,
	`target_task_version` integer,
	`duplicate_of_request_id` text,
	`snooze_until` text,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `work_request_shape` CHECK(
		`source` = 'local_manual'
		AND `version` > 0
		AND length(`title`) BETWEEN 1 AND 160
		AND instr(`title`, char(0)) = 0
		AND length(`body`) <= 4000
		AND instr(`body`, char(0)) = 0
		AND (
			(`status` = 'pending' AND `target_task_id` IS NULL AND `target_task_version` IS NULL AND `duplicate_of_request_id` IS NULL AND `snooze_until` IS NULL)
			OR (`status` = 'rejected' AND `target_task_id` IS NULL AND `target_task_version` IS NULL AND `duplicate_of_request_id` IS NULL AND `snooze_until` IS NULL)
			OR (`status` = 'snoozed' AND `snooze_until` IS NOT NULL AND `target_task_id` IS NULL AND `target_task_version` IS NULL AND `duplicate_of_request_id` IS NULL)
			OR (`status` = 'accepted' AND `target_task_id` IS NOT NULL AND `target_task_version` > 0 AND `duplicate_of_request_id` IS NULL AND `snooze_until` IS NULL)
			OR (`status` = 'duplicate' AND `snooze_until` IS NULL AND (
				(`duplicate_of_request_id` IS NOT NULL AND `target_task_id` IS NULL AND `target_task_version` IS NULL)
				OR (`target_task_id` IS NOT NULL AND `target_task_version` > 0 AND `duplicate_of_request_id` IS NULL)
			))
		)
	),
	FOREIGN KEY (`target_task_id`) REFERENCES `task_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`duplicate_of_request_id`) REFERENCES `work_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_draft_id`) REFERENCES `material_stages`(`token`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `work_requests_workspace` ON `work_requests` (`workspace_id`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `work_request_receipts` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`digest` text NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`)
);
