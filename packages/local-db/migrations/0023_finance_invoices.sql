CREATE TABLE finance_invoices (
 id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES matters(id),
 installment_id TEXT NOT NULL REFERENCES finance_installments(id), invoice_number TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('invoice','red_invoice')), original_invoice_id TEXT REFERENCES finance_invoices(id),
 amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents BETWEEN 1 AND 1000000000000),
 occurred_on TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(workspace_id,invoice_number),
 CHECK((kind='invoice' AND original_invoice_id IS NULL) OR (kind='red_invoice' AND original_invoice_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX finance_invoices_project ON finance_invoices(workspace_id,project_id);
--> statement-breakpoint
CREATE TRIGGER finance_invoices_no_update BEFORE UPDATE ON finance_invoices BEGIN SELECT RAISE(ABORT,'immutable invoice'); END;
--> statement-breakpoint
CREATE TRIGGER finance_invoices_no_delete BEFORE DELETE ON finance_invoices BEGIN SELECT RAISE(ABORT,'immutable invoice'); END;
