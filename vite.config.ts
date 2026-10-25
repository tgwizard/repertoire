import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare()],
  // Part of the Worker's edge cache key, so a deploy never serves pages cached by the last one.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
});
