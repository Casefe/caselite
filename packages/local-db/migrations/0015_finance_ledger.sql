CREATE TABLE `finance_contracts` (
	`project_id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `matters`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_contract_number" CHECK(length(trim("finance_contracts"."number")) BETWEEN 1 AND 120),
	CONSTRAINT "finance_contract_amount" CHECK(typeof("finance_contracts"."amount_cents") = 'integer' AND "finance_contracts"."amount_cents" BETWEEN 1 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `finance_installments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`due_date` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `finance_contracts`(`project_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_installment_amount" CHECK(typeof("finance_installments"."amount_cents") = 'integer' AND "finance_installments"."amount_cents" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "finance_installment_date" CHECK(length("finance_installments"."due_date") = 10 AND substr("finance_installments"."due_date",1,4) <> '0000' AND date("finance_installments"."due_date") IS NOT NULL AND date("finance_installments"."due_date") = "finance_installments"."due_date")
);
--> statement-breakpoint
CREATE INDEX `finance_installment_project` ON `finance_installments` (`project_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `finance_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`installment_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`committed_at` text NOT NULL,
	FOREIGN KEY (`installment_id`) REFERENCES `finance_installments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_payment_amount" CHECK(typeof("finance_payments"."amount_cents") = 'integer' AND "finance_payments"."amount_cents" BETWEEN 1 AND 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `finance_payment_installment` ON `finance_payments` (`installment_id`);--> statement-breakpoint
CREATE TABLE `finance_receipts` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`digest` text NOT NULL,
	`project_id` text NOT NULL,
	`operation` text NOT NULL,
	`target_id` text NOT NULL,
	`activity_id` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`),
	FOREIGN KEY (`project_id`) REFERENCES `matters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`activity_id`) REFERENCES `catalog_activity`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_receipt_operation" CHECK("finance_receipts"."operation" IN ('register_contract','record_payment','reverse_payment'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_receipts_activity_id_unique` ON `finance_receipts` (`activity_id`);--> statement-breakpoint
CREATE TABLE `finance_reversals` (
	`payment_id` text PRIMARY KEY NOT NULL,
	`committed_at` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `finance_payments`(`id`) ON UPDATE no action ON DELETE no action
);
