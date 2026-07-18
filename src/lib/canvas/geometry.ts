import type { Deliverable, Version } from "../types";
import type { Rect } from "./camera";

export const CARD_W = 240;
export const CARD_HEADER_H = 44;

export function thumbHeight(d: Deliverable): number {
  const v = d.versions[d.versions.length - 1];
  if (!v || !v.width || !v.height) return 140;
  return Math.max(100, Math.min(320, (CARD_W * v.height) / v.width));
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
