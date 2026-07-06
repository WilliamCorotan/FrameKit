#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));
const values = new Map();

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) {
    continue;
  }
  const [key, inlineValue] = arg.split("=", 2);
  values.set(key, inlineValue ?? process.argv[index + 1]);
}

const rootPackage = readJson("package.json");
const packages = [
  "auth",
  "cli",
  "core",
  "db",
  "jobs",
  "nitro",
  "openapi",
  "realtime",
  "runtime",
  "sdk"
].map((name) => readJson(`packages/${name}/package.json`));

const version = values.get("--version") ?? rootPackage.version;
const mismatched = packages.filter((pkg) => pkg.version !== version);
if (mismatched.length > 0) {
  throw new Error(`Package versions must match ${version}: ${mismatched.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")}`);
}

const previousRef = values.get("--from") ?? lastTag();
const revisionRange = previousRef ? `${previousRef}..HEAD` : "HEAD";
const commits = git(["log", "--pretty=format:%h %s", revisionRange]).split("\n").filter(Boolean);
const outputPath = values.get("--out") ?? `.release/framekit-v${version}-rc.md`;
const body = [
  `# Framekit v${version} Release Candidate`,
  "",
  `Generated: ${new Date().toISOString()}`,
  `Range: ${previousRef ? revisionRange : "all reachable commits"}`,
  "",
  "## Packages",
  "",
  ...packages.map((pkg) => `- ${pkg.name}@${pkg.version}`),
  "",
  "## Changes",
  "",
  ...(commits.length > 0 ? commits.map((commit) => `- ${commit}`) : ["- No commits found in range."]),
  "",
  "## Verification",
  "",
  "- [ ] pnpm audit:all",
  "- [ ] Built Nitro server smoke, when runtime or server behavior changed",
  "- [ ] Postgres-backed checks, when database behavior changed",
  "- [ ] Redis/BullMQ checks, when job behavior changed",
  "- [ ] Browser verification, when Desk UI behavior changed",
  "",
  "## Publish Plan",
  "",
  "- Confirm package tarballs contain dist artifacts only for package code.",
  "- Publish public packages with npm provenance from CI.",
  "- Promote the candidate after verification passes."
].join("\n");

if (args.has("--check") || args.has("--dry-run")) {
  process.stdout.write(`${body}\n`);
} else {
  mkdirSync(join(root, dirname(outputPath)), { recursive: true });
  writeFileSync(join(root, outputPath), `${body}\n`);
  process.stdout.write(`Wrote ${outputPath}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function lastTag() {
  return git(["describe", "--tags", "--abbrev=0"]);
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
