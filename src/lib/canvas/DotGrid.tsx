import { createEffect, onCleanup, onMount } from "solid-js";
import type { Camera } from "./camera";

/**
 * The infinite dot-grid background. Pure rendering — pointer input is handled
 * by the surface that owns the camera.
 */
export function DotGrid(props: { camera: Camera }) {
  let canvas!: HTMLCanvasElement;
  let ctx!: CanvasRenderingContext2D;

  function draw() {
    const { cam } = props.camera;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    const spacing = 21;
    const radius = 1.25;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#e2e1e1";

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

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    draw();
  }

  onMount(() => {
    ctx = canvas.getContext("2d")!;
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    onCleanup(() => observer.disconnect());

    createEffect(() => {
      // track camera fields
      void props.camera.cam.x;
      void props.camera.cam.y;
      void props.camera.cam.zoom;
      draw();
    });
  });

  return <canvas ref={canvas} class="absolute inset-0 w-full h-full" />;
}
