#!/usr/bin/env node
import { constants, realpathSync } from "node:fs";
import { access, lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AppDefinition } from "@framekit/core";
import { PostgresMigrationStore, createPostgresMigrationSql } from "@framekit/db";
import {
  assertDestructiveMigration,
  assertMigrationIdentity,
  assertSupportedMigration,
  createExecutableMigrationArtifact,
  createRollbackMigrationPlan,
  createRuntime,
  validateMigrationPlan,
  type MigrationPlan,
  type MigrationRecord
} from "@framekit/runtime";
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
    await newModule(name, args, log);
    return;
  }
  if (command === "new-doctype") {
    await newDocType(name, args, log);
    return;
  }
  if (command === "create-app") {
    await createApp(name, args, log);
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

type ScaffoldOptions = {
  dryRun: boolean;
  force: boolean;
};

type ScaffoldFile = {
  path: string;
  content: string;
};

async function newModule(rawName: string, args: string[], log: (message: string) => void): Promise<void> {
  const id = slug(rawName);
  const files = [{
    path: join(process.cwd(), "modules", id, "index.ts"),
    content: `import { defineModule } from "@framekit/core";\n\nexport const ${camel(id)}Module = defineModule({\n  id: "${id}",\n  name: "${title(id)}",\n  doctypes: []\n});\n`
  }];
  await writeScaffold(files, scaffoldOptions(args), log);
  log(`${args.includes("--dry-run") ? "Would create" : "Created"} module ${id}`);
}

async function newDocType(rawName: string, args: string[], log: (message: string) => void): Promise<void> {
  const id = slug(rawName);
  const files = [{
    path: join(process.cwd(), "modules", "custom", `${id}.ts`),
    content: `import { defineDocType } from "@framekit/core";\n\nexport const ${camel(id)}DocType = defineDocType({\n  name: "${id.replaceAll("-", "_")}",\n  label: "${title(id)}",\n  fields: [\n    { name: "title", label: "Title", type: "text", required: true, inList: true }\n  ]\n});\n`
  }];
  await writeScaffold(files, scaffoldOptions(args), log);
  log(`${args.includes("--dry-run") ? "Would create" : "Created"} DocType ${id}`);
}

async function createApp(rawName: string, args: string[], log: (message: string) => void): Promise<void> {
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
    { path: join(id, "src", "app.ts"), content: `import { hashPassword, InMemoryUserStore, PasswordAuthService } from "@framekit/auth";\nimport { defineApp, defineDocType, defineModule } from "@framekit/core";\nimport { assertSecureProductionCredentials } from "@framekit/nitro";\nimport { createRuntime } from "@framekit/runtime";\n\nconst environment = process.env.NODE_ENV ?? "development";\nconst authSecret = process.env.FRAMEKIT_AUTH_SECRET ?? "development-secret-change-me";\nconst bootstrapEmail = process.env.FRAMEKIT_ADMIN_EMAIL ?? "admin@example.com";\nconst bootstrapPassword = process.env.FRAMEKIT_ADMIN_PASSWORD ?? "change-me-before-deploying";\nassertSecureProductionCredentials({\n  environment,\n  authSecret,\n  bootstrap: { email: bootstrapEmail, password: bootstrapPassword }\n});\n\nconst note = defineDocType({\n  name: "note",\n  label: "Note",\n  naming: { prefix: "NOTE", series: true, digits: 5 },\n  fields: [\n    { name: "title", label: "Title", type: "text", required: true, inList: true },\n    { name: "body", label: "Body", type: "long_text" }\n  ],\n  permissions: [\n    { action: "create", permissions: ["notes.write"] },\n    { action: "read", permissions: ["notes.read"] },\n    { action: "update", permissions: ["notes.write"] },\n    { action: "delete", permissions: ["notes.write"] }\n  ]\n});\n\nconst notes = defineModule({\n  id: "notes",\n  name: "Notes",\n  doctypes: [note],\n  permissions: ["notes.read", "notes.write"],\n  navigation: [{ label: "Notes", path: "/doctype/note", order: 10 }]\n});\n\nexport const app = defineApp({ name: "${title(id)}", modules: [notes] });\nexport const runtime = createRuntime(app);\nexport const auth = new PasswordAuthService({\n  secret: authSecret,\n  userStore: new InMemoryUserStore([{\n    tenantId: "default",\n    id: "admin",\n    email: bootstrapEmail,\n    name: "Administrator",\n    passwordHash: await hashPassword(bootstrapPassword),\n    roles: ["administrator"],\n    permissions: ["*"]\n  }])\n});\n` },
    { path: join(id, ".env.example"), content: "NODE_ENV=development\nPORT=3000\nNITRO_PRESET=node-server\nFRAMEKIT_ALLOWED_ORIGINS=http://localhost:5173\nFRAMEKIT_AUTH_SECRET=development-secret-change-me\nFRAMEKIT_ADMIN_EMAIL=admin@example.com\nFRAMEKIT_ADMIN_PASSWORD=change-me-before-deploying\n" },
    { path: join(id, ".env.production.example"), content: "NODE_ENV=production\nPORT=3000\nNITRO_PRESET=node-server\nFRAMEKIT_ALLOWED_ORIGINS=https://app.example.com\nFRAMEKIT_TRUST_PROXY=false\nFRAMEKIT_AUTH_SECRET=\nFRAMEKIT_ADMIN_EMAIL=\nFRAMEKIT_ADMIN_PASSWORD=\n" },
    { path: join(id, "Dockerfile"), content: `FROM node:24-alpine AS deps\nWORKDIR /app\nCOPY . .\nRUN corepack enable && corepack prepare pnpm@11.9.0 --activate && pnpm install --frozen-lockfile=false\n\nFROM deps AS build\nRUN pnpm build\n\nFROM node:24-alpine AS runner\nWORKDIR /app\nENV NODE_ENV=production\nCOPY --from=build /app/.output ./.output\nCOPY --from=build /app/start.mjs ./start.mjs\nEXPOSE 3000\nCMD ["node", "start.mjs"]\n` },
    { path: join(id, "start.mjs"), content: standaloneServerSource },
    { path: join(id, "test", "standalone-smoke.mjs"), content: standaloneSmokeSource }
  ];
  const options = scaffoldOptions(args);
  await writeScaffold(files, options, log);
  log(`${options.dryRun ? "Would create" : "Created"} Framekit server app ${id} with @framekit packages ${version}`);
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

async function rollbackMigration(migrationPath: string, args: string[], log: (message: string) => void): Promise<void> {
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

function migrationOperatorContext(args: string[]): { tenant: { tenantId: string; userId: string; roles: string[]; permissions: string[] }; appName: string } {
  const tenantId = optionValue(args, "--tenant-id") ?? process.env.FRAMEKIT_MIGRATION_TENANT_ID;
  const appName = optionValue(args, "--app-name") ?? process.env.FRAMEKIT_MIGRATION_APP_NAME;
  if (!tenantId || !appName) {
    throw new Error("Migration execution requires --tenant-id and --app-name (or FRAMEKIT_MIGRATION_TENANT_ID and FRAMEKIT_MIGRATION_APP_NAME).");
  }
  return { tenant: { tenantId, userId: "migration", roles: ["administrator"], permissions: ["*"] }, appName };
}

function printHelp(log: (message: string) => void): void {
  log(`framekit commands:\n  create-app <name> [--dry-run] [--force]\n  new-module <name> [--dry-run] [--force]\n  new-doctype <name> [--dry-run] [--force]\n  generate-sdk <module-path> [--out file]\n  generate-migration <current-module-path> <next-module-path> [--format ts|json|sql] [--out file]\n  apply-migration <migration-module-path> --tenant-id id --app-name name [--database-url url] [--allow-destructive]\n  replay-migration <migration-module-path> --tenant-id id --app-name name [--database-url url] [--allow-destructive]\n  rollback-migration <migration-module-path> --tenant-id id --app-name name [--database-url url] [--allow-destructive] [--id id]`);
}

function scaffoldOptions(args: string[]): ScaffoldOptions {
  const unknown = args.filter((arg) => arg !== "--dry-run" && arg !== "--force");
  if (unknown.length > 0) {
    throw new Error(`Unknown scaffold option${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  }
  return { dryRun: args.includes("--dry-run"), force: args.includes("--force") };
}

async function writeScaffold(files: ScaffoldFile[], options: ScaffoldOptions, log: (message: string) => void): Promise<void> {
  const root = realpathSync(process.cwd());
  const existing: string[] = [];
  for (const file of files) {
    await assertSafeScaffoldPath(root, file.path);
    if (await pathExists(file.path)) {
      existing.push(file.path);
    }
  }
  if (existing.length > 0 && !options.force) {
    throw new Error(`Refusing to overwrite existing scaffold files:\n${existing.map((path) => `- ${path}`).join("\n")}\nRe-run with --force to replace only these generated paths.`);
  }
  for (const file of files) {
    const action = existing.includes(file.path) ? "overwrite" : "create";
    if (options.dryRun) {
      log(`Would ${action} ${file.path}`);
      continue;
    }
    await mkdir(dirname(file.path), { recursive: true });
    await assertSafeScaffoldPath(root, file.path);
    const handle = await open(file.path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o666);
    try {
      await handle.writeFile(file.content);
    } finally {
      await handle.close();
    }
  }
}

async function assertSafeScaffoldPath(root: string, candidate: string): Promise<void> {
  const absolute = resolve(candidate);
  if (absolute !== root && !absolute.startsWith(root + sep)) {
    throw new Error(`Refusing scaffold path outside the current directory: ${candidate}`);
  }
  const components = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Refusing scaffold path containing a symbolic link: ${candidate}`);
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function framekitVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error("@framekit/cli package version is not valid semver.");
  }
  return manifest.version;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function slug(value: string): string {
  const result = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  if (!result) {
    throw new Error("Scaffold name must contain at least one letter or number.");
  }
  return result;
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

const standaloneServerSource = `import { createServer } from "node:http";
import { existsSync } from "node:fs";

const entry = new URL("./.output/server/index.mjs", import.meta.url);
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
if (!existsSync(entry)) throw new Error("Build the app before starting it.");

let adapter;
globalThis.__srvxLoader__ = ({ server }) => { adapter = server; };
await import(entry.href);
delete globalThis.__srvxLoader__;
if (!adapter?.fetch) throw new Error("Built Nitro adapter did not initialize.");

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const method = incoming.method ?? "GET";
    const response = await adapter.fetch(new Request(new URL(incoming.url ?? "/", \`http://\${incoming.headers.host ?? host}\`), {
      method,
      headers: incoming.headers,
      body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks)
    }));
    outgoing.statusCode = response.status;
    for (const [name, value] of response.headers) outgoing.setHeader(name, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing.setHeader("set-cookie", cookies);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.statusCode = 500;
    outgoing.end(error instanceof Error ? error.message : "Server bridge failed");
  }
});
await new Promise((resolve) => server.listen(port, host, resolve));
console.log(\`Framekit listening on http://\${host}:\${port}\`);

async function close() {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await adapter.close?.(true);
}
process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
`;

const standaloneSmokeSource = `import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const origin = "http://127.0.0.1:43127";
const child = spawn(process.execPath, ["start.mjs"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: "43127", FRAMEKIT_ALLOWED_ORIGINS: origin },
  stdio: ["ignore", "pipe", "pipe"]
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });
try {
  await waitForHealth();
  const login = await json("/api/auth/login", { method: "POST", headers: { origin }, body: { email: "admin@example.com", password: "change-me-before-deploying" } });
  const headers = { authorization: \`Bearer \${login.token}\` };
  const created = await json("/api/doctypes/note", { method: "POST", headers, body: { title: "Standalone proof", body: "Packed packages work." } });
  const fetched = await json(\`/api/doctypes/note/\${created.id}\`, { headers });
  if (fetched.id !== created.id || fetched.data.title !== "Standalone proof") throw new Error("Standalone get-by-id proof failed.");
  const updated = await json(\`/api/doctypes/note/\${created.id}\`, {
    method: "PATCH",
    headers: { ...headers, "if-match": String(created.revision) },
    body: { title: "Updated standalone proof", body: "Packed packages still work." }
  });
  if (updated.data.title !== "Updated standalone proof" || updated.revision <= created.revision) throw new Error("Standalone update proof failed.");
  const listed = await json("/api/doctypes/note", { headers });
  if (!created.id || !listed.some((record) => record.id === created.id && record.data.title === "Updated standalone proof")) throw new Error("Standalone list proof failed.");
  await json(\`/api/doctypes/note/\${created.id}\`, { method: "DELETE", headers: { ...headers, "if-match": String(updated.revision) } });
  const missing = await request(\`/api/doctypes/note/\${created.id}\`, { headers });
  if (missing.response.status !== 404) throw new Error(\`Standalone delete proof expected 404, received \${missing.response.status}.\`);
  const afterDelete = await json("/api/doctypes/note", { headers });
  if (afterDelete.some((record) => record.id === created.id)) throw new Error("Standalone delete proof left the record in list results.");
  console.log(JSON.stringify({ ok: true, id: created.id }));
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(\`Standalone server exited early: \${stderr}\`);
    try {
      const response = await fetch(origin + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(\`Standalone server did not become healthy: \${stderr}\`);
}

async function json(path, options = {}) {
  const { response, body } = await request(path, options);
  if (!response.ok) throw new Error(\`\${options.method ?? "GET"} \${path} failed (\${response.status}): \${JSON.stringify(body)}\`);
  return body;
}

async function request(path, options = {}) {
  const response = await fetch(origin + path, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json", "x-tenant-id": "default", ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json().catch(() => undefined);
  return { response, body };
}
`;

if (isMainModule()) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
