CREATE TABLE finance_expenses (
 id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES matters(id),
 value TEXT NOT NULL CHECK(json_valid(value)),created_at TEXT NOT NULL,reversed_at TEXT
);
--> statement-breakpoint
CREATE INDEX finance_expenses_project ON finance_expenses(workspace_id,project_id);
--> statement-breakpoint
CREATE TABLE finance_reimbursements (
 id TEXT PRIMARY KEY NOT NULL,workspace_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES matters(id),expense_id TEXT NOT NULL REFERENCES finance_expenses(id),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents BETWEEN 1 AND 1000000000000),
 occurred_on TEXT NOT NULL,note TEXT NOT NULL,from_party TEXT NOT NULL CHECK(from_party IN ('lawyer','firm','client')),to_party TEXT NOT NULL CHECK(to_party IN ('lawyer','firm','client')),
 created_at TEXT NOT NULL,reversed_at TEXT
);
--> statement-breakpoint
CREATE TRIGGER finance_expenses_immutable BEFORE UPDATE OF id,workspace_id,project_id,value,created_at ON finance_expenses BEGIN SELECT RAISE(ABORT,'immutable expense'); END;
--> statement-breakpoint
CREATE TRIGGER finance_expenses_no_delete BEFORE DELETE ON finance_expenses BEGIN SELECT RAISE(ABORT,'immutable expense'); END;
--> statement-breakpoint
CREATE TRIGGER finance_reimbursements_immutable BEFORE UPDATE OF id,workspace_id,project_id,expense_id,amount_cents,occurred_on,note,from_party,to_party,created_at ON finance_reimbursements BEGIN SELECT RAISE(ABORT,'immutable reimbursement'); END;
--> statement-breakpoint
CREATE TRIGGER finance_reimbursements_no_delete BEFORE DELETE ON finance_reimbursements BEGIN SELECT RAISE(ABORT,'immutable reimbursement'); END;
