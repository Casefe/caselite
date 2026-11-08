CREATE UNIQUE INDEX `task_projects_task_matter` ON `task_projects` (`task_id`, `matter_id`);
--> statement-breakpoint
CREATE TABLE `project_milestones` (
  `id` text PRIMARY KEY NOT NULL,
  `matter_id` text NOT NULL REFERENCES `matters`(`id`),
  `title` text NOT NULL CHECK (length(trim(`title`)) BETWEEN 1 AND 160 AND instr(`title`, char(0)) = 0),
  `target_date` text,
  `version` integer NOT NULL DEFAULT 1 CHECK (`version` > 0),
  `created_at` text NOT NULL,
  `archived_at` text,
  UNIQUE (`id`, `matter_id`)
);
--> statement-breakpoint
CREATE INDEX `project_milestones_matter` ON `project_milestones` (`matter_id`, `target_date`);
--> statement-breakpoint
CREATE TABLE `task_milestones` (
  `task_id` text PRIMARY KEY NOT NULL,
  `matter_id` text NOT NULL,
  `milestone_id` text NOT NULL,
  FOREIGN KEY (`task_id`, `matter_id`) REFERENCES `task_projects`(`task_id`, `matter_id`) ON DELETE CASCADE,
  FOREIGN KEY (`milestone_id`, `matter_id`) REFERENCES `project_milestones`(`id`, `matter_id`)
);
--> statement-breakpoint
CREATE INDEX `task_milestones_milestone` ON `task_milestones` (`milestone_id`);
