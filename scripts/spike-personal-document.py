#!/usr/bin/env python3
"""DEV-1689: isolated SQLite constraint experiment; never opens product data."""

import pathlib
import sqlite3
import tempfile

MIGRATIONS = pathlib.Path(__file__).resolve().parents[1] / "packages/local-db/migrations"


def rejected(connection, sql, parameters=(), expected=None):
    try:
        connection.execute(sql, parameters)
    except sqlite3.IntegrityError as error:
        if expected is not None and str(error) != expected:
            raise AssertionError(str(error)) from error
    else:
        raise AssertionError("Invalid write was accepted")


def main():
    with tempfile.TemporaryDirectory(prefix="caselite-personal-spike-") as directory:
        connection = sqlite3.connect(pathlib.Path(directory) / "synthetic.sqlite")
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            for migration in sorted(MIGRATIONS.glob("*.sql")):
                connection.executescript(migration.read_text(encoding="utf-8"))
            connection.execute(
                "INSERT INTO task_items VALUES('task-a','local','synthetic','goal',1,'2026-11-06')"
            )
            connection.execute(
                "INSERT INTO documents(id,task_id,body_id,body_revision,editor_schema) "
                "VALUES('doc-a','task-a','body-a',1,1)"
            )
            connection.execute("INSERT INTO body_revisions VALUES('body-a',1,x'010203')")
            connection.commit()
            connection.executescript(
                """BEGIN IMMEDIATE;
                CREATE TABLE documents_new (
                  id TEXT PRIMARY KEY NOT NULL, task_id TEXT, body_id TEXT NOT NULL UNIQUE,
                  body_revision INTEGER NOT NULL, editor_schema INTEGER NOT NULL,
                  metadata_version INTEGER NOT NULL DEFAULT 1, archived_at TEXT,
                  collection TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
                  favorite INTEGER NOT NULL DEFAULT 0, in_library INTEGER NOT NULL DEFAULT 0,
                  owner_type TEXT NOT NULL, workspace_id TEXT, owner_id TEXT,
                  CHECK((owner_type='task' AND task_id IS NOT NULL AND workspace_id IS NULL AND owner_id IS NULL)
                     OR (owner_type='personal' AND task_id IS NULL AND workspace_id IS NOT NULL AND owner_id IS NOT NULL)),
                  FOREIGN KEY(task_id) REFERENCES task_items(id));
                INSERT INTO documents_new(id,task_id,body_id,body_revision,editor_schema,metadata_version,
                  archived_at,collection,tags,favorite,in_library,owner_type)
                  SELECT id,task_id,body_id,body_revision,editor_schema,metadata_version,archived_at,
                    collection,tags,favorite,in_library,'task' FROM documents;
                DROP TABLE documents;
                ALTER TABLE documents_new RENAME TO documents;
                CREATE UNIQUE INDEX documents_task_id_unique ON documents(task_id);
                CREATE UNIQUE INDEX personal_scope_ref ON documents(id,owner_type,workspace_id,owner_id);
                CREATE TABLE daily_document_index (
                  workspace_id TEXT NOT NULL, owner_id TEXT NOT NULL, day TEXT NOT NULL,
                  timezone TEXT NOT NULL, document_id TEXT NOT NULL UNIQUE,
                  owner_type TEXT NOT NULL DEFAULT 'personal' CHECK(owner_type='personal'),
                  PRIMARY KEY(workspace_id,owner_id,day,timezone),
                  FOREIGN KEY(document_id,owner_type,workspace_id,owner_id)
                    REFERENCES documents(id,owner_type,workspace_id,owner_id));
                COMMIT;"""
            )
            assert connection.execute(
                "SELECT id,task_id,body_id,body_revision FROM documents"
            ).fetchall() == [("doc-a", "task-a", "body-a", 1)]
            assert connection.execute("SELECT hex(state) FROM body_revisions").fetchone() == (
                "010203",
            )
            rejected(connection, "INSERT INTO documents(id,body_id,body_revision,editor_schema,owner_type) VALUES('bad','bad',0,1,'task')")
            connection.execute(
                "INSERT INTO documents(id,body_id,body_revision,editor_schema,owner_type,workspace_id,owner_id) "
                "VALUES('doc-b','body-b',0,1,'personal','local','me')"
            )
            insert = "INSERT INTO daily_document_index(workspace_id,owner_id,day,timezone,document_id) VALUES(?,?,?,?,?)"
            for document, workspace, owner in [
                ("doc-a", "local", "me"),
                ("doc-b", "other", "me"),
                ("doc-b", "local", "other"),
            ]:
                rejected(connection, insert, (workspace, owner, "2026-11-06", "Asia/Shanghai", document), "FOREIGN KEY constraint failed")
            connection.execute(insert, ("local", "me", "2026-11-06", "Asia/Shanghai", "doc-b"))
            rejected(connection, insert, ("local", "me", "2026-11-06", "Asia/Shanghai", "doc-b"))
            connection.commit()
            before = connection.execute("SELECT id,task_id,body_id,body_revision FROM documents ORDER BY id").fetchall()
            try:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute("ALTER TABLE documents RENAME TO simulated_old")
                connection.execute("CREATE TABLE documents(id TEXT PRIMARY KEY)")
                raise RuntimeError("injected failure before commit")
            except RuntimeError:
                connection.rollback()
            assert connection.execute("SELECT id,task_id,body_id,body_revision FROM documents ORDER BY id").fetchall() == before
            assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
            print(f"PASS: synthetic migration constraints and transaction rollback (SQLite {sqlite3.sqlite_version})")
            print("NOT_RUN: real Drizzle migration, disk fault, process crash, Yjs, IPC, desktop recovery")
        finally:
            connection.close()


if __name__ == "__main__":
    main()
