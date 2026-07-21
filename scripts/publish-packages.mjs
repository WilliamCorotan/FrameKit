#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publish = process.argv.includes("--publish");
const packages = ["core", "realtime", "auth", "openapi", "runtime", "db", "jobs", "sdk", "nitro", "cli"];
const rootVersion = manifest("package.json").version;
const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;

for (const directory of packages) {
  const packageManifest = manifest(`packages/${directory}/package.json`);
  if (packageManifest.version !== rootVersion) throw new Error(`${packageManifest.name} is not versioned at ${rootVersion}.`);
}
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
if (!changelog.includes(`## ${rootVersion} -`)) throw new Error(`CHANGELOG.md has no ${rootVersion} entry.`);

if (!publish) {
  process.stdout.write(`Would publish ${packages.map((directory) => `@framekit/${directory}@${rootVersion}`).join(", ")}\n`);
  process.exit(0);
}
if (tag !== `v${rootVersion}`) throw new Error(`Publishing requires tag v${rootVersion}; received ${tag ?? "no tag"}.`);
if (!process.env.NODE_AUTH_TOKEN) throw new Error("NODE_AUTH_TOKEN is required to publish.");

for (const directory of packages) {
  execFileSync("pnpm", ["--filter", `@framekit/${directory}`, "publish", "--access", "public", "--provenance", "--no-git-checks"], {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
}

function manifest(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}
