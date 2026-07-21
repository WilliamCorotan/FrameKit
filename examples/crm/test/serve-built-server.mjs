import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const serverEntry = join(root, ".output/server/index.mjs");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 45123);

if (!existsSync(serverEntry)) {
  throw new Error("Built CRM server not found. Run its build before serve:built.");
}

let adapter;
globalThis.__srvxLoader__ = ({ server }) => {
  adapter = server;
};
await import(pathToFileURL(serverEntry).href);
delete globalThis.__srvxLoader__;

if (!adapter?.fetch) {
  throw new Error("Built CRM server adapter was not initialized.");
}

const httpServer = createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    for await (const chunk of incoming) {
      chunks.push(chunk);
    }
    const method = incoming.method ?? "GET";
    const body = method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks);
    const request = new Request(new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? `${host}:${port}`}`), {
      method,
      headers: incoming.headers,
      body
    });
    const response = await adapter.fetch(request);
    outgoing.statusCode = response.status;
    for (const [name, value] of response.headers) {
      outgoing.setHeader(name, value);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) {
      outgoing.setHeader("set-cookie", cookies);
    }
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.statusCode = 500;
    outgoing.end(error instanceof Error ? error.message : "Built server bridge failed");
  }
});

await new Promise((resolve) => httpServer.listen(port, host, resolve));
console.log(`Built CRM listening on http://${host}:${port}`);

async function close() {
  await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  await adapter.close?.(true);
}

process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
