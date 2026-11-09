CREATE TABLE finance_candidates (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES matters(id),value TEXT NOT NULL CHECK(json_valid(value)),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','dismissed')),confirmed_target_id TEXT,created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX finance_candidates_project ON finance_candidates(workspace_id,project_id);
--> statement-breakpoint
CREATE TABLE finance_source_links (
 candidate_id TEXT PRIMARY KEY NOT NULL REFERENCES finance_candidates(id),workspace_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES matters(id),operation TEXT NOT NULL,target_id TEXT NOT NULL UNIQUE,edited INTEGER NOT NULL CHECK(edited IN (0,1)),created_at TEXT NOT NULL
);
--> statement-breakpoint
ALTER TABLE finance_receipts ADD COLUMN source_candidate_id TEXT REFERENCES finance_candidates(id);
--> statement-breakpoint
CREATE TRIGGER finance_candidates_immutable BEFORE UPDATE OF id,workspace_id,project_id,value,created_at ON finance_candidates BEGIN SELECT RAISE(ABORT,'immutable financial source'); END;
--> statement-breakpoint
CREATE TRIGGER finance_candidates_no_delete BEFORE DELETE ON finance_candidates BEGIN SELECT RAISE(ABORT,'immutable financial source'); END;
--> statement-breakpoint
CREATE TRIGGER finance_source_links_no_update BEFORE UPDATE ON finance_source_links BEGIN SELECT RAISE(ABORT,'immutable financial source link'); END;
--> statement-breakpoint
CREATE TRIGGER finance_source_links_no_delete BEFORE DELETE ON finance_source_links BEGIN SELECT RAISE(ABORT,'immutable financial source link'); END;

--> statement-breakpoint
ALTER TABLE finance_payments ADD COLUMN occurred_on TEXT;
--> statement-breakpoint
ALTER TABLE finance_payments ADD COLUMN note TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TRIGGER finance_payments_no_update BEFORE UPDATE ON finance_payments BEGIN SELECT RAISE(ABORT,'immutable payment'); END;
--> statement-breakpoint
CREATE TRIGGER finance_payments_no_delete BEFORE DELETE ON finance_payments BEGIN SELECT RAISE(ABORT,'immutable payment'); END;
--> statement-breakpoint
CREATE TRIGGER finance_receipts_no_update BEFORE UPDATE ON finance_receipts BEGIN SELECT RAISE(ABORT,'immutable finance receipt'); END;
--> statement-breakpoint
CREATE TRIGGER finance_receipts_no_delete BEFORE DELETE ON finance_receipts BEGIN SELECT RAISE(ABORT,'immutable finance receipt'); END;
