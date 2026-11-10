ALTER TABLE contacts ADD COLUMN address text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE contact_source_links (
  workspace_id text NOT NULL,
  contact_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('run','material','payment')),
  source_id text NOT NULL,
  source_scope text NOT NULL,
  linked_at text NOT NULL,
  PRIMARY KEY(workspace_id,contact_id,kind,source_id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id)
);
