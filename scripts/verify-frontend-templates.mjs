#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const keep = process.argv.includes("--keep");
const temporaryRoot = await mkdtemp(join(tmpdir(), "framekit-frontends-"));
const packs = join(temporaryRoot, "packs");
const frameworks = ["react", "vue", "svelte", "solid", "vanilla"];

try {
  await mkdir(packs, { recursive: true });
  const tarballs = new Map();
  for (const packageName of ["core", "sdk"]) {
    run("pnpm", ["--filter", `@framekit/${packageName}`, "pack", "--pack-destination", packs], root);
    const manifest = JSON.parse(await readFile(join(root, "packages", packageName, "package.json"), "utf8"));
    const prefix = `${manifest.name.replace("@", "").replace("/", "-")}-${manifest.version}`;
    const filename = (await readdir(packs)).find((candidate) => candidate.startsWith(prefix) && candidate.endsWith(".tgz"));
    if (!filename) throw new Error(`No tarball was created for ${manifest.name}.`);
    tarballs.set(manifest.name, join(packs, filename));
  }

  for (const framework of frameworks) {
    const consumer = join(temporaryRoot, framework);
    await cp(join(root, "examples", "frontends", framework), consumer, {
      recursive: true,
      filter: (source) => !["dist", "node_modules"].includes(basename(source))
    });

    const manifestPath = join(consumer, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.dependencies["@framekit/sdk"] = `file:${tarballs.get("@framekit/sdk")}`;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(consumer, "pnpm-workspace.yaml"), [
      "packages: []",
      "",
      "allowBuilds:",
      "  esbuild: true",
      "",
      "overrides:",
      `  '@framekit/core': 'file:${tarballs.get("@framekit/core")}'`,
      ""
    ].join("\n"));

    run("pnpm", ["install", "--no-frozen-lockfile"], consumer);
    run("pnpm", ["typecheck"], consumer);
    run("pnpm", ["build"], consumer);
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    templates: frameworks,
    packages: [...tarballs].map(([name, path]) => `${name}:${basename(path)}`)
  }, null, 2) + "\n");
} finally {
  if (keep) {
    process.stdout.write(`Kept frontend template proof at ${temporaryRoot}\n`);
  } else {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, env: process.env, stdio: "inherit" });
}
