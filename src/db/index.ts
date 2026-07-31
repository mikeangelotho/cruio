import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import * as schema from "./schema";

export const DATA_DIR = join(process.cwd(), "data");
export const UPLOADS_DIR = join(DATA_DIR, "uploads");

mkdirSync(UPLOADS_DIR, { recursive: true });

const client = createClient({
  url: "file:" + join(DATA_DIR, "cruio.db").replace(/\\/g, "/"),
});

// Boot DDL. Rule: any change to schema.ts / auth-schema.ts must be mirrored
// here in the same commit.
const DDL = `
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  active_organization_id TEXT
);
CREATE INDEX IF NOT EXISTS session_userId_idx ON session(user_id);
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_userId_idx ON account(user_id);
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);
CREATE TABLE IF NOT EXISTS organization (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo TEXT,
  created_at INTEGER NOT NULL,
  metadata TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_slug_uidx ON organization(slug);
CREATE TABLE IF NOT EXISTS member (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS member_organizationId_idx ON member(organization_id);
CREATE INDEX IF NOT EXISTS member_userId_idx ON member(user_id);
CREATE TABLE IF NOT EXISTS invitation (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  inviter_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS invitation_organizationId_idx ON invitation(organization_id);
CREATE INDEX IF NOT EXISTS invitation_email_idx ON invitation(email);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name TEXT NOT NULL,
  entity_id TEXT REFERENCES entities(id),
  phase TEXT NOT NULL DEFAULT 'pre_production',
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  archived_by TEXT
);
CREATE TABLE IF NOT EXISTS deliverable_groups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  label TEXT NOT NULL DEFAULT '',
  parent_group_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  pos_x REAL NOT NULL DEFAULT 0,
  pos_y REAL NOT NULL DEFAULT 0,
  group_id TEXT REFERENCES deliverable_groups(id),
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE TABLE IF NOT EXISTS canvas_objects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL DEFAULT 'note',
  content TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'yellow',
  tags TEXT NOT NULL DEFAULT '[]',
  pos_x REAL NOT NULL DEFAULT 0,
  pos_y REAL NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES user(id),
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE TABLE IF NOT EXISTS personal_positions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  pos_x REAL NOT NULL,
  pos_y REAL NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_personal_positions ON personal_positions(user_id, kind, subject_id);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL REFERENCES deliverables(id),
  number INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_versions_file_name ON versions(file_name);
CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL REFERENCES deliverables(id),
  version_id TEXT NOT NULL REFERENCES versions(id),
  x REAL NOT NULL,
  y REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  annotation_id TEXT NOT NULL REFERENCES annotations(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL REFERENCES deliverables(id),
  version_id TEXT NOT NULL REFERENCES versions(id),
  decision TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id),
  approver_name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  deliverable_id TEXT,
  subject_id TEXT,
  user_id TEXT NOT NULL REFERENCES user(id),
  actor_name TEXT NOT NULL,
  type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_project ON history(project_id, created_at);
CREATE TABLE IF NOT EXISTS project_shares (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_project_shares ON project_shares(project_id, user_id);
CREATE TABLE IF NOT EXISTS invitation_grants (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES invitation(id),
  project_id TEXT NOT NULL REFERENCES projects(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_invitation_grants ON invitation_grants(invitation_id, project_id);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'neutral',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_tags_org_name ON tags(organization_id, name);
CREATE TABLE IF NOT EXISTS project_tags (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  tag_id TEXT NOT NULL REFERENCES tags(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_project_tags ON project_tags(project_id, tag_id);
CREATE INDEX IF NOT EXISTS idx_project_tags_tag ON project_tags(tag_id);
CREATE TABLE IF NOT EXISTS deliverable_tags (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL REFERENCES deliverables(id),
  tag_id TEXT NOT NULL REFERENCES tags(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_deliverable_tags ON deliverable_tags(deliverable_id, tag_id);
CREATE INDEX IF NOT EXISTS idx_deliverable_tags_tag ON deliverable_tags(tag_id);
CREATE TABLE IF NOT EXISTS task_links (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  from_task_id TEXT NOT NULL REFERENCES tasks(id),
  to_task_id TEXT NOT NULL REFERENCES tasks(id),
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_task_links ON task_links(from_task_id, to_task_id, type);
CREATE INDEX IF NOT EXISTS idx_task_links_from ON task_links(from_task_id);
CREATE INDEX IF NOT EXISTS idx_task_links_to ON task_links(to_task_id);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'none',
  assignee_id TEXT REFERENCES user(id),
  due_date INTEGER,
  project_id TEXT REFERENCES projects(id),
  deliverable_id TEXT REFERENCES deliverables(id),
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_org_status ON tasks(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE TABLE IF NOT EXISTS library_folders (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  project_id TEXT REFERENCES projects(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_library_folders_project ON library_folders(project_id);
CREATE TABLE IF NOT EXISTS library_files (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES library_folders(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  version_id TEXT REFERENCES versions(id),
  uploaded_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_library_files_file_name ON library_files(file_name);
CREATE INDEX IF NOT EXISTS idx_library_files_folder ON library_files(folder_id);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_library_files_version ON library_files(version_id);
`;

async function tableExists(name: string) {
  const r = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [name],
  });
  return r.rows.length > 0;
}

async function columnsOf(table: string) {
  const t = await client.execute(`PRAGMA table_info(${table})`);
  return t.rows.map(r => r.name as string);
}

/**
 * Dev migrations for older DBs. Runs BEFORE the DDL so renames happen before
 * CREATE TABLE IF NOT EXISTS can create empty shadow tables under the new
 * names. Every step is guarded by table/column existence, so a fresh DB
 * no-ops straight through and is built entirely by the DDL.
 */
async function migrate() {
  // clients → entities rename (2026-07). If a previous boot's DDL already
  // created an empty `entities` shadow table alongside `clients`, drop it
  // so the rename can proceed.
  if (await tableExists("clients")) {
    if (await tableExists("entities")) {
      const count = await client.execute("SELECT COUNT(*) AS n FROM entities");
      if (Number(count.rows[0].n) === 0) {
        await client.execute("DROP TABLE entities");
        await client.execute("ALTER TABLE clients RENAME TO entities");
      }
    } else {
      await client.execute("ALTER TABLE clients RENAME TO entities");
    }
  }

  // soft-delete columns on older dev DBs
  for (const table of ["deliverables", "versions"]) {
    if (!(await tableExists(table))) continue;
    const tCols = await columnsOf(table);
    if (!tCols.includes("deleted_at")) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN deleted_at INTEGER`);
      await client.execute(`ALTER TABLE ${table} ADD COLUMN deleted_by TEXT`);
    }
  }

  if (await tableExists("deliverables")) {
    const cols = await columnsOf("deliverables");
    if (!cols.includes("group_id")) {
      await client.execute("ALTER TABLE deliverables ADD COLUMN group_id TEXT REFERENCES deliverable_groups(id)");
    }
  }

  if (await tableExists("deliverable_groups")) {
    const cols = await columnsOf("deliverable_groups");
    if (!cols.includes("parent_group_id")) {
      await client.execute("ALTER TABLE deliverable_groups ADD COLUMN parent_group_id TEXT");
    }
  }

  if (await tableExists("canvas_objects")) {
    const cols = await columnsOf("canvas_objects");
    if (!cols.includes("tags")) {
      await client.execute("ALTER TABLE canvas_objects ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
    }
    if (!cols.includes("created_by_name")) {
      await client.execute("ALTER TABLE canvas_objects ADD COLUMN created_by_name TEXT NOT NULL DEFAULT ''");
    }
  }

  if (await tableExists("tasks")) {
    const cols = await columnsOf("tasks");
    if (!cols.includes("priority")) {
      await client.execute("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'none'");
    }
  }

  if (await tableExists("projects")) {
    const cols = await columnsOf("projects");
    if (!cols.includes("archived_at")) {
      await client.execute("ALTER TABLE projects ADD COLUMN archived_at INTEGER");
      await client.execute("ALTER TABLE projects ADD COLUMN archived_by TEXT");
    }
    if (cols.includes("client_id") && !cols.includes("entity_id")) {
      await client.execute("ALTER TABLE projects RENAME COLUMN client_id TO entity_id");
    }
    if (!cols.includes("client_id") && !cols.includes("entity_id")) {
      await client.execute("ALTER TABLE projects ADD COLUMN entity_id TEXT REFERENCES entities(id)");
    }
    // legacy free-text projects.client_name → entities rows
    if (cols.includes("client_name")) {
      const legacy = await client.execute(
        "SELECT DISTINCT organization_id, client_name FROM projects WHERE client_name != '' AND entity_id IS NULL",
      );
      for (const row of legacy.rows) {
        const orgId = row.organization_id as string;
        const name = row.client_name as string;
        const existing = await client.execute({
          sql: "SELECT id FROM entities WHERE organization_id = ? AND name = ?",
          args: [orgId, name],
        });
        let entityId = existing.rows[0]?.id as string | undefined;
        if (!entityId) {
          entityId = randomUUID();
          await client.execute({
            sql: "INSERT INTO entities (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)",
            args: [entityId, orgId, name, Date.now()],
          });
        }
        await client.execute({
          sql: "UPDATE projects SET entity_id = ? WHERE organization_id = ? AND client_name = ? AND entity_id IS NULL",
          args: [entityId, orgId, name],
        });
      }
    }
  }
}

/**
 * Post-DDL reconciler, runs every boot (cheap at this scale). Guarantees:
 * every project has its library folder (named after the project), and every
 * non-deleted version has a mirror row in the project's folder — so any call
 * site missed by the mirroring helpers self-heals on the next boot.
 */
async function backfillLibrary() {
  const { statSync } = await import("node:fs");
  const { extname } = await import("node:path");
  const { FILE_TYPES } = await import("../lib/filetypes");

  const missingFolders = await client.execute(`
    SELECT p.id, p.organization_id, p.name FROM projects p
    LEFT JOIN library_folders f ON f.project_id = p.id
    WHERE f.id IS NULL`);
  for (const r of missingFolders.rows) {
    await client.execute({
      sql: "INSERT INTO library_folders (id, organization_id, project_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [randomUUID(), r.organization_id as string, r.id as string, r.name as string, Date.now()],
    });
  }
  // keep project-folder names in sync with project names
  await client.execute(`
    UPDATE library_folders
    SET name = (SELECT name FROM projects WHERE projects.id = library_folders.project_id)
    WHERE project_id IS NOT NULL`);

  const missingMirrors = await client.execute(`
    SELECT v.id, v.file_name, v.width, v.height, v.number, v.created_at,
           d.name AS deliverable_name, d.project_id, p.organization_id, p.created_by
    FROM versions v
    JOIN deliverables d ON d.id = v.deliverable_id
    JOIN projects p ON p.id = d.project_id
    LEFT JOIN library_files lf ON lf.version_id = v.id
    WHERE lf.id IS NULL AND v.deleted_at IS NULL AND d.deleted_at IS NULL`);
  for (const r of missingMirrors.rows) {
    const [folder] = (
      await client.execute({
        sql: "SELECT id FROM library_folders WHERE project_id = ?",
        args: [r.project_id as string],
      })
    ).rows;
    if (!folder) continue;
    const ext = extname(r.file_name as string).toLowerCase();
    let size = 0;
    try {
      size = statSync(join(UPLOADS_DIR, r.file_name as string)).size;
    } catch {
      continue; // file missing on disk — don't mirror a dead reference
    }
    await client.execute({
      sql: `INSERT INTO library_files
        (id, folder_id, organization_id, name, file_name, mime, size, width, height, version_id, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        folder.id as string,
        r.organization_id as string,
        `${r.deliverable_name} v${r.number}${ext}`,
        r.file_name as string,
        FILE_TYPES[ext]?.mime ?? "application/octet-stream",
        size,
        (r.width as number) ?? null,
        (r.height as number) ?? null,
        r.id as string,
        r.created_by as string,
        r.created_at as number,
      ],
    });
  }
}

const ready = migrate()
  .then(() => client.executeMultiple(DDL))
  .then(backfillLibrary);

export async function getDb() {
  await ready;
  return db;
}

export const db = drizzle(client, { schema });
