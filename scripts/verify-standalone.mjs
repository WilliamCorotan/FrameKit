#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publicPackages } from "./public-packages.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const keep = process.argv.includes("--keep");
const temporaryRoot = await mkdtemp(join(tmpdir(), "framekit-standalone-"));
const packs = join(temporaryRoot, "packs");
const harness = join(temporaryRoot, "harness");

try {
  await mkdir(packs, { recursive: true });
  const tarballs = new Map();
  for (const { directory, name } of publicPackages) {
    run("pnpm", ["--filter", name, "pack", "--pack-destination", packs], root);
    const manifest = JSON.parse(await readFile(join(root, "packages", directory, "package.json"), "utf8"));
    const prefix = `${manifest.name.replace("@", "").replace("/", "-")}-${manifest.version}`;
    const filename = (await readdir(packs)).find((candidate) => candidate.startsWith(prefix) && candidate.endsWith(".tgz"));
    if (!filename) throw new Error(`No tarball was created for ${manifest.name}.`);
    const tarball = join(packs, filename);
    const packedManifest = JSON.parse(execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }));
    if (JSON.stringify(packedManifest).includes("workspace:")) throw new Error(`${manifest.name} tarball retained a workspace dependency.`);
    for (const path of [...new Set([manifest.main, manifest.types, manifest.exports["."].development.default, "./LICENSE"])].map((path) => `package/${path.replace(/^\.\//, "")}`)) {
      execFileSync("tar", ["-tzf", tarball, path], { stdio: "ignore" });
    }
    tarballs.set(manifest.name, tarball);
  }

  await mkdir(harness, { recursive: true });
  await writeFile(join(harness, "package.json"), JSON.stringify({
    name: "framekit-packed-cli-harness",
    private: true,
    packageManager: "pnpm@11.9.0",
    dependencies: { "@framekit/cli": `file:${tarballs.get("@framekit/cli")}` }
  }, null, 2));
  await writeFile(join(harness, "pnpm-workspace.yaml"), overridesYaml(tarballs));
  run("pnpm", ["install", "--no-frozen-lockfile"], harness);
  run("pnpm", ["exec", "framekit", "create-app", "standalone-app", "--desk"], harness);
  const deskRoot = join(harness, "standalone-app", "public", "desk");
  const originalConfig = await readFile(join(deskRoot, "framekit-config.js"), "utf8");
  run("pnpm", ["exec", "framekit", "install-desk", "standalone-app/public/desk", "--force"], harness);
  if (await readFile(join(deskRoot, "framekit-config.js"), "utf8") !== originalConfig) throw new Error("Desk upgrade changed runtime configuration.");
  if (!(await readFile(join(deskRoot, "index.html"), "utf8")).includes("framekit-config.js")) throw new Error("Packed Desk entry is incomplete.");

  const appRoot = join(harness, "standalone-app");
  const appManifestPath = join(appRoot, "package.json");
  const appManifest = JSON.parse(await readFile(appManifestPath, "utf8"));
  for (const name of ["@framekit/auth", "@framekit/core", "@framekit/nitro", "@framekit/runtime"]) {
    if (!/^\^\d+\.\d+\.\d+/.test(appManifest.dependencies[name])) throw new Error(`${name} scaffold dependency is not published semver.`);
    appManifest.dependencies[name] = `file:${tarballs.get(name)}`;
  }
  appManifest.dependencies["@framekit/sdk"] = `file:${tarballs.get("@framekit/sdk")}`;
  await writeFile(appManifestPath, `${JSON.stringify(appManifest, null, 2)}\n`);
  await writeFile(join(appRoot, "pnpm-workspace.yaml"), overridesYaml(tarballs));

  run("pnpm", ["install", "--no-frozen-lockfile"], appRoot);
  run("pnpm", ["typecheck"], appRoot);
  run("pnpm", ["build"], appRoot);
  await writeFile(join(appRoot, "test", "sdk-contract.mjs"), `import { FRAMEKIT_SDK_CONFIG_VERSION, FramekitProtocolError, FramekitResponseError, FramekitValidationError, upgradeFramekitClientConfig } from "@framekit/sdk";
const upgraded = upgradeFramekitClientConfig({ version: 1, baseUrl: "http://localhost" });
if (FRAMEKIT_SDK_CONFIG_VERSION !== 2 || upgraded.config.version !== 2 || upgraded.config.retry !== undefined || typeof FramekitValidationError !== "function" || typeof FramekitResponseError !== "function" || typeof FramekitProtocolError !== "function") {
  throw new Error("Packed SDK error/config exports are incomplete.");
}
`);
  run(process.execPath, ["test/sdk-contract.mjs"], appRoot);
  run("pnpm", ["smoke"], appRoot);
  process.stdout.write(JSON.stringify({
    ok: true,
    packages: [...tarballs].map(([name, path]) => `${name}:${basename(path)}`),
    consumer: appRoot
  }, null, 2) + "\n");
} finally {
  if (keep) {
    process.stdout.write(`Kept standalone proof at ${temporaryRoot}\n`);
  } else {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function overridesYaml(tarballs) {
  return `packages: []\n\nallowBuilds:\n  esbuild: true\n  msgpackr-extract: true\n\noverrides:\n${[...tarballs].map(([name, path]) => `  '${name}': 'file:${path}'`).join("\n")}\n`;
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, env: process.env, stdio: "inherit" });
}
