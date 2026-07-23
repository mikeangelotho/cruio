import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db";
import {
  entities,
  libraryFiles,
  libraryFolders,
  projects,
  projectShares,
  versions,
} from "../db/schema";
import {
  authorize,
  requireFolderAccess,
  requireMember,
  requireSession,
} from "./guard";
import type { LibraryFile, LibraryFolder } from "./types";
import { Id, ShortText, parseOrThrow } from "./validate";

// Library domain. Folders are workspace-level (user-managed) or per-project
// (auto-created; deleted only with the project). Mirror rows (versionId set)
// are managed by the canvas upload/delete flow, never edited here.

export interface LibraryListing {
  folders: LibraryFolder[];
  files: LibraryFile[];
  role: string;
}

/**
 * Everything the viewer may see, in one query round. `entityId` narrows
 * project folders to that entity's projects (validated against the org);
 * workspace folders are org-level and always included for non-guests.
 */
export async function listLibrary(entityId: string | null): Promise<LibraryListing> {
  "use server";
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return { folders: [], files: [], role: "member" };
  const { role } = await requireMember(orgId);
  authorize(role, "library", "read");
  const db = await getDb();

  const rows = await db
    .select({
      f: libraryFolders,
      entityId: projects.entityId,
      entityName: entities.name,
      archivedAt: projects.archivedAt,
    })
    .from(libraryFolders)
    .leftJoin(projects, eq(projects.id, libraryFolders.projectId))
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .where(eq(libraryFolders.organizationId, orgId))
    .orderBy(asc(libraryFolders.name));

  let folders = rows
    .filter(r => !r.f.projectId || r.archivedAt == null)
    .map(r => ({
      id: r.f.id,
      projectId: r.f.projectId,
      name: r.f.name,
      createdAt: r.f.createdAt,
      entityId: r.entityId ?? null,
      entityName: r.entityName ?? null,
    }));

  if (role === "guest") {
    const shares = await db
      .select({ projectId: projectShares.projectId })
      .from(projectShares)
      .where(eq(projectShares.userId, session.userId));
    const shared = new Set(shares.map(s => s.projectId));
    folders = folders.filter(f => f.projectId && shared.has(f.projectId));
  }

  if (entityId) {
    const checked = parseOrThrow(Id, entityId);
    folders = folders.filter(f => !f.projectId || f.entityId === checked);
  }

  const folderIds = folders.map(f => f.id);
  const fileRows = folderIds.length
    ? await db
        .select({ file: libraryFiles, deliverableId: versions.deliverableId })
        .from(libraryFiles)
        .leftJoin(versions, eq(versions.id, libraryFiles.versionId))
        .where(
          and(inArray(libraryFiles.folderId, folderIds), isNull(libraryFiles.deletedAt)),
        )
        .orderBy(asc(libraryFiles.createdAt))
    : [];

  return {
    folders,
    files: fileRows.map(r => ({
      id: r.file.id,
      folderId: r.file.folderId,
      name: r.file.name,
      fileName: r.file.fileName,
      mime: r.file.mime,
      size: r.file.size,
      width: r.file.width,
      height: r.file.height,
      versionId: r.file.versionId,
      deliverableId: r.deliverableId ?? null,
      uploadedBy: r.file.uploadedBy,
      createdAt: r.file.createdAt,
    })),
    role,
  };
}

/** Create a workspace-level folder. */
export async function createFolder(name: string): Promise<LibraryFolder> {
  "use server";
  const trimmed = parseOrThrow(ShortText, name);
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const { role } = await requireMember(orgId);
  authorize(role, "library", "manage");
  const db = await getDb();
  const row = {
    id: randomUUID(),
    organizationId: orgId,
    projectId: null,
    name: trimmed,
    createdAt: Date.now(),
  };
  await db.insert(libraryFolders).values(row);
  return {
    id: row.id,
    projectId: null,
    name: row.name,
    createdAt: row.createdAt,
    entityId: null,
    entityName: null,
  };
}

/** Rename a workspace folder (project folders follow their project's name). */
export async function renameFolder(id: string, name: string): Promise<void> {
  "use server";
  const folderId = parseOrThrow(Id, id);
  const trimmed = parseOrThrow(ShortText, name);
  const { folder } = await requireFolderAccess(folderId, "manage");
  if (folder.projectId) throw new Error("Project folders are named after their project");
  const db = await getDb();
  await db.update(libraryFolders).set({ name: trimmed }).where(eq(libraryFolders.id, folderId));
}

/**
 * Delete an empty workspace folder. Project folders are deleted only with
 * their project; non-empty folders must be emptied first (no silent loss).
 */
export async function deleteFolder(id: string): Promise<void> {
  "use server";
  const folderId = parseOrThrow(Id, id);
  const { folder } = await requireFolderAccess(folderId, "manage");
  if (folder.projectId) throw new Error("Project folders are deleted with their project");
  const db = await getDb();
  const [live] = await db
    .select({ id: libraryFiles.id })
    .from(libraryFiles)
    .where(and(eq(libraryFiles.folderId, folderId), isNull(libraryFiles.deletedAt)))
    .limit(1);
  if (live) throw new Error("Move or delete the files in this folder first");
  await db.delete(libraryFiles).where(eq(libraryFiles.folderId, folderId));
  await db.delete(libraryFolders).where(eq(libraryFolders.id, folderId));
}

async function requireEditableFile(id: string) {
  const db = await getDb();
  const [file] = await db.select().from(libraryFiles).where(eq(libraryFiles.id, id));
  if (!file || file.deletedAt) throw new Error("Not found");
  const access = await requireFolderAccess(file.folderId, "upload");
  if (file.versionId) throw new Error("Deliverable files are managed from the canvas");
  return { db, file, access };
}

export async function renameFile(id: string, name: string): Promise<void> {
  "use server";
  const fileId = parseOrThrow(Id, id);
  const trimmed = parseOrThrow(ShortText, name);
  const { db } = await requireEditableFile(fileId);
  await db.update(libraryFiles).set({ name: trimmed }).where(eq(libraryFiles.id, fileId));
}

export async function moveFile(id: string, folderId: string): Promise<void> {
  "use server";
  const fileId = parseOrThrow(Id, id);
  const targetId = parseOrThrow(Id, folderId);
  const { db, file } = await requireEditableFile(fileId);
  const { folder: target } = await requireFolderAccess(targetId, "upload");
  if (target.organizationId !== file.organizationId) throw new Error("Forbidden");
  await db.update(libraryFiles).set({ folderId: targetId }).where(eq(libraryFiles.id, fileId));
}

export async function deleteFile(id: string): Promise<void> {
  "use server";
  const fileId = parseOrThrow(Id, id);
  const { db, access } = await requireEditableFile(fileId);
  await db
    .update(libraryFiles)
    .set({ deletedAt: Date.now(), deletedBy: access.session.userId })
    .where(eq(libraryFiles.id, fileId));
}

export async function restoreFile(id: string): Promise<void> {
  "use server";
  const fileId = parseOrThrow(Id, id);
  const db = await getDb();
  const [file] = await db.select().from(libraryFiles).where(eq(libraryFiles.id, fileId));
  if (!file || !file.deletedAt || file.versionId) throw new Error("Not found");
  await requireFolderAccess(file.folderId, "upload");
  await db
    .update(libraryFiles)
    .set({ deletedAt: null, deletedBy: null })
    .where(eq(libraryFiles.id, fileId));
}
