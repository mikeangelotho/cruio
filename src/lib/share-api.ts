import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { deliverables, projects, shareLinks, versions } from "../db/schema";
import { Id, parseOrThrow } from "./validate";
import { requireProjectAccess, resolveDeliverableProject } from "./guard";

export type ShareSubjectType = "deliverable" | "project";

export interface ShareLinkRow {
  id: string;
  token: string;
  subjectType: ShareSubjectType;
  subjectId: string;
  createdAt: number;
  revokedAt: number | null;
  expiresAt: number | null;
}

/** Read-only projection of a shared deliverable for the public viewer. */
export interface SharedDeliverableView {
  name: string;
  status: string;
  versions: { number: number; fileName: string; width: number; height: number }[];
}

/** 64 hex chars from two UUIDs — Web Crypto so it works server- and client-side. */
function newToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

async function projectOfSubject(subjectType: ShareSubjectType, subjectId: string): Promise<string> {
  return subjectType === "deliverable" ? resolveDeliverableProject(subjectId) : subjectId;
}

/**
 * Create a public read-only share link for a deliverable (or project canvas).
 * Gated on project:share — the same permission as inviting a guest. Returns the
 * token; the app builds the `/s/<token>` URL for copying.
 */
export async function createShareLink(
  subjectType: ShareSubjectType,
  subjectId: string,
): Promise<{ id: string; token: string }> {
  "use server";
  if (subjectType !== "deliverable" && subjectType !== "project") throw new Error("Bad subject");
  subjectId = parseOrThrow(Id, subjectId);
  const projectId = await projectOfSubject(subjectType, subjectId);
  const { session, project } = await requireProjectAccess(projectId, {
    resource: "project",
    action: "share",
  });
  const db = await getDb();
  const id = crypto.randomUUID();
  const token = newToken();
  await db.insert(shareLinks).values({
    id,
    token,
    subjectType,
    subjectId,
    organizationId: project.organizationId,
    createdBy: session.userId,
    createdAt: Date.now(),
    revokedAt: null,
    expiresAt: null,
  });
  return { id, token };
}

/** Revoke a share link (project:share). */
export async function revokeShareLink(id: string): Promise<void> {
  "use server";
  id = parseOrThrow(Id, id);
  const db = await getDb();
  const [link] = await db.select().from(shareLinks).where(eq(shareLinks.id, id));
  if (!link) return;
  const projectId = await projectOfSubject(link.subjectType as ShareSubjectType, link.subjectId);
  await requireProjectAccess(projectId, { resource: "project", action: "share" });
  await db.update(shareLinks).set({ revokedAt: Date.now() }).where(eq(shareLinks.id, id));
}

/** List the active (non-revoked) share links for a subject (project:share). */
export async function listShareLinks(
  subjectType: ShareSubjectType,
  subjectId: string,
): Promise<ShareLinkRow[]> {
  "use server";
  subjectId = parseOrThrow(Id, subjectId);
  const projectId = await projectOfSubject(subjectType, subjectId);
  await requireProjectAccess(projectId, { resource: "project", action: "share" });
  const db = await getDb();
  const rows = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.subjectType, subjectType), eq(shareLinks.subjectId, subjectId)))
    .orderBy(desc(shareLinks.createdAt));
  return rows
    .filter(r => !r.revokedAt)
    .map(r => ({
      id: r.id,
      token: r.token,
      subjectType: r.subjectType as ShareSubjectType,
      subjectId: r.subjectId,
      createdAt: r.createdAt,
      revokedAt: r.revokedAt ?? null,
      expiresAt: r.expiresAt ?? null,
    }));
}

/**
 * PUBLIC — resolve a share token to a read-only deliverable view. No session.
 * Returns null for any invalid/revoked/expired token or deleted subject, so the
 * viewer can't distinguish "bad token" from "revoked" (no enumeration signal).
 */
export async function getSharedDeliverable(token: string): Promise<SharedDeliverableView | null> {
  "use server";
  if (typeof token !== "string" || token.length < 16 || token.length > 128) return null;
  const db = await getDb();
  const [link] = await db.select().from(shareLinks).where(eq(shareLinks.token, token));
  if (!link || link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt < Date.now()) return null;
  if (link.subjectType !== "deliverable") return null;
  const [d] = await db.select().from(deliverables).where(eq(deliverables.id, link.subjectId));
  if (!d || d.deletedAt) return null;
  const vs = await db
    .select()
    .from(versions)
    .where(and(eq(versions.deliverableId, d.id), isNull(versions.deletedAt)))
    .orderBy(desc(versions.number));
  return {
    name: d.name,
    status: d.status,
    versions: vs.map(v => ({ number: v.number, fileName: v.fileName, width: v.width, height: v.height })),
  };
}
