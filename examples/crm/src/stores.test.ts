import { afterEach, describe, expect, it, vi } from "vitest";
import { storageMode } from "./stores.js";

afterEach(() => vi.unstubAllEnvs());

describe("storageMode", () => {
  it("requires an explicit database URL instead of selecting memory storage", () => {
    vi.stubEnv("FRAMEKIT_TEST_MEMORY_STORAGE", "");
    vi.stubEnv("DATABASE_URL", "");
    expect(() => storageMode()).toThrow("DATABASE_URL is required");
    vi.stubEnv("DATABASE_URL", "postgres://example.test/framekit");
    expect(storageMode()).toBe("postgres");
  });
  it("only permits explicitly selected in-memory test storage", () => {
    vi.stubEnv("FRAMEKIT_TEST_MEMORY_STORAGE", "true");
    vi.stubEnv("NODE_ENV", "test");
    expect(storageMode()).toBe("memory");
    vi.stubEnv("NODE_ENV", "development");
    expect(() => storageMode()).toThrow("only allowed in tests");
  });
});
