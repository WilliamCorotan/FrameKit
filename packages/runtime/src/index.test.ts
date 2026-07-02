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
              fields: [{ name: "name", label: "Name", type: "text" }]
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
});
