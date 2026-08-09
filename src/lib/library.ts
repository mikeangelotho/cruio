import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { deliverableGroups, deliverables, libraryFiles, libraryFolders, versions } from "~/db/schema";
import { fileTypeFor } from "./filetypes";
import type { getDb } from "~/db";

type Db = Awaited<ReturnType<typeof getDb>>;

// ---- folder ⟷ group sync ---------------------------------------------------
// A canvas group is mirrored by a "group folder" (libraryFolders.groupId set),
// exactly as a version is mirrored by a file. A deliverable's mirrors live in
// the folder implied by its groupId — the group folder if grouped, else the
// project root folder. These helpers keep the folder side in step with the
// canvas group ops in src/lib/api.ts.

/** The folder a deliverable's mirrors belong in: its group folder, else the
 *  project root. Null only if the project has no root folder yet (rare; the
 *  boot reconciler heals it). */
export async function folderIdForDeliverable(
  db: Db,
  deliverableId: string,
): Promise<string | null> {
  const [d] = await db
    .select({ groupId: deliverables.groupId, projectId: deliverables.projectId })
    .from(deliverables)
    .where(eq(deliverables.id, deliverableId));
  if (!d) return null;
  if (d.groupId) {
    const [gf] = await db
      .select({ id: libraryFolders.id })
      .from(libraryFolders)
      .where(eq(libraryFolders.groupId, d.groupId));
    if (gf) return gf.id;
  }
  const [root] = await db
    .select({ id: libraryFolders.id })
    .from(libraryFolders)
    .where(and(eq(libraryFolders.projectId, d.projectId), isNull(libraryFolders.groupId)));
  return root?.id ?? null;
}

/** The project's root folder id (group_id null), if it exists. */
async function rootFolderId(db: Db, projectId: string): Promise<string | null> {
  const [root] = await db
    .select({ id: libraryFolders.id })
    .from(libraryFolders)
    .where(and(eq(libraryFolders.projectId, projectId), isNull(libraryFolders.groupId)));
  return root?.id ?? null;
}

/** The parent folder a group's folder should nest under: the parent group's
 *  folder if nested, otherwise the project root folder — so the folder tree is
 *  uniform (every group folder has a parent). */
async function groupFolderParent(
  db: Db,
  projectId: string,
  parentGroupId: string | null,
): Promise<string | null> {
  if (parentGroupId) {
    const [pf] = await db
      .select({ id: libraryFolders.id })
      .from(libraryFolders)
      .where(eq(libraryFolders.groupId, parentGroupId));
    if (pf) return pf.id;
  }
  return rootFolderId(db, projectId);
}

/** Idempotently create/update the group folder that mirrors a canvas group. */
export async function ensureGroupFolder(
  db: Db,
  group: { id: string; projectId: string; organizationId: string; label: string; parentGroupId: string | null },
): Promise<void> {
  const parentFolderId = await groupFolderParent(db, group.projectId, group.parentGroupId);
  const [existing] = await db
    .select({ id: libraryFolders.id })
    .from(libraryFolders)
    .where(eq(libraryFolders.groupId, group.id));
  if (existing) {
    await db
      .update(libraryFolders)
      .set({ name: group.label || "Group", parentFolderId })
      .where(eq(libraryFolders.id, existing.id));
    return;
  }
  await db.insert(libraryFolders).values({
    id: randomUUID(),
    organizationId: group.organizationId,
    projectId: group.projectId,
    groupId: group.id,
    parentFolderId,
    name: group.label || "Group",
    createdAt: Date.now(),
  });
}

/** Keep a group folder's name in step with its group label. */
export async function renameGroupFolder(db: Db, groupId: string, label: string): Promise<void> {
  await db
    .update(libraryFolders)
    .set({ name: label || "Group" })
    .where(eq(libraryFolders.groupId, groupId));
}

/** Update a group folder's nesting to match its group's parentGroupId (parent
 *  group's folder, or the project root for a top-level group). */
export async function setGroupFolderParent(
  db: Db,
  groupId: string,
  parentGroupId: string | null,
): Promise<void> {
  const [gf] = await db
    .select({ projectId: libraryFolders.projectId })
    .from(libraryFolders)
    .where(eq(libraryFolders.groupId, groupId));
  if (!gf?.projectId) return;
  const parentFolderId = await groupFolderParent(db, gf.projectId, parentGroupId);
  await db
    .update(libraryFolders)
    .set({ parentFolderId })
    .where(eq(libraryFolders.groupId, groupId));
}

/** Delete a group's folder (after its members have been relocated). Reparents
 *  any child folders up to this folder's parent so nothing is orphaned. */
export async function deleteGroupFolder(db: Db, groupId: string): Promise<void> {
  const [gf] = await db
    .select({ id: libraryFolders.id, parentFolderId: libraryFolders.parentFolderId })
    .from(libraryFolders)
    .where(eq(libraryFolders.groupId, groupId));
  if (!gf) return;
  await db
    .update(libraryFolders)
    .set({ parentFolderId: gf.parentFolderId })
    .where(eq(libraryFolders.parentFolderId, gf.id));
  await db.delete(libraryFolders).where(eq(libraryFolders.id, gf.id));
}

/** Set the archived state on a group's mirror folder AND the group row together
 *  — cascading to every descendant group so a nested child folder is never left
 *  orphaned from a hidden parent. Keeps the Library's active view and the canvas
 *  data model in agreement about whether a group is archived. */
export async function setGroupArchived(
  db: Db,
  groupId: string,
  archivedAt: number | null,
  archivedBy: string | null,
): Promise<void> {
  const [g] = await db
    .select({ projectId: deliverableGroups.projectId })
    .from(deliverableGroups)
    .where(eq(deliverableGroups.id, groupId));
  if (!g) return;
  const all = await db
    .select({ id: deliverableGroups.id, parentGroupId: deliverableGroups.parentGroupId })
    .from(deliverableGroups)
    .where(eq(deliverableGroups.projectId, g.projectId));
  const ids = new Set<string>([groupId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of all) {
      if (r.parentGroupId && ids.has(r.parentGroupId) && !ids.has(r.id)) {
        ids.add(r.id);
        grew = true;
      }
    }
  }
  const list = [...ids];
  await db
    .update(libraryFolders)
    .set({ archivedAt, archivedBy })
    .where(inArray(libraryFolders.groupId, list));
  await db
    .update(deliverableGroups)
    .set({ archivedAt, archivedBy })
    .where(inArray(deliverableGroups.id, list));
}

/** Move all of a deliverable's mirror files into the folder its current groupId
 *  implies (group folder or project root). No-op if the target can't resolve. */
export async function relocateDeliverableMirrors(db: Db, deliverableId: string): Promise<void> {
  const folderId = await folderIdForDeliverable(db, deliverableId);
  if (!folderId) return;
  const vIds = db
    .select({ id: versions.id })
    .from(versions)
    .where(eq(versions.deliverableId, deliverableId));
  await db.update(libraryFiles).set({ folderId }).where(inArray(libraryFiles.versionId, vIds));
}

// Mirroring keeps the project's library folder in step with deliverable
// versions. Reference rows only — mirrors share the version's fileName on
// disk. Call sites: api/upload.ts (create), api.ts deleteVersion /
// restoreVersion (soft-delete state). The boot reconciler in db/index.ts
// self-heals anything missed.

/** Create the auto library folder for a new project. */
export async function createProjectFolder(
  db: Db,
  project: { id: string; organizationId: string; name: string },
): Promise<void> {
  await db.insert(libraryFolders).values({
    id: randomUUID(),
    organizationId: project.organizationId,
    projectId: project.id,
    name: project.name,
    createdAt: Date.now(),
  });
}

/** Mirror a freshly uploaded version into its deliverable's library folder
 *  (the group folder if the deliverable is grouped, else the project root). */
export async function mirrorVersion(
  db: Db,
  version: {
    id: string;
    fileName: string;
    width: number;
    height: number;
    number: number;
    size: number;
  },
  project: { id: string; organizationId: string },
  deliverableName: string,
  uploadedBy: string,
  deliverableId: string,
): Promise<void> {
  const folderId = await folderIdForDeliverable(db, deliverableId);
  if (!folderId) return; // reconciler will pick it up on next boot
  const ext = extname(version.fileName).toLowerCase();
  await db.insert(libraryFiles).values({
    id: randomUUID(),
    folderId,
    organizationId: project.organizationId,
    name: `${deliverableName} v${version.number}${ext}`,
    fileName: version.fileName,
    mime: fileTypeFor(ext)?.mime ?? "application/octet-stream",
    size: version.size,
    width: version.width,
    height: version.height,
    versionId: version.id,
    uploadedBy,
    createdAt: Date.now(),
  });
}

/** Keep a mirror row's soft-delete state in step with its version. */
export async function setMirrorDeleted(
  db: Db,
  versionId: string,
  deletedAt: number | null,
  deletedBy: string | null,
): Promise<void> {
  await db
    .update(libraryFiles)
    .set({ deletedAt, deletedBy })
    .where(eq(libraryFiles.versionId, versionId));
}

/**
 * Sync mirrors when a whole deliverable is soft-deleted/restored. Only touches
 * mirrors of versions that aren't individually deleted, so restoring a
 * deliverable doesn't resurrect a version the user deleted on its own.
 */
export async function setDeliverableMirrorsDeleted(
  db: Db,
  deliverableId: string,
  deletedAt: number | null,
  deletedBy: string | null,
): Promise<void> {
  const liveVersionIds = db
    .select({ id: versions.id })
    .from(versions)
    .where(and(eq(versions.deliverableId, deliverableId), isNull(versions.deletedAt)));
  await db
    .update(libraryFiles)
    .set({ deletedAt, deletedBy })
    .where(inArray(libraryFiles.versionId, liveVersionIds));
}
