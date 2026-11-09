CREATE TABLE finance_rules (
 id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)), created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX finance_rules_workspace ON finance_rules(workspace_id);
--> statement-breakpoint
CREATE TABLE finance_settings (
 workspace_id TEXT PRIMARY KEY NOT NULL, id TEXT NOT NULL UNIQUE, default_rule_id TEXT REFERENCES finance_rules(id), version INTEGER NOT NULL CHECK(version>=0)
);
--> statement-breakpoint
CREATE TABLE finance_project_rules (
 project_id TEXT PRIMARY KEY NOT NULL REFERENCES matters(id), rule_id TEXT NOT NULL REFERENCES finance_rules(id)
);
--> statement-breakpoint
CREATE TABLE finance_allocations (
 id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES matters(id),
 installment_id TEXT NOT NULL REFERENCES finance_installments(id), payment_id TEXT NOT NULL REFERENCES finance_payments(id),
 rule_id TEXT NOT NULL REFERENCES finance_rules(id), value TEXT NOT NULL CHECK(json_valid(value)),
 created_at TEXT NOT NULL, reversed_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_allocation_payment ON finance_allocations(payment_id) WHERE reversed_at IS NULL;
--> statement-breakpoint
CREATE INDEX finance_allocations_scope ON finance_allocations(workspace_id,project_id);
--> statement-breakpoint
CREATE TABLE finance_payouts (
 id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES matters(id),
 allocation_id TEXT NOT NULL REFERENCES finance_allocations(id), amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents BETWEEN 1 AND 1000000000000),
 occurred_on TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, reversed_at TEXT
);
--> statement-breakpoint
CREATE TABLE finance_management_events (
 id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT REFERENCES matters(id), operation TEXT NOT NULL,
 target_id TEXT NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)), created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE finance_management_receipts (
 workspace_id TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL,
 event_id TEXT NOT NULL UNIQUE REFERENCES finance_management_events(id), PRIMARY KEY(workspace_id,key)
);
--> statement-breakpoint
CREATE TRIGGER finance_rules_immutable_update BEFORE UPDATE ON finance_rules BEGIN SELECT RAISE(ABORT,'immutable finance rule'); END;
--> statement-breakpoint
CREATE TRIGGER finance_rules_immutable_delete BEFORE DELETE ON finance_rules BEGIN SELECT RAISE(ABORT,'immutable finance rule'); END;
--> statement-breakpoint
CREATE TRIGGER finance_events_immutable_update BEFORE UPDATE ON finance_management_events BEGIN SELECT RAISE(ABORT,'immutable finance event'); END;
--> statement-breakpoint
CREATE TRIGGER finance_events_immutable_delete BEFORE DELETE ON finance_management_events BEGIN SELECT RAISE(ABORT,'immutable finance event'); END;
--> statement-breakpoint
CREATE TRIGGER finance_allocation_immutable BEFORE UPDATE OF value,payment_id,project_id,workspace_id,rule_id,installment_id,created_at ON finance_allocations BEGIN SELECT RAISE(ABORT,'immutable finance allocation'); END;
--> statement-breakpoint
CREATE TRIGGER finance_payout_immutable BEFORE UPDATE OF amount_cents,project_id,workspace_id,allocation_id,occurred_on,note,created_at ON finance_payouts BEGIN SELECT RAISE(ABORT,'immutable finance payout'); END;

--> statement-breakpoint
CREATE TRIGGER finance_allocations_no_delete BEFORE DELETE ON finance_allocations BEGIN SELECT RAISE(ABORT,'immutable allocation'); END;
--> statement-breakpoint
CREATE TRIGGER finance_payouts_no_delete BEFORE DELETE ON finance_payouts BEGIN SELECT RAISE(ABORT,'immutable payout'); END;
