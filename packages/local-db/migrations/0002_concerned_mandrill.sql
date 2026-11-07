CREATE TABLE `task_objective_revisions` (
	`task_id` text NOT NULL,
	`task_version` integer NOT NULL,
	`state` blob NOT NULL,
	PRIMARY KEY(`task_id`, `task_version`),
	FOREIGN KEY (`task_id`) REFERENCES `task_items`(`id`) ON UPDATE no action ON DELETE no action
);
