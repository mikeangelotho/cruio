import { A } from "@solidjs/router";

export default function NotFound() {
  return (
    <main class="h-screen flex flex-col items-center justify-center gap-3 text-neutral-500">
      <h1 class="text-4xl font-semibold text-neutral-300">404</h1>
      <p class="text-sm">This page doesn't exist.</p>
      <A href="/" class="text-sm text-sky-600 hover:underline">
        Back to projects
      </A>
    </main>
  );
}
