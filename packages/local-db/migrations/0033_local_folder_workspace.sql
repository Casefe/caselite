-- DEV-1855：个人材料与默认目录；仅追加，不覆盖原件或旧Task数据。
CREATE TEMP TABLE _personal_source_backup AS SELECT * FROM material_sources;
--> statement-breakpoint
CREATE TEMP TABLE _personal_derivation_backup AS SELECT * FROM material_derivations;
--> statement-breakpoint
DROP TABLE material_derivations;
--> statement-breakpoint
DROP TABLE material_sources;
--> statement-breakpoint
CREATE TABLE material_sources (
 id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL,
 owner_kind text NOT NULL DEFAULT 'task', task_id text,
 asset_version_id text NOT NULL, name text NOT NULL, sha256 text NOT NULL,
 bytes integer NOT NULL, page_count integer NOT NULL, derivation_id text,
 CHECK ((owner_kind='task' AND task_id IS NOT NULL) OR (owner_kind='personal' AND task_id IS NULL)),
 FOREIGN KEY(task_id) REFERENCES task_items(id) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO material_sources(id,workspace_id,owner_kind,task_id,asset_version_id,name,sha256,bytes,page_count,derivation_id)
 SELECT id,workspace_id,'task',task_id,asset_version_id,name,sha256,bytes,page_count,derivation_id FROM _personal_source_backup;
--> statement-breakpoint
CREATE TABLE material_derivations (
 id text PRIMARY KEY NOT NULL, source_id text NOT NULL, configuration text NOT NULL,
 status text NOT NULL, pages text NOT NULL,
 FOREIGN KEY(source_id) REFERENCES material_sources(id) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO material_derivations SELECT * FROM _personal_derivation_backup;
--> statement-breakpoint
DROP TABLE _personal_derivation_backup;
--> statement-breakpoint
DROP TABLE _personal_source_backup;
--> statement-breakpoint
CREATE TABLE folder_bindings (
 id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, name text NOT NULL,
 identity_version integer NOT NULL CHECK(identity_version=1), identity_hint text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX folder_binding_workspace_id ON folder_bindings(workspace_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX folder_source_workspace_id ON material_sources(workspace_id,id);
--> statement-breakpoint
CREATE TABLE folder_mappings (
 id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, binding_id text NOT NULL,
 relative_name text NOT NULL, identity_version integer NOT NULL CHECK(identity_version=1),
 entry_hint text NOT NULL, revision integer NOT NULL DEFAULT 0,
 current_source_id text, UNIQUE(binding_id,relative_name),
 FOREIGN KEY(workspace_id,binding_id) REFERENCES folder_bindings(workspace_id,id),
 FOREIGN KEY(workspace_id,current_source_id) REFERENCES material_sources(workspace_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX personal_capture_active_mapping ON material_stages
 (workspace_id,json_extract(payload,'$.target.mapping_id'))
 WHERE json_valid(payload) AND json_extract(payload,'$.kind') IN ('personal_capture_v1','personal_capture_v2')
 AND json_extract(payload,'$.phase') IN ('reserved','snapshot_planned','staged','placed');
--> statement-breakpoint
CREATE UNIQUE INDEX folder_project_workspace_id ON matters(workspace_id,id);
--> statement-breakpoint
CREATE TABLE folder_workspace_defaults (
 workspace_id text PRIMARY KEY NOT NULL, binding_id text NOT NULL, revision integer NOT NULL CHECK(revision>0),
 FOREIGN KEY(workspace_id,binding_id) REFERENCES folder_bindings(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE folder_project_bindings (
 workspace_id text NOT NULL, project_id text NOT NULL, root_binding_id text NOT NULL,
 relative_directory text NOT NULL CHECK(length(relative_directory)>0),
 directory_identity text NOT NULL CHECK(json_valid(directory_identity)),
 revision integer NOT NULL CHECK(revision>0), PRIMARY KEY(workspace_id,project_id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES matters(workspace_id,id),
 FOREIGN KEY(workspace_id,root_binding_id) REFERENCES folder_bindings(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE folder_scope_receipts (
 workspace_id text NOT NULL, request_kind text NOT NULL CHECK(request_kind='configuration'),
 request_key text NOT NULL, digest text NOT NULL,
 operation text NOT NULL CHECK(operation IN ('set_default','bind_project')),
 frozen_scope text NOT NULL CHECK(json_valid(frozen_scope)), result text NOT NULL CHECK(json_valid(result)),
 PRIMARY KEY(workspace_id,request_kind,operation,request_key)
);
--> statement-breakpoint
CREATE TABLE folder_root_locators (
 workspace_id text NOT NULL, binding_id text NOT NULL,
 locator_version integer NOT NULL CHECK(locator_version=1),
 revision integer NOT NULL CHECK(revision>0),
 private_path text NOT NULL,
 root_identity text NOT NULL CHECK(json_valid(root_identity)),
 ancestor_chain text NOT NULL CHECK(json_valid(ancestor_chain)),
 profile_identity text NOT NULL CHECK(json_valid(profile_identity)),
 PRIMARY KEY(workspace_id,binding_id),
 FOREIGN KEY(workspace_id,binding_id) REFERENCES folder_bindings(workspace_id,id)
);
