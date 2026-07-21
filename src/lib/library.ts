import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { libraryFiles, libraryFolders, versions } from "~/db/schema";
import { fileTypeFor } from "./filetypes";
import type { getDb } from "~/db";

type Db = Awaited<ReturnType<typeof getDb>>;

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

/** Mirror a freshly uploaded version into its project's library folder. */
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
): Promise<void> {
  const [folder] = await db
    .select({ id: libraryFolders.id })
    .from(libraryFolders)
    .where(eq(libraryFolders.projectId, project.id));
  if (!folder) return; // reconciler will pick it up on next boot
  const ext = extname(version.fileName).toLowerCase();
  await db.insert(libraryFiles).values({
    id: randomUUID(),
    folderId: folder.id,
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
