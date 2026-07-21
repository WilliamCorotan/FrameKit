#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSemVer } from "./semver.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const version = option("--version");
const write = args.includes("--write");
const tag = args.includes("--tag");
const packageDirectories = ["auth", "cli", "core", "db", "jobs", "nitro", "openapi", "realtime", "runtime", "sdk"];

if (!isValidSemVer(version)) {
  throw new Error("Usage: pnpm release:prepare -- --version <semver> [--write] [--tag]");
}
if (tag && !write) throw new Error("--tag requires --write.");
if (write && git(["status", "--porcelain"])) throw new Error("Release preparation requires a clean worktree.");
if (git(["tag", "--list", `v${version}`])) throw new Error(`Tag v${version} already exists.`);

const commits = git(["log", "--pretty=format:- %s", `${lastTag() ? `${lastTag()}..HEAD` : "HEAD"}`]) || "- Initial release";
const date = new Date().toISOString().slice(0, 10);
const changelogEntry = `## ${version} - ${date}\n\n${commits}\n\n`;
const paths = ["package.json", ...packageDirectories.map((directory) => `packages/${directory}/package.json`)];

process.stdout.write(`Framekit release ${version}\n`);
process.stdout.write(`${paths.length} manifests, CHANGELOG.md${tag ? ", commit, and annotated tag" : ""}\n`);
process.stdout.write(changelogEntry);
if (!write) {
  process.stdout.write("Dry run only; pass --write to update files.\n");
  process.exit(0);
}

for (const path of paths) {
  const manifest = JSON.parse(await readFile(join(root, path), "utf8"));
  manifest.version = version;
  await writeFile(join(root, path), `${JSON.stringify(manifest, null, 2)}\n`);
}
const changelogPath = join(root, "CHANGELOG.md");
const changelog = await readFile(changelogPath, "utf8").catch(() => "# Changelog\n\n");
await writeFile(changelogPath, changelog.replace(/^# Changelog\s*/, `# Changelog\n\n${changelogEntry}`));
execFileSync("pnpm", ["install", "--lockfile-only"], { cwd: root, stdio: "inherit" });

if (tag) {
  execFileSync("git", ["add", "package.json", "pnpm-lock.yaml", "CHANGELOG.md", ...packageDirectories.map((directory) => `packages/${directory}/package.json`)], { cwd: root });
  execFileSync("git", ["commit", "-m", `chore(release): v${version}`], { cwd: root, stdio: "inherit" });
  execFileSync("git", ["tag", "-a", `v${version}`, "-m", `Framekit v${version}`], { cwd: root, stdio: "inherit" });
}

function option(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function lastTag() {
  return git(["describe", "--tags", "--abbrev=0"]);
}

function git(command) {
  try {
    return execFileSync("git", command, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
