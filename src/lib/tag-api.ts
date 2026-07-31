import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { deliverableTags, projectTags, tags } from "../db/schema";
import {
  authorize,
  requireMember,
  requireProjectAccess,
  requireSession,
  resolveDeliverableProject,
} from "./guard";
import type { Tag, TagColor } from "./types";
import { Id, TagColorSchema, TagName, parseOrThrow } from "./validate";

// Shared org-level tags applied to projects and deliverables. Tag management
// (create/rename/recolor/delete) is `tag:manage` (member+). Applying tags rides
// on the target's own update permission: project tags = admin+ (project:update),
// deliverable tags = member+ (deliverable:update).

async function requireOrg() {
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) throw new Error("No active organization");
  const { role } = await requireMember(orgId);
  return { session, orgId, role };
}

/** All tags of the active org (any member may list — needed for the pickers). */
export async function listTags(): Promise<Tag[]> {
  "use server";
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return [];
  await requireMember(orgId);
  const db = await getDb();
  const rows = await db
    .select()
    .from(tags)
    .where(eq(tags.organizationId, orgId))
    .orderBy(asc(tags.name));
  return rows.map(r => ({ id: r.id, name: r.name, color: r.color as TagColor }));
}

export async function createTag(name: string, color: string): Promise<Tag> {
  "use server";
  const checkedName = parseOrThrow(TagName, name);
  const checkedColor = parseOrThrow(TagColorSchema, color);
  const { orgId, role } = await requireOrg();
  authorize(role, "tag", "manage");
  const db = await getDb();
  // reuse an existing same-name tag instead of duplicating (unique per org)
  const [existing] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.organizationId, orgId), eq(tags.name, checkedName)));
  if (existing) return { id: existing.id, name: existing.name, color: existing.color as TagColor };
  const row = {
    id: crypto.randomUUID(),
    organizationId: orgId,
    name: checkedName,
    color: checkedColor,
    createdAt: Date.now(),
  };
  await db.insert(tags).values(row);
  return { id: row.id, name: row.name, color: row.color as TagColor };
}

export async function renameTag(id: string, name: string): Promise<void> {
  "use server";
  const tagId = parseOrThrow(Id, id);
  const checkedName = parseOrThrow(TagName, name);
  const { orgId, role } = await requireOrg();
  authorize(role, "tag", "manage");
  const db = await getDb();
  await db
    .update(tags)
    .set({ name: checkedName })
    .where(and(eq(tags.id, tagId), eq(tags.organizationId, orgId)));
}

export async function setTagColor(id: string, color: string): Promise<void> {
  "use server";
  const tagId = parseOrThrow(Id, id);
  const checkedColor = parseOrThrow(TagColorSchema, color);
  const { orgId, role } = await requireOrg();
  authorize(role, "tag", "manage");
  const db = await getDb();
  await db
    .update(tags)
    .set({ color: checkedColor })
    .where(and(eq(tags.id, tagId), eq(tags.organizationId, orgId)));
}

/** Delete a tag and detach it from every project/deliverable. */
export async function deleteTag(id: string): Promise<void> {
  "use server";
  const tagId = parseOrThrow(Id, id);
  const { orgId, role } = await requireOrg();
  authorize(role, "tag", "manage");
  const db = await getDb();
  const [t] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.organizationId, orgId)));
  if (!t) throw new Error("Not found");
  await db.delete(projectTags).where(eq(projectTags.tagId, tagId));
  await db.delete(deliverableTags).where(eq(deliverableTags.tagId, tagId));
  await db.delete(tags).where(eq(tags.id, tagId));
}

/** Narrow a set of tag ids to those that exist in `orgId`. */
async function validOrgTagIds(
  db: Awaited<ReturnType<typeof getDb>>,
  orgId: string,
  tagIds: string[],
): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.organizationId, orgId), inArray(tags.id, tagIds)));
  return rows.map(r => r.id);
}

/** Replace a project's whole tag set (admin+). */
export async function setProjectTags(projectId: string, tagIds: string[]): Promise<void> {
  "use server";
  const pid = parseOrThrow(Id, projectId);
  const ids = tagIds.map(t => parseOrThrow(Id, t));
  const { project } = await requireProjectAccess(pid, { resource: "project", action: "update" });
  const db = await getDb();
  const valid = await validOrgTagIds(db, project.organizationId, ids);
  await db.delete(projectTags).where(eq(projectTags.projectId, pid));
  if (valid.length) {
    await db
      .insert(projectTags)
      .values(valid.map(tagId => ({ id: crypto.randomUUID(), projectId: pid, tagId })));
  }
}

/** Replace a deliverable's whole tag set (member+). */
export async function setDeliverableTags(deliverableId: string, tagIds: string[]): Promise<void> {
  "use server";
  const did = parseOrThrow(Id, deliverableId);
  const ids = tagIds.map(t => parseOrThrow(Id, t));
  const projectId = await resolveDeliverableProject(did);
  const { project } = await requireProjectAccess(projectId, {
    resource: "deliverable",
    action: "update",
  });
  const db = await getDb();
  const valid = await validOrgTagIds(db, project.organizationId, ids);
  await db.delete(deliverableTags).where(eq(deliverableTags.deliverableId, did));
  if (valid.length) {
    await db
      .insert(deliverableTags)
      .values(valid.map(tagId => ({ id: crypto.randomUUID(), deliverableId: did, tagId })));
  }
}
