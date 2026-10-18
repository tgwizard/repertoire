import { defineConfig } from "cf/config";
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "repertoire",
    compatibilityDate: "2026-10-01",
    entrypoint,
    // Custom domain: Cloudflare manages the DNS record and certificate. It's
    // also required for the Cache API, which is a no-op on workers.dev.
    domains: ["repertoire.tgwizard.com"],
    workersDev: false,
    observability: {
      enabled: true,
    },
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
  },
});
