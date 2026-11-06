ALTER TABLE `task_items` ADD COLUMN `status` text DEFAULT 'todo' NOT NULL CONSTRAINT `task_status_valid` CHECK (`status` IN ('todo', 'in_progress', 'done', 'canceled'));
