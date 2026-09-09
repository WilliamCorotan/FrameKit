import { defineConfig, devices } from "@playwright/test";

const apiPort = 45066;
const crossOriginPort = 5125;
const templates = [
  ["react", "@framekit/example-frontend-react", 5120],
  ["vue", "@framekit/example-frontend-vue", 5121],
  ["svelte", "@framekit/example-frontend-svelte", 5122],
  ["solid", "@framekit/example-frontend-solid", 5123],
  ["vanilla", "@framekit/example-frontend-vanilla", 5124]
] as const;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "dot" : "list",
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "pnpm --filter @framekit/example-crm... build && pnpm --filter @framekit/example-crm exec node test/serve-built-server.mjs",
      env: {
        NODE_ENV: "test",
        FRAMEKIT_TEST_MEMORY_STORAGE: "true",
        HOST: "127.0.0.1",
        PORT: String(apiPort),
        FRAMEKIT_ALLOWED_ORIGINS: [
          ...templates.map(([, , port]) => `http://127.0.0.1:${port}`),
          `http://127.0.0.1:${crossOriginPort}`
        ].join(",")
      },
      url: `http://127.0.0.1:${apiPort}/health/live`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    },
    ...templates.map(([, packageName, port]) => ({
      command: `pnpm --filter ${packageName} exec vite --host 127.0.0.1 --port ${port} --strictPort`,
      env: { FRAMEKIT_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    })),
    {
      command: `pnpm --filter @framekit/example-frontend-react exec vite --host 127.0.0.1 --port ${crossOriginPort} --strictPort`,
      env: { VITE_FRAMEKIT_API_URL: `http://127.0.0.1:${apiPort}` },
      url: `http://127.0.0.1:${crossOriginPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ]
});

export { crossOriginPort, templates };
