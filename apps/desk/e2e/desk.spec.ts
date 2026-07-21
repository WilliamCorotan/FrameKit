import { expect, type Page, type Route, test } from "@playwright/test";

const apiOrigin = "http://127.0.0.1:45123";

type RecordItem = {
  id: string;
  doctype: string;
  state?: string;
  data: Record<string, unknown>;
  updatedAt: string;
};

type AuthUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
};

type AuthRole = {
  id: string;
  name: string;
  permissions: string[];
};

type ApiToken = {
  id: string;
  name: string;
  roles: string[];
  permissions: string[];
  createdAt: string;
  revokedAt?: string;
  token?: string;
};

type OutboxEvent = {
  id: string;
  type: string;
  topic: string;
  status: "pending" | "dispatched" | "failed";
  attempts: number;
  createdAt: string;
  error?: string;
};

test.beforeEach(async ({ page }) => {
  await mockDeskApi(page);
});

test("signs in, restores a session, and signs out", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Metadata operations console" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("admin@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Customer", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Desk sections" })).toBeVisible();
  await expect(page.evaluate(() => window.localStorage.getItem("framekit.token"))).resolves.toBe("desk-token");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Customer", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.evaluate(() => window.localStorage.getItem("framekit.token"))).resolves.toBeNull();
});

test("covers document list, create, edit, delete, pagination, search, and workflow form controls", async ({ page }) => {
  await signIn(page);

  await expect(page.getByRole("button", { name: /CUSTOMER-001/ })).toBeVisible();
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("Name *").fill("Acme Browser Co");
  await page.getByLabel("Status").selectOption("active");
  await page.getByLabel("Revenue").fill("2500");
  await page.getByLabel("Notes").fill("Created from browser smoke test");
  await page.getByRole("checkbox", { name: "Active" }).check();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Saved")).toBeVisible();
  await expect(page.getByRole("button", { name: /CUSTOMER-002/ })).toBeVisible();
  await expect(page.getByText("Acme Browser Co")).toBeVisible();

  await page.getByLabel("Revenue").fill("3000");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Revenue")).toHaveValue("3000");

  await page.getByPlaceholder("Filter records").fill("Acme");
  await expect(page.getByRole("button", { name: /CUSTOMER-001/ })).toBeHidden();
  await expect(page.getByRole("button", { name: /CUSTOMER-002/ })).toBeVisible();

  await page.getByRole("button", { name: "Qualify" }).click();
  await expect(page.getByText("Transitioned")).toBeVisible();

  await page.getByLabel("Filter records").fill("");
  for (let index = 0; index < 5; index += 1) {
    await page.getByRole("button", { name: "New document" }).click();
    await page.getByLabel("Name *").fill(`Page record ${index}`);
    await page.getByRole("button", { name: "Save" }).click();
  }
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(page.getByText("Page 1")).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("button", { name: /CUSTOMER-001/ }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted")).toBeVisible();
});

test("covers auth administration screens", async ({ page }) => {
  await signIn(page);

  await page.getByRole("button", { name: "Users" }).click();
  await expect(page.locator("h1", { hasText: "Users" })).toBeVisible();
  await page.getByLabel("ID").fill("browser-user");
  await page.getByLabel("Name").fill("Browser User");
  await page.getByLabel("Email").fill("browser@example.test");
  await page.getByLabel("Password").fill("secret12345");
  await page.getByLabel("Roles").fill("administrator");
  await page.getByLabel("Permissions").fill("crm.customer.read");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("browser@example.test")).toBeVisible();

  await page.getByRole("button", { name: "Roles" }).click();
  await expect(page.locator("h1", { hasText: "Roles" })).toBeVisible();
  await page.getByLabel("ID").fill("browser-role");
  await page.getByLabel("Name").fill("Browser Role");
  await page.getByLabel("Permissions").fill("crm.customer.write");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Browser Role")).toBeVisible();

  await page.getByRole("button", { name: "API Tokens" }).click();
  await expect(page.locator("h1", { hasText: "API Tokens" })).toBeVisible();
  await page.getByLabel("ID").fill("browser-token");
  await page.getByLabel("Name").fill("Browser Token");
  await page.getByLabel("Roles").fill("administrator");
  await page.getByLabel("Permissions").fill("*");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("fk_browser_token")).toBeVisible();
  await expect(page.getByText("Browser Token")).toBeVisible();
});

test("covers operations screens for customization, audit, outbox, and diagnostics", async ({ page }) => {
  await signIn(page);

  await page.getByRole("button", { name: "Customization" }).click();
  await expect(page.getByRole("heading", { name: "Customization" })).toBeVisible();
  await page.getByLabel("Name").fill("region");
  await page.getByLabel("Label").fill("Region");
  await page.getByLabel("List Field").selectOption("true");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("customer.region")).toBeVisible();

  await page.getByRole("button", { name: "Audit" }).click();
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();
  await expect(page.getByText("CREATE customer")).toBeVisible();

  await page.getByRole("button", { name: "Outbox" }).click();
  await expect(page.getByRole("heading", { name: "Outbox" })).toBeVisible();
  await page.getByRole("button", { name: "Dispatch" }).click();
  await expect(page.getByText("dispatched · 1 attempts")).toBeVisible();
  await page.getByRole("button", { name: "Fail" }).click();
  await expect(page.getByText("failed · 2 attempts")).toBeVisible();

  await page.getByRole("button", { name: "Diagnostics" }).click();
  await expect(page.getByRole("heading", { name: "Diagnostics" })).toBeVisible();
  await expect(page.getByText("repository")).toBeVisible();
  await expect(page.getByText("ephemeral").first()).toBeVisible();
});

test("keeps core Desk controls reachable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await expect(page.getByRole("navigation", { name: "Desk sections" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Customer", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Filter records")).toBeVisible();
  await expect(page.getByRole("button", { name: "New document" })).toBeVisible();

  await page.getByRole("button", { name: "Customization" }).click();
  await expect(page.getByLabel("DocType")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Customer", exact: true })).toBeVisible();
}

async function mockDeskApi(page: Page) {
  const now = "2026-07-06T00:00:00.000Z";
  const customers: RecordItem[] = [
    {
      id: "CUSTOMER-001",
      doctype: "customer",
      state: "Lead",
      data: {
        name: "Northwind Traders",
        status: "active",
        revenue: 1200,
        notes: "Seed record",
        is_active: true
      },
      updatedAt: now
    }
  ];
  const users: AuthUser[] = [
    { id: "admin", email: "admin@example.com", name: "Administrator", roles: ["administrator"], permissions: ["*"] }
  ];
  const roles: AuthRole[] = [
    { id: "administrator", name: "Administrator", permissions: ["*"] }
  ];
  const tokens: ApiToken[] = [
    { id: "seed-token", name: "Seed Token", roles: ["administrator"], permissions: ["*"], createdAt: now }
  ];
  const audit = [
    { id: "audit-1", userId: "admin", action: "CREATE", doctype: "customer", documentId: "CUSTOMER-001", createdAt: now }
  ];
  const outbox: OutboxEvent[] = [
    { id: "outbox-1", type: "DocumentCreated", topic: "crm.customer", status: "pending", attempts: 0, createdAt: now }
  ];
  const customFields: Array<{ id: string; doctype: string; field: Record<string, unknown> }> = [];

  await page.route(`${apiOrigin}/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const body = request.postDataJSON?.() as Record<string, unknown> | undefined;

    if (path === "/api/auth/login" && method === "POST") {
      return json(route, { token: "desk-token" });
    }
    if (path === "/api/auth/logout" && method === "POST") {
      return empty(route);
    }
    if (path === "/api/meta" && method === "GET") {
      return json(route, metadata);
    }

    if (path === "/api/doctypes/customer" && method === "GET") {
      const search = url.searchParams.get("search")?.toLowerCase() ?? "";
      const list = search
        ? customers.filter((record) => JSON.stringify(record.data).toLowerCase().includes(search) || record.id.toLowerCase().includes(search))
        : customers;
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? list.length);
      return json(route, list.slice(offset, offset + limit));
    }
    if (path === "/api/doctypes/customer" && method === "POST" && body) {
      const record = {
        id: `CUSTOMER-${String(customers.length + 1).padStart(3, "0")}`,
        doctype: "customer",
        state: "Lead",
        data: body,
        updatedAt: now
      };
      customers.unshift(record);
      return json(route, record);
    }
    const customerMatch = path.match(/^\/api\/doctypes\/customer\/([^/]+)(?:\/transition)?$/);
    if (customerMatch && method === "PATCH" && body) {
      const record = customers.find((item) => item.id === customerMatch[1]);
      Object.assign(record!.data, body);
      return json(route, record);
    }
    if (customerMatch && !path.endsWith("/transition") && method === "DELETE") {
      customers.splice(customers.findIndex((item) => item.id === customerMatch[1]), 1);
      return empty(route);
    }
    if (customerMatch && path.endsWith("/transition") && method === "POST") {
      const record = customers.find((item) => item.id === customerMatch[1]);
      record!.state = "Qualified";
      return json(route, record);
    }

    if (path === "/api/auth/users" && method === "GET") {
      return json(route, users);
    }
    if (path === "/api/auth/users" && method === "POST" && body) {
      users.push(body as AuthUser);
      return json(route, body);
    }
    if (path.startsWith("/api/auth/users/") && method === "DELETE") {
      users.splice(users.findIndex((item) => item.id === path.split("/").at(-1)), 1);
      return empty(route);
    }

    if (path === "/api/auth/roles" && method === "GET") {
      return json(route, roles);
    }
    if (path === "/api/auth/roles" && method === "POST" && body) {
      roles.push(body as AuthRole);
      return json(route, body);
    }
    if (path.startsWith("/api/auth/roles/") && method === "DELETE") {
      roles.splice(roles.findIndex((item) => item.id === path.split("/").at(-1)), 1);
      return empty(route);
    }

    if (path === "/api/auth/tokens" && method === "GET") {
      return json(route, tokens);
    }
    if (path === "/api/auth/tokens" && method === "POST" && body) {
      const token = { ...body, createdAt: now, token: "fk_browser_token" };
      tokens.push(token as ApiToken);
      return json(route, token);
    }
    if (path.startsWith("/api/auth/tokens/") && method === "DELETE") {
      tokens.splice(tokens.findIndex((item) => item.id === path.split("/").at(-1)), 1);
      return empty(route);
    }

    if (path === "/api/audit" && method === "GET") {
      return json(route, audit);
    }
    if (path === "/api/outbox" && method === "GET") {
      return json(route, outbox);
    }
    const outboxMatch = path.match(/^\/api\/outbox\/([^/]+)\/(dispatch|fail)$/);
    if (outboxMatch && method === "POST") {
      const event = outbox.find((item) => item.id === outboxMatch[1])!;
      event.status = outboxMatch[2] === "dispatch" ? "dispatched" : "failed";
      event.attempts += 1;
      if (event.status === "failed") {
        event.error = "Marked failed from Desk";
      }
      return json(route, event);
    }

    if (path === "/api/diagnostics" && method === "GET") {
      return json(route, {
        app: { name: "Framekit", version: "0.1.0" },
        repository: { kind: "repository", durable: false, features: ["documents"] },
        audit: { kind: "audit", durable: false, features: ["events"] },
        outbox: { kind: "outbox", durable: false, features: ["dispatch"] },
        customization: { kind: "customization", durable: false, features: ["fields"] },
        warnings: ["Using in-memory stores"]
      });
    }
    if (path === "/api/custom-fields" && method === "GET") {
      return json(route, customFields);
    }
    if (path === "/api/custom-fields" && method === "POST" && body) {
      const field = { id: "custom-region", ...body };
      customFields.push(field as typeof customFields[number]);
      return json(route, field);
    }

    return route.fulfill({ status: 404, body: `Unhandled ${method} ${path}` });
  });
}

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

function empty(route: Route) {
  return route.fulfill({ status: 204 });
}

const metadata = {
  name: "Framekit CRM",
  version: "0.1.0",
  modules: [
    {
      id: "crm",
      name: "CRM",
      doctypes: [
        {
          name: "customer",
          label: "Customer",
          description: "Customer profile",
          fields: [
            { name: "name", label: "Name", type: "text", required: true, inList: true },
            { name: "status", label: "Status", type: "select", options: ["lead", "active", "closed"], inList: true },
            { name: "revenue", label: "Revenue", type: "currency", inList: true },
            { name: "notes", label: "Notes", type: "long_text" },
            { name: "is_active", label: "Active", type: "boolean" }
          ],
          views: [
            { id: "customer-list", doctype: "customer", type: "list", fields: ["name", "status", "revenue"] },
            { id: "customer-form", doctype: "customer", type: "form", fields: ["name", "status", "revenue", "notes", "is_active"] }
          ],
          workflow: {
            field: "state",
            initialState: "Lead",
            states: ["Lead", "Qualified"],
            transitions: [{ action: "Qualify", from: ["Lead"], to: "Qualified" }]
          }
        }
      ]
    }
  ]
};
