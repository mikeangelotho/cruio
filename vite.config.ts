import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, loadEnv } from "vite";
import { nitroV2Plugin as nitro } from "@solidjs/vite-plugin-nitro-2";
import { solidStart } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";

// The libsql client loads its native addon (@libsql/<platform>/index.node) via a
// runtime-computed path, so Nitro's dependency tracer (nft) copies the platform
// package's package.json but NOT the .node binary — the built server then throws
// MODULE_NOT_FOUND on first DB access. Copy the binaries in after the build. Uses
// whatever platform package exists in node_modules, so building on the Linux VPS
// copies the linux binary, on Windows the win32 one, etc.
function copyLibsqlNativeBinaries() {
  return async (nitroCtx: { options: { output: { serverDir: string } } }) => {
    const src = join(process.cwd(), "node_modules", "@libsql");
    if (!existsSync(src)) return;
    const destBase = join(nitroCtx.options.output.serverDir, "node_modules", "@libsql");
    for (const pkg of readdirSync(src)) {
      const bin = join(src, pkg, "index.node");
      if (!existsSync(bin)) continue;
      const destDir = join(destBase, pkg);
      mkdirSync(destDir, { recursive: true });
      copyFileSync(bin, join(destDir, "index.node"));
    }
  };
}

export default defineConfig(({ mode }) => {
  // expose .env values (BETTER_AUTH_SECRET, …) to server-side process.env
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return {
    plugins: [
      solidStart(),
      tailwindcss(),
      nitro({ hooks: { compiled: copyLibsqlNativeBinaries() } })
    ],
    server: {
      // Dev-server only (the built node-server ignores this). The Tailscale host
      // the app is reached over in development, plus any extra hostnames from
      // ALLOWED_HOSTS (comma-separated) when tunneling in.
      allowedHosts: [
        "bippy.tail44eee4.ts.net",
        ...(process.env.ALLOWED_HOSTS ?? "")
          .split(",")
          .map(h => h.trim())
          .filter(Boolean),
      ],
      port: Number(process.env.PORT) || 5173
    }
  };
});
