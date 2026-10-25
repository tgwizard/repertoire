import { bindings, defineConfig } from "cf/config";
import dataset from "./dataset.json" with { type: "json" };

// The app (static assets) plus a Worker for the API and server-rendered work and
// composer pages. Each dataset version is its own D1 database; dataset.json names the
// one to serve and is updated by `npm run data:publish` (see crawler/publish.ts).
export default defineConfig(({ mode }) => ({
  worker: {
    name: "repertoire",
    compatibilityDate: "2026-10-01",
    entrypoint: "./worker/index.ts",
    // Custom domain: Cloudflare manages the DNS record and certificate.
    domains: ["repertoire.tgwizard.com"],
    workersDev: false,
    observability: {
      enabled: true,
    },
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api", "/api/*", "/work/*", "/composer/*"],
    },
    env: {
      // `npm run dev:remote` (mode "remote") runs locally against the published database.
      DB: bindings.d1({ name: dataset.d1.name, id: dataset.d1.id, dev: { remote: mode === "remote" } }),
      ASSETS: bindings.assets(),
    },
  },
}));
