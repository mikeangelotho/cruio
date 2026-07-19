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
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id),
  phase TEXT NOT NULL DEFAULT 'pre_production',
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  archived_by TEXT
);
CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  pos_x REAL NOT NULL DEFAULT 0,
  pos_y REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT
);
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
`;

/**
 * One-off dev migration: older DBs have projects.client_name (free text) and
 * no client_id. Add the column and backfill org-level client rows from the
 * distinct legacy names. New DBs skip both branches.
 */
async function migrate() {
  // soft-delete columns on older dev DBs
  for (const table of ["deliverables", "versions"]) {
    const t = await client.execute(`PRAGMA table_info(${table})`);
    const tCols = t.rows.map(r => r.name as string);
    if (!tCols.includes("deleted_at")) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN deleted_at INTEGER`);
      await client.execute(`ALTER TABLE ${table} ADD COLUMN deleted_by TEXT`);
    }
  }
  const info = await client.execute("PRAGMA table_info(projects)");
  const cols = info.rows.map(r => r.name as string);
  if (!cols.includes("archived_at")) {
    await client.execute("ALTER TABLE projects ADD COLUMN archived_at INTEGER");
    await client.execute("ALTER TABLE projects ADD COLUMN archived_by TEXT");
  }
  if (!cols.includes("client_id")) {
    await client.execute("ALTER TABLE projects ADD COLUMN client_id TEXT REFERENCES clients(id)");
  }
  if (cols.includes("client_name")) {
    const legacy = await client.execute(
      "SELECT DISTINCT organization_id, client_name FROM projects WHERE client_name != '' AND client_id IS NULL",
    );
    for (const row of legacy.rows) {
      const orgId = row.organization_id as string;
      const name = row.client_name as string;
      const existing = await client.execute({
        sql: "SELECT id FROM clients WHERE organization_id = ? AND name = ?",
        args: [orgId, name],
      });
      let clientId = existing.rows[0]?.id as string | undefined;
      if (!clientId) {
        clientId = randomUUID();
        await client.execute({
          sql: "INSERT INTO clients (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)",
          args: [clientId, orgId, name, Date.now()],
        });
      }
      await client.execute({
        sql: "UPDATE projects SET client_id = ? WHERE organization_id = ? AND client_name = ? AND client_id IS NULL",
        args: [clientId, orgId, name],
      });
    }
  }
}

const ready = client.executeMultiple(DDL).then(migrate);

export async function getDb() {
  await ready;
  return db;
}

export const db = drizzle(client, { schema });
