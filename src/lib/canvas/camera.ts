import { createStore } from "solid-js/store";

export interface CameraState {
  /** world coordinate at the viewport's top-left */
  x: number;
  y: number;
  zoom: number;
}

export interface CameraTarget extends CameraState {}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function createCamera(initial?: Partial<CameraState>) {
  const [cam, setCam] = createStore<CameraState>({ x: 0, y: 0, zoom: 1, ...initial });

  // Two independent rAF handles. `animRaf` drives flyTo; `inputRaf` drives the
  // per-frame coalescing of pointer/wheel input. Keeping them separate lets a
  // pan cancel an in-flight fly (animRaf) without cancelling its own queued
  // commit, and lets an explicit jump/fly cancel everything.
  let animRaf: number | null = null;
  let inputRaf: number | null = null;

  // Accumulated, uncommitted input for the current frame. panBy/zoomAt fire once
  // per raw event (a trackpad emits many per displayed frame); we sum them here
  // and apply the net result in a single setCam on the next animation frame, so
  // the world transform and the dot grid each repaint at most once per frame.
  const DEFAULT_MIN = 0.1;
  const DEFAULT_MAX = 64;
  let pDx = 0;
  let pDy = 0;
  let pZoom = 1;
  let pAnchorX = 0;
  let pAnchorY = 0;
  let pMin = DEFAULT_MIN;
  let pMax = DEFAULT_MAX;

  function resetPending() {
    pDx = 0;
    pDy = 0;
    pZoom = 1;
    pMin = DEFAULT_MIN;
    pMax = DEFAULT_MAX;
  }

  function cancelAnim() {
    if (animRaf !== null) cancelAnimationFrame(animRaf);
    animRaf = null;
  }

  function cancelInput() {
    if (inputRaf !== null) cancelAnimationFrame(inputRaf);
    inputRaf = null;
    resetPending();
  }

  /** Public: halt any motion (animation or queued input) immediately. */
  function stop() {
    cancelAnim();
    cancelInput();
  }

  function flush() {
    inputRaf = null;
    let { x, y, zoom } = cam;

    // Zoom first, anchored to the pointer, then translate — matches how the two
    // gestures compose when they land in the same frame (rare, but correct).
    if (pZoom !== 1) {
      const worldX = pAnchorX / zoom + x;
      const worldY = pAnchorY / zoom + y;
      zoom = Math.max(pMin, Math.min(zoom * pZoom, pMax));
      x = worldX - pAnchorX / zoom;
      y = worldY - pAnchorY / zoom;
    }
    if (pDx !== 0 || pDy !== 0) {
      x -= pDx / zoom;
      y -= pDy / zoom;
    }

    resetPending();
    setCam({ x, y, zoom });
  }

  function scheduleFlush() {
    if (inputRaf === null) inputRaf = requestAnimationFrame(flush);
  }

  const screenToWorld = (sx: number, sy: number) => ({
    x: sx / cam.zoom + cam.x,
    y: sy / cam.zoom + cam.y,
  });

  const worldToScreen = (wx: number, wy: number) => ({
    x: (wx - cam.x) * cam.zoom,
    y: (wy - cam.y) * cam.zoom,
  });

  function panBy(dxScreen: number, dyScreen: number) {
    cancelAnim(); // the user is driving now — abandon any fly, keep queued input
    pDx += dxScreen;
    pDy += dyScreen;
    scheduleFlush();
  }

  function zoomAt(sx: number, sy: number, factor: number, min = DEFAULT_MIN, max = DEFAULT_MAX) {
    cancelAnim();
    pZoom *= factor;
    pAnchorX = sx; // keep the latest anchor; within one frame it barely moves
    pAnchorY = sy;
    pMin = min;
    pMax = max;
    scheduleFlush();
  }

  /** Camera state that fits `rect` (world coords) in a viewport with padding. */
  function fitRect(rect: Rect, viewportW: number, viewportH: number, padding = 48): CameraTarget {
    const zoom = Math.min(
      (viewportW - padding * 2) / rect.w,
      (viewportH - padding * 2) / rect.h
    );
    return {
      zoom,
      x: rect.x + rect.w / 2 - viewportW / 2 / zoom,
      y: rect.y + rect.h / 2 - viewportH / 2 / zoom,
    };
  }

  function jumpTo(target: CameraTarget) {
    stop(); // explicit move wins over any queued input
    setCam({ ...target });
  }

  function flyTo(target: CameraTarget, duration = 350): Promise<void> {
    stop();
    const from = { x: cam.x, y: cam.y, zoom: cam.zoom };
    if (duration <= 0) {
      setCam({ ...target });
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const e = easeInOutCubic(t);
        // interpolate zoom logarithmically so the motion feels uniform
        const zoom = from.zoom * Math.pow(target.zoom / from.zoom, e);
        setCam({
          zoom,
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e,
        });
        if (t < 1) {
          animRaf = requestAnimationFrame(tick);
        } else {
          animRaf = null;
          resolve();
        }
      };
      animRaf = requestAnimationFrame(tick);
    });
  }

  return { cam, setCam, panBy, zoomAt, fitRect, flyTo, jumpTo, stop, screenToWorld, worldToScreen };
}

export type Camera = ReturnType<typeof createCamera>;
