import { createContext, useContext } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import * as api from "./api";
import { can as roleCan, type Resource } from "./permissions";
import type {
  Annotation,
  AnnotationStatus,
  Decision,
  Deliverable,
  ProjectGraph,
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
      id: crypto.randomUUID(),
      projectId,
      name,
      spec: "",
      status: "draft",
      posX,
      posY,
      createdAt: Date.now(),
      versions: [],
      annotations: [],
      approvals: [],
    };
    setState("graph", "deliverables", produce(list => list.push(d)));
    void api.createDeliverable(d.id, projectId, name, posX, posY);
    return d;
  }

  function moveDeliverable(id: string, posX: number, posY: number, sync = true) {
    mutateDeliverable(id, d => {
      d.posX = posX;
      d.posY = posY;
    });
    if (sync) void api.moveDeliverable(id, posX, posY);
  }

  function renameDeliverable(id: string, name: string) {
    mutateDeliverable(id, d => {
      d.name = name;
    });
    void api.renameDeliverable(id, name);
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
      id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
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
    const id = crypto.randomUUID();
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
    renameDeliverable,
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
