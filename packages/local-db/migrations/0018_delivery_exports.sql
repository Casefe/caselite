CREATE TABLE `delivery_export_intents` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`digest` text NOT NULL,
	`export_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`),
	FOREIGN KEY (`export_id`) REFERENCES `delivery_exports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `delivery_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`format` text NOT NULL,
	`converter` text NOT NULL,
	`status` text NOT NULL,
	`sha256` text,
	`bytes` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `deliverable_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_exports_snapshot_format` ON `delivery_exports` (`workspace_id`,`snapshot_id`,`format`,`converter`);
--> statement-breakpoint
CREATE TRIGGER delivery_exports_ready_immutable BEFORE UPDATE ON delivery_exports WHEN OLD.status='ready' BEGIN SELECT RAISE(ABORT,'Ready export is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_exports_no_delete BEFORE DELETE ON delivery_exports BEGIN SELECT RAISE(ABORT,'Export identity is retained'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_export_intents_no_update BEFORE UPDATE ON delivery_export_intents BEGIN SELECT RAISE(ABORT,'Export request is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_export_intents_no_delete BEFORE DELETE ON delivery_export_intents BEGIN SELECT RAISE(ABORT,'Export request is retained'); END;
