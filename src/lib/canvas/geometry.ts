import type { Deliverable, Version } from "../types";
import type { Rect } from "./camera";

export const CARD_W = 240;
export const CARD_HEADER_H = 44;

/**
 * Card thumbnail height for a deliverable's latest version. Clamps the
 * *aspect ratio* (not the raw height) so common portrait shots (e.g. a
 * 1080×1920 phone screenshot, ratio 1.78) render uncropped, while an
 * extreme outlier still respects an overall card-size cap.
 */
export function thumbHeight(d: Deliverable): number {
  const v = d.versions[d.versions.length - 1];
  if (!v || !v.width || !v.height) return 140;
  const ratio = Math.max(0.4, Math.min(2.2, v.height / v.width));
  return CARD_W * ratio;
}

/** World-space rect a deliverable card occupies in workspace mode. */
export function cardRect(d: Deliverable): Rect {
  return { x: d.posX, y: d.posY, w: CARD_W, h: thumbHeight(d) + CARD_HEADER_H };
}

/**
 * World-space rect of the review plane for a deliverable: natural image size,
 * centered on the card's center so entering review reads as diving into the card.
 */
export function planeRect(d: Deliverable, v: Version | undefined): Rect {
  const c = cardRect(d);
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const w = v?.width || 1200;
  const h = v?.height || 800;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function boundsOf(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: -400, y: -300, w: 800, h: 600 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Given a desired top-left `(x, y)` for a new card, cascade it diagonally
 * until it no longer overlaps any existing deliverable — so repeatedly
 * spawning cards at the same point (e.g. viewport center) doesn't stack them.
 */
export function findFreeSpot(existing: Deliverable[], x: number, y: number): { x: number; y: number } {
  const w = CARD_W;
  const step = CARD_W + 24;
  for (let i = 0; i < 40; i++) {
    const candidate = { x: x + i * step, y: y + i * step, w, h: 140 + CARD_HEADER_H };
    if (!existing.some(d => rectsOverlap(candidate, cardRect(d)))) {
      return { x: candidate.x, y: candidate.y };
    }
  }
  return { x, y };
}

/** Quantize a world-space point to the nearest grid intersection. */
export function snapToGrid(x: number, y: number, size = 20): { x: number; y: number } {
  return { x: Math.round(x / size) * size, y: Math.round(y / size) * size };
}

/** A line to draw while a neighbor snap is engaged. `axis: "x"` is a vertical
 * line at x=coord spanning y from→to; `axis: "y"` is horizontal at y=coord. */
export interface SnapGuide {
  axis: "x" | "y";
  coord: number;
  from: number;
  to: number;
}

/**
 * Nudges `rect` to align its edges/centers with any nearby rect within
 * `threshold` world px, checking x and y independently. Returns the
 * (possibly adjusted) top-left point plus guide lines for whichever axes
 * actually snapped, so the canvas can show what is being snapped to.
 */
export function snapToNeighbors(
  rect: Rect,
  others: Rect[],
  threshold = 8,
): { x: number; y: number; guides: SnapGuide[] } {
  let x = rect.x;
  let y = rect.y;
  let bestDx = threshold;
  let bestDy = threshold;
  let xMatch: { coord: number; other: Rect } | null = null;
  let yMatch: { coord: number; other: Rect } | null = null;
  const xEdges = [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
  const yEdges = [rect.y, rect.y + rect.h / 2, rect.y + rect.h];
  for (const o of others) {
    const oxEdges = [o.x, o.x + o.w / 2, o.x + o.w];
    const oyEdges = [o.y, o.y + o.h / 2, o.y + o.h];
    for (let i = 0; i < xEdges.length; i++) {
      for (const ox of oxEdges) {
        const d = ox - xEdges[i];
        if (Math.abs(d) < bestDx) {
          bestDx = Math.abs(d);
          x = rect.x + d;
          xMatch = { coord: ox, other: o };
        }
      }
    }
    for (let i = 0; i < yEdges.length; i++) {
      for (const oy of oyEdges) {
        const d = oy - yEdges[i];
        if (Math.abs(d) < bestDy) {
          bestDy = Math.abs(d);
          y = rect.y + d;
          yMatch = { coord: oy, other: o };
        }
      }
    }
  }
  const guides: SnapGuide[] = [];
  if (xMatch) {
    guides.push({
      axis: "x",
      coord: xMatch.coord,
      from: Math.min(y, xMatch.other.y),
      to: Math.max(y + rect.h, xMatch.other.y + xMatch.other.h),
    });
  }
  if (yMatch) {
    guides.push({
      axis: "y",
      coord: yMatch.coord,
      from: Math.min(x, yMatch.other.x),
      to: Math.max(x + rect.w, yMatch.other.x + yMatch.other.w),
    });
  }
  return { x, y, guides };
}
