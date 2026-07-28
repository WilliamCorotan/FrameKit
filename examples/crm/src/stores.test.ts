import { afterEach, describe, expect, it } from "vitest";
import { storageMode } from "./stores.js";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("storageMode", () => {
  it("reads DATABASE_URL when called instead of when the module is imported", () => {
    delete process.env.DATABASE_URL;
    expect(storageMode()).toBe("memory");
    process.env.DATABASE_URL = "postgres://example.test/framekit";
    expect(storageMode()).toBe("postgres");
  });
});
