#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageDirectories = ["auth", "cli", "core", "db", "jobs", "nitro", "openapi", "realtime", "runtime", "sdk"];

for (const directory of packageDirectories) {
  const packageRoot = join(root, "packages", directory);
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (manifest.private) throw new Error(`${manifest.name} unexpectedly became private.`);
  if (manifest.engines?.node !== ">=22 <26") throw new Error(`${manifest.name} must declare the supported Node range.`);
  for (const relativePath of [manifest.main, manifest.types, manifest.exports?.["."]?.import, manifest.exports?.["."]?.types, manifest.exports?.["."]?.development?.default]) {
    if (typeof relativePath !== "string") throw new Error(`${manifest.name} has an incomplete root export contract.`);
    await access(join(packageRoot, relativePath));
  }
  execFileSync(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(manifest.name)})`], {
    cwd: packageRoot,
    stdio: "pipe"
  });
  process.stdout.write(`verified ${manifest.name}@${manifest.version}\n`);
}
