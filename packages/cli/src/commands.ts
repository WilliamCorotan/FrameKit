import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppDefinition } from "@framekit/core";
import { PostgresMigrationStore, createPostgresMigrationSql } from "@framekit/db";
import { assertDestructiveMigration, assertMigrationIdentity, assertSupportedMigration, createExecutableMigrationArtifact, createRollbackMigrationPlan, createRuntime, validateMigrationPlan, type MigrationPlan, type MigrationRecord } from "@framekit/runtime";
import { generateSdkTypes } from "@framekit/sdk";
import { camel, framekitVersion, pathToImportSpecifier, scaffoldOptions, slug, title, type ScaffoldFile, writeScaffold } from "./paths.js";
import { installDesk } from "./desk.js";
import { standaloneServerSource, standaloneSmokeSource } from "./templates.js";

export async function newModule(rawName: string, args: string[], log: (message: string) => void): Promise<void> {
  const id = slug(rawName);
  const files = [{
    path: join(process.cwd(), "modules", id, "index.ts"),
    content: `import { defineModule } from "@framekit/core";\n\nexport const ${camel(id)}Module = defineModule({\n  id: "${id}",\n  name: "${title(id)}",\n  doctypes: []\n});\n`
  }];
  await writeScaffold(files, scaffoldOptions(args), log);
  log(`${args.includes("--dry-run") ? "Would create" : "Created"} module ${id}`);
}

export async function newDocType(rawName: string, args: string[], log: (message: string) => void): Promise<void> {
  const id = slug(rawName);
  const files = [{
    path: join(process.cwd(), "modules", "custom", `${id}.ts`),
    content: `import { defineDocType } from "@framekit/core";\n\nexport const ${camel(id)}DocType = defineDocType({\n  name: "${id.replaceAll("-", "_")}",\n  label: "${title(id)}",\n  fields: [\n    { name: "title", label: "Title", type: "text", required: true, inList: true }\n  ]\n});\n`
  }];
  await writeScaffold(files, scaffoldOptions(args), log);
  log(`${args.includes("--dry-run") ? "Would create" : "Created"} DocType ${id}`);
}

export async function createApp(rawName: string, args: string[], log: (message: string) => void): Promise<void> {
  const id = slug(rawName);
  const version = await framekitVersion();
  const files: ScaffoldFile[] = [
    {
      path: join(id, "package.json"),
      content: JSON.stringify(
      {
        name: id,
        version: "0.1.0",
        private: true,
        type: "module",
        packageManager: "pnpm@11.9.0",
        engines: { node: ">=22 <26" },
        scripts: {
          build: "nitro build",
          dev: "nitro dev --host 0.0.0.0",
          preview: "node start.mjs",
          start: "node start.mjs",
          smoke: "node test/standalone-smoke.mjs",
          typecheck: "tsc -p tsconfig.json --noEmit"
        },
        dependencies: {
          "@framekit/auth": `^${version}`,
          "@framekit/core": `^${version}`,
          "@framekit/nitro": `^${version}`,
          "@framekit/runtime": `^${version}`,
          nitro: "^3.0.260610-beta"
        },
        devDependencies: {
          "@types/node": "^24.10.1",
          typescript: "^6.0.3"
        }
      },
      null,
      2
      ) + "\n"
    },
    { path: join(id, "tsconfig.json"), content: `{\n  "compilerOptions": {\n    "target": "ES2023",\n    "lib": ["ES2023", "DOM"],\n    "types": ["node"],\n    "module": "ESNext",\n    "moduleResolution": "Bundler",\n    "allowSyntheticDefaultImports": true,\n    "esModuleInterop": true,\n    "isolatedModules": true,\n    "noEmit": true,\n    "resolveJsonModule": true,\n    "skipLibCheck": true,\n    "strict": true\n  },\n  "include": ["**/*.ts"]\n}\n` },
    { path: join(id, "nitro.config.ts"), content: `import { defineNitroConfig } from "nitro/config";\n\nexport default defineNitroConfig({\n  compatibilityDate: "2026-07-02",\n  preset: process.env.NITRO_PRESET,\n  serverDir: "."\n});\n` },
    { path: join(id, "routes", "[...].ts"), content: `import { createNitroHandler } from "@framekit/nitro";\nimport { auth, runtime } from "../src/app.js";\n\nconst production = process.env.NODE_ENV === "production";\nconst configuredOrigins = process.env.FRAMEKIT_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean);\nconst allowedOrigins = configuredOrigins?.length ? configuredOrigins : production ? [] : ["http://localhost:5173", "http://standalone.local"];\n\nexport default createNitroHandler(runtime, {\n  auth,\n  cors: { origins: allowedOrigins, credentials: true },\n  authCookie: { secure: production, sameSite: "lax" },\n  security: {\n    trustedOrigins: allowedOrigins,\n    trustProxy: process.env.FRAMEKIT_TRUST_PROXY === "true"\n  }\n});\n` },
    { path: join(id, "src", "app.ts"), content: `import { hashPassword, InMemoryUserStore, PasswordAuthService } from "@framekit/auth";\nimport { defineApp, defineDocType, defineModule } from "@framekit/core";\nimport { assertSecureProductionCredentials } from "@framekit/nitro";\nimport { createRuntime } from "@framekit/runtime";\n\nconst environment = process.env.NODE_ENV ?? "development";\nconst authSecret = process.env.FRAMEKIT_AUTH_SECRET ?? "development-secret-change-me";\nconst bootstrapEmail = process.env.FRAMEKIT_ADMIN_EMAIL ?? "admin@example.com";\nconst bootstrapPassword = process.env.FRAMEKIT_ADMIN_PASSWORD ?? "change-me-before-deploying";\nassertSecureProductionCredentials({\n  environment,\n  authSecret,\n  bootstrap: { email: bootstrapEmail, password: bootstrapPassword }\n});\n\nconst note = defineDocType({\n  name: "note",\n  label: "Note",\n  naming: { prefix: "NOTE", series: true, digits: 5 },\n  fields: [\n    { name: "title", label: "Title", type: "text", required: true, inList: true },\n    { name: "body", label: "Body", type: "long_text" }\n  ],\n  permissions: [\n    { action: "create", permissions: ["notes.write"] },\n    { action: "read", permissions: ["notes.read"] },\n    { action: "update", permissions: ["notes.write"] },\n    { action: "delete", permissions: ["notes.write"] }\n  ]\n});\n\nconst notes = defineModule({\n  id: "notes",\n  name: "Notes",\n  doctypes: [note],\n  permissions: ["notes.read", "notes.write"],\n  navigation: [{ label: "Notes", path: "/doctype/note", order: 10 }]\n});\n\nexport const app = defineApp({ name: "${title(id)}", modules: [notes] });\nexport const runtime = createRuntime(app, { deployment: environment === "production" ? "production" : "development" });\nawait runtime.start();\nexport const auth = new PasswordAuthService({\n  secret: authSecret,\n  userStore: new InMemoryUserStore([{\n    tenantId: "default",\n    id: "admin",\n    email: bootstrapEmail,\n    name: "Administrator",\n    passwordHash: await hashPassword(bootstrapPassword),\n    roles: ["administrator"],\n    permissions: ["*"]\n  }])\n});\n` },
    { path: join(id, ".env.example"), content: "NODE_ENV=development\nPORT=3000\nNITRO_PRESET=node-server\nFRAMEKIT_ALLOWED_ORIGINS=http://localhost:5173\nFRAMEKIT_AUTH_SECRET=development-secret-change-me\nFRAMEKIT_ADMIN_EMAIL=admin@example.com\nFRAMEKIT_ADMIN_PASSWORD=change-me-before-deploying\n" },
    { path: join(id, ".env.production.example"), content: "NODE_ENV=production\nPORT=3000\nNITRO_PRESET=node-server\nFRAMEKIT_ALLOWED_ORIGINS=https://app.example.com\nFRAMEKIT_TRUST_PROXY=false\nFRAMEKIT_AUTH_SECRET=\nFRAMEKIT_ADMIN_EMAIL=\nFRAMEKIT_ADMIN_PASSWORD=\n" },
    { path: join(id, "Dockerfile"), content: `FROM node:24-alpine AS deps\nWORKDIR /app\nCOPY . .\nRUN corepack enable && corepack prepare pnpm@11.9.0 --activate && pnpm install --frozen-lockfile=false\n\nFROM deps AS build\nRUN pnpm build\n\nFROM node:24-alpine AS runner\nWORKDIR /app\nENV NODE_ENV=production\nCOPY --from=build /app/.output ./.output\nCOPY --from=build /app/start.mjs ./start.mjs\nEXPOSE 3000\nCMD ["node", "start.mjs"]\n` },
    { path: join(id, "start.mjs"), content: standaloneServerSource },
    { path: join(id, "test", "standalone-smoke.mjs"), content: standaloneSmokeSource }
  ];
  const options = scaffoldOptions(args.filter((arg) => arg !== "--desk"));
  await writeScaffold(files, options, log);
  if (args.includes("--desk")) await installDesk(join(id, "public", "desk"), args.filter((arg) => arg !== "--desk"), log);
  log(`${options.dryRun ? "Would create" : "Created"} Framekit server app ${id} with @framekit packages ${version}`);
}

export async function generateSdk(modulePath: string, args: string[], stdout: Pick<NodeJS.WriteStream, "write">, log: (message: string) => void): Promise<void> {
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

export async function generateMigration(currentModulePath: string, args: string[], stdout: Pick<NodeJS.WriteStream, "write">, log: (message: string) => void): Promise<void> {
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

export async function applyMigration(migrationPath: string, args: string[], log: (message: string) => void): Promise<void> {
  const migration = await loadMigration(migrationPath);
  const operator = migrationOperatorContext(args);
  await validateMigrationPlan(migration);
  assertMigrationIdentity(operator.tenant, operator.appName, migration);
  assertDestructiveMigration(migration, { allowDestructive: args.includes("--allow-destructive") });
  assertSupportedMigration(migration);
  const databaseUrl = optionValue(args, "--database-url") ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing --database-url or DATABASE_URL for apply-migration");
  }
  const store = new PostgresMigrationStore({ connectionString: databaseUrl });
  await store.migrate();
  await store.applyPlan(operator.tenant, migration, { allowDestructive: args.includes("--allow-destructive") });
  log(`Applied migration ${migration.id}`);
}

export async function rollbackMigration(migrationPath: string, args: string[], log: (message: string) => void): Promise<void> {
  const migration = await loadMigration(migrationPath);
  const operator = migrationOperatorContext(args);
  await validateMigrationPlan(migration);
  assertMigrationIdentity(operator.tenant, operator.appName, migration);
  const record: MigrationRecord = {
    ...migration,
    appliedAt: "appliedAt" in migration && typeof migration.appliedAt === "string" ? migration.appliedAt : new Date().toISOString()
  };
  const rollbackPlan = await createRollbackMigrationPlan(record, { id: optionValue(args, "--id"), createdAt: record.appliedAt });
  assertDestructiveMigration(rollbackPlan, { allowDestructive: args.includes("--allow-destructive") });
  assertSupportedMigration(rollbackPlan);
  const databaseUrl = optionValue(args, "--database-url") ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing --database-url or DATABASE_URL for rollback-migration");
  }
  const store = new PostgresMigrationStore({ connectionString: databaseUrl });
  await store.migrate();
  await store.rollback(operator.tenant, record, { allowDestructive: args.includes("--allow-destructive"), id: optionValue(args, "--id") });
  log(`Rolled back migration ${record.id}`);
}

export async function loadApp(modulePath: string): Promise<AppDefinition> {
  const imported = await import(pathToImportSpecifier(modulePath));
  const app = imported.app ?? imported.default;
  if (!app || typeof app !== "object") {
    throw new Error(`No app export found in ${modulePath}`);
  }
  return app as AppDefinition;
}

export async function loadMigration(modulePath: string): Promise<MigrationPlan | MigrationRecord> {
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

export function migrationOutput(plan: MigrationPlan, format: string): string {
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

export function optionValue(args: string[], option: string): string | undefined {
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

export function migrationOperatorContext(args: string[]): { tenant: { tenantId: string; userId: string; roles: string[]; permissions: string[] }; appName: string } {
  const tenantId = optionValue(args, "--tenant-id") ?? process.env.FRAMEKIT_MIGRATION_TENANT_ID;
  const appName = optionValue(args, "--app-name") ?? process.env.FRAMEKIT_MIGRATION_APP_NAME;
  if (!tenantId || !appName) {
    throw new Error("Migration execution requires --tenant-id and --app-name (or FRAMEKIT_MIGRATION_TENANT_ID and FRAMEKIT_MIGRATION_APP_NAME).");
  }
  return { tenant: { tenantId, userId: "migration", roles: ["administrator"], permissions: ["*"] }, appName };
}
