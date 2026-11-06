CREATE TABLE `material_derivations` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`configuration` text NOT NULL,
	`status` text NOT NULL,
	`pages` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `material_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `material_home` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `material_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`scope` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `material_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
	`asset_version_id` text NOT NULL,
	`name` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`page_count` integer NOT NULL,
	`derivation_id` text,
	FOREIGN KEY (`task_id`) REFERENCES `task_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `material_stages` (
	`token` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`payload` text NOT NULL
);
