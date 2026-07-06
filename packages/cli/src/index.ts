#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppDefinition } from "@framekit/core";
import { PostgresMigrationStore, createPostgresMigrationSql } from "@framekit/db";
import { createExecutableMigrationArtifact, createRuntime, type MigrationPlan, type MigrationRecord } from "@framekit/runtime";
import { generateSdkTypes } from "@framekit/sdk";

export async function runCli(argv = process.argv.slice(2), io: { stdout?: Pick<NodeJS.WriteStream, "write">; log?: (message: string) => void } = {}): Promise<void> {
  const [command, name, ...args] = argv;
  const stdout = io.stdout ?? process.stdout;
  const log = io.log ?? console.log;
  if (!command || command === "help") {
    printHelp(log);
    return;
  }
  if (!name) {
    throw new Error(`Missing name for command "${command}"`);
  }
  if (command === "new-module") {
    await newModule(name, log);
    return;
  }
  if (command === "new-doctype") {
    await newDocType(name, log);
    return;
  }
  if (command === "create-app") {
    await createApp(name, log);
    return;
  }
  if (command === "generate-sdk") {
    await generateSdk(name, args, stdout, log);
    return;
  }
  if (command === "generate-migration") {
    await generateMigration(name, args, stdout, log);
    return;
  }
  if (command === "apply-migration" || command === "replay-migration") {
    await applyMigration(name, args, log);
    return;
  }
  if (command === "rollback-migration") {
    await rollbackMigration(name, args, log);
    return;
  }
  throw new Error(`Unknown command "${command}"`);
}

async function newModule(rawName: string, log: (message: string) => void): Promise<void> {
  const id = slug(rawName);
  const directory = join(process.cwd(), "modules", id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "index.ts"),
    `import { defineModule } from "@framekit/core";\n\nexport const ${camel(id)}Module = defineModule({\n  id: "${id}",\n  name: "${title(id)}",\n  doctypes: []\n});\n`
  );
  log(`Created module ${id}`);
}

async function newDocType(rawName: string, log: (message: string) => void): Promise<void> {
  const id = slug(rawName);
  const directory = join(process.cwd(), "modules", "custom");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${id}.ts`),
    `import { defineDocType } from "@framekit/core";\n\nexport const ${camel(id)}DocType = defineDocType({\n  name: "${id.replaceAll("-", "_")}",\n  label: "${title(id)}",\n  fields: [\n    { name: "title", label: "Title", type: "text", required: true, inList: true }\n  ]\n});\n`
  );
  log(`Created DocType ${id}`);
}

async function createApp(rawName: string, log: (message: string) => void): Promise<void> {
  const id = slug(rawName);
  await mkdir(join(id, "routes"), { recursive: true });
  await mkdir(join(id, "src"), { recursive: true });
  await writeFile(
    join(id, "package.json"),
    JSON.stringify(
      {
        name: id,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          build: "nitro build",
          dev: "nitro dev --host 0.0.0.0",
          preview: "node .output/server/index.mjs",
          typecheck: "tsc -p tsconfig.json --noEmit"
        },
        dependencies: {
          "@framekit/core": "workspace:*",
          "@framekit/nitro": "workspace:*",
          "@framekit/runtime": "workspace:*",
          nitro: "^3.0.260610-beta"
        }
      },
      null,
      2
    ) + "\n"
  );
  await writeFile(join(id, "tsconfig.json"), `{\n  "extends": "../tsconfig.base.json",\n  "include": ["**/*.ts"]\n}\n`);
  await writeFile(
    join(id, "nitro.config.ts"),
    `import { defineNitroConfig } from "nitro/config";\n\nexport default defineNitroConfig({\n  compatibilityDate: "2026-07-02",\n  preset: process.env.NITRO_PRESET,\n  serverDir: "."\n});\n`
  );
  await writeFile(
    join(id, "routes", "[...].ts"),
    `import { createNitroHandler } from "@framekit/nitro";\nimport { runtime } from "../src/app.js";\n\nexport default createNitroHandler(runtime);\n`
  );
  await writeFile(
    join(id, "src", "app.ts"),
    `import { defineApp, defineDocType, defineModule } from "@framekit/core";\nimport { createRuntime } from "@framekit/runtime";\n\nconst note = defineDocType({\n  name: "note",\n  label: "Note",\n  naming: { prefix: "NOTE", series: true, digits: 5 },\n  fields: [\n    { name: "title", label: "Title", type: "text", required: true, inList: true },\n    { name: "body", label: "Body", type: "long_text" }\n  ],\n  permissions: [\n    { action: "create", permissions: ["notes.write"] },\n    { action: "read", permissions: ["notes.read"] },\n    { action: "update", permissions: ["notes.write"] }\n  ]\n});\n\nconst notes = defineModule({\n  id: "notes",\n  name: "Notes",\n  doctypes: [note],\n  permissions: ["notes.read", "notes.write"],\n  navigation: [{ label: "Notes", path: "/doctype/note", order: 10 }]\n});\n\nexport const app = defineApp({ name: "${title(id)}", modules: [notes] });\nexport const runtime = createRuntime(app);\n`
  );
  await writeFile(join(id, ".env.example"), "PORT=3000\nNITRO_PRESET=node-server\n");
  await writeFile(
    join(id, "Dockerfile"),
    `FROM node:24-alpine AS deps\nWORKDIR /app\nCOPY . .\nRUN corepack enable && corepack prepare pnpm@11.9.0 --activate && pnpm install --frozen-lockfile=false\n\nFROM deps AS build\nRUN pnpm build\n\nFROM node:24-alpine AS runner\nWORKDIR /app\nENV NODE_ENV=production\nCOPY --from=build /app/.output ./.output\nEXPOSE 3000\nCMD ["node", ".output/server/index.mjs"]\n`
  );
  log(`Created Framekit app ${id}`);
}

async function generateSdk(modulePath: string, args: string[], stdout: Pick<NodeJS.WriteStream, "write">, log: (message: string) => void): Promise<void> {
  const app = await loadApp(modulePath);
  const output = generateSdkTypes(app);
  const outIndex = args.indexOf("--out");
  if (outIndex >= 0) {
    const outFile = args[outIndex + 1];
    if (!outFile) {
      throw new Error("Missing file after --out");
    }
    await writeFile(outFile, output);
    log(`Generated SDK types ${outFile}`);
    return;
  }
  stdout.write(output);
}

async function generateMigration(currentModulePath: string, args: string[], stdout: Pick<NodeJS.WriteStream, "write">, log: (message: string) => void): Promise<void> {
  const nextModulePath = args[0];
  if (!nextModulePath || nextModulePath.startsWith("--")) {
    throw new Error("Missing next app module path for generate-migration");
  }
  const current = await loadApp(currentModulePath);
  const next = await loadApp(nextModulePath);
  const runtime = createRuntime(current);
  const plan = await runtime.planMigration({ tenantId: "default", userId: "migration", roles: ["administrator"], permissions: ["*"] }, next);
  const format = optionValue(args, "--format") ?? "ts";
  const output = migrationOutput(plan, format);
  const outIndex = args.indexOf("--out");
  if (outIndex >= 0) {
    const outFile = args[outIndex + 1];
    if (!outFile) {
      throw new Error("Missing file after --out");
    }
    await writeFile(outFile, output);
    log(`Generated migration ${outFile}`);
    return;
  }
  stdout.write(output);
}

async function applyMigration(migrationPath: string, args: string[], log: (message: string) => void): Promise<void> {
  const migration = await loadMigration(migrationPath);
  const databaseUrl = optionValue(args, "--database-url") ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing --database-url or DATABASE_URL for apply-migration");
  }
  const store = new PostgresMigrationStore({ connectionString: databaseUrl });
  await store.migrate();
  await store.applyPlan(tenantFromMigration(migration), migration, { allowDestructive: args.includes("--allow-destructive") });
  log(`Applied migration ${migration.id}`);
}

async function rollbackMigration(migrationPath: string, args: string[], log: (message: string) => void): Promise<void> {
  const migration = await loadMigration(migrationPath);
  const databaseUrl = optionValue(args, "--database-url") ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing --database-url or DATABASE_URL for rollback-migration");
  }
  const record: MigrationRecord = {
    ...migration,
    appliedAt: "appliedAt" in migration && typeof migration.appliedAt === "string" ? migration.appliedAt : new Date().toISOString()
  };
  const store = new PostgresMigrationStore({ connectionString: databaseUrl });
  await store.migrate();
  await store.rollback(tenantFromMigration(record), record, { allowDestructive: args.includes("--allow-destructive"), id: optionValue(args, "--id") });
  log(`Rolled back migration ${record.id}`);
}

async function loadApp(modulePath: string): Promise<AppDefinition> {
  const imported = await import(pathToImportSpecifier(modulePath));
  const app = imported.app ?? imported.default;
  if (!app || typeof app !== "object") {
    throw new Error(`No app export found in ${modulePath}`);
  }
  return app as AppDefinition;
}

async function loadMigration(modulePath: string): Promise<MigrationPlan | MigrationRecord> {
  if (modulePath.endsWith(".json")) {
    return JSON.parse(await readFile(modulePath, "utf8")) as MigrationPlan | MigrationRecord;
  }
  const imported = await import(pathToImportSpecifier(modulePath));
  const migration = imported.migration ?? imported.default;
  if (!migration || typeof migration !== "object") {
    throw new Error(`No migration export found in ${modulePath}`);
  }
  return migration as MigrationPlan | MigrationRecord;
}

function migrationOutput(plan: MigrationPlan, format: string): string {
  if (format === "json") {
    return `${JSON.stringify(createExecutableMigrationArtifact(plan), null, 2)}\n`;
  }
  if (format === "sql") {
    return createPostgresMigrationSql(plan);
  }
  if (format !== "ts") {
    throw new Error(`Unknown migration format "${format}"`);
  }
  return `// Generated by framekit generate-migration\nexport const migration = ${JSON.stringify(createExecutableMigrationArtifact(plan), null, 2)} as const;\n`;
}

function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value after ${option}`);
  }
  return value;
}

function tenantFromMigration(migration: MigrationPlan): { tenantId: string; userId: string; roles: string[]; permissions: string[] } {
  return { tenantId: migration.tenantId, userId: "migration", roles: ["administrator"], permissions: ["*"] };
}

function printHelp(log: (message: string) => void): void {
  log(`framekit commands:\n  create-app <name>\n  new-module <name>\n  new-doctype <name>\n  generate-sdk <module-path> [--out file]\n  generate-migration <current-module-path> <next-module-path> [--format ts|json|sql] [--out file]\n  apply-migration <migration-module-path> [--database-url url] [--allow-destructive]\n  replay-migration <migration-module-path> [--database-url url] [--allow-destructive]\n  rollback-migration <migration-module-path> [--database-url url] [--allow-destructive] [--id id]`);
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}

function camel(value: string): string {
  return value.replaceAll(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()).replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

function title(value: string): string {
  return value.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function pathToImportSpecifier(value: string): string {
  if (value.startsWith("file:")) {
    return value;
  }
  if (value.startsWith(".") || value.startsWith("/") || value.endsWith(".ts") || value.endsWith(".js") || value.includes("/")) {
    return pathToFileURL(isAbsolute(value) ? value : resolve(process.cwd(), value)).href;
  }
  return `./${value}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
