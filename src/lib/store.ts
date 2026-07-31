import { batch, createContext, useContext } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import * as api from "./api";
import * as tagApi from "./tag-api";
import { can as roleCan, type Resource } from "./permissions";
import { newId } from "./id";
import type {
  Annotation,
  AnnotationStatus,
  CanvasObject,
  Decision,
  Deliverable,
  NoteColor,
  ProjectGraph,
  Tag,
  Version,
  Viewer,
} from "./types";

/**
 * Optimistic project store: every mutation updates the local store immediately
 * and syncs to the server in the background. Entity ids are generated
 * client-side so optimistic rows are the real rows. Attribution comes from
 * graph.viewer (the session user), never from client input.
 */
export function createProjectStore(projectId: string) {
  const [state, setState] = createStore<{
    loaded: boolean;
    error: string;
    graph: ProjectGraph | null;
  }>({ loaded: false, error: "", graph: null });

  async function load() {
    try {
      const graph = await api.getProjectGraph(projectId);
      if (!graph) {
        setState({ loaded: true, error: "Project not found", graph: null });
        return;
      }
      setState("loaded", true);
      setState("error", "");
      if (state.graph) setState("graph", reconcile(graph));
      else setState("graph", graph);
    } catch (e) {
      setState({ loaded: true, error: String(e) });
    }
  }
  load();

  const deliverables = () => state.graph?.deliverables ?? [];
  const byId = (id: string) => deliverables().find(d => d.id === id);
  const groups = () => state.graph?.groups ?? [];
  const groupById = (id: string) => groups().find(g => g.id === id);

  /** Walk parentGroupId links up to the top-level group containing `groupId`. */
  function rootGroupOf(groupId: string): string {
    let cur = groupId;
    for (let i = 0; i < 32; i++) {
      const parent = groupById(cur)?.parentGroupId;
      if (!parent || !groupById(parent)) return cur;
      cur = parent;
    }
    return cur;
  }

  /** Deliverable ids in `groupId` and every descendant group. */
  function membersOfGroup(groupId: string): string[] {
    const groupIds = new Set([groupId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const g of groups()) {
        if (g.parentGroupId && groupIds.has(g.parentGroupId) && !groupIds.has(g.id)) {
          groupIds.add(g.id);
          grew = true;
        }
      }
    }
    return deliverables().filter(d => d.groupId && groupIds.has(d.groupId)).map(d => d.id);
  }

  const viewer = (): Viewer | undefined => state.graph?.viewer;

  /** UI gating only — the server enforces the same matrix on every call. */
  const can = (resource: Resource, action: string) =>
    roleCan(viewer()?.role, resource, action);

  function mutateDeliverable(id: string, fn: (d: Deliverable) => void) {
    setState(
      "graph",
      "deliverables",
      d => d.id === id,
      produce(fn)
    );
  }

  function addDeliverable(name: string, posX: number, posY: number): Deliverable {
    const d: Deliverable = {
      id: newId(),
      projectId,
      name,
      spec: "",
      status: "draft",
      posX,
      posY,
      groupId: null,
      createdAt: Date.now(),
      tags: [],
      versions: [],
      annotations: [],
      approvals: [],
    };
    setState("graph", "deliverables", produce(list => list.push(d)));
    void api.createDeliverable(d.id, projectId, name, posX, posY);
    return d;
  }

  /** Replace a deliverable's tag set (optimistic; server reconciles on reload). */
  function setDeliverableTags(id: string, tagList: Tag[]) {
    mutateDeliverable(id, d => {
      d.tags = tagList;
    });
    void tagApi.setDeliverableTags(id, tagList.map(t => t.id));
  }

  function moveDeliverable(id: string, posX: number, posY: number, sync = true) {
    mutateDeliverable(id, d => {
      d.posX = posX;
      d.posY = posY;
    });
    if (sync) void api.moveDeliverable(id, posX, posY);
  }

  /** Move every deliverable sharing a groupId by the same delta (drag-together). */
  function moveGroup(ids: string[], dx: number, dy: number, sync = true) {
    batch(() => {
      for (const id of ids) {
        const d = byId(id);
        if (d) moveDeliverable(id, d.posX + dx, d.posY + dy, sync);
      }
    });
  }

  function renameDeliverable(id: string, name: string) {
    mutateDeliverable(id, d => {
      d.name = name;
    });
    void api.renameDeliverable(id, name);
  }

  /** Group deliverables as size/format variants under one label. */
  async function groupSelected(ids: string[], label: string) {
    const groupId = await api.groupDeliverables(ids, label);
    batch(() => {
      setState("graph", "groups", produce(list => list.push({ id: groupId, label, parentGroupId: null })));
      for (const id of ids) {
        mutateDeliverable(id, d => {
          d.groupId = groupId;
          d.groupLabel = label;
        });
      }
    });
  }

  /** Nest whole groups under a new labeled parent group. */
  async function nestGroups(childGroupIds: string[], label: string) {
    const parentId = await api.groupGroups(childGroupIds, label);
    batch(() => {
      setState("graph", "groups", produce(list => list.push({ id: parentId, label, parentGroupId: null })));
      setState(
        "graph",
        "groups",
        g => childGroupIds.includes(g.id),
        produce(g => { g.parentGroupId = parentId; }),
      );
    });
  }

  /** Dissolve one group level (leaf releases cards, parent releases child groups). */
  function dissolveGroup(groupId: string) {
    batch(() => {
      setState(
        "graph",
        "deliverables",
        d => d.groupId === groupId,
        produce(d => {
          d.groupId = null;
          d.groupLabel = null;
        }),
      );
      setState(
        "graph",
        "groups",
        g => g.parentGroupId === groupId,
        produce(g => { g.parentGroupId = null; }),
      );
      setState("graph", "groups", produce(list => {
        const i = list.findIndex(g => g.id === groupId);
        if (i >= 0) list.splice(i, 1);
      }));
    });
    void api.dissolveGroup(groupId);
  }

  function renameGroup(groupId: string, label: string) {
    batch(() => {
      setState(
        "graph",
        "groups",
        g => g.id === groupId,
        produce(g => { g.label = label; }),
      );
      // denormalized on direct members only — a parent group's rename has no
      // direct members (deliverables only ever point at a leaf group)
      setState(
        "graph",
        "deliverables",
        d => d.groupId === groupId,
        produce(d => { d.groupLabel = label; }),
      );
    });
    void api.renameGroup(groupId, label);
  }

  function ungroup(id: string) {
    mutateDeliverable(id, d => {
      d.groupId = null;
      d.groupLabel = null;
    });
    void api.ungroupDeliverable(id);
  }

  /** Add one ungrouped deliverable directly to an existing group. */
  function addToGroup(deliverableId: string, groupId: string) {
    const label = groupById(groupId)?.label ?? null;
    mutateDeliverable(deliverableId, d => {
      d.groupId = groupId;
      d.groupLabel = label;
    });
    void api.addDeliverableToGroup(deliverableId, groupId);
  }

  // ---- canvas objects (sticky notes) --------------------------------------

  const canvasObjects = () => state.graph?.canvasObjects ?? [];

  function mutateCanvasObject(id: string, fn: (o: CanvasObject) => void) {
    setState("graph", "canvasObjects", o => o.id === id, produce(fn));
  }

  function addNote(posX: number, posY: number): CanvasObject {
    const o: CanvasObject = {
      id: newId(),
      projectId,
      kind: "note",
      content: "",
      color: "yellow",
      tags: [],
      posX,
      posY,
      createdBy: viewer()?.userId ?? "",
      createdByName: viewer()?.name ?? null,
      createdAt: Date.now(),
    };
    setState("graph", "canvasObjects", produce(list => list.push(o)));
    void api.createCanvasObject(o.id, projectId, posX, posY);
    return o;
  }

  function updateNote(id: string, patch: { content?: string; color?: NoteColor; tags?: string[] }) {
    mutateCanvasObject(id, o => {
      if (patch.content !== undefined) o.content = patch.content;
      if (patch.color !== undefined) o.color = patch.color;
      if (patch.tags !== undefined) o.tags = patch.tags;
    });
    void api.updateCanvasObject(id, patch);
  }

  function moveNote(id: string, posX: number, posY: number, sync = true) {
    mutateCanvasObject(id, o => {
      o.posX = posX;
      o.posY = posY;
    });
    if (sync) void api.moveCanvasObject(id, posX, posY);
  }

  function removeNote(id: string) {
    setState("graph", "canvasObjects", produce(list => {
      const i = list.findIndex(o => o.id === id);
      if (i >= 0) list.splice(i, 1);
    }));
    void api.deleteCanvasObject(id);
  }

  // ---- personal (per-viewer) canvas layout --------------------------------
  // "Sync" positions are the deliverable/note posX/posY above — shared, last
  // writer wins. This is the parallel per-user override layer.

  const personalPositions = () => state.graph?.personalPositions ?? [];
  function personalPosOf(kind: "deliverable" | "note", subjectId: string): { x: number; y: number } | null {
    const p = personalPositions().find(p => p.kind === kind && p.subjectId === subjectId);
    return p ? { x: p.posX, y: p.posY } : null;
  }
  function setPersonalPosition(kind: "deliverable" | "note", subjectId: string, posX: number, posY: number, sync = true) {
    setState("graph", "personalPositions", produce(list => {
      const existing = list.find(p => p.kind === kind && p.subjectId === subjectId);
      if (existing) {
        existing.posX = posX;
        existing.posY = posY;
      } else {
        list.push({ kind, subjectId, posX, posY });
      }
    }));
    if (sync) void api.setPersonalPosition(kind, subjectId, posX, posY);
  }

  /** Soft-delete a deliverable (restorable from the History panel). */
  function removeDeliverable(id: string) {
    setState(
      "graph",
      "deliverables",
      produce(list => {
        const i = list.findIndex(d => d.id === id);
        if (i >= 0) list.splice(i, 1);
      }),
    );
    void api.deleteDeliverable(id);
  }

  /** Soft-delete a version and mirror the server's status recompute locally. */
  function removeVersion(deliverableId: string, versionId: string) {
    mutateDeliverable(deliverableId, d => {
      d.versions = d.versions.filter(v => v.id !== versionId);
      d.annotations = d.annotations.filter(a => a.versionId !== versionId);
      const last = d.versions[d.versions.length - 1];
      if (!last) {
        d.status = "draft";
      } else {
        const aps = d.approvals.filter(ap => ap.versionId === last.id);
        const lastAp = aps[aps.length - 1];
        d.status = lastAp
          ? lastAp.decision === "approved"
            ? "approved"
            : "revisions_requested"
          : "in_review";
      }
    });
    void api.deleteVersion(versionId);
  }

  /** Register a version returned by POST /api/upload. */
  function addVersion(version: Version) {
    mutateDeliverable(version.deliverableId, d => {
      if (d.versions.some(v => v.id === version.id)) return;
      d.versions.push(version);
      d.status = "in_review";
    });
    if (state.graph && state.graph.project.phase === "pre_production") {
      setState("graph", "project", "phase", "iterations");
    }
  }

  function addAnnotation(deliverableId: string, versionId: string, x: number, y: number): Annotation {
    const a: Annotation = {
      id: newId(),
      deliverableId,
      versionId,
      x,
      y,
      status: "open",
      createdBy: viewer()?.userId ?? "",
      createdAt: Date.now(),
      comments: [],
    };
    mutateDeliverable(deliverableId, d => d.annotations.push(a));
    void api.createAnnotation(a.id, deliverableId, versionId, x, y);
    return a;
  }

  function removeAnnotation(deliverableId: string, annotationId: string) {
    mutateDeliverable(deliverableId, d => {
      d.annotations = d.annotations.filter(a => a.id !== annotationId);
    });
    void api.deleteAnnotation(annotationId);
  }

  function addComment(deliverableId: string, annotationId: string, body: string) {
    const v = viewer();
    const c = {
      id: newId(),
      annotationId,
      userId: v?.userId ?? "",
      authorName: v?.name ?? "",
      body,
      createdAt: Date.now(),
    };
    mutateDeliverable(deliverableId, d => {
      const a = d.annotations.find(a => a.id === annotationId);
      a?.comments.push(c);
    });
    void api.addComment(c.id, annotationId, body);
  }

  function resolveAnnotation(deliverableId: string, annotationId: string, status: AnnotationStatus) {
    mutateDeliverable(deliverableId, d => {
      const a = d.annotations.find(a => a.id === annotationId);
      if (a) a.status = status;
    });
    void api.resolveAnnotation(annotationId, status);
  }

  async function decide(
    deliverableId: string,
    versionId: string,
    decision: Decision,
    note = ""
  ): Promise<{ ok: boolean; error?: string }> {
    const id = newId();
    // decision is validated server-side (open threads block approval), so this
    // one is pessimistic — but it's a rare, deliberate action.
    const res = await api.decideVersion(id, deliverableId, versionId, decision, note);
    if (res.ok) {
      const v = viewer();
      mutateDeliverable(deliverableId, d => {
        d.status = decision === "approved" ? "approved" : "revisions_requested";
        d.approvals.push({
          id,
          deliverableId,
          versionId,
          decision,
          userId: v?.userId ?? "",
          approverName: v?.name ?? "",
          note,
          createdAt: Date.now(),
        });
      });
    }
    return res;
  }

  return {
    state,
    projectId,
    deliverables,
    byId,
    viewer,
    can,
    reload: load,
    addDeliverable,
    moveDeliverable,
    moveGroup,
    renameDeliverable,
    setDeliverableTags,
    groups,
    groupById,
    rootGroupOf,
    membersOfGroup,
    groupSelected,
    nestGroups,
    dissolveGroup,
    renameGroup,
    ungroup,
    addToGroup,
    canvasObjects,
    addNote,
    updateNote,
    moveNote,
    removeNote,
    personalPositions,
    personalPosOf,
    setPersonalPosition,
    removeDeliverable,
    removeVersion,
    addVersion,
    addAnnotation,
    removeAnnotation,
    addComment,
    resolveAnnotation,
    decide,
  };
}

export type ProjectStore = ReturnType<typeof createProjectStore>;

export const ProjectContext = createContext<ProjectStore>();

export function useProject(): ProjectStore {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject outside ProjectContext");
  return ctx;
}

export async function uploadVersion(deliverableId: string, file: File): Promise<Version> {
  const form = new FormData();
  form.set("deliverableId", deliverableId);
  form.set("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? "Upload failed");
  }
  return res.json();
}
