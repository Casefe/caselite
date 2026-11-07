ALTER TABLE `matters` ADD `project_type` text DEFAULT 'general' NOT NULL CONSTRAINT `project_type_valid` CHECK(`project_type` IN ('general','litigation','contract_review'));
--> statement-breakpoint
ALTER TABLE `matters` ADD `assignee` text CONSTRAINT `project_assignee_valid` CHECK(`assignee` IS NULL OR (length(trim(`assignee`)) BETWEEN 1 AND 80));
--> statement-breakpoint
ALTER TABLE `matters` ADD `priority` integer DEFAULT 0 NOT NULL CONSTRAINT `project_priority_valid` CHECK(typeof(`priority`) = 'integer' AND `priority` BETWEEN 0 AND 4);
--> statement-breakpoint
ALTER TABLE `matters` ADD `start_date` text CONSTRAINT `project_start_valid` CHECK(`start_date` IS NULL OR (length(`start_date`) = 10 AND `start_date` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(`start_date`,1,4) <> '0000' AND date(`start_date`) IS NOT NULL AND date(`start_date`) = `start_date`));
--> statement-breakpoint
ALTER TABLE `matters` ADD `target_date` text CONSTRAINT `project_target_valid` CHECK((`target_date` IS NULL OR (length(`target_date`) = 10 AND `target_date` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(`target_date`,1,4) <> '0000' AND date(`target_date`) IS NOT NULL AND date(`target_date`) = `target_date`)) AND (`start_date` IS NULL OR `target_date` IS NULL OR `start_date` <= `target_date`));
--> statement-breakpoint
ALTER TABLE `matters` ADD `tags` text DEFAULT '[]' NOT NULL CONSTRAINT `project_tags_valid` CHECK(CASE WHEN json_valid(`tags`) THEN json_type(`tags`) = 'array' AND json_array_length(`tags`) <= 20 ELSE 0 END);
