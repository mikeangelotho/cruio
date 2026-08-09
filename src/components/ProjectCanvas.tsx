import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";
import { useNavigate, useParams, A, createAsync } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { createCamera } from "../lib/canvas/camera";
import { DotGrid } from "../lib/canvas/DotGrid";
import {
  CARD_HEADER_H,
  CARD_W,
  boundsOf,
  findFreeSpot,
  planeRect,
  rectsOverlap,
  snapToGrid,
  snapToNeighbors,
  thumbHeight,
  type SnapGuide,
} from "../lib/canvas/geometry";
import { useProject, uploadVersion } from "../lib/store";
import { downloadFile, downloadZip } from "../lib/download";
import { fileUrl } from "../lib/types";
import type { Tag, TagColor } from "../lib/types";
import { createTag, listTags } from "../lib/tag-api";
import { createTask, listProjectTasks, updateTask } from "../lib/task-api";
import { statusLocalPatch } from "../lib/task-status";
import { setViewContext } from "../lib/ai/viewContext";
import { myOrgsQuery, requireUserQuery } from "../lib/org-api";
import { listProjectFiles } from "../lib/library-api";
import { deliverableStage } from "../lib/stage";
import { newId } from "../lib/id";
import type { Rect } from "../lib/canvas/camera";
import type {
  Annotation,
  CanvasObject,
  Decision,
  Deliverable,
  NoteColor,
  Task,
  TaskStatus,
  Version,
} from "../lib/types";
import { ContextMenu, type MenuEntry, type MenuState } from "./ContextMenu";
import { DeliverableCard, STATUS_META } from "./DeliverableCard";
import { NOTE_COLORS, NOTE_W, StickyNote } from "./StickyNote";
import { HistoryPanel } from "./HistoryPanel";
import { NotesPanel } from "./NotesPanel";
import { NavMenu } from "./NavMenu";
import { ProjectInfoModal } from "./ProjectInfoModal";
import { ReviewPlane } from "./ReviewPlane";
import { ThreadSidebar } from "./ThreadSidebar";
import { DeliverableTasksPanel } from "./DeliverableTasksPanel";
import { LibraryPanel } from "./LibraryPanel";
import { MetadataPanel } from "./MetadataPanel";
import { Callout } from "./Callout";
import { AppFooter } from "./AppFooter";
import { CommandPalette } from "./CommandPalette";
import { GlobalSearch } from "./GlobalSearch";
import { createUndoStack } from "../lib/undo";
import { pushToast, setToastRaised } from "../lib/toast";
import { confirm, promptText } from "../lib/confirm";
import { createShareLink } from "../lib/share-api";
import { AiTrigger } from "./ai/AiTrigger";

export function ProjectCanvas() {
  const store = useProject();
  const params = useParams();
  const navigate = useNavigate();
  const camera = createCamera();

  // shared org tags for the deliverable tag editor (in the info modal)
  const [orgTags, { refetch: refetchTags }] = createResource(
    () => store.state.graph?.project.organizationId ?? null,
    () => listTags(),
  );
  async function makeTag(name: string, color: TagColor): Promise<Tag> {
    const t = await createTag(name, color);
    await refetchTags();
    return t;
  }

  // Project tasks power both the on-canvas Tasks panel and the derived
  // per-deliverable stage. Optimistic local copy: mutations apply immediately,
  // then hit the server; errors refetch to reconverge (same as the store).
  const [serverTasks, { refetch: refetchTasks }] = createResource(
    () => (store.can("task", "update") ? store.projectId : null),
    () => listProjectTasks(store.projectId),
  );
  const [tasks, setTasks] = createSignal<Task[]>([]);
  createEffect(() => {
    const rows = serverTasks();
    if (rows) setTasks(rows);
  });
  const tasksFor = (deliverableId: string) =>
    tasks().filter((t) => t.deliverableId === deliverableId);
  const stageOf = (d: Deliverable) => deliverableStage(d, tasksFor(d.id));

  function failTasks(err: unknown) {
    setStatusMsg(String(err instanceof Error ? err.message : err));
    void refetchTasks();
  }
  // deliverableId null → a project-level task (e.g. a project with no
  // deliverables yet), otherwise scoped to that deliverable.
  function addDeliverableTask(deliverableId: string | null, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    const id = newId();
    const v = store.viewer();
    const optimistic: Task = {
      id,
      organizationId: store.state.graph?.project.organizationId ?? "",
      title: trimmed,
      description: "",
      status: "todo",
      priority: "none",
      assigneeId: null,
      assigneeName: null,
      dueDate: null,
      projectId: store.projectId,
      projectName: store.state.graph?.project.name ?? null,
      entityId: store.state.graph?.project.entityId ?? null,
      deliverableId,
      annotationId: null,
      createdBy: v?.userId ?? "",
      createdAt: Date.now(),
      completedAt: null,
    };
    setTasks((list) => [optimistic, ...list]);
    createTask(id, trimmed, {
      projectId: store.projectId,
      deliverableId,
    }).catch(failTasks);
  }
  // The task panel shows the current deliverable's tasks in review mode, or all
  // project tasks when there's no deliverable in view (project scope).
  const panelTasks = () => {
    const d = current();
    return d ? tasksFor(d.id) : tasks();
  };
  const addPanelTask = (title: string) =>
    addDeliverableTask(current()?.id ?? null, title);
  function setDeliverableTaskStatus(task: Task, status: TaskStatus) {
    const local = statusLocalPatch(status);
    setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, ...local } : t)));
    updateTask(task.id, { status }).catch(failTasks);
  }

  let container!: HTMLDivElement;
  let fileInput!: HTMLInputElement;

  const [selectedAnnId, setSelectedAnnId] = createSignal<string | null>(null);
  const [versionOverride, setVersionOverride] = createSignal<string | null>(
    null,
  );
  const [compare, setCompare] = createSignal(false);
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [notesOpen, setNotesOpen] = createSignal(false);
  const [tasksOpen, setTasksOpen] = createSignal(false);
  const [libraryOpen, setLibraryOpen] = createSignal(false);
  const [metadataOpen, setMetadataOpen] = createSignal(false);
  const [infoOpen, setInfoOpen] = createSignal(false);
  // When a status-bar count label is clicked, the info modal opens focused on
  // that filtered list of deliverables. Cleared whenever the modal closes, so
  // opening it any other way (info button, ⌘I) shows the normal summary.
  const [listFocus, setListFocus] =
    createSignal<{ label: string; items: Deliverable[] } | null>(null);
  createEffect(() => {
    if (!infoOpen()) setListFocus(null);
  });
  function openDeliverableList(label: string, items: Deliverable[]) {
    setListFocus({ label, items });
    setInfoOpen(true);
  }
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  // The right sidebar hosts one panel at a time (history / notes / tasks /
  // library / the review thread list). Toggling one closes the rest.
  type RightPanel = "history" | "notes" | "tasks" | "library" | "metadata";
  function openPanel(which: RightPanel) {
    const isOpen = {
      history: historyOpen(),
      notes: notesOpen(),
      tasks: tasksOpen(),
      library: libraryOpen(),
      metadata: metadataOpen(),
    }[which];
    batch(() => {
      setHistoryOpen(false);
      setNotesOpen(false);
      setTasksOpen(false);
      setLibraryOpen(false);
      setMetadataOpen(false);
      if (!isOpen) {
        ({
          history: setHistoryOpen,
          notes: setNotesOpen,
          tasks: setTasksOpen,
          library: setLibraryOpen,
          metadata: setMetadataOpen,
        })[which](true);
      }
    });
  }
  // This project's library assets — fetched lazily, only while the panel is open;
  // toggling it closed→open re-fetches so freshly uploaded mirrors show up.
  const [projectFiles] = createResource(
    () => (libraryOpen() ? store.projectId : null),
    () => listProjectFiles(store.projectId),
  );
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [panning, setPanning] = createSignal(false);
  // True during an active pan/zoom gesture and for a short beat after. Drives
  // compositor promotion of the world layer (will-change) and suppresses card
  // hover while content is sliding — see the world overlay style below.
  const [interacting, setInteracting] = createSignal(false);
  let interactTimer: ReturnType<typeof setTimeout> | undefined;
  function markInteracting() {
    setInteracting(true);
    if (interactTimer) clearTimeout(interactTimer);
    interactTimer = setTimeout(() => setInteracting(false), 200);
  }
  onCleanup(() => {
    if (interactTimer) clearTimeout(interactTimer);
  });
  const [statusMsg, setStatusMsg] = createSignal("");
  const [pendingDecision, setPendingDecision] = createSignal<Decision | null>(
    null,
  );
  const [ctxMenu, setCtxMenu] = createSignal<MenuState | null>(null);
  const [navRenaming, setNavRenaming] = createSignal(false);
  const [projRenaming, setProjRenaming] = createSignal(false);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  // held-spacebar pan, Figma-style: overrides marquee-select while down
  const [spaceHeld, setSpaceHeld] = createSignal(false);

  // sticky-note tool: armed by the toolbar button or `s`; the next canvas
  // click places a note there and opens it for editing.
  const [noteTool, setNoteTool] = createSignal(false);
  const [newNoteId, setNewNoteId] = createSignal<string | null>(null);

  // snap preferences — objects on / grid off by default; persisted per browser.
  // localStorage only inside onMount: Node 25 exposes a broken server-side
  // localStorage global, so touching it during SSR crashes.
  const [snapObjects, setSnapObjects] = createSignal(true);
  const [snapGrid, setSnapGrid] = createSignal(false);
  const [snapGuides, setSnapGuides] = createSignal<SnapGuide[]>([]);
  onMount(() => {
    try {
      const o = localStorage.getItem("cruio_snap_objects");
      const g = localStorage.getItem("cruio_snap_grid");
      if (o !== null) setSnapObjects(o === "1");
      if (g !== null) setSnapGrid(g === "1");
    } catch {}
  });
  function toggleSnapObjects() {
    const v = !snapObjects();
    setSnapObjects(v);
    try {
      localStorage.setItem("cruio_snap_objects", v ? "1" : "0");
    } catch {}
  }
  function toggleSnapGrid() {
    const v = !snapGrid();
    setSnapGrid(v);
    try {
      localStorage.setItem("cruio_snap_grid", v ? "1" : "0");
    } catch {}
  }

  // sync vs. personal layout: "sync" is the shared posX/posY every viewer
  // sees (whoever last moved it wins); "personal" is a per-user override
  // layer, remembered separately and toggleable without touching sync.
  const [layoutMode, setLayoutMode] = createSignal<"sync" | "personal">("sync");
  onMount(() => {
    try {
      const saved = localStorage.getItem(
        `cruio_layout_mode_${store.projectId}`,
      );
      if (saved === "sync" || saved === "personal") setLayoutMode(saved);
    } catch {}
  });
  function toggleLayoutMode() {
    const v = layoutMode() === "sync" ? "personal" : "sync";
    setLayoutMode(v);
    try {
      localStorage.setItem(`cruio_layout_mode_${store.projectId}`, v);
    } catch {}
  }

  /** Resolves a subject's on-screen position for the active layout mode,
   * falling back to the shared position when no personal override exists yet. */
  function posOf(
    kind: "deliverable" | "note",
    subjectId: string,
    sharedX: number,
    sharedY: number,
  ): { x: number; y: number } {
    if (layoutMode() === "personal") {
      const p = store.personalPosOf(kind, subjectId);
      if (p) return p;
    }
    return { x: sharedX, y: sharedY };
  }
  function effCardRect(d: Deliverable): Rect {
    const p = posOf("deliverable", d.id, d.posX, d.posY);
    return { x: p.x, y: p.y, w: CARD_W, h: thumbHeight(d) + CARD_HEADER_H };
  }
  function effNoteRect(o: CanvasObject): Rect {
    const p = posOf("note", o.id, o.posX, o.posY);
    return { x: p.x, y: p.y, w: NOTE_W, h: 80 };
  }
  /** Writes a deliverable's position to whichever layer is active. */
  function commitDeliverablePosition(
    id: string,
    x: number,
    y: number,
    sync: boolean,
  ) {
    if (layoutMode() === "personal")
      store.setPersonalPosition("deliverable", id, x, y, sync);
    else store.moveDeliverable(id, x, y, sync);
  }
  /** Applies the same delta to every id's *current effective* position — the
   * group-drag equivalent of commitDeliverablePosition. */
  function commitGroupPositions(
    ids: string[],
    dx: number,
    dy: number,
    sync: boolean,
  ) {
    for (const id of ids) {
      const d = store.byId(id);
      if (!d) continue;
      const cur = posOf("deliverable", id, d.posX, d.posY);
      commitDeliverablePosition(id, cur.x + dx, cur.y + dy, sync);
    }
  }
  function commitNotePosition(id: string, x: number, y: number, sync: boolean) {
    if (layoutMode() === "personal")
      store.setPersonalPosition("note", id, x, y, sync);
    else store.moveNote(id, x, y, sync);
  }

  const [selectedGroups, setSelectedGroups] = createSignal<Set<string>>(
    new Set(),
  );
  /** Marquee-select rect in screen space, while actively dragging on empty canvas. */
  const [marquee, setMarquee] = createSignal<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);

  // ---- drag-to-group / eject state -----------------------------------------
  // There is no shared "drag in progress" signal otherwise; these drive the
  // dwell add-target highlight and the anchored-outline eject preview during a
  // card or group-label drag.
  type DragTarget = { kind: "card" | "group"; id: string; currentGroupId: string | null };
  const [dragTarget, setDragTarget] = createSignal<DragTarget | null>(null);
  const [hoverGroupId, setHoverGroupId] = createSignal<string | null>(null);
  const [ejecting, setEjecting] = createSignal(false);
  // Blender-style status-bar readout: what the cursor is currently over.
  const [hovered, setHovered] = createSignal<{ kind: "deliverable" | "group"; name: string } | null>(null);
  const DWELL_MS = 500;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  let dwellCandidate: string | null = null;

  /** Area of the intersection of two world rects (0 when disjoint). */
  const overlapArea = (a: Rect, b: Rect) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return ix * iy;
  };

  /** Deliverable ids that constitute the dragged item (one card, or every
   *  member of a dragged group) — excluded when measuring the group it's
   *  leaving. */
  function draggedMemberIds(t: DragTarget): Set<string> {
    return t.kind === "group" ? new Set(store.membersOfGroup(t.id)) : new Set([t.id]);
  }

  /** Group ids to exclude as drop targets: the item's current group and all of
   *  its ancestors (an item is always geometrically inside its own ancestors, so
   *  a dwell there must not re-home it), plus — for a dragged group — itself and
   *  all its descendants, to prevent cycles. */
  function excludedTargetGroups(t: DragTarget): Set<string> {
    const out = new Set<string>();
    // current group + ancestor chain
    let cur = t.currentGroupId;
    for (let i = 0; i < 64 && cur; i++) {
      out.add(cur);
      cur = store.groupById(cur)?.parentGroupId ?? null;
    }
    if (t.kind === "group") {
      out.add(t.id);
      let grew = true;
      while (grew) {
        grew = false;
        for (const g of store.groups()) {
          if (g.parentGroupId && out.has(g.parentGroupId) && !out.has(g.id)) {
            out.add(g.id);
            grew = true;
          }
        }
      }
    }
    return out;
  }

  /** The legal drop-target group the dragged item most overlaps (at least half
   *  of the smaller of the two rects). Overlap-based rather than center-in-rect
   *  so dragging a large group onto a small one — or vice versa — lands
   *  predictably instead of keying off a geometric centre. */
  function targetGroupFor(itemRect: Rect, t: DragTarget): string | null {
    const exclude = excludedTargetGroups(t);
    const itemArea = itemRect.w * itemRect.h;
    let best: { id: string; ratio: number } | null = null;
    for (const g of store.groups()) {
      if (exclude.has(g.id)) continue;
      const r = groupOutlineRect(g.id);
      if (!r) continue;
      const inter = overlapArea(itemRect, r);
      if (inter <= 0) continue;
      const ratio = inter / Math.min(itemArea, r.w * r.h);
      if (ratio >= 0.5 && (!best || ratio > best.ratio)) best = { id: g.id, ratio };
    }
    return best?.id ?? null;
  }

  function clearDwell() {
    if (dwellTimer) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
    dwellCandidate = null;
  }

  /** Per-frame during a drag: (re)arm the dwell timer over a candidate group and
   *  flag whether the item has crossed up/left past its current group's handle. */
  function updateDragTargets(t: DragTarget, itemRect: Rect) {
    const cand = targetGroupFor(itemRect, t);
    if (cand !== dwellCandidate) {
      clearDwell();
      dwellCandidate = cand;
      if (cand) dwellTimer = setTimeout(() => setHoverGroupId(cand), DWELL_MS);
      else setHoverGroupId(null);
    }
    // directional eject: the item leaves once it's at least half past the top or
    // left edge of the handle (the top-left of the current group's *other*
    // members) — i.e. its centre crosses that edge.
    if (t.currentGroupId) {
      const excl = draggedMemberIds(t);
      const others = store
        .membersOfGroup(t.currentGroupId)
        .filter((id) => !excl.has(id))
        .map((id) => store.byId(id))
        .filter((d): d is Deliverable => !!d)
        .map(effCardRect);
      if (others.length > 0) {
        const anchor = boundsOf(others);
        const cx = itemRect.x + itemRect.w / 2;
        const cy = itemRect.y + itemRect.h / 2;
        setEjecting(cx < anchor.x || cy < anchor.y);
      } else {
        setEjecting(false);
      }
    } else {
      setEjecting(false);
    }
  }

  function endDragTargets() {
    clearDwell();
    setDragTarget(null);
    setHoverGroupId(null);
    setEjecting(false);
  }

  // ---- collision push-away ---------------------------------------------------
  // While something is dragged, neighbours it would overlap slide out of the
  // way (local-only). Each is keyed to its *home* (pre-push) position so the
  // decision is stable frame-to-frame: home overlaps the obstacle ⇒ push; home
  // clears ⇒ restore. On drop the pushes are committed; if the drag never
  // reaches them (or is cancelled) they return home.
  const COLLIDE_GAP = 16;
  const displacedHome = new Map<string, { x: number; y: number }>();

  /** Shift `home` the least distance needed to clear `obstacle` (or null if it
   *  already clears). */
  function separate(home: Rect, obstacle: Rect): { x: number; y: number } | null {
    if (overlapArea(home, obstacle) <= 0) return null;
    const right = obstacle.x + obstacle.w + COLLIDE_GAP - home.x;
    const left = home.x + home.w + COLLIDE_GAP - obstacle.x;
    const down = obstacle.y + obstacle.h + COLLIDE_GAP - home.y;
    const up = home.y + home.h + COLLIDE_GAP - obstacle.y;
    const opts = [
      { x: home.x + right, y: home.y, m: right },
      { x: home.x - left, y: home.y, m: left },
      { x: home.x, y: home.y + down, m: down },
      { x: home.x, y: home.y - up, m: up },
    ];
    const best = opts.reduce((a, b) => (b.m < a.m ? b : a));
    return { x: best.x, y: best.y };
  }

  /** Per drag frame: push neighbours out of `obstacle`, restore any that no
   *  longer need to move. `movingIds` are excluded (they're being dragged). */
  function resolveCollisions(movingIds: Set<string>, obstacle: Rect) {
    for (const o of store.deliverables()) {
      if (movingIds.has(o.id)) continue;
      const cur = posOf("deliverable", o.id, o.posX, o.posY);
      const home = displacedHome.get(o.id) ?? cur;
      const homeRect: Rect = {
        x: home.x,
        y: home.y,
        w: CARD_W,
        h: thumbHeight(o) + CARD_HEADER_H,
      };
      const pushed = separate(homeRect, obstacle);
      if (pushed) {
        if (!displacedHome.has(o.id)) displacedHome.set(o.id, { x: home.x, y: home.y });
        commitDeliverablePosition(o.id, pushed.x, pushed.y, false);
      } else if (displacedHome.has(o.id)) {
        commitDeliverablePosition(o.id, home.x, home.y, false);
        displacedHome.delete(o.id);
      }
    }
  }

  /** Drop: bake the current (pushed) positions of displaced neighbours in.
   *  Neighbours the drag moved away from were already sent home per-frame, so
   *  only the ones still cleared aside remain here to persist. */
  function lockDisplaced() {
    for (const id of displacedHome.keys()) {
      const cur = posOf("deliverable", id, store.byId(id)?.posX ?? 0, store.byId(id)?.posY ?? 0);
      commitDeliverablePosition(id, cur.x, cur.y, true);
    }
    displacedHome.clear();
  }

  /** After a group grows, push any sibling (root) groups whose outlines now
   *  overlap the grown cluster out of the way — moving their member cards
   *  together — so a new/expanded group never ends up nested under a neighbour.
   *  Groups are member-derived, so "moving a group" = translating its members. */
  function separateOverlappingGroups(grownGroupId: string) {
    const rootId = store.rootGroupOf(grownGroupId);
    const source = groupOutlineRect(rootId);
    if (!source) return;
    for (const g of store.groups()) {
      if (g.parentGroupId || g.id === rootId) continue; // only other root groups
      const rect = groupOutlineRect(g.id);
      if (!rect) continue;
      const pushed = separate(rect, source);
      if (!pushed) continue;
      const dx = pushed.x - rect.x;
      const dy = pushed.y - rect.y;
      if (dx === 0 && dy === 0) continue;
      store.moveGroup(store.membersOfGroup(g.id), dx, dy, true);
    }
  }

  /** Retained for camera-focus flows; tap selection now uses the `selected` set
   * so a tap and a checkbox produce the identical selected state (checkmark). */
  const [activeId, setActiveId] = createSignal<string | null>(null);

  /** Plain tap — select exactly this card (checkmark), replacing any prior
   * selection. Same result as ticking its checkbox; multi-select only comes from
   * Shift or the checkboxes (see extendSelection), never from a bare tap. */
  function highlightCard(id: string) {
    batch(() => {
      setSelectedGroups(new Set<string>());
      setActiveId(null);
      setSelected(new Set<string>([id]));
    });
  }

  /** Checkbox / shift+click — toggle this card in the multi-select set,
   * folding the current highlight (if any) into the set first. */
  function extendSelection(id: string) {
    batch(() => {
      setSelected((s) => {
        const n = new Set(s);
        const a = activeId();
        if (a) n.add(a);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
      setActiveId(null);
    });
  }

  const clearSelection = () => {
    setSelected(new Set<string>());
    setSelectedGroups(new Set<string>());
    setActiveId(null);
  };

  // Lift the (global) toast stack above the bottom selection toolbar while a
  // selection is active, so undo/redo toasts don't cover the toolbar buttons.
  createEffect(() => {
    setToastRaised(selected().size > 0 || selectedGroups().size > 0);
  });
  onCleanup(() => setToastRaised(false));

  /** Clicking a group's label selects/deselects the whole group as a unit. */
  function toggleGroupSelect(groupId: string) {
    const members = store.membersOfGroup(groupId);
    const isSelected = selectedGroups().has(groupId);
    batch(() => {
      // a group selection supersedes any lingering single-card highlight —
      // otherwise the stale active card leaks into the info modal
      setActiveId(null);
      setSelectedGroups((s) => {
        const n = new Set(s);
        if (isSelected) n.delete(groupId);
        else n.add(groupId);
        return n;
      });
      setSelected((s) => {
        const n = new Set(s);
        for (const id of members) {
          if (isSelected) n.delete(id);
          else n.add(id);
        }
        return n;
      });
    });
  }

  /** Nesting depth of a group (0 = leaf) — deeper groups get more outline padding. */
  function groupDepth(id: string): number {
    const kids = store.groups().filter((g) => g.parentGroupId === id);
    return kids.length === 0
      ? 0
      : 1 + Math.max(...kids.map((k) => groupDepth(k.id)));
  }

  /** World rect of one group's outline, or null while it has no live members.
   * NOTE: called from inside a per-item `<For each={store.groups()}>` memo —
   * keying the outer `<For>` on the stable store records (not a freshly
   * mapped array) is what keeps a label's DOM node alive across a drag; see
   * onGroupLabelPointerDown. */
  function groupOutlineRect(groupId: string): Rect | null {
    let memberIds = store.membersOfGroup(groupId);
    // While an item is being dragged up/left out of this group, drop it from the
    // bounds so the outline stays pinned at the handle (previews the removal and
    // never chases the item up/left). Growing down/right stays automatic.
    const t = dragTarget();
    if (t && ejecting() && t.currentGroupId === groupId) {
      const excl = draggedMemberIds(t);
      memberIds = memberIds.filter((id) => !excl.has(id));
    }
    const members = memberIds
      .map((id) => store.byId(id))
      .filter((d): d is Deliverable => !!d);
    const g = store.groupById(groupId);
    const frame: Rect | null =
      g && g.posX != null && g.posY != null && g.w != null && g.h != null
        ? { x: g.posX, y: g.posY, w: g.w, h: g.h }
        : null;
    // A group with no members and no own frame is a legacy derived group with
    // nothing to draw. A container (frame) stays visible while empty.
    if (members.length === 0) return frame;
    const pad = 14 + 12 * groupDepth(groupId);
    const b = boundsOf(members.map(effCardRect));
    // Once a group has members its outline is ALWAYS derived from those members —
    // the stored frame no longer pins the size. This lets the outline shrink and
    // keeps auto-arrange from fighting a manually-sized frame. (Manual resizing of
    // populated groups is gone; the frame only positions empty containers above.)
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  }
  const [groupPromptOpen, setGroupPromptOpen] = createSignal(false);
  const [renamingGroupId, setRenamingGroupId] = createSignal<string | null>(
    null,
  );

  /** Drag the label to move this group's members as a unit (a sub-group label
   * moves just that sub-group); a clean click selects the group. */
  function onGroupLabelPointerDown(e: PointerEvent, groupId: string) {
    if (e.button !== 0 || renamingGroupId() === groupId) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = startX;
    let lastY = startY;
    let dragged = false;
    // Move exactly this group's members — a sub-group's label moves just that
    // sub-group, the outermost label moves the whole group.
    const memberIds = store.membersOfGroup(groupId);

    const t: DragTarget = {
      kind: "group",
      id: groupId,
      currentGroupId: store.groupById(groupId)?.parentGroupId ?? null,
    };
    // A container group with its own frame moves the frame too (so an empty one
    // — with no members to translate — still moves).
    const moveFrameBy = (dx: number, dy: number, sync: boolean) => {
      const g = store.groupById(groupId);
      if (g && g.posX != null && g.posY != null && g.w != null && g.h != null) {
        store.setGroupFrame(groupId, g.posX + dx, g.posY + dy, g.w, g.h, sync);
      }
    };
    const onMove = (ev: PointerEvent) => {
      if (!dragged && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4)
        return;
      if (!dragged) setDragTarget(t);
      dragged = true;
      const wd = {
        x: (ev.clientX - lastX) / camera.cam.zoom,
        y: (ev.clientY - lastY) / camera.cam.zoom,
      };
      commitGroupPositions(memberIds, wd.x, wd.y, false);
      moveFrameBy(wd.x, wd.y, false);
      lastX = ev.clientX;
      lastY = ev.clientY;
      const gr = groupOutlineRect(groupId);
      if (gr) {
        updateDragTargets(t, gr);
        resolveCollisions(new Set(memberIds), gr);
      }
    };
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      try { el.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
      if (dragged) {
        const wd = {
          x: (ev.clientX - lastX) / camera.cam.zoom,
          y: (ev.clientY - lastY) / camera.cam.zoom,
        };
        commitGroupPositions(memberIds, wd.x, wd.y, true);
        moveFrameBy(wd.x, wd.y, true);
        const hg = hoverGroupId();
        const priorParent = t.currentGroupId;
        if (hg) {
          store.setGroupParent(groupId, hg);
          record(
            "Nest group",
            () => store.setGroupParent(groupId, priorParent),
            () => store.setGroupParent(groupId, hg),
          );
        } else if (ejecting() && priorParent) {
          store.setGroupParent(groupId, null);
          record(
            "Un-nest group",
            () => store.setGroupParent(groupId, priorParent),
            () => store.setGroupParent(groupId, null),
          );
        }
        endDragTargets();
        lockDisplaced();
      } else if (ev.type !== "pointercancel") {
        toggleGroupSelect(groupId);
      }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }

  /** Bottom-right resize of a container group's frame (framed groups only). */
  function onGroupResizePointerDown(e: PointerEvent, groupId: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const g = store.groupById(groupId);
    if (!g || g.posX == null || g.posY == null || g.w == null || g.h == null) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = g.w;
    const startH = g.h;
    const MIN = 120;
    const apply = (ev: PointerEvent, sync: boolean) => {
      const dx = (ev.clientX - startX) / camera.cam.zoom;
      const dy = (ev.clientY - startY) / camera.cam.zoom;
      store.setGroupFrame(
        groupId,
        g.posX!,
        g.posY!,
        Math.max(MIN, startW + dx),
        Math.max(MIN, startH + dy),
        sync,
      );
    };
    const onMove = (ev: PointerEvent) => apply(ev, false);
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      try { el.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
      apply(ev, true);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }

  /** True when the current selection is exactly the members of the selected groups. */
  function selectionIsWholeGroups(): boolean {
    const gids = [...selectedGroups()];
    if (gids.length === 0) return false;
    const memberUnion = new Set(gids.flatMap((g) => store.membersOfGroup(g)));
    const sel = selected();
    return (
      memberUnion.size === sel.size &&
      [...sel].every((id) => memberUnion.has(id))
    );
  }

  /** "nest" (2+ whole groups picked via their labels) or "create" (1+ cards).
   * The label prompt opens either way. "create" covers both a top-level group
   * from ungrouped cards and a *sub-group* from cards that all already share
   * one group (see createParentGroupId). Null when the selection mixes grouped
   * and ungrouped cards or spans two different groups — the fix there is "Add
   * to <group>", not "Group". A single card is allowed so a group can be
   * started with one asset and grown later. */
  const groupButtonAction = createMemo<"nest" | "create" | null>(() => {
    if (selectedGroups().size >= 2 && selectionIsWholeGroups()) return "nest";
    if (selectedGroups().size !== 0) return null; // a single whole group offers Ungroup, not Group
    const ids = [...selected()];
    if (ids.length === 0) return null;
    const groupIds = new Set(
      ids.map((id) => store.byId(id)?.groupId).filter((g): g is string => !!g),
    );
    if (groupIds.size === 0) return "create"; // new top-level group
    const anyUngrouped = ids.some((id) => !store.byId(id)?.groupId);
    if (groupIds.size === 1 && !anyUngrouped) return "create"; // sub-group under the shared group
    return null;
  });

  /** The parent a "create" action nests under (null = top level): set only when
   * every selected card already belongs to the same one group. */
  const createParentGroupId = createMemo<string | null>(() => {
    const ids = [...selected()];
    const groupIds = new Set(
      ids.map((id) => store.byId(id)?.groupId).filter((g): g is string => !!g),
    );
    const anyUngrouped = ids.some((id) => !store.byId(id)?.groupId);
    return groupIds.size === 1 && !anyUngrouped ? [...groupIds][0] : null;
  });

  // Workspace (org) name for download filenames — not carried on the project
  // graph, so resolve it from the org list matched to the active org.
  const dlUser = createAsync(() => requireUserQuery());
  const dlOrgs = createAsync(() => myOrgsQuery());
  const workspaceName = () =>
    dlOrgs()?.find((o) => o.id === dlUser()?.activeOrganizationId)?.name ?? "";

  /** A download filename reflecting the full hierarchy:
   *  Workspace_Entity_Project_Group_Deliverable_vN.ext (blank parts dropped). */
  const sanitizePart = (s: string) =>
    s.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  function downloadFileName(d: Deliverable, v: { number: number; fileName: string }): string {
    const graph = store.state.graph;
    const dot = v.fileName.lastIndexOf(".");
    const ext = dot >= 0 ? v.fileName.slice(dot) : "";
    const base = [
      workspaceName(),
      graph?.project.entityName ?? "",
      graph?.project.name ?? "",
      d.groupLabel ?? "",
      d.name,
      `v${v.number}`,
    ]
      .map((p) => sanitizePart(String(p || "")))
      .filter(Boolean)
      .join("_");
    return `${base}${ext}`;
  }

  /** Selected deliverables that have a downloadable version, mapped to the ZIP
   * payload (latest version file, named for the full hierarchy). */
  const downloadableSelection = createMemo<{ name: string; displayName: string }[]>(() =>
    [...selected()]
      .map((id) => store.byId(id))
      .filter((d): d is Deliverable => !!d && d.versions.length > 0)
      .map((d) => {
        const v = d.versions[d.versions.length - 1];
        return { name: v.fileName, displayName: downloadFileName(d, v) };
      }),
  );

  /** When the selection mixes ungrouped cards with exactly one existing
   * group's members, offer to add the ungrouped ones into that group
   * instead of the (blocked) "create a new group" action. */
  const addToExistingGroupAction = createMemo<{
    groupId: string;
    label: string;
    ids: string[];
  } | null>(() => {
    if (selectedGroups().size >= 2 && selectionIsWholeGroups()) return null; // nesting takes priority
    const ids = [...selected()];
    const groupIds = new Set(
      ids.map((id) => store.byId(id)?.groupId).filter((g): g is string => !!g),
    );
    if (groupIds.size !== 1) return null;
    const [groupId] = groupIds;
    const ungroupedIds = ids.filter((id) => !store.byId(id)?.groupId);
    if (ungroupedIds.length === 0) return null; // already all in this one group — nothing to do
    return {
      groupId,
      label: store.groupById(groupId)?.label ?? "group",
      ids: ungroupedIds,
    };
  });

  function addSelectedToGroup(action: {
    groupId: string;
    label: string;
    ids: string[];
  }) {
    for (const id of action.ids) store.addToGroup(id, action.groupId);
    clearSelection();
    flash(`Added ${action.ids.length} to “${action.label}”`);
  }

  async function submitGroup(label: string) {
    // always close, whether this is a real submit or a cancel-by-blur —
    // otherwise an empty blur leaves the prompt stuck open indefinitely
    setGroupPromptOpen(false);
    const name = label.trim();
    if (!name) return;
    try {
      if (selectedGroups().size >= 2 && selectionIsWholeGroups()) {
        const gids = [...selectedGroups()];
        await store.nestGroups(gids, name);
        clearSelection();
        flash(`Grouped ${gids.length} groups as “${name}”`);
      } else {
        const ids = [...selected()];
        const parent = createParentGroupId();
        await store.groupSelected(ids, name, parent);
        clearSelection();
        flash(
          `${parent ? "Sub-grouped" : "Grouped"} ${ids.length} deliverable${ids.length === 1 ? "" : "s"} as “${name}”`,
        );
      }
    } catch (err) {
      flash(err instanceof Error ? err.message : "Couldn’t create group");
    }
  }

  function ungroupSelected() {
    const gids = [...selectedGroups()];
    if (gids.length !== 1) return;
    const label = store.groupById(gids[0])?.label ?? "group";
    store.dissolveGroup(gids[0]);
    clearSelection();
    flash(`Ungrouped “${label}”`);
  }
  // per-card action hooks (inline rename) for the shared context menu
  const cardActions = new Map<string, { startRename: () => void }>();

  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(msg: string) {
    setStatusMsg(msg);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => setStatusMsg(""), 4000);
  }

  // ---- undo/redo (per-project canvas; resets on navigation) ----------------
  const undoStack = createUndoStack();
  /** Record an action whose effect has already been applied, and toast it. */
  function record(label: string, undoFn: () => void, redoFn: () => void) {
    undoStack.push({ label, undo: undoFn, redo: redoFn });
    pushToast(label, { actionLabel: "Undo", onAction: doUndo });
  }
  function doUndo() {
    const c = undoStack.undo();
    if (c) pushToast(`Undid: ${c.label}`, { actionLabel: "Redo", onAction: doRedo });
  }
  function doRedo() {
    const c = undoStack.redo();
    if (c) pushToast(`Redid: ${c.label}`);
  }
  /** Rename a deliverable, recording an undo step (no-op when unchanged). */
  function renameDeliverableU(id: string, prev: string, name: string) {
    if (name === prev) return;
    store.renameDeliverable(id, name);
    record(
      "Rename deliverable",
      () => store.renameDeliverable(id, prev),
      () => store.renameDeliverable(id, name),
    );
  }
  /** Rename a group, recording an undo step (no-op when unchanged). */
  function renameGroupU(id: string, prev: string, name: string) {
    if (name === prev) return;
    store.renameGroup(id, name);
    record(
      "Rename group",
      () => store.renameGroup(id, prev),
      () => store.renameGroup(id, name),
    );
  }

  // ---- derived state -------------------------------------------------------

  const reviewId = () => params.deliverableId as string | undefined;
  const current = createMemo(() =>
    reviewId() ? store.byId(reviewId()!) : undefined,
  );

  // Publish what's in view for the assistant panel's context chips (it mounts
  // outside the canvas and only sees ids from the URL, not names). Cleared on
  // navigate away so chips fall back to entity scope.
  createEffect(() => {
    const project = store.state.graph?.project;
    const d = current();
    setViewContext({
      project: project ? { id: project.id, name: project.name } : undefined,
      deliverable: d ? { id: d.id, name: d.name } : undefined,
    });
  });
  onCleanup(() => setViewContext({}));

  // role-adaptive gating (server enforces the same matrix on every call)
  const canCreate = () => store.can("deliverable", "create");
  const canEdit = () => store.can("deliverable", "update");
  const canUpload = () => store.can("version", "upload");
  const canDeleteVersion = () => store.can("version", "delete");
  const canDeleteDeliverable = () => store.can("deliverable", "delete");
  const canTask = () => store.can("task", "create");
  const canNote = () => store.can("canvasObject", "create");

  async function createTaskFromDeliverable(d: Deliverable) {
    const title = (await promptText({
      title: "New task",
      label: "Task title",
      initial: `Revise ${d.name}`,
      confirmLabel: "Create",
    }))?.trim();
    if (!title) return;
    const graph = store.state.graph;
    if (!graph) return;
    void import("../lib/task-api").then(({ createTask }) =>
      createTask(newId(), title, {
        projectId: graph.project.id,
        deliverableId: d.id,
      }).catch((err) =>
        pushToast(String(err instanceof Error ? err.message : err)),
      ),
    );
  }

  /** Create a task linked to a review thread — the task carries the source
   *  comment (as its description) and the annotationId back-link. */
  async function createTaskFromComment(a: Annotation) {
    const graph = store.state.graph;
    if (!graph) return;
    const first = a.comments[0]?.body ?? "";
    const suggested = first ? first.slice(0, 80) : "Follow up on comment";
    const title = (await promptText({
      title: "New task",
      label: "Task title",
      initial: suggested,
      confirmLabel: "Create",
    }))?.trim();
    if (!title) return;
    void import("../lib/task-api").then(({ createTask }) =>
      createTask(newId(), title, {
        projectId: graph.project.id,
        deliverableId: a.deliverableId,
        annotationId: a.id,
        description: first ? `From review comment: “${first}”` : "",
      })
        .then(() => flash("Task created from comment"))
        .catch((err) => pushToast(String(err instanceof Error ? err.message : err))),
    );
  }

  const currentVersion = createMemo<Version | undefined>(() => {
    const d = current();
    if (!d) return undefined;
    const override = versionOverride();
    return (
      d.versions.find((v) => v.id === override) ??
      d.versions[d.versions.length - 1]
    );
  });

  const versionAnnotations = createMemo<Annotation[]>(() => {
    const d = current();
    const v = currentVersion();
    if (!d || !v) return [];
    return d.annotations.filter((a) => a.versionId === v.id);
  });

  const openThreadCount = () =>
    versionAnnotations().filter((a) => a.status === "open").length;

  /**
   * The deliverable the status bar / info modal should describe: the one
   * being reviewed, or — since a single click now selects rather than opens
   * — the lone selected card in workspace mode. Falls back to nothing when
   * 0 or 2+ cards are selected (info about "several" isn't meaningful here).
   */
  const focusedDeliverable = createMemo<Deliverable | undefined>(() => {
    const d = current();
    if (d) return d;
    const a = activeId();
    if (a) return store.byId(a);
    const sel = selected();
    return sel.size === 1 ? store.byId([...sel][0]) : undefined;
  });

  /** When one or more whole groups are selected on the board, the info modal
   * lists every deliverable they contain (rather than a single card). */
  const selectedGroupInfo = createMemo<
    { label: string; members: Deliverable[] } | undefined
  >(() => {
    if (current()) return undefined; // review mode describes the reviewed asset
    if (selectedGroups().size === 0 || !selectionIsWholeGroups())
      return undefined;
    const gids = [...selectedGroups()];
    const memberIds = new Set(gids.flatMap((g) => store.membersOfGroup(g)));
    const members = [...memberIds]
      .map((id) => store.byId(id))
      .filter((d): d is Deliverable => !!d);
    if (members.length === 0) return undefined;
    const label =
      gids.length === 1
        ? (store.groupById(gids[0])?.label ?? "group")
        : `${gids.length} groups`;
    return { label, members };
  });
  const focusedVersion = createMemo<Version | undefined>(() => {
    const d = focusedDeliverable();
    if (!d) return undefined;
    if (current()) return currentVersion(); // respect the review-mode version override
    return d.versions[d.versions.length - 1];
  });
  const focusedOpenThreadCount = createMemo(() => {
    const d = focusedDeliverable();
    const v = focusedVersion();
    if (!d || !v) return 0;
    return d.annotations.filter(
      (a) => a.versionId === v.id && a.status === "open",
    ).length;
  });

  /**
   * Compare mode: every version laid out in one row (ascending), scaled to the
   * current version's height, current one highlighted. Null when not comparing.
   */
  const compareLayout = createMemo<
    { v: Version; rect: Rect; current: boolean }[] | null
  >(() => {
    const d = current();
    const cv = currentVersion();
    if (!d || !cv || !compare() || d.versions.length < 2) return null;
    const base = planeRect(d, cv);
    const list = [...d.versions].sort((a, b) => a.number - b.number);
    const GAP = 64;
    const widths = list.map((v) =>
      v.width && v.height ? (base.h * v.width) / v.height : base.w,
    );
    const totalW = widths.reduce((a, b) => a + b, 0) + GAP * (list.length - 1);
    let x = base.x + base.w / 2 - totalW / 2;
    return list.map((v, i) => {
      const rect = { x, y: base.y, w: widths[i], h: base.h };
      x += widths[i] + GAP;
      return { v, rect, current: v.id === cv.id };
    });
  });

  const plane = createMemo(() => {
    const d = current();
    if (!d) return null;
    const cl = compareLayout();
    if (cl) return cl.find((i) => i.current)!.rect;
    return planeRect(d, currentVersion());
  });

  // workspace with nothing on it: freeze the camera so the empty-state stays put
  const locked = () =>
    !reviewId() && store.state.loaded && store.deliverables().length === 0;
  // review mode pans only while comparing versions; workspace pans unless locked
  const panEnabled = () => (reviewId() ? compare() : !locked());

  const viewport = () => ({
    w: container?.clientWidth ?? 800,
    h: container?.clientHeight ?? 600,
  });

  // ---- camera transitions --------------------------------------------------

  let savedWorkspaceCam: { x: number; y: number; zoom: number } | null = null;
  let firstFrame = true;

  function fitWorkspace(animate: boolean) {
    const rects = store.deliverables().map(effCardRect);
    const target = camera.fitRect(
      boundsOf(rects),
      viewport().w,
      viewport().h,
      80,
    );
    // never zoom cards past 1:1 when fitting
    if (target.zoom > 1) {
      const b = boundsOf(rects);
      target.zoom = 1;
      target.x = b.x + b.w / 2 - viewport().w / 2;
      target.y = b.y + b.h / 2 - viewport().h / 2;
    }
    animate ? camera.flyTo(target) : camera.jumpTo(target);
  }

  function fitPlane(animate: boolean, duration = 400) {
    const cl = compareLayout();
    const p = cl ? boundsOf(cl.map((i) => i.rect)) : plane();
    if (!p) return;
    const target = camera.fitRect(p, viewport().w, viewport().h, 64);
    animate ? camera.flyTo(target, duration) : camera.jumpTo(target);
  }

  function zoomAtCenter(factor: number) {
    if (locked()) return;
    camera.zoomAt(viewport().w / 2, viewport().h / 2, factor, 0.05, 64);
  }

  function fitCurrent() {
    current() ? fitPlane(true, 250) : fitWorkspace(true);
  }

  function toggleCompare() {
    const d = current();
    if (!d || d.versions.length < 2) return;
    setCompare((c) => !c);
    // event handlers batch signal writes; fit only after the layout memo
    // reflects the new compare state, or the camera frames the old rects
    queueMicrotask(() => fitPlane(true, 300));
  }

  // depends ONLY on load state + which deliverable is under review; everything
  // else (camera math, selection resets) must stay untracked or a placed pin
  // would immediately re-trigger this and get pruned again
  createEffect(
    on(
      [() => store.state.loaded && !!store.state.graph, reviewId],
      ([ready, id]) => {
        if (!ready) return;
        untrack(() => {
          if (id) {
            fitPlane(!firstFrame);
          } else {
            if (firstFrame) fitWorkspace(false);
            else if (savedWorkspaceCam) camera.flyTo(savedWorkspaceCam);
            else fitWorkspace(true);
          }
          firstFrame = false;
          // reset per-deliverable UI state when the subject changes
          setVersionOverride(null);
          setCompare(false);
          selectAnnotation(null);
          setPendingDecision(null);
        });
      },
    ),
  );

  // ---- selection / pruning -------------------------------------------------

  /** Deselecting an empty, open thread deletes it (a pin with no words is noise). */
  function selectAnnotation(id: string | null) {
    const prevId = selectedAnnId();
    if (prevId && prevId !== id) {
      const d = current();
      const prev = d?.annotations.find((a) => a.id === prevId);
      if (d && prev && prev.status === "open" && prev.comments.length === 0) {
        store.removeAnnotation(d.id, prevId);
      }
    }
    setSelectedAnnId(id);
    if (id) setSidebarOpen(true);
  }

  function selectVersion(v: Version) {
    if (v.id === currentVersion()?.id) return;
    batch(() => {
      selectAnnotation(null);
      setVersionOverride(v.id);
    });
    queueMicrotask(() => fitPlane(true, 250));
  }

  // ---- navigation ----------------------------------------------------------

  function enterReview(d: Deliverable) {
    savedWorkspaceCam = { ...camera.cam };
    navigate(`/p/${store.projectId}/d/${d.id}`);
  }

  function exitReview() {
    selectAnnotation(null);
    navigate(`/p/${store.projectId}`);
  }

  function cycleReview(delta: number) {
    const list = store.deliverables();
    const d = current();
    if (!d || list.length < 2) return;
    const idx = list.findIndex((x) => x.id === d.id);
    const next = list[(idx + delta + list.length) % list.length];
    navigate(`/p/${store.projectId}/d/${next.id}`);
  }

  // ---- uploads -------------------------------------------------------------

  async function uploadTo(d: Deliverable, files: File[]) {
    if (!canUpload()) return;
    for (const file of files) {
      flash(`Uploading ${file.name}…`);
      try {
        const v = await uploadVersion(d.id, file);
        store.addVersion(v);
        if (reviewId() === d.id) {
          setVersionOverride(v.id);
          fitPlane(true, 250);
        }
        flash(`${d.name} → v${v.number}`);
      } catch (e) {
        flash(e instanceof Error ? e.message : "Upload failed");
      }
    }
  }

  function createDeliverableAt(
    wx: number,
    wy: number,
    name?: string,
  ): Deliverable {
    const n = name ?? `Deliverable ${store.deliverables().length + 1}`;
    const d = store.addDeliverable(n, wx - CARD_W / 2, wy - 60);
    record("Create deliverable", () => store.removeDeliverable(d.id), () => store.restoreDeliverable(d));
    return d;
  }

  /** A committed (non-drag) absolute move, e.g. from auto-arrange — single
   * indirection point so a later layout-mode change only needs editing here. */
  function movePlacedDeliverable(id: string, x: number, y: number) {
    commitDeliverablePosition(id, x, y, true);
  }

  /** Commit a set of id→position writes (undo/redo of a move). */
  function applyPositions(pos: Record<string, { x: number; y: number }>) {
    for (const [id, p] of Object.entries(pos)) commitDeliverablePosition(id, p.x, p.y, true);
  }
  /** Snapshot the effective positions of a set of deliverables. */
  function snapshotPositions(ids: Iterable<string>): Record<string, { x: number; y: number }> {
    const snap: Record<string, { x: number; y: number }> = {};
    for (const id of ids) {
      const d = store.byId(id);
      if (d) snap[id] = posOf("deliverable", id, d.posX, d.posY);
    }
    return snap;
  }
  // captured at the first frame of a card drag, recorded as one command on drop
  let cardMoveStart: Record<string, { x: number; y: number }> | null = null;

  /** Applies neighbor/grid snapping (per the toggles), then moves the card —
   * or, if it's part of a group, drags the whole group along by the same
   * delta. Movement is free unless a snap actually engages (no quantizing
   * every frame — that's what made dragging feel jittery). Writes land on
   * whichever layout layer is active (see layoutMode / commitDeliverablePosition). */
  function handleCardMove(
    dl: Deliverable,
    x: number,
    y: number,
    done: boolean,
  ) {
    // Dragging a card moves only that card (so members can be rearranged
    // within a group); the whole-group move handle is the group label. A card
    // that's part of a multi-selection drags the whole selection along.
    const movingIds =
      selected().has(dl.id) && selected().size > 1
        ? new Set(selected())
        : new Set([dl.id]);
    // capture the pre-drag positions once, on the first move frame
    if (!done && !cardMoveStart) cardMoveStart = snapshotPositions(movingIds);
    let snapped = { x, y };
    if (snapObjects()) {
      // exclude cards moving along with the drag from the snap targets
      const others = [
        ...store
          .deliverables()
          .filter((o) => !movingIds.has(o.id))
          .map(effCardRect),
        ...store.canvasObjects().map(effNoteRect),
      ];
      const rect = { x, y, w: CARD_W, h: thumbHeight(dl) + CARD_HEADER_H };
      const threshold = 8 / camera.cam.zoom; // constant feel on screen at any zoom
      const result = snapToNeighbors(rect, others, threshold);
      if (result.guides.length > 0) {
        snapped = { x: result.x, y: result.y };
        setSnapGuides(done ? [] : result.guides);
      } else {
        setSnapGuides([]);
        if (snapGrid()) snapped = snapToGrid(x, y);
      }
    } else if (snapGrid()) {
      snapped = snapToGrid(x, y);
    }
    if (done) setSnapGuides([]);
    if (movingIds.size > 1) {
      const cur = posOf("deliverable", dl.id, dl.posX, dl.posY);
      commitGroupPositions(
        [...movingIds],
        snapped.x - cur.x,
        snapped.y - cur.y,
        done,
      );
    } else {
      commitDeliverablePosition(dl.id, snapped.x, snapped.y, done);
    }

    // Single-card drags participate in drag-to-group (dwell) and directional
    // eject; multi-card drags just reposition.
    let membershipChanged = false;
    if (movingIds.size === 1) {
      const t: DragTarget = { kind: "card", id: dl.id, currentGroupId: dl.groupId ?? null };
      const itemRect: Rect = { x: snapped.x, y: snapped.y, w: CARD_W, h: thumbHeight(dl) + CARD_HEADER_H };
      if (!done) {
        setDragTarget(t);
        updateDragTargets(t, itemRect);
      } else {
        const hg = hoverGroupId();
        const priorGroup = dl.groupId;
        if (hg) {
          store.addToGroup(dl.id, hg);
          membershipChanged = true;
          record(
            "Move into group",
            () => (priorGroup ? store.addToGroup(dl.id, priorGroup) : store.ungroup(dl.id)),
            () => store.addToGroup(dl.id, hg),
          );
        } else if (ejecting() && priorGroup) {
          store.ungroup(dl.id);
          membershipChanged = true;
          record(
            "Remove from group",
            () => store.addToGroup(dl.id, priorGroup),
            () => store.ungroup(dl.id),
          );
        }
        endDragTargets();
      }
    }

    // Push neighbours out of the way of whatever's moving; bake on drop.
    const obstacle = boundsOf(
      [...movingIds]
        .map((id) => store.byId(id))
        .filter((d): d is Deliverable => !!d)
        .map(effCardRect),
    );
    if (!done) resolveCollisions(movingIds, obstacle);
    else lockDisplaced();

    // Record the move as one undoable command (unless this drop was really a
    // membership change, which was recorded above).
    if (done && cardMoveStart) {
      const start = cardMoveStart;
      cardMoveStart = null;
      if (!membershipChanged) {
        const end = snapshotPositions(Object.keys(start));
        const moved = Object.keys(end).some(
          id => end[id].x !== start[id]?.x || end[id].y !== start[id]?.y,
        );
        if (moved) {
          record("Move", () => applyPositions(start), () => applyPositions(end));
        }
      }
    }
  }

  function handleNoteMove(
    o: CanvasObject,
    x: number,
    y: number,
    done: boolean,
  ) {
    let snapped = { x, y };
    if (snapObjects()) {
      const others = [
        ...store.deliverables().map(effCardRect),
        ...store
          .canvasObjects()
          .filter((n) => n.id !== o.id)
          .map(effNoteRect),
      ];
      const threshold = 8 / camera.cam.zoom;
      const result = snapToNeighbors(
        { x, y, w: NOTE_W, h: 80 },
        others,
        threshold,
      );
      if (result.guides.length > 0) {
        snapped = { x: result.x, y: result.y };
        setSnapGuides(done ? [] : result.guides);
      } else {
        setSnapGuides([]);
        if (snapGrid()) snapped = snapToGrid(x, y);
      }
    } else if (snapGrid()) {
      snapped = snapToGrid(x, y);
    }
    if (done) setSnapGuides([]);
    commitNotePosition(o.id, snapped.x, snapped.y, done);
  }

  async function editNoteTags(o: CanvasObject) {
    const input = await promptText({
      title: "Edit tags",
      label: "Tags (comma-separated)",
      initial: o.tags.join(", "),
    });
    if (input === null) return;
    const tags = input
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8);
    store.updateNote(o.id, { tags });
  }

  function noteMenuEntries(o: CanvasObject): MenuEntry[] {
    const canEditNote = store.can("canvasObject", "update");
    return [
      ...(canEditNote
        ? [
            {
              label: "Edit tags",
              icon: "iconoir:tag",
              run: () => editNoteTags(o),
            },
          ]
        : []),
      ...(canEditNote
        ? (Object.keys(NOTE_COLORS) as NoteColor[]).map((color) => ({
            label: `Color: ${color}`,
            icon: "iconoir:fill-color" as string,
            hint: o.color === color ? "current" : undefined,
            run: () => store.updateNote(o.id, { color }),
          }))
        : []),
      ...(store.can("canvasObject", "delete")
        ? [
            { separator: true } as const,
            {
              label: "Delete note",
              icon: "iconoir:trash",
              danger: true,
              run: () => store.removeNote(o.id),
            },
          ]
        : []),
    ];
  }

  /** Flies the camera to a note — the sidebar list's primary action, since
   * notes have no detail view of their own (they live on the board). */
  function jumpToNote(note: CanvasObject) {
    const pos = posOf("note", note.id, note.posX, note.posY);
    const target = camera.fitRect(
      { x: pos.x, y: pos.y, w: NOTE_W, h: 80 },
      viewport().w,
      viewport().h,
      200,
    );
    camera.flyTo(target);
  }

  /** Flies the camera to a deliverable card and highlights it — the primary
   * action for the status-bar list modal (stay on the board, don't navigate). */
  function jumpToDeliverable(d: Deliverable) {
    const target = camera.fitRect(effCardRect(d), viewport().w, viewport().h, 200);
    camera.flyTo(target);
    highlightCard(d.id);
  }

  async function deleteNoteFromPanel(note: CanvasObject) {
    if (
      !(await confirm({
        title: "Delete sticky note?",
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    store.removeNote(note.id);
  }

  const ARRANGE_GAP = 40;
  const ARRANGE_ROW_WIDTH = 4 * (CARD_W + ARRANGE_GAP); // wrap after ~4 units per row

  /**
   * Simple shelf-pack layout: each root group becomes one rectangular
   * cluster (its members arranged in a small internal grid), each ungrouped
   * deliverable is its own unit, then every unit flows left-to-right,
   * wrapping to a new row, in creation order. Writes land on whichever
   * layout layer is currently active (see layoutMode / handleCardMove).
   */
  function autoArrange() {
    if (!canEdit()) return;
    const rootGroups = store.groups().filter((g) => !g.parentGroupId);
    const groupedIds = new Set(
      store
        .deliverables()
        .filter((d) => d.groupId)
        .map((d) => d.id),
    );
    const ungrouped = store.deliverables().filter((d) => !groupedIds.has(d.id));

    type Unit = { w: number; h: number; place: (x: number, y: number) => void };
    const units: Unit[] = [];

    for (const g of rootGroups) {
      const members = store
        .membersOfGroup(g.id)
        .map((id) => store.byId(id))
        .filter((d): d is Deliverable => !!d)
        .sort((a, b) => a.createdAt - b.createdAt);
      if (members.length === 0) continue;
      const cols = Math.min(members.length, 4);
      const rows = Math.ceil(members.length / cols);
      const cellH = Math.max(...members.map(thumbHeight)) + CARD_HEADER_H;
      const innerGap = 20;
      const pad = 24; // clears the group outline border
      const labelRoom = 20; // clears the label sitting on the top stroke
      const w = cols * CARD_W + (cols - 1) * innerGap + pad * 2;
      const h = rows * cellH + (rows - 1) * innerGap + pad * 2 + labelRoom;
      units.push({
        w,
        h,
        place: (ux, uy) => {
          members.forEach((m, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            movePlacedDeliverable(
              m.id,
              ux + pad + col * (CARD_W + innerGap),
              uy + pad + labelRoom + row * (cellH + innerGap),
            );
          });
        },
      });
    }

    for (const d of [...ungrouped].sort((a, b) => a.createdAt - b.createdAt)) {
      units.push({
        w: CARD_W,
        h: thumbHeight(d) + CARD_HEADER_H,
        place: (ux, uy) => movePlacedDeliverable(d.id, ux, uy),
      });
    }

    let x = 0,
      y = 0,
      rowH = 0;
    for (const u of units) {
      if (x > 0 && x + u.w > ARRANGE_ROW_WIDTH) {
        x = 0;
        y += rowH + ARRANGE_GAP;
        rowH = 0;
      }
      u.place(x, y);
      x += u.w + ARRANGE_GAP;
      rowH = Math.max(rowH, u.h);
    }

    flash(`Arranged ${units.length} item${units.length === 1 ? "" : "s"}`);
    queueMicrotask(() => fitWorkspace(true));
  }

  function newDeliverableAtCenter() {
    if (!canCreate()) return;
    const c = camera.screenToWorld(viewport().w / 2, viewport().h / 2);
    const free = findFreeSpot(store.deliverables(), c.x - CARD_W / 2, c.y - 60);
    const d = createDeliverableAt(free.x + CARD_W / 2, free.y + 60);
    flash(`Added ${d.name} — drop an image on it`);
  }

  /** Default starter size for a new empty group container (~two cards wide). */
  const NEW_GROUP_W = CARD_W * 2 + 80;
  const NEW_GROUP_H = 260;

  /** Create an empty draggable group container at screen center and start
   *  renaming it (mirrors how "New deliverable" drops a ready-to-edit card). */
  function newGroupAtCenter() {
    if (!canCreate()) return;
    const c = camera.screenToWorld(viewport().w / 2, viewport().h / 2);
    const label = `Group ${store.groups().length + 1}`;
    const id = store.createGroup(
      label,
      c.x - NEW_GROUP_W / 2,
      c.y - NEW_GROUP_H / 2,
      NEW_GROUP_W,
      NEW_GROUP_H,
    );
    flash(`Created group “${label}” — double-click the label to rename`);
    setRenamingGroupId(id);
  }

  /** Create a new deliverable that belongs to `groupId`, placed inside the
   *  group's current bounds (bottom-left, in the down/right growth zone so it
   *  never lands in the eject region). */
  function createDeliverableInGroup(groupId: string) {
    if (!canCreate()) return;
    const r = groupOutlineRect(groupId);
    const base = r
      ? { x: r.x + 14, y: r.y + r.h }
      : camera.screenToWorld(viewport().w / 2, viewport().h / 2);
    const free = findFreeSpot(store.deliverables(), base.x, base.y);
    const n = `Deliverable ${store.deliverables().length + 1}`;
    const d = store.addDeliverable(n, free.x, free.y, groupId);
    // The group just grew — nudge overlapping neighbour groups aside rather than
    // letting this group's outline expand under them.
    queueMicrotask(() => separateOverlappingGroups(groupId));
    record("Create deliverable", () => store.removeDeliverable(d.id), () => store.restoreDeliverable(d));
    flash(`Added ${d.name} to “${store.groupById(groupId)?.label ?? "group"}”`);
  }

  let pickerTarget: Deliverable | null = null;
  function openFilePicker(d: Deliverable) {
    if (!canUpload()) return;
    pickerTarget = d;
    fileInput.click();
  }

  // ---- pointer input -------------------------------------------------------

  // The container can't scroll (overflow-hidden) and doesn't move mid-gesture,
  // so its rect is cached and only refreshed when layout could have changed —
  // never per pointer/wheel event, which would force a synchronous layout.
  let containerRect: DOMRect | null = null;
  const refreshRect = () => {
    containerRect = container.getBoundingClientRect();
  };
  const localPoint = (e: { clientX: number; clientY: number }) => {
    const r = containerRect ?? (containerRect = container.getBoundingClientRect());
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Touch bookkeeping for one-finger pan / two-finger pinch. Card/note drags
  // stopPropagation, so pointers reaching the container are empty-canvas touches.
  const activePointers = new Map<number, { x: number; y: number }>();
  let pinch: { prevDist: number; prevMid: { x: number; y: number } } | null = null;
  // Cleanup for an in-progress one-finger pan, so a second finger can pre-empt
  // it and take over as a pinch.
  let cancelActivePan: (() => void) | null = null;
  const ptDist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  const ptMid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  /** Drag-to-pan: middle mouse, held-space+left, or a single touch on empty canvas. */
  function beginPan(e: PointerEvent) {
    refreshRect();
    const start = localPoint(e);
    let last = start;
    container.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (pinch) return; // a second finger landed — pinch owns the gesture now
      if (!panEnabled()) return;
      const p = localPoint(ev);
      setPanning(true);
      markInteracting();
      camera.panBy(p.x - last.x, p.y - last.y);
      last = p;
    };
    // ev present = real pointerup/cancel; absent = pre-empted by a pinch.
    const onUp = (ev?: PointerEvent) => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
      if (ev) {
        activePointers.delete(ev.pointerId);
        try { container.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
      }
      setPanning(false);
      cancelActivePan = null;
    };
    cancelActivePan = () => onUp();
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);
  }

  /** Two-finger pinch: zoom about the midpoint + pan with it. Driven off the
   *  same correct camera primitives as the wheel. */
  function beginPinch() {
    markInteracting();
    const [p0, p1] = [...activePointers.values()];
    pinch = { prevDist: ptDist(p0, p1), prevMid: ptMid(p0, p1) };

    const onMove = (ev: PointerEvent) => {
      if (!activePointers.has(ev.pointerId)) return;
      activePointers.set(ev.pointerId, localPoint(ev));
      if (!pinch || activePointers.size < 2) return;
      const [a, b] = [...activePointers.values()];
      const d = ptDist(a, b);
      const m = ptMid(a, b);
      markInteracting();
      if (pinch.prevDist > 0) camera.zoomAt(m.x, m.y, d / pinch.prevDist, 0.05, 64);
      camera.panBy(m.x - pinch.prevMid.x, m.y - pinch.prevMid.y);
      pinch.prevDist = d;
      pinch.prevMid = m;
    };
    const onUp = (ev: PointerEvent) => {
      activePointers.delete(ev.pointerId);
      try { container.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
      if (activePointers.size < 2) {
        container.removeEventListener("pointermove", onMove);
        container.removeEventListener("pointerup", onUp);
        container.removeEventListener("pointercancel", onUp);
        pinch = null;
      }
    };
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);
  }

  /** World-space rect of the marquee, using whichever corners span the box. */
  function marqueeWorldRect(
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): Rect {
    const w0 = camera.screenToWorld(
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
    );
    const w1 = camera.screenToWorld(
      Math.max(start.x, end.x),
      Math.max(start.y, end.y),
    );
    return { x: w0.x, y: w0.y, w: w1.x - w0.x, h: w1.y - w0.y };
  }

  /** Left-button drag on empty canvas: in workspace mode, draws a marquee and
   * live-selects every deliverable it overlaps (replacing the old click-drag
   * pan — panning now lives on the wheel). In review mode a drag still just
   * suppresses the click-to-pin below; it doesn't pan or select anything. */
  function onPointerDown(e: PointerEvent) {
    // Touch: one finger pans the empty canvas; a second finger starts a pinch.
    // (Cards/notes stopPropagation, so touches reaching here are on the board.)
    if (e.pointerType === "touch") {
      refreshRect();
      activePointers.set(e.pointerId, localPoint(e));
      container.setPointerCapture(e.pointerId);
      if (activePointers.size >= 2) {
        cancelActivePan?.(); // hand the one-finger pan off to the pinch
        beginPinch();
        return;
      }
      return beginPan(e);
    }
    if (e.button === 1) {
      e.preventDefault(); // no middle-click autoscroll
      return beginPan(e);
    }
    if (e.button !== 0) return;
    if (spaceHeld()) return beginPan(e);
    refreshRect();
    const start = localPoint(e);
    let dragged = false;

    container.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const p = localPoint(ev);
      if (!dragged && Math.hypot(p.x - start.x, p.y - start.y) < 4) return;
      if (!dragged && !reviewId() && !noteTool())
        setSelectedGroups(new Set<string>());
      dragged = true; // still counts as a drag (won't place a pin on release)
      if (reviewId() || noteTool()) return;
      setMarquee({ x0: start.x, y0: start.y, x1: p.x, y1: p.y });
      const world = marqueeWorldRect(start, p);
      const ids = store
        .deliverables()
        .filter((d) => rectsOverlap(world, effCardRect(d)))
        .map((d) => d.id);
      // Only write when membership actually changed — otherwise a fresh Set
      // identity re-runs the class effect on every card each pointermove.
      const cur = selected();
      if (ids.length !== cur.size || ids.some((id) => !cur.has(id))) {
        setSelected(new Set(ids));
      }
      setActiveId(null);
    };
    const onUp = (ev: PointerEvent) => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
      try { container.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
      if (ev.type === "pointercancel") {
        setMarquee(null);
        return;
      }
      if (dragged) {
        setMarquee(null);
        return;
      }

      // a clean left click — armed note tool places a sticky note here.
      // batch so the note renders with newNoteId already set (auto-edit).
      if (noteTool() && !reviewId()) {
        setNoteTool(false);
        if (canNote()) {
          const w = camera.screenToWorld(start.x, start.y);
          batch(() => {
            const note = store.addNote(w.x - NOTE_W / 2, w.y - 24);
            setNewNoteId(note.id);
          });
        }
        return;
      }

      // a clean click on empty workspace canvas deselects and dismisses any
      // open context menu / info modal
      if (!reviewId()) {
        clearSelection();
        setCtxMenu(null);
        setInfoOpen(false);
        return;
      }

      const d = current();
      const v = currentVersion();
      const p = plane();
      if (d && v && p) {
        const w = camera.screenToWorld(start.x, start.y);
        const nx = (w.x - p.x) / p.w;
        const ny = (w.y - p.y) / p.h;
        if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
          // the core interaction: a click on the asset IS an annotation
          const a = store.addAnnotation(d.id, v.id, nx, ny);
          selectAnnotation(a.id);
          return;
        }
      }
      selectAnnotation(null);
    };
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);
  }

  function onDblClick(e: MouseEvent) {
    if (reviewId()) {
      const d = current();
      if (d) openFilePicker(d);
      return;
    }
    if (!canCreate()) return;
    if ((e.target as HTMLElement).closest("[data-card],[data-note]")) return;
    const p = localPoint(e);
    const w = camera.screenToWorld(p.x, p.y);
    createDeliverableAt(w.x, w.y);
  }

  /** Plain wheel/trackpad scroll pans; Ctrl/Cmd+scroll (also how browsers
   * report trackpad pinch) zooms, anchored on the cursor. */
  // Normalize wheel deltas to CSS pixels. Trackpads report DOM_DELTA_PIXEL with
  // fractional values; mouse wheels often report DOM_DELTA_LINE ("3" per notch),
  // some report DOM_DELTA_PAGE. Without this, pan speed and zoom step swing wildly
  // by device.
  const LINE_PX = 16;
  function normalizedDelta(e: WheelEvent) {
    let { deltaX, deltaY } = e;
    if (e.deltaMode === 1) {
      deltaX *= LINE_PX;
      deltaY *= LINE_PX;
    } else if (e.deltaMode === 2) {
      const page = container.clientHeight;
      deltaX *= page;
      deltaY *= page;
    }
    return { deltaX, deltaY };
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (locked()) return;
    const { deltaX, deltaY } = normalizedDelta(e);
    markInteracting();
    if (e.ctrlKey || e.metaKey) {
      const p = localPoint(e);
      // Zoom proportional to scroll magnitude: continuous, smooth trackpad pinch
      // and consistent mouse-wheel steps. Clamp so a momentum fling can't teleport.
      const clamped = Math.max(-300, Math.min(300, deltaY));
      const factor = Math.exp(-clamped * 0.0015);
      camera.zoomAt(p.x, p.y, factor, 0.05, 64);
    } else if (panEnabled()) {
      camera.panBy(-deltaX, -deltaY);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (!canUpload()) return;
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) return;

    const d = current();
    if (d) {
      void uploadTo(d, files);
      return;
    }

    const p = localPoint(e);
    const w = camera.screenToWorld(p.x, p.y);
    const hit = store.deliverables().find((dl) => {
      const r = effCardRect(dl);
      return w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h;
    });
    if (hit) {
      void uploadTo(hit, files);
    } else if (canCreate()) {
      files.forEach((file, i) => {
        const name = file.name.replace(/\.[^.]+$/, "");
        const nd = createDeliverableAt(w.x + i * (CARD_W + 24), w.y, name);
        void uploadTo(nd, [file]);
      });
    }
  }

  // ---- decisions -----------------------------------------------------------

  // ---- deletion (soft; restorable from History) ----------------------------

  async function confirmDeleteVersion(v?: Version) {
    const d = current();
    const target = v ?? currentVersion();
    if (!d || !target || !canDeleteVersion()) return;
    if (
      !(await confirm({
        title: `Delete v${target.number} of “${d.name}”?`,
        description: "You can restore it from History.",
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    batch(() => {
      selectAnnotation(null);
      if (
        currentVersion()?.id === target.id ||
        versionOverride() === target.id
      ) {
        setVersionOverride(null);
      }
    });
    store.removeVersion(d.id, target.id);
    if (d.versions.length < 2) setCompare(false);
    queueMicrotask(() => fitPlane(true, 250));
    flash(`v${target.number} deleted — restore from History (H)`);
  }

  async function shareDeliverableLink(d: Deliverable) {
    if (!store.can("project", "share")) return;
    try {
      const { token } = await createShareLink("deliverable", d.id);
      const url = `${window.location.origin}/s/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        pushToast("Share link copied — anyone with it can view (read-only)");
      } catch {
        // clipboard blocked — show the URL so it can be copied manually
        await promptText({
          title: "Share link",
          description: "Anyone with this link can view this deliverable (read-only).",
          label: "Link",
          initial: url,
          confirmLabel: "Done",
        });
      }
    } catch {
      pushToast("Couldn't create a share link");
    }
  }

  function duplicateDeliverableU(d: Deliverable) {
    if (!canCreate()) return;
    const copy = store.duplicateDeliverable(d.id);
    if (!copy) return;
    record(
      "Duplicate deliverable",
      () => store.removeDeliverable(copy.id),
      () => store.restoreDeliverable(copy),
    );
    flash(`Duplicated “${d.name}”`);
  }

  async function confirmDeleteDeliverable(d: Deliverable) {
    if (!canDeleteDeliverable()) return;
    if (
      !(await confirm({
        title: `Delete “${d.name}”?`,
        description: "You can restore it from History.",
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    if (reviewId() === d.id) exitReview();
    store.removeDeliverable(d.id);
    record("Delete deliverable", () => store.restoreDeliverable(d), () => store.removeDeliverable(d.id));
    flash(`${d.name} deleted — restore from History (H)`);
  }

  async function bulkDeleteDeliverables() {
    if (!canDeleteDeliverable()) return;
    const ids = selected();
    if (
      !(await confirm({
        title: `Delete ${ids.size} deliverable${ids.size === 1 ? "" : "s"}?`,
        description: "You can restore them from History.",
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    for (const id of ids) {
      if (reviewId() === id) exitReview();
      store.removeDeliverable(id);
    }
    // A group selected via its label puts its id in selectedGroups(); remove those
    // now-empty group rows too so the group doesn't persist (was the reported bug).
    for (const gid of selectedGroups()) store.removeGroupRow(gid);
    clearSelection();
    flash(
      `${ids.size} deliverable${ids.size === 1 ? "" : "s"} deleted — restore from History (H)`,
    );
  }

  // ---- context menus (one shared component, same entries everywhere) -------
  // Every context menu is mirrored by a visible ⋯ kebab on its surface, so
  // nothing is discoverable only by right-clicking.

  function workspaceMenuEntries(at?: { x: number; y: number }): MenuEntry[] {
    return [
      ...(canCreate()
        ? [
            {
              label: at ? "New deliverable here" : "New deliverable",
              icon: "iconoir:plus",
              hint: "N",
              run: () =>
                at ? createDeliverableAt(at.x, at.y) : newDeliverableAtCenter(),
            },
            {
              label: "New group",
              icon: "iconoir:folder",
              hint: "G",
              run: () => newGroupAtCenter(),
            },
          ]
        : []),
      {
        label: "Sticky notes",
        icon: "iconoir:notes",
        run: () => openPanel("notes"),
      },
      {
        label: "Project info",
        icon: "iconoir:info-circle",
        hint: "I",
        run: () => setInfoOpen(true),
      },
      {
        label: "Project history",
        icon: "iconoir:clock",
        hint: "H",
        run: () => openPanel("history"),
      },
      ...(!locked()
        ? [
            {
              label: "Fit to screen",
              icon: "iconoir:frame",
              hint: "F",
              run: () => fitWorkspace(true),
            },
          ]
        : []),
    ];
  }

  function reviewMenuEntries(d: Deliverable): MenuEntry[] {
    const v = currentVersion();
    return [
      ...(canUpload()
        ? [
            {
              label: "Upload new version",
              icon: "iconoir:upload",
              hint: "U",
              run: () => openFilePicker(d),
            },
          ]
        : []),
      ...(d.versions.length > 1
        ? [
            {
              label: compare() ? "Exit compare" : "Compare versions",
              icon: "iconoir:media-image-list",
              hint: "C",
              run: toggleCompare,
            },
          ]
        : []),
      ...(d.versions.length > 0
        ? [
            {
              label: "Download",
              icon: "iconoir:download",
              run: () => {
                // download the version being viewed for the current deliverable,
                // otherwise the latest version of the card the menu is on
                const target =
                  current()?.id === d.id
                    ? (v ?? d.versions[d.versions.length - 1])
                    : d.versions[d.versions.length - 1];
                if (target) downloadFile(target.fileName, downloadFileName(d, target));
              },
            },
          ]
        : []),
      ...(canTask()
        ? [
            {
              label: "Create task",
              icon: "iconoir:task-list",
              run: () => createTaskFromDeliverable(d),
            },
          ]
        : []),
      {
        label: "Project info",
        icon: "iconoir:info-circle",
        hint: "I",
        run: () => setInfoOpen(true),
      },
      {
        label: "Project history",
        icon: "iconoir:clock",
        hint: "H",
        run: () => openPanel("history"),
      },
      {
        label: "Fit to screen",
        icon: "iconoir:frame",
        hint: "F",
        run: () => fitPlane(true, 250),
      },
      {
        label: sidebarOpen() ? "Hide comments" : "Show comments",
        icon: "iconoir:message-text",
        hint: "Tab",
        run: () => setSidebarOpen((o) => !o),
      },
      ...(store.deliverables().length > 1
        ? [
            {
              label: "Previous deliverable",
              icon: "iconoir:arrow-left",
              hint: "←",
              run: () => cycleReview(-1),
            },
            {
              label: "Next deliverable",
              icon: "iconoir:arrow-right",
              hint: "→",
              run: () => cycleReview(1),
            },
          ]
        : []),
      ...(canDeleteVersion() && v
        ? [
            { separator: true } as const,
            {
              label: `Delete v${v.number}`,
              icon: "iconoir:trash",
              danger: true,
              run: () => confirmDeleteVersion(v),
            },
          ]
        : []),
      ...(canDeleteDeliverable()
        ? [
            {
              label: "Delete deliverable",
              icon: "iconoir:trash",
              danger: true,
              run: () => confirmDeleteDeliverable(d),
            },
          ]
        : []),
    ];
  }

  /** open a surface's menu anchored under its kebab button */
  function openMenuAt(e: MouseEvent, entries: MenuEntry[]) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCtxMenu({ x: r.left, y: r.bottom + 4, entries });
  }

  /** Group actions — groups had no menu before; exposes them for right-click,
   *  the group-label ⋯ kebab, and the selection toolbar's More menu. */
  function groupMenuEntries(g: { id: string; label: string }): MenuEntry[] {
    if (!canEdit()) return [];
    return [
      { label: "Rename group", icon: "iconoir:edit-pencil", run: () => setRenamingGroupId(g.id) },
      { label: "Add deliverable", icon: "iconoir:plus", run: () => createDeliverableInGroup(g.id) },
      { separator: true },
      {
        label: "Ungroup",
        icon: "iconoir:link-slash",
        run: () => {
          store.dissolveGroup(g.id);
          flash(`Ungrouped “${g.label}”`);
        },
      },
      { separator: true },
      {
        label: "Delete group",
        icon: "iconoir:trash",
        danger: true,
        run: async () => {
          const members = store.membersOfGroup(g.id);
          if (
            !(await confirm({
              title: `Delete group “${g.label}”?`,
              description: members.length
                ? `${members.length} deliverable${members.length === 1 ? "" : "s"} will be deleted too (restorable from History).`
                : "The empty group will be removed.",
              confirmLabel: "Delete",
              danger: true,
            }))
          )
            return;
          const deleted = store.deleteGroup(g.id);
          if (selectedGroups().has(g.id) || deleted.length) clearSelection();
          record(
            "Delete group",
            () => {
              for (const d of deleted) store.restoreDeliverable(d);
            },
            () => store.deleteGroup(g.id),
          );
          flash(`Deleted group “${g.label}”`);
        },
      },
    ];
  }

  /** The per-item actions for the current selection — surfaced in the selection
   *  toolbar's ⋯ "More" menu so right-click actions are reachable on touch. */
  function selectionMoreEntries(): MenuEntry[] {
    if (selectedGroups().size === 1 && selectionIsWholeGroups()) {
      const g = store.groupById([...selectedGroups()][0]);
      return g ? groupMenuEntries(g) : [];
    }
    if (selected().size === 1 && selectedGroups().size === 0) {
      const d = store.byId([...selected()][0]);
      return d ? deliverableMenuEntries(d) : [];
    }
    return [];
  }

  function deliverableMenuEntries(d: Deliverable): MenuEntry[] {
    return [
      {
        label: "Open review",
        icon: "iconoir:open-in-window",
        hint: "↵",
        run: () => enterReview(d),
      },
      ...(canEdit()
        ? [
            {
              label: "Rename",
              icon: "iconoir:edit-pencil",
              run: () => cardActions.get(d.id)?.startRename(),
            },
          ]
        : []),
      ...(canUpload()
        ? [
            {
              label: "Upload version",
              icon: "iconoir:upload",
              run: () => openFilePicker(d),
            },
          ]
        : []),
      ...(canCreate()
        ? [
            {
              label: "Duplicate",
              icon: "iconoir:copy",
              run: () => duplicateDeliverableU(d),
            },
          ]
        : []),
      ...(canTask()
        ? [
            {
              label: "Create task",
              icon: "iconoir:task-list",
              run: () => createTaskFromDeliverable(d),
            },
          ]
        : []),
      {
        label: "Metadata",
        icon: "iconoir:label",
        run: () => {
          highlightCard(d.id);
          openPanel("metadata");
        },
      },
      ...(store.can("project", "share")
        ? [
            {
              label: "Copy share link",
              icon: "iconoir:share-android",
              run: () => void shareDeliverableLink(d),
            },
          ]
        : []),
      ...(canEdit() && d.groupId
        ? [
            {
              label: "Remove from group",
              icon: "iconoir:link-slash",
              run: () => store.ungroup(d.id),
            },
          ]
        : []),
      ...(canEdit() && !d.groupId
        ? store
            .groups()
            .slice(0, 6)
            .map((g) => ({
              label: `Add to “${g.label}”`,
              icon: "iconoir:link" as string,
              run: () => store.addToGroup(d.id, g.id),
            }))
        : []),
      ...(canDeleteDeliverable()
        ? [
            { separator: true } as const,
            {
              label: "Delete deliverable",
              icon: "iconoir:trash",
              hint: "⌫",
              danger: true,
              run: () => confirmDeleteDeliverable(d),
            },
          ]
        : []),
    ];
  }

  function onCanvasContextMenu(e: MouseEvent) {
    e.preventDefault();
    const d = current();
    if (d) {
      setCtxMenu({ x: e.clientX, y: e.clientY, entries: reviewMenuEntries(d) });
    } else {
      const p = localPoint(e);
      const w = camera.screenToWorld(p.x, p.y);
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        entries: workspaceMenuEntries(w),
      });
    }
  }

  function onVersionTabContextMenu(e: MouseEvent, d: Deliverable, v: Version) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      entries: [
        {
          label: `Show v${v.number}`,
          icon: "iconoir:eye-solid",
          hint: String(v.number),
          run: () => selectVersion(v),
        },
        ...(d.versions.length > 1
          ? [
              {
                label: "Compare versions",
                icon: "iconoir:media-image-list",
                hint: "C",
                run: () => {
                  if (!compare()) toggleCompare();
                },
              },
            ]
          : []),
        ...(canDeleteVersion()
          ? [
              { separator: true } as const,
              {
                label: `Delete v${v.number}`,
                icon: "iconoir:trash",
                danger: true,
                run: () => confirmDeleteVersion(v),
              },
            ]
          : []),
      ],
    });
  }

  async function confirmDecision(note: string) {
    const d = current();
    const v = currentVersion();
    const decision = pendingDecision();
    if (!d || !v || !decision) return;
    setPendingDecision(null);
    const res = await store.decide(d.id, v.id, decision, note);
    if (!res.ok) flash(res.error ?? "Decision rejected");
    else
      flash(
        decision === "approved"
          ? `${d.name} v${v.number} approved`
          : `Revisions requested on ${d.name}`,
      );
  }

  // ---- keyboard ------------------------------------------------------------

  function isTyping(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    return (
      t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable
    );
  }

  function onKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setPaletteOpen((o) => !o);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      if (isTyping(e)) return; // let text fields keep native undo
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
      return;
    }
    if (paletteOpen() || searchOpen() || isTyping(e)) return;

    if (e.key === "/") {
      e.preventDefault();
      setSearchOpen(true);
      return;
    }
    if (e.key === "h" || e.key === "H") {
      openPanel("history");
      return;
    }
    if (e.key === "i" || e.key === "I") {
      setInfoOpen((o) => !o);
      return;
    }
    // keyboard zoom: +/= zoom in, -/_ zoom out (mirrors the on-screen +/- buttons)
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomAtCenter(1.25);
      return;
    }
    if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomAtCenter(0.8);
      return;
    }

    const d = current();
    if (d) {
      // review mode
      switch (e.key) {
        case "Escape":
          if (infoOpen()) setInfoOpen(false);
          else if (historyOpen()) setHistoryOpen(false);
          else if (pendingDecision()) setPendingDecision(null);
          else if (selectedAnnId()) selectAnnotation(null);
          else exitReview();
          return;
        case "u":
        case "U":
          if (canUpload()) openFilePicker(d);
          return;
        case "Tab":
          e.preventDefault();
          setSidebarOpen((o) => !o);
          return;
        case "ArrowLeft":
          cycleReview(-1);
          return;
        case "ArrowRight":
          cycleReview(1);
          return;
        case "f":
        case "F":
          fitPlane(true, 250);
          return;
        case "c":
        case "C":
          toggleCompare();
          return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const v = d.versions.find((v) => v.number === n);
        if (v) selectVersion(v);
      }
    } else {
      // workspace mode
      switch (e.key) {
        case "Escape":
          if (noteTool()) setNoteTool(false);
          else if (infoOpen()) setInfoOpen(false);
          else if (historyOpen()) setHistoryOpen(false);
          return;
        case "n":
        case "N":
          if (canCreate()) newDeliverableAtCenter();
          return;
        case "g":
        case "G":
          if (canCreate()) newGroupAtCenter();
          return;
        case "s":
        case "S":
          if (canNote()) {
            setNoteTool((t) => !t);
            flash(noteTool() ? "Sticky note: click the canvas to place" : "");
          }
          return;
        case "f":
        case "F":
          if (!locked()) fitWorkspace(true);
          return;
      }
    }
  }

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  // Keep the cached container rect fresh. It only changes when layout does — a
  // panel toggling, the window resizing, an ancestor scrolling — never during a
  // pan, so refreshing here (not per pointer event) removes a forced layout from
  // the input hot path. Deliberately does NOT touch the camera: an earlier
  // version pan-compensated on width change and fought in-flight fly animations.
  onMount(() => {
    refreshRect();
    const ro = new ResizeObserver(refreshRect);
    ro.observe(container);
    window.addEventListener("scroll", refreshRect, { capture: true, passive: true });
    onCleanup(() => {
      ro.disconnect();
      window.removeEventListener("scroll", refreshRect, { capture: true } as EventListenerOptions);
    });
  });

  // hold-spacebar-to-pan: separate from onKeyDown so it isn't gated behind
  // review/workspace mode branches and still works while typing is blocked
  onMount(() => {
    function onSpaceDown(e: KeyboardEvent) {
      if (e.code !== "Space" || e.repeat) return;
      if (
        (e.target as HTMLElement).tagName === "INPUT" ||
        (e.target as HTMLElement).tagName === "TEXTAREA" ||
        (e.target as HTMLElement).isContentEditable
      )
        return;
      e.preventDefault(); // no page scroll
      setSpaceHeld(true);
    }
    function onSpaceUp(e: KeyboardEvent) {
      if (e.code === "Space") setSpaceHeld(false);
    }
    function onBlurWindow() {
      setSpaceHeld(false); // e.g. alt-tab away mid-hold — don't get stuck panning
    }
    window.addEventListener("keydown", onSpaceDown);
    window.addEventListener("keyup", onSpaceUp);
    window.addEventListener("blur", onBlurWindow);
    onCleanup(() => {
      window.removeEventListener("keydown", onSpaceDown);
      window.removeEventListener("keyup", onSpaceUp);
      window.removeEventListener("blur", onBlurWindow);
    });
  });

  // ---- render --------------------------------------------------------------

  const counts = createMemo(() => {
    const list = store.deliverables();
    return {
      total: list.length,
      inReview: list.filter((d) => d.status === "in_review").length,
      revisions: list.filter((d) => d.status === "revisions_requested").length,
      approved: list.filter((d) => d.status === "approved").length,
    };
  });

  type Hint = { key?: string; label: string };

  /** Status-bar shortcut hints, structured (not a joined string) so they can
   * render as distinct key/label pills instead of blending into plain text. */
  const hints = createMemo<Hint[]>(() => {
    const d = current();
    if (d) {
      return [
        { label: "click to pin" },
        { label: "right-click for actions" },
        ...(canUpload() ? [{ key: "U", label: "upload" }] : []),
        { label: "1–9 versions" },
        ...(d.versions.length > 1
          ? [{ key: "C", label: compare() ? "exit compare" : "compare" }]
          : []),
        { key: "←→", label: "next" },
        { key: "F", label: "fit" },
        { key: "H", label: "history" },
        { key: "I", label: "info" },
        { key: "Esc", label: "back" },
        { key: "⌘K", label: "search" },
      ];
    }
    if (locked()) {
      return canCreate()
        ? [
            { key: "N", label: "new" },
            { label: "double-click to add" },
            { label: "drop images anywhere" },
            { key: "⌘K", label: "search" },
          ]
        : [{ label: "nothing shared for review yet" }];
    }
    return canCreate()
      ? [
          { key: "N", label: "new" },
          { label: "double-click to add" },
          { label: "drop images" },
          { label: "right-click for actions" },
          { key: "F", label: "fit" },
          { key: "H", label: "history" },
          { key: "I", label: "info" },
          { key: "⌘K", label: "search" },
        ]
      : [
          { label: "click a card to review" },
          { label: "right-click for actions" },
          { key: "F", label: "fit" },
          { key: "H", label: "history" },
          { key: "I", label: "info" },
          { key: "⌘K", label: "search" },
        ];
  });
  return (
    <div class="relative p-1 h-full bg-canvas">
      <div class="rounded-lg overflow-clip w-full flex flex-col h-full border border-line">
        {/* ---- nav ---- */}
        <nav class="min-h-12 px-3 flex items-center justify-between gap-4 bg-surface border-b border-hairline z-10">
          <div class="flex items-center gap-2 text-sm min-w-0">
            <button
              class="flex items-center text-neutral-500 hover:text-neutral-800 cursor-pointer p-1"
              title={reviewId() ? "Back to workspace (Esc)" : "All projects"}
              onClick={() => (reviewId() ? exitReview() : navigate("/"))}
            >
              <Icon icon="iconoir:arrow-left" width="16" />
            </button>
            <Show
              when={projRenaming() && canEdit()}
              fallback={
                <span
                  class="font-medium text-neutral-800 truncate cursor-text"
                  title={canEdit() ? "Double-click to rename" : undefined}
                  onDblClick={() => {
                    if (canEdit()) setProjRenaming(true);
                  }}
                >
                  {store.state.graph?.project.name ?? "…"}
                </span>
              }
            >
              <input
                class="text-sm font-medium text-neutral-800 bg-neutral-50 border border-neutral-200 rounded px-1 py-0.5 outline-none select-text min-w-0"
                value={store.state.graph?.project.name ?? ""}
                ref={(el) =>
                  queueMicrotask(() => {
                    el.focus();
                    el.select();
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    (e.currentTarget as HTMLInputElement).value =
                      store.state.graph?.project.name ?? "";
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                onBlur={(e) => {
                  const next = e.currentTarget.value.trim();
                  const prev = store.state.graph?.project.name ?? "";
                  if (next && next !== prev) store.setProjectName(next);
                  setProjRenaming(false);
                }}
              />
            </Show>
            <Show when={store.state.graph?.project.entityName}>
              <span class="bg-muted text-neutral-500 text-xs py-0.5 px-1.5 rounded truncate max-w-32 shrink-0">
                {store.state.graph!.project.entityName}
              </span>
            </Show>
            <Show when={current()}>
              {(d) => (
                <>
                  <span class="text-neutral-300">/</span>
                  <Show
                    when={!navRenaming()}
                    fallback={
                      <input
                        class="text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded px-1 py-0.5 outline-none select-text min-w-0"
                        value={d().name}
                        ref={(el) =>
                          queueMicrotask(() => {
                            el.focus();
                            el.select();
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            (e.currentTarget as HTMLInputElement).blur();
                          if (e.key === "Escape") {
                            (e.currentTarget as HTMLInputElement).value =
                              d().name;
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                        onBlur={(e) => {
                          setNavRenaming(false);
                          const name = e.currentTarget.value.trim();
                          if (name && name !== d().name)
                            renameDeliverableU(d().id, d().name, name);
                        }}
                      />
                    }
                  >
                    <span
                      class="text-neutral-700 truncate"
                      title={
                        canEdit()
                          ? `${d().name} — double-click to rename`
                          : d().name
                      }
                      onDblClick={() => {
                        if (canEdit()) setNavRenaming(true);
                      }}
                    >
                      {d().name}
                    </span>
                  </Show>
                  <span
                    class={`text-[10px] rounded-full px-1.5 py-px ${STATUS_META[d().status].chip}`}
                  >
                    {STATUS_META[d().status].label}
                  </span>
                </>
              )}
            </Show>
          </div>

          <div class="flex items-center gap-6 relative">
            {/* action group — these open a panel or menu in place */}
            <button
              class="flex items-center p-1.5 rounded cursor-pointer text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50"
              title="Search (/)"
              onClick={() => setSearchOpen(true)}
            >
              <Icon icon="iconoir:search" width="15" />
            </button>
            {/* Tasks — always available; project tasks by default, the focused
                deliverable's tasks when one is open. Opens the right sidebar. */}
            <Show when={store.state.graph?.viewer.role !== "guest"}>
              <button
                class="flex items-center gap-1 p-1.5 rounded cursor-pointer relative"
                classList={{
                  "bg-neutral-200/70 text-neutral-800": tasksOpen(),
                  "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50":
                    !tasksOpen(),
                }}
                title="Tasks"
                onClick={() => openPanel("tasks")}
              >
                <Icon icon="iconoir:task-list" width="15" />
                <Show when={panelTasks().some((t) => t.status !== "done")}>
                  <span class="text-[10px]">
                    {panelTasks().filter((t) => t.status !== "done").length}
                  </span>
                </Show>
              </button>
            </Show>
            {/* Library — this project's assets. Opens the right sidebar. */}
            <button
              class="flex items-center p-1.5 rounded cursor-pointer"
              classList={{
                "bg-neutral-200/70 text-neutral-800": libraryOpen(),
                "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50":
                  !libraryOpen(),
              }}
              title="Library"
              onClick={() => openPanel("library")}
            >
              <Icon icon="iconoir:media-image-folder" width="15" />
            </button>
            <button
              class="flex items-center p-1.5 rounded cursor-pointer"
              classList={{
                "bg-neutral-200/70 text-neutral-800": historyOpen(),
                "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50":
                  !historyOpen(),
              }}
              title="Project history (H)"
              onClick={() => openPanel("history")}
            >
              <Icon icon="iconoir:clock" width="15" />
            </button>
            <Show when={store.state.graph?.viewer.role !== "guest"}>
              <AiTrigger />
            </Show>
            <Show when={current()} fallback={null}>
              {(d) => (
                <>
                  {/* Full review action list — the touch path (no right-click). */}
                  <button
                    class="flex items-center p-1.5 rounded text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50 cursor-pointer"
                    title="Deliverable actions"
                    onClick={(e) => openMenuAt(e, reviewMenuEntries(d()))}
                  >
                    <Icon icon="iconoir:more-horiz" width="15" />
                  </button>
                  {/* version tabs */}
                  <div class="flex items-center gap-0.5 bg-muted rounded p-0.5">
                    <For each={d().versions}>
                      {(v) => (
                        <button
                          class="text-[11px] px-1.5 py-0.5 rounded cursor-pointer"
                          classList={{
                            "bg-panel shadow-sm text-neutral-800":
                              currentVersion()?.id === v.id,
                            "text-neutral-500 hover:text-neutral-800":
                              currentVersion()?.id !== v.id,
                          }}
                          title={`Version ${v.number} (${v.number}) — right-click for actions`}
                          onClick={() => selectVersion(v)}
                          onContextMenu={(e) =>
                            onVersionTabContextMenu(e, d(), v)
                          }
                        >
                          v{v.number}
                        </button>
                      )}
                    </For>
                    <Show when={canUpload()}>
                      <button
                        class="text-[11px] px-1 py-0.5 rounded text-neutral-500 hover:text-neutral-800 cursor-pointer"
                        title="Upload new version (U)"
                        onClick={() => openFilePicker(d())}
                      >
                        <Icon icon="iconoir:plus" width="12" />
                      </button>
                    </Show>
                  </div>

                  <Show when={d().versions.length > 1}>
                    <button
                      class="flex items-center gap-1 text-xs rounded border px-2.5 py-1.5 cursor-pointer"
                      classList={{
                        "bg-accent-sky border-accent-sky-line text-on-accent-sky":
                          compare(),
                        "border-neutral-200 text-neutral-600 hover:bg-neutral-50":
                          !compare(),
                      }}
                      title="Compare versions side by side (C)"
                      onClick={toggleCompare}
                    >
                      <Icon icon="iconoir:media-image-list" width="13" />{" "}
                      Compare
                    </button>
                  </Show>

                  <Show when={currentVersion()}>
                    {v => (
                      <button
                        class="flex items-center gap-1 text-xs rounded border border-neutral-200 text-neutral-600 hover:bg-neutral-50 px-2.5 py-1.5 cursor-pointer"
                        title={`Download v${v().number}`}
                        onClick={() => downloadFile(v().fileName, downloadFileName(d(), v()))}
                      >
                        <Icon icon="iconoir:download" width="13" /> Download
                      </button>
                    )}
                  </Show>

                  <button
                    class="flex items-center gap-1 text-xs border border-accent-amber-line bg-accent-amber text-on-accent-amber rounded px-2.5 py-1.5 hover:bg-accent-amber-hover cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={!currentVersion()}
                    onClick={() => setPendingDecision("revision_requested")}
                  >
                    <Icon icon="iconoir:refresh" width="13" /> Request revisions
                  </button>
                  <button
                    class="flex items-center gap-1 text-xs bg-emerald-600 text-white rounded px-2.5 py-1.5 hover:bg-emerald-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={!currentVersion() || openThreadCount() > 0}
                    title={
                      openThreadCount() > 0
                        ? `${openThreadCount()} open thread(s) must be resolved first`
                        : "Approve this version"
                    }
                    onClick={() => setPendingDecision("approved")}
                  >
                    <Icon icon="iconoir:check" width="13" /> Approve
                  </button>

                  {/* decision popover */}
                  <Show when={pendingDecision()}>
                    <div class="absolute top-full right-0 mt-2 w-72 bg-panel border border-neutral-200 rounded-lg shadow-xl p-3 z-30">
                      <p class="text-xs font-semibold text-neutral-800 mb-2">
                        {pendingDecision() === "approved"
                          ? "Approve"
                          : "Request revisions on"}{" "}
                        {d().name} v{currentVersion()?.number}
                      </p>
                      <textarea
                        id="decision-note"
                        rows="2"
                        class="w-full text-xs border border-neutral-200 rounded px-2 py-1.5 mb-2 outline-none focus:border-sky-400 resize-none"
                        placeholder="Note (optional)"
                        ref={(el) => queueMicrotask(() => el.focus())}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void confirmDecision(
                              (
                                e.currentTarget as HTMLTextAreaElement
                              ).value.trim(),
                            );
                          }
                          if (e.key === "Escape") setPendingDecision(null);
                        }}
                      />
                      <div class="flex gap-2 justify-end">
                        <button
                          class="text-xs text-neutral-500 hover:text-neutral-700 px-2 py-1 cursor-pointer"
                          onClick={() => setPendingDecision(null)}
                        >
                          Cancel
                        </button>
                        <button
                          class="text-xs text-white rounded px-2.5 py-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          classList={{
                            "bg-emerald-600 hover:bg-emerald-500":
                              pendingDecision() === "approved",
                            "bg-amber-600 hover:bg-amber-500":
                              pendingDecision() === "revision_requested",
                          }}
                          onClick={() =>
                            void confirmDecision(
                              (
                                document.getElementById(
                                  "decision-note",
                                ) as HTMLTextAreaElement
                              )?.value.trim() ?? "",
                            )
                          }
                        >
                          Confirm
                        </button>
                      </div>
                    </div>
                  </Show>
                </>
              )}
            </Show>

            {/* the mode's context-menu actions, discoverable without right-click */}
            <button
              class="flex items-center p-1.5 rounded cursor-pointer text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50"
              title="More actions"
              onClick={(e) => {
                const d = current();
                openMenuAt(
                  e,
                  d ? reviewMenuEntries(d) : workspaceMenuEntries(),
                );
              }}
            >
              <Icon icon="iconoir:more-horiz" width="15" />
            </button>
          </div>
        </nav>

        {/* ---- main ---- */}
        <div class="relative flex-1 flex min-h-0">
          <div
            ref={container}
            class="relative flex-1 overflow-hidden bg-canvas select-none"
            style={{ "touch-action": "none" }}
            classList={{
              "cursor-copy": noteTool() && !spaceHeld(),
              "cursor-grabbing": panning(),
              "cursor-grab": spaceHeld() && !panning(),
              "cursor-default": !noteTool() && !spaceHeld() && !panning(),
            }}
            onPointerDown={onPointerDown}
            onDblClick={onDblClick}
            onWheel={onWheel}
            onContextMenu={onCanvasContextMenu}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            <DotGrid camera={camera} />

            {/* world overlay. translate3d keeps the transform on the compositor
                fast path; will-change promotes it to its own layer during a
                gesture so Chrome moves the layer instead of re-rasterizing every
                card, and pointer-events:none stops hover shadows from churning
                as cards slide under a stationary cursor. Both drop when idle so
                there's no standing layer cost. */}
            <div
              class="absolute top-0 left-0"
              style={{
                transform: `scale(${camera.cam.zoom}) translate3d(${-camera.cam.x}px, ${-camera.cam.y}px, 0)`,
                "transform-origin": "0 0",
                "will-change": interacting() ? "transform" : "auto",
                "pointer-events": interacting() ? "none" : "auto",
              }}
            >
              <Show
                when={current()}
                fallback={
                  <>
                    {/* group outlines — painted under the cards; label sits on the stroke.
                        Keyed on the stable store.groups() records (not a freshly-mapped
                        array) so a drag's position updates re-render only the rect inside
                        each item, never tear down/recreate the label DOM node mid-drag. */}
                    <For each={store.groups()}>
                      {(g) => {
                        const rect = createMemo(() => groupOutlineRect(g.id));
                        return (
                          <Show when={rect()}>
                            {(r) => (
                              <div
                                class="absolute rounded-lg pointer-events-none"
                                classList={{
                                  "border-violet-400":
                                    !selectedGroups().has(g.id) &&
                                    hoverGroupId() !== g.id,
                                  "border-violet-600 bg-accent-violet/30":
                                    selectedGroups().has(g.id) &&
                                    hoverGroupId() !== g.id,
                                  "border-emerald-500 bg-accent-emerald/30":
                                    hoverGroupId() === g.id,
                                }}
                                style={{
                                  left: `${r().x}px`,
                                  top: `${r().y}px`,
                                  width: `${r().w}px`,
                                  height: `${r().h}px`,
                                  "border-width": `${1.5 / camera.cam.zoom}px`,
                                  "border-style": "solid",
                                }}
                              >
                                <Show
                                  when={renamingGroupId() !== g.id}
                                  fallback={
                                    <input
                                      class="absolute left-2 top-0 text-[11px] font-medium rounded px-1.5 py-0.5 bg-panel border border-violet-300 outline-none whitespace-nowrap pointer-events-auto select-text"
                                      style={{
                                        transform: `scale(${1 / camera.cam.zoom}) translateY(-50%)`,
                                        "transform-origin": "0 50%",
                                        width: `${Math.max(80, g.label.length * 7)}px`,
                                      }}
                                      value={g.label}
                                      ref={(el) =>
                                        queueMicrotask(() => {
                                          el.focus();
                                          el.select();
                                        })
                                      }
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === "Enter")
                                          (
                                            e.currentTarget as HTMLInputElement
                                          ).blur();
                                        if (e.key === "Escape") {
                                          (
                                            e.currentTarget as HTMLInputElement
                                          ).value = g.label;
                                          (
                                            e.currentTarget as HTMLInputElement
                                          ).blur();
                                        }
                                      }}
                                      onBlur={(e) => {
                                        setRenamingGroupId(null);
                                        const name =
                                          e.currentTarget.value.trim();
                                        if (name && name !== g.label)
                                          renameGroupU(g.id, g.label, name);
                                      }}
                                    />
                                  }
                                >
                                  {/* label + add button as one anchored, counter-
                                      scaled cluster: stays constant screen size,
                                      single row, and the two never overlap no
                                      matter the group size or zoom. */}
                                  <div
                                    class="absolute left-2 top-0 flex items-center gap-1 whitespace-nowrap pointer-events-none"
                                    style={{
                                      transform: `scale(${1 / camera.cam.zoom}) translateY(-50%)`,
                                      "transform-origin": "0 50%",
                                    }}
                                  >
                                    <button
                                      class="inline-flex items-center gap-1 text-[11px] font-medium rounded px-1.5 py-0.5 cursor-pointer pointer-events-auto"
                                      classList={{
                                        "bg-accent-violet text-on-accent-violet hover:bg-accent-violet-hover":
                                          !selectedGroups().has(g.id),
                                        "bg-violet-600 text-white":
                                          selectedGroups().has(g.id),
                                      }}
                                      title={`${g.label} — drag to move, double-click to rename`}
                                      onMouseEnter={() =>
                                        setHovered({ kind: "group", name: g.label })
                                      }
                                      onMouseLeave={() => setHovered(null)}
                                      onPointerDown={(e) =>
                                        onGroupLabelPointerDown(e, g.id)
                                      }
                                      onDblClick={(e) => {
                                        e.stopPropagation();
                                        if (canEdit()) setRenamingGroupId(g.id);
                                      }}
                                      onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const entries = groupMenuEntries(g);
                                        if (entries.length)
                                          setCtxMenu({ x: e.clientX, y: e.clientY, entries });
                                      }}
                                    >
                                      <Icon icon="iconoir:link" width="10" />
                                      {g.label}
                                    </button>
                                    <Show when={canEdit()}>
                                      <button
                                        class="inline-flex items-center justify-center rounded bg-accent-violet text-on-accent-violet hover:bg-accent-violet-hover cursor-pointer pointer-events-auto px-1 py-0.5"
                                        title="Add a deliverable to this group"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          createDeliverableInGroup(g.id);
                                        }}
                                      >
                                        <Icon icon="iconoir:plus" width="11" />
                                      </button>
                                      <button
                                        class="inline-flex items-center justify-center rounded bg-accent-violet text-on-accent-violet hover:bg-accent-violet-hover cursor-pointer pointer-events-auto px-1 py-0.5"
                                        title="Group actions"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openMenuAt(e, groupMenuEntries(g));
                                        }}
                                      >
                                        <Icon icon="iconoir:more-horiz" width="11" />
                                      </button>
                                    </Show>
                                  </div>
                                </Show>
                                {/* Manual group resizing removed — group bounds are
                                    always derived from member cards, so there's no
                                    frame to drag and nothing to fight auto-arrange. */}
                              </div>
                            )}
                          </Show>
                        );
                      }}
                    </For>
                    <For each={store.deliverables()}>
                      {(d) => {
                        const pos = createMemo(() =>
                          posOf("deliverable", d.id, d.posX, d.posY),
                        );
                        return (
                          <DeliverableCard
                            d={d}
                            x={pos().x}
                            y={pos().y}
                            stage={stageOf(d)}
                            readOnly={!canEdit()}
                            selected={selected().has(d.id)}
                            active={activeId() === d.id}
                            onSelect={(dl, o) =>
                              o.additive
                                ? extendSelection(dl.id)
                                : highlightCard(dl.id)
                            }
                            onToggleSelect={(dl) => extendSelection(dl.id)}
                            onOpen={enterReview}
                            onMove={handleCardMove}
                            onRename={(dl, name) =>
                              renameDeliverableU(dl.id, dl.name, name)
                            }
                            onDelete={
                              canDeleteDeliverable()
                                ? confirmDeleteDeliverable
                                : undefined
                            }
                            onMenu={(dl, x, y) =>
                              setCtxMenu({
                                x,
                                y,
                                entries: deliverableMenuEntries(dl),
                              })
                            }
                            registerActions={(id, actions) =>
                              cardActions.set(id, actions)
                            }
                            screenToWorldDelta={(dx, dy) => ({
                              x: dx / camera.cam.zoom,
                              y: dy / camera.cam.zoom,
                            })}
                            onHover={(h) =>
                              setHovered(h ? { kind: "deliverable", name: d.name } : null)
                            }
                          />
                        );
                      }}
                    </For>
                    {/* sticky notes — board-only working notes */}
                    <For each={store.canvasObjects()}>
                      {(o) => {
                        const pos = createMemo(() =>
                          posOf("note", o.id, o.posX, o.posY),
                        );
                        return (
                          <StickyNote
                            o={o}
                            x={pos().x}
                            y={pos().y}
                            readOnly={!store.can("canvasObject", "update")}
                            autoEdit={newNoteId() === o.id}
                            onMove={handleNoteMove}
                            onEdit={(note, content) =>
                              store.updateNote(note.id, { content })
                            }
                            onMenu={(note, x, y) =>
                              setCtxMenu({
                                x,
                                y,
                                entries: noteMenuEntries(note),
                              })
                            }
                            screenToWorldDelta={(dx, dy) => ({
                              x: dx / camera.cam.zoom,
                              y: dy / camera.cam.zoom,
                            })}
                          />
                        );
                      }}
                    </For>
                    {/* active snap guides — feedback for what a drag is snapping to */}
                    <For each={snapGuides()}>
                      {(g) => (
                        <div
                          class="absolute bg-sky-500 pointer-events-none"
                          style={
                            g.axis === "x"
                              ? {
                                  left: `${g.coord}px`,
                                  top: `${g.from}px`,
                                  width: `${1 / camera.cam.zoom}px`,
                                  height: `${g.to - g.from}px`,
                                }
                              : {
                                  left: `${g.from}px`,
                                  top: `${g.coord}px`,
                                  width: `${g.to - g.from}px`,
                                  height: `${1 / camera.cam.zoom}px`,
                                }
                          }
                        />
                      )}
                    </For>
                  </>
                }
              >
                {(d) => (
                  <>
                    {/* comparison row: every version, current highlighted */}
                    <Show when={compareLayout()}>
                      {(cl) => (
                        <For each={cl()}>
                          {(item) => (
                            <>
                              <div
                                class="absolute pointer-events-none"
                                style={{
                                  left: `${item.rect.x}px`,
                                  top: `${item.rect.y}px`,
                                }}
                              >
                                <span
                                  class="inline-block text-[12px] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap"
                                  classList={{
                                    "bg-sky-500 text-white": item.current,
                                    "bg-neutral-200 text-neutral-600":
                                      !item.current,
                                  }}
                                  style={{
                                    transform: `scale(${1 / camera.cam.zoom}) translateY(-135%)`,
                                    "transform-origin": "0 0",
                                  }}
                                >
                                  v{item.v.number}
                                  {item.current ? " · current" : ""}
                                </span>
                              </div>
                              <Show when={!item.current}>
                                <img
                                  src={fileUrl(item.v.fileName)}
                                  alt={`Version ${item.v.number}`}
                                  class="absolute max-w-none bg-panel shadow-[var(--shadow-plane)] cursor-pointer"
                                  draggable={false}
                                  style={{
                                    left: `${item.rect.x}px`,
                                    top: `${item.rect.y}px`,
                                    width: `${item.rect.w}px`,
                                    height: `${item.rect.h}px`,
                                  }}
                                  title={`Switch to v${item.v.number}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    selectVersion(item.v);
                                  }}
                                />
                              </Show>
                            </>
                          )}
                        </For>
                      )}
                    </Show>
                    <ReviewPlane
                      d={d()}
                      version={currentVersion()}
                      rect={plane()!}
                      zoom={camera.cam.zoom}
                      annotations={versionAnnotations()}
                      selectedId={selectedAnnId()}
                      onSelectPin={(id) => selectAnnotation(id)}
                      canUpload={canUpload()}
                      highlight={compare()}
                    />
                  </>
                )}
              </Show>
            </div>

            {/* marquee-select box — drawn in screen space, not world space */}
            <Show when={marquee()}>
              {(m) => (
                <div
                  class="absolute border border-sky-500 bg-sky-500/10 pointer-events-none z-10"
                  style={{
                    left: `${Math.min(m().x0, m().x1)}px`,
                    top: `${Math.min(m().y0, m().y1)}px`,
                    width: `${Math.abs(m().x1 - m().x0)}px`,
                    height: `${Math.abs(m().y1 - m().y0)}px`,
                  }}
                />
              )}
            </Show>

            {/* empty state */}
            <Show
              when={
                store.state.loaded &&
                !reviewId() &&
                store.deliverables().length === 0
              }
            >
              <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div class="text-center text-neutral-400 max-w-sm px-4">
                  <Icon icon="iconoir:media-image-list" width="40" />
                  <p class="mt-3 text-sm font-medium text-neutral-500">
                    No deliverables yet
                  </p>
                  <p class="mt-1 text-xs">
                    <Show
                      when={canCreate()}
                      fallback={<>Nothing has been shared for review yet</>}
                    >
                      Press{" "}
                      <kbd class="px-1 bg-neutral-100 rounded border border-neutral-200">
                        N
                      </kbd>
                      , double-click the canvas, or drop images anywhere
                    </Show>
                  </p>
                  {/* lopsided state: tasks exist but there's nothing to review yet.
                      Stop pointer events from reaching the canvas — otherwise its
                      onPointerDown captures the pointer and swallows the buttons' clicks. */}
                  <Show when={tasks().length > 0}>
                    <div
                      class="mt-4 pointer-events-auto text-left"
                      onPointerDown={(e) => e.stopPropagation()}
                      onDblClick={(e) => e.stopPropagation()}
                      onWheel={(e) => e.stopPropagation()}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <Callout
                        tone="warn"
                        icon="iconoir:task-list"
                        actions={
                          <>
                            <Show when={canCreate()}>
                              <button
                                class="text-[11px] text-on-brand bg-brand hover:bg-brand-hover rounded px-2 py-1 cursor-pointer"
                                onClick={() => newDeliverableAtCenter()}
                              >
                                Create deliverable
                              </button>
                            </Show>
                            <button
                              class="text-[11px] text-on-accent-amber hover:bg-accent-amber-hover rounded px-2 py-1 cursor-pointer"
                              onClick={() => openPanel("tasks")}
                            >
                              View tasks
                            </button>
                          </>
                        }
                      >
                        {tasks().length} task{tasks().length === 1 ? "" : "s"}{" "}
                        tracked here, but no deliverables yet.
                      </Callout>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>

            <Show when={store.state.error}>
              <div class="absolute inset-0 flex items-center justify-center">
                <p class="text-sm text-neutral-500">{store.state.error}</p>
              </div>
            </Show>

            {/* floating Add — the single entry point for creating a new asset or
                a sticky note; hovers over the canvas so creation isn't split
                between the navbar and the board toolbar */}
            <Show when={!reviewId() && (canCreate() || canNote())}>
              <div
                class="absolute top-3 left-3 z-10"
                onPointerDown={(e) => e.stopPropagation()}
                onDblClick={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <NavMenu
                  anchor="bottom"
                  align="left"
                  panelClass="w-44"
                  trigger={({ toggle }) => (
                    <button
                      class="flex items-center gap-1 text-xs bg-brand text-on-brand rounded px-2.5 py-1.5 hover:bg-neutral-700 cursor-pointer shadow-sm"
                      title="Add"
                      onClick={toggle}
                    >
                      <Icon icon="iconoir:plus" width="14" /> Add
                    </button>
                  )}
                >
                  {({ close }) => (
                    <div class="p-1.5">
                      <Show when={canCreate()}>
                        <button
                          class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                          onClick={() => {
                            close();
                            newDeliverableAtCenter();
                          }}
                        >
                          <Icon
                            icon="iconoir:media-image"
                            width="14"
                            class="shrink-0 text-neutral-500"
                          />
                          <span class="flex-1">New asset</span>
                          <kbd class="text-[9px] font-semibold text-neutral-400 bg-neutral-100 border border-neutral-200 rounded px-1 py-px">
                            N
                          </kbd>
                        </button>
                      </Show>
                      <Show when={canCreate()}>
                        <button
                          class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                          onClick={() => {
                            close();
                            newGroupAtCenter();
                          }}
                        >
                          <Icon
                            icon="iconoir:folder"
                            width="14"
                            class="shrink-0 text-neutral-500"
                          />
                          <span class="flex-1">New group</span>
                          <kbd class="text-[9px] font-semibold text-neutral-400 bg-neutral-100 border border-neutral-200 rounded px-1 py-px">
                            G
                          </kbd>
                        </button>
                      </Show>
                      <Show when={canNote()}>
                        <button
                          class="rounded-md w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                          onClick={() => {
                            close();
                            setNoteTool(true);
                            flash("Sticky note: click the canvas to place");
                          }}
                        >
                          <Icon
                            icon="iconoir:notes"
                            width="14"
                            class="shrink-0 text-neutral-500"
                          />
                          <span class="flex-1">Sticky note</span>
                          <kbd class="text-[9px] font-semibold text-neutral-400 bg-neutral-100 border border-neutral-200 rounded px-1 py-px">
                            S
                          </kbd>
                        </button>
                      </Show>
                    </div>
                  )}
                </NavMenu>
              </div>
            </Show>

            {/* board tools — a light toolbar for placeable canvas objects + layout actions */}
            <Show
              when={!reviewId() && canEdit() && store.deliverables().length > 0}
            >
              <div
                class="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center rounded-lg border border-neutral-200 bg-panel/95 shadow-sm overflow-clip divide-x divide-neutral-100"
                onPointerDown={(e) => e.stopPropagation()}
                onDblClick={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <button
                  class="p-1.5 cursor-pointer text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50"
                  title="Auto-arrange — grid-pack deliverables, groups stay clustered"
                  onClick={autoArrange}
                >
                  <Icon icon="iconoir:view-grid" width="14" />
                </button>
              </div>
            </Show>

            {/* navigation controls — the visible face of scroll-zoom and F */}
            <Show when={!locked()}>
              <div
                class="absolute bottom-3 right-3 z-10 flex flex-col rounded-lg border border-neutral-200 bg-panel/95 shadow-sm overflow-clip"
                onPointerDown={(e) => e.stopPropagation()}
                onDblClick={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <button
                  class="p-1.5 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 cursor-pointer"
                  title="Zoom in"
                  onClick={() => zoomAtCenter(1.25)}
                >
                  <Icon icon="iconoir:plus" width="14" />
                </button>
                <button
                  class="p-1.5 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 cursor-pointer border-t border-neutral-100"
                  title="Zoom out"
                  onClick={() => zoomAtCenter(0.8)}
                >
                  <Icon icon="iconoir:minus" width="14" />
                </button>
                <button
                  class="p-1.5 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 cursor-pointer border-t border-neutral-100"
                  title="Fit to screen (F)"
                  onClick={fitCurrent}
                >
                  <Icon icon="iconoir:frame" width="14" />
                </button>
                <Show when={!reviewId()}>
                  <button
                    class="p-1.5 cursor-pointer border-t border-neutral-100"
                    classList={{
                      "text-on-accent-sky bg-accent-sky hover:bg-accent-sky-hover":
                        snapObjects(),
                      "text-neutral-400 hover:text-neutral-800 hover:bg-neutral-50":
                        !snapObjects(),
                    }}
                    title={
                      snapObjects()
                        ? "Snap to deliverables: on"
                        : "Snap to deliverables: off"
                    }
                    onClick={toggleSnapObjects}
                  >
                    <Icon icon="iconoir:magnet" width="14" />
                  </button>
                  <button
                    class="p-1.5 cursor-pointer border-t border-neutral-100"
                    classList={{
                      "text-on-accent-sky bg-accent-sky hover:bg-accent-sky-hover":
                        snapGrid(),
                      "text-neutral-400 hover:text-neutral-800 hover:bg-neutral-50":
                        !snapGrid(),
                    }}
                    title={
                      snapGrid() ? "Snap to grid: on" : "Snap to grid: off"
                    }
                    onClick={toggleSnapGrid}
                  >
                    <Icon icon="iconoir:orthogonal-view" width="14" />
                  </button>
                  <button
                    class="flex items-center gap-1 px-2 py-1.5 cursor-pointer border-t border-neutral-100 text-[10px] font-medium"
                    classList={{
                      "text-on-accent-violet bg-accent-violet hover:bg-accent-violet-hover":
                        layoutMode() === "personal",
                      "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50":
                        layoutMode() === "sync",
                    }}
                    title={
                      layoutMode() === "sync"
                        ? "Sync layout — shared positions everyone sees. Click to switch to your personal layout."
                        : "Personal layout — only you see this arrangement. Click to switch back to sync."
                    }
                    onClick={toggleLayoutMode}
                  >
                    <Icon
                      icon={
                        layoutMode() === "sync"
                          ? "iconoir:group"
                          : "iconoir:user"
                      }
                      width="13"
                    />
                    {layoutMode() === "sync" ? "Sync" : "Personal"}
                  </button>
                </Show>
              </div>
            </Show>
          </div>

          <Show
            when={historyOpen()}
            fallback={
              <Show
                when={notesOpen()}
                fallback={
                  <Show
                    when={tasksOpen()}
                    fallback={
                      <Show
                        when={libraryOpen()}
                        fallback={
                          <Show
                            when={metadataOpen()}
                            fallback={
                          <Show when={current() && sidebarOpen()}>
                            <ThreadSidebar
                              annotations={versionAnnotations()}
                              selectedId={selectedAnnId()}
                              onSelect={selectAnnotation}
                              onComment={(annId, body) =>
                                store.addComment(current()!.id, annId, body)
                              }
                              onResolve={(annId, status) =>
                                store.resolveAnnotation(
                                  current()!.id,
                                  annId,
                                  status,
                                )
                              }
                              onCreateTask={
                                canTask() ? createTaskFromComment : undefined
                              }
                            />
                          </Show>
                            }
                          >
                            <MetadataPanel
                              deliverable={focusedDeliverable()}
                              readOnly={!canEdit()}
                              onSave={(id, m) => store.setDeliverableMetadata(id, m)}
                              onClose={() => setMetadataOpen(false)}
                            />
                          </Show>
                        }
                      >
                        <LibraryPanel
                          files={projectFiles() ?? []}
                          loading={projectFiles.loading}
                          projectId={store.projectId}
                          onClose={() => setLibraryOpen(false)}
                          onOpenMirror={(pid, did) =>
                            navigate(`/p/${pid}/d/${did}`)
                          }
                        />
                      </Show>
                    }
                  >
                    <DeliverableTasksPanel
                      tasks={panelTasks()}
                      projectScope={!current()}
                      canManage={store.can("task", "create")}
                      onClose={() => setTasksOpen(false)}
                      onAdd={addPanelTask}
                      onSetStatus={setDeliverableTaskStatus}
                    />
                  </Show>
                }
              >
                <NotesPanel
                  notes={store.canvasObjects()}
                  canDelete={store.can("canvasObject", "delete")}
                  onClose={() => setNotesOpen(false)}
                  onJumpTo={jumpToNote}
                  onDelete={deleteNoteFromPanel}
                />
              </Show>
            }
          >
            <HistoryPanel
              projectId={store.projectId}
              canRestore={canDeleteVersion() || canDeleteDeliverable()}
              onClose={() => setHistoryOpen(false)}
              onRestored={() => void store.reload()}
            />
          </Show>
        </div>

        {/* ---- status bar (shared AppFooter: user menu + logo + slots) ---- */}
        <AppFooter
          start={
            <>
              <button
                class="flex items-center gap-1 shrink-0 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/50 rounded px-1.5 py-1 cursor-pointer"
                title="Project info (I)"
                onClick={() => setInfoOpen(true)}
              >
                <Icon icon="iconoir:info-circle" width="13" />
              </button>
              <span class="w-px h-3.5 bg-neutral-200 shrink-0" />

              <Show
                when={focusedDeliverable()}
                fallback={
                  <Show
                    when={hovered()}
                    fallback={
                  <div class="flex items-center gap-1.5 min-w-0 overflow-hidden">
                    <button
                      class="shrink-0 font-medium text-neutral-600 hover:text-neutral-900 cursor-pointer"
                      title="Show all deliverables"
                      onClick={() =>
                        openDeliverableList("All deliverables", store.deliverables())
                      }
                    >
                      {counts().total} deliverable
                      {counts().total === 1 ? "" : "s"}
                    </button>
                    <Show when={counts().inReview > 0}>
                      <button
                        class="shrink-0 hidden sm:flex items-center gap-1 text-[10px] font-medium rounded-full px-1.5 py-px bg-accent-sky text-on-accent-sky hover:brightness-95 cursor-pointer"
                        title="Show deliverables in review"
                        onClick={() =>
                          openDeliverableList(
                            "In review",
                            store.deliverables().filter(d => d.status === "in_review"),
                          )
                        }
                      >
                        <span class="size-1.5 rounded-full bg-sky-500" />
                        {counts().inReview} in review
                      </button>
                    </Show>
                    <Show when={counts().revisions > 0}>
                      <button
                        class="shrink-0 hidden sm:flex items-center gap-1 text-[10px] font-medium rounded-full px-1.5 py-px bg-accent-amber text-on-accent-amber hover:brightness-95 cursor-pointer"
                        title="Show deliverables needing revisions"
                        onClick={() =>
                          openDeliverableList(
                            "Need revisions",
                            store.deliverables().filter(d => d.status === "revisions_requested"),
                          )
                        }
                      >
                        <span class="size-1.5 rounded-full bg-amber-500" />
                        {counts().revisions} need revisions
                      </button>
                    </Show>
                    <Show when={counts().approved > 0}>
                      <button
                        class="shrink-0 hidden sm:flex items-center gap-1 text-[10px] font-medium rounded-full px-1.5 py-px bg-accent-emerald text-on-accent-emerald hover:brightness-95 cursor-pointer"
                        title="Show approved deliverables"
                        onClick={() =>
                          openDeliverableList(
                            "Approved",
                            store.deliverables().filter(d => d.status === "approved"),
                          )
                        }
                      >
                        <span class="size-1.5 rounded-full bg-emerald-500" />
                        {counts().approved} approved
                      </button>
                    </Show>
                  </div>
                    }
                  >
                    {(h) => (
                      <div class="flex items-center gap-1.5 min-w-0 overflow-hidden">
                        <Icon
                          icon={h().kind === "group" ? "iconoir:link" : "iconoir:media-image"}
                          width="12"
                          class="shrink-0 text-neutral-400"
                        />
                        <span class="shrink-0 font-medium text-neutral-700 truncate max-w-52">
                          {h().name}
                        </span>
                        <span class="shrink-0 text-neutral-400">{h().kind}</span>
                      </div>
                    )}
                  </Show>
                }
              >
                {(d) => (
                  <div class="flex items-center gap-1.5 min-w-0 overflow-hidden">
                    <span class="shrink-0 font-medium text-neutral-700 truncate max-w-40">
                      {d().name}
                    </span>
                    <span
                      class={`shrink-0 text-[10px] font-medium rounded-full px-1.5 py-px ${STATUS_META[d().status].chip}`}
                    >
                      {STATUS_META[d().status].label}
                    </span>
                    <Show when={focusedVersion()}>
                      {(v) => (
                        <span class="shrink-0 hidden sm:flex items-center gap-1.5">
                          <span class="text-[10px] font-medium text-neutral-600 bg-neutral-200/70 rounded px-1 py-px">
                            v{v().number}
                          </span>
                          <span class="text-neutral-400">
                            {v().width}×{v().height}
                          </span>
                        </span>
                      )}
                    </Show>
                    <span
                      class="shrink-0 hidden sm:flex items-center gap-1 text-[10px] font-medium rounded-full px-1.5 py-px"
                      classList={{
                        "bg-accent-orange text-on-accent-orange":
                          focusedOpenThreadCount() > 0,
                        "bg-neutral-200/60 text-neutral-500":
                          focusedOpenThreadCount() === 0,
                      }}
                    >
                      {focusedOpenThreadCount()} open thread
                      {focusedOpenThreadCount() === 1 ? "" : "s"}
                    </span>
                  </div>
                )}
              </Show>

              <Show when={statusMsg()}>
                <span class="shrink-0 text-[10px] font-medium text-on-accent-sky bg-accent-sky rounded-full px-2 py-0.5 truncate">
                  {statusMsg()}
                </span>
              </Show>
            </>
          }
        >
          <div class="hidden sm:flex items-center gap-2.5 text-neutral-400 shrink-0">
            <For each={hints()}>
              {(h) => (
                <span class="flex items-center gap-1 whitespace-nowrap">
                  <Show when={h.key}>
                    <kbd class="text-[9px] font-semibold text-neutral-500 bg-panel border border-neutral-200 rounded px-1 py-px">
                      {h.key}
                    </kbd>
                  </Show>
                  {h.label}
                </span>
              )}
            </For>
          </div>
        </AppFooter>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          if (pickerTarget && files.length) void uploadTo(pickerTarget, files);
          pickerTarget = null;
        }}
      />

      <ContextMenu state={ctxMenu()} onClose={() => setCtxMenu(null)} />

      <Show when={!current() && selected().size > 0}>
        <div class="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center justify-center gap-1.5 max-w-[95vw] bg-brand text-on-brand rounded-lg shadow-2xl px-3 py-2 text-xs">
          <Show
            when={!groupPromptOpen()}
            fallback={
              <input
                class="text-xs text-neutral-900 bg-panel rounded px-2 py-1 outline-none w-40"
                placeholder="Group label…"
                ref={(el) => queueMicrotask(() => el.focus())}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    (e.currentTarget as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    // clear first so the blur this triggers can't still submit it
                    (e.currentTarget as HTMLInputElement).value = "";
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                onBlur={(e) => void submitGroup(e.currentTarget.value)}
              />
            }
          >
            <span class="px-2 font-medium">
              {selectedGroups().size > 0 && selectionIsWholeGroups()
                ? `${selectedGroups().size} group${selectedGroups().size === 1 ? "" : "s"} selected`
                : `${selected().size} selected`}
            </span>
            <Show when={canEdit() && groupButtonAction()}>
              <button
                class="flex items-center gap-1 px-2 py-1 rounded hover:bg-panel/10 cursor-pointer"
                onClick={() => setGroupPromptOpen(true)}
              >
                <Icon icon="iconoir:link" width="13" />{" "}
                {groupButtonAction() === "nest"
                  ? "Nest"
                  : createParentGroupId()
                    ? "Sub-group"
                    : "Group"}
              </button>
            </Show>
            <Show when={canEdit() && addToExistingGroupAction()}>
              {(action) => (
                <button
                  class="flex items-center gap-1 px-2 py-1 rounded hover:bg-panel/10 cursor-pointer"
                  onClick={() => addSelectedToGroup(action())}
                >
                  <Icon icon="iconoir:link" width="13" /> Add to “
                  {action().label}”
                </button>
              )}
            </Show>
            <Show
              when={
                canEdit() &&
                selectedGroups().size === 1 &&
                selectionIsWholeGroups()
              }
            >
              <button
                class="flex items-center gap-1 px-2 py-1 rounded hover:bg-panel/10 cursor-pointer"
                onClick={ungroupSelected}
              >
                <Icon icon="iconoir:link-slash" width="13" /> Ungroup
              </button>
            </Show>
            <Show when={downloadableSelection().length > 0}>
              <button
                class="flex items-center gap-1 px-2 py-1 rounded hover:bg-panel/10 cursor-pointer"
                title="Download selected deliverables"
                onClick={() => void downloadZip(downloadableSelection())}
              >
                <Icon icon="iconoir:download" width="13" /> Download
              </button>
            </Show>
            <Show when={selectionMoreEntries().length > 0}>
              <button
                class="flex items-center gap-1 px-2 py-1 rounded hover:bg-panel/10 cursor-pointer"
                title="More actions"
                onClick={(e) => openMenuAt(e, selectionMoreEntries())}
              >
                <Icon icon="iconoir:more-horiz" width="13" /> More
              </button>
            </Show>
            <Show when={canDeleteDeliverable()}>
              <button
                class="flex items-center gap-1 px-2 py-1 rounded text-on-brand-danger hover:bg-panel/10 cursor-pointer"
                onClick={bulkDeleteDeliverables}
              >
                <Icon icon="iconoir:trash" width="13" /> Delete
              </button>
            </Show>
            <button
              class="p-1 rounded hover:bg-panel/10 cursor-pointer"
              title="Clear selection"
              onClick={clearSelection}
            >
              <Icon icon="iconoir:xmark" width="13" />
            </button>
          </Show>
        </div>
      </Show>

      <Show when={store.state.graph}>
        {(graph) => (
          <ProjectInfoModal
            open={infoOpen()}
            onClose={() => setInfoOpen(false)}
            project={graph().project}
            deliverables={store.deliverables()}
            current={focusedDeliverable()}
            selectedGroup={selectedGroupInfo()}
            deliverableList={listFocus() ?? undefined}
            onOpenDeliverable={d => {
              setInfoOpen(false);
              jumpToDeliverable(d);
            }}
            currentVersion={focusedVersion()}
            openThreadCount={focusedOpenThreadCount()}
            reviewing={!!current()}
            onOpenHistory={() => setHistoryOpen(true)}
            allTags={orgTags() ?? []}
            canTagDeliverable={canEdit()}
            onSetDeliverableTags={(d, tags) =>
              store.setDeliverableTags(d.id, tags)
            }
            onCreateTag={makeTag}
          />
        )}
      </Show>

      <CommandPalette
        open={paletteOpen()}
        onClose={() => setPaletteOpen(false)}
        store={store}
        currentDeliverable={current()}
        actions={{
          newDeliverable: newDeliverableAtCenter,
          openDeliverable: (d) =>
            reviewId()
              ? navigate(`/p/${store.projectId}/d/${d.id}`)
              : enterReview(d),
          upload: () => {
            const d = current();
            if (d) openFilePicker(d);
          },
          approve: () => current() && setPendingDecision("approved"),
          requestRevisions: () =>
            current() && setPendingDecision("revision_requested"),
          exitReview,
          fit: () => (current() ? fitPlane(true, 250) : fitWorkspace(true)),
          compare: toggleCompare,
          history: () => openPanel("history"),
          info: () => setInfoOpen((o) => !o),
          deleteVersion: confirmDeleteVersion,
          deleteDeliverable: () => {
            const d = current();
            if (d) confirmDeleteDeliverable(d);
          },
          search: () => setSearchOpen(true),
        }}
      />

      <GlobalSearch
        variant="modal"
        modalOpen={searchOpen()}
        onModalClose={() => setSearchOpen(false)}
        orgId={() => store.state.graph?.project.organizationId ?? null}
        projectContext={() =>
          store.state.graph
            ? { id: store.projectId, name: store.state.graph.project.name }
            : null
        }
      />
    </div>
  );
}
