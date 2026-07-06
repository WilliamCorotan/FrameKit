import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const serverEntry = join(root, ".output/server/index.mjs");

if (!existsSync(serverEntry)) {
  throw new Error("Built CRM server not found. Run `pnpm --filter @framekit/example-crm build` before `smoke:built`.");
}

process.env.FRAMEKIT_ADMIN_EMAIL = "admin@example.com";
process.env.FRAMEKIT_ADMIN_PASSWORD = "admin12345";

await import(pathToFileURL(serverEntry).href);

const fetchHandler = globalThis.__nitro__?.default?.fetch;
if (!fetchHandler) {
  throw new Error("Built CRM Nitro fetch handler was not initialized.");
}

const health = await json("/health");
if (health.ok !== true || health.app !== "Framekit CRM") {
  throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
}

const login = await json("/api/auth/login", {
  method: "POST",
  body: {
    email: "admin@example.com",
    password: "admin12345"
  }
});
const headers = { authorization: `Bearer ${login.token}` };
const customer = await json("/api/doctypes/customer", {
  method: "POST",
  headers,
  body: {
    name: `Built Smoke ${Date.now()}`,
    status: "active",
    owner: "CI",
    annual_revenue: 1
  }
});
const diagnostics = await json("/api/diagnostics", { headers });

if (!customer.id || diagnostics.app?.name !== "Framekit CRM") {
  throw new Error(`Built smoke failed: ${JSON.stringify({ customer, diagnostics })}`);
}

console.log(JSON.stringify({ ok: true, customerId: customer.id }));

async function json(path, options = {}) {
  const response = await fetchHandler(new Request(`http://built.local${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  }));
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}
