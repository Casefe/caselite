ALTER TABLE contacts ADD COLUMN wechat text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN company text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN position text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN city text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN relationship text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN tags text NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE TABLE contact_entries (
  workspace_id text NOT NULL,
  contact_id text NOT NULL,
  id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('communication','note')),
  title text NOT NULL,
  channel text NOT NULL CHECK(channel IN ('phone','wechat','email','meeting','other')),
  occurred_on text,
  body_id text NOT NULL UNIQUE,
  body_revision integer NOT NULL CHECK(body_revision >= 1),
  version integer NOT NULL CHECK(version >= 1),
  source_run_id text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  PRIMARY KEY(workspace_id,id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX contact_entry_run ON contact_entries(workspace_id,source_run_id) WHERE source_run_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX contact_entries_contact ON contact_entries(workspace_id,contact_id,kind,occurred_on);
--> statement-breakpoint
CREATE TABLE contact_links (
  workspace_id text NOT NULL,
  contact_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('task','document')),
  target_id text NOT NULL,
  PRIMARY KEY(workspace_id,contact_id,kind,target_id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE contact_workspace_receipts (
  workspace_id text NOT NULL,
  key text NOT NULL,
  digest text NOT NULL,
  contact_id text NOT NULL,
  PRIMARY KEY(workspace_id,key),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id)
);
