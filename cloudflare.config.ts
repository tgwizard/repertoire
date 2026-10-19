import { defineConfig } from "cf/config";

// Static site: the app plus the prebuilt index in public/data (see crawler/).
export default defineConfig({
  worker: {
    name: "repertoire",
    compatibilityDate: "2026-10-01",
    // Custom domain: Cloudflare manages the DNS record and certificate.
    domains: ["repertoire.tgwizard.com"],
    workersDev: false,
    observability: {
      enabled: true,
    },
    assets: {
      notFoundHandling: "single-page-application",
    },
  },
});
