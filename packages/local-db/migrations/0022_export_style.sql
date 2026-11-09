ALTER TABLE `delivery_exports` ADD COLUMN `configuration_json` text CHECK (`configuration_json` IS NULL OR json_valid(`configuration_json`));
--> statement-breakpoint
ALTER TABLE `delivery_exports` ADD COLUMN `configuration_fingerprint` text NOT NULL DEFAULT '' CHECK ((`configuration_json` IS NULL AND `configuration_fingerprint`='') OR (`configuration_json` IS NOT NULL AND length(`configuration_fingerprint`)=64 AND `configuration_fingerprint` NOT GLOB '*[^0-9a-f]*' AND COALESCE(json_extract(`configuration_json`,'$.fingerprint')=`configuration_fingerprint`,0)));
--> statement-breakpoint
DROP INDEX `delivery_exports_snapshot_format`;
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_exports_snapshot_format` ON `delivery_exports` (`workspace_id`,`snapshot_id`,`format`,`converter`,`configuration_fingerprint`);
