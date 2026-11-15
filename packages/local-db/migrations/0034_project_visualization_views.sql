-- DEV-1910-A：只持久显示配置，不写业务投影、正文或固定来源。
CREATE TABLE `project_visualization_views` (
 `workspace_id` text NOT NULL,
 `project_id` text NOT NULL,
 `view_id` text NOT NULL,
 `format_version` integer NOT NULL,
 `revision` integer NOT NULL,
 `configuration` text NOT NULL,
 `source_fingerprint` text NOT NULL,
 PRIMARY KEY (`workspace_id`, `project_id`, `view_id`),
 FOREIGN KEY (`project_id`) REFERENCES `matters`(`id`) ON UPDATE no action ON DELETE no action,
 CONSTRAINT `visualization_current` CHECK (`view_id`='current' AND `format_version`=1),
 CONSTRAINT `visualization_revision` CHECK (typeof(`revision`)='integer' AND `revision`>0),
 CONSTRAINT `visualization_config` CHECK (length(CAST(`configuration` AS blob))<=131072 AND json_valid(`configuration`)),
 CONSTRAINT `visualization_fingerprint` CHECK (length(`source_fingerprint`)=64 AND `source_fingerprint` NOT GLOB '*[^a-f0-9]*')
);
