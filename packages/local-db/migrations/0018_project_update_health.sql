ALTER TABLE `project_discussion` ADD `health` text CHECK (`health` IS NULL OR (`kind` = 'update' AND `health` IN ('on_track', 'at_risk', 'off_track')));
