import { describe, expect, it } from "vitest";
import { defineApp, defineDocType, defineModule, type TenantContext } from "@framekit/core";
import { createRuntime } from "./index.js";

const tenant: TenantContext = {
  tenantId: "tenant_1",
  userId: "admin",
  roles: ["sales_manager"],
  permissions: ["crm.customer"]
};

describe("runtime document service", () => {
  it("creates and lists documents", async () => {
    const app = defineApp({
      name: "CRM",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [{ name: "name", label: "Name", type: "text", required: true, inList: true }],
              permissions: [{ action: "create", permissions: ["crm.customer"] }, { action: "read", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app, { idGenerator: () => "abc123456789" });

    const created = await runtime.create(tenant, "customer", { name: "Northwind" });
    const list = await runtime.list(tenant, "customer");

    expect(created.id).toBe("customer-abc12345");
    expect(list).toHaveLength(1);
  });

  it("filters, sorts, and offsets document lists", async () => {
    const app = defineApp({
      name: "CRM",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [
                { name: "name", label: "Name", type: "text", required: true, inList: true },
                { name: "status", label: "Status", type: "select", options: ["active", "paused"], inList: true }
              ],
              permissions: [{ action: "create", permissions: ["crm.customer"] }, { action: "read", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    let id = 0;
    const runtime = createRuntime(app, { idGenerator: () => `id${++id}abcdef` });

    await runtime.create(tenant, "customer", { name: "Beta", status: "active" });
    await runtime.create(tenant, "customer", { name: "Alpha", status: "active" });
    await runtime.create(tenant, "customer", { name: "Gamma", status: "paused" });
    const list = await runtime.list(tenant, "customer", {
      filters: { status: "active" },
      sort: { field: "name", direction: "asc" },
      offset: 1,
      limit: 1
    });

    expect(list.map((record) => record.data.name)).toEqual(["Beta"]);
    await expect(runtime.list(tenant, "customer", { filters: { unknown: "x" } })).rejects.toMatchObject({ code: "UNKNOWN_FILTER_FIELD" });
  });

  it("applies cursor pagination and field projection to document lists", async () => {
    const app = defineApp({
      name: "CRM",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [
                { name: "name", label: "Name", type: "text", required: true, inList: true },
                { name: "status", label: "Status", type: "select", options: ["active", "paused"], inList: true },
                { name: "notes", label: "Notes", type: "long_text" }
              ],
              permissions: [{ action: "create", permissions: ["crm.customer"] }, { action: "read", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    let id = 0;
    const runtime = createRuntime(app, { idGenerator: () => `id${++id}abcdef` });

    await runtime.create(tenant, "customer", { name: "Alpha", status: "active", notes: "first" });
    const beta = await runtime.create(tenant, "customer", { name: "Beta", status: "paused", notes: "second" });
    await runtime.create(tenant, "customer", { name: "Gamma", status: "active", notes: "third" });

    const page = await runtime.list(tenant, "customer", {
      sort: { field: "name", direction: "asc" },
      cursor: beta.id,
      fields: ["name"],
      limit: 1
    });

    expect(page).toHaveLength(1);
    expect(page[0]?.data).toEqual({ name: "Gamma" });
    expect(page[0]?.id).toBe("customer-id7abcde");
    await expect(runtime.list(tenant, "customer", { fields: ["unknown"] })).rejects.toMatchObject({ code: "UNKNOWN_PROJECTION_FIELD" });
  });

  it("supports rich filter operators", async () => {
    const app = defineApp({
      name: "Filtering",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "deal",
              label: "Deal",
              fields: [
                { name: "title", label: "Title", type: "text", required: true },
                { name: "amount", label: "Amount", type: "currency" },
                { name: "stage", label: "Stage", type: "select", options: ["open", "won", "lost"] }
              ],
              permissions: [{ action: "create", permissions: ["crm.customer"] }, { action: "read", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    let id = 0;
    const runtime = createRuntime(app, { idGenerator: () => `deal${++id}abcdef` });

    await runtime.create(tenant, "deal", { title: "North expansion", amount: 50, stage: "open" });
    await runtime.create(tenant, "deal", { title: "South renewal", amount: 120, stage: "won" });
    await runtime.create(tenant, "deal", { title: "West churn", amount: 20, stage: "lost" });

    await expect(runtime.list(tenant, "deal", { filters: { amount: { gt: 40 }, stage: { in: ["open", "won"] } }, sort: { field: "amount", direction: "desc" } })).resolves.toMatchObject([
      { data: { title: "South renewal" } },
      { data: { title: "North expansion" } }
    ]);
    await expect(runtime.list(tenant, "deal", { filters: { title: { contains: "renew" } } })).resolves.toMatchObject([{ data: { title: "South renewal" } }]);
    await expect(runtime.list(tenant, "deal", { filters: { amount: { between: [1, 2] } } as never })).rejects.toMatchObject({ code: "UNKNOWN_FILTER_OPERATOR" });
  });

  it("validates link fields before writes", async () => {
    const app = defineApp({
      name: "Links",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [{ name: "name", label: "Name", type: "text", required: true }],
              permissions: [{ action: "create", permissions: ["crm.customer"] }]
            }),
            defineDocType({
              name: "contact",
              label: "Contact",
              fields: [
                { name: "full_name", label: "Full Name", type: "text", required: true },
                { name: "customer", label: "Customer", type: "link", linkTo: "customer" }
              ],
              permissions: [{ action: "create", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app, { idGenerator: () => "abc123456789" });

    await expect(runtime.create(tenant, "contact", { full_name: "Missing Link", customer: "missing" })).rejects.toMatchObject({ code: "LINK_NOT_FOUND" });
    const customer = await runtime.create(tenant, "customer", { name: "Linked Co" });
    await expect(runtime.create(tenant, "contact", { full_name: "Valid Link", customer: customer.id })).resolves.toMatchObject({ data: { customer: customer.id } });
  });

  it("enforces unique fields before creates and updates", async () => {
    const app = defineApp({
      name: "Unique",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [
                { name: "name", label: "Name", type: "text", required: true },
                { name: "email", label: "Email", type: "text", unique: true }
              ],
              permissions: [
                { action: "create", permissions: ["crm.customer"] },
                { action: "read", permissions: ["crm.customer"] },
                { action: "update", permissions: ["crm.customer"] }
              ]
            })
          ]
        })
      ]
    });
    let id = 0;
    const runtime = createRuntime(app, { idGenerator: () => `cust${++id}abcdef` });

    const first = await runtime.create(tenant, "customer", { name: "First", email: "owner@example.com" });
    const second = await runtime.create(tenant, "customer", { name: "Second", email: "other@example.com" });

    await expect(runtime.create(tenant, "customer", { name: "Duplicate", email: "owner@example.com" })).rejects.toMatchObject({ code: "UNIQUE_CONSTRAINT_FAILED" });
    await expect(runtime.update(tenant, "customer", second.id, { email: "owner@example.com" })).rejects.toMatchObject({ code: "UNIQUE_CONSTRAINT_FAILED" });
    await expect(runtime.update(tenant, "customer", first.id, { name: "First renamed" })).resolves.toMatchObject({ id: first.id, data: { email: "owner@example.com" } });
  });

  it("runs workflow transitions", async () => {
    const app = defineApp({
      name: "CRM",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "deal",
              label: "Deal",
              fields: [{ name: "title", label: "Title", type: "text", required: true }],
              permissions: [{ action: "create", roles: ["sales_manager"] }, { action: "read", roles: ["sales_manager"] }, { action: "transition", roles: ["sales_manager"] }],
              workflow: {
                field: "stage",
                initialState: "open",
                states: ["open", "won"],
                transitions: [{ action: "win", from: ["open"], to: "won", roles: ["sales_manager"] }]
              }
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app, { idGenerator: () => "deal123456" });
    const created = await runtime.create(tenant, "deal", { title: "Upgrade" });
    const transitioned = await runtime.transition(tenant, "deal", created.id, "win");

    expect(transitioned.state).toBe("won");
    expect(transitioned.data.stage).toBe("won");
  });

  it("reports runtime diagnostics", async () => {
    const app = defineApp({
      name: "Diagnostics",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [{ name: "name", label: "Name", type: "text" }],
              indexes: [["name"]]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app);

    await expect(runtime.diagnostics()).resolves.toMatchObject({
      app: { name: "Diagnostics" },
      repository: { kind: "memory", durable: false },
      audit: { kind: "memory", durable: false },
      outbox: { kind: "memory", durable: false },
      namingSeries: { kind: "memory", durable: false },
      realtime: { kind: "none", durable: false },
      doctypes: [{ name: "customer", workflow: false }]
    });
  });

  it("records audit events for mutations", async () => {
    const app = defineApp({
      name: "Audit",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [{ name: "name", label: "Name", type: "text", required: true }],
              permissions: [{ action: "create", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app, { idGenerator: () => "audit123456" });

    await runtime.create(tenant, "customer", { name: "Audit Co" });

    await expect(runtime.auditTrail(tenant)).resolves.toMatchObject([{ action: "create", doctype: "customer" }]);
    await expect(runtime.outboxEvents(tenant)).resolves.toMatchObject([{ type: "customer.created", topic: "customer" }]);
  });

  it("applies tenant custom fields to metadata and document writes", async () => {
    const app = defineApp({
      name: "Custom",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [{ name: "name", label: "Name", type: "text", required: true }],
              permissions: [{ action: "create", permissions: ["crm.customer"] }, { action: "read", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app, { idGenerator: () => "custom123456" });

    await runtime.addCustomField(tenant, {
      doctype: "customer",
      field: { name: "region", label: "Region", type: "select", options: ["apac", "emea"], inList: true }
    });
    const created = await runtime.create(tenant, "customer", { name: "Custom Co", region: "apac" });
    const metadata = await runtime.metadata(tenant);

    expect(created.data.region).toBe("apac");
    expect(metadata.modules[0]?.doctypes[0]?.fields.map((field) => field.name)).toContain("region");
  });

  it("stores tenant view metadata", async () => {
    const app = defineApp({
      name: "Views",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [
                { name: "name", label: "Name", type: "text" },
                { name: "owner", label: "Owner", type: "text" }
              ]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app);

    await runtime.upsertView(tenant, { doctype: "customer", type: "list", fields: ["owner", "name"] });
    const metadata = await runtime.metadata(tenant);

    expect(metadata.modules[0]?.doctypes[0]?.views[0]).toMatchObject({ type: "list", fields: ["owner", "name"] });
  });

  it("plans and records metadata migrations", async () => {
    const current = defineApp({
      name: "Migrations",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [{ name: "name", label: "Name", type: "text" }]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(current, { idGenerator: () => "migration-1" });
    const next = defineApp({
      name: "Migrations",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "customer",
              label: "Customer",
              fields: [
                { name: "name", label: "Name", type: "text" },
                { name: "region", label: "Region", type: "text", unique: true }
              ],
              indexes: [["region"]]
            })
          ]
        })
      ]
    });

    const plan = await runtime.planMigration(tenant, next);
    const applied = await runtime.applyMigration(tenant, plan);

    expect(plan.checksum).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "add_field", doctype: "customer", field: "region", destructive: false }),
      expect.objectContaining({ kind: "add_unique_constraint", doctype: "customer", field: "region", destructive: false }),
      expect.objectContaining({ kind: "add_index", doctype: "customer", field: "region", destructive: false })
    ]));
    expect(plan.changes[0]?.rollback).toMatchObject({ kind: "remove_field", doctype: "customer", field: "region" });
    await expect(runtime.applyMigration(tenant, { ...plan, changes: [] })).rejects.toMatchObject({ code: "MIGRATION_CHECKSUM_MISMATCH" });
    await expect(runtime.migrationHistory(tenant)).resolves.toEqual([applied]);
  });

  it("generates predictable naming series", async () => {
    const app = defineApp({
      name: "Series",
      modules: [
        defineModule({
          id: "crm",
          name: "CRM",
          doctypes: [
            defineDocType({
              name: "deal",
              label: "Deal",
              naming: { prefix: "DEAL", series: true, digits: 3 },
              fields: [{ name: "title", label: "Title", type: "text", required: true }],
              permissions: [{ action: "create", permissions: ["crm.customer"] }]
            })
          ]
        })
      ]
    });
    const runtime = createRuntime(app);

    await expect(runtime.create(tenant, "deal", { title: "One" })).resolves.toMatchObject({ id: "DEAL-001" });
    await expect(runtime.create(tenant, "deal", { title: "Two" })).resolves.toMatchObject({ id: "DEAL-002" });
  });

  it("publishes realtime document events", async () => {
    const events: unknown[] = [];
    const runtime = createRuntime(
      defineApp({
        name: "Realtime",
        modules: [
          defineModule({
            id: "crm",
            name: "CRM",
            doctypes: [
              defineDocType({
                name: "customer",
                label: "Customer",
                fields: [{ name: "name", label: "Name", type: "text", required: true }],
                permissions: [{ action: "create", permissions: ["crm.customer"] }]
              })
            ]
          })
        ]
      }),
      {
        realtime: {
          publish: (event) => {
            events.push(event);
          }
        }
      }
    );

    await runtime.create(tenant, "customer", { name: "Live Co" });

    expect(events).toMatchObject([{ channel: "tenant:tenant_1:documents", type: "customer.created" }]);
  });

  it("lists realtime events when the publisher supports history", async () => {
    const published: Array<{ channel: string; type: string; payload: Record<string, unknown> }> = [];
    const runtime = createRuntime(
      defineApp({
        name: "Realtime History",
        modules: [
          defineModule({
            id: "crm",
            name: "CRM",
            doctypes: [
              defineDocType({
                name: "customer",
                label: "Customer",
                fields: [{ name: "name", label: "Name", type: "text", required: true }],
                permissions: [{ action: "create", permissions: ["crm.customer"] }]
              })
            ]
          })
        ]
      }),
      {
        realtime: {
          publish: (event) => {
            published.push(event);
          },
          list: (channel) => published.filter((event) => event.channel === channel)
        }
      }
    );

    await runtime.create(tenant, "customer", { name: "History Co" });

    await expect(runtime.realtimeEvents(tenant)).resolves.toMatchObject([{ type: "customer.created" }]);
  });

  it("subscribes to realtime document events when the publisher supports streaming", async () => {
    const listeners = new Set<(event: { channel: string; type: string; payload: Record<string, unknown> }) => void>();
    const received: unknown[] = [];
    const runtime = createRuntime(
      defineApp({
        name: "Realtime Stream",
        modules: [
          defineModule({
            id: "crm",
            name: "CRM",
            doctypes: [
              defineDocType({
                name: "customer",
                label: "Customer",
                fields: [{ name: "name", label: "Name", type: "text", required: true }],
                permissions: [{ action: "create", permissions: ["crm.customer"] }]
              })
            ]
          })
        ]
      }),
      {
        realtime: {
          publish: (event) => {
            for (const listener of listeners) {
              listener(event);
            }
          },
          subscribe: (_channel, listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          }
        }
      }
    );

    const unsubscribe = runtime.subscribeRealtime(tenant, (event) => received.push(event));
    await runtime.create(tenant, "customer", { name: "Stream Co" });
    unsubscribe();

    expect(received).toMatchObject([{ type: "customer.created" }]);
  });
});
