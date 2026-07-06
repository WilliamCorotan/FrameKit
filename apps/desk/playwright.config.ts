import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.FRAMEKIT_DESK_PORT ?? 4173);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["dot"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: `pnpm --filter @framekit/desk exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    env: {
      VITE_FRAMEKIT_API_URL: "http://127.0.0.1:45123"
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: `http://127.0.0.1:${port}`
  }
});
