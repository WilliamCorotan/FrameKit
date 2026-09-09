import { describe, expect, it } from "vitest";
import { productionConfiguration } from "./production.js";

const production = {
  NODE_ENV: "production", DATABASE_URL: "postgres://localhost/framekit", AWS_REGION: "us-east-1",
  FRAMEKIT_S3_BUCKET: "private-attachments", FRAMEKIT_SETTINGS_ACTIVE_KEY: "current",
  FRAMEKIT_SETTINGS_KEYS: JSON.stringify({ current: Buffer.alloc(32, 7).toString("base64url") })
};

describe("production configuration", () => {
  it("requires durable stores and an independent encryption keyring", () => {
    expect(() => productionConfiguration({ NODE_ENV: "production" })).toThrow("DATABASE_URL");
    expect(() => productionConfiguration({ ...production, FRAMEKIT_SETTINGS_KEYS: undefined })).toThrow("FRAMEKIT_SETTINGS_KEYS");
    expect(() => productionConfiguration({ ...production, FRAMEKIT_S3_BUCKET: undefined })).toThrow("FRAMEKIT_S3_BUCKET");
    expect(productionConfiguration({ ...production, DATABASE_URL: "postgres://test:test@primary.example:5432,replica.example:5432/app" }).databaseUrl).toContain("replica.example");
    expect(productionConfiguration(production)).toMatchObject({ production: true, poolMax: 10, connectionBudget: 11 });
    expect(() => productionConfiguration({})).toThrow("DATABASE_URL");
    expect(productionConfiguration({ NODE_ENV: "test", FRAMEKIT_TEST_MEMORY_STORAGE: "true" })).toMatchObject({ production: false, databaseUrl: undefined });
  });
  it("rejects insecure endpoints and invalid budgets without exposing configuration values", () => {
    expect(() => productionConfiguration({ ...production, FRAMEKIT_S3_ENDPOINT: "http://localhost:9000" })).toThrow("HTTPS");
    expect(() => productionConfiguration({ ...production, FRAMEKIT_S3_ENDPOINT: "https://user:password@example.com" })).toThrow("credentials");
    expect(() => productionConfiguration({ ...production, FRAMEKIT_S3_ENDPOINT: "https://user:secret@" })).toThrow("Invalid S3 endpoint configuration.");
    expect(() => productionConfiguration({ ...production, FRAMEKIT_DB_CONNECTION_BUDGET: "10" })).toThrow("listener");
    for (const value of ["0", "1.5", "Infinity", "-1", "2e2", "9007199254740992"]) {
      expect(() => productionConfiguration({ ...production, FRAMEKIT_DB_POOL_MAX: value })).toThrow("positive integer");
    }
    expect(() => productionConfiguration({ ...production, FRAMEKIT_SETTINGS_KEYS: "secret-invalid" })).toThrow("Invalid settings encryption keyring configuration.");
  });
});
