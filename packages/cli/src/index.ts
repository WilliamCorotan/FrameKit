#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [, , command, name] = process.argv;

async function main(): Promise<void> {
  if (!command || command === "help") {
    printHelp();
    return;
  }
  if (!name) {
    throw new Error(`Missing name for command "${command}"`);
  }
  if (command === "new-module") {
    await newModule(name);
    return;
  }
  if (command === "new-doctype") {
    await newDocType(name);
    return;
  }
  if (command === "create-app") {
    await createApp(name);
    return;
  }
  throw new Error(`Unknown command "${command}"`);
}

async function newModule(rawName: string): Promise<void> {
  const id = slug(rawName);
  const directory = join(process.cwd(), "modules", id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "index.ts"),
    `import { defineModule } from "@framekit/core";\n\nexport const ${camel(id)}Module = defineModule({\n  id: "${id}",\n  name: "${title(id)}",\n  doctypes: []\n});\n`
  );
  console.log(`Created module ${id}`);
}

async function newDocType(rawName: string): Promise<void> {
  const id = slug(rawName);
  const directory = join(process.cwd(), "modules", "custom");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${id}.ts`),
    `import { defineDocType } from "@framekit/core";\n\nexport const ${camel(id)}DocType = defineDocType({\n  name: "${id.replaceAll("-", "_")}",\n  label: "${title(id)}",\n  fields: [\n    { name: "title", label: "Title", type: "text", required: true, inList: true }\n  ]\n});\n`
  );
  console.log(`Created DocType ${id}`);
}

async function createApp(rawName: string): Promise<void> {
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
  console.log(`Created Framekit app ${id}`);
}

function printHelp(): void {
  console.log(`framekit commands:\n  create-app <name>\n  new-module <name>\n  new-doctype <name>`);
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
