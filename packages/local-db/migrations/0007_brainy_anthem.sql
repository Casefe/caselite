ALTER TABLE `task_items` ADD `priority` integer DEFAULT 0 NOT NULL CONSTRAINT `task_priority_valid` CHECK(typeof(`priority`) = 'integer' AND `priority` BETWEEN 0 AND 4);
--> statement-breakpoint
ALTER TABLE `task_items` ADD `due_date` text CONSTRAINT `task_due_date_valid` CHECK(`due_date` IS NULL OR (length(`due_date`) = 10 AND `due_date` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(`due_date`,1,4) <> '0000' AND date(`due_date`) IS NOT NULL AND date(`due_date`) = `due_date`));
