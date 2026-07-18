import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema";

export const DATA_DIR = join(process.cwd(), "data");
export const UPLOADS_DIR = join(DATA_DIR, "uploads");

mkdirSync(UPLOADS_DIR, { recursive: true });

const client = createClient({
  url: "file:" + join(DATA_DIR, "cruio.db").replace(/\\/g, "/"),
});

const DDL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT 'pre_production',
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
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL REFERENCES deliverables(id),
  number INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL REFERENCES deliverables(id),
  version_id TEXT NOT NULL REFERENCES versions(id),
  x REAL NOT NULL,
  y REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  annotation_id TEXT NOT NULL REFERENCES annotations(id),
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL REFERENCES deliverables(id),
  version_id TEXT NOT NULL REFERENCES versions(id),
  decision TEXT NOT NULL,
  approver_name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`;

const ready = client.executeMultiple(DDL);

export async function getDb() {
  await ready;
  return db;
}

export const db = drizzle(client, { schema });
