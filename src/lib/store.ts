import { createContext, useContext } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import * as api from "./api";
import type {
  Annotation,
  AnnotationStatus,
  Decision,
  Deliverable,
  ProjectGraph,
  Version,
} from "./types";

/**
 * Optimistic project store: every mutation updates the local store immediately
 * and syncs to the server in the background. Entity ids are generated
 * client-side so optimistic rows are the real rows.
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

  function addComment(deliverableId: string, annotationId: string, authorName: string, body: string) {
    const c = {
      id: crypto.randomUUID(),
      annotationId,
      authorName,
      body,
      createdAt: Date.now(),
    };
    mutateDeliverable(deliverableId, d => {
      const a = d.annotations.find(a => a.id === annotationId);
      a?.comments.push(c);
    });
    void api.addComment(c.id, annotationId, authorName, body);
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
    approverName: string,
    note = ""
  ): Promise<{ ok: boolean; error?: string }> {
    const id = crypto.randomUUID();
    // decision is validated server-side (open threads block approval), so this
    // one is pessimistic — but it's a rare, deliberate action.
    const res = await api.decideVersion(id, deliverableId, versionId, decision, approverName, note);
    if (res.ok) {
      mutateDeliverable(deliverableId, d => {
        d.status = decision === "approved" ? "approved" : "revisions_requested";
        d.approvals.push({
          id,
          deliverableId,
          versionId,
          decision,
          approverName,
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
    reload: load,
    addDeliverable,
    moveDeliverable,
    renameDeliverable,
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
