import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.trim()) throw new Error("DATABASE_URL is required for full-stack tests. Run pnpm test:desk:fullstack with GitHub environment configuration or a root .env.");

const deskPort = Number(process.env.FRAMEKIT_DESK_PORT ?? 4174);
const apiPort = Number(process.env.FRAMEKIT_API_PORT ?? 45123);
const deskOrigin = `http://127.0.0.1:${deskPort}`;

export default defineConfig({
  testDir: "./e2e/fullstack",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["dot"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: deskOrigin,
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } }
  ],
  webServer: [
    {
      command: "pnpm --filter @framekit/example-crm serve:built",
      env: {
        DATABASE_URL: databaseUrl,
        FRAMEKIT_TEST_MEMORY_STORAGE: "false",
        FRAMEKIT_ALLOWED_ORIGINS: deskOrigin,
        FRAMEKIT_API_PORT: String(apiPort),
        FRAMEKIT_SETTINGS_ACTIVE_KEY: "playwright",
        FRAMEKIT_SETTINGS_KEYS: '{"playwright":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}',
        HOST: "127.0.0.1",
        NODE_ENV: "test",
        PORT: String(apiPort)
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: `http://127.0.0.1:${apiPort}/health`
    },
    {
      command: `pnpm --filter @framekit/desk exec vite preview --host 127.0.0.1 --port ${deskPort} --strictPort`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: deskOrigin
    }
  ]
});
