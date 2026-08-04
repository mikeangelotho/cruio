import { createEffect, onCleanup, onMount } from "solid-js";
import type { Camera } from "./camera";
import { theme } from "../theme";

/**
 * The infinite dot-grid background. Pure rendering — pointer input is handled
 * by the surface that owns the camera.
 *
 * The draw path is on the pan/zoom hot loop, so it reads nothing from the DOM:
 * the dot colour is cached and refreshed only when the theme changes, and the
 * canvas dimensions are cached and refreshed only on resize. A camera change
 * therefore triggers a repaint with zero forced style/layout — just the fill.
 */
export function DotGrid(props: { camera: Camera }) {
  let canvas!: HTMLCanvasElement;
  let ctx!: CanvasRenderingContext2D;

  // Cached, never read from the DOM inside draw().
  let dotColor = "#e2e1e1";
  let cssW = 0;
  let cssH = 0;
  let rafId: number | null = null;

  function readDotColor() {
    dotColor =
      getComputedStyle(document.documentElement).getPropertyValue("--color-dot").trim() ||
      "#e2e1e1";
  }

  function draw() {
    const { cam } = props.camera;
    const width = cssW;
    const height = cssH;

    const spacing = 21;
    const radius = 1.25;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = dotColor;

    // fade the grid out when zoomed far in/out so it never dominates
    const alpha = Math.max(0, Math.min(1, 1.2 - Math.abs(Math.log2(cam.zoom)) * 0.35));
    if (alpha <= 0.02) return;
    ctx.globalAlpha = alpha;

    let screenSpacing = spacing * cam.zoom;
    // collapse to a coarser grid when zoomed out
    while (screenSpacing < 12) screenSpacing *= 4;
    while (screenSpacing > 84) screenSpacing /= 4;

    const startX = -((cam.x * cam.zoom) % screenSpacing);
    const startY = -((cam.y * cam.zoom) % screenSpacing);

    ctx.beginPath();
    for (let x = startX; x < width + screenSpacing; x += screenSpacing) {
      for (let y = startY; y < height + screenSpacing; y += screenSpacing) {
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Coalesce repaints to one per frame. The camera already batches its commits
  // (createCamera), but this keeps the grid correct under any other writer.
  function scheduleDraw() {
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        draw();
      });
    }
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    cssW = canvas.clientWidth;
    cssH = canvas.clientHeight;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    draw();
  }

  onMount(() => {
    ctx = canvas.getContext("2d")!;
    readDotColor();
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    onCleanup(() => observer.disconnect());

    // Theme changes are rare — refresh the cached colour and repaint here so the
    // camera effect never needs getComputedStyle.
    createEffect(() => {
      void theme();
      readDotColor();
      scheduleDraw();
    });

    // The hot path: track only the camera fields, no DOM reads.
    createEffect(() => {
      void props.camera.cam.x;
      void props.camera.cam.y;
      void props.camera.cam.zoom;
      scheduleDraw();
    });

    onCleanup(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    });
  });

  return <canvas ref={canvas} class="absolute inset-0 w-full h-full" />;
}
