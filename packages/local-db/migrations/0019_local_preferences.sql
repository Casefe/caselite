CREATE TABLE `local_preference_receipts` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`digest` text NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `local_preferences` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`version` integer NOT NULL,
	CONSTRAINT "local_preferences_version" CHECK("local_preferences"."version" > 0),
	CONSTRAINT "local_preferences_json" CHECK(json_valid("local_preferences"."value"))
);
