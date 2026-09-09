import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const name of ["DATABASE_URL", "FRAMEKIT_TEST_S3_ENDPOINT"]) {
  if (!process.env[name]) throw new Error(`${name} is required for storage integration verification.`);
}
const result = spawnSync("pnpm", ["exec", "vitest", "run", "packages/storage/src/s3.integration.test.ts"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "inherit", env: process.env
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
