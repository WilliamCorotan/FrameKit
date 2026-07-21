import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const serverEntry = process.env.FRAMEKIT_SMOKE_SERVER_ENTRY ?? join(root, ".output/server/index.mjs");

if (!existsSync(serverEntry)) {
  throw new Error("Built CRM server not found. Run `pnpm --filter @framekit/example-crm build` before `smoke:built`.");
}

process.env.FRAMEKIT_AUTH_SECRET = "BuiltSmoke!9qL2vN7xK4mR8sW5cT1hP6z";
process.env.FRAMEKIT_ADMIN_EMAIL = "smoke@framekit.test";
process.env.FRAMEKIT_ADMIN_PASSWORD = "Built smoke bootstrap passphrase";
process.env.FRAMEKIT_ALLOWED_ORIGINS = "http://built.local";

let server;
globalThis.__srvxLoader__ = ({ server: loadedServer }) => {
  server = loadedServer;
};

try {
  await import(pathToFileURL(serverEntry).href);

  const fetchHandler = server?.fetch;
  if (!fetchHandler) {
    throw new Error("Built CRM server adapter was not initialized.");
  }

  const health = await json(fetchHandler, "/health");
  if (health.ok !== true || health.app !== "Framekit CRM") {
    throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);
  }

  const login = await json(fetchHandler, "/api/auth/login", {
    method: "POST",
    body: {
      email: "smoke@framekit.test",
      password: "Built smoke bootstrap passphrase"
    }
  });
  const headers = { authorization: `Bearer ${login.token}` };
  const customer = await json(fetchHandler, "/api/doctypes/customer", {
    method: "POST",
    headers,
    body: {
      name: `Built Smoke ${Date.now()}`,
      status: "active",
      owner: "CI",
      annual_revenue: 1
    }
  });
  const diagnostics = await json(fetchHandler, "/api/diagnostics", { headers });

  if (!customer.id || diagnostics.app?.name !== "Framekit CRM") {
    throw new Error(`Built smoke failed: ${JSON.stringify({ customer, diagnostics })}`);
  }

  console.log(JSON.stringify({ ok: true, customerId: customer.id }));
} finally {
  delete globalThis.__srvxLoader__;
  await server?.close(true);
}

async function json(fetchHandler, path, options = {}) {
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
