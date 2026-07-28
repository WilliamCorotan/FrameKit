export const standaloneServerSource = `import { createServer } from "node:http";
import { existsSync } from "node:fs";

const entry = new URL("./.output/server/index.mjs", import.meta.url);
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
if (!existsSync(entry)) throw new Error("Build the app before starting it.");

let adapter;
globalThis.__srvxLoader__ = ({ server }) => { adapter = server; };
await import(entry.href);
delete globalThis.__srvxLoader__;
if (!adapter?.fetch) throw new Error("Built Nitro adapter did not initialize.");

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const method = incoming.method ?? "GET";
    const response = await adapter.fetch(new Request(new URL(incoming.url ?? "/", \`http://\${incoming.headers.host ?? host}\`), {
      method,
      headers: incoming.headers,
      body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks)
    }));
    outgoing.statusCode = response.status;
    for (const [name, value] of response.headers) outgoing.setHeader(name, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing.setHeader("set-cookie", cookies);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.statusCode = 500;
    outgoing.end(error instanceof Error ? error.message : "Server bridge failed");
  }
});
await new Promise((resolve) => server.listen(port, host, resolve));
console.log(\`Framekit listening on http://\${host}:\${port}\`);

async function close() {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await adapter.close?.(true);
}
process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
`;

export const standaloneSmokeSource = `import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const origin = "http://127.0.0.1:43127";
const child = spawn(process.execPath, ["start.mjs"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: "43127", FRAMEKIT_ALLOWED_ORIGINS: origin },
  stdio: ["ignore", "pipe", "pipe"]
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });
try {
  await waitForHealth();
  const login = await json("/api/auth/login", { method: "POST", headers: { origin }, body: { email: "admin@example.com", password: "change-me-before-deploying" } });
  const headers = { authorization: \`Bearer \${login.token}\` };
  const created = await json("/api/doctypes/note", { method: "POST", headers, body: { title: "Standalone proof", body: "Packed packages work." } });
  const fetched = await json(\`/api/doctypes/note/\${created.id}\`, { headers });
  if (fetched.id !== created.id || fetched.data.title !== "Standalone proof") throw new Error("Standalone get-by-id proof failed.");
  const updated = await json(\`/api/doctypes/note/\${created.id}\`, {
    method: "PATCH",
    headers: { ...headers, "if-match": String(created.revision) },
    body: { title: "Updated standalone proof", body: "Packed packages still work." }
  });
  if (updated.data.title !== "Updated standalone proof" || updated.revision <= created.revision) throw new Error("Standalone update proof failed.");
  const listed = await json("/api/doctypes/note", { headers });
  if (!created.id || !listed.some((record) => record.id === created.id && record.data.title === "Updated standalone proof")) throw new Error("Standalone list proof failed.");
  await json(\`/api/doctypes/note/\${created.id}\`, { method: "DELETE", headers: { ...headers, "if-match": String(updated.revision) } });
  const missing = await request(\`/api/doctypes/note/\${created.id}\`, { headers });
  if (missing.response.status !== 404) throw new Error(\`Standalone delete proof expected 404, received \${missing.response.status}.\`);
  const afterDelete = await json("/api/doctypes/note", { headers });
  if (afterDelete.some((record) => record.id === created.id)) throw new Error("Standalone delete proof left the record in list results.");
  console.log(JSON.stringify({ ok: true, id: created.id }));
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(\`Standalone server exited early: \${stderr}\`);
    try {
      const response = await fetch(origin + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(\`Standalone server did not become healthy: \${stderr}\`);
}

async function json(path, options = {}) {
  const { response, body } = await request(path, options);
  if (!response.ok) throw new Error(\`\${options.method ?? "GET"} \${path} failed (\${response.status}): \${JSON.stringify(body)}\`);
  return body;
}

async function request(path, options = {}) {
  const response = await fetch(origin + path, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json", "x-tenant-id": "default", ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json().catch(() => undefined);
  return { response, body };
}
`;
