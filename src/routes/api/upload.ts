import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { imageSize } from "image-size";
import { and, eq, ne, max } from "drizzle-orm";
import { getDb, UPLOADS_DIR } from "../../db";
import { deliverables, projects, versions } from "../../db/schema";
import { getSession, recordHistory, requireProjectAccess } from "../../lib/guard";
import { mirrorVersion } from "../../lib/library";

const ALLOWED = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"]);

/**
 * POST /api/upload — multipart form: { deliverableId, file }
 * Every upload creates the next version automatically (no manual version tracking).
 */
export async function POST(event: { request: Request }) {
  const session = await getSession(event.request.headers);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const form = await event.request.formData();
  const deliverableId = form.get("deliverableId");
  const file = form.get("file");

  if (typeof deliverableId !== "string" || !(file instanceof File)) {
    return Response.json({ error: "deliverableId and file are required" }, { status: 400 });
  }

  const ext = extname(file.name).toLowerCase() || ".png";
  if (!ALLOWED.has(ext)) {
    return Response.json({ error: `Unsupported file type ${ext}` }, { status: 400 });
  }

  const db = await getDb();
  const [deliverable] = await db.select().from(deliverables).where(eq(deliverables.id, deliverableId));
  if (!deliverable || deliverable.deletedAt) {
    return Response.json({ error: "Deliverable not found" }, { status: 404 });
  }

  let access: Awaited<ReturnType<typeof requireProjectAccess>>;
  try {
    access = await requireProjectAccess(
      deliverable.projectId,
      { resource: "version", action: "upload" },
      event.request.headers,
    );
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let width = 0;
  let height = 0;
  try {
    const dim = imageSize(buffer);
    width = dim.width ?? 0;
    height = dim.height ?? 0;
  } catch {
    return Response.json({ error: "Could not read image dimensions" }, { status: 400 });
  }

  const id = randomUUID();
  const fileName = `${id}${ext}`;
  await writeFile(join(UPLOADS_DIR, fileName), buffer);

  const [prev] = await db
    .select({ n: max(versions.number) })
    .from(versions)
    .where(eq(versions.deliverableId, deliverableId));
  const number = (prev?.n ?? 0) + 1;

  const row = { id, deliverableId, number, fileName, width, height, createdAt: Date.now() };
  await db.insert(versions).values(row);
  await mirrorVersion(
    db,
    { id, fileName, width, height, number, size: buffer.length },
    { id: deliverable.projectId, organizationId: access.project.organizationId },
    deliverable.name,
    access.session.userId,
  );

  // A new version puts the deliverable (back) into review.
  await db.update(deliverables).set({ status: "in_review" }).where(eq(deliverables.id, deliverableId));
  await recordHistory(db, {
    projectId: deliverable.projectId,
    deliverableId,
    subjectId: id,
    userId: access.session.userId,
    actorName: access.session.name,
    type: "version_uploaded",
    detail: `uploaded v${number} of “${deliverable.name}”`,
  });
  // First upload moves the project out of pre-production.
  await db
    .update(projects)
    .set({ phase: "iterations" })
    .where(and(eq(projects.id, deliverable.projectId), eq(projects.phase, "pre_production")));

  return Response.json(row);
}
