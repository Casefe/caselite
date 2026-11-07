ALTER TABLE `task_items` ADD COLUMN `assignee` text DEFAULT '本人'
  CONSTRAINT "task_assignee_valid" CHECK(
    "assignee" IS NULL OR (typeof("assignee") = 'text' AND instr("assignee", char(0)) = 0 AND length(trim("assignee")) BETWEEN 1 AND 80)
  );
