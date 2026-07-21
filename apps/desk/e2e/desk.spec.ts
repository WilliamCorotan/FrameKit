import { expect, type Page, type Route, test } from "@playwright/test";

const apiOrigin = "http://127.0.0.1:45123";

type RecordItem = {
  id: string;
  doctype: string;
  revision: number;
  state?: string;
  documentStatus: "draft" | "submitted" | "cancelled";
  ownerId?: string;
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
  await page.getByLabel("Revenue").fill("-0.0001");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Invalid value for Revenue")).toBeVisible();
  await page.getByLabel("Revenue").fill("1.00001");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Invalid value for Revenue")).toBeVisible();
  await page.getByLabel("Revenue").fill("2500");
  await expect(page.getByLabel("Revenue")).toHaveAttribute("type", "text");
  await expect(page.getByLabel("Revenue")).toHaveAttribute("inputmode", "decimal");
  await expect(page.getByLabel("Revenue")).toHaveAttribute("data-precision", "24");
  await expect(page.getByLabel("Revenue")).toHaveAttribute("data-scale", "4");
  await page.getByLabel("Notes").fill("Created from browser smoke test");
  await page.getByRole("checkbox", { name: "Active" }).check();
  await page.getByLabel("Approved").selectOption("1");
  await page.getByLabel("Rating").selectOption({ label: "2" });
  const createRequest = page.waitForRequest((request) => request.url().endsWith("/api/doctypes/customer") && request.method() === "POST");
  await page.getByRole("button", { name: "Save" }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({ approved: false, rating: 2 });

  await expect(page.getByText("Saved")).toBeVisible();
  await expect(page.getByRole("button", { name: /CUSTOMER-002/ })).toBeVisible();
  await expect(page.getByText("Acme Browser Co")).toBeVisible();
  await expect(page.getByLabel("Display name")).toBeDisabled();
  await expect(page.getByLabel("Display name")).toHaveValue("Acme Browser Co active");

  await page.getByLabel("Revenue").fill("3000");
  const editRequest = page.waitForRequest((request) => request.url().endsWith("/api/doctypes/customer/CUSTOMER-002") && request.method() === "PATCH");
  await page.getByRole("button", { name: "Save" }).click();
  expect((await editRequest).postDataJSON()).not.toHaveProperty("display_name");
  await expect(page.getByLabel("Revenue")).toHaveValue("3000");

  await page.getByPlaceholder("Filter records").fill("Acme");
  await expect(page.getByRole("button", { name: /CUSTOMER-001/ })).toBeHidden();
  await expect(page.getByRole("button", { name: /CUSTOMER-002/ })).toBeVisible();

  await page.getByRole("button", { name: "Qualify" }).click();
  await expect(page.getByText("Transitioned")).toBeVisible();
  const submitRequest = page.waitForRequest((request) => request.url().endsWith("/submit"));
  await page.getByRole("button", { name: "Submit" }).click();
  expect((await submitRequest).headers()["if-match"]).toBe("3");
  await expect(page.getByText("Submitted")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  const cancelRequest = page.waitForRequest((request) => request.url().endsWith("/cancel"));
  await page.getByRole("button", { name: "Cancel" }).click();
  expect((await cancelRequest).headers()["if-match"]).toBe("4");
  await expect(page.getByText("Cancelled")).toBeVisible();
  await page.getByLabel("Owner").fill("new-owner");
  const ownerRequest = page.waitForRequest((request) => request.url().endsWith("/owner"));
  await page.getByRole("button", { name: "Transfer owner" }).click();
  expect((await ownerRequest).headers()["if-match"]).toBe("5");
  await expect(page.getByText("Owner transferred")).toBeVisible();
  await expect(page.getByLabel("Owner")).toHaveValue("new-owner");
  await expect(page.getByText("Revision 6")).toBeVisible();
  await page.getByLabel("Owner").fill("hidden-owner");
  const hiddenOwnerRequest = page.waitForRequest((request) => request.url().endsWith("/owner"));
  await page.getByRole("button", { name: "Transfer owner" }).click();
  expect((await hiddenOwnerRequest).headers()["if-match"]).toBe("6");
  await expect(page.getByText("Owner transferred; document is no longer readable")).toBeVisible();
  await expect(page.getByText("New document")).toBeVisible();
  await expect(page.getByText("Acme Browser Co")).toBeHidden();

  await page.getByLabel("Filter records").fill("");
  for (let index = 0; index < 5; index += 1) {
    await page.getByRole("button", { name: "New document" }).click();
    await page.getByLabel("Name *").fill(`Page record ${index}`);
    await page.getByRole("button", { name: "Save" }).click();
  }
  const secondPageResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get("offset") === "5");
  await page.getByRole("button", { name: "Next page" }).click();
  await secondPageResponse;
  await expect(page.getByText("Page 2")).toBeVisible();
  await expect(page.locator(".list button.row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  const firstPageResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get("offset") === "0");
  await page.getByRole("button", { name: "Previous page" }).click();
  await firstPageResponse;
  await expect(page.getByText("Page 1")).toBeVisible();
  await expect(page.locator(".list button.row")).toHaveCount(5);
  const terminalPageResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get("offset") === "5");
  await page.getByRole("button", { name: "Next page" }).click();
  await terminalPageResponse;
  await expect(page.locator(".list button.row")).toHaveCount(2);
  await page.getByRole("button", { name: /CUSTOMER-001/ }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted")).toBeVisible();
});

test("edits ordered child rows and uploads and deletes attachment metadata", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("Name *").fill("Collection customer");
  await page.getByRole("button", { name: "Add child row" }).click();
  await page.getByLabel("Contact name").fill("Alice");
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("2");
  await page.getByRole("button", { name: "Add child row" }).click();
  await page.getByLabel("Contact name").nth(1).fill("Bob");
  await page.getByRole("button", { name: "Move row 2 up" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await expect(page.getByLabel("Contact name").first()).toHaveValue("Bob");

  await page.getByLabel("Upload Files").setInputFiles({ name: "proof.txt", mimeType: "text/plain", buffer: Buffer.from("proof") });
  await expect(page.getByText("Uploaded")).toBeVisible();
  await expect(page.getByText("proof.txt · 5 bytes")).toBeVisible();
  await page.getByRole("button", { name: "Delete proof.txt attachment" }).click();
  await expect(page.getByText("Attachment deleted")).toBeVisible();
  await expect(page.getByText("proof.txt · 5 bytes")).toBeHidden();
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
      revision: 1,
      state: "Lead",
      documentStatus: "draft",
      ownerId: "admin",
      data: {
        name: "Northwind Traders",
        status: "active",
        revenue: "1200.0000",
        display_name: "Northwind active",
        notes: "Seed record",
        is_active: true,
        approved: true,
        rating: 1
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
      const data = { ...body };
      if (Array.isArray(data.contacts)) data.contacts = data.contacts.map((row, position) => ({ ...(row as object), id: `child-${position + 1}`, position }));
      data.files = [];
      const record = {
        id: `CUSTOMER-${String(customers.length + 1).padStart(3, "0")}`,
        doctype: "customer",
        revision: 1,
        state: "Lead",
        documentStatus: "draft" as const,
        ownerId: "admin",
        data: { ...data, display_name: `${String(body.name)} ${String(body.status ?? "lead")}` },
        updatedAt: now
      };
      customers.unshift(record);
      return json(route, record);
    }
    const customerMatch = path.match(/^\/api\/doctypes\/customer\/([^/]+)(?:\/(transition|submit|cancel|owner))?$/);
    const attachmentMatch = path.match(/^\/api\/doctypes\/customer\/([^/]+)\/attachments\/files(?:\/([^/]+))?$/);
    if (attachmentMatch && method === "POST" && body) {
      const record = customers.find((item) => item.id === attachmentMatch[1])!;
      const attachment = { id: `attachment-${record.revision}`, name: String(body.name), contentType: String(body.contentType), size: 5, storageKey: "mock/key", createdAt: now, createdBy: "admin" };
      record.data.files = [...((record.data.files as unknown[]) ?? []), attachment]; record.revision += 1;
      return json(route, attachment);
    }
    if (attachmentMatch?.[2] && method === "DELETE") {
      const record = customers.find((item) => item.id === attachmentMatch[1])!;
      record.data.files = ((record.data.files as Array<{ id: string }>) ?? []).filter((item) => item.id !== attachmentMatch[2]); record.revision += 1;
      return empty(route);
    }
    if (customerMatch && !customerMatch[2] && method === "GET") {
      const record = customers.find((item) => item.id === customerMatch[1]);
      if (!record || record.ownerId === "hidden-owner") return jsonError(route, 404, "DOCUMENT_NOT_FOUND", "Document is no longer readable");
      return json(route, record);
    }
    if (customerMatch && method === "PATCH" && body) {
      const record = customers.find((item) => item.id === customerMatch[1]);
      Object.assign(record!.data, body);
      record!.revision += 1;
      return json(route, record);
    }
    if (customerMatch && !customerMatch[2] && method === "DELETE") {
      customers.splice(customers.findIndex((item) => item.id === customerMatch[1]), 1);
      return empty(route);
    }
    if (customerMatch?.[2] === "transition" && method === "POST") {
      const record = customers.find((item) => item.id === customerMatch[1]);
      record!.state = "Qualified";
      record!.revision += 1;
      return json(route, record);
    }
    if (customerMatch?.[2] && ["submit", "cancel"].includes(customerMatch[2]) && method === "POST") {
      const record = customers.find((item) => item.id === customerMatch[1]);
      record!.documentStatus = customerMatch[2] === "submit" ? "submitted" : "cancelled";
      record!.revision += 1;
      return json(route, record);
    }
    if (customerMatch?.[2] === "owner" && method === "POST" && body) {
      const record = customers.find((item) => item.id === customerMatch[1]);
      record!.ownerId = String(body.ownerId);
      record!.revision += 1;
      return json(route, { id: record!.id, ownerId: record!.ownerId, revision: record!.revision, updatedAt: record!.updatedAt });
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

function jsonError(route: Route, status: number, code: string, message: string) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: true, code, message }) });
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
          ownership: { transferRoles: [], transferPermissions: ["customer.transfer"] },
          fields: [
            { name: "name", label: "Name", type: "text", required: true, inList: true },
            { name: "status", label: "Status", type: "select", options: ["lead", "active", "closed"], inList: true },
            { name: "revenue", label: "Revenue", type: "currency", precision: 24, scale: 4, validators: [{ kind: "range", min: "0.0000" }], inList: true },
            { name: "display_name", label: "Display name", type: "text", computed: { operation: "concat", dependencies: ["name", "status"], separator: " " } },
            { name: "notes", label: "Notes", type: "long_text" },
            { name: "is_active", label: "Active", type: "boolean" },
            { name: "approved", label: "Approved", type: "boolean", validators: [{ kind: "domain", values: [true, false] }] },
            { name: "rating", label: "Rating", type: "number", validators: [{ kind: "domain", values: [1, 2] }] },
            { name: "contacts", label: "Contacts", type: "children", fields: [
              { name: "contact_name", label: "Contact name", type: "text", required: true },
              { name: "quantity", label: "Quantity", type: "number" }
            ] },
            { name: "files", label: "Files", type: "attachments" }
          ],
          views: [
            { id: "customer-list", doctype: "customer", type: "list", fields: ["name", "status", "revenue"] },
            { id: "customer-form", doctype: "customer", type: "form", fields: ["name", "status", "revenue", "display_name", "notes", "is_active", "approved", "rating", "contacts", "files"] }
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
