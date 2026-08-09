import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db";
import {
  deliverables,
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
  requireProjectAccess,
  requireSession,
} from "./guard";
import { addDeliverableToGroup, groupDeliverables, ungroupDeliverable } from "./api";
import { setGroupArchived } from "./library";
import { newId } from "./id";
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
export async function listLibrary(
  entityId: string | null,
  scope: "active" | "archived" = "active",
): Promise<LibraryListing> {
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
    .filter(r => {
      // Project folders vanish when their PROJECT is archived (either scope).
      if (r.f.projectId && r.archivedAt != null) return false;
      // Then split by the folder's OWN archive state: the active view hides
      // archived folders; the archived view shows only them.
      const folderArchived = r.f.archivedAt != null;
      return scope === "archived" ? folderArchived : !folderArchived;
    })
    .map(r => ({
      id: r.f.id,
      projectId: r.f.projectId,
      groupId: r.f.groupId ?? null,
      parentFolderId: r.f.parentFolderId ?? null,
      name: r.f.name,
      createdAt: r.f.createdAt,
      entityId: r.entityId ?? null,
      entityName: r.entityName ?? null,
      archivedAt: r.f.archivedAt ?? null,
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

/**
 * Files in a single project's library folder — its uploads and the version
 * mirrors from its deliverables. Powers the canvas Library side panel. Guests
 * only see it when the project is shared with them.
 */
export async function listProjectFiles(projectId: string): Promise<LibraryFile[]> {
  "use server";
  const checkedProject = parseOrThrow(Id, projectId);
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return [];
  const { role } = await requireMember(orgId);
  authorize(role, "library", "read");
  const db = await getDb();

  if (role === "guest") {
    const shares = await db
      .select({ projectId: projectShares.projectId })
      .from(projectShares)
      .where(
        and(
          eq(projectShares.userId, session.userId),
          eq(projectShares.projectId, checkedProject),
        ),
      );
    if (shares.length === 0) return [];
  }

  const folders = await db
    .select({ id: libraryFolders.id })
    .from(libraryFolders)
    .where(
      and(
        eq(libraryFolders.organizationId, orgId),
        eq(libraryFolders.projectId, checkedProject),
      ),
    );
  const folderIds = folders.map(f => f.id);
  if (!folderIds.length) return [];

  const fileRows = await db
    .select({ file: libraryFiles, deliverableId: versions.deliverableId })
    .from(libraryFiles)
    .leftJoin(versions, eq(versions.id, libraryFiles.versionId))
    .where(and(inArray(libraryFiles.folderId, folderIds), isNull(libraryFiles.deletedAt)))
    .orderBy(asc(libraryFiles.createdAt));

  return fileRows.map(r => ({
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
  }));
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
    groupId: null,
    parentFolderId: null,
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

/**
 * Archive a folder — hides it and its files from the Library's active view while
 * leaving everything intact and restorable. Works on workspace folders and on
 * group folders (which archive their canvas group in lockstep). Project root
 * folders can't be archived on their own — they follow the project's archive.
 */
export async function archiveFolder(id: string): Promise<void> {
  "use server";
  const folderId = parseOrThrow(Id, id);
  const { folder, session } = await requireFolderAccess(folderId, "manage");
  if (folder.projectId && !folder.groupId) {
    throw new Error("Project folders follow their project's archive");
  }
  const db = await getDb();
  if (folder.groupId) {
    await setGroupArchived(db, folder.groupId, Date.now(), session.userId);
  } else {
    await db
      .update(libraryFolders)
      .set({ archivedAt: Date.now(), archivedBy: session.userId })
      .where(eq(libraryFolders.id, folderId));
  }
}

/** Restore an archived folder (workspace or group folder) to the active view. */
export async function restoreFolder(id: string): Promise<void> {
  "use server";
  const folderId = parseOrThrow(Id, id);
  const { folder } = await requireFolderAccess(folderId, "manage");
  const db = await getDb();
  if (folder.groupId) {
    await setGroupArchived(db, folder.groupId, null, null);
  } else {
    await db
      .update(libraryFolders)
      .set({ archivedAt: null, archivedBy: null })
      .where(eq(libraryFolders.id, folderId));
  }
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

/**
 * Move deliverables between a project's folders from the library side — the
 * bidirectional half of folder ⟺ canvas group. Dropping deliverable cards into
 * a group folder groups them on the canvas; into the project root ungroups them.
 * Mirror files never move by raw folderId; they follow their deliverable's group
 * (relocateDeliverableMirrors), so this delegates to the canvas group ops.
 */
export async function regroupDeliverables(
  deliverableIds: string[],
  targetFolderId: string,
): Promise<void> {
  "use server";
  const ids = deliverableIds.map(i => parseOrThrow(Id, i));
  const folderId = parseOrThrow(Id, targetFolderId);
  if (!ids.length) return;
  const db = await getDb();
  const [target] = await db.select().from(libraryFolders).where(eq(libraryFolders.id, folderId));
  if (!target) throw new Error("Folder not found");
  if (!target.projectId) {
    throw new Error("Deliverables can only be organized within their project's folders");
  }
  const dels = await db
    .select({ id: deliverables.id, projectId: deliverables.projectId })
    .from(deliverables)
    .where(inArray(deliverables.id, ids));
  if (dels.length !== ids.length) throw new Error("Unknown deliverable");
  if (dels.some(d => d.projectId !== target.projectId)) {
    throw new Error("Deliverables must belong to the folder's project");
  }
  await requireProjectAccess(target.projectId, { resource: "deliverable", action: "update" });
  for (const id of ids) {
    if (target.groupId) await addDeliverableToGroup(id, target.groupId);
    else await ungroupDeliverable(id);
  }
}

/**
 * "New folder from a pure-deliverable selection" — creates a canvas group (and,
 * via the sync helpers, its group folder). All deliverables must be in one
 * project. For mixed/asset selections the caller uses createFolder instead.
 */
export async function createGroupFromDeliverables(
  deliverableIds: string[],
  label: string,
): Promise<{ groupId: string }> {
  "use server";
  const ids = deliverableIds.map(i => parseOrThrow(Id, i));
  const trimmed = parseOrThrow(ShortText, label);
  if (ids.length < 1) throw new Error("Select at least one deliverable");
  const db = await getDb();
  const dels = await db
    .select({ projectId: deliverables.projectId })
    .from(deliverables)
    .where(inArray(deliverables.id, ids));
  if (dels.length !== ids.length) throw new Error("Unknown deliverable");
  const projectId = dels[0].projectId;
  if (dels.some(d => d.projectId !== projectId)) {
    throw new Error("Deliverables in a canvas group must belong to one project");
  }
  const groupId = newId();
  await groupDeliverables(groupId, ids, trimmed);
  return { groupId };
}
