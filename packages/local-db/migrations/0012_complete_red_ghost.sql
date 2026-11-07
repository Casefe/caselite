ALTER TABLE `task_items` ADD `tags` text DEFAULT '[]' NOT NULL
  CONSTRAINT `task_tags_valid` CHECK (
    CASE WHEN json_valid(`tags`) THEN json_type(`tags`) = 'array' AND json_array_length(`tags`) <= 20 ELSE 0 END
  );
