import { and, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import { getDb } from "../db";
import {
  deliverables,
  deliverableTags,
  entities,
  libraryFiles,
  libraryFolders,
  projects,
  projectShares,
  projectTags,
  tags,
  tasks,
  user,
  versions,
} from "../db/schema";
import { requireMember, requireSession } from "./guard";
import { parseSearchQuery, type SearchKind } from "./search-query";
import { SearchQuery, parseOrThrow } from "./validate";

export interface SearchResultItem {
  kind: SearchKind;
  id: string;
  title: string;
  /** breadcrumb shown under the title — parent entity/project context */
  subtitle: string | null;
  entityId?: string | null;
  entityName?: string | null;
  projectId?: string | null;
  deliverableId?: string | null;
  folderId?: string | null;
  fileName?: string | null;
  isMirror?: boolean;
}

const LIMIT = 6;

function rank(term: string, name: string): number {
  const t = term.toLowerCase();
  const n = name.toLowerCase();
  if (n === t) return 0;
  if (n.startsWith(t)) return 1;
  return 2;
}

/** Sort by textual relevance to `term`, then recency; trim to LIMIT. */
function rankAndTrim<T>(
  rows: T[],
  term: string,
  getName: (r: T) => string,
  getCreatedAt: (r: T) => number,
): T[] {
  return rows
    .slice()
    .sort((a, b) => rank(term, getName(a)) - rank(term, getName(b)) || getCreatedAt(b) - getCreatedAt(a))
    .slice(0, LIMIT);
}

/**
 * Cross-entity keyword search: entities, projects, deliverables, tasks, and
 * library media in one call. Supports X-style `key:value` tokens (see
 * search-query.ts) for scoping — `entity:`/`in:`, `project:`, `type:`,
 * `status:`, `assignee:`, `is:mine`. Every category respects the same
 * authorization boundaries as its dedicated list function (guest project
 * shares, org membership) — this is a read path, not a bypass.
 */
export async function globalSearch(rawQuery: string): Promise<SearchResultItem[]> {
  "use server";
  const q = parseOrThrow(SearchQuery, rawQuery);
  const parsed = parseSearchQuery(q);
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return [];
  const { role } = await requireMember(orgId);
  const db = await getDb();

  const text = parsed.text;
  const hasFilter = !!(text || parsed.entity || parsed.project || parsed.status || parsed.assignee || parsed.tag || parsed.mine);
  if (!hasFilter) return [];

  const wantKind = (k: SearchKind) => !parsed.type || parsed.type === k;
  const results: SearchResultItem[] = [];

  // ---- resolve tag: filter to tagged project/deliverable id sets --------
  let taggedProjectIds: string[] | null = null;
  let taggedDeliverableIds: string[] | null = null;
  if (parsed.tag) {
    const tagRows = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.organizationId, orgId), like(tags.name, `%${parsed.tag}%`)));
    const tagIds = tagRows.map(r => r.id);
    if (tagIds.length === 0) return results; // named tag doesn't exist
    const pt = await db
      .select({ projectId: projectTags.projectId })
      .from(projectTags)
      .where(inArray(projectTags.tagId, tagIds));
    const dt = await db
      .select({ deliverableId: deliverableTags.deliverableId })
      .from(deliverableTags)
      .where(inArray(deliverableTags.tagId, tagIds));
    taggedProjectIds = [...new Set(pt.map(r => r.projectId))];
    taggedDeliverableIds = [...new Set(dt.map(r => r.deliverableId))];
  }

  // ---- entities -------------------------------------------------------
  if (wantKind("entity")) {
    const term = text || parsed.entity;
    if (term) {
      const rows = await db
        .select()
        .from(entities)
        .where(and(eq(entities.organizationId, orgId), like(entities.name, `%${term}%`)))
        .orderBy(desc(entities.createdAt))
        .limit(LIMIT * 3);
      for (const r of rankAndTrim(rows, term, r => r.name, r => r.createdAt)) {
        results.push({ kind: "entity", id: r.id, title: r.name, subtitle: null, entityId: r.id, entityName: r.name });
      }
    }
  }

  // ---- resolve entity:/in: name filter to ids --------------------------
  let entityIds: string[] | null = null;
  if (parsed.entity) {
    const rows = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.organizationId, orgId), like(entities.name, `%${parsed.entity}%`)));
    entityIds = rows.map(r => r.id);
    if (entityIds.length === 0) return results; // named entity doesn't exist
  }

  // ---- guest project scope ---------------------------------------------
  let accessible: string[] | null = null; // null = unrestricted (non-guest)
  if (role === "guest") {
    const rows = await db
      .select({ projectId: projectShares.projectId })
      .from(projectShares)
      .innerJoin(projects, eq(projects.id, projectShares.projectId))
      .where(and(eq(projects.organizationId, orgId), eq(projectShares.userId, session.userId)));
    accessible = rows.map(r => r.projectId);
    if (accessible.length === 0) return results; // nothing shared with this guest
  }

  // ---- resolve project: name filter to ids ------------------------------
  let projectIds: string[] | null = null;
  if (parsed.project) {
    const conds = [
      eq(projects.organizationId, orgId),
      isNull(projects.archivedAt),
      like(projects.name, `%${parsed.project}%`),
    ];
    if (accessible) conds.push(inArray(projects.id, accessible));
    if (entityIds) conds.push(inArray(projects.entityId, entityIds));
    const rows = await db.select({ id: projects.id }).from(projects).where(and(...conds));
    projectIds = rows.map(r => r.id);
    if (projectIds.length === 0) return results; // named project doesn't exist in scope
  }

  // ---- projects ----------------------------------------------------------
  if (
    wantKind("project") &&
    (text || parsed.project || parsed.tag) &&
    (!parsed.tag || (taggedProjectIds !== null && taggedProjectIds.length > 0))
  ) {
    const term = text || parsed.project || "";
    {
      const conds = [eq(projects.organizationId, orgId), isNull(projects.archivedAt)];
      if (term) conds.push(like(projects.name, `%${term}%`));
      if (accessible) conds.push(inArray(projects.id, accessible));
      if (entityIds) conds.push(inArray(projects.entityId, entityIds));
      if (projectIds) conds.push(inArray(projects.id, projectIds));
      if (taggedProjectIds) conds.push(inArray(projects.id, taggedProjectIds));
      const rows = await db
        .select({ p: projects, entityName: entities.name })
        .from(projects)
        .leftJoin(entities, eq(entities.id, projects.entityId))
        .where(and(...conds))
        .orderBy(desc(projects.createdAt))
        .limit(LIMIT * 3);
      for (const r of rankAndTrim(rows, term, r => r.p.name, r => r.p.createdAt)) {
        results.push({
          kind: "project",
          id: r.p.id,
          title: r.p.name,
          subtitle: r.entityName ?? null,
          projectId: r.p.id,
          entityId: r.p.entityId,
          entityName: r.entityName ?? null,
        });
      }
    }
  }

  // ---- deliverables --------------------------------------------------------
  if (
    wantKind("deliverable") &&
    (text || parsed.tag) &&
    (!parsed.tag || (taggedDeliverableIds !== null && taggedDeliverableIds.length > 0))
  ) {
    const pConds = [eq(projects.organizationId, orgId), isNull(projects.archivedAt)];
    if (accessible) pConds.push(inArray(projects.id, accessible));
    if (entityIds) pConds.push(inArray(projects.entityId, entityIds));
    if (projectIds) pConds.push(inArray(projects.id, projectIds));
    const conds = [isNull(deliverables.deletedAt)];
    if (text) conds.push(like(deliverables.name, `%${text}%`));
    if (taggedDeliverableIds) conds.push(inArray(deliverables.id, taggedDeliverableIds));
    if (parsed.status) conds.push(eq(deliverables.status, parsed.status));
    const rows = await db
      .select({ d: deliverables, projectName: projects.name, projectId: projects.id, entityId: projects.entityId })
      .from(deliverables)
      .innerJoin(projects, eq(projects.id, deliverables.projectId))
      .where(and(...conds, ...pConds))
      .orderBy(desc(deliverables.createdAt))
      .limit(LIMIT * 3);
    for (const r of rankAndTrim(rows, text, r => r.d.name, r => r.d.createdAt)) {
      results.push({
        kind: "deliverable",
        id: r.d.id,
        title: r.d.name,
        subtitle: r.projectName,
        projectId: r.projectId,
        deliverableId: r.d.id,
        entityId: r.entityId,
      });
    }
  }

  // ---- tasks (never for guests) --------------------------------------------
  if (wantKind("task") && role !== "guest") {
    const wantsTasks = text || parsed.status || parsed.assignee || parsed.mine;
    if (wantsTasks) {
      const conds = [eq(tasks.organizationId, orgId), isNull(tasks.deletedAt)];
      if (text) conds.push(or(like(tasks.title, `%${text}%`), like(tasks.description, `%${text}%`))!);
      if (parsed.status) conds.push(eq(tasks.status, parsed.status));
      if (parsed.mine || parsed.assignee?.toLowerCase() === "me") conds.push(eq(tasks.assigneeId, session.userId));
      if (projectIds) conds.push(inArray(tasks.projectId, projectIds));

      let rows = await db
        .select({
          t: tasks,
          projectName: projects.name,
          entityId: projects.entityId,
          assigneeName: user.name,
        })
        .from(tasks)
        .leftJoin(projects, eq(projects.id, tasks.projectId))
        .leftJoin(user, eq(user.id, tasks.assigneeId))
        .where(and(...conds))
        .orderBy(desc(tasks.createdAt))
        .limit(LIMIT * 4);

      // entity/guest scoping requires a project — tasks without one only
      // ever show under "All Entities" (same convention as the Tasks page).
      if (entityIds) rows = rows.filter(r => r.entityId && entityIds!.includes(r.entityId));
      if (accessible) rows = rows.filter(r => r.t.projectId && accessible!.includes(r.t.projectId));
      if (parsed.assignee && parsed.assignee.toLowerCase() !== "me") {
        const needle = parsed.assignee.toLowerCase();
        rows = rows.filter(r => r.assigneeName?.toLowerCase().includes(needle));
      }

      const ranked = text ? rankAndTrim(rows, text, r => r.t.title, r => r.t.createdAt) : rows.slice(0, LIMIT);
      for (const r of ranked) {
        results.push({
          kind: "task",
          id: r.t.id,
          title: r.t.title,
          subtitle: r.projectName ?? "No project",
          projectId: r.t.projectId,
          deliverableId: r.t.deliverableId,
          entityId: r.entityId ?? null,
        });
      }
    }
  }

  // ---- media (library files) ------------------------------------------------
  if (wantKind("media") && text) {
    const rows = await db
      .select({
        f: libraryFiles,
        folderProjectId: libraryFolders.projectId,
        folderName: libraryFolders.name,
        projectEntityId: projects.entityId,
        deliverableId: versions.deliverableId,
      })
      .from(libraryFiles)
      .innerJoin(libraryFolders, eq(libraryFolders.id, libraryFiles.folderId))
      .leftJoin(projects, eq(projects.id, libraryFolders.projectId))
      .leftJoin(versions, eq(versions.id, libraryFiles.versionId))
      .where(and(eq(libraryFiles.organizationId, orgId), isNull(libraryFiles.deletedAt), like(libraryFiles.name, `%${text}%`)))
      .orderBy(desc(libraryFiles.createdAt))
      .limit(LIMIT * 4);

    let filtered = rows;
    // guests never reach workspace-level folders, only shared project folders
    filtered = accessible
      ? filtered.filter(r => r.folderProjectId && accessible!.includes(r.folderProjectId))
      : filtered;
    if (entityIds) filtered = filtered.filter(r => r.projectEntityId && entityIds!.includes(r.projectEntityId));
    if (projectIds) filtered = filtered.filter(r => r.folderProjectId && projectIds!.includes(r.folderProjectId));

    for (const r of rankAndTrim(filtered, text, r => r.f.name, r => r.f.createdAt)) {
      results.push({
        kind: "media",
        id: r.f.id,
        title: r.f.name,
        subtitle: r.folderProjectId ? r.folderName : "Library",
        projectId: r.folderProjectId,
        deliverableId: r.deliverableId ?? null,
        folderId: r.f.folderId,
        fileName: r.f.fileName,
        entityId: r.projectEntityId ?? null,
        isMirror: !!r.f.versionId,
      });
    }
  }

  return results;
}
