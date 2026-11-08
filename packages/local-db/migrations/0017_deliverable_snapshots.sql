CREATE TABLE `deliverable_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`task_id` text NOT NULL,
	`body_id` text NOT NULL,
	`body_revision` integer NOT NULL,
	`editor_schema` integer NOT NULL,
	`metadata_version` integer NOT NULL,
	`task_version` integer NOT NULL,
	`title` text NOT NULL,
	`collection` text NOT NULL,
	`tags` text NOT NULL,
	`note` text NOT NULL,
	`content_sha256` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`kind` text NOT NULL,
	`source_refs` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`body_id`,`body_revision`) REFERENCES `body_revisions`(`body_id`,`revision`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "delivery_snapshot_versions_valid" CHECK("deliverable_snapshots"."body_revision">0 AND "deliverable_snapshots"."metadata_version">0 AND "deliverable_snapshots"."task_version">0 AND "deliverable_snapshots"."editor_schema"=1),
	CONSTRAINT "delivery_snapshot_kind_valid" CHECK("deliverable_snapshots"."kind"='draft' AND "deliverable_snapshots"."created_by"='local' AND "deliverable_snapshots"."source_refs"='[]'),
	CONSTRAINT "delivery_snapshot_text_valid" CHECK(length("deliverable_snapshots"."title") BETWEEN 1 AND 160 AND length("deliverable_snapshots"."note")<=200 AND length("deliverable_snapshots"."collection")<=80 AND length("deliverable_snapshots"."content_sha256")=64),
	CONSTRAINT "delivery_snapshot_tags_valid" CHECK(CASE WHEN json_valid("deliverable_snapshots"."tags") THEN json_type("deliverable_snapshots"."tags")='array' AND json_array_length("deliverable_snapshots"."tags")<=20 ELSE 0 END)
);
--> statement-breakpoint
CREATE INDEX `delivery_workspace_document` ON `deliverable_snapshots` (`workspace_id`,`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_fixed_revision` ON `deliverable_snapshots` (`document_id`,`body_revision`,`metadata_version`,`task_version`);
--> statement-breakpoint
CREATE TRIGGER delivery_snapshot_no_update BEFORE UPDATE ON deliverable_snapshots BEGIN SELECT RAISE(ABORT, 'Fixed delivery snapshot is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_snapshot_no_delete BEFORE DELETE ON deliverable_snapshots BEGIN SELECT RAISE(ABORT, 'Fixed delivery snapshot is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_body_no_update BEFORE UPDATE ON body_revisions
WHEN EXISTS(SELECT 1 FROM deliverable_snapshots WHERE body_id=OLD.body_id AND body_revision=OLD.revision)
BEGIN SELECT RAISE(ABORT, 'Fixed delivery body is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER delivery_body_no_delete BEFORE DELETE ON body_revisions
WHEN EXISTS(SELECT 1 FROM deliverable_snapshots WHERE body_id=OLD.body_id AND body_revision=OLD.revision)
BEGIN SELECT RAISE(ABORT, 'Fixed delivery body is immutable'); END;
