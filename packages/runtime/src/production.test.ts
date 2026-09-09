import { describe, expect, it, vi } from "vitest";
import { defineApp, defineModule } from "@framekit/core";
import { createRuntime, InMemoryDocumentRepository, InMemoryAuditStore, InMemoryOutboxStore, InMemoryCustomizationStore, InMemoryNamingSeriesStore, InMemoryMigrationStore, InMemoryAttachmentStorage, InMemoryMutationUnitOfWork, NoopRealtimePublisher } from "./index.js";

describe("production runtime deployment", () => {
  it("fails closed before starting in-memory defaults and closes the runtime", async () => {
    const runtime = createRuntime(defineApp({ name: "Production", modules: [defineModule({ id: "core", name: "Core", doctypes: [] })] }), {
      deployment: "production",
      settingsSecrets: { seal: (value) => value, unseal: (value) => value }
    });
    await expect(runtime.start()).rejects.toMatchObject({ code: "RUNTIME_PRODUCTION_UNSAFE" });
    expect(runtime.lifecycleStatus()).toMatchObject({ state: "closed", ready: false });
    await expect(runtime.diagnostics()).resolves.toMatchObject({ attachmentStorage: { durable: false } });
  });

  it("requires a secret settings port in production", async () => {
    const runtime = createRuntime(defineApp({ name: "Secrets", modules: [] }), { deployment: "production" });
    await expect(runtime.start()).rejects.toMatchObject({ code: "RUNTIME_PRODUCTION_UNSAFE" });
  });
});

function durableFixture() {
  const repository = new InMemoryDocumentRepository();
  const audit = new InMemoryAuditStore();
  const outbox = new InMemoryOutboxStore();
  const adapters = { repository, audit, outbox, customization: new InMemoryCustomizationStore(), namingSeries: new InMemoryNamingSeriesStore(), migrations: new InMemoryMigrationStore(), attachmentStorage: new InMemoryAttachmentStorage(), realtime: new NoopRealtimePublisher(), mutations: new InMemoryMutationUnitOfWork(repository, audit, outbox) };
  // Fixtures exercise the production contract, not actual persistence durability.
  const resources = Object.values(adapters).map((adapter) => Object.assign(adapter, {
    describe: () => ({ kind: "durable-test-fixture", durable: true, features: [] }),
    start: vi.fn(async () => {}), close: vi.fn(async () => {})
  }));
  return { adapters, resources };
}

it("starts complete durable compositions and closes owned resources on validation rejection", async () => {
  const { adapters, resources } = durableFixture();
  const options = { ...adapters, deployment: "production" as const, settingsSecrets: { seal: (value: string) => value, unseal: (value: string) => value } };
  const runtime = createRuntime(defineApp({ name: "Durable", modules: [] }), options);
  await runtime.start();
  expect(resources.every((resource) => resource.start.mock.calls.length === 1)).toBe(true);
  await runtime.close();
  expect(resources.every((resource) => resource.close.mock.calls.length === 1)).toBe(true);

  const invalid = durableFixture();
  Object.assign(invalid.adapters.attachmentStorage, { describe: undefined });
  const rejected = createRuntime(defineApp({ name: "Unknown", modules: [] }), { ...options, ...invalid.adapters });
  await expect(rejected.start()).rejects.toMatchObject({ code: "RUNTIME_PRODUCTION_UNSAFE" });
  await rejected.close();
  expect(invalid.resources.every((resource) => resource.start.mock.calls.length === 0 && resource.close.mock.calls.length === 1)).toBe(true);
});
