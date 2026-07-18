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

  let raf: number | null = null;

  function stop() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
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
    stop();
    setCam({ x: cam.x - dxScreen / cam.zoom, y: cam.y - dyScreen / cam.zoom });
  }

  function zoomAt(sx: number, sy: number, factor: number, min = 0.1, max = 64) {
    stop();
    const world = screenToWorld(sx, sy);
    const zoom = Math.max(min, Math.min(cam.zoom * factor, max));
    // keep the pointer over the same world point
    setCam({ zoom, x: world.x - sx / zoom, y: world.y - sy / zoom });
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
    stop();
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
          raf = requestAnimationFrame(tick);
        } else {
          raf = null;
          resolve();
        }
      };
      raf = requestAnimationFrame(tick);
    });
  }

  return { cam, setCam, panBy, zoomAt, fitRect, flyTo, jumpTo, stop, screenToWorld, worldToScreen };
}

export type Camera = ReturnType<typeof createCamera>;
