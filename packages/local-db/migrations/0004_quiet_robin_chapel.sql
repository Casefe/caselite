CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`scope` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`payload` text NOT NULL
);
