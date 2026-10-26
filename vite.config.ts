import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [react(), cloudflare()],
  define: {
    // Part of every cache key (the Worker's, and the app's API requests), so a deploy
    // never serves responses cached for the last one's code.
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
    // The dev server caches nothing: its code changes without a new build id.
    __DEV_SERVER__: JSON.stringify(command === "serve"),
  },
}));
