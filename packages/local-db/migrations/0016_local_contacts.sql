CREATE TABLE `contacts` (
  `id` text NOT NULL,
  `workspace_id` text NOT NULL,
  `name` text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  `kind` text NOT NULL CHECK(kind IN ('person', 'organization')),
  `phone` text NOT NULL,
  `email` text NOT NULL,
  `version` integer NOT NULL CHECK(version >= 1),
  `updated_at` text NOT NULL,
  PRIMARY KEY (`workspace_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `contact_projects` (
  `workspace_id` text NOT NULL,
  `contact_id` text NOT NULL,
  `project_id` text NOT NULL REFERENCES `matters`(`id`),
  PRIMARY KEY (`workspace_id`, `contact_id`, `project_id`),
  FOREIGN KEY (`workspace_id`, `contact_id`) REFERENCES `contacts`(`workspace_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `contact_receipts` (
  `workspace_id` text NOT NULL,
  `key` text NOT NULL,
  `digest` text NOT NULL,
  `contact_id` text NOT NULL,
  PRIMARY KEY (`workspace_id`, `key`),
  FOREIGN KEY (`workspace_id`, `contact_id`) REFERENCES `contacts`(`workspace_id`, `id`)
);
