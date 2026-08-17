import { defineConfig, devices } from "@playwright/test";

// baseURL configurable por env (JODETE_URL). Cuando los servers ya están levantados aparte
// (p.ej. design-loop/run-e2e.sh en puertos dedicados), poné JODETE_EXTERNAL_SERVER=1 para
// que Playwright NO intente arrancar su propio dev server.
const baseURL = process.env.JODETE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.JODETE_EXTERNAL_SERVER
    ? undefined
    : {
        command: "JODETE_TEST=1 JODETE_PERMANENCIA_MS=900 JODETE_TURN_TIMEOUT_MS=60000 JODETE_BOT_DELAY_MS=300 pnpm dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
