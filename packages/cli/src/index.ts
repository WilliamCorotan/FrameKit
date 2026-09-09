#!/usr/bin/env node
import { loadEnvFile } from "node:process";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCli } from "./dispatch.js";

export { runCli } from "./dispatch.js";
export { isValidSemVer } from "./paths.js";

if (isMainModule()) {
  if (!process.env.CI && existsSync(".env")) loadEnvFile(".env");
  runCli().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); } catch { return false; }
}
