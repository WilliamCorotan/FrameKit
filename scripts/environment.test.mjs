import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLocalEnvironment, requireDatabaseUrl } from "./environment.mjs";

afterEach(() => vi.unstubAllEnvs());

describe("explicit database configuration", () => {
  it("rejects missing, blank and invalid URLs without exposing credentials", () => {
    for (const value of [undefined, "", "  ", "https://user:secret@example.test/db", "postgres://localhost", "postgres://user:secret@"])
      expect(() => requireDatabaseUrl({ DATABASE_URL: value })).toThrow(/DATABASE_URL/);
    expect(requireDatabaseUrl({ DATABASE_URL: "postgresql://example.test/explicit" })).toBe("postgresql://example.test/explicit");
    expect(() => requireDatabaseUrl({ DATABASE_URL: "postgres://user:secret@" })).not.toThrow(/secret/);
  });
  it("accepts explicit multi-host PostgreSQL URLs", () => {
    const url = "postgres://test:test@primary.example:5432,replica.example:5432/app?target_session_attrs=read-write";
    expect(requireDatabaseUrl({ DATABASE_URL: url })).toBe(url);
  });
  it("loads local .env without overriding supplied environment and ignores files in CI", () => {
    const directory = mkdtempSync(join(tmpdir(), "framekit-env-"));
    const file = join(directory, ".env");
    try {
      writeFileSync(file, "DATABASE_URL=postgresql://example.test/local\n");
      vi.stubEnv("CI", "");
      vi.stubEnv("DATABASE_URL", undefined);
      loadLocalEnvironment(file);
      expect(process.env.DATABASE_URL).toBe("postgresql://example.test/local");
      vi.stubEnv("DATABASE_URL", "postgresql://example.test/explicit");
      loadLocalEnvironment(file);
      expect(process.env.DATABASE_URL).toBe("postgresql://example.test/explicit");
      vi.stubEnv("CI", "true");
      vi.stubEnv("DATABASE_URL", undefined);
      loadLocalEnvironment(file);
      expect(() => requireDatabaseUrl()).toThrow("DATABASE_URL is required");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
