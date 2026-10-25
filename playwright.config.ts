import { defineConfig, devices } from "@playwright/test";

// End-to-end tests in a real browser (your installed Chrome).
//
//   npm run test:e2e                                             against a local dev server on local D1
//   E2E_URL=https://repertoire.tgwizard.com npm run test:e2e     against a deployed site
const remote = process.env.E2E_URL;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: remote ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: remote ?? "http://localhost:5199",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1360, height: 900 } }, testIgnore: /mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" }, testMatch: /mobile/ },
  ],
  webServer: remote
    ? undefined
    : { command: "npx vite --port 5199 --strictPort", url: "http://localhost:5199/api/meta", reuseExistingServer: true, timeout: 60_000 },
});
