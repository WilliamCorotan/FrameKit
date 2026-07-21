import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineApp, defineDocType, defineModule } from "@framekit/core";
import { createExecutableMigrationArtifact, createRuntime, migrationChecksum } from "@framekit/runtime";
import { runCli } from "./index.js";

describe("framekit CLI", () => {
  it("creates a standalone server scaffold with published dependencies and a local TypeScript config", async () => {
    await inTemporaryDirectory(async (directory) => {
      await runCli(["create-app", "Standalone Notes"], { log: () => undefined });

      const manifest = JSON.parse(await readFile(join(directory, "standalone-notes/package.json"), "utf8")) as {
        dependencies: Record<string, string>;
      };
      for (const name of ["@framekit/auth", "@framekit/core", "@framekit/nitro", "@framekit/runtime"]) {
        expect(manifest.dependencies[name]).toMatch(/^\^\d+\.\d+\.\d+/);
      }
      expect(Object.values(manifest.dependencies)).not.toContain("workspace:*");
      expect(JSON.parse(await readFile(join(directory, "standalone-notes/tsconfig.json"), "utf8"))).not.toHaveProperty("extends");
      expect(await readFile(join(directory, "standalone-notes/src/app.ts"), "utf8")).toContain("await hashPassword(bootstrapPassword)");
      expect(await readFile(join(directory, "standalone-notes/start.mjs"), "utf8")).toContain("server.listen(port, host");
      const smoke = await readFile(join(directory, "standalone-notes/test/standalone-smoke.mjs"), "utf8");
      expect(smoke).toContain("Standalone get-by-id proof failed");
      expect(smoke).toContain("Standalone update proof failed");
      expect(smoke).toContain("Standalone delete proof expected 404");
    });
  });

  it("keeps scaffold writes non-destructive unless force is explicit and dry-run never writes", async () => {
    await inTemporaryDirectory(async (directory) => {
      const logs: string[] = [];
      await runCli(["create-app", "safe-app", "--dry-run"], { log: (message) => logs.push(message) });
      await expect(readFile(join(directory, "safe-app/package.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(logs.some((message) => message.startsWith("Would create"))).toBe(true);

      await runCli(["create-app", "safe-app"], { log: () => undefined });
      const manifestPath = join(directory, "safe-app/package.json");
      await writeFile(manifestPath, "user-owned-content\n");
      await expect(runCli(["create-app", "safe-app"], { log: () => undefined })).rejects.toThrow("Refusing to overwrite");
      expect(await readFile(manifestPath, "utf8")).toBe("user-owned-content\n");

      await runCli(["create-app", "safe-app", "--force"], { log: () => undefined });
      expect(JSON.parse(await readFile(manifestPath, "utf8"))).toMatchObject({ name: "safe-app" });
    });
  });

  it("rejects scaffold names that could resolve to the current directory", async () => {
    await expect(runCli(["create-app", "../"], { log: () => undefined })).rejects.toThrow("at least one letter or number");
  });

  it.each([{ options: [] as string[] }, { options: ["--dry-run"] }, { options: ["--force"] }])("rejects a symlinked target directory for options $options", async ({ options }) => {
    await inTemporaryDirectory(async (directory) => {
      const outside = await mkdtemp(join(tmpdir(), "framekit-cli-outside-"));
      try {
        await writeFile(join(outside, "sentinel"), "untouched\n");
        await symlink(outside, join(directory, "linked-app"), "dir");
        await expect(runCli(["create-app", "linked-app", ...options], { log: () => undefined })).rejects.toThrow("symbolic link");
        expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("untouched\n");
        await expect(readFile(join(outside, "package.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it.each([{ options: [] as string[] }, { options: ["--dry-run"] }, { options: ["--force"] }])("rejects a symlinked scaffold file for options $options", async ({ options }) => {
    await inTemporaryDirectory(async (directory) => {
      const outside = join(directory, "outside-package.json");
      await writeFile(outside, "user-owned-content\n");
      await mkdir(join(directory, "linked-file-app"));
      await symlink(outside, join(directory, "linked-file-app", "package.json"), "file");
      await expect(runCli(["create-app", "linked-file-app", ...options], { log: () => undefined })).rejects.toThrow("symbolic link");
      expect(await readFile(outside, "utf8")).toBe("user-owned-content\n");
    });
  });

  it("generates SDK types from an app module path", async () => {
    let stdout = "";

    await runCli([
      "generate-sdk",
      "examples/crm/src/app.ts"
    ], {
      stdout: {
        write: (chunk: string | Uint8Array) => {
          stdout += String(chunk);
          return true;
        }
      },
      log: () => undefined
    });

    expect(stdout).toContain("export type CustomerInput");
    expect(stdout).toContain("export type DealWorkflowAction");
    expect(stdout).toContain('"win"');
  });

  it("generates migration files from app module paths", async () => {
    let stdout = "";

    await runCli([
      "generate-migration",
      "examples/crm/src/app.ts",
      "examples/crm/src/app.ts"
    ], {
      stdout: {
        write: (chunk: string | Uint8Array) => {
          stdout += String(chunk);
          return true;
        }
      },
      log: () => undefined
    });

    expect(stdout).toContain("Generated by framekit generate-migration");
    expect(stdout).toContain("export const migration");
    expect(stdout).toContain('"checksum"');
    expect(stdout).toContain('"up"');
    expect(stdout).toContain('"down"');
  });

  it("generates JSON migration artifacts", async () => {
    let stdout = "";

    await runCli([
      "generate-migration",
      "examples/crm/src/app.ts",
      "examples/crm/src/app.ts",
      "--format",
      "json"
    ], {
      stdout: {
        write: (chunk: string | Uint8Array) => {
          stdout += String(chunk);
          return true;
        }
      },
      log: () => undefined
    });

    expect(JSON.parse(stdout)).toMatchObject({
      tenantId: "default",
      up: [],
      down: []
    });
  });

  it("requires independent operator identity and rejects forged destructive classifications before connecting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "framekit-cli-migration-"));
    const tenant = { tenantId: "tenant_expected", userId: "migration", roles: ["administrator"], permissions: ["*"] };
    const current = defineApp({ name: "CLI Identity", modules: [defineModule({ id: "crm", name: "CRM", doctypes: [defineDocType({
      name: "customer",
      label: "Customer",
      fields: [{ name: "name", label: "Name", type: "text" }]
    })] })] });
    const next = defineApp({ name: "CLI Identity", modules: [defineModule({ id: "crm", name: "CRM", doctypes: [defineDocType({
      name: "customer",
      label: "Customer",
      fields: []
    })] })] });
    try {
      const plan = await createRuntime(current, { idGenerator: () => "cli-destructive" }).planMigration(tenant, next);
      const planPath = join(directory, "migration.json");
      await writeFile(planPath, JSON.stringify(createExecutableMigrationArtifact(plan)));

      await expect(runCli(["apply-migration", planPath, "--tenant-id", tenant.tenantId, "--app-name", current.name]))
        .rejects.toMatchObject({ code: "DESTRUCTIVE_MIGRATION" });
      await expect(runCli(["apply-migration", planPath, "--tenant-id", "wrong", "--app-name", current.name, "--allow-destructive"]))
        .rejects.toMatchObject({ code: "MIGRATION_TENANT_MISMATCH" });
      await expect(runCli(["apply-migration", planPath, "--tenant-id", tenant.tenantId, "--app-name", "Wrong App", "--allow-destructive"]))
        .rejects.toMatchObject({ code: "MIGRATION_APP_MISMATCH" });
      await expect(runCli(["rollback-migration", planPath, "--tenant-id", "wrong", "--app-name", current.name, "--allow-destructive"]))
        .rejects.toMatchObject({ code: "MIGRATION_TENANT_MISMATCH" });

      const changes = plan.changes.map((change) => change.kind === "remove_field" ? { ...change, destructive: false } : change);
      const forged = { ...plan, changes };
      const signedForgery = { ...forged, checksum: await migrationChecksum(forged) };
      const forgedPath = join(directory, "forged.json");
      await writeFile(forgedPath, JSON.stringify(createExecutableMigrationArtifact(signedForgery as never)));
      await expect(runCli(["apply-migration", forgedPath, "--tenant-id", tenant.tenantId, "--app-name", current.name, "--allow-destructive"]))
        .rejects.toMatchObject({ code: "INVALID_MIGRATION_PLAN" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function inTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const previous = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "framekit-cli-"));
  process.chdir(directory);
  try {
    await run(directory);
  } finally {
    process.chdir(previous);
    await rm(directory, { recursive: true, force: true });
  }
}
