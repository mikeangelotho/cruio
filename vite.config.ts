import { defineConfig } from "vite";
import { nitroV2Plugin as nitro } from "@solidjs/vite-plugin-nitro-2";
import { solidStart } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    solidStart(),
    tailwindcss(),
    nitro()
  ],
  server: {
    allowedHosts: ["bippy.tail44eee4.ts.net"],
    port: Number(process.env.PORT) || 5173
  }
});
